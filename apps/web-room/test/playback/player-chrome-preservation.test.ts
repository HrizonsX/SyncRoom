import assert from "node:assert/strict";
import test from "node:test";
import {
  readPlayerChromeAutohideState,
  restorePlayerChromeAutohideState,
} from "../../src/playback/player-chrome-preservation.js";

class FakeElement {
  private readonly attributes = new Set<string>();
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(attributes: readonly string[] = []) {
    for (const attribute of attributes) {
      this.attributes.add(attribute);
    }
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string): void {
    this.attributes.add(name);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatchEvent(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

function rootWithController(controller: FakeElement | null): ParentNode {
  return {
    querySelector(selector: string) {
      return selector === ".player-media-controller" ? controller : null;
    },
  } as unknown as ParentNode;
}

test("restores hidden media-chrome controls after the player chrome rerenders", () => {
  const previousController = new FakeElement(["userinactive"]);
  const snapshot = readPlayerChromeAutohideState(
    rootWithController(previousController),
  );
  const nextController = new FakeElement(["mediapaused"]);

  restorePlayerChromeAutohideState(
    rootWithController(nextController),
    snapshot,
  );

  assert.equal(nextController.hasAttribute("userinactive"), true);
  assert.equal(nextController.hasAttribute("mediapaused"), false);
  assert.equal(
    nextController.hasAttribute("data-player-autohide-restored"),
    true,
  );
});

test("clears the restored hidden marker after the next media-chrome activity change", () => {
  const previousController = new FakeElement(["userinactive"]);
  const snapshot = readPlayerChromeAutohideState(
    rootWithController(previousController),
  );
  const nextController = new FakeElement();

  restorePlayerChromeAutohideState(
    rootWithController(nextController),
    snapshot,
  );
  assert.equal(
    nextController.hasAttribute("data-player-autohide-restored"),
    true,
  );

  nextController.dispatchEvent("userinactivechange");

  assert.equal(
    nextController.hasAttribute("data-player-autohide-restored"),
    false,
  );
});

test("does not hide controls when the previous controller was paused", () => {
  const previousController = new FakeElement(["userinactive", "mediapaused"]);
  const snapshot = readPlayerChromeAutohideState(
    rootWithController(previousController),
  );
  const nextController = new FakeElement(["mediapaused"]);

  restorePlayerChromeAutohideState(
    rootWithController(nextController),
    snapshot,
  );

  assert.equal(nextController.hasAttribute("userinactive"), false);
  assert.equal(nextController.hasAttribute("mediapaused"), true);
});
