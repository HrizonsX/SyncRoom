import assert from "node:assert/strict";
import test from "node:test";
import {
  captureDanmakuAnimationSnapshots,
  captureDanmakuLayerAnimationSnapshots,
  getDanmakuItemKey,
  getUniqueNextDanmakuItemKeys,
  parkDanmakuLayerElement,
  preserveDanmakuLayerElement,
  removeDanmakuLayerParkingElement,
  restoreDanmakuAnimationSnapshots,
  restoreDanmakuLayerAnimationSnapshots,
  type DanmakuKeyElement,
} from "../../src/danmaku/danmaku-layer-preservation.js";

function elementWithDanmakuKey(key: string | null): DanmakuKeyElement {
  return {
    getAttribute(name: string) {
      return name === "data-danmaku-key" ? key : null;
    },
  };
}

function elementWithDanmakuAnimation(
  key: string | null,
  currentTime: number | string | null,
): DanmakuKeyElement & {
  animation: { currentTime: number | string | null };
  getAnimations: () => Array<{ currentTime: number | string | null }>;
} {
  const animation = { currentTime };
  return {
    ...elementWithDanmakuKey(key),
    animation,
    getAnimations() {
      return [animation];
    },
  };
}

type FakeDocument = {
  body: FakeElement;
  createElement: (tagName: string) => FakeElement;
};

type FakeElement = {
  attributes: Map<string, string>;
  children: FakeElement[];
  dataset: Record<string, string>;
  ownerDocument: FakeDocument;
  parentElement: FakeElement | null;
  removed: boolean;
  style: Record<string, string>;
  addEventListener: (type: string, listener: EventListener) => void;
  append: (child: FakeElement) => void;
  cloneNode: (deep?: boolean) => FakeElement;
  getAttribute: (name: string) => string | null;
  querySelector: (selector: string) => FakeElement | null;
  querySelectorAll: (selector: string) => FakeElement[];
  remove: () => void;
  replaceWith: (replacement: FakeElement) => void;
  setAttribute: (name: string, value: string) => void;
};

function createFakeDocument(): FakeDocument {
  const document = {} as FakeDocument;
  document.createElement = () => createFakeElement(document);
  document.body = createFakeElement(document);
  return document;
}

function matchesFakeSelector(element: FakeElement, selector: string): boolean {
  if (selector === '[data-danmaku-layer="true"]') {
    return element.getAttribute("data-danmaku-layer") === "true";
  }
  if (selector === "[data-danmaku-key]") {
    return element.getAttribute("data-danmaku-key") !== null;
  }
  return false;
}

function queryFakeElements(
  element: FakeElement,
  selector: string,
): FakeElement[] {
  const matches: FakeElement[] = [];
  for (const child of element.children) {
    if (matchesFakeSelector(child, selector)) {
      matches.push(child);
    }
    matches.push(...queryFakeElements(child, selector));
  }
  return matches;
}

function createFakeElement(ownerDocument: FakeDocument): FakeElement {
  const element: FakeElement = {
    attributes: new Map(),
    children: [],
    dataset: {},
    ownerDocument,
    parentElement: null,
    removed: false,
    style: {},
    addEventListener() {},
    append(child) {
      if (child.parentElement) {
        const currentIndex = child.parentElement.children.indexOf(child);
        if (currentIndex >= 0) {
          child.parentElement.children.splice(currentIndex, 1);
        }
      }
      this.children.push(child);
      child.parentElement = this;
    },
    cloneNode(deep = false) {
      const clone = createFakeElement(this.ownerDocument);
      for (const [name, value] of this.attributes) {
        clone.setAttribute(name, value);
      }
      clone.style = { ...this.style };
      if (deep) {
        for (const child of this.children) {
          clone.append(child.cloneNode(true));
        }
      }
      return clone;
    },
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    },
    querySelector(selector) {
      return queryFakeElements(this, selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      return queryFakeElements(this, selector);
    },
    remove() {
      if (this.parentElement) {
        const currentIndex = this.parentElement.children.indexOf(this);
        if (currentIndex >= 0) {
          this.parentElement.children.splice(currentIndex, 1);
        }
        this.parentElement = null;
      }
      this.removed = true;
    },
    replaceWith(replacement) {
      if (!this.parentElement) {
        return;
      }
      const currentIndex = this.parentElement.children.indexOf(this);
      if (currentIndex < 0) {
        return;
      }
      if (replacement.parentElement) {
        const replacementIndex =
          replacement.parentElement.children.indexOf(replacement);
        if (replacementIndex >= 0) {
          replacement.parentElement.children.splice(replacementIndex, 1);
        }
      }
      this.parentElement.children[currentIndex] = replacement;
      replacement.parentElement = this.parentElement;
      this.parentElement = null;
    },
    setAttribute(name, value) {
      this.attributes.set(name, value);
    },
  };
  return element;
}

test("reads stable danmaku item keys from rendered elements", () => {
  assert.equal(
    getDanmakuItemKey(elementWithDanmakuKey("member-1:1:hello")),
    "member-1:1:hello",
  );
  assert.equal(getDanmakuItemKey(elementWithDanmakuKey(null)), undefined);
});

test("keeps already rendered danmaku from being appended again", () => {
  assert.deepEqual(
    getUniqueNextDanmakuItemKeys(
      [
        elementWithDanmakuKey("member-1:1:hello"),
        elementWithDanmakuKey("member-2:2:world"),
      ],
      [
        elementWithDanmakuKey("member-1:1:hello"),
        elementWithDanmakuKey("member-3:3:new"),
        elementWithDanmakuKey("member-2:2:world"),
      ],
    ),
    ["member-3:3:new"],
  );
});

test("prunes expired rendered danmaku and syncs active item progress", () => {
  const document = createFakeDocument();
  const root = createFakeElement(document);
  const existingLayer = createFakeElement(document);
  const nextLayer = createFakeElement(document);
  const expiredItem = createFakeElement(document);
  const activeItem = createFakeElement(document);
  const nextActiveItem = createFakeElement(document);
  const newItem = createFakeElement(document);

  existingLayer.setAttribute("data-danmaku-layer", "true");
  nextLayer.setAttribute("data-danmaku-layer", "true");
  expiredItem.setAttribute("data-danmaku-key", "expired");
  activeItem.setAttribute("data-danmaku-key", "active");
  activeItem.setAttribute("style", "--danmaku-progress-delay: 0ms;");
  nextActiveItem.setAttribute("data-danmaku-key", "active");
  nextActiveItem.setAttribute("style", "--danmaku-progress-delay: -2500ms;");
  nextActiveItem.setAttribute("data-danmaku-video-time", "12");
  newItem.setAttribute("data-danmaku-key", "new");

  existingLayer.append(expiredItem);
  existingLayer.append(activeItem);
  nextLayer.append(nextActiveItem);
  nextLayer.append(newItem);
  root.append(nextLayer);

  preserveDanmakuLayerElement(
    root as unknown as ParentNode,
    existingLayer as unknown as HTMLElement,
  );

  assert.equal(expiredItem.removed, true);
  assert.equal(root.children[0], existingLayer);
  assert.equal(
    activeItem.getAttribute("style"),
    "--danmaku-progress-delay: -2500ms;",
  );
  assert.equal(activeItem.getAttribute("data-danmaku-video-time"), "12");
  assert.equal(existingLayer.children.length, 2);
  assert.equal(
    existingLayer.children[1]?.getAttribute("data-danmaku-key"),
    "new",
  );
});

test("parks the existing danmaku layer in the live document during rerender", () => {
  const document = createFakeDocument();
  const layer = createFakeElement(document);
  document.body.append(layer);

  const parking = parkDanmakuLayerElement(
    layer as unknown as HTMLElement,
  ) as unknown as FakeElement;

  assert.equal(parking.getAttribute("data-danmaku-layer-parking"), "true");
  assert.equal(parking.parentElement, document.body);
  assert.equal(layer.parentElement, parking);
  assert.equal(parking.style.visibility, "hidden");
  assert.equal(parking.style.overflow, "hidden");

  removeDanmakuLayerParkingElement(parking as unknown as HTMLElement);

  assert.equal(parking.removed, true);
  assert.equal(parking.parentElement, null);
});

test("keeps consumed danmaku from being replayed after it leaves the layer", () => {
  assert.deepEqual(
    getUniqueNextDanmakuItemKeys(
      [],
      [
        elementWithDanmakuKey("member-1:1:hello"),
        elementWithDanmakuKey("member-2:2:world"),
      ],
      new Set(["member-1:1:hello"]),
    ),
    ["member-2:2:world"],
  );
});

test("restores in-flight danmaku animation progress across layer preservation", () => {
  const first = elementWithDanmakuAnimation("member-1:1:hello", 3200);
  const second = elementWithDanmakuAnimation("member-2:2:world", 1800);
  const missingKey = elementWithDanmakuAnimation(null, 900);
  const nonNumeric = elementWithDanmakuAnimation("member-3:3:skip", "1200ms");

  const snapshots = captureDanmakuAnimationSnapshots([
    first,
    second,
    missingKey,
    nonNumeric,
  ]);

  assert.deepEqual(snapshots, [
    { key: "member-1:1:hello", currentTimeMs: 3200 },
    { key: "member-2:2:world", currentTimeMs: 1800 },
  ]);

  const restoredFirst = elementWithDanmakuAnimation("member-1:1:hello", 0);
  const restoredSecond = elementWithDanmakuAnimation("member-2:2:world", 0);
  const fresh = elementWithDanmakuAnimation("member-4:4:fresh", 0);

  restoreDanmakuAnimationSnapshots(
    [restoredFirst, restoredSecond, fresh],
    snapshots,
  );

  assert.equal(restoredFirst.animation.currentTime, 3200);
  assert.equal(restoredSecond.animation.currentTime, 1800);
  assert.equal(fresh.animation.currentTime, 0);
});

test("keeps active danmaku progress when appending newly rendered items", () => {
  const document = createFakeDocument();
  const root = createFakeElement(document);
  const existingLayer = createFakeElement(document);
  const nextLayer = createFakeElement(document);
  const existingFirst = createFakeElement(document) as FakeElement & {
    animation: { currentTime: number };
    getAnimations: () => Array<{ currentTime: number }>;
  };
  const nextFirst = createFakeElement(document);
  const nextSecond = createFakeElement(document);
  existingLayer.setAttribute("data-danmaku-layer", "true");
  nextLayer.setAttribute("data-danmaku-layer", "true");
  existingFirst.setAttribute("data-danmaku-key", "member-1:1:first");
  nextFirst.setAttribute("data-danmaku-key", "member-1:1:first");
  nextSecond.setAttribute("data-danmaku-key", "member-2:2:second");
  existingFirst.animation = { currentTime: 2400 };
  existingFirst.getAnimations = () => [existingFirst.animation];
  existingLayer.append(existingFirst);
  nextLayer.append(nextFirst);
  nextLayer.append(nextSecond);
  root.append(nextLayer);
  const renderedKeys = new Set<string>();

  const snapshots = captureDanmakuLayerAnimationSnapshots(
    existingLayer as unknown as HTMLElement,
  );
  preserveDanmakuLayerElement(
    root as unknown as ParentNode,
    existingLayer as unknown as HTMLElement,
    renderedKeys,
  );
  restoreDanmakuLayerAnimationSnapshots(
    root.children[0] as unknown as HTMLElement,
    snapshots,
  );

  assert.equal(root.children[0], existingLayer);
  assert.deepEqual(
    existingLayer.children.map((item) => item.getAttribute("data-danmaku-key")),
    ["member-1:1:first", "member-2:2:second"],
  );
  assert.equal(existingFirst.animation.currentTime, 2400);
  assert.deepEqual(
    [...renderedKeys],
    ["member-1:1:first", "member-2:2:second"],
  );
});
