import type { ClientMessage } from "@syncroom/protocol";
import {
  loadMpegtsPlayer as defaultLoadMpegtsPlayer,
  loadShakaPlayer as defaultLoadShakaPlayer,
  type PlaybackSource,
} from "./playback-adapter.js";
import {
  applyRemotePlaybackState,
  bindPlaybackSyncControls,
  type EventedMediaElementLike,
  type LocalPlaybackEvent,
} from "./playback-sync.js";
import type { WebRoomState } from "./render.js";

export type PlaybackVideoElement = {
  src: string;
  load: () => void;
  removeAttribute: (name: string) => void;
};

export type ShakaPlayerInstance = {
  attach?: (video: PlaybackVideoElement) => Promise<unknown> | unknown;
  configure?: (
    config: Record<string, unknown> | string,
    value?: unknown,
  ) => void;
  load: (url: string) => Promise<unknown>;
  destroy?: () => Promise<unknown> | unknown;
};

export type ShakaPlayerConstructor = new (
  video?: PlaybackVideoElement,
) => ShakaPlayerInstance;

export type ShakaPlayerModule = {
  Player?: ShakaPlayerConstructor;
  default?: {
    Player?: ShakaPlayerConstructor;
  };
};

export type MpegtsMediaDataSource = {
  type: "flv" | "mpegts";
  url: string;
  isLive?: boolean;
};

export type MpegtsPlayerConfig = Record<string, unknown>;

export type MpegtsPlayerInstance = {
  attachMediaElement: (video: PlaybackVideoElement) => void;
  load: () => void;
  unload?: () => void;
  detachMediaElement?: () => void;
  destroy?: () => void;
};

export type MpegtsPlayerModule = {
  isSupported?: () => boolean;
  createPlayer?: (
    mediaDataSource: MpegtsMediaDataSource,
    config?: MpegtsPlayerConfig,
  ) => MpegtsPlayerInstance;
  default?: {
    isSupported?: () => boolean;
    createPlayer?: (
      mediaDataSource: MpegtsMediaDataSource,
      config?: MpegtsPlayerConfig,
    ) => MpegtsPlayerInstance;
  };
};

export type PlaybackElementControllerOptions = {
  loadShakaPlayer?: () => Promise<unknown>;
  loadMpegtsPlayer?: () => Promise<unknown>;
  now?: () => number;
};

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

function getShakaPlayerConstructor(
  moduleValue: unknown,
): ShakaPlayerConstructor {
  const module = moduleValue as ShakaPlayerModule;
  const Player = module.Player ?? module.default?.Player;
  if (!Player) {
    throw new Error("Shaka Player module did not expose Player.");
  }
  return Player;
}

function getMpegtsApi(moduleValue: unknown): Required<MpegtsPlayerModule> {
  const module = moduleValue as MpegtsPlayerModule;
  const createPlayer = module.createPlayer ?? module.default?.createPlayer;
  const isSupported =
    module.isSupported ?? module.default?.isSupported ?? (() => true);
  if (!createPlayer) {
    throw new Error("mpegts.js module did not expose createPlayer.");
  }
  return {
    isSupported,
    createPlayer,
    default: {
      isSupported,
      createPlayer,
    },
  };
}

function getSourceKey(source: PlaybackSource): string {
  return `${source.engine}:${source.sourceType}:${source.url}:${source.candidateId ?? ""}`;
}

const LIVE_STREAMING_BUFFER_BEHIND_SECONDS = 10;
const LIVE_STREAMING_BUFFERING_GOAL_SECONDS = 8;
const LIVE_STREAMING_PRESENTATION_DELAY_SECONDS = 6;
const LIVE_STREAMING_REBUFFERING_GOAL_SECONDS = 3;
const LIVE_RESUME_RELOAD_AFTER_PAUSE_MS = 1_500;
const LIVE_HYDRATION_PLAY_RETRY_DELAY_MS = 500;
const LIVE_HYDRATION_PLAY_RETRY_WINDOW_MS = 4_000;
const MPEGTS_LIVE_STASH_INITIAL_SIZE = 1024 * 1024;
const MPEGTS_LIVE_BACKWARD_BUFFER_SECONDS = 10;
const MPEGTS_LIVE_MIN_BACKWARD_BUFFER_SECONDS = 5;
const MPEGTS_LIVE_MAX_LATENCY_SECONDS = 6;
const MPEGTS_LIVE_MIN_REMAIN_SECONDS = 2;
const LIVE_PLAYBACK_SYNC_EVENTS: readonly LocalPlaybackEvent[] = [
  "play",
  "pause",
];

function configureShakaPlayerForSource(
  player: ShakaPlayerInstance,
  source: PlaybackSource,
  options: { continueLiveLoadingWhenPaused?: boolean } = {},
): void {
  if (typeof player.configure !== "function") {
    return;
  }
  const isLive = source.isLive === true;
  const manifestConfig: Record<string, unknown> = {
    continueLoadingWhenPaused: isLive
      ? options.continueLiveLoadingWhenPaused === true
      : true,
  };
  const streamingConfig: Record<string, unknown> = {
    stopFetchingOnPause: isLive,
  };
  if (isLive) {
    manifestConfig.defaultPresentationDelay =
      LIVE_STREAMING_PRESENTATION_DELAY_SECONDS;
    streamingConfig.bufferBehind = LIVE_STREAMING_BUFFER_BEHIND_SECONDS;
    streamingConfig.bufferingGoal = LIVE_STREAMING_BUFFERING_GOAL_SECONDS;
    streamingConfig.lowLatencyMode = false;
    streamingConfig.rebufferingGoal = LIVE_STREAMING_REBUFFERING_GOAL_SECONDS;
  }

  player.configure({
    manifest: manifestConfig,
    streaming: streamingConfig,
  });
}

type LiveResumeVideoElement = PlaybackVideoElement & {
  addEventListener?: (type: "play" | "pause", listener: () => void) => void;
  removeEventListener?: (type: "play" | "pause", listener: () => void) => void;
  readonly paused?: boolean;
  play?: () => Promise<void> | void;
};

type LiveHydrationRetryMediaElement = EventedMediaElementLike & {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

type MutableAudioMediaElement = EventedMediaElementLike & {
  muted: boolean;
  defaultMuted?: boolean;
};

function bindLivePlaybackResume(args: {
  player: ShakaPlayerInstance;
  video: PlaybackVideoElement;
  source: PlaybackSource;
  now: () => number;
}): { dispose: () => void } | undefined {
  if (args.source.isLive !== true) {
    return undefined;
  }
  const video = args.video as LiveResumeVideoElement;
  if (
    typeof video.addEventListener !== "function" ||
    typeof video.removeEventListener !== "function"
  ) {
    return undefined;
  }

  let pausedSinceLastPlay = false;
  let pausedAt: number | undefined;
  let resumeLoadInFlight: Promise<unknown> | undefined;
  const handlePause = (): void => {
    pausedSinceLastPlay = true;
    pausedAt = args.now();
    configureShakaPlayerForSource(args.player, args.source, {
      continueLiveLoadingWhenPaused: false,
    });
  };
  const handlePlay = (): void => {
    configureShakaPlayerForSource(args.player, args.source, {
      continueLiveLoadingWhenPaused: true,
    });
    if (!pausedSinceLastPlay || resumeLoadInFlight) {
      return;
    }
    const shouldResumePlayback =
      typeof video.paused !== "boolean" || video.paused === false;
    const pauseDurationMs =
      pausedAt === undefined
        ? LIVE_RESUME_RELOAD_AFTER_PAUSE_MS
        : args.now() - pausedAt;
    pausedSinceLastPlay = false;
    pausedAt = undefined;
    if (pauseDurationMs < LIVE_RESUME_RELOAD_AFTER_PAUSE_MS) {
      if (
        shouldResumePlayback &&
        typeof video.play === "function" &&
        video.paused !== false
      ) {
        void Promise.resolve(video.play()).catch(() => undefined);
      }
      return;
    }
    resumeLoadInFlight = args.player
      .load(args.source.url)
      .then(async () => {
        if (
          shouldResumePlayback &&
          typeof video.play === "function" &&
          video.paused !== false
        ) {
          await video.play();
        }
      })
      .finally(() => {
        resumeLoadInFlight = undefined;
      });
    void resumeLoadInFlight.catch(() => undefined);
  };

  video.addEventListener("pause", handlePause);
  video.addEventListener("play", handlePlay);
  return {
    dispose() {
      video.removeEventListener?.("pause", handlePause);
      video.removeEventListener?.("play", handlePlay);
    },
  };
}

function createMpegtsMediaDataSource(
  source: PlaybackSource,
): MpegtsMediaDataSource {
  return {
    type: source.sourceType === "ts" ? "mpegts" : "flv",
    url: source.url,
    ...(source.isLive ? { isLive: true } : {}),
  };
}

function createMpegtsPlayerConfig(source: PlaybackSource): MpegtsPlayerConfig {
  if (source.isLive !== true) {
    return {};
  }
  return {
    enableStashBuffer: true,
    stashInitialSize: MPEGTS_LIVE_STASH_INITIAL_SIZE,
    lazyLoad: false,
    autoCleanupSourceBuffer: true,
    autoCleanupMaxBackwardDuration: MPEGTS_LIVE_BACKWARD_BUFFER_SECONDS,
    autoCleanupMinBackwardDuration: MPEGTS_LIVE_MIN_BACKWARD_BUFFER_SECONDS,
    liveBufferLatencyChasing: true,
    liveBufferLatencyMaxLatency: MPEGTS_LIVE_MAX_LATENCY_SECONDS,
    liveBufferLatencyMinRemain: MPEGTS_LIVE_MIN_REMAIN_SECONDS,
  };
}

type NativePlaybackVideoElement = PlaybackVideoElement & {
  readonly readyState?: number;
  readonly error?: { readonly code?: number; readonly message?: string } | null;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
};

const HAVE_METADATA_READY_STATE = 1;

function hasNativeMetadata(video: NativePlaybackVideoElement): boolean {
  return (
    typeof video.readyState === "number" &&
    video.readyState >= HAVE_METADATA_READY_STATE
  );
}

function getNativeMediaErrorMessage(video: NativePlaybackVideoElement): string {
  const mediaError = video.error;
  const code =
    typeof mediaError?.code === "number" ? ` (code ${mediaError.code})` : "";
  const detail = mediaError?.message?.trim()
    ? `: ${mediaError.message.trim()}`
    : "";
  return `Native media failed to load${code}${detail}.`;
}

function waitForNativeMetadata(video: PlaybackVideoElement): Promise<void> {
  const nativeVideo = video as NativePlaybackVideoElement;
  if (hasNativeMetadata(nativeVideo)) {
    return Promise.resolve();
  }
  if (
    typeof nativeVideo.addEventListener !== "function" ||
    typeof nativeVideo.removeEventListener !== "function"
  ) {
    return Promise.resolve();
  }
  const addEventListener = nativeVideo.addEventListener.bind(nativeVideo);
  const removeEventListener = nativeVideo.removeEventListener.bind(nativeVideo);

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      removeEventListener("loadedmetadata", handleReady);
      removeEventListener("loadeddata", handleReady);
      removeEventListener("canplay", handleReady);
      removeEventListener("error", handleError);
    };
    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      reject(error);
    };
    function handleReady(): void {
      finish();
    }
    function handleError(): void {
      fail(new Error(getNativeMediaErrorMessage(nativeVideo)));
    }

    addEventListener("loadedmetadata", handleReady);
    addEventListener("loadeddata", handleReady);
    addEventListener("canplay", handleReady);
    addEventListener("error", handleError);

    if (hasNativeMetadata(nativeVideo)) {
      finish();
    } else if (nativeVideo.error) {
      handleError();
    }
  });
}

export function createPlaybackElementController(
  options: PlaybackElementControllerOptions = {},
) {
  const loadShakaPlayer = options.loadShakaPlayer ?? defaultLoadShakaPlayer;
  const loadMpegtsPlayer = options.loadMpegtsPlayer ?? defaultLoadMpegtsPlayer;
  const getNow = (): number => options.now?.() ?? Date.now();
  let currentSourceKey: string | undefined;
  let currentVideo: PlaybackVideoElement | undefined;
  let shakaPlayer: ShakaPlayerInstance | undefined;
  let mpegtsPlayer: MpegtsPlayerInstance | undefined;
  let livePlaybackResumeBinding: { dispose: () => void } | undefined;
  let pendingLoad:
    | {
        sourceKey: string;
        video: PlaybackVideoElement;
        promise: Promise<void>;
      }
    | undefined;

  function disposeLivePlaybackResumeBinding(): void {
    livePlaybackResumeBinding?.dispose();
    livePlaybackResumeBinding = undefined;
  }

  async function destroyShakaPlayer(): Promise<void> {
    disposeLivePlaybackResumeBinding();
    if (!shakaPlayer) {
      return;
    }
    await shakaPlayer.destroy?.();
    shakaPlayer = undefined;
  }

  function destroyMpegtsPlayer(): void {
    if (!mpegtsPlayer) {
      return;
    }
    const player = mpegtsPlayer;
    mpegtsPlayer = undefined;
    player.unload?.();
    player.detachMediaElement?.();
    player.destroy?.();
  }

  async function ensureShakaPlayer(
    video: PlaybackVideoElement,
  ): Promise<ShakaPlayerInstance> {
    if (shakaPlayer && currentVideo === video) {
      return shakaPlayer;
    }
    await destroyShakaPlayer();
    const Player = getShakaPlayerConstructor(await loadShakaPlayer());
    let player = new Player();
    if (typeof player.attach === "function") {
      await player.attach(video);
    } else {
      await player.destroy?.();
      player = new Player(video);
    }
    shakaPlayer = player;
    return shakaPlayer;
  }

  async function recreateShakaPlayerIfSourceChanged(
    video: PlaybackVideoElement,
    nextSourceKey: string,
  ): Promise<void> {
    if (!shakaPlayer || currentVideo !== video) {
      return;
    }
    const hasNoKnownSource = !currentSourceKey && !pendingLoad;
    const hasDifferentLoadedSource =
      currentSourceKey !== undefined && currentSourceKey !== nextSourceKey;
    const hasDifferentPendingSource =
      pendingLoad !== undefined &&
      pendingLoad.video === video &&
      pendingLoad.sourceKey !== nextSourceKey;
    if (
      !hasNoKnownSource &&
      !hasDifferentLoadedSource &&
      !hasDifferentPendingSource
    ) {
      return;
    }
    await destroyShakaPlayer();
    currentSourceKey = undefined;
  }

  return {
    async load(
      video: PlaybackVideoElement,
      source: PlaybackSource,
    ): Promise<boolean> {
      const nextSourceKey = getSourceKey(source);
      if (currentSourceKey === nextSourceKey && currentVideo === video) {
        return false;
      }
      if (
        pendingLoad &&
        pendingLoad.sourceKey === nextSourceKey &&
        pendingLoad.video === video
      ) {
        await pendingLoad.promise;
        return false;
      }

      currentVideo = video;
      if (source.engine === "native") {
        const nextPendingLoad = {
          sourceKey: nextSourceKey,
          video,
          promise: Promise.resolve(),
        };
        pendingLoad = nextPendingLoad;
        nextPendingLoad.promise = (async () => {
          await destroyShakaPlayer();
          destroyMpegtsPlayer();
          disposeLivePlaybackResumeBinding();
          currentSourceKey = undefined;
          video.src = source.url;
          video.load();
          await waitForNativeMetadata(video);
          if (pendingLoad === nextPendingLoad) {
            currentSourceKey = nextSourceKey;
          }
        })().finally(() => {
          if (pendingLoad === nextPendingLoad) {
            pendingLoad = undefined;
          }
        });
        await nextPendingLoad.promise;
        return true;
      }

      if (source.engine === "mpegts") {
        const nextPendingLoad = {
          sourceKey: nextSourceKey,
          video,
          promise: Promise.resolve(),
        };
        pendingLoad = nextPendingLoad;
        nextPendingLoad.promise = (async () => {
          await destroyShakaPlayer();
          destroyMpegtsPlayer();
          disposeLivePlaybackResumeBinding();
          currentSourceKey = undefined;
          const mpegts = getMpegtsApi(await loadMpegtsPlayer());
          if (!mpegts.isSupported()) {
            throw new Error("mpegts.js is not supported in this browser.");
          }
          video.removeAttribute("src");
          const player = mpegts.createPlayer(
            createMpegtsMediaDataSource(source),
            createMpegtsPlayerConfig(source),
          );
          mpegtsPlayer = player;
          try {
            player.attachMediaElement(video);
            player.load();
          } catch (error) {
            destroyMpegtsPlayer();
            throw error;
          }
          if (pendingLoad === nextPendingLoad) {
            currentSourceKey = nextSourceKey;
          }
        })().finally(() => {
          if (pendingLoad === nextPendingLoad) {
            pendingLoad = undefined;
          }
        });
        await nextPendingLoad.promise;
        return true;
      }

      await recreateShakaPlayerIfSourceChanged(video, nextSourceKey);
      destroyMpegtsPlayer();
      const player = await ensureShakaPlayer(video);
      configureShakaPlayerForSource(player, source);
      video.removeAttribute("src");
      currentSourceKey = undefined;
      disposeLivePlaybackResumeBinding();
      const nextPendingLoad = {
        sourceKey: nextSourceKey,
        video,
        promise: Promise.resolve(),
      };
      nextPendingLoad.promise = player
        .load(source.url)
        .then(() => {
          if (pendingLoad === nextPendingLoad) {
            currentSourceKey = nextSourceKey;
            livePlaybackResumeBinding = bindLivePlaybackResume({
              player,
              video,
              source,
              now: getNow,
            });
          }
        })
        .finally(() => {
          if (pendingLoad === nextPendingLoad) {
            pendingLoad = undefined;
          }
        });
      pendingLoad = nextPendingLoad;
      await nextPendingLoad.promise;
      return true;
    },

    async clear(): Promise<void> {
      currentSourceKey = undefined;
      currentVideo = undefined;
      pendingLoad = undefined;
      await destroyShakaPlayer();
      destroyMpegtsPlayer();
    },

    async dispose(): Promise<void> {
      await this.clear();
    },
  };
}

export function createWebRoomPlaybackController(
  options: WebRoomPlaybackControllerOptions = {},
) {
  const elementController = createPlaybackElementController(options);
  let playbackBinding: { dispose: () => void } | undefined;
  let boundMedia: EventedMediaElementLike | undefined;
  let boundSyncUrl: string | undefined;
  let boundSyncEventsKey: string | undefined;
  let suppressLocalEventsUntil = 0;
  let syncGeneration = 0;
  let needsPlaybackHydration = true;
  let liveHydrationPlayRetry: { dispose: () => void } | undefined;
  let pageLifecycleEnding = false;
  const pageLifecycleTarget =
    options.pageLifecycleTarget === undefined
      ? ((globalThis as Partial<PlaybackPageLifecycleTarget>) ?? null)
      : options.pageLifecycleTarget;

  const handlePageLifecycleEnd = (): void => {
    // Browser refresh/navigation can emit a media pause while tearing down the
    // page. Treat that as lifecycle noise instead of a user pause command.
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

  function disposePlaybackBinding(): void {
    playbackBinding?.dispose();
    playbackBinding = undefined;
    boundMedia = undefined;
    boundSyncUrl = undefined;
    boundSyncEventsKey = undefined;
  }

  function disposeLiveHydrationPlayRetry(): void {
    liveHydrationPlayRetry?.dispose();
    liveHydrationPlayRetry = undefined;
  }

  function isAutoplayBlockedError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }
    return (
      error.name === "NotAllowedError" ||
      /autoplay|user.*interact|user.*gesture|not allowed/i.test(error.message)
    );
  }

  function isMutableAudioMediaElement(
    media: EventedMediaElementLike,
  ): media is MutableAudioMediaElement {
    return (
      typeof (media as Partial<MutableAudioMediaElement>).muted === "boolean"
    );
  }

  async function tryMutedLiveHydrationPlayback(
    media: EventedMediaElementLike,
  ): Promise<boolean> {
    if (!media.paused || !isMutableAudioMediaElement(media)) {
      return false;
    }
    media.muted = true;
    media.defaultMuted = true;
    suppressLocalEventsUntil = Math.max(
      suppressLocalEventsUntil,
      getNow() + LIVE_HYDRATION_PLAY_RETRY_DELAY_MS,
    );
    try {
      await media.play();
      return !media.paused;
    } catch {
      return false;
    }
  }

  function scheduleLiveHydrationPlayRetry(
    media: EventedMediaElementLike,
    generation: number,
  ): void {
    disposeLiveHydrationPlayRetry();
    if (!media.paused) {
      return;
    }

    const retryMedia = media as LiveHydrationRetryMediaElement;
    const retryEvents = ["canplay", "loadeddata", "playing"] as const;
    const deadline = getNow() + LIVE_HYDRATION_PLAY_RETRY_WINDOW_MS;
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const clearRetryTimer = (): void => {
      if (retryTimer === undefined) {
        return;
      }
      clearTimeout(retryTimer);
      retryTimer = undefined;
    };

    const cleanup = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      clearRetryTimer();
      for (const event of retryEvents) {
        retryMedia.removeEventListener(event, retryNow);
      }
      if (liveHydrationPlayRetry?.dispose === cleanup) {
        liveHydrationPlayRetry = undefined;
      }
    };

    const scheduleNextRetry = (): void => {
      if (disposed || generation !== syncGeneration || getNow() >= deadline) {
        cleanup();
        return;
      }
      clearRetryTimer();
      retryTimer = setTimeout(retryNow, LIVE_HYDRATION_PLAY_RETRY_DELAY_MS);
    };

    function retryNow(): void {
      if (disposed || generation !== syncGeneration) {
        cleanup();
        return;
      }
      if (!media.paused) {
        cleanup();
        return;
      }
      suppressLocalEventsUntil = Math.max(
        suppressLocalEventsUntil,
        getNow() + LIVE_HYDRATION_PLAY_RETRY_DELAY_MS,
      );
      clearRetryTimer();
      void Promise.resolve(media.play())
        .then(() => {
          if (media.paused) {
            scheduleNextRetry();
          } else {
            cleanup();
          }
        })
        .catch((error) => {
          if (isAutoplayBlockedError(error)) {
            void tryMutedLiveHydrationPlayback(media).then((played) => {
              if (played) {
                cleanup();
              } else {
                scheduleNextRetry();
              }
            });
            return;
          }
          scheduleNextRetry();
        });
    }

    for (const event of retryEvents) {
      retryMedia.addEventListener(event, retryNow);
    }
    liveHydrationPlayRetry = { dispose: cleanup };
    scheduleNextRetry();
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
      boundSyncEventsKey === eventsKey
    ) {
      return;
    }

    disposePlaybackBinding();
    boundMedia = media;
    boundSyncUrl = syncUrl;
    boundSyncEventsKey = eventsKey;
    playbackBinding = bindPlaybackSyncControls({
      media,
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

  return {
    async sync(root: ParentNode, state: WebRoomState): Promise<void> {
      const generation = ++syncGeneration;
      disposeLiveHydrationPlayRetry();
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
      ensurePlaybackBinding(
        video,
        currentUrl,
        isLivePlayback ? LIVE_PLAYBACK_SYNC_EVENTS : undefined,
      );
      if (!state.playback || !currentUrl) {
        return;
      }
      const shouldResumeLivePlayback =
        isLivePlayback && state.playback.playState === "playing";
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
          allowLocalEcho: loadedSource || needsPlaybackHydration,
          ...(isLivePlayback
            ? { seekToleranceSeconds: Number.POSITIVE_INFINITY }
            : {}),
          now: options.now,
        });
        if (shouldResumeLivePlayback && video.paused) {
          scheduleLiveHydrationPlayRetry(video, generation);
        }
        if (result.applied || result.reason !== "url_mismatch") {
          needsPlaybackHydration = false;
        }
      } catch (error) {
        if (
          shouldResumeLivePlayback &&
          generation === syncGeneration &&
          video.paused
        ) {
          if (isAutoplayBlockedError(error)) {
            const playedMuted = await tryMutedLiveHydrationPlayback(video);
            if (playedMuted) {
              needsPlaybackHydration = false;
              return;
            }
          }
          scheduleLiveHydrationPlayRetry(video, generation);
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
      disposeLiveHydrationPlayRetry();
      await elementController.dispose();
    },
  };
}
