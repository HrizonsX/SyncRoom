const DANMAKU_LAYER_SELECTOR = '[data-danmaku-layer="true"]';
const DANMAKU_ITEM_SELECTOR = "[data-danmaku-key]";
const DANMAKU_LAYER_PARKING_ATTRIBUTE = "data-danmaku-layer-parking";
const MAX_RENDERED_DANMAKU_ITEMS = 80;

export type DanmakuKeyElement = {
  getAttribute: (name: string) => string | null;
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
): string[] {
  const existingKeys = new Set(
    existingItems
      .map((item) => getDanmakuItemKey(item))
      .filter((key): key is string => Boolean(key)),
  );
  return nextItems
    .map((item) => getDanmakuItemKey(item))
    .filter((key): key is string => Boolean(key))
    .filter((key) => !existingKeys.has(key));
}

function getDanmakuItemElements(layer: Element): HTMLElement[] {
  return Array.from(layer.querySelectorAll<HTMLElement>(DANMAKU_ITEM_SELECTOR));
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

export function preserveDanmakuLayerElement(
  root: ParentNode,
  existingLayer: HTMLElement | null,
): void {
  if (!existingLayer) {
    return;
  }
  const nextLayer = findDanmakuLayerElement(root);
  if (!nextLayer) {
    return;
  }

  syncDanmakuLayerState(existingLayer, nextLayer);
  const nextItemsByKey = getDanmakuItemElementsByKey(nextLayer);
  const existingKeys = pruneAndSyncExistingDanmakuItems(
    existingLayer,
    nextItemsByKey,
  );
  for (const nextItem of getDanmakuItemElements(nextLayer)) {
    const key = getDanmakuItemKey(nextItem);
    if (!key || existingKeys.has(key)) {
      continue;
    }
    existingLayer.append(nextItem.cloneNode(true));
    existingKeys.add(key);
  }
  trimRenderedDanmakuItems(existingLayer);
  nextLayer.replaceWith(existingLayer);
}
