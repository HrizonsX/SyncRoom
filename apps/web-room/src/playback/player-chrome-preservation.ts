const PLAYER_MEDIA_CONTROLLER_SELECTOR = ".player-media-controller";
const MEDIA_CHROME_USER_INACTIVE_ATTRIBUTE = "userinactive";
const MEDIA_CHROME_PAUSED_ATTRIBUTE = "mediapaused";
const MEDIA_CHROME_USER_INACTIVE_CHANGE_EVENT = "userinactivechange";
const PLAYER_AUTOHIDE_RESTORED_ATTRIBUTE = "data-player-autohide-restored";

export type PlayerChromeAutohideState = {
  controlsWereHidden: boolean;
};

function findPlayerMediaController(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(PLAYER_MEDIA_CONTROLLER_SELECTOR);
}

export function readPlayerChromeAutohideState(
  root: ParentNode,
): PlayerChromeAutohideState | null {
  const controller = findPlayerMediaController(root);
  if (!controller) {
    return null;
  }

  const controlsWereHidden =
    controller.hasAttribute(MEDIA_CHROME_USER_INACTIVE_ATTRIBUTE) &&
    !controller.hasAttribute(MEDIA_CHROME_PAUSED_ATTRIBUTE);
  return controlsWereHidden ? { controlsWereHidden } : null;
}

export function restorePlayerChromeAutohideState(
  root: ParentNode,
  state: PlayerChromeAutohideState | null,
): void {
  if (!state?.controlsWereHidden) {
    return;
  }

  const controller = findPlayerMediaController(root);
  if (!controller) {
    return;
  }

  // media-chrome stores auto-hidden controls on host attributes. The web-room
  // full render recreates that host and its control bar, so restore only the
  // hidden playing state and suppress the new bar's initial fade-out flash.
  controller.setAttribute(MEDIA_CHROME_USER_INACTIVE_ATTRIBUTE, "");
  controller.removeAttribute(MEDIA_CHROME_PAUSED_ATTRIBUTE);
  controller.setAttribute(PLAYER_AUTOHIDE_RESTORED_ATTRIBUTE, "");
  controller.addEventListener(
    MEDIA_CHROME_USER_INACTIVE_CHANGE_EVENT,
    () => {
      controller.removeAttribute(PLAYER_AUTOHIDE_RESTORED_ATTRIBUTE);
    },
    { once: true },
  );
}
