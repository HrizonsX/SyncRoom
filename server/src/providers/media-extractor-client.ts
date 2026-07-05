import {
  PLAYBACK_SOURCE_TYPES,
  type PlaybackSourceType,
} from "@syncroom/protocol";
import { VideoProviderError } from "./video-provider.js";

type JsonObject = Record<string, unknown>;

export type MediaExtractorCandidate = {
  id: string;
  sourceType: PlaybackSourceType;
  url: string;
  mimeType?: string;
  codecs?: string;
  qualityLabel?: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  upstreamHeaders?: Record<string, string>;
};

export type MediaExtractorResult = {
  title: string;
  sourceUrl: string;
  isLive: boolean;
  candidates: MediaExtractorCandidate[];
};

export type MediaExtractorClient = {
  extract: (input: {
    url: string;
    platform: string;
    headers?: Record<string, string>;
  }) => Promise<MediaExtractorResult>;
};

export type MediaExtractorClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isPlaybackSourceType(value: unknown): value is PlaybackSourceType {
  return (
    typeof value === "string" &&
    (PLAYBACK_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

function readOptionalString(
  target: JsonObject,
  key: string,
): string | undefined {
  return typeof target[key] === "string" ? target[key] : undefined;
}

function readOptionalNonNegativeNumber(
  target: JsonObject,
  key: string,
): number | undefined {
  const value = target[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function readStringHeaders(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (typeof headerValue === "string") {
      headers[name] = headerValue;
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function readCandidate(value: unknown): MediaExtractorCandidate | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    !isPlaybackSourceType(value.sourceType) ||
    !isHttpUrl(value.url)
  ) {
    return null;
  }
  return {
    id: value.id,
    sourceType: value.sourceType,
    url: value.url,
    ...(readOptionalString(value, "mimeType")
      ? { mimeType: readOptionalString(value, "mimeType") }
      : {}),
    ...(readOptionalString(value, "codecs")
      ? { codecs: readOptionalString(value, "codecs") }
      : {}),
    ...(readOptionalString(value, "qualityLabel")
      ? { qualityLabel: readOptionalString(value, "qualityLabel") }
      : {}),
    ...(readOptionalNonNegativeNumber(value, "width") !== undefined
      ? { width: readOptionalNonNegativeNumber(value, "width") }
      : {}),
    ...(readOptionalNonNegativeNumber(value, "height") !== undefined
      ? { height: readOptionalNonNegativeNumber(value, "height") }
      : {}),
    ...(readOptionalNonNegativeNumber(value, "bandwidth") !== undefined
      ? { bandwidth: readOptionalNonNegativeNumber(value, "bandwidth") }
      : {}),
    ...(readStringHeaders(value.upstreamHeaders)
      ? { upstreamHeaders: readStringHeaders(value.upstreamHeaders) }
      : {}),
  };
}

function readExtractorResult(payload: unknown): MediaExtractorResult {
  if (
    !isRecord(payload) ||
    typeof payload.title !== "string" ||
    !isHttpUrl(payload.sourceUrl) ||
    !Array.isArray(payload.candidates) ||
    payload.candidates.length === 0
  ) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Extractor response was invalid.",
      "extractor_invalid_response",
    );
  }
  const candidates = payload.candidates
    .map(readCandidate)
    .filter((candidate): candidate is MediaExtractorCandidate =>
      Boolean(candidate),
    );
  if (candidates.length === 0) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Extractor response did not include playable candidates.",
      "extractor_invalid_response",
    );
  }
  return {
    title: payload.title,
    sourceUrl: payload.sourceUrl,
    isLive: payload.isLive === true,
    candidates,
  };
}

function resolveExtractUrl(baseUrl: string): string {
  return new URL("/extract", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
    .toString()
    .replace(/\/$/, "");
}

function readExtractorErrorReason(payload: unknown, status: number): string {
  if (isRecord(payload) && payload.error === "unsupported_url") {
    return "extractor_unsupported_url";
  }
  if (isRecord(payload) && payload.error === "no_playable_candidates") {
    return "extractor_no_playable_candidates";
  }
  if (isRecord(payload) && payload.error === "auth_required") {
    return "extractor_auth_required";
  }
  return `extractor_http_${status}`;
}

async function requestExtractor(
  fetchImpl: typeof fetch,
  extractUrl: string,
  input: Parameters<MediaExtractorClient["extract"]>[0],
): Promise<Response> {
  try {
    return await fetchImpl(extractUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: input.url,
        platform: input.platform,
        ...(input.headers ? { headers: input.headers } : {}),
      }),
    });
  } catch {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Extractor request failed.",
      "extractor_unavailable",
    );
  }
}

async function readExtractorPayload(response: Response): Promise<unknown> {
  const body = await response.text();
  if (body.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    if (!response.ok) {
      // External extractor deployments may return plain-text error bodies.
      // Preserve the HTTP failure as a safe provider error instead of letting a
      // JSON parse exception escape as a 500 from the provider router.
      return null;
    }
    throw new VideoProviderError(
      "provider_parse_failed",
      "Extractor response was invalid.",
      "extractor_invalid_response",
    );
  }
}

export function createMediaExtractorClient(
  options: MediaExtractorClientOptions,
): MediaExtractorClient {
  const fetchImpl = options.fetch ?? fetch;
  const extractUrl = resolveExtractUrl(options.baseUrl);
  return {
    async extract(input) {
      const response = await requestExtractor(fetchImpl, extractUrl, input);
      const payload = await readExtractorPayload(response);
      if (!response.ok) {
        throw new VideoProviderError(
          "provider_parse_failed",
          "Extractor request failed.",
          readExtractorErrorReason(payload, response.status),
        );
      }
      return readExtractorResult(payload);
    },
  };
}
