import type { PlaybackSource } from "./playback-adapter.js";
import type { PlaybackVideoElement } from "./playback-types.js";

export type MpegtsMediaDataSource = {
  type: "flv" | "mpegts";
  url: string;
  isLive?: boolean;
};

export type MpegtsPlayerConfig = Record<string, unknown>;

export type MpegtsPlayerInstance = {
  attachMediaElement: (video: PlaybackVideoElement) => void;
  load: () => void;
  off?: (event: "error", listener: (...args: unknown[]) => void) => void;
  on?: (event: "error", listener: (...args: unknown[]) => void) => void;
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

const MPEGTS_LIVE_STASH_INITIAL_SIZE = 1024 * 1024;
const MPEGTS_LIVE_BACKWARD_BUFFER_SECONDS = 10;
const MPEGTS_LIVE_MIN_BACKWARD_BUFFER_SECONDS = 5;
const MPEGTS_LIVE_MAX_LATENCY_SECONDS = 6;
const MPEGTS_LIVE_MIN_REMAIN_SECONDS = 2;

/**
 * 兼容 mpegts.js 的不同导出形态，统一取出播放器创建 API。
 */
export function getMpegtsApi(
  moduleValue: unknown,
): Required<MpegtsPlayerModule> {
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

/**
 * 根据当前播放源生成 mpegts.js 需要的数据源描述，区分 FLV 与 TS 直播流。
 */
export function createMpegtsMediaDataSource(
  source: PlaybackSource,
): MpegtsMediaDataSource {
  return {
    type: source.sourceType === "ts" ? "mpegts" : "flv",
    url: source.url,
    ...(source.isLive ? { isLive: true } : {}),
  };
}

/**
 * 生成 FLV/TS 播放配置；直播流会开启小缓冲和 SourceBuffer 清理来降低卡顿与内存增长。
 */
export function createMpegtsPlayerConfig(
  source: PlaybackSource,
): MpegtsPlayerConfig {
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
