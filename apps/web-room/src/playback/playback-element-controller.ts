import {
  loadMpegtsPlayer as defaultLoadMpegtsPlayer,
  loadShakaPlayer as defaultLoadShakaPlayer,
  type PlaybackSource,
} from "./playback-adapter.js";
import {
  createMpegtsMediaDataSource,
  createMpegtsPlayerConfig,
  getMpegtsApi,
  type MpegtsPlayerInstance,
} from "./mpegts-engine.js";
import { waitForNativeMetadata } from "./native-engine.js";
import type { PlaybackVideoElement } from "./playback-types.js";
import {
  bindLivePlaybackResume,
  configureShakaPlayerForSource,
  getShakaPlayerConstructor,
  type ShakaPlayerInstance,
} from "./shaka-engine.js";

export type PlaybackElementControllerOptions = {
  loadShakaPlayer?: () => Promise<unknown>;
  loadMpegtsPlayer?: () => Promise<unknown>;
  now?: () => number;
};

function getSourceKey(source: PlaybackSource): string {
  return `${source.engine}:${source.sourceType}:${source.url}:${source.candidateId ?? ""}`;
}

/**
 * 管理同一个 video 元素上的具体播放引擎实例，负责在 native/Shaka/mpegts 之间安全切换。
 */
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
      // 保存 pendingLoad 可以避免同一清晰度/同一元素的重复加载互相打断。
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
