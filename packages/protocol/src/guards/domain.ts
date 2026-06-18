import type {
  PlaybackProxyPolicy,
  PlaybackSourceType,
  ProviderItemKind,
  ProviderItemSelection,
  ProviderPlaybackCandidate,
  ProviderPlaybackDescriptor,
  VideoProviderId,
} from "../types/domain.js";
import {
  PLAYBACK_SOURCE_TYPES,
  PROVIDER_ITEM_KINDS,
  VIDEO_PROVIDER_IDS,
} from "../types/domain.js";
import {
  isFiniteNumber,
  isNonNegativeInteger,
  isRecord,
  isString,
} from "./primitives.js";

const TITLE_MAX_LENGTH = 128;
const ID_MAX_LENGTH = 128;
const URL_MAX_LENGTH = 2048;
const MIME_MAX_LENGTH = 128;
const CODECS_MAX_LENGTH = 256;
const QUALITY_LABEL_MAX_LENGTH = 64;
const MAX_PLAYBACK_CANDIDATES = 16;

function isBoundedString(value: unknown, maxLength: number): value is string {
  return isString(value) && value.length <= maxLength;
}

function isNonEmptyBoundedString(
  value: unknown,
  maxLength: number,
): value is string {
  return isBoundedString(value, maxLength) && value.trim().length > 0;
}

function isOptionalBoundedString(
  value: unknown,
  maxLength: number,
): value is string | undefined {
  return value === undefined || isBoundedString(value, maxLength);
}

function isOptionalNonNegativeNumber(
  value: unknown,
): value is number | undefined {
  return value === undefined || (isFiniteNumber(value) && value >= 0);
}

function isHttpUrl(value: unknown): value is string {
  if (!isNonEmptyBoundedString(value, URL_MAX_LENGTH)) {
    return false;
  }

  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch {
    return false;
  }
}

export function isVideoProviderId(value: unknown): value is VideoProviderId {
  return (
    isString(value) && (VIDEO_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

export function isPlaybackSourceType(
  value: unknown,
): value is PlaybackSourceType {
  return (
    isString(value) &&
    (PLAYBACK_SOURCE_TYPES as readonly string[]).includes(value)
  );
}

export function isProviderItemKind(value: unknown): value is ProviderItemKind {
  return (
    isString(value) &&
    (PROVIDER_ITEM_KINDS as readonly string[]).includes(value)
  );
}

export function isPlaybackProxyPolicy(
  value: unknown,
): value is PlaybackProxyPolicy {
  return (
    isRecord(value) &&
    typeof value.proxy === "boolean" &&
    typeof value.shared === "boolean"
  );
}

export function isProviderItemSelection(
  value: unknown,
): value is ProviderItemSelection {
  return (
    isRecord(value) &&
    isNonEmptyBoundedString(value.itemId, ID_MAX_LENGTH) &&
    isNonEmptyBoundedString(value.title, TITLE_MAX_LENGTH) &&
    isProviderItemKind(value.kind) &&
    isOptionalBoundedString(value.aid, ID_MAX_LENGTH) &&
    isOptionalBoundedString(value.bvid, ID_MAX_LENGTH) &&
    isOptionalBoundedString(value.cid, ID_MAX_LENGTH) &&
    isOptionalBoundedString(value.epId, ID_MAX_LENGTH) &&
    isOptionalBoundedString(value.seasonId, ID_MAX_LENGTH) &&
    isOptionalBoundedString(value.roomId, ID_MAX_LENGTH) &&
    (value.durationSeconds === undefined ||
      isNonNegativeInteger(value.durationSeconds))
  );
}

export function isProviderPlaybackCandidate(
  value: unknown,
): value is ProviderPlaybackCandidate {
  return (
    isRecord(value) &&
    isNonEmptyBoundedString(value.id, ID_MAX_LENGTH) &&
    isPlaybackSourceType(value.sourceType) &&
    isHttpUrl(value.url) &&
    isOptionalBoundedString(value.mimeType, MIME_MAX_LENGTH) &&
    isOptionalBoundedString(value.codecs, CODECS_MAX_LENGTH) &&
    isOptionalBoundedString(value.qualityLabel, QUALITY_LABEL_MAX_LENGTH) &&
    isOptionalNonNegativeNumber(value.width) &&
    isOptionalNonNegativeNumber(value.height) &&
    isOptionalNonNegativeNumber(value.bandwidth) &&
    (value.default === undefined || typeof value.default === "boolean")
  );
}

export function isProviderPlaybackDescriptor(
  value: unknown,
): value is ProviderPlaybackDescriptor {
  if (
    !isRecord(value) ||
    !isVideoProviderId(value.providerId) ||
    !isNonEmptyBoundedString(value.sourceId, ID_MAX_LENGTH) ||
    !isHttpUrl(value.sourceUrl) ||
    !isNonEmptyBoundedString(value.title, TITLE_MAX_LENGTH) ||
    !isProviderItemSelection(value.item) ||
    !isPlaybackProxyPolicy(value.policy) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length === 0 ||
    value.candidates.length > MAX_PLAYBACK_CANDIDATES ||
    !value.candidates.every((candidate) =>
      isProviderPlaybackCandidate(candidate),
    ) ||
    !isOptionalBoundedString(value.defaultCandidateId, ID_MAX_LENGTH)
  ) {
    return false;
  }

  return (
    value.defaultCandidateId === undefined ||
    value.candidates.some(
      (candidate) => candidate.id === value.defaultCandidateId,
    )
  );
}
