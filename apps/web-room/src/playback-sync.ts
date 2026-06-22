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
  "waiting",
];

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
    playbackRate: args.media.playbackRate,
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

  for (const event of args.events ?? PLAYBACK_EVENT_TYPES) {
    const listener = () => {
      const context = args.getContext();
      if (!context) {
        return;
      }
      args.dispatch(
        createPlaybackUpdateMessage({
          memberToken: context.memberToken,
          actorId: context.actorId,
          url: context.url,
          media: args.media,
          event,
          seq: args.nextSeq(),
          now: args.now,
        }),
      );
    };
    listeners.set(event, listener);
    args.media.addEventListener(event, listener);
  }

  return {
    dispose() {
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
  return (
    args.playback.currentTime + elapsedSeconds * args.playback.playbackRate
  );
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

  if (Math.abs(args.media.playbackRate - args.playback.playbackRate) > 0.01) {
    args.media.playbackRate = args.playback.playbackRate;
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
