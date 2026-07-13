import type { IncomingHttpHeaders } from "node:http";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { MetricsCollector } from "../admin/metrics.js";
import type { LogEvent } from "../types.js";

export type PlaybackProxyResourceKind = "manifest" | "segment";

export type PlaybackProxyResourceRequest = {
  kind: PlaybackProxyResourceKind;
  resourceId: string;
  headers: IncomingHttpHeaders;
  method?: "GET" | "HEAD";
};

export type PlaybackProxyResource = {
  statusCode?: number;
  contentType: string;
  body: string | Uint8Array | ReadableStream<Uint8Array>;
  headers?: Record<string, string>;
};

export type RegisterMpdManifestInput = {
  roomCode: string;
  providerId: string;
  manifest: string;
  manifestUrl?: string;
  publicBaseUrl?: string;
  upstreamHeaders?: Record<string, string>;
  upstreamUrlAlternates?: Record<string, string[]>;
  ttlMs?: number;
};

export type RegisterM3u8ManifestInput = RegisterMpdManifestInput;

export type RegisterSegmentInput = {
  roomCode: string;
  providerId: string;
  upstreamUrl: string;
  publicBaseUrl?: string;
  upstreamHeaders?: Record<string, string>;
  fallbackUpstreamUrls?: string[];
  ttlMs?: number;
};

export type RegisteredProxyManifest = {
  manifestId: string;
  manifestUrl: string;
  expiresAt: number;
};

export type RegisteredProxySegment = {
  segmentId: string;
  segmentUrl: string;
  expiresAt: number;
};

export type PlaybackProxyService = {
  resolveResource: (
    request: PlaybackProxyResourceRequest,
  ) => Promise<PlaybackProxyResource | null>;
  registerMpdManifest: (
    input: RegisterMpdManifestInput,
  ) => RegisteredProxyManifest;
  registerM3u8Manifest: (
    input: RegisterM3u8ManifestInput,
  ) => RegisteredProxyManifest;
  registerSegment: (input: RegisterSegmentInput) => RegisteredProxySegment;
  cleanupExpired: () => number;
  clearRoom: (roomCode: string) => number;
  clearProviderAuth: (roomCode: string, providerId: string) => number;
};

export type PlaybackProxyServiceOptions = {
  publicBaseUrl?: string;
  fetch?: typeof fetch;
  metricsCollector?: Partial<
    Pick<
      MetricsCollector,
      | "recordProxyTraffic"
      | "recordProxyRequest"
      | "recordProxyUpstreamTraffic"
      | "recordProxyUpstreamRequest"
      | "recordProxyCacheEvent"
    >
  >;
  logEvent?: LogEvent;
  resolveHostname?: (hostname: string) => Promise<string[]>;
  createResourceId?: () => string;
  now?: () => number;
  defaultTtlMs?: number;
  segmentCacheTtlMs?: number;
  segmentCacheMaxBytes?: number;
  segmentCacheMaxEntryBytes?: number;
  segmentCacheMaxEntries?: number;
};

type StoredProxyResource =
  | ({
      kind: "manifest";
      roomCode: string;
      providerId: string;
      expiresAt: number;
      ttlMs: number;
      refreshM3u8Url?: string;
      refreshPublicBaseUrl?: string;
      refreshUpstreamHeaders?: Record<string, string>;
      m3u8SegmentMappings?: Map<string, string>;
      m3u8PlaylistMappings?: Map<string, string>;
    } & PlaybackProxyResource)
  | {
      kind: "segment";
      roomCode: string;
      providerId: string;
      upstreamUrls: string[];
      upstreamHeaders?: Record<string, string>;
      expiresAt: number;
      ttlMs: number;
    };

const DEFAULT_PROXY_RESOURCE_TTL_MS = 10 * 60_000;
const DEFAULT_SEGMENT_CACHE_TTL_MS = 60_000;
const DEFAULT_SEGMENT_CACHE_MAX_BYTES = 256 * 1024 * 1024;
const DEFAULT_SEGMENT_CACHE_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const DEFAULT_SEGMENT_CACHE_MAX_ENTRIES = 2_048;

type CachedSegmentResponse = {
  statusCode: number;
  contentType: string;
  body: Uint8Array;
  headers: Record<string, string>;
  expiresAt: number;
  sizeBytes: number;
  roomCode: string;
  providerId: string;
  resourceKey: string;
};

type PendingSegmentFetchResult =
  | {
      reusable: true;
      entry: CachedSegmentResponse;
    }
  | {
      reusable: false;
      resource: PlaybackProxyResource | null;
    };

function createStableSegmentMappingKey(
  upstreamUrls: readonly string[],
  upstreamHeaders: Record<string, string> | undefined,
): string {
  const headerKey = Object.entries(upstreamHeaders ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}`)
    .join("\n");
  return `${upstreamUrls.join("\n")}\n\n${headerKey}`;
}

function createStableM3u8ManifestMappingKey(
  upstreamUrl: string,
  upstreamHeaders: Record<string, string> | undefined,
): string {
  return createStableSegmentMappingKey([upstreamUrl], upstreamHeaders);
}

export class PlaybackProxyError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlaybackProxyError";
  }
}

function resourceKey(kind: PlaybackProxyResourceKind, resourceId: string) {
  return `${kind}:${resourceId}`;
}

function refreshResourceExpiry(
  resource: StoredProxyResource,
  currentTime: number,
): void {
  resource.expiresAt = currentTime + resource.ttlMs;
}

function normalizePublicBaseUrl(publicBaseUrl: string | undefined): string {
  return publicBaseUrl?.replace(/\/+$/, "") ?? "";
}

function createProxyUrl(
  publicBaseUrl: string,
  kind: PlaybackProxyResourceKind,
  resourceId: string,
): string {
  return `${publicBaseUrl}/proxy/${kind}/${encodeURIComponent(resourceId)}`;
}

function createProxyBaseUrl(publicBaseUrl: string, resourceId: string): string {
  return `${createProxyUrl(publicBaseUrl, "segment", resourceId)}/`;
}

function isLiveM3u8Manifest(manifest: string): boolean {
  return !/^#EXT-X-ENDLIST\s*$/im.test(manifest);
}

function isM3u8PlaylistUrl(upstreamUrl: string): boolean {
  try {
    return /\.m3u8$/i.test(new URL(upstreamUrl).pathname);
  } catch {
    return /\.m3u8(?:$|[?#])/i.test(upstreamUrl);
  }
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (match, entity: string) => {
    switch (entity) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
        return match;
    }
  });
}

function readUpstreamHost(upstreamUrl: string): string {
  try {
    return new URL(upstreamUrl).hostname;
  } catch {
    return "<invalid>";
  }
}

function resolveHttpUrl(
  value: string,
  baseUrl: string | undefined,
): string | null {
  const trimmed = decodeXmlEntities(value).trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

type IpBlockOptions = {
  allowBenchmarkNetwork?: boolean;
};

function isBlockedIpv4Address(
  address: string,
  options: IpBlockOptions = {},
): boolean {
  const octets = address.split(".").map((item) => Number(item));
  if (
    octets.length !== 4 ||
    octets.some((item) => !Number.isInteger(item) || item < 0 || item > 255)
  ) {
    return true;
  }

  const [first, second, third] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (!options.allowBenchmarkNetwork &&
      first === 198 &&
      (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  );
}

function isBlockedIpv6Address(
  address: string,
  options: IpBlockOptions = {},
): boolean {
  const normalized = stripIpv6Brackets(address).toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    return isBlockedIpAddress(normalized.slice("::ffff:".length), options);
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  );
}

function isBlockedIpAddress(
  address: string,
  options: IpBlockOptions = {},
): boolean {
  const family = isIP(stripIpv6Brackets(address));
  if (family === 4) {
    return isBlockedIpv4Address(address, options);
  }
  if (family === 6) {
    return isBlockedIpv6Address(address, options);
  }
  return true;
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  const addresses = await lookup(hostname, {
    all: true,
    verbatim: true,
  });
  return addresses.map((address) => address.address);
}

export function createPlaybackProxyService(
  options: PlaybackProxyServiceOptions = {},
): PlaybackProxyService {
  const resources = new Map<string, StoredProxyResource>();
  const segmentResponseCache = new Map<string, CachedSegmentResponse>();
  const pendingSegmentFetches = new Map<
    string,
    Promise<PendingSegmentFetchResult>
  >();
  const publicBaseUrl = normalizePublicBaseUrl(options.publicBaseUrl);
  const fetchUpstream = options.fetch ?? fetch;
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  const createResourceId = options.createResourceId ?? (() => randomUUID());
  const now = options.now ?? Date.now;
  const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_PROXY_RESOURCE_TTL_MS;
  const segmentCacheTtlMs =
    options.segmentCacheTtlMs ?? DEFAULT_SEGMENT_CACHE_TTL_MS;
  const segmentCacheMaxBytes =
    options.segmentCacheMaxBytes ?? DEFAULT_SEGMENT_CACHE_MAX_BYTES;
  const segmentCacheMaxEntryBytes =
    options.segmentCacheMaxEntryBytes ?? DEFAULT_SEGMENT_CACHE_MAX_ENTRY_BYTES;
  const segmentCacheMaxEntries =
    options.segmentCacheMaxEntries ?? DEFAULT_SEGMENT_CACHE_MAX_ENTRIES;
  let segmentCacheBytes = 0;

  function getEffectivePublicBaseUrl(override: string | undefined): string {
    return override !== undefined
      ? normalizePublicBaseUrl(override)
      : publicBaseUrl;
  }

  function setSegmentMapping(
    roomCode: string,
    providerId: string,
    upstreamUrls: string[],
    expiresAt: number,
    ttlMs: number,
    upstreamHeaders: Record<string, string> | undefined,
    stableMappings?: Map<string, string>,
  ): string {
    const stableMappingKey = stableMappings
      ? createStableSegmentMappingKey(upstreamUrls, upstreamHeaders)
      : undefined;
    const existingSegmentId = stableMappingKey
      ? stableMappings?.get(stableMappingKey)
      : undefined;
    if (existingSegmentId) {
      const existing = resources.get(resourceKey("segment", existingSegmentId));
      if (existing?.kind === "segment") {
        const existingResourceKey = resourceKey("segment", existingSegmentId);
        const existingMappingKey = createStableSegmentMappingKey(
          existing.upstreamUrls,
          existing.upstreamHeaders,
        );
        const nextMappingKey = createStableSegmentMappingKey(
          upstreamUrls,
          upstreamHeaders,
        );
        if (existingMappingKey !== nextMappingKey) {
          deleteSegmentCacheWhere(
            (entry) => entry.resourceKey === existingResourceKey,
          );
          deletePendingSegmentFetchesWhere((cacheKey) =>
            cacheKey.startsWith(`${existingResourceKey}\n`),
          );
        }
        existing.expiresAt = expiresAt;
        existing.ttlMs = ttlMs;
        existing.upstreamUrls = upstreamUrls;
        existing.upstreamHeaders = upstreamHeaders;
        return existingSegmentId;
      }
    }

    const segmentId = createResourceId();
    resources.set(resourceKey("segment", segmentId), {
      kind: "segment",
      roomCode,
      providerId,
      upstreamUrls,
      upstreamHeaders,
      expiresAt,
      ttlMs,
    });
    if (stableMappings && stableMappingKey) {
      stableMappings.set(stableMappingKey, segmentId);
    }
    return segmentId;
  }

  function createUpstreamUrls(
    upstreamUrl: string,
    fallbackUpstreamUrls: readonly string[] | undefined,
  ): string[] {
    const urls: string[] = [];
    for (const value of [upstreamUrl, ...(fallbackUpstreamUrls ?? [])]) {
      const resolved = resolveHttpUrl(value, undefined);
      if (resolved && !urls.includes(resolved)) {
        urls.push(resolved);
      }
    }
    return urls.length > 0 ? urls : [upstreamUrl];
  }

  function setM3u8ManifestMapping(
    resourcePublicBaseUrl: string,
    roomCode: string,
    providerId: string,
    upstreamUrl: string,
    expiresAt: number,
    ttlMs: number,
    upstreamHeaders: Record<string, string> | undefined,
    stableSegmentMappings?: Map<string, string>,
    stablePlaylistMappings?: Map<string, string>,
  ): string {
    const resolvedUpstreamUrl = resolveHttpUrl(upstreamUrl, undefined);
    const manifestUrl = resolvedUpstreamUrl ?? upstreamUrl;
    const stableMappingKey = stablePlaylistMappings
      ? createStableM3u8ManifestMappingKey(manifestUrl, upstreamHeaders)
      : undefined;
    const existingManifestId = stableMappingKey
      ? stablePlaylistMappings?.get(stableMappingKey)
      : undefined;
    if (existingManifestId) {
      const existing = resources.get(
        resourceKey("manifest", existingManifestId),
      );
      if (existing?.kind === "manifest") {
        existing.expiresAt = expiresAt;
        existing.ttlMs = ttlMs;
        existing.refreshM3u8Url = manifestUrl;
        existing.refreshPublicBaseUrl = resourcePublicBaseUrl;
        existing.m3u8SegmentMappings = stableSegmentMappings;
        existing.m3u8PlaylistMappings = stablePlaylistMappings;
        if (upstreamHeaders) {
          existing.refreshUpstreamHeaders = upstreamHeaders;
        } else {
          delete existing.refreshUpstreamHeaders;
        }
        return existingManifestId;
      }
    }

    const manifestId = createResourceId();
    resources.set(resourceKey("manifest", manifestId), {
      kind: "manifest",
      roomCode,
      providerId,
      expiresAt,
      ttlMs,
      contentType: "application/vnd.apple.mpegurl",
      body: "",
      refreshM3u8Url: manifestUrl,
      refreshPublicBaseUrl: resourcePublicBaseUrl,
      m3u8SegmentMappings: stableSegmentMappings,
      m3u8PlaylistMappings: stablePlaylistMappings,
      ...(upstreamHeaders ? { refreshUpstreamHeaders: upstreamHeaders } : {}),
    });
    if (stablePlaylistMappings && stableMappingKey) {
      stablePlaylistMappings.set(stableMappingKey, manifestId);
    }
    return manifestId;
  }

  function rewriteBaseUrls(
    resourcePublicBaseUrl: string,
    roomCode: string,
    providerId: string,
    manifest: string,
    manifestUrl: string | undefined,
    expiresAt: number,
    ttlMs: number,
    upstreamHeaders: Record<string, string> | undefined,
    upstreamUrlAlternates: Record<string, string[]> | undefined,
  ): string {
    return manifest.replace(
      /(<BaseURL\b[^>]*>)([^<]+)(<\/BaseURL>)/gi,
      (match, open: string, value: string, close: string) => {
        const upstreamUrl = resolveHttpUrl(value, manifestUrl);
        if (!upstreamUrl) {
          return match;
        }
        const segmentId = setSegmentMapping(
          roomCode,
          providerId,
          createUpstreamUrls(upstreamUrl, upstreamUrlAlternates?.[upstreamUrl]),
          expiresAt,
          ttlMs,
          upstreamHeaders,
        );
        return `${open}${createProxyBaseUrl(resourcePublicBaseUrl, segmentId)}${close}`;
      },
    );
  }

  function rewriteAbsoluteMediaAttributes(
    resourcePublicBaseUrl: string,
    roomCode: string,
    providerId: string,
    manifest: string,
    manifestUrl: string | undefined,
    expiresAt: number,
    ttlMs: number,
    upstreamHeaders: Record<string, string> | undefined,
    upstreamUrlAlternates: Record<string, string[]> | undefined,
  ): string {
    return manifest.replace(
      /\b(initialization|media|sourceURL)="([^"]+)"/gi,
      (match, attr: string, value: string) => {
        if (value.includes("$")) {
          return match;
        }
        const upstreamUrl = resolveHttpUrl(value, manifestUrl);
        if (!upstreamUrl) {
          return match;
        }
        const segmentId = setSegmentMapping(
          roomCode,
          providerId,
          createUpstreamUrls(upstreamUrl, upstreamUrlAlternates?.[upstreamUrl]),
          expiresAt,
          ttlMs,
          upstreamHeaders,
        );
        return `${attr}="${createProxyUrl(resourcePublicBaseUrl, "segment", segmentId)}"`;
      },
    );
  }

  function rewriteM3u8UriAttributes(
    resourcePublicBaseUrl: string,
    roomCode: string,
    providerId: string,
    line: string,
    manifestUrl: string | undefined,
    expiresAt: number,
    ttlMs: number,
    upstreamHeaders: Record<string, string> | undefined,
    stableSegmentMappings?: Map<string, string>,
    stablePlaylistMappings?: Map<string, string>,
  ): string {
    return line.replace(/\bURI="([^"]+)"/gi, (match, value: string) => {
      const upstreamUrl = resolveHttpUrl(value, manifestUrl);
      if (!upstreamUrl) {
        return match;
      }
      if (isM3u8PlaylistUrl(upstreamUrl)) {
        const manifestId = setM3u8ManifestMapping(
          resourcePublicBaseUrl,
          roomCode,
          providerId,
          upstreamUrl,
          expiresAt,
          ttlMs,
          upstreamHeaders,
          stableSegmentMappings,
          stablePlaylistMappings,
        );
        return `URI="${createProxyUrl(resourcePublicBaseUrl, "manifest", manifestId)}"`;
      }
      const segmentId = setSegmentMapping(
        roomCode,
        providerId,
        createUpstreamUrls(upstreamUrl, undefined),
        expiresAt,
        ttlMs,
        upstreamHeaders,
        stableSegmentMappings,
      );
      return `URI="${createProxyUrl(resourcePublicBaseUrl, "segment", segmentId)}"`;
    });
  }

  function rewriteM3u8Manifest(
    resourcePublicBaseUrl: string,
    roomCode: string,
    providerId: string,
    manifest: string,
    manifestUrl: string | undefined,
    expiresAt: number,
    ttlMs: number,
    upstreamHeaders: Record<string, string> | undefined,
    stableSegmentMappings?: Map<string, string>,
    stablePlaylistMappings?: Map<string, string>,
  ): string {
    const rewrittenLines: string[] = [];
    let nextUriIsPlaylist = false;

    for (const line of manifest.split(/\r?\n/)) {
      const lineWithProxyUris = rewriteM3u8UriAttributes(
        resourcePublicBaseUrl,
        roomCode,
        providerId,
        line,
        manifestUrl,
        expiresAt,
        ttlMs,
        upstreamHeaders,
        stableSegmentMappings,
        stablePlaylistMappings,
      );
      const trimmedLine = lineWithProxyUris.trim();
      if (trimmedLine.length === 0) {
        rewrittenLines.push(lineWithProxyUris);
        continue;
      }
      if (trimmedLine.startsWith("#")) {
        if (/^#EXT-X-STREAM-INF\b/i.test(trimmedLine)) {
          nextUriIsPlaylist = true;
        }
        rewrittenLines.push(lineWithProxyUris);
        continue;
      }

      const upstreamUrl = resolveHttpUrl(trimmedLine, manifestUrl);
      if (!upstreamUrl) {
        nextUriIsPlaylist = false;
        rewrittenLines.push(lineWithProxyUris);
        continue;
      }

      const leadingWhitespace = lineWithProxyUris.match(/^\s*/)?.[0] ?? "";
      if (nextUriIsPlaylist || isM3u8PlaylistUrl(upstreamUrl)) {
        const manifestId = setM3u8ManifestMapping(
          resourcePublicBaseUrl,
          roomCode,
          providerId,
          upstreamUrl,
          expiresAt,
          ttlMs,
          upstreamHeaders,
          stableSegmentMappings,
          stablePlaylistMappings,
        );
        rewrittenLines.push(
          `${leadingWhitespace}${createProxyUrl(resourcePublicBaseUrl, "manifest", manifestId)}`,
        );
        nextUriIsPlaylist = false;
        continue;
      }

      const segmentId = setSegmentMapping(
        roomCode,
        providerId,
        createUpstreamUrls(upstreamUrl, undefined),
        expiresAt,
        ttlMs,
        upstreamHeaders,
        stableSegmentMappings,
      );
      rewrittenLines.push(
        `${leadingWhitespace}${createProxyUrl(resourcePublicBaseUrl, "segment", segmentId)}`,
      );
      nextUriIsPlaylist = false;
    }

    return rewrittenLines.join("\n");
  }

  async function assertSafeUpstreamUrl(upstreamUrl: string): Promise<void> {
    let parsed: URL;
    try {
      parsed = new URL(upstreamUrl);
    } catch {
      throw new PlaybackProxyError(
        403,
        "proxy_forbidden",
        "Proxy resource is forbidden.",
      );
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new PlaybackProxyError(
        403,
        "proxy_forbidden",
        "Proxy resource is forbidden.",
      );
    }

    const hostname = stripIpv6Brackets(parsed.hostname);
    if (isIP(hostname)) {
      if (isBlockedIpAddress(hostname)) {
        throw new PlaybackProxyError(
          403,
          "proxy_forbidden",
          "Proxy resource is forbidden.",
        );
      }
      return;
    }

    let addresses: string[];
    try {
      addresses = await resolveHostname(hostname);
    } catch {
      throw new PlaybackProxyError(
        403,
        "proxy_forbidden",
        "Proxy resource is forbidden.",
      );
    }
    if (
      addresses.length === 0 ||
      addresses.some((address) =>
        isBlockedIpAddress(address, { allowBenchmarkNetwork: true }),
      )
    ) {
      throw new PlaybackProxyError(
        403,
        "proxy_forbidden",
        "Proxy resource is forbidden.",
      );
    }
  }

  function buildUpstreamHeaders(
    requestHeaders: IncomingHttpHeaders,
    upstreamHeaders: Record<string, string> | undefined,
  ): Record<string, string> {
    const headers = { ...(upstreamHeaders ?? {}) };
    const rangeHeader = requestHeaders.range;
    if (typeof rangeHeader === "string") {
      headers.Range = rangeHeader;
    }
    return headers;
  }

  function copyUpstreamResponseHeaders(
    headers: Headers,
  ): Record<string, string> {
    const copied: Record<string, string> = {};
    for (const name of [
      "accept-ranges",
      "content-length",
      "content-range",
      "etag",
      "last-modified",
    ]) {
      const value = headers.get(name);
      if (value) {
        copied[name] = value;
      }
    }
    return copied;
  }

  function createMeteredStream(
    body: ReadableStream<Uint8Array>,
    onChunk: (bytes: number) => void,
  ): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const result = await reader.read();
        if (result.done) {
          controller.close();
          return;
        }
        onChunk(result.value.byteLength);
        controller.enqueue(result.value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
  }

  function isSegmentCacheEnabled(): boolean {
    return (
      segmentCacheTtlMs > 0 &&
      segmentCacheMaxBytes > 0 &&
      segmentCacheMaxEntryBytes > 0 &&
      segmentCacheMaxEntries > 0
    );
  }

  function readRangeHeader(headers: IncomingHttpHeaders): string | undefined {
    const rangeHeader = headers.range;
    return typeof rangeHeader === "string" && rangeHeader.trim()
      ? rangeHeader.trim()
      : undefined;
  }

  function isOpenEndedRangeHeader(rangeHeader: string): boolean {
    const match = rangeHeader.match(/^\s*bytes\s*=\s*(.+)$/i);
    if (!match?.[1]) {
      return false;
    }
    return match[1].split(",").some((part) => /^\s*\d+\s*-\s*$/.test(part));
  }

  function createSegmentCacheKey(
    segmentResourceKey: string,
    rangeHeader: string,
  ): string {
    return `${segmentResourceKey}\nrange:${rangeHeader}`;
  }

  function parseContentLength(headers: Headers): number | null {
    const value = headers.get("content-length");
    if (!value) {
      return null;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  function isCacheableSegmentStatus(statusCode: number): boolean {
    return statusCode === 200 || statusCode === 206;
  }

  async function readResponseBody(
    body: ReadableStream<Uint8Array> | null,
    maxBytes: number,
  ): Promise<Uint8Array | null> {
    if (!body) {
      return new Uint8Array();
    }
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    const reader = body.getReader();
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      if (totalBytes + result.value.byteLength > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(result.value);
      totalBytes += result.value.byteLength;
    }

    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return merged;
  }

  function recordProxyResponseBytes(
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    bytes: number,
  ): void {
    if (bytes <= 0) {
      return;
    }
    options.metricsCollector?.recordProxyTraffic?.({
      roomCode: resource.roomCode,
      providerId: resource.providerId,
      bytes,
    });
  }

  function recordProxyRequest(
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
  ): void {
    options.metricsCollector?.recordProxyRequest?.({
      roomCode: resource.roomCode,
      providerId: resource.providerId,
    });
  }

  function recordProxyUpstreamBytes(
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    bytes: number,
  ): void {
    if (bytes <= 0) {
      return;
    }
    options.metricsCollector?.recordProxyUpstreamTraffic?.({
      roomCode: resource.roomCode,
      providerId: resource.providerId,
      bytes,
    });
  }

  function recordProxyUpstreamRequest(
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    outcome: "success" | "error",
  ): void {
    options.metricsCollector?.recordProxyUpstreamRequest?.({
      roomCode: resource.roomCode,
      providerId: resource.providerId,
      outcome,
    });
  }

  function recordProxyCacheEvent(
    resource:
      | Extract<StoredProxyResource, { kind: "segment" }>
      | CachedSegmentResponse,
    event: "hit" | "miss" | "store" | "coalesced" | "bypass" | "expired",
  ): void {
    options.metricsCollector?.recordProxyCacheEvent?.({
      roomCode: resource.roomCode,
      providerId: resource.providerId,
      event,
    });
  }

  function deleteSegmentCacheEntry(cacheKey: string): void {
    const existing = segmentResponseCache.get(cacheKey);
    if (!existing) {
      return;
    }
    segmentCacheBytes -= existing.sizeBytes;
    segmentResponseCache.delete(cacheKey);
  }

  function deleteSegmentCacheWhere(
    shouldDelete: (entry: CachedSegmentResponse) => boolean,
  ): number {
    let deleted = 0;
    for (const [cacheKey, entry] of segmentResponseCache.entries()) {
      if (!shouldDelete(entry)) {
        continue;
      }
      deleteSegmentCacheEntry(cacheKey);
      deleted += 1;
    }
    return deleted;
  }

  function deletePendingSegmentFetchesWhere(
    shouldDelete: (cacheKey: string) => boolean,
  ): void {
    for (const cacheKey of pendingSegmentFetches.keys()) {
      if (shouldDelete(cacheKey)) {
        pendingSegmentFetches.delete(cacheKey);
      }
    }
  }

  function purgeExpiredSegmentCache(currentTime: number): number {
    return deleteSegmentCacheWhere((entry) => entry.expiresAt <= currentTime);
  }

  function enforceSegmentCacheLimits(): void {
    while (
      segmentResponseCache.size > segmentCacheMaxEntries ||
      segmentCacheBytes > segmentCacheMaxBytes
    ) {
      const oldestKey = segmentResponseCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      deleteSegmentCacheEntry(oldestKey);
    }
  }

  function getCachedSegmentResponse(
    cacheKey: string,
    currentTime: number,
  ): CachedSegmentResponse | null {
    const entry = segmentResponseCache.get(cacheKey);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= currentTime) {
      recordProxyCacheEvent(entry, "expired");
      deleteSegmentCacheEntry(cacheKey);
      return null;
    }

    // Refresh insertion order for simple LRU eviction while keeping TTL fixed.
    segmentResponseCache.delete(cacheKey);
    segmentResponseCache.set(cacheKey, entry);
    return entry;
  }

  function createCachedSegmentResource(
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    entry: CachedSegmentResponse,
  ): PlaybackProxyResource {
    recordProxyResponseBytes(resource, entry.body.byteLength);
    return {
      statusCode: entry.statusCode,
      contentType: entry.contentType,
      body: entry.body.slice(),
      headers: { ...entry.headers },
    };
  }

  function storeCachedSegmentResponse(
    cacheKey: string,
    resourceKeyValue: string,
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    response: Response,
    body: Uint8Array,
    currentTime: number,
  ): CachedSegmentResponse | null {
    if (
      !isSegmentCacheEnabled() ||
      !isCacheableSegmentStatus(response.status) ||
      body.byteLength > segmentCacheMaxEntryBytes ||
      body.byteLength > segmentCacheMaxBytes ||
      resources.get(resourceKeyValue) !== resource
    ) {
      return null;
    }

    deleteSegmentCacheEntry(cacheKey);
    const entry: CachedSegmentResponse = {
      statusCode: response.status,
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      body,
      headers: copyUpstreamResponseHeaders(response.headers),
      expiresAt: Math.min(currentTime + segmentCacheTtlMs, resource.expiresAt),
      sizeBytes: body.byteLength,
      roomCode: resource.roomCode,
      providerId: resource.providerId,
      resourceKey: resourceKeyValue,
    };
    segmentResponseCache.set(cacheKey, entry);
    segmentCacheBytes += entry.sizeBytes;
    enforceSegmentCacheLimits();
    if (segmentResponseCache.get(cacheKey) !== entry) {
      return null;
    }
    recordProxyCacheEvent(entry, "store");
    return entry;
  }

  async function fetchSegmentUpstream(
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    request: PlaybackProxyResourceRequest,
  ): Promise<{ response: Response; upstreamUrl: string } | null> {
    let upstreamResponse: Response | null = null;
    let upstreamUrl = resource.upstreamUrls[0] ?? "";
    for (const candidateUrl of resource.upstreamUrls) {
      await assertSafeUpstreamUrl(candidateUrl);
      upstreamUrl = candidateUrl;
      upstreamResponse = await fetchUpstream(candidateUrl, {
        method: request.method === "HEAD" ? "HEAD" : "GET",
        headers: buildUpstreamHeaders(
          request.headers,
          resource.upstreamHeaders,
        ),
      });
      recordProxyUpstreamRequest(
        resource,
        upstreamResponse.status < 400 ? "success" : "error",
      );
      if (upstreamResponse.status < 400) {
        break;
      }
    }
    return upstreamResponse
      ? { response: upstreamResponse, upstreamUrl }
      : null;
  }

  function logSegmentUpstreamFailure(
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    upstreamUrl: string,
    response: Response,
  ): void {
    if (response.status < 400) {
      return;
    }
    options.logEvent?.("playback_proxy_upstream_http_error", {
      roomCode: resource.roomCode,
      providerId: resource.providerId,
      resourceKind: resource.kind,
      statusCode: response.status,
      upstreamHost: readUpstreamHost(upstreamUrl),
      contentType: response.headers.get("content-type") ?? null,
      result: "upstream_error",
    });
  }

  function createStreamingSegmentResource(
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    request: PlaybackProxyResourceRequest,
    response: Response,
  ): PlaybackProxyResource {
    const body =
      request.method === "HEAD"
        ? new Uint8Array()
        : response.body
          ? createMeteredStream(response.body, (bytes) => {
              recordProxyResponseBytes(resource, bytes);
              recordProxyUpstreamBytes(resource, bytes);
            })
          : new Uint8Array();
    return {
      statusCode: response.status,
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
      body,
      headers: copyUpstreamResponseHeaders(response.headers),
    };
  }

  async function resolveUncachedSegmentResource(
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    request: PlaybackProxyResourceRequest,
  ): Promise<PlaybackProxyResource | null> {
    const fetched = await fetchSegmentUpstream(resource, request);
    if (!fetched) {
      return null;
    }
    logSegmentUpstreamFailure(resource, fetched.upstreamUrl, fetched.response);
    return createStreamingSegmentResource(resource, request, fetched.response);
  }

  async function fetchRangedSegmentForCache(
    resourceKeyValue: string,
    cacheKey: string,
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    request: PlaybackProxyResourceRequest,
    currentTime: number,
  ): Promise<PendingSegmentFetchResult> {
    const fetched = await fetchSegmentUpstream(resource, request);
    if (!fetched) {
      return { reusable: false, resource: null };
    }

    logSegmentUpstreamFailure(resource, fetched.upstreamUrl, fetched.response);
    const contentLength = parseContentLength(fetched.response.headers);
    if (
      !isSegmentCacheEnabled() ||
      !isCacheableSegmentStatus(fetched.response.status) ||
      contentLength === null ||
      contentLength > segmentCacheMaxEntryBytes ||
      contentLength > segmentCacheMaxBytes
    ) {
      return {
        reusable: false,
        resource: createStreamingSegmentResource(
          resource,
          request,
          fetched.response,
        ),
      };
    }

    const body = await readResponseBody(
      fetched.response.body,
      Math.min(segmentCacheMaxEntryBytes, segmentCacheMaxBytes),
    );
    if (!body) {
      return {
        reusable: false,
        resource: await resolveUncachedSegmentResource(resource, request),
      };
    }
    recordProxyUpstreamBytes(resource, body.byteLength);
    const entry = storeCachedSegmentResponse(
      cacheKey,
      resourceKeyValue,
      resource,
      fetched.response,
      body,
      currentTime,
    );
    if (!entry) {
      return {
        reusable: false,
        resource: {
          statusCode: fetched.response.status,
          contentType:
            fetched.response.headers.get("content-type") ??
            "application/octet-stream",
          body,
          headers: copyUpstreamResponseHeaders(fetched.response.headers),
        },
      };
    }

    return { reusable: true, entry };
  }

  async function resolveCachedRangedSegmentResource(
    resourceKeyValue: string,
    resource: Extract<StoredProxyResource, { kind: "segment" }>,
    request: PlaybackProxyResourceRequest,
    currentTime: number,
  ): Promise<PlaybackProxyResource | null> {
    const rangeHeader = readRangeHeader(request.headers);
    if (
      request.method === "HEAD" ||
      !rangeHeader ||
      isOpenEndedRangeHeader(rangeHeader) ||
      !isSegmentCacheEnabled()
    ) {
      recordProxyCacheEvent(resource, "bypass");
      return await resolveUncachedSegmentResource(resource, request);
    }

    const cacheKey = createSegmentCacheKey(resourceKeyValue, rangeHeader);
    const cached = getCachedSegmentResponse(cacheKey, currentTime);
    if (cached) {
      recordProxyCacheEvent(resource, "hit");
      return createCachedSegmentResource(resource, cached);
    }

    const pending = pendingSegmentFetches.get(cacheKey);
    if (pending) {
      const result = await pending;
      if (result.reusable) {
        recordProxyCacheEvent(resource, "coalesced");
        return createCachedSegmentResource(resource, result.entry);
      }
      if (resources.get(resourceKeyValue) !== resource) {
        return null;
      }
      recordProxyCacheEvent(resource, "bypass");
      return await resolveUncachedSegmentResource(resource, request);
    }

    recordProxyCacheEvent(resource, "miss");
    const fetchPromise = fetchRangedSegmentForCache(
      resourceKeyValue,
      cacheKey,
      resource,
      request,
      currentTime,
    );
    pendingSegmentFetches.set(cacheKey, fetchPromise);
    try {
      const result = await fetchPromise;
      if (result.reusable) {
        return createCachedSegmentResource(resource, result.entry);
      }
      return result.resource;
    } finally {
      if (pendingSegmentFetches.get(cacheKey) === fetchPromise) {
        pendingSegmentFetches.delete(cacheKey);
      }
    }
  }

  async function resolveStoredM3u8Manifest(
    resource: Extract<StoredProxyResource, { kind: "manifest" }> & {
      refreshM3u8Url: string;
      refreshPublicBaseUrl: string;
    },
  ): Promise<PlaybackProxyResource> {
    await assertSafeUpstreamUrl(resource.refreshM3u8Url);
    const upstreamResponse = await fetchUpstream(resource.refreshM3u8Url, {
      headers: resource.refreshUpstreamHeaders,
    });
    const body = await upstreamResponse.text();
    if (upstreamResponse.status >= 400) {
      options.logEvent?.("playback_proxy_upstream_http_error", {
        roomCode: resource.roomCode,
        providerId: resource.providerId,
        resourceKind: resource.kind,
        statusCode: upstreamResponse.status,
        upstreamHost: readUpstreamHost(resource.refreshM3u8Url),
        contentType: upstreamResponse.headers.get("content-type") ?? null,
        result: "upstream_error",
      });
      return {
        statusCode: upstreamResponse.status,
        contentType:
          upstreamResponse.headers.get("content-type") ??
          "application/vnd.apple.mpegurl",
        body,
      };
    }

    const rewritten = rewriteM3u8Manifest(
      resource.refreshPublicBaseUrl,
      resource.roomCode,
      resource.providerId,
      body,
      resource.refreshM3u8Url,
      resource.expiresAt,
      resource.ttlMs,
      resource.refreshUpstreamHeaders,
      resource.m3u8SegmentMappings,
      resource.m3u8PlaylistMappings,
    );
    resource.body = rewritten;
    return {
      contentType: "application/vnd.apple.mpegurl",
      body: rewritten,
    };
  }

  function deleteResourcesWhere(
    shouldDelete: (resource: StoredProxyResource) => boolean,
  ): number {
    let deleted = 0;
    for (const [key, resource] of resources.entries()) {
      if (!shouldDelete(resource)) {
        continue;
      }
      resources.delete(key);
      deleteSegmentCacheWhere((entry) => entry.resourceKey === key);
      deletePendingSegmentFetchesWhere((cacheKey) =>
        cacheKey.startsWith(`${key}\n`),
      );
      deleted += 1;
    }
    return deleted;
  }

  return {
    async resolveResource(request) {
      const resource = resources.get(
        resourceKey(request.kind, request.resourceId),
      );
      const currentTime = now();
      if (!resource || resource.expiresAt <= currentTime) {
        return null;
      }
      refreshResourceExpiry(resource, currentTime);
      if (
        resource.kind === "manifest" &&
        resource.refreshM3u8Url &&
        resource.refreshPublicBaseUrl
      ) {
        return await resolveStoredM3u8Manifest(
          resource as Extract<StoredProxyResource, { kind: "manifest" }> & {
            refreshM3u8Url: string;
            refreshPublicBaseUrl: string;
          },
        );
      }
      if (resource.kind === "segment") {
        recordProxyRequest(resource);
        return await resolveCachedRangedSegmentResource(
          resourceKey(request.kind, request.resourceId),
          resource,
          request,
          currentTime,
        );
      }
      return {
        statusCode: resource.statusCode,
        contentType: resource.contentType,
        body: resource.body,
        headers: resource.headers,
      };
    },

    registerMpdManifest(input) {
      const ttlMs = input.ttlMs ?? defaultTtlMs;
      const expiresAt = now() + ttlMs;
      const manifestId = createResourceId();
      const resourcePublicBaseUrl = getEffectivePublicBaseUrl(
        input.publicBaseUrl,
      );
      const rewrittenManifest = rewriteAbsoluteMediaAttributes(
        resourcePublicBaseUrl,
        input.roomCode,
        input.providerId,
        rewriteBaseUrls(
          resourcePublicBaseUrl,
          input.roomCode,
          input.providerId,
          input.manifest,
          input.manifestUrl,
          expiresAt,
          ttlMs,
          input.upstreamHeaders,
          input.upstreamUrlAlternates,
        ),
        input.manifestUrl,
        expiresAt,
        ttlMs,
        input.upstreamHeaders,
        input.upstreamUrlAlternates,
      );
      resources.set(resourceKey("manifest", manifestId), {
        kind: "manifest",
        roomCode: input.roomCode,
        providerId: input.providerId,
        expiresAt,
        ttlMs,
        contentType: "application/dash+xml",
        body: rewrittenManifest,
      });
      return {
        manifestId,
        manifestUrl: createProxyUrl(
          resourcePublicBaseUrl,
          "manifest",
          manifestId,
        ),
        expiresAt,
      };
    },

    registerM3u8Manifest(input) {
      const ttlMs = input.ttlMs ?? defaultTtlMs;
      const expiresAt = now() + ttlMs;
      const manifestId = createResourceId();
      const resourcePublicBaseUrl = getEffectivePublicBaseUrl(
        input.publicBaseUrl,
      );
      const refreshM3u8Url =
        input.manifestUrl && isLiveM3u8Manifest(input.manifest)
          ? resolveHttpUrl(input.manifestUrl, undefined)
          : null;
      const stableSegmentMappings = refreshM3u8Url
        ? new Map<string, string>()
        : undefined;
      const stablePlaylistMappings = refreshM3u8Url
        ? new Map<string, string>()
        : undefined;
      resources.set(resourceKey("manifest", manifestId), {
        kind: "manifest",
        roomCode: input.roomCode,
        providerId: input.providerId,
        expiresAt,
        ttlMs,
        contentType: "application/vnd.apple.mpegurl",
        body: rewriteM3u8Manifest(
          resourcePublicBaseUrl,
          input.roomCode,
          input.providerId,
          input.manifest,
          input.manifestUrl,
          expiresAt,
          ttlMs,
          input.upstreamHeaders,
          stableSegmentMappings,
          stablePlaylistMappings,
        ),
        ...(refreshM3u8Url
          ? {
              refreshM3u8Url,
              refreshPublicBaseUrl: resourcePublicBaseUrl,
              m3u8SegmentMappings: stableSegmentMappings,
              m3u8PlaylistMappings: stablePlaylistMappings,
              ...(input.upstreamHeaders
                ? { refreshUpstreamHeaders: input.upstreamHeaders }
                : {}),
            }
          : {}),
      });
      return {
        manifestId,
        manifestUrl: createProxyUrl(
          resourcePublicBaseUrl,
          "manifest",
          manifestId,
        ),
        expiresAt,
      };
    },

    registerSegment(input) {
      const ttlMs = input.ttlMs ?? defaultTtlMs;
      const expiresAt = now() + ttlMs;
      const segmentId = setSegmentMapping(
        input.roomCode,
        input.providerId,
        createUpstreamUrls(input.upstreamUrl, input.fallbackUpstreamUrls),
        expiresAt,
        ttlMs,
        input.upstreamHeaders,
      );
      return {
        segmentId,
        segmentUrl: createProxyUrl(
          getEffectivePublicBaseUrl(input.publicBaseUrl),
          "segment",
          segmentId,
        ),
        expiresAt,
      };
    },

    cleanupExpired() {
      const currentTime = now();
      purgeExpiredSegmentCache(currentTime);
      return deleteResourcesWhere(
        (resource) => resource.expiresAt <= currentTime,
      );
    },

    clearRoom(roomCode) {
      return deleteResourcesWhere((resource) => resource.roomCode === roomCode);
    },

    clearProviderAuth(roomCode, providerId) {
      return deleteResourcesWhere(
        (resource) =>
          resource.roomCode === roomCode && resource.providerId === providerId,
      );
    },
  };
}
