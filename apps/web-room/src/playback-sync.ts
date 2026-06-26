import type { ClientMessage, PlaybackState } from "@syncroom/protocol";

export type MediaElementLike = {
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  play: () => Promise<void> | void;
  pause: () => void;
};

export type EventedMediaElementLike = MediaElementLike & {
  addEventListener: (type: LocalPlaybackEvent, listener: () => void) => void;
  removeEventListener: (type: LocalPlaybackEvent, listener: () => void) => void;
};

export type LocalPlaybackEvent =
  | "play"
  | "pause"
  | "seeked"
  | "ratechange"
  | "waiting";

export type RemotePlaybackAction = "seek" | "ratechange" | "play" | "pause";

const PLAYBACK_EVENT_TYPES: readonly LocalPlaybackEvent[] = [
  "play",
  "pause",
  "seeked",
  "ratechange",
];
const LOCAL_PAUSE_TEARDOWN_GUARD_MS = 150;

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
  if (event === "seeked") {
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
  now?: () => number;
}): Extract<ClientMessage, { type: "playback:update" }> {
  const currentTime = args.now?.() ?? Date.now();
  const syncIntent = deriveSyncIntent(args.event);
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
  let pendingPauseTimer: ReturnType<typeof setTimeout> | null = null;

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
        now: args.now,
      }),
    );
  };

  for (const event of args.events ?? PLAYBACK_EVENT_TYPES) {
    const listener = () => {
      if (event === "pause") {
        clearPendingPause();
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
      }
      dispatchLocalEvent(event);
    };
    listeners.set(event, listener);
    args.media.addEventListener(event, listener);
  }

  return {
    dispose() {
      clearPendingPause();
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
