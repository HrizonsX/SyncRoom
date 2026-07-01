import type {
  ClientMessage,
  PlaybackState,
  PlaybackSyncIntent,
} from "@syncroom/protocol";

export type MediaElementLike = {
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  play: () => Promise<void> | void;
  pause: () => void;
};

export type EventedMediaElementLike = MediaElementLike & {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type PlaybackPlayToggleControlLike = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
  disabled?: boolean;
  hasAttribute?: (name: string) => boolean;
};

export type PlaybackTimeRangeControlLike = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type LocalPlaybackEvent =
  | "play"
  | "pause"
  | "seeking"
  | "seeked"
  | "ratechange"
  | "waiting";

export type RemotePlaybackAction = "seek" | "ratechange" | "play" | "pause";

const PLAYBACK_EVENT_TYPES: readonly LocalPlaybackEvent[] = [
  "play",
  "pause",
  "seeking",
  "seeked",
  "ratechange",
];
const LOCAL_PAUSE_TEARDOWN_GUARD_MS = 150;
const EXPLICIT_PLAY_TOGGLE_ECHO_GUARD_MS = 300;
const RANGE_SEEK_ECHO_GUARD_MS = 300;
const RANGE_SEEK_ECHO_TOLERANCE_SECONDS = 0.5;

export type ApplyRemotePlaybackResult =
  | {
      applied: true;
      actions: RemotePlaybackAction[];
    }
  | {
      applied: false;
      actions: [];
      reason: "local_echo" | "url_mismatch";
    };

function derivePlayState(media: MediaElementLike, event: LocalPlaybackEvent) {
  if (event === "waiting") {
    return "buffering";
  }
  return media.paused ? "paused" : "playing";
}

function deriveSyncIntent(event: LocalPlaybackEvent) {
  if (event === "seeking" || event === "seeked") {
    return "explicit-seek";
  }
  if (event === "ratechange") {
    return "explicit-ratechange";
  }
  return undefined;
}

function normalizePlaybackRate(playbackRate: number): number {
  return Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
}

export function createPlaybackUpdateMessage(args: {
  memberToken: string;
  actorId: string;
  url: string;
  media: MediaElementLike;
  event: LocalPlaybackEvent;
  seq: number;
  syncIntent?: PlaybackSyncIntent;
  now?: () => number;
}): Extract<ClientMessage, { type: "playback:update" }> {
  const currentTime = args.now?.() ?? Date.now();
  const syncIntent = args.syncIntent ?? deriveSyncIntent(args.event);
  const playback: PlaybackState = {
    url: args.url,
    currentTime: args.media.currentTime,
    playState: derivePlayState(args.media, args.event),
    ...(syncIntent ? { syncIntent } : {}),
    userInitiated: args.event !== "waiting",
    playbackRate: normalizePlaybackRate(args.media.playbackRate),
    updatedAt: currentTime,
    serverTime: currentTime,
    actorId: args.actorId,
    seq: args.seq,
  };

  return {
    type: "playback:update",
    payload: {
      memberToken: args.memberToken,
      playback,
    },
  };
}

export function bindPlaybackSyncControls(args: {
  media: EventedMediaElementLike;
  playToggleControl?: PlaybackPlayToggleControlLike;
  timeRangeControl?: PlaybackTimeRangeControlLike;
  events?: readonly LocalPlaybackEvent[];
  getContext: () => {
    memberToken: string;
    actorId: string;
    url: string;
  } | null;
  nextSeq: () => number;
  dispatch: (
    message: Extract<ClientMessage, { type: "playback:update" }>,
  ) => void;
  now?: () => number;
}): { dispose: () => void } {
  const listeners = new Map<LocalPlaybackEvent, () => void>();
  const eventTypes = args.events ?? PLAYBACK_EVENT_TYPES;
  const shouldUseSeekedAsSeekCommit = eventTypes.includes("seeked");
  let pendingPauseTimer: ReturnType<typeof setTimeout> | null = null;
  let optimisticPlayState: "playing" | "paused" | null = null;
  let explicitEchoState: "playing" | "paused" | null = null;
  let explicitEchoUntil = 0;
  let rangeScrubbing = false;
  let rangeSeekDirty = false;
  let suppressRangeSeekedUntil = 0;
  let lastRangeSeekCommitTime: number | null = null;

  const clearPendingPause = (): void => {
    if (pendingPauseTimer === null) {
      return;
    }
    clearTimeout(pendingPauseTimer);
    pendingPauseTimer = null;
  };

  const dispatchLocalEvent = (
    event: LocalPlaybackEvent,
    media: MediaElementLike = args.media,
    syncIntent?: PlaybackSyncIntent,
  ): void => {
    const context = args.getContext();
    if (!context) {
      return;
    }
    args.dispatch(
      createPlaybackUpdateMessage({
        memberToken: context.memberToken,
        actorId: context.actorId,
        url: context.url,
        media,
        event,
        seq: args.nextSeq(),
        ...(syncIntent ? { syncIntent } : {}),
        now: args.now,
      }),
    );
  };

  const getGuardNow = (): number => args.now?.() ?? Date.now();

  const isPlayToggleDisabled = (): boolean =>
    args.playToggleControl?.disabled === true ||
    args.playToggleControl?.hasAttribute?.("disabled") === true;

  const shouldSuppressExplicitEcho = (state: "playing" | "paused"): boolean => {
    if (explicitEchoState === null) {
      return false;
    }
    if (getGuardNow() > explicitEchoUntil) {
      explicitEchoState = null;
      return false;
    }
    return explicitEchoState === state;
  };

  const removeWindowRangeEndListeners = (): void => {
    globalThis.window?.removeEventListener?.(
      "pointerup",
      handleTimeRangePointerEnd,
    );
    globalThis.window?.removeEventListener?.(
      "pointercancel",
      handleTimeRangePointerEnd,
    );
  };

  const addWindowRangeEndListeners = (): void => {
    removeWindowRangeEndListeners();
    globalThis.window?.addEventListener?.(
      "pointerup",
      handleTimeRangePointerEnd,
      { once: true },
    );
    globalThis.window?.addEventListener?.(
      "pointercancel",
      handleTimeRangePointerEnd,
      { once: true },
    );
  };

  const shouldSuppressRangeSeekedEcho = (): boolean => {
    if (lastRangeSeekCommitTime === null) {
      return false;
    }
    if (getGuardNow() > suppressRangeSeekedUntil) {
      lastRangeSeekCommitTime = null;
      return false;
    }
    return (
      Math.abs(args.media.currentTime - lastRangeSeekCommitTime) <=
      RANGE_SEEK_ECHO_TOLERANCE_SECONDS
    );
  };

  const commitRangeSeek = (): void => {
    if (!rangeSeekDirty) {
      return;
    }
    rangeSeekDirty = false;
    lastRangeSeekCommitTime = args.media.currentTime;
    suppressRangeSeekedUntil = getGuardNow() + RANGE_SEEK_ECHO_GUARD_MS;
    dispatchLocalEvent("seeked");
  };

  const handleTimeRangePointerDown = (): void => {
    rangeScrubbing = true;
    rangeSeekDirty = false;
    addWindowRangeEndListeners();
  };

  const handleTimeRangeInput = (): void => {
    if (rangeScrubbing) {
      rangeSeekDirty = true;
    }
  };

  function handleTimeRangePointerEnd(): void {
    if (!rangeScrubbing) {
      return;
    }
    rangeScrubbing = false;
    removeWindowRangeEndListeners();
    // media-chrome seeks on every range input while the pointer is still down.
    // Treat those native seeked events as draft positions and publish only the
    // release-time commit so remote members do not chase stale drag positions.
    commitRangeSeek();
  }

  const handlePlayToggleClick = (): void => {
    if (isPlayToggleDisabled()) {
      return;
    }
    clearPendingPause();
    const currentState =
      optimisticPlayState ?? (args.media.paused ? "paused" : "playing");
    const nextState = currentState === "playing" ? "paused" : "playing";
    const event: LocalPlaybackEvent =
      nextState === "playing" ? "play" : "pause";
    optimisticPlayState = nextState;
    explicitEchoState = nextState;
    explicitEchoUntil = getGuardNow() + EXPLICIT_PLAY_TOGGLE_ECHO_GUARD_MS;
    // The media element may not emit `pause` if the user cancels a still-pending
    // play() call. Send the clicked intent immediately and let the real media
    // event be treated as an echo if it arrives a moment later.
    dispatchLocalEvent(
      event,
      {
        currentTime: args.media.currentTime,
        playbackRate: args.media.playbackRate,
        paused: nextState === "paused",
        play: args.media.play,
        pause: args.media.pause,
      },
      nextState === "playing" ? "explicit-play" : "explicit-pause",
    );
  };

  args.playToggleControl?.addEventListener("click", handlePlayToggleClick);
  args.timeRangeControl?.addEventListener(
    "pointerdown",
    handleTimeRangePointerDown,
  );
  args.timeRangeControl?.addEventListener(
    "pointerup",
    handleTimeRangePointerEnd,
  );
  args.timeRangeControl?.addEventListener(
    "pointercancel",
    handleTimeRangePointerEnd,
  );
  args.timeRangeControl?.addEventListener("input", handleTimeRangeInput);

  for (const event of eventTypes) {
    const listener = () => {
      if (event === "seeking" && shouldUseSeekedAsSeekCommit) {
        return;
      }
      if (event === "seeked" && shouldUseSeekedAsSeekCommit) {
        if (rangeScrubbing) {
          rangeSeekDirty = true;
          return;
        }
        if (shouldSuppressRangeSeekedEcho()) {
          return;
        }
      }
      if (event === "pause") {
        clearPendingPause();
        optimisticPlayState = "paused";
        if (shouldSuppressExplicitEcho("paused")) {
          return;
        }
        const pausedSnapshot: MediaElementLike = {
          currentTime: args.media.currentTime,
          playbackRate: args.media.playbackRate,
          paused: args.media.paused,
          play: args.media.play,
          pause: args.media.pause,
        };
        // Some browsers emit the media `pause` event just before `pagehide` on
        // refresh/close. Re-read context after a short guard so teardown can
        // suppress that synthetic pause without dropping ordinary user pauses.
        pendingPauseTimer = setTimeout(() => {
          pendingPauseTimer = null;
          dispatchLocalEvent(event, pausedSnapshot);
        }, LOCAL_PAUSE_TEARDOWN_GUARD_MS);
        return;
      }
      if (event === "play") {
        clearPendingPause();
        optimisticPlayState = "playing";
        if (shouldSuppressExplicitEcho("playing")) {
          return;
        }
      }
      dispatchLocalEvent(event);
    };
    listeners.set(event, listener);
    args.media.addEventListener(event, listener);
  }

  return {
    dispose() {
      clearPendingPause();
      removeWindowRangeEndListeners();
      args.playToggleControl?.removeEventListener(
        "click",
        handlePlayToggleClick,
      );
      args.timeRangeControl?.removeEventListener(
        "pointerdown",
        handleTimeRangePointerDown,
      );
      args.timeRangeControl?.removeEventListener(
        "pointerup",
        handleTimeRangePointerEnd,
      );
      args.timeRangeControl?.removeEventListener(
        "pointercancel",
        handleTimeRangePointerEnd,
      );
      args.timeRangeControl?.removeEventListener("input", handleTimeRangeInput);
      for (const [event, listener] of listeners.entries()) {
        args.media.removeEventListener(event, listener);
      }
      listeners.clear();
    },
  };
}

function getProjectedCurrentTime(args: {
  playback: PlaybackState;
  nowMs: number;
}): number {
  if (args.playback.playState !== "playing") {
    return args.playback.currentTime;
  }
  const elapsedSeconds = Math.max(
    0,
    (args.nowMs - args.playback.serverTime) / 1_000,
  );
  const playbackRate = normalizePlaybackRate(args.playback.playbackRate);
  return args.playback.currentTime + elapsedSeconds * playbackRate;
}

export async function applyRemotePlaybackState(args: {
  media: MediaElementLike;
  localMemberId: string;
  currentUrl: string;
  playback: PlaybackState;
  allowLocalEcho?: boolean;
  seekToleranceSeconds?: number;
  now?: () => number;
}): Promise<ApplyRemotePlaybackResult> {
  if (args.playback.actorId === args.localMemberId && !args.allowLocalEcho) {
    return { applied: false, actions: [], reason: "local_echo" };
  }
  if (args.playback.url !== args.currentUrl) {
    return { applied: false, actions: [], reason: "url_mismatch" };
  }

  const actions: RemotePlaybackAction[] = [];
  const seekToleranceSeconds = args.seekToleranceSeconds ?? 0.75;
  const projectedCurrentTime = getProjectedCurrentTime({
    playback: args.playback,
    nowMs: args.now?.() ?? Date.now(),
  });
  if (
    Math.abs(args.media.currentTime - projectedCurrentTime) >
    seekToleranceSeconds
  ) {
    args.media.currentTime = projectedCurrentTime;
    actions.push("seek");
  }

  const playbackRate = normalizePlaybackRate(args.playback.playbackRate);
  if (Math.abs(args.media.playbackRate - playbackRate) > 0.01) {
    args.media.playbackRate = playbackRate;
    actions.push("ratechange");
  }

  if (args.playback.playState === "paused" && !args.media.paused) {
    args.media.pause();
    actions.push("pause");
  } else if (args.playback.playState === "playing" && args.media.paused) {
    await args.media.play();
    actions.push("play");
  }

  return { applied: true, actions };
}
