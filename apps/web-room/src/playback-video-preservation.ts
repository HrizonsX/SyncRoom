const PLAYBACK_VIDEO_SELECTOR = '[data-playback-video="true"]';
const PLAYBACK_VIDEO_IDENTITY_ATTRIBUTES = [
  "data-source-url",
  "data-source-type",
  "data-playback-engine",
] as const;

export type PlaybackVideoIdentityElement = {
  getAttribute: (name: string) => string | null;
};

export function findPlaybackVideoElement(
  root: ParentNode,
): HTMLVideoElement | null {
  return root.querySelector<HTMLVideoElement>(PLAYBACK_VIDEO_SELECTOR);
}

export function getPlaybackVideoReuseKey(
  element: PlaybackVideoIdentityElement | null | undefined,
): string | undefined {
  if (!element) {
    return undefined;
  }
  const values = PLAYBACK_VIDEO_IDENTITY_ATTRIBUTES.map((name) =>
    element.getAttribute(name),
  );
  if (values.some((value) => !value)) {
    return undefined;
  }
  return values.join("\n");
}

export function canReusePlaybackVideoElement(
  existingVideo: PlaybackVideoIdentityElement | null | undefined,
  nextVideo: PlaybackVideoIdentityElement | null | undefined,
): boolean {
  const existingKey = getPlaybackVideoReuseKey(existingVideo);
  return (
    existingKey !== undefined &&
    existingKey === getPlaybackVideoReuseKey(nextVideo)
  );
}

function syncElementAttributes(target: Element, source: Element): void {
  for (const attribute of Array.from(target.attributes)) {
    if (!source.hasAttribute(attribute.name)) {
      target.removeAttribute(attribute.name);
    }
  }
  for (const attribute of Array.from(source.attributes)) {
    target.setAttribute(attribute.name, attribute.value);
  }
}

export function preservePlaybackVideoElement(
  root: ParentNode,
  existingVideo: HTMLVideoElement | null,
): void {
  if (!existingVideo) {
    return;
  }
  const nextVideo = findPlaybackVideoElement(root);
  if (!nextVideo || !canReusePlaybackVideoElement(existingVideo, nextVideo)) {
    return;
  }

  syncElementAttributes(existingVideo, nextVideo);
  nextVideo.replaceWith(existingVideo);
}
