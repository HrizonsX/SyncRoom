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
  webkitDisplayingFullscreen?: boolean;
  webkitPresentationMode?: "inline" | "fullscreen" | "picture-in-picture";
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type PlaybackRequestTargetLike = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type PlaybackPlayToggleControlLike = PlaybackRequestTargetLike & {
  disabled?: boolean;
  hasAttribute?: (name: string) => boolean;
};

export type PlaybackTimeRangeControlLike = {
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  removeEventListener: (type: string, listener: (event: Event) => void) => void;
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
const RANGE_SEEK_ECHO_TOLERANCE_SECONDS = 0.5;
const MEDIA_PLAY_REQUEST_EVENT = "mediaplayrequest";
const MEDIA_PAUSE_REQUEST_EVENT = "mediapauserequest";
const MEDIA_SEEK_REQUEST_EVENT = "mediaseekrequest";
const MEDIA_PLAYBACK_RATE_REQUEST_EVENT = "mediaplaybackraterequest";
const SEMANTIC_REQUEST_ECHO_GUARD_MS = 1_000;
const NATIVE_FULLSCREEN_SEEK_ECHO_GUARD_MS = 30_000;
const NATIVE_FULLSCREEN_SEEK_ECHO_TOLERANCE_SECONDS = 0.75;

export type PlaybackSyncControlsBinding = {
  dispose: () => void;
  suppressNativeSeekEcho: (targetTime: number) => void;
};

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

function normalizePlaybackRate(playbackRate: number): number {
  return Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1;
}

/**
 * 把本地媒体事件转换成协议层 playback:update 消息，统一补齐 actor、seq 和时间戳。
 */
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
  // Native media events are also emitted by source hydration and remote state
  // application. Only a semantic control request may mark an update explicit.
  const syncIntent = args.syncIntent;
  const playback: PlaybackState = {
    url: args.url,
    currentTime: args.media.currentTime,
    playState: derivePlayState(args.media, args.event),
    ...(syncIntent ? { syncIntent } : {}),
    ...(syncIntent ? { userInitiated: true } : {}),
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

/**
 * 绑定播放器控制事件到房间同步消息，同时抑制本地回声和拖动进度条的中间 seek。
 */
export function bindPlaybackSyncControls(args: {
  media: EventedMediaElementLike;
  playToggleControl?: PlaybackPlayToggleControlLike;
  playbackRequestTarget?: PlaybackRequestTargetLike;
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
}): PlaybackSyncControlsBinding {
  const listeners = new Map<LocalPlaybackEvent, () => void>();
  const eventTypes = args.events ?? PLAYBACK_EVENT_TYPES;
  const shouldUseSeekedAsSeekCommit = eventTypes.includes("seeked");
  let pendingPauseTimer: ReturnType<typeof setTimeout> | null = null;
  let explicitEchoState: "playing" | "paused" | null = null;
  let explicitEchoUntil = 0;
  let rangeScrubbing = false;
  let rangeSeekDirty = false;
  let suppressRangeSeekedUntil = 0;
  let lastRangeSeekCommitTime: number | null = null;
  let pendingRangeSeekTime: number | null = null;
  let suppressRateChangeUntil = 0;
  let lastRequestedPlaybackRate: number | null = null;
  let nativeFullscreenEventState: boolean | null = null;
  let suppressedNativeSeekTarget: number | null = null;
  let suppressNativeSeekUntil = 0;

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

  const isNativeFullscreenActive = (): boolean =>
    nativeFullscreenEventState ??
    (args.media.webkitDisplayingFullscreen === true ||
      args.media.webkitPresentationMode === "fullscreen");

  const clearSuppressedNativeSeek = (): void => {
    suppressedNativeSeekTarget = null;
    suppressNativeSeekUntil = 0;
  };

  const shouldSuppressNativeSeekEcho = (): boolean => {
    if (suppressedNativeSeekTarget === null) {
      return false;
    }
    if (!isNativeFullscreenActive()) {
      clearSuppressedNativeSeek();
      return false;
    }
    const targetTime = suppressedNativeSeekTarget;
    const isFresh = getGuardNow() <= suppressNativeSeekUntil;
    clearSuppressedNativeSeek();
    return (
      isFresh &&
      Math.abs(args.media.currentTime - targetTime) <=
        NATIVE_FULLSCREEN_SEEK_ECHO_TOLERANCE_SECONDS
    );
  };

  const handleNativeFullscreenBegin = (): void => {
    nativeFullscreenEventState = true;
  };
  const handleNativeFullscreenEnd = (): void => {
    nativeFullscreenEventState = false;
    clearSuppressedNativeSeek();
  };
  const handleNativePresentationModeChange = (): void => {
    nativeFullscreenEventState =
      args.media.webkitDisplayingFullscreen === true ||
      args.media.webkitPresentationMode === "fullscreen";
    if (!nativeFullscreenEventState) {
      clearSuppressedNativeSeek();
    }
  };

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
    // 快速连点会让旧 play()/pause() promise 在新请求之后才落地。
    // 保护窗口内以语义 request 事件为准，原生 media 事件只当作本地回声。
    return state === "playing" || state === "paused";
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

  const shouldSuppressRateChangeEcho = (): boolean => {
    if (lastRequestedPlaybackRate === null) {
      return false;
    }
    if (getGuardNow() > suppressRateChangeUntil) {
      lastRequestedPlaybackRate = null;
      return false;
    }
    return (
      Math.abs(args.media.playbackRate - lastRequestedPlaybackRate) <= 0.01
    );
  };

  const rememberSeekEcho = (targetTime: number): void => {
    lastRangeSeekCommitTime = targetTime;
    suppressRangeSeekedUntil = getGuardNow() + SEMANTIC_REQUEST_ECHO_GUARD_MS;
  };

  const commitRangeSeek = (): void => {
    if (!rangeSeekDirty) {
      return;
    }
    rangeSeekDirty = false;
    const targetTime = pendingRangeSeekTime;
    pendingRangeSeekTime = null;
    if (targetTime !== null) {
      args.media.currentTime = targetTime;
    }
    rememberSeekEcho(args.media.currentTime);
    dispatchLocalEvent("seeked", args.media, "explicit-seek");
  };

  const handleTimeRangePointerDown = (): void => {
    rangeScrubbing = true;
    rangeSeekDirty = false;
    pendingRangeSeekTime = null;
    addWindowRangeEndListeners();
  };

  const handleTimeRangeInput = (): void => {
    if (rangeScrubbing) {
      rangeSeekDirty = true;
    }
  };
  const handleTimeRangeSeekRequest = (event: Event): void => {
    if (!rangeScrubbing) {
      return;
    }
    const requestedTime = (event as CustomEvent<unknown>).detail;
    if (typeof requestedTime === "number" && Number.isFinite(requestedTime)) {
      pendingRangeSeekTime = Math.max(0, requestedTime);
      rangeSeekDirty = true;
    }
    // media-chrome 的 input 会立即发起 mediaseekrequest。
    // 拖动期间先拦住这些草稿位置，避免播放器为每个中间点加载媒体分片。
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };

  function handleTimeRangePointerEnd(): void {
    if (!rangeScrubbing) {
      return;
    }
    rangeScrubbing = false;
    removeWindowRangeEndListeners();
    // media-chrome 在拖动过程中每次 input 都会 seek；这些位置只是草稿。
    // 只在松手时提交最终位置，避免远端成员追逐过期的拖动中间值。
    commitRangeSeek();
  }

  const dispatchExplicitPlayToggleRequest = (
    nextState: "playing" | "paused",
  ): void => {
    if (isPlayToggleDisabled()) {
      return;
    }
    clearPendingPause();
    const event: LocalPlaybackEvent =
      nextState === "playing" ? "play" : "pause";
    explicitEchoState = nextState;
    explicitEchoUntil = getGuardNow() + EXPLICIT_PLAY_TOGGLE_ECHO_GUARD_MS;
    // media-chrome 的语义 request 事件早于 media 元素最终 play/pause。
    // 先广播用户意图，再把随后的原生事件视为本地回声。
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
  const handleMediaPlayRequest = (): void => {
    dispatchExplicitPlayToggleRequest("playing");
  };
  const handleMediaPauseRequest = (): void => {
    dispatchExplicitPlayToggleRequest("paused");
  };
  const handleMediaSeekRequest = (event?: Event): void => {
    const requestedTime = (event as CustomEvent<unknown> | undefined)?.detail;
    if (typeof requestedTime !== "number" || !Number.isFinite(requestedTime)) {
      return;
    }
    const targetTime = Math.max(0, requestedTime);
    rememberSeekEcho(targetTime);
    dispatchLocalEvent(
      "seeked",
      {
        currentTime: targetTime,
        playbackRate: args.media.playbackRate,
        paused: args.media.paused,
        play: args.media.play,
        pause: args.media.pause,
      },
      "explicit-seek",
    );
  };
  const handleMediaPlaybackRateRequest = (event?: Event): void => {
    const requestedRate = (event as CustomEvent<unknown> | undefined)?.detail;
    if (
      typeof requestedRate !== "number" ||
      !Number.isFinite(requestedRate) ||
      requestedRate <= 0
    ) {
      return;
    }
    if (
      Math.abs(
        normalizePlaybackRate(args.media.playbackRate) - requestedRate,
      ) <= 0.01
    ) {
      // Recreated media-chrome controls can repeat their current value. A
      // no-op rate request must not become a fresh room timeline command.
      return;
    }
    lastRequestedPlaybackRate = requestedRate;
    suppressRateChangeUntil = getGuardNow() + SEMANTIC_REQUEST_ECHO_GUARD_MS;
    dispatchLocalEvent(
      "ratechange",
      {
        currentTime: args.media.currentTime,
        playbackRate: requestedRate,
        paused: args.media.paused,
        play: args.media.play,
        pause: args.media.pause,
      },
      "explicit-ratechange",
    );
  };
  const playbackRequestTarget =
    args.playbackRequestTarget ?? args.playToggleControl;

  playbackRequestTarget?.addEventListener(
    MEDIA_PLAY_REQUEST_EVENT,
    handleMediaPlayRequest,
  );
  playbackRequestTarget?.addEventListener(
    MEDIA_PAUSE_REQUEST_EVENT,
    handleMediaPauseRequest,
  );
  playbackRequestTarget?.addEventListener(
    MEDIA_SEEK_REQUEST_EVENT,
    handleMediaSeekRequest,
  );
  playbackRequestTarget?.addEventListener(
    MEDIA_PLAYBACK_RATE_REQUEST_EVENT,
    handleMediaPlaybackRateRequest,
  );
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
  args.timeRangeControl?.addEventListener(
    MEDIA_SEEK_REQUEST_EVENT,
    handleTimeRangeSeekRequest,
  );
  args.media.addEventListener(
    "webkitbeginfullscreen",
    handleNativeFullscreenBegin,
  );
  args.media.addEventListener("webkitendfullscreen", handleNativeFullscreenEnd);
  args.media.addEventListener(
    "webkitpresentationmodechanged",
    handleNativePresentationModeChange,
  );

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
        if (shouldSuppressNativeSeekEcho()) {
          return;
        }
        if (isNativeFullscreenActive()) {
          dispatchLocalEvent(event, args.media, "explicit-seek");
          return;
        }
      }
      if (event === "ratechange" && shouldSuppressRateChangeEcho()) {
        return;
      }
      if (event === "pause") {
        clearPendingPause();
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
        // 部分浏览器会在刷新/关闭前、pagehide 之前触发 media pause。
        // 延迟读取上下文，让页面销毁逻辑有机会屏蔽这个合成暂停，同时保留普通用户暂停。
        pendingPauseTimer = setTimeout(() => {
          pendingPauseTimer = null;
          dispatchLocalEvent(event, pausedSnapshot);
        }, LOCAL_PAUSE_TEARDOWN_GUARD_MS);
        return;
      }
      if (event === "play") {
        clearPendingPause();
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
    suppressNativeSeekEcho(targetTime: number) {
      if (!Number.isFinite(targetTime)) {
        return;
      }
      suppressedNativeSeekTarget = Math.max(0, targetTime);
      suppressNativeSeekUntil =
        getGuardNow() + NATIVE_FULLSCREEN_SEEK_ECHO_GUARD_MS;
    },
    dispose() {
      clearPendingPause();
      clearSuppressedNativeSeek();
      removeWindowRangeEndListeners();
      playbackRequestTarget?.removeEventListener(
        MEDIA_PLAY_REQUEST_EVENT,
        handleMediaPlayRequest,
      );
      playbackRequestTarget?.removeEventListener(
        MEDIA_PAUSE_REQUEST_EVENT,
        handleMediaPauseRequest,
      );
      playbackRequestTarget?.removeEventListener(
        MEDIA_SEEK_REQUEST_EVENT,
        handleMediaSeekRequest,
      );
      playbackRequestTarget?.removeEventListener(
        MEDIA_PLAYBACK_RATE_REQUEST_EVENT,
        handleMediaPlaybackRateRequest,
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
      args.timeRangeControl?.removeEventListener(
        MEDIA_SEEK_REQUEST_EVENT,
        handleTimeRangeSeekRequest,
      );
      args.media.removeEventListener(
        "webkitbeginfullscreen",
        handleNativeFullscreenBegin,
      );
      args.media.removeEventListener(
        "webkitendfullscreen",
        handleNativeFullscreenEnd,
      );
      args.media.removeEventListener(
        "webkitpresentationmodechanged",
        handleNativePresentationModeChange,
      );
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

/**
 * 将远端房间播放状态应用到本地媒体元素，并返回实际执行过的 seek/play/pause 操作。
 */
export async function applyRemotePlaybackState(args: {
  media: MediaElementLike;
  localMemberId: string;
  currentUrl: string;
  playback: PlaybackState;
  allowLocalEcho?: boolean;
  seekToleranceSeconds?: number;
  onBeforeSeek?: (targetTime: number) => void;
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
    args.onBeforeSeek?.(projectedCurrentTime);
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
