export const PLAYER_FULLSCREEN_ROOT_ID = "web-room-fullscreen-root";

type MediaControllerWithFullscreenTarget = Element & {
  fullscreenElement?: HTMLElement;
};

export function syncPlayerFullscreenTarget(
  root: ParentNode,
  ownerDocument: Document = document,
): void {
  const fullscreenRoot = ownerDocument.getElementById(
    PLAYER_FULLSCREEN_ROOT_ID,
  );
  const controller = root.querySelector<MediaControllerWithFullscreenTarget>(
    ".player-media-controller",
  );
  if (!fullscreenRoot || !controller) {
    return;
  }
  controller.fullscreenElement = fullscreenRoot;
}
