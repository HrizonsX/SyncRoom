import {
  PLAYBACK_READY_BUFFER_AHEAD_SECONDS,
  type PlaybackBufferReport,
} from "@syncroom/protocol";

export type BufferReportMediaElementLike = {
  currentTime: number;
  buffered?: TimeRanges;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

export type PlaybackBufferReportContext = {
  memberToken: string;
  actorId: string;
  url: string;
  playbackRevision?: string;
};

export type PlaybackBufferReporterBinding = {
  dispose: () => void;
  reportNow: () => void;
  setPollingEnabled: (enabled: boolean) => void;
};

const DEFAULT_READY_BUFFER_REPORT_MIN_DELTA_SECONDS = 0.5;
const DEFAULT_BUFFERED_RANGE_START_TOLERANCE_SECONDS = 0.25;
const DEFAULT_READY_POLL_INTERVAL_MS = 500;
const DEFAULT_MAX_SILENT_REPORT_INTERVAL_MS = 2_000;

/**
 * 计算当前播放时间点之后的可用缓冲秒数，用于“等人同步”判断成员是否已准备好。
 */
export function getBufferAheadSeconds(
  media: Pick<BufferReportMediaElementLike, "buffered" | "currentTime">,
  options: { rangeStartToleranceSeconds?: number } = {},
): number {
  const buffered = media.buffered;
  if (!buffered) {
    return 0;
  }
  const rangeStartToleranceSeconds =
    options.rangeStartToleranceSeconds ??
    DEFAULT_BUFFERED_RANGE_START_TOLERANCE_SECONDS;
  for (let index = 0; index < buffered.length; index += 1) {
    const rangeStart = buffered.start(index);
    const rangeEnd = buffered.end(index);
    if (
      media.currentTime + rangeStartToleranceSeconds >= rangeStart &&
      media.currentTime <= rangeEnd
    ) {
      // MSE 播放器可能把缓冲区起点暴露为略晚于 seek 目标的时间。
      // 这里按可用处理，避免等人同步一直卡在“等待缓冲”。
      return Math.max(0, rangeEnd - media.currentTime);
    }
  }
  return 0;
}

/**
 * 监听媒体 waiting/canplay/progress 事件，并按需向房间上报本机缓冲状态。
 */
export function bindPlaybackBufferReporter(args: {
  media: BufferReportMediaElementLike;
  reportDelayMs: number;
  getContext: () => PlaybackBufferReportContext | null;
  dispatch: (report: PlaybackBufferReport) => void;
  readyBufferReportMinDeltaSeconds?: number;
  rangeStartToleranceSeconds?: number;
  pollIntervalMs?: number;
  maxSilentReportIntervalMs?: number;
  now?: () => number;
}): PlaybackBufferReporterBinding {
  let waitingTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollingEnabled = false;
  let lastReportedState: PlaybackBufferReport["state"] | null = null;
  let lastReadyBufferAheadSeconds: number | null = null;
  let lastReportedPlaybackRevision: string | undefined;
  let lastReportedAt: number | null = null;
  const readyBufferReportMinDeltaSeconds =
    args.readyBufferReportMinDeltaSeconds ??
    DEFAULT_READY_BUFFER_REPORT_MIN_DELTA_SECONDS;
  const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_READY_POLL_INTERVAL_MS;
  const maxSilentReportIntervalMs =
    args.maxSilentReportIntervalMs ?? DEFAULT_MAX_SILENT_REPORT_INTERVAL_MS;

  const clearWaitingTimer = (): void => {
    if (waitingTimer === null) {
      return;
    }
    clearTimeout(waitingTimer);
    waitingTimer = null;
  };
  const clearPollTimer = (): void => {
    if (pollTimer === null) {
      return;
    }
    clearTimeout(pollTimer);
    pollTimer = null;
  };

  const dispatchReport = (state: PlaybackBufferReport["state"]): void => {
    const context = args.getContext();
    if (!context) {
      return;
    }
    if (context.playbackRevision !== lastReportedPlaybackRevision) {
      lastReportedState = null;
      lastReadyBufferAheadSeconds = null;
      lastReportedAt = null;
      lastReportedPlaybackRevision = context.playbackRevision;
    }
    const currentTime = args.now?.() ?? Date.now();
    const bufferAheadSeconds = getBufferAheadSeconds(args.media, {
      rangeStartToleranceSeconds: args.rangeStartToleranceSeconds,
    });
    if (
      lastReportedState === state &&
      (state !== "ready" ||
        (lastReadyBufferAheadSeconds !== null &&
          bufferAheadSeconds <
            lastReadyBufferAheadSeconds + readyBufferReportMinDeltaSeconds)) &&
      lastReportedAt !== null &&
      currentTime - lastReportedAt < maxSilentReportIntervalMs
    ) {
      return;
    }
    lastReportedState = state;
    lastReadyBufferAheadSeconds = state === "ready" ? bufferAheadSeconds : null;
    lastReportedAt = currentTime;
    args.dispatch({
      state,
      currentTime: args.media.currentTime,
      bufferAheadSeconds,
      ...(context.playbackRevision
        ? { playbackRevision: context.playbackRevision }
        : {}),
    });
  };
  const reportMeasuredState = (): void => {
    const bufferAheadSeconds = getBufferAheadSeconds(args.media, {
      rangeStartToleranceSeconds: args.rangeStartToleranceSeconds,
    });
    dispatchReport(
      bufferAheadSeconds >= PLAYBACK_READY_BUFFER_AHEAD_SECONDS
        ? "ready"
        : "buffering",
    );
  };

  const handleWaiting = (): void => {
    clearWaitingTimer();
    waitingTimer = setTimeout(() => {
      waitingTimer = null;
      const bufferAheadSeconds = getBufferAheadSeconds(args.media, {
        rangeStartToleranceSeconds: args.rangeStartToleranceSeconds,
      });
      // MSE players can emit waiting while switching append windows even when
      // many seconds are already buffered. Treat only a shallow buffer as a
      // network stall, otherwise wait mode will flap between hold and resume.
      dispatchReport(
        bufferAheadSeconds >= PLAYBACK_READY_BUFFER_AHEAD_SECONDS
          ? "ready"
          : "buffering",
      );
    }, args.reportDelayMs);
  };
  const handleReady = (): void => {
    clearWaitingTimer();
    dispatchReport("ready");
  };
  const handleProgress = (): void => {
    if (lastReportedState === "ready") {
      reportMeasuredState();
    }
  };
  const schedulePoll = (): void => {
    if (!pollingEnabled || pollTimer !== null) {
      return;
    }
    pollTimer = setTimeout(() => {
      pollTimer = null;
      if (!pollingEnabled) {
        return;
      }
      reportMeasuredState();
      schedulePoll();
    }, pollIntervalMs);
  };
  const setPollingEnabled = (enabled: boolean): void => {
    pollingEnabled = enabled;
    if (!enabled) {
      clearPollTimer();
      return;
    }
    // 暂停的 VOD 元素静默缓冲时，浏览器不一定触发 progress/canplay。
    // 只在房间 hold 期间轮询，既能及时释放等人同步，也避免平时高频上报。
    schedulePoll();
  };

  args.media.addEventListener("waiting", handleWaiting);
  args.media.addEventListener("playing", handleReady);
  args.media.addEventListener("canplay", handleReady);
  args.media.addEventListener("progress", handleProgress);
  args.media.addEventListener("canplaythrough", handleReady);

  return {
    reportNow: reportMeasuredState,
    setPollingEnabled,
    dispose() {
      clearWaitingTimer();
      setPollingEnabled(false);
      args.media.removeEventListener("waiting", handleWaiting);
      args.media.removeEventListener("playing", handleReady);
      args.media.removeEventListener("canplay", handleReady);
      args.media.removeEventListener("progress", handleProgress);
      args.media.removeEventListener("canplaythrough", handleReady);
    },
  };
}
