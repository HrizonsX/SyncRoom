import {
  isExplicitControlSyncIntent,
  type PlaybackState,
} from "@syncroom/protocol";
import type { PlaybackAuthority } from "./types.js";

export type PlaybackAcceptanceDecision =
  | { decision: "accept"; reason: "same-actor" | "no-current" | "default" }
  | {
      decision: "ignore-as-follow";
      reason:
        | "authority-window-follow"
        | "live-non-explicit-stop"
        | "unchanged-ratechange";
    }
  | {
      decision: "ignore-stale-like";
      reason: "timeline-regression";
    };

export function decidePlaybackAcceptance(args: {
  currentPlayback: PlaybackState | null;
  authority: PlaybackAuthority | null;
  incomingPlayback: PlaybackState;
  currentTime: number;
  isLivePlayback?: boolean;
}): PlaybackAcceptanceDecision {
  if (!args.currentPlayback) {
    return { decision: "accept", reason: "no-current" };
  }

  if (
    args.incomingPlayback.syncIntent === "explicit-ratechange" &&
    Math.abs(
      normalizePlaybackRate(args.incomingPlayback.playbackRate) -
        normalizePlaybackRate(args.currentPlayback.playbackRate),
    ) <= 0.01
  ) {
    // A rate control that repeats the current value is not a timeline update.
    // Ignoring it also contains buggy or stale clients that emit the request
    // whenever their controls are recreated.
    return {
      decision: "ignore-as-follow",
      reason: "unchanged-ratechange",
    };
  }

  const currentIsStopLike =
    args.currentPlayback.playState === "paused" ||
    args.currentPlayback.playState === "buffering";
  const incomingIsPlaying = args.incomingPlayback.playState === "playing";
  const incomingIsStopLike =
    args.incomingPlayback.playState === "paused" ||
    args.incomingPlayback.playState === "buffering";
  const incomingIsExplicitControl = isExplicitControlSyncIntent(
    args.incomingPlayback.syncIntent,
  );
  const authority = args.authority;
  const withinAuthorityWindow =
    authority !== null && args.currentTime < authority.until;
  const authorityPrefersPlaybackContinuity =
    authority?.kind === "play" ||
    authority?.kind === "seek" ||
    authority?.kind === "ratechange" ||
    authority?.kind === "share";
  const authorityOwnsCurrentPlayback =
    authority !== null &&
    args.currentPlayback.actorId === authority.actorId &&
    args.currentPlayback.playState === "playing";
  const effectiveCurrentTime =
    args.isLivePlayback === true
      ? args.currentPlayback.currentTime
      : projectPlaybackTimeline(args.currentPlayback, args.currentTime);
  const closeInTimeline =
    Math.abs(args.incomingPlayback.currentTime - effectiveCurrentTime) < 1.2;
  const nonAdvancingStopLike =
    args.incomingPlayback.currentTime <= effectiveCurrentTime + 0.15;
  const driftsBackBehindCurrent =
    args.incomingPlayback.currentTime + 0.6 < effectiveCurrentTime;
  const sameActorWeakNetworkResumeBacktrack =
    args.currentPlayback.actorId === args.incomingPlayback.actorId &&
    args.incomingPlayback.currentTime + 1 < effectiveCurrentTime;
  const materiallyBackBehindCurrent =
    args.incomingPlayback.currentTime + 2.5 < effectiveCurrentTime;

  if (
    args.isLivePlayback === true &&
    !incomingIsExplicitControl &&
    args.currentPlayback.playState === "playing" &&
    incomingIsStopLike
  ) {
    // Live players can emit pause/buffering while they reload manifests or
    // recover from a local stall. Only explicit controls may turn the shared
    // live room from playing into stopped.
    return {
      decision: "ignore-as-follow",
      reason: "live-non-explicit-stop",
    };
  }

  if (
    !incomingIsExplicitControl &&
    args.isLivePlayback !== true &&
    materiallyBackBehindCurrent
  ) {
    // Freshly joined or refreshed VOD clients can emit startup media events at
    // 0s before they have followed the room state. Treat those non-explicit
    // events as stale so they cannot pull everyone else back to the beginning.
    return {
      decision: "ignore-stale-like",
      reason: "timeline-regression",
    };
  }

  if (
    !incomingIsExplicitControl &&
    incomingIsPlaying &&
    sameActorWeakNetworkResumeBacktrack
  ) {
    // A buffering follower can emit a late play/resume event from the old
    // position. Keep small same-actor jitter valid, but do not let a stale
    // resume pull the room behind the projected timeline.
    return {
      decision: "ignore-stale-like",
      reason: "timeline-regression",
    };
  }

  if (args.currentPlayback.actorId === args.incomingPlayback.actorId) {
    return { decision: "accept", reason: "same-actor" };
  }

  if (
    !incomingIsExplicitControl &&
    withinAuthorityWindow &&
    authority.actorId !== args.incomingPlayback.actorId &&
    incomingIsPlaying &&
    (currentIsStopLike ||
      closeInTimeline ||
      (authorityPrefersPlaybackContinuity && authorityOwnsCurrentPlayback))
  ) {
    return {
      decision: "ignore-as-follow",
      reason: "authority-window-follow",
    };
  }

  if (
    !incomingIsExplicitControl &&
    withinAuthorityWindow &&
    authority.actorId !== args.incomingPlayback.actorId &&
    authorityPrefersPlaybackContinuity &&
    incomingIsStopLike &&
    !currentIsStopLike &&
    closeInTimeline &&
    nonAdvancingStopLike
  ) {
    return {
      decision: "ignore-as-follow",
      reason: "authority-window-follow",
    };
  }

  if (
    !incomingIsExplicitControl &&
    incomingIsPlaying &&
    driftsBackBehindCurrent
  ) {
    return {
      decision: "ignore-stale-like",
      reason: "timeline-regression",
    };
  }

  return { decision: "accept", reason: "default" };
}

function normalizePlaybackRate(playbackRate: number): number {
  return Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
}

function projectPlaybackTimeline(
  playback: PlaybackState,
  currentTime: number,
): number {
  if (playback.playState !== "playing") {
    return playback.currentTime;
  }

  // VOD progress is not written to the room every second. Project the stored
  // server-stamped position before judging whether a refreshed client is
  // sending an old startup position such as 0s.
  const elapsedSeconds = Math.max(
    0,
    (currentTime - playback.serverTime) / 1000,
  );
  return (
    playback.currentTime +
    elapsedSeconds * normalizePlaybackRate(playback.playbackRate)
  );
}
