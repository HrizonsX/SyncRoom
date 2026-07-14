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
  onRuntimeError?: (error: unknown, source: PlaybackSource) => void;
  now?: () => number;
};

function getSourceKey(source: PlaybackSource): string {
  return `${source.engine}:${source.sourceType}:${source.url}:${source.candidateId ?? ""}`;
}

function stringifyRuntimeErrorValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function describeRuntimeErrorPayload(payload: unknown): string {
  if (payload instanceof Error) {
    return payload.message;
  }
  if (typeof payload === "string") {
    return payload;
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const parts = [
      record.message,
      record.code,
      record.category,
      record.severity,
      record.reason,
      record.url,
      record.detail,
      record.details,
      record.data,
    ]
      .filter((value) => value !== undefined)
      .map(stringifyRuntimeErrorValue);
    if (parts.length > 0) {
      return parts.join(" ");
    }
    try {
      return JSON.stringify(record);
    } catch {
      return String(payload);
    }
  }
  return String(payload);
}

function readShakaRuntimeError(event: unknown): Error {
  const record =
    event && typeof event === "object"
      ? (event as Record<string, unknown>)
      : undefined;
  const payload = record?.detail ?? record?.error ?? event;
  return new Error(
    `Shaka runtime error: ${describeRuntimeErrorPayload(payload)}`,
  );
}

function readMpegtsRuntimeError(args: readonly unknown[]): Error {
  return new Error(
    `mpegts runtime error: ${args.map(describeRuntimeErrorPayload).join(" ")}`,
  );
}

function readNativeRuntimeError(video: PlaybackVideoElement): Error {
  const mediaError = (
    video as PlaybackVideoElement & {
      error?: { code?: number; message?: string } | null;
    }
  ).error;
  const suffix = [
    mediaError?.code === undefined ? undefined : `code ${mediaError.code}`,
    mediaError?.message,
  ]
    .filter(Boolean)
    .join(" ");
  return new Error(
    `Native playback runtime network error${suffix ? ` ${suffix}` : ""}`,
  );
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
  let nativeRuntimeErrorBinding: { dispose: () => void } | undefined;
  let shakaRuntimeErrorBinding: { dispose: () => void } | undefined;
  let mpegtsRuntimeErrorBinding: { dispose: () => void } | undefined;
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

  function disposeNativeRuntimeErrorBinding(): void {
    nativeRuntimeErrorBinding?.dispose();
    nativeRuntimeErrorBinding = undefined;
  }

  function disposeShakaRuntimeErrorBinding(): void {
    shakaRuntimeErrorBinding?.dispose();
    shakaRuntimeErrorBinding = undefined;
  }

  function disposeMpegtsRuntimeErrorBinding(): void {
    mpegtsRuntimeErrorBinding?.dispose();
    mpegtsRuntimeErrorBinding = undefined;
  }

  function shouldReportRuntimeError(
    sourceKey: string,
    video: PlaybackVideoElement,
  ): boolean {
    return (
      (currentSourceKey === sourceKey && currentVideo === video) ||
      (pendingLoad?.sourceKey === sourceKey && pendingLoad.video === video)
    );
  }

  function reportRuntimeError(
    error: unknown,
    source: PlaybackSource,
    sourceKey: string,
    video: PlaybackVideoElement,
  ): void {
    if (!shouldReportRuntimeError(sourceKey, video)) {
      return;
    }
    options.onRuntimeError?.(error, source);
  }

  function bindNativeRuntimeError(
    video: PlaybackVideoElement,
    source: PlaybackSource,
    sourceKey: string,
  ): void {
    const eventedVideo = video as PlaybackVideoElement & {
      addEventListener?: (type: "error", listener: () => void) => void;
      removeEventListener?: (type: "error", listener: () => void) => void;
    };
    if (
      typeof eventedVideo.addEventListener !== "function" ||
      typeof eventedVideo.removeEventListener !== "function"
    ) {
      return;
    }
    const handleError = (): void => {
      reportRuntimeError(
        readNativeRuntimeError(video),
        source,
        sourceKey,
        video,
      );
    };
    eventedVideo.addEventListener("error", handleError);
    nativeRuntimeErrorBinding = {
      dispose() {
        eventedVideo.removeEventListener?.("error", handleError);
      },
    };
  }

  function bindShakaRuntimeError(
    player: ShakaPlayerInstance,
    video: PlaybackVideoElement,
    source: PlaybackSource,
    sourceKey: string,
  ): void {
    if (
      typeof player.addEventListener !== "function" ||
      typeof player.removeEventListener !== "function"
    ) {
      return;
    }
    const handleError = (event: unknown): void => {
      reportRuntimeError(
        readShakaRuntimeError(event),
        source,
        sourceKey,
        video,
      );
    };
    player.addEventListener("error", handleError);
    shakaRuntimeErrorBinding = {
      dispose() {
        player.removeEventListener?.("error", handleError);
      },
    };
  }

  function bindMpegtsRuntimeError(
    player: MpegtsPlayerInstance,
    video: PlaybackVideoElement,
    source: PlaybackSource,
    sourceKey: string,
  ): void {
    if (typeof player.on !== "function" || typeof player.off !== "function") {
      return;
    }
    const handleError = (...args: unknown[]): void => {
      reportRuntimeError(
        readMpegtsRuntimeError(args),
        source,
        sourceKey,
        video,
      );
    };
    player.on("error", handleError);
    mpegtsRuntimeErrorBinding = {
      dispose() {
        player.off?.("error", handleError);
      },
    };
  }

  async function destroyShakaPlayer(): Promise<void> {
    disposeLivePlaybackResumeBinding();
    disposeShakaRuntimeErrorBinding();
    if (!shakaPlayer) {
      return;
    }
    await shakaPlayer.destroy?.();
    shakaPlayer = undefined;
  }

  function destroyMpegtsPlayer(): void {
    disposeMpegtsRuntimeErrorBinding();
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
          disposeNativeRuntimeErrorBinding();
          disposeLivePlaybackResumeBinding();
          currentSourceKey = undefined;
          video.src = source.url;
          video.load();
          await waitForNativeMetadata(video);
          if (pendingLoad === nextPendingLoad) {
            currentSourceKey = nextSourceKey;
            bindNativeRuntimeError(video, source, nextSourceKey);
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
          disposeNativeRuntimeErrorBinding();
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
          bindMpegtsRuntimeError(player, video, source, nextSourceKey);
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
      disposeNativeRuntimeErrorBinding();
      const player = await ensureShakaPlayer(video);
      configureShakaPlayerForSource(player, source);
      video.removeAttribute("src");
      currentSourceKey = undefined;
      disposeLivePlaybackResumeBinding();
      disposeShakaRuntimeErrorBinding();
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
            bindShakaRuntimeError(player, video, source, nextSourceKey);
            livePlaybackResumeBinding = bindLivePlaybackResume({
              player,
              video,
              source,
              now: getNow,
              onError: (error) =>
                reportRuntimeError(error, source, nextSourceKey, video),
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
      disposeNativeRuntimeErrorBinding();
      await destroyShakaPlayer();
      destroyMpegtsPlayer();
    },

    async dispose(): Promise<void> {
      await this.clear();
    },
  };
}
