import {
  isExplicitControlSyncIntent,
  type PlaybackBufferReport,
  type PlaybackState,
  type SharedVideo,
} from "@syncroom/protocol";
import { clonePlaybackSyncState } from "./room-store.js";
import type { PersistedRoom, PlaybackAuthority } from "./types.js";

export const PLAYBACK_BUFFER_HOLD_MAX_MS = 10_000;
// Ready events only mean playback can start. Wait mode requires a small
// buffered window so resumed members do not immediately stall again.
export const PLAYBACK_READY_BUFFER_AHEAD_SECONDS = 3;

export function isLiveSharedVideo(video: SharedVideo | null): boolean {
  return video?.provider?.item.kind === "live";
}

function isStopLikePlayback(playback: PlaybackState): boolean {
  return playback.playState === "paused" || playback.playState === "buffering";
}

function uniqueMemberIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids));
}

function removeMemberId(ids: readonly string[], memberId: string): string[] {
  return ids.filter((id) => id !== memberId);
}

export function isSamePlaybackSyncState(
  left: PersistedRoom["playbackSync"],
  right: PersistedRoom["playbackSync"],
): boolean {
  return (
    JSON.stringify(clonePlaybackSyncState(left)) ===
    JSON.stringify(clonePlaybackSyncState(right))
  );
}

export function updatePlaybackSyncForBufferReport(args: {
  room: PersistedRoom;
  memberId: string;
  report: PlaybackBufferReport;
  currentTime: number;
}): PersistedRoom["playbackSync"] {
  const playbackSync = clonePlaybackSyncState(args.room.playbackSync);
  const wasMemberBuffering = playbackSync.bufferingMemberIds.includes(
    args.memberId,
  );
  const hasEnoughReadyBuffer =
    args.report.state === "ready" &&
    (args.report.bufferAheadSeconds ?? 0) >=
      PLAYBACK_READY_BUFFER_AHEAD_SECONDS;
  if (
    playbackSync.hold.active &&
    typeof playbackSync.hold.deadlineAt === "number" &&
    playbackSync.hold.deadlineAt <= args.currentTime
  ) {
    playbackSync.hold = { active: false };
  }

  playbackSync.bufferingMemberIds =
    args.report.state === "buffering"
      ? uniqueMemberIds([...playbackSync.bufferingMemberIds, args.memberId])
      : hasEnoughReadyBuffer
        ? removeMemberId(playbackSync.bufferingMemberIds, args.memberId)
        : playbackSync.bufferingMemberIds;

  const shouldHoldRoom =
    playbackSync.strategy === "wait" &&
    !isLiveSharedVideo(args.room.sharedVideo) &&
    args.room.playback?.playState === "playing" &&
    args.report.state === "buffering" &&
    !wasMemberBuffering;
  if (shouldHoldRoom && !playbackSync.hold.active) {
    // Hold only on the first buffering report for one incident. Otherwise a
    // continuously stalled member can immediately restart an expired hold and
    // keep the room stuck on "waiting".
    playbackSync.hold = {
      active: true,
      reasonMemberId: args.memberId,
      startedAt: args.currentTime,
      deadlineAt: args.currentTime + PLAYBACK_BUFFER_HOLD_MAX_MS,
    };
  }

  if (
    args.report.state === "ready" &&
    hasEnoughReadyBuffer &&
    playbackSync.hold.active &&
    playbackSync.bufferingMemberIds.length === 0
  ) {
    playbackSync.hold = { active: false };
  }

  return playbackSync;
}

export function isPlaybackHoldActive(
  playbackSync: PersistedRoom["playbackSync"],
  currentTime: number,
): boolean {
  const hold = playbackSync?.hold;
  if (hold?.active !== true) {
    return false;
  }
  return typeof hold.deadlineAt !== "number" || hold.deadlineAt > currentTime;
}

export function shouldIgnorePlaybackUpdateDuringHold(args: {
  room: PersistedRoom;
  nextPlayback: PlaybackState;
  currentTime: number;
}): boolean {
  return (
    !isLiveSharedVideo(args.room.sharedVideo) &&
    isPlaybackHoldActive(args.room.playbackSync, args.currentTime) &&
    args.room.playback?.playState === "playing" &&
    isStopLikePlayback(args.nextPlayback) &&
    !isExplicitControlSyncIntent(args.nextPlayback.syncIntent)
  );
}

export function preservePlayingIntentForSeek(args: {
  room: PersistedRoom;
  nextPlayback: PlaybackState;
}): PlaybackState {
  if (
    !isLiveSharedVideo(args.room.sharedVideo) &&
    args.room.playback?.playState === "playing" &&
    args.nextPlayback.syncIntent === "explicit-seek" &&
    isStopLikePlayback(args.nextPlayback)
  ) {
    // Seeking changes the room timeline. In wait mode a browser can finish the
    // seek after the local media was paused for buffering, so keep the room's
    // playing intent unless the user sends an explicit pause.
    return {
      ...args.nextPlayback,
      playState: "playing",
    };
  }

  return args.nextPlayback;
}

export function derivePlaybackAuthorityKind(args: {
  currentPlayback: PlaybackState | null;
  nextPlayback: PlaybackState;
}): PlaybackAuthority["kind"] | null {
  if (!args.currentPlayback) {
    return "play";
  }
  if (
    args.nextPlayback.playState === "paused" ||
    args.nextPlayback.playState === "buffering"
  ) {
    return "pause";
  }
  if (
    Math.abs(
      args.nextPlayback.playbackRate - args.currentPlayback.playbackRate,
    ) > 0.01
  ) {
    return "ratechange";
  }
  if (
    args.nextPlayback.syncIntent === "explicit-seek" &&
    args.nextPlayback.playState === "playing"
  ) {
    return "seek";
  }
  if (
    Math.abs(
      args.nextPlayback.currentTime - args.currentPlayback.currentTime,
    ) >= 2.5
  ) {
    return "seek";
  }
  if (
    args.currentPlayback.playState !== "playing" &&
    args.nextPlayback.playState === "playing"
  ) {
    return "play";
  }
  return null;
}
