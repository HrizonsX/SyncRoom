import type { ClientMessage } from "@syncroom/protocol";
import {
  loadShakaPlayer as defaultLoadShakaPlayer,
  type PlaybackSource,
} from "./playback-adapter.js";
import {
  applyRemotePlaybackState,
  bindPlaybackSyncControls,
  type EventedMediaElementLike,
} from "./playback-sync.js";
import type { WebRoomState } from "./render.js";

export type PlaybackVideoElement = {
  src: string;
  load: () => void;
  removeAttribute: (name: string) => void;
};

export type ShakaPlayerInstance = {
  attach?: (video: PlaybackVideoElement) => Promise<unknown> | unknown;
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

export type PlaybackElementControllerOptions = {
  loadShakaPlayer?: () => Promise<unknown>;
};

export type WebRoomPlaybackControllerOptions =
  PlaybackElementControllerOptions & {
    onPlaybackError?: (error: unknown, source: PlaybackSource) => void;
    getSyncContext?: () => {
      memberToken: string;
      actorId: string;
      url: string;
    } | null;
    nextSeq?: () => number;
    dispatchPlaybackUpdate?: (
      message: Extract<ClientMessage, { type: "playback:update" }>,
    ) => void;
    now?: () => number;
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

function getSourceKey(source: PlaybackSource): string {
  return `${source.engine}:${source.sourceType}:${source.url}`;
}

export function createPlaybackElementController(
  options: PlaybackElementControllerOptions = {},
) {
  const loadShakaPlayer = options.loadShakaPlayer ?? defaultLoadShakaPlayer;
  let currentSourceKey: string | undefined;
  let currentVideo: PlaybackVideoElement | undefined;
  let shakaPlayer: ShakaPlayerInstance | undefined;
  let pendingLoad:
    | {
        sourceKey: string;
        video: PlaybackVideoElement;
        promise: Promise<void>;
      }
    | undefined;

  async function destroyShakaPlayer(): Promise<void> {
    if (!shakaPlayer) {
      return;
    }
    await shakaPlayer.destroy?.();
    shakaPlayer = undefined;
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
        pendingLoad = undefined;
        await destroyShakaPlayer();
        video.src = source.url;
        video.load();
        currentSourceKey = nextSourceKey;
        return true;
      }

      const player = await ensureShakaPlayer(video);
      video.removeAttribute("src");
      currentSourceKey = undefined;
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
  let suppressLocalEventsUntil = 0;
  let syncGeneration = 0;
  let needsPlaybackHydration = true;

  function getNow(): number {
    return options.now?.() ?? Date.now();
  }

  function disposePlaybackBinding(): void {
    playbackBinding?.dispose();
    playbackBinding = undefined;
    boundMedia = undefined;
    boundSyncUrl = undefined;
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
    if (playbackBinding && boundMedia === media && boundSyncUrl === syncUrl) {
      return;
    }

    disposePlaybackBinding();
    boundMedia = media;
    boundSyncUrl = syncUrl;
    playbackBinding = bindPlaybackSyncControls({
      media,
      getContext: () => {
        if (getNow() < suppressLocalEventsUntil) {
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
      }

      if (!isEventedMediaElement(video)) {
        disposePlaybackBinding();
        return;
      }

      const currentUrl = state.playbackUrl ?? state.playback?.url;
      ensurePlaybackBinding(video, currentUrl);
      if (!state.playback || !currentUrl) {
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
          now: options.now,
        });
        if (result.applied || result.reason !== "url_mismatch") {
          needsPlaybackHydration = false;
        }
      } catch (error) {
        if (generation === syncGeneration) {
          options.onPlaybackError?.(error, state.playbackSource);
        }
      }
    },

    async dispose(): Promise<void> {
      disposePlaybackBinding();
      await elementController.dispose();
    },
  };
}
