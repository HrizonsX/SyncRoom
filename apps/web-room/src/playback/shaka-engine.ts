import type { PlaybackSource } from "./playback-adapter.js";
import type { PlaybackVideoElement } from "./playback-types.js";

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

const LIVE_STREAMING_BUFFER_BEHIND_SECONDS = 10;
const LIVE_STREAMING_BUFFERING_GOAL_SECONDS = 8;
const LIVE_STREAMING_PRESENTATION_DELAY_SECONDS = 6;
const LIVE_STREAMING_REBUFFERING_GOAL_SECONDS = 3;
const VOD_STREAMING_BUFFER_BEHIND_SECONDS = 30;
const VOD_STREAMING_BUFFERING_GOAL_SECONDS = 8;
const VOD_STREAMING_REBUFFERING_GOAL_SECONDS = 3;
const LIVE_RESUME_RELOAD_AFTER_PAUSE_MS = 1_500;

/**
 * 从不同打包形态的 shaka-player 模块里取出 Player 构造器。
 */
export function getShakaPlayerConstructor(
  moduleValue: unknown,
): ShakaPlayerConstructor {
  const module = moduleValue as ShakaPlayerModule;
  const Player = module.Player ?? module.default?.Player;
  if (!Player) {
    throw new Error("Shaka Player module did not expose Player.");
  }
  return Player;
}

/**
 * 按直播/VOD 场景配置 Shaka 缓冲策略，兼顾直播资源释放和点播等人同步。
 */
export function configureShakaPlayerForSource(
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
  } else {
    // 等人同步会把 VOD 暂停在同一目标时间；暂停时仍允许 Shaka 拉流，弱网成员才能在释放前补足缓冲。
    streamingConfig.bufferBehind = VOD_STREAMING_BUFFER_BEHIND_SECONDS;
    streamingConfig.bufferingGoal = VOD_STREAMING_BUFFERING_GOAL_SECONDS;
    streamingConfig.rebufferingGoal = VOD_STREAMING_REBUFFERING_GOAL_SECONDS;
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

/**
 * 为直播流绑定暂停后恢复播放的修复逻辑，必要时重新加载流以恢复首帧后的连续播放。
 */
export function bindLivePlaybackResume(args: {
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
