export type PlaybackSourceType = "mpd" | "m3u8" | "mp4" | "flv" | "ts";
export type PlaybackEngine = "shaka" | "native" | "mpegts";
export type PlaybackStartupStage =
  | "manifest"
  | "segment"
  | "decode"
  | "network"
  | "unknown";

export type PlaybackCandidate = {
  id: string;
  sourceType: string;
  url: string;
  codecs?: string;
  qualityLabel?: string;
  default?: boolean;
};

export type PlaybackAdapterSelection = {
  engine: PlaybackEngine;
  sourceType: PlaybackSourceType;
};

export type PlaybackSource = PlaybackAdapterSelection & {
  url: string;
  candidateId?: string;
  isLive?: boolean;
};

export type PlaybackStartupError = {
  code: "direct_playback_failed" | "unsupported_source";
  stage: PlaybackStartupStage;
  message: string;
};

const PLAYBACK_ENGINE_BY_SOURCE_TYPE = {
  mpd: "shaka",
  m3u8: "shaka",
  mp4: "native",
  flv: "mpegts",
  ts: "mpegts",
} as const satisfies Record<PlaybackSourceType, PlaybackEngine>;

function isSupportedSourceType(value: string): value is PlaybackSourceType {
  return value in PLAYBACK_ENGINE_BY_SOURCE_TYPE;
}

function isLikelyHevc(candidate: PlaybackCandidate): boolean {
  return /(?:hev1|hvc1|hevc|h265)/i.test(candidate.codecs ?? "");
}

function isLikelyAv1(candidate: PlaybackCandidate): boolean {
  return /(?:av01|av1)/i.test(candidate.codecs ?? "");
}

function isLikelyAvc(candidate: PlaybackCandidate): boolean {
  return /(?:avc1|avc3|avc|h264)/i.test(candidate.codecs ?? "");
}

function isLikelyUnsupportedCodec(candidate: PlaybackCandidate): boolean {
  return isLikelyHevc(candidate) || isLikelyAv1(candidate);
}

/**
 * 根据解析结果的 sourceType 选择前端播放引擎，避免 UI 层直接判断格式细节。
 */
export function selectPlaybackAdapter(input: {
  sourceType: string;
}): PlaybackAdapterSelection {
  if (!isSupportedSourceType(input.sourceType)) {
    throw new Error(`unsupported_source:${input.sourceType}`);
  }

  return {
    sourceType: input.sourceType,
    engine: PLAYBACK_ENGINE_BY_SOURCE_TYPE[input.sourceType],
  };
}

/**
 * 从 Provider 返回的清晰度候选里挑选默认播放项，优先保留显式默认和浏览器更稳的 AVC。
 */
export function choosePreferredPlaybackCandidate(
  candidates: PlaybackCandidate[],
): PlaybackCandidate | null {
  const supportedCandidates = candidates.filter((candidate) =>
    isSupportedSourceType(candidate.sourceType),
  );
  if (supportedCandidates.length === 0) {
    return null;
  }

  const explicitDefault = supportedCandidates.find(
    (candidate) => candidate.default === true,
  );
  if (explicitDefault) {
    return explicitDefault;
  }

  return (
    supportedCandidates.find(isLikelyAvc) ??
    supportedCandidates.find(
      (candidate) => !isLikelyUnsupportedCodec(candidate),
    ) ??
    supportedCandidates[0] ??
    null
  );
}

export function createPlaybackStartupError(
  stage: PlaybackStartupStage,
  message: string,
): PlaybackStartupError {
  return {
    code: stage === "decode" ? "unsupported_source" : "direct_playback_failed",
    stage,
    message,
  };
}

export async function loadShakaPlayer(): Promise<unknown> {
  return import("shaka-player");
}

export async function loadMpegtsPlayer(): Promise<unknown> {
  return import("mpegts.js");
}
