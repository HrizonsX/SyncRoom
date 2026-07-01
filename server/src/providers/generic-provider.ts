import { createHash } from "node:crypto";
import {
  createUnavailableProviderAuth,
  type ProviderMatchedUrl,
  type ProviderParseResult,
  type ProviderPlayableItem,
  type VideoProviderAdapter,
} from "./video-provider.js";
import type {
  MediaExtractorCandidate,
  MediaExtractorClient,
} from "./media-extractor-client.js";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function createSourceId(url: string): string {
  return `generic:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

function normalizeUrl(value: string): string | null {
  if (!isHttpUrl(value)) {
    return null;
  }
  return new URL(value).toString();
}

function toProviderCandidate(candidate: MediaExtractorCandidate) {
  return {
    id: candidate.id,
    sourceType: candidate.sourceType,
    url: candidate.url,
    ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
    ...(candidate.codecs ? { codecs: candidate.codecs } : {}),
    ...(candidate.qualityLabel ? { qualityLabel: candidate.qualityLabel } : {}),
    ...(candidate.width !== undefined ? { width: candidate.width } : {}),
    ...(candidate.height !== undefined ? { height: candidate.height } : {}),
    ...(candidate.bandwidth !== undefined
      ? { bandwidth: candidate.bandwidth }
      : {}),
    ...(candidate.upstreamHeaders
      ? { upstreamHeaders: candidate.upstreamHeaders }
      : {}),
  };
}

export function createGenericProvider(options: {
  extractorClient: MediaExtractorClient;
}): VideoProviderAdapter {
  return {
    id: "generic",
    auth: createUnavailableProviderAuth("generic"),
    matchUrl(value): ProviderMatchedUrl | null {
      const normalizedUrl = normalizeUrl(value);
      if (!normalizedUrl) {
        return null;
      }
      return {
        providerId: "generic",
        kind: "ugc",
        rawId: createSourceId(normalizedUrl),
        page: null,
        normalizedUrl,
        requiresResolution: false,
      };
    },
    async parse(input): Promise<ProviderParseResult> {
      const extraction = await options.extractorClient.extract({
        url: input.matchedUrl.normalizedUrl,
        platform: "generic",
      });
      const candidates = extraction.candidates.map(toProviderCandidate);
      const item: ProviderPlayableItem = {
        item: {
          itemId: "default",
          title: extraction.title,
          kind: extraction.isLive ? "live" : "part",
        },
        candidates,
        ...(candidates[0] ? { defaultCandidateId: candidates[0].id } : {}),
      };
      return {
        providerId: "generic",
        sourceId: input.matchedUrl.rawId,
        sourceUrl: extraction.sourceUrl,
        title: extraction.title,
        items: [item],
      };
    },
  };
}
