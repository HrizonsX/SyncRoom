const DANMAKU_LAYER_SELECTOR = '[data-danmaku-layer="true"]';
const DANMAKU_ITEM_SELECTOR = "[data-danmaku-key]";
const MAX_RENDERED_DANMAKU_ITEMS = 80;

export type DanmakuKeyElement = {
  getAttribute: (name: string) => string | null;
};

export function findDanmakuLayerElement(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(DANMAKU_LAYER_SELECTOR);
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
  const existingKeys = new Set(
    getDanmakuItemElements(existingLayer)
      .map((item) => getDanmakuItemKey(item))
      .filter((key): key is string => Boolean(key)),
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
