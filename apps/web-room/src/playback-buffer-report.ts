import type { PlaybackBufferReport } from "@syncroom/protocol";

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
};

export type PlaybackBufferReporterBinding = {
  dispose: () => void;
  setPollingEnabled: (enabled: boolean) => void;
};

const DEFAULT_READY_BUFFER_REPORT_MIN_DELTA_SECONDS = 0.5;
const DEFAULT_BUFFERED_RANGE_START_TOLERANCE_SECONDS = 0.25;
const DEFAULT_READY_POLL_INTERVAL_MS = 500;

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
      // MSE players can expose a buffered range that starts a few milliseconds
      // after the seek target. Count that as ready so wait-mode can release.
      return Math.max(0, rangeEnd - media.currentTime);
    }
  }
  return 0;
}

export function bindPlaybackBufferReporter(args: {
  media: BufferReportMediaElementLike;
  reportDelayMs: number;
  getContext: () => PlaybackBufferReportContext | null;
  dispatch: (report: PlaybackBufferReport) => void;
  readyBufferReportMinDeltaSeconds?: number;
  rangeStartToleranceSeconds?: number;
  pollIntervalMs?: number;
}): PlaybackBufferReporterBinding {
  let waitingTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollingEnabled = false;
  let lastReportedState: PlaybackBufferReport["state"] | null = null;
  let lastReadyBufferAheadSeconds: number | null = null;
  const readyBufferReportMinDeltaSeconds =
    args.readyBufferReportMinDeltaSeconds ??
    DEFAULT_READY_BUFFER_REPORT_MIN_DELTA_SECONDS;
  const pollIntervalMs = args.pollIntervalMs ?? DEFAULT_READY_POLL_INTERVAL_MS;

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
    const bufferAheadSeconds = getBufferAheadSeconds(args.media, {
      rangeStartToleranceSeconds: args.rangeStartToleranceSeconds,
    });
    if (
      lastReportedState === state &&
      (state !== "ready" ||
        (lastReadyBufferAheadSeconds !== null &&
          bufferAheadSeconds <
            lastReadyBufferAheadSeconds + readyBufferReportMinDeltaSeconds))
    ) {
      return;
    }
    lastReportedState = state;
    lastReadyBufferAheadSeconds = state === "ready" ? bufferAheadSeconds : null;
    args.dispatch({
      state,
      currentTime: args.media.currentTime,
      bufferAheadSeconds,
    });
  };

  const handleWaiting = (): void => {
    clearWaitingTimer();
    waitingTimer = setTimeout(() => {
      waitingTimer = null;
      dispatchReport("buffering");
    }, args.reportDelayMs);
  };
  const handleReady = (): void => {
    clearWaitingTimer();
    dispatchReport("ready");
  };
  const handleProgress = (): void => {
    if (lastReportedState === "ready") {
      dispatchReport("ready");
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
      dispatchReport("ready");
      schedulePoll();
    }, pollIntervalMs);
  };
  const setPollingEnabled = (enabled: boolean): void => {
    pollingEnabled = enabled;
    if (!enabled) {
      clearPollTimer();
      return;
    }
    // Browsers do not always emit progress/canplay while a paused VOD element
    // silently fills its buffer. Polling only during room holds lets the server
    // release wait-mode as soon as the real buffered range is sufficient.
    schedulePoll();
  };

  args.media.addEventListener("waiting", handleWaiting);
  args.media.addEventListener("playing", handleReady);
  args.media.addEventListener("canplay", handleReady);
  args.media.addEventListener("progress", handleProgress);
  args.media.addEventListener("canplaythrough", handleReady);

  return {
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
