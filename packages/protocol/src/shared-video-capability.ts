import { normalizeSharedVideoUrl } from "./video-ref.js";
import {
  PLAYBACK_SOURCE_TYPES,
  VIDEO_PROVIDER_IDS,
  type PlaybackSourceType,
  type VideoProviderId,
} from "./types/domain.js";
import { isRecord } from "./guards/primitives.js";

export type SharedVideoProviderPlaybackMode =
  | "proxy"
  | "direct-shared"
  | "direct-private";

export type SharedVideoProviderPlaybackUnavailableReason =
  | "missing_shared_video"
  | "missing_provider_descriptor"
  | "missing_playback_candidates"
  | "unsupported_candidate_source";

export interface SharedVideoClientCapabilities {
  page: {
    canOpen: boolean;
    normalizedUrl?: string;
  };
  provider: {
    resolved: boolean;
    canPlayInWebRoom: boolean;
    candidateCount: number;
    sourceTypes: PlaybackSourceType[];
    providerId?: VideoProviderId;
    mode?: SharedVideoProviderPlaybackMode;
    unavailableReason?: SharedVideoProviderPlaybackUnavailableReason;
  };
}

// Keep page-opening and web-room playback separate so one client does not infer
// support from payload fields that only another client knows how to consume.
const supportedSourceTypes = new Set<string>(PLAYBACK_SOURCE_TYPES);
const supportedProviderIds = new Set<string>(VIDEO_PROVIDER_IDS);

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getProviderId(value: unknown): VideoProviderId | undefined {
  return typeof value === "string" && supportedProviderIds.has(value)
    ? (value as VideoProviderId)
    : undefined;
}

function getPlaybackSourceType(value: unknown): PlaybackSourceType | undefined {
  return typeof value === "string" && supportedSourceTypes.has(value)
    ? (value as PlaybackSourceType)
    : undefined;
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
}

function getPlaybackMode(
  policy: unknown,
): SharedVideoProviderPlaybackMode | undefined {
  if (!isRecord(policy)) {
    return undefined;
  }
  if (policy.proxy === true) {
    return "proxy";
  }
  return policy.shared === true ? "direct-shared" : "direct-private";
}

function getSupportedSourceTypes(provider: Record<string, unknown>): {
  candidateCount: number;
  sourceTypes: PlaybackSourceType[];
} {
  const candidates = Array.isArray(provider.candidates)
    ? provider.candidates.filter(isRecord)
    : [];
  const sourceTypes: PlaybackSourceType[] = [];
  for (const candidate of candidates) {
    const sourceType = getPlaybackSourceType(candidate.sourceType);
    if (!sourceType || !isHttpUrl(candidate.url)) {
      continue;
    }
    if (!sourceTypes.includes(sourceType)) {
      sourceTypes.push(sourceType);
    }
  }
  return {
    candidateCount: candidates.length,
    sourceTypes,
  };
}

export function describeSharedVideoCapabilities(
  value: unknown,
): SharedVideoClientCapabilities {
  if (!isRecord(value)) {
    return {
      page: { canOpen: false },
      provider: {
        resolved: false,
        canPlayInWebRoom: false,
        candidateCount: 0,
        sourceTypes: [],
        unavailableReason: "missing_shared_video",
      },
    };
  }

  const normalizedUrl = normalizeSharedVideoUrl(getString(value.url));
  const provider = isRecord(value.provider) ? value.provider : null;
  if (!provider) {
    return {
      page: {
        canOpen: normalizedUrl !== null,
        ...(normalizedUrl ? { normalizedUrl } : {}),
      },
      provider: {
        resolved: false,
        canPlayInWebRoom: false,
        candidateCount: 0,
        sourceTypes: [],
        unavailableReason: "missing_provider_descriptor",
      },
    };
  }

  const { candidateCount, sourceTypes } = getSupportedSourceTypes(provider);
  const canPlayInWebRoom = sourceTypes.length > 0;
  const providerId = getProviderId(provider.providerId);
  const mode = getPlaybackMode(provider.policy);
  return {
    page: {
      canOpen: normalizedUrl !== null,
      ...(normalizedUrl ? { normalizedUrl } : {}),
    },
    provider: {
      resolved: true,
      canPlayInWebRoom,
      candidateCount,
      sourceTypes,
      ...(providerId ? { providerId } : {}),
      ...(mode ? { mode } : {}),
      ...(canPlayInWebRoom
        ? {}
        : {
            unavailableReason:
              candidateCount === 0
                ? "missing_playback_candidates"
                : "unsupported_candidate_source",
          }),
    },
  };
}

export function canOpenSharedVideoPage(value: unknown): boolean {
  return describeSharedVideoCapabilities(value).page.canOpen;
}

export function canPlaySharedVideoInWebRoom(value: unknown): boolean {
  return describeSharedVideoCapabilities(value).provider.canPlayInWebRoom;
}
