import {
  createPlaybackRevision,
  isExplicitControlSyncIntent,
  PLAYBACK_BARRIER_READY_BUFFER_AHEAD_SECONDS,
  PLAYBACK_READY_BUFFER_AHEAD_SECONDS,
  type PlaybackBufferReport,
  type PlaybackState,
  type PlaybackSyncStrategy,
  type SharedVideo,
} from "@syncroom/protocol";
import { clonePlaybackSyncState } from "./room-store.js";
import type { PersistedRoom, PlaybackAuthority } from "./types.js";

const PLAYBACK_READINESS_BARRIER_TIMEOUT_MS = 30_000;
const PLAYBACK_BUFFER_HOLD_MAX_MS = 10_000;

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

function createInactivePlaybackSyncState(
  strategy: PlaybackSyncStrategy,
): PersistedRoom["playbackSync"] {
  return {
    strategy,
    hold: { active: false },
    bufferingMemberIds: [],
  };
}

function beginReadinessBarrier(args: {
  room: PersistedRoom;
  playback: PlaybackState;
  memberIds: readonly string[];
  currentTime: number;
}): {
  playbackSync: PersistedRoom["playbackSync"];
  playbackRevision: string;
} {
  const memberIds = uniqueMemberIds(args.memberIds);
  const playbackRevision = createPlaybackRevision(args.playback);
  return {
    playbackRevision,
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: memberIds[0],
        startedAt: args.currentTime,
        deadlineAt: args.currentTime + PLAYBACK_READINESS_BARRIER_TIMEOUT_MS,
        playbackRevision,
      },
      bufferingMemberIds: memberIds,
    },
  };
}

export function coordinatePlaybackCommand(args: {
  room: PersistedRoom;
  nextPlayback: PlaybackState;
  activeMemberIds: readonly string[];
  command: "share" | "play" | "pause" | "seek" | "other";
  currentTime: number;
}): {
  playbackSync: PersistedRoom["playbackSync"];
  playback: PlaybackState;
  playbackRevision: string;
} {
  const playbackRevision = createPlaybackRevision(args.nextPlayback);
  const strategy = args.room.playbackSync?.strategy ?? "smooth";
  if (args.command === "pause") {
    return {
      playbackSync: createInactivePlaybackSyncState(strategy),
      playback: args.nextPlayback,
      playbackRevision,
    };
  }

  const shouldStartBarrier =
    strategy === "wait" &&
    !isLiveSharedVideo(args.room.sharedVideo) &&
    args.nextPlayback.playState === "playing" &&
    args.activeMemberIds.length >= 2 &&
    (args.command === "share" ||
      args.command === "play" ||
      args.command === "seek");
  if (!shouldStartBarrier) {
    return {
      playbackSync: clonePlaybackSyncState(args.room.playbackSync),
      playback: args.nextPlayback,
      playbackRevision,
    };
  }

  const barrier = beginReadinessBarrier({
    room: args.room,
    playback: args.nextPlayback,
    memberIds: args.activeMemberIds,
    currentTime: args.currentTime,
  });
  return {
    playbackSync: barrier.playbackSync,
    playback: args.nextPlayback,
    playbackRevision: barrier.playbackRevision,
  };
}

export function coordinatePlaybackMemberJoin(args: {
  room: PersistedRoom;
  memberId: string;
  currentTime: number;
}): {
  playbackSync: PersistedRoom["playbackSync"];
  playback: PlaybackState | null;
} {
  if (
    args.room.playbackSync?.strategy !== "wait" ||
    !args.room.playback ||
    args.room.playback.playState !== "playing" ||
    isLiveSharedVideo(args.room.sharedVideo)
  ) {
    return {
      playbackSync: clonePlaybackSyncState(args.room.playbackSync),
      playback: args.room.playback,
    };
  }

  const existingPlaybackSync = clonePlaybackSyncState(args.room.playbackSync);
  if (
    isPlaybackHoldActive(existingPlaybackSync, args.currentTime) &&
    existingPlaybackSync.hold.playbackRevision
  ) {
    existingPlaybackSync.bufferingMemberIds = uniqueMemberIds([
      ...existingPlaybackSync.bufferingMemberIds,
      args.memberId,
    ]);
    return {
      playbackSync: existingPlaybackSync,
      playback: args.room.playback,
    };
  }

  const playback: PlaybackState = {
    ...args.room.playback,
    currentTime: projectPlaybackTimeline(args.room.playback, args.currentTime),
    serverTime: args.currentTime,
  };
  const barrier = beginReadinessBarrier({
    room: args.room,
    playback,
    memberIds: [args.memberId],
    currentTime: args.currentTime,
  });
  return { playbackSync: barrier.playbackSync, playback };
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
  const holdDeadline = getPlaybackHoldDeadline(playbackSync);
  if (holdDeadline !== undefined && args.currentTime >= holdDeadline) {
    return createInactivePlaybackSyncState(playbackSync.strategy);
  }

  const barrierRevision = playbackSync.hold.playbackRevision;
  if (playbackSync.hold.active && barrierRevision) {
    if (args.report.playbackRevision !== barrierRevision) {
      return playbackSync;
    }
    if (!playbackSync.bufferingMemberIds.includes(args.memberId)) {
      return playbackSync;
    }
    const hasEnoughBarrierBuffer =
      (args.report.bufferAheadSeconds ?? 0) >=
      PLAYBACK_BARRIER_READY_BUFFER_AHEAD_SECONDS;
    if (!hasEnoughBarrierBuffer) {
      return playbackSync;
    }
    playbackSync.bufferingMemberIds = removeMemberId(
      playbackSync.bufferingMemberIds,
      args.memberId,
    );
    if (playbackSync.bufferingMemberIds.length === 0) {
      playbackSync.hold = { active: false };
    } else if (
      !playbackSync.hold.reasonMemberId ||
      playbackSync.hold.reasonMemberId === args.memberId
    ) {
      playbackSync.hold.reasonMemberId = playbackSync.bufferingMemberIds[0];
    }
    return playbackSync;
  }

  const wasMemberBuffering = playbackSync.bufferingMemberIds.includes(
    args.memberId,
  );
  const hasEnoughBuffer =
    (args.report.bufferAheadSeconds ?? 0) >=
    PLAYBACK_READY_BUFFER_AHEAD_SECONDS;
  const isEffectiveBuffering =
    args.report.state === "buffering" && !hasEnoughBuffer;
  const hasEnoughReadyBuffer =
    (args.report.state === "ready" || hasEnoughBuffer) && hasEnoughBuffer;

  playbackSync.bufferingMemberIds = isEffectiveBuffering
    ? uniqueMemberIds([...playbackSync.bufferingMemberIds, args.memberId])
    : hasEnoughReadyBuffer
      ? removeMemberId(playbackSync.bufferingMemberIds, args.memberId)
      : playbackSync.bufferingMemberIds;

  const shouldHoldRoom =
    playbackSync.strategy === "wait" &&
    !isLiveSharedVideo(args.room.sharedVideo) &&
    args.room.playback?.playState === "playing" &&
    isEffectiveBuffering &&
    !wasMemberBuffering;
  if (shouldHoldRoom && !playbackSync.hold.active) {
    playbackSync.hold = {
      active: true,
      reasonMemberId: args.memberId,
      startedAt: args.currentTime,
      deadlineAt: args.currentTime + PLAYBACK_BUFFER_HOLD_MAX_MS,
    };
  }

  if (
    hasEnoughReadyBuffer &&
    playbackSync.hold.active &&
    playbackSync.bufferingMemberIds.length === 0
  ) {
    playbackSync.hold = { active: false };
  }

  return playbackSync;
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
  const elapsedSeconds = Math.max(
    0,
    (currentTime - playback.serverTime) / 1_000,
  );
  return (
    playback.currentTime +
    elapsedSeconds * normalizePlaybackRate(playback.playbackRate)
  );
}

function rebasePlaybackForHoldTransition(args: {
  room: PersistedRoom;
  playbackSync: PersistedRoom["playbackSync"];
  currentTime: number;
}): PlaybackState | null {
  const playback = args.room.playback;
  if (!playback || playback.playState !== "playing") {
    return playback;
  }
  const wasHeld = args.room.playbackSync?.hold.active === true;
  const isHeld = args.playbackSync?.hold.active === true;
  if (wasHeld === isHeld) {
    return playback;
  }

  return {
    ...playback,
    currentTime: isHeld
      ? projectPlaybackTimeline(playback, args.currentTime)
      : playback.currentTime,
    serverTime: args.currentTime,
  };
}

export function coordinatePlaybackBufferReport(args: {
  room: PersistedRoom;
  memberId: string;
  report: PlaybackBufferReport;
  currentTime: number;
}): {
  playbackSync: PersistedRoom["playbackSync"];
  playback: PlaybackState | null;
} {
  const playbackSync = updatePlaybackSyncForBufferReport(args);
  return {
    playbackSync,
    playback: rebasePlaybackForHoldTransition({
      room: args.room,
      playbackSync,
      currentTime: args.currentTime,
    }),
  };
}

export function getPlaybackHoldDeadline(
  playbackSync: PersistedRoom["playbackSync"],
): number | undefined {
  if (playbackSync?.hold.active !== true) {
    return undefined;
  }
  if (playbackSync.hold.deadlineAt !== undefined) {
    return playbackSync.hold.deadlineAt;
  }
  if (playbackSync.hold.startedAt !== undefined) {
    return playbackSync.hold.startedAt + PLAYBACK_BUFFER_HOLD_MAX_MS;
  }
  // A malformed or legacy active hold without timing metadata must not block
  // the room forever after an upgrade.
  return 0;
}

export function coordinatePlaybackHoldExpiry(args: {
  room: PersistedRoom;
  expectedDeadline: number;
  currentTime: number;
}): {
  playbackSync: PersistedRoom["playbackSync"];
  playback: PlaybackState | null;
  expired: boolean;
} {
  const deadline = getPlaybackHoldDeadline(args.room.playbackSync);
  if (
    deadline === undefined ||
    deadline !== args.expectedDeadline ||
    args.currentTime < deadline
  ) {
    return {
      playbackSync: clonePlaybackSyncState(args.room.playbackSync),
      playback: args.room.playback,
      expired: false,
    };
  }

  const playbackSync = createInactivePlaybackSyncState(
    args.room.playbackSync?.strategy ?? "smooth",
  );
  return {
    playbackSync,
    playback: rebasePlaybackForHoldTransition({
      room: args.room,
      playbackSync,
      currentTime: args.currentTime,
    }),
    expired: true,
  };
}

export function coordinatePlaybackMemberDeparture(args: {
  room: PersistedRoom;
  memberId: string;
  currentTime: number;
}): {
  playbackSync: PersistedRoom["playbackSync"];
  playback: PlaybackState | null;
} {
  const playbackSync = clonePlaybackSyncState(args.room.playbackSync);
  if (!playbackSync.bufferingMemberIds.includes(args.memberId)) {
    return { playbackSync, playback: args.room.playback };
  }

  playbackSync.bufferingMemberIds = removeMemberId(
    playbackSync.bufferingMemberIds,
    args.memberId,
  );
  if (playbackSync.bufferingMemberIds.length === 0) {
    playbackSync.hold = { active: false };
  } else if (playbackSync.hold.reasonMemberId === args.memberId) {
    playbackSync.hold = {
      ...playbackSync.hold,
      reasonMemberId: playbackSync.bufferingMemberIds[0]!,
    };
  }

  return {
    playbackSync,
    playback: rebasePlaybackForHoldTransition({
      room: args.room,
      playbackSync,
      currentTime: args.currentTime,
    }),
  };
}

export function coordinatePlaybackSyncStrategyChange(args: {
  room: PersistedRoom;
  strategy: PlaybackSyncStrategy;
  currentTime: number;
  activeMemberIds?: readonly string[];
}): {
  playbackSync: PersistedRoom["playbackSync"];
  playback: PlaybackState | null;
} {
  const activeMemberIds = args.activeMemberIds ?? [];
  if (
    args.strategy === "wait" &&
    args.room.playback?.playState === "playing" &&
    !isLiveSharedVideo(args.room.sharedVideo) &&
    activeMemberIds.length >= 2
  ) {
    const playback: PlaybackState = {
      ...args.room.playback,
      currentTime: projectPlaybackTimeline(
        args.room.playback,
        args.currentTime,
      ),
      serverTime: args.currentTime,
    };
    const barrier = beginReadinessBarrier({
      room: args.room,
      playback,
      memberIds: activeMemberIds,
      currentTime: args.currentTime,
    });
    return { playbackSync: barrier.playbackSync, playback };
  }

  const playbackSync = createInactivePlaybackSyncState(args.strategy);
  return {
    playbackSync,
    playback: rebasePlaybackForHoldTransition({
      room: args.room,
      playbackSync,
      currentTime: args.currentTime,
    }),
  };
}

export function isPlaybackHoldActive(
  playbackSync: PersistedRoom["playbackSync"],
  currentTime: number,
): boolean {
  const deadline = getPlaybackHoldDeadline(playbackSync);
  return deadline !== undefined && currentTime < deadline;
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
