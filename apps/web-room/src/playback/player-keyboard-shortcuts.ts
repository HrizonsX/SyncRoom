const DEFAULT_PLAYER_SEEK_SECONDS = 5;
const PLAYBACK_VIDEO_SELECTOR = '[data-playback-video="true"]';
const PLAYER_CONTROLLER_SELECTOR = ".player-media-controller";
const MEDIA_SEEK_REQUEST_EVENT = "mediaseekrequest";

type ElementLike = {
  tagName?: string;
  closest?: (selector: string) => unknown;
};

function getElementLike(target: EventTarget | null): ElementLike | null {
  if (!target || typeof target !== "object") {
    return null;
  }
  return target as ElementLike;
}

function isEditableShortcutTarget(target: EventTarget | null): boolean {
  const element = getElementLike(target);
  if (!element) {
    return false;
  }

  const tagName = element.tagName?.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  return Boolean(element.closest?.("[contenteditable]"));
}

function getSeekDeltaSeconds(
  event: KeyboardEvent,
  seekSeconds: number,
): number | undefined {
  if (event.key === "ArrowLeft") {
    return -seekSeconds;
  }
  if (event.key === "ArrowRight") {
    return seekSeconds;
  }
  return undefined;
}

function clampPlaybackTime(time: number, duration: number): number {
  const lowerBounded = Math.max(0, time);
  return Number.isFinite(duration)
    ? Math.min(duration, lowerBounded)
    : lowerBounded;
}

export function handlePlayerKeyboardShortcut(args: {
  event: KeyboardEvent;
  root: ParentNode;
  seekSeconds?: number;
}): boolean {
  const { event, root } = args;
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    isEditableShortcutTarget(event.target)
  ) {
    return false;
  }

  const seekSeconds = args.seekSeconds ?? DEFAULT_PLAYER_SEEK_SECONDS;
  const deltaSeconds = getSeekDeltaSeconds(event, seekSeconds);
  if (deltaSeconds === undefined) {
    return false;
  }

  const controller = root.querySelector<HTMLElement>(
    PLAYER_CONTROLLER_SELECTOR,
  );
  if (
    !controller ||
    controller.hasAttribute("gesturesdisabled") ||
    controller.dataset.playerEmpty === "true" ||
    controller.dataset.playerLive === "true"
  ) {
    return false;
  }

  const video = controller.querySelector<HTMLVideoElement>(
    PLAYBACK_VIDEO_SELECTOR,
  );
  if (!video || !Number.isFinite(video.currentTime)) {
    return false;
  }

  const targetTime = clampPlaybackTime(
    video.currentTime + deltaSeconds,
    video.duration,
  );
  // Route keyboard seeking through the same semantic request boundary as the
  // progress control so it remains distinguishable from hydration echoes.
  controller.dispatchEvent(
    new CustomEvent<number>(MEDIA_SEEK_REQUEST_EVENT, {
      bubbles: true,
      composed: true,
      detail: targetTime,
    }),
  );
  video.currentTime = targetTime;
  event.preventDefault();
  event.stopPropagation();
  return true;
}
