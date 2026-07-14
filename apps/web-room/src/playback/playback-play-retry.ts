import type { EventedMediaElementLike } from "./playback-sync.js";

const DEFAULT_PLAYBACK_PLAY_RETRY_DELAY_MS = 500;
const DEFAULT_PLAYBACK_PLAY_RETRY_WINDOW_MS = 4_000;

type LiveHydrationRetryMediaElement = EventedMediaElementLike & {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

type MutableAudioMediaElement = EventedMediaElementLike & {
  muted: boolean;
  defaultMuted?: boolean;
};

export type PlaybackPlayRetryBinding = {
  dispose: () => void;
};

export type PlaybackPlayRetryController = {
  dispose: () => void;
  schedule: (
    media: EventedMediaElementLike,
    generation: number,
    options?: { allowMutedFallback?: boolean },
  ) => void;
  tryMutedPlayback: (media: EventedMediaElementLike) => Promise<boolean>;
};

export function isAutoplayBlockedError(error: unknown): boolean {
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

export function createPlaybackPlayRetryController(args: {
  now: () => number;
  getGeneration: () => number;
  suppressLocalEventsUntil: (until: number) => void;
  retryDelayMs?: number;
  retryWindowMs?: number;
}): PlaybackPlayRetryController {
  const retryDelayMs =
    args.retryDelayMs ?? DEFAULT_PLAYBACK_PLAY_RETRY_DELAY_MS;
  const retryWindowMs =
    args.retryWindowMs ?? DEFAULT_PLAYBACK_PLAY_RETRY_WINDOW_MS;
  let playbackPlayRetry: PlaybackPlayRetryBinding | undefined;

  const suppressRetryEcho = (): void => {
    args.suppressLocalEventsUntil(args.now() + retryDelayMs);
  };

  const dispose = (): void => {
    playbackPlayRetry?.dispose();
    playbackPlayRetry = undefined;
  };

  const tryMutedPlayback = async (
    media: EventedMediaElementLike,
  ): Promise<boolean> => {
    if (!media.paused || !isMutableAudioMediaElement(media)) {
      return false;
    }
    // 浏览器会拦截没有用户手势的有声播放；直播刷新恢复时允许先静音播放，避免页面卡在暂停态。
    media.muted = true;
    media.defaultMuted = true;
    suppressRetryEcho();
    try {
      await media.play();
      return !media.paused;
    } catch {
      return false;
    }
  };

  const schedule = (
    media: EventedMediaElementLike,
    generation: number,
    options: { allowMutedFallback?: boolean } = {},
  ): void => {
    dispose();
    if (!media.paused) {
      return;
    }

    const retryMedia = media as LiveHydrationRetryMediaElement;
    const retryEvents = ["canplay", "loadeddata", "playing"] as const;
    const deadline = args.now() + retryWindowMs;
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
      if (playbackPlayRetry?.dispose === cleanup) {
        playbackPlayRetry = undefined;
      }
    };

    const scheduleNextRetry = (): void => {
      if (
        disposed ||
        generation !== args.getGeneration() ||
        args.now() >= deadline
      ) {
        cleanup();
        return;
      }
      clearRetryTimer();
      retryTimer = setTimeout(retryNow, retryDelayMs);
    };

    function retryNow(): void {
      if (disposed || generation !== args.getGeneration()) {
        cleanup();
        return;
      }
      if (!media.paused) {
        cleanup();
        return;
      }
      // 重试 play() 本身也会触发原生 play 事件，这里短暂压制本地回声，避免误广播成用户操作。
      suppressRetryEcho();
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
          if (
            options.allowMutedFallback === true &&
            isAutoplayBlockedError(error)
          ) {
            void tryMutedPlayback(media).then((played) => {
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
    playbackPlayRetry = { dispose: cleanup };
    scheduleNextRetry();
  };

  return {
    dispose,
    schedule,
    tryMutedPlayback,
  };
}
