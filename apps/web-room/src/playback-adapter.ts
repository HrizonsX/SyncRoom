export type PlaybackSourceType = "mpd" | "m3u8" | "mp4";
export type PlaybackEngine = "shaka" | "native";
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
  isLive?: boolean;
};

export type PlaybackStartupError = {
  code: "direct_playback_failed" | "unsupported_source";
  stage: PlaybackStartupStage;
  message: string;
};

function isSupportedSourceType(value: string): value is PlaybackSourceType {
  return value === "mpd" || value === "m3u8" || value === "mp4";
}

function isLikelyHevc(candidate: PlaybackCandidate): boolean {
  return /(?:hev1|hvc1)/i.test(candidate.codecs ?? "");
}

function isLikelyAvc(candidate: PlaybackCandidate): boolean {
  return /(?:avc1|avc3)/i.test(candidate.codecs ?? "");
}

export function selectPlaybackAdapter(input: {
  sourceType: string;
}): PlaybackAdapterSelection {
  if (!isSupportedSourceType(input.sourceType)) {
    throw new Error(`unsupported_source:${input.sourceType}`);
  }

  return {
    sourceType: input.sourceType,
    engine: input.sourceType === "mp4" ? "native" : "shaka",
  };
}

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
    (candidate) => candidate.default === true && !isLikelyHevc(candidate),
  );
  if (explicitDefault) {
    return explicitDefault;
  }

  return (
    supportedCandidates.find(isLikelyAvc) ??
    supportedCandidates.find((candidate) => !isLikelyHevc(candidate)) ??
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
