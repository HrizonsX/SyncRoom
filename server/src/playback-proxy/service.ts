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
  metricsCollector?: Pick<MetricsCollector, "recordProxyTraffic">;
  logEvent?: LogEvent;
  resolveHostname?: (hostname: string) => Promise<string[]>;
  createResourceId?: () => string;
  now?: () => number;
  defaultTtlMs?: number;
};

type StoredProxyResource =
  | ({
      kind: "manifest";
      roomCode: string;
      providerId: string;
      expiresAt: number;
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
    };

const DEFAULT_PROXY_RESOURCE_TTL_MS = 10 * 60_000;

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
  const publicBaseUrl = normalizePublicBaseUrl(options.publicBaseUrl);
  const fetchUpstream = options.fetch ?? fetch;
  const resolveHostname = options.resolveHostname ?? defaultResolveHostname;
  const createResourceId = options.createResourceId ?? (() => randomUUID());
  const now = options.now ?? Date.now;
  const defaultTtlMs = options.defaultTtlMs ?? DEFAULT_PROXY_RESOURCE_TTL_MS;

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
    upstreamHeaders: Record<string, string> | undefined,
    stableMappings?: Map<string, string>,
  ): string {
    const stableMappingKey = stableMappings
      ? createStableSegmentMappingKey(upstreamUrls, upstreamHeaders)
      : undefined;
    const existingSegmentId = stableMappingKey
      ? stableMappings?.get(stableMappingKey)
      : undefined;
    if (
      existingSegmentId &&
      resources.has(resourceKey("segment", existingSegmentId))
    ) {
      return existingSegmentId;
    }

    const segmentId = createResourceId();
    resources.set(resourceKey("segment", segmentId), {
      kind: "segment",
      roomCode,
      providerId,
      upstreamUrls,
      upstreamHeaders,
      expiresAt,
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
    if (
      existingManifestId &&
      resources.has(resourceKey("manifest", existingManifestId))
    ) {
      return existingManifestId;
    }

    const manifestId = createResourceId();
    resources.set(resourceKey("manifest", manifestId), {
      kind: "manifest",
      roomCode,
      providerId,
      expiresAt,
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
      deleted += 1;
    }
    return deleted;
  }

  return {
    async resolveResource(request) {
      const resource = resources.get(
        resourceKey(request.kind, request.resourceId),
      );
      if (!resource || resource.expiresAt <= now()) {
        return null;
      }
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
          if (upstreamResponse.status < 400) {
            break;
          }
        }
        if (!upstreamResponse) {
          return null;
        }
        if (upstreamResponse.status >= 400) {
          options.logEvent?.("playback_proxy_upstream_http_error", {
            roomCode: resource.roomCode,
            providerId: resource.providerId,
            resourceKind: resource.kind,
            statusCode: upstreamResponse.status,
            upstreamHost: readUpstreamHost(upstreamUrl),
            contentType: upstreamResponse.headers.get("content-type") ?? null,
            result: "upstream_error",
          });
        }
        const body =
          request.method === "HEAD"
            ? new Uint8Array()
            : upstreamResponse.body
              ? createMeteredStream(upstreamResponse.body, (bytes) => {
                  options.metricsCollector?.recordProxyTraffic({
                    roomCode: resource.roomCode,
                    providerId: resource.providerId,
                    bytes,
                  });
                })
              : new Uint8Array();
        return {
          statusCode: upstreamResponse.status,
          contentType:
            upstreamResponse.headers.get("content-type") ??
            "application/octet-stream",
          body,
          headers: copyUpstreamResponseHeaders(upstreamResponse.headers),
        };
      }
      return {
        statusCode: resource.statusCode,
        contentType: resource.contentType,
        body: resource.body,
        headers: resource.headers,
      };
    },

    registerMpdManifest(input) {
      const expiresAt = now() + (input.ttlMs ?? defaultTtlMs);
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
          input.upstreamHeaders,
          input.upstreamUrlAlternates,
        ),
        input.manifestUrl,
        expiresAt,
        input.upstreamHeaders,
        input.upstreamUrlAlternates,
      );
      resources.set(resourceKey("manifest", manifestId), {
        kind: "manifest",
        roomCode: input.roomCode,
        providerId: input.providerId,
        expiresAt,
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
      const expiresAt = now() + (input.ttlMs ?? defaultTtlMs);
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
        contentType: "application/vnd.apple.mpegurl",
        body: rewriteM3u8Manifest(
          resourcePublicBaseUrl,
          input.roomCode,
          input.providerId,
          input.manifest,
          input.manifestUrl,
          expiresAt,
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
      const expiresAt = now() + (input.ttlMs ?? defaultTtlMs);
      const segmentId = setSegmentMapping(
        input.roomCode,
        input.providerId,
        createUpstreamUrls(input.upstreamUrl, input.fallbackUpstreamUrls),
        expiresAt,
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
