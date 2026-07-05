import type { PlaybackVideoElement } from "./playback-types.js";

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

/**
 * 等待原生视频拿到元数据，避免刷新恢复或远端同步时过早设置播放进度。
 */
export function waitForNativeMetadata(
  video: PlaybackVideoElement,
): Promise<void> {
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
