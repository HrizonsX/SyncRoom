import type { ClientMessage, PlaybackBufferReport } from "@syncroom/protocol";
import type { PlaybackSource } from "./playback-adapter.js";
import {
  bindPlaybackBufferReporter,
  type PlaybackBufferReporterBinding,
} from "./playback-buffer-report.js";
import {
  applyRemotePlaybackState,
  bindPlaybackSyncControls,
  type EventedMediaElementLike,
  type LocalPlaybackEvent,
  type PlaybackPlayToggleControlLike,
  type PlaybackRequestTargetLike,
  type PlaybackTimeRangeControlLike,
} from "./playback-sync.js";
import {
  createPlaybackPlayRetryController,
  isAutoplayBlockedError,
} from "./playback-play-retry.js";
import type { PlaybackVideoElement } from "./playback-types.js";
import {
  createPlaybackElementController,
  type PlaybackElementControllerOptions,
} from "./playback-element-controller.js";
import type { WebRoomState } from "../ui/render.js";

export type {
  MpegtsMediaDataSource,
  MpegtsPlayerConfig,
  MpegtsPlayerInstance,
  MpegtsPlayerModule,
} from "./mpegts-engine.js";
export type { PlaybackVideoElement } from "./playback-types.js";
export type {
  ShakaPlayerConstructor,
  ShakaPlayerInstance,
  ShakaPlayerModule,
} from "./shaka-engine.js";
export { createPlaybackElementController } from "./playback-element-controller.js";
export type { PlaybackElementControllerOptions } from "./playback-element-controller.js";

export type WebRoomPlaybackControllerOptions =
  PlaybackElementControllerOptions & {
    onPlaybackError?: (error: unknown, source: PlaybackSource) => void;
    onPlaybackLoaded?: (source: PlaybackSource) => void;
    pageLifecycleTarget?: PlaybackPageLifecycleTarget | null;
    getSyncContext?: () => {
      memberToken: string;
      actorId: string;
      url: string;
    } | null;
    nextSeq?: () => number;
    dispatchPlaybackUpdate?: (
      message: Extract<ClientMessage, { type: "playback:update" }>,
    ) => void;
    dispatchPlaybackBufferReport?: (report: PlaybackBufferReport) => void;
    bufferReportDelayMs?: number;
  };

type PlaybackPageLifecycleEvent = "pagehide" | "beforeunload" | "pageshow";

type PlaybackPageLifecycleTarget = {
  addEventListener?: (
    type: PlaybackPageLifecycleEvent,
    listener: () => void,
  ) => void;
  removeEventListener?: (
    type: PlaybackPageLifecycleEvent,
    listener: () => void,
  ) => void;
};

const LIVE_PLAYBACK_SYNC_EVENTS: readonly LocalPlaybackEvent[] = [
  "play",
  "pause",
];
const PLAYBACK_BUFFER_REPORT_DELAY_MS = 1_200;
const PLAYBACK_BUFFER_HOLD_POLL_INTERVAL_MS = 500;
const PLAYBACK_HOLD_SUPPRESS_LOCAL_EVENTS_MS = 500;

/**
 * 创建网页播放器控制器，负责加载媒体源、绑定本地控制事件、应用远端同步状态和上报缓冲状态。
 */
export function createWebRoomPlaybackController(
  options: WebRoomPlaybackControllerOptions = {},
) {
  const elementController = createPlaybackElementController(options);
  let playbackBinding: { dispose: () => void } | undefined;
  let playbackBufferBinding: PlaybackBufferReporterBinding | undefined;
  let boundMedia: EventedMediaElementLike | undefined;
  let boundBufferMedia: EventedMediaElementLike | undefined;
  let boundBufferUrl: string | undefined;
  let boundSyncUrl: string | undefined;
  let boundSyncEventsKey: string | undefined;
  let boundPlayToggleControl: PlaybackPlayToggleControlLike | undefined;
  let boundPlaybackRequestTarget: PlaybackRequestTargetLike | undefined;
  let boundTimeRangeControl: PlaybackTimeRangeControlLike | undefined;
  let suppressLocalEventsUntil = 0;
  let syncGeneration = 0;
  let needsPlaybackHydration = true;
  let resumeAfterPlaybackHold = false;
  let pageLifecycleEnding = false;
  // play() 重试会处理刷新恢复、等待同步释放、浏览器自动播放限制等场景；
  // 控制器只提供代际和本地事件压制边界，避免重试过程误广播成用户操作。
  const playbackPlayRetryController = createPlaybackPlayRetryController({
    now: getNow,
    getGeneration: () => syncGeneration,
    suppressLocalEventsUntil: (until) => {
      suppressLocalEventsUntil = Math.max(suppressLocalEventsUntil, until);
    },
  });
  const pageLifecycleTarget =
    options.pageLifecycleTarget === undefined
      ? ((globalThis as Partial<PlaybackPageLifecycleTarget>) ?? null)
      : options.pageLifecycleTarget;

  const handlePageLifecycleEnd = (): void => {
    // 刷新/关闭页面时浏览器可能在销毁阶段触发 media pause；
    // 这不是用户暂停指令，不能广播给房间导致其他成员暂停。
    pageLifecycleEnding = true;
    suppressLocalEventsUntil = Number.POSITIVE_INFINITY;
  };
  const handlePageLifecycleShow = (): void => {
    pageLifecycleEnding = false;
    suppressLocalEventsUntil = 0;
  };
  if (typeof pageLifecycleTarget?.addEventListener === "function") {
    pageLifecycleTarget.addEventListener("pagehide", handlePageLifecycleEnd);
    pageLifecycleTarget.addEventListener(
      "beforeunload",
      handlePageLifecycleEnd,
    );
    pageLifecycleTarget.addEventListener("pageshow", handlePageLifecycleShow);
  }

  function getNow(): number {
    return options.now?.() ?? Date.now();
  }

  function disposePlaybackBinding(
    options: { preserveResumeIntent?: boolean } = {},
  ): void {
    playbackBinding?.dispose();
    playbackBufferBinding?.dispose();
    playbackBinding = undefined;
    playbackBufferBinding = undefined;
    boundMedia = undefined;
    boundBufferMedia = undefined;
    boundBufferUrl = undefined;
    boundSyncUrl = undefined;
    boundSyncEventsKey = undefined;
    boundPlayToggleControl = undefined;
    boundPlaybackRequestTarget = undefined;
    boundTimeRangeControl = undefined;
    if (options.preserveResumeIntent !== true) {
      resumeAfterPlaybackHold = false;
    }
  }

  function ensurePlaybackBufferBinding(
    media: EventedMediaElementLike,
    syncUrl: string | undefined,
    isLivePlayback: boolean,
  ): void {
    if (
      !syncUrl ||
      isLivePlayback ||
      !options.getSyncContext ||
      !options.dispatchPlaybackBufferReport
    ) {
      playbackBufferBinding?.dispose();
      playbackBufferBinding = undefined;
      boundBufferMedia = undefined;
      boundBufferUrl = undefined;
      return;
    }
    if (
      playbackBufferBinding &&
      boundBufferMedia === media &&
      boundBufferUrl === syncUrl
    ) {
      return;
    }

    playbackBufferBinding?.dispose();
    boundBufferMedia = media;
    boundBufferUrl = syncUrl;
    const reportDelayMs =
      options.bufferReportDelayMs ?? PLAYBACK_BUFFER_REPORT_DELAY_MS;
    playbackBufferBinding = bindPlaybackBufferReporter({
      media,
      reportDelayMs,
      pollIntervalMs: PLAYBACK_BUFFER_HOLD_POLL_INTERVAL_MS,
      getContext: () => {
        if (pageLifecycleEnding || getNow() < suppressLocalEventsUntil) {
          return null;
        }
        const context = options.getSyncContext?.();
        return context?.url === syncUrl ? context : null;
      },
      dispatch: (report) => options.dispatchPlaybackBufferReport?.(report),
    });
  }

  function isEventedMediaElement(
    video: PlaybackVideoElement,
  ): video is PlaybackVideoElement & EventedMediaElementLike {
    const candidate = video as Partial<EventedMediaElementLike>;
    return (
      typeof candidate.addEventListener === "function" &&
      typeof candidate.removeEventListener === "function" &&
      typeof candidate.play === "function" &&
      typeof candidate.pause === "function" &&
      typeof candidate.currentTime === "number" &&
      typeof candidate.playbackRate === "number" &&
      typeof candidate.paused === "boolean"
    );
  }

  function ensurePlaybackBinding(
    media: EventedMediaElementLike,
    syncUrl: string | undefined,
    events?: readonly LocalPlaybackEvent[],
    playToggleControl?: PlaybackPlayToggleControlLike,
    playbackRequestTarget?: PlaybackRequestTargetLike,
    timeRangeControl?: PlaybackTimeRangeControlLike,
  ): void {
    if (
      !syncUrl ||
      !options.getSyncContext ||
      !options.dispatchPlaybackUpdate ||
      !options.nextSeq
    ) {
      disposePlaybackBinding();
      return;
    }
    const eventsKey = events?.join(",") ?? "*";
    if (
      playbackBinding &&
      boundMedia === media &&
      boundSyncUrl === syncUrl &&
      boundSyncEventsKey === eventsKey &&
      boundPlayToggleControl === playToggleControl &&
      boundPlaybackRequestTarget === playbackRequestTarget &&
      boundTimeRangeControl === timeRangeControl
    ) {
      return;
    }

    const preserveResumeIntent =
      boundMedia === media && boundSyncUrl === syncUrl;
    disposePlaybackBinding({ preserveResumeIntent });
    boundMedia = media;
    boundSyncUrl = syncUrl;
    boundSyncEventsKey = eventsKey;
    boundPlayToggleControl = playToggleControl;
    boundPlaybackRequestTarget = playbackRequestTarget;
    boundTimeRangeControl = timeRangeControl;
    playbackBinding = bindPlaybackSyncControls({
      media,
      ...(playToggleControl ? { playToggleControl } : {}),
      ...(playbackRequestTarget ? { playbackRequestTarget } : {}),
      ...(timeRangeControl ? { timeRangeControl } : {}),
      ...(events ? { events } : {}),
      getContext: () => {
        if (pageLifecycleEnding || getNow() < suppressLocalEventsUntil) {
          return null;
        }
        const context = options.getSyncContext?.();
        return context?.url === syncUrl ? context : null;
      },
      nextSeq: options.nextSeq,
      dispatch: options.dispatchPlaybackUpdate,
      now: options.now,
    });
  }

  function isRoomPlaybackHoldActive(state: WebRoomState): boolean {
    if (state.view !== "joined" || state.playbackSync?.hold.active !== true) {
      return false;
    }
    const deadlineAt = state.playbackSync.hold.deadlineAt;
    return typeof deadlineAt !== "number" || deadlineAt > getNow();
  }

  return {
    async sync(root: ParentNode, state: WebRoomState): Promise<void> {
      const generation = ++syncGeneration;
      playbackPlayRetryController.dispose();
      if (state.view !== "joined" || !state.playbackSource) {
        needsPlaybackHydration = true;
        disposePlaybackBinding();
        await elementController.clear();
        return;
      }

      const video = root.querySelector<HTMLVideoElement>(
        '[data-playback-video="true"]',
      );
      if (!video) {
        needsPlaybackHydration = true;
        disposePlaybackBinding();
        await elementController.clear();
        return;
      }

      let loadedSource = false;
      try {
        loadedSource = await elementController.load(
          video,
          state.playbackSource,
        );
      } catch (error) {
        if (generation === syncGeneration) {
          options.onPlaybackError?.(error, state.playbackSource);
        }
        return;
      }
      if (generation !== syncGeneration) {
        return;
      }
      if (loadedSource) {
        needsPlaybackHydration = true;
        options.onPlaybackLoaded?.(state.playbackSource);
      }

      if (!isEventedMediaElement(video)) {
        disposePlaybackBinding();
        return;
      }

      const currentUrl = state.playbackUrl ?? state.playback?.url;
      const isLivePlayback = state.playbackSource.isLive === true;
      const playToggleControl =
        root.querySelector<HTMLElement>("media-play-button") ?? undefined;
      const playbackRequestTarget =
        root.querySelector<HTMLElement>("media-controller") ??
        playToggleControl;
      const timeRangeControl =
        root.querySelector<HTMLElement>("media-time-range") ?? undefined;
      ensurePlaybackBinding(
        video,
        currentUrl,
        isLivePlayback ? LIVE_PLAYBACK_SYNC_EVENTS : undefined,
        playToggleControl,
        playbackRequestTarget,
        timeRangeControl,
      );
      ensurePlaybackBufferBinding(video, currentUrl, isLivePlayback);
      const isVodPlaybackHoldActive =
        !isLivePlayback &&
        state.playback !== undefined &&
        isRoomPlaybackHoldActive(state);
      playbackBufferBinding?.setPollingEnabled(isVodPlaybackHoldActive);
      if (!state.playback || !currentUrl) {
        resumeAfterPlaybackHold = false;
        return;
      }
      if (isVodPlaybackHoldActive) {
        // 等人同步只是在本地暂停等待缓冲，不改变房间目标播放态。
        // 等待解除后，即使本机刚刚是最后一次播放事件来源，也必须允许远端状态恢复播放。
        resumeAfterPlaybackHold = state.playback.playState === "playing";
        suppressLocalEventsUntil = Math.max(
          suppressLocalEventsUntil,
          getNow() + PLAYBACK_HOLD_SUPPRESS_LOCAL_EVENTS_MS,
        );
        if (!video.paused) {
          video.pause();
        }
        return;
      }
      if (state.playback.playState !== "playing") {
        resumeAfterPlaybackHold = false;
      }
      const shouldResumeLivePlayback =
        isLivePlayback && state.playback.playState === "playing";
      const shouldRetryVodHoldResume =
        !isLivePlayback &&
        resumeAfterPlaybackHold &&
        state.playback.playState === "playing";
      if (
        isLivePlayback &&
        state.playback.userInitiated !== true &&
        state.playback.playState !== "playing"
      ) {
        needsPlaybackHydration = false;
        return;
      }

      suppressLocalEventsUntil = getNow() + 500;
      try {
        const result = await applyRemotePlaybackState({
          media: video,
          localMemberId: state.currentMemberId,
          currentUrl,
          playback: state.playback,
          allowLocalEcho:
            loadedSource || needsPlaybackHydration || resumeAfterPlaybackHold,
          ...(isLivePlayback
            ? { seekToleranceSeconds: Number.POSITIVE_INFINITY }
            : {}),
          now: options.now,
        });
        if (shouldResumeLivePlayback && video.paused) {
          playbackPlayRetryController.schedule(video, generation, {
            allowMutedFallback: true,
          });
        }
        if (result.applied || result.reason !== "url_mismatch") {
          needsPlaybackHydration = false;
          resumeAfterPlaybackHold = false;
        }
      } catch (error) {
        if (
          shouldResumeLivePlayback &&
          generation === syncGeneration &&
          video.paused
        ) {
          if (isAutoplayBlockedError(error)) {
            const playedMuted =
              await playbackPlayRetryController.tryMutedPlayback(video);
            if (playedMuted) {
              needsPlaybackHydration = false;
              return;
            }
          }
          playbackPlayRetryController.schedule(video, generation, {
            allowMutedFallback: true,
          });
          needsPlaybackHydration = false;
          return;
        }
        if (
          shouldRetryVodHoldResume &&
          generation === syncGeneration &&
          video.paused &&
          !isAutoplayBlockedError(error)
        ) {
          // 等人同步释放时，远端成员可能仍处于 seek/buffer 收尾阶段。
          // 对短暂 interrupted 的 play() 做就绪重试，避免成员停在暂停状态。
          playbackPlayRetryController.schedule(video, generation);
          needsPlaybackHydration = false;
          return;
        }
        if (generation === syncGeneration) {
          options.onPlaybackError?.(error, state.playbackSource);
        }
      }
    },

    async dispose(): Promise<void> {
      if (typeof pageLifecycleTarget?.removeEventListener === "function") {
        pageLifecycleTarget.removeEventListener(
          "pagehide",
          handlePageLifecycleEnd,
        );
        pageLifecycleTarget.removeEventListener(
          "beforeunload",
          handlePageLifecycleEnd,
        );
        pageLifecycleTarget.removeEventListener(
          "pageshow",
          handlePageLifecycleShow,
        );
      }
      disposePlaybackBinding();
      playbackPlayRetryController.dispose();
      await elementController.dispose();
    },
  };
}
