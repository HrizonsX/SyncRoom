const DANMAKU_LAYER_SELECTOR = '[data-danmaku-layer="true"]';
const DANMAKU_ITEM_SELECTOR = "[data-danmaku-key]";
const DANMAKU_LAYER_PARKING_ATTRIBUTE = "data-danmaku-layer-parking";
const MAX_RENDERED_DANMAKU_ITEMS = 80;

export type DanmakuKeyElement = {
  getAttribute: (name: string) => string | null;
};

export type DanmakuAnimationElement = DanmakuKeyElement & {
  getAnimations?: () => Array<{ currentTime: unknown }>;
};

export type DanmakuAnimationSnapshot = {
  key: string;
  currentTimeMs: number;
};

export function findDanmakuLayerElement(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(DANMAKU_LAYER_SELECTOR);
}

function applyDanmakuLayerParkingStyle(element: HTMLElement): void {
  element.style.position = "fixed";
  element.style.inset = "0 auto auto 0";
  element.style.width = "0";
  element.style.height = "0";
  element.style.overflow = "hidden";
  element.style.visibility = "hidden";
  element.style.pointerEvents = "none";
}

export function parkDanmakuLayerElement(
  existingLayer: HTMLElement | null,
): HTMLElement | null {
  if (!existingLayer) {
    return null;
  }

  const body = existingLayer.ownerDocument.body;
  if (!body) {
    return null;
  }

  const parking = existingLayer.ownerDocument.createElement("div");
  parking.setAttribute(DANMAKU_LAYER_PARKING_ATTRIBUTE, "true");
  parking.setAttribute("aria-hidden", "true");
  applyDanmakuLayerParkingStyle(parking);
  body.append(parking);
  parking.append(existingLayer);
  return parking;
}

export function removeDanmakuLayerParkingElement(
  parking: HTMLElement | null,
): void {
  parking?.remove();
}

export function getDanmakuItemKey(
  element: DanmakuKeyElement | null | undefined,
): string | undefined {
  return element?.getAttribute("data-danmaku-key") ?? undefined;
}

export function getUniqueNextDanmakuItemKeys(
  existingItems: DanmakuKeyElement[],
  nextItems: DanmakuKeyElement[],
  renderedKeys: ReadonlySet<string> = new Set(),
): string[] {
  const existingKeys = new Set(
    existingItems
      .map((item) => getDanmakuItemKey(item))
      .filter((key): key is string => Boolean(key)),
  );
  return nextItems
    .map((item) => getDanmakuItemKey(item))
    .filter((key): key is string => Boolean(key))
    .filter((key) => !existingKeys.has(key) && !renderedKeys.has(key));
}

function getDanmakuItemElements(layer: Element): HTMLElement[] {
  return Array.from(layer.querySelectorAll<HTMLElement>(DANMAKU_ITEM_SELECTOR));
}

function getAnimationCurrentTimeMs(
  element: DanmakuAnimationElement,
): number | undefined {
  const animation = element.getAnimations?.()[0];
  const currentTime = animation?.currentTime;
  return typeof currentTime === "number" && Number.isFinite(currentTime)
    ? currentTime
    : undefined;
}

export function captureDanmakuAnimationSnapshots(
  items: DanmakuAnimationElement[],
): DanmakuAnimationSnapshot[] {
  const snapshots: DanmakuAnimationSnapshot[] = [];
  for (const item of items) {
    const key = getDanmakuItemKey(item);
    const currentTimeMs = getAnimationCurrentTimeMs(item);
    if (!key || currentTimeMs === undefined) {
      continue;
    }
    snapshots.push({ key, currentTimeMs });
  }
  return snapshots;
}

export function restoreDanmakuAnimationSnapshots(
  items: DanmakuAnimationElement[],
  snapshots: readonly DanmakuAnimationSnapshot[],
): void {
  const snapshotByKey = new Map(
    snapshots.map((snapshot) => [snapshot.key, snapshot.currentTimeMs]),
  );
  for (const item of items) {
    const key = getDanmakuItemKey(item);
    const currentTimeMs = key ? snapshotByKey.get(key) : undefined;
    const animation = item.getAnimations?.()[0];
    if (!animation || currentTimeMs === undefined) {
      continue;
    }
    animation.currentTime = currentTimeMs;
  }
}

export function captureDanmakuLayerAnimationSnapshots(
  layer: Element | null,
): DanmakuAnimationSnapshot[] {
  return layer
    ? captureDanmakuAnimationSnapshots(getDanmakuItemElements(layer))
    : [];
}

export function restoreDanmakuLayerAnimationSnapshots(
  layer: Element | null,
  snapshots: readonly DanmakuAnimationSnapshot[],
): void {
  if (!layer || snapshots.length === 0) {
    return;
  }
  restoreDanmakuAnimationSnapshots(getDanmakuItemElements(layer), snapshots);
}

function syncDanmakuLayerState(target: HTMLElement, source: HTMLElement): void {
  target.setAttribute(
    "data-danmaku-paused",
    source.getAttribute("data-danmaku-paused") ?? "false",
  );
}

function syncDanmakuItemState(target: HTMLElement, source: HTMLElement): void {
  target.setAttribute("class", source.getAttribute("class") ?? "");
  target.setAttribute("style", source.getAttribute("style") ?? "");
  target.setAttribute(
    "data-danmaku-video-time",
    source.getAttribute("data-danmaku-video-time") ?? "",
  );
}

function getDanmakuItemElementsByKey(layer: Element): Map<string, HTMLElement> {
  const itemsByKey = new Map<string, HTMLElement>();
  for (const item of getDanmakuItemElements(layer)) {
    const key = getDanmakuItemKey(item);
    if (key) {
      itemsByKey.set(key, item);
    }
  }
  return itemsByKey;
}

function pruneAndSyncExistingDanmakuItems(
  existingLayer: HTMLElement,
  nextItemsByKey: Map<string, HTMLElement>,
): Set<string> {
  const existingKeys = new Set<string>();
  for (const existingItem of getDanmakuItemElements(existingLayer)) {
    const key = getDanmakuItemKey(existingItem);
    const nextItem = key ? nextItemsByKey.get(key) : undefined;
    if (!key || !nextItem) {
      existingItem.remove();
      continue;
    }
    syncDanmakuItemState(existingItem, nextItem);
    existingKeys.add(key);
  }
  return existingKeys;
}

function trimRenderedDanmakuItems(layer: HTMLElement): void {
  const items = getDanmakuItemElements(layer);
  const overflow = items.length - MAX_RENDERED_DANMAKU_ITEMS;
  if (overflow <= 0) {
    return;
  }
  for (const item of items.slice(0, overflow)) {
    item.remove();
  }
}

function bindDanmakuAnimationCleanup(layer: HTMLElement): void {
  if (layer.dataset.danmakuCleanupBound === "true") {
    return;
  }

  layer.dataset.danmakuCleanupBound = "true";
  layer.addEventListener("animationend", (event) => {
    const target = event.target as (Element & { remove: () => void }) | null;
    if (target?.matches(DANMAKU_ITEM_SELECTOR)) {
      target.remove();
    }
  });
}

function keepOnlyUnrenderedNextItems(
  nextLayer: HTMLElement,
  renderedKeys: Set<string> | undefined,
): void {
  const nextKeys = new Set<string>();
  for (const nextItem of getDanmakuItemElements(nextLayer)) {
    const key = getDanmakuItemKey(nextItem);
    if (!key) {
      nextItem.remove();
      continue;
    }
    if (nextKeys.has(key) || renderedKeys?.has(key)) {
      nextItem.remove();
      continue;
    }
    nextKeys.add(key);
    renderedKeys?.add(key);
  }
}

export function preserveDanmakuLayerElement(
  root: ParentNode,
  existingLayer: HTMLElement | null,
  renderedKeys?: Set<string>,
): void {
  const nextLayer = findDanmakuLayerElement(root);
  if (!nextLayer) {
    if (existingLayer) {
      bindDanmakuAnimationCleanup(existingLayer);
    }
    return;
  }

  if (!existingLayer) {
    keepOnlyUnrenderedNextItems(nextLayer, renderedKeys);
    bindDanmakuAnimationCleanup(nextLayer);
    return;
  }

  syncDanmakuLayerState(existingLayer, nextLayer);
  const nextItemsByKey = getDanmakuItemElementsByKey(nextLayer);
  const existingKeys = pruneAndSyncExistingDanmakuItems(
    existingLayer,
    nextItemsByKey,
  );
  if (renderedKeys) {
    for (const key of existingKeys) {
      renderedKeys.add(key);
    }
  }
  for (const nextItem of getDanmakuItemElements(nextLayer)) {
    const key = getDanmakuItemKey(nextItem);
    if (!key || existingKeys.has(key) || renderedKeys?.has(key)) {
      continue;
    }
    existingLayer.append(nextItem.cloneNode(true));
    existingKeys.add(key);
    renderedKeys?.add(key);
  }
  trimRenderedDanmakuItems(existingLayer);
  bindDanmakuAnimationCleanup(existingLayer);
  nextLayer.replaceWith(existingLayer);
}
