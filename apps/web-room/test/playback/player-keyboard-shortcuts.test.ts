import assert from "node:assert/strict";
import test from "node:test";
import { handlePlayerKeyboardShortcut } from "../../src/playback/player-keyboard-shortcuts.js";

class FakeVideoElement {
  constructor(
    public currentTime: number,
    public readonly duration: number,
  ) {}
}

class FakePlayerControllerElement {
  readonly dataset: Record<string, string> = {
    playerEmpty: "false",
    playerLive: "false",
  };
  readonly dispatchedEvents: Event[] = [];
  private readonly attributes = new Set<string>();

  constructor(private readonly video: FakeVideoElement) {}

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  setAttribute(name: string): void {
    this.attributes.add(name);
  }

  dispatchEvent(event: Event): boolean {
    this.dispatchedEvents.push(event);
    return true;
  }

  querySelector(selector: string): FakeVideoElement | null {
    return selector === '[data-playback-video="true"]' ? this.video : null;
  }
}

class FakeRoot {
  constructor(private readonly controller: FakePlayerControllerElement) {}

  querySelector(selector: string): FakePlayerControllerElement | null {
    return selector === ".player-media-controller" ? this.controller : null;
  }
}

class FakeKeyboardEvent {
  defaultPrevented = false;
  propagationStopped = false;
  readonly altKey = false;
  readonly ctrlKey = false;
  readonly isComposing = false;
  readonly metaKey = false;

  constructor(
    public readonly key: string,
    public readonly target: unknown = null,
  ) {}

  preventDefault(): void {
    this.defaultPrevented = true;
  }

  stopPropagation(): void {
    this.propagationStopped = true;
  }
}

function createFixture(
  args: {
    currentTime?: number;
    duration?: number;
    live?: boolean;
    disabled?: boolean;
  } = {},
) {
  const video = new FakeVideoElement(
    args.currentTime ?? 12,
    args.duration ?? 30,
  );
  const controller = new FakePlayerControllerElement(video);
  if (args.live) {
    controller.dataset.playerLive = "true";
  }
  if (args.disabled) {
    controller.setAttribute("gesturesdisabled");
  }
  return {
    video,
    controller,
    root: new FakeRoot(controller),
  };
}

test("ArrowRight advances the current player by five seconds", () => {
  const { root, video, controller } = createFixture();
  const event = new FakeKeyboardEvent("ArrowRight");

  const handled = handlePlayerKeyboardShortcut({
    event: event as unknown as KeyboardEvent,
    root: root as unknown as ParentNode,
  });

  assert.equal(handled, true);
  assert.equal(video.currentTime, 17);
  assert.equal(controller.dispatchedEvents[0]?.type, "mediaseekrequest");
  assert.equal(
    (controller.dispatchedEvents[0] as CustomEvent<number> | undefined)?.detail,
    17,
  );
  assert.equal(event.defaultPrevented, true);
  assert.equal(event.propagationStopped, true);
});

test("ArrowLeft rewinds the current player and clamps at zero", () => {
  const { root, video } = createFixture({ currentTime: 3 });
  const event = new FakeKeyboardEvent("ArrowLeft");

  const handled = handlePlayerKeyboardShortcut({
    event: event as unknown as KeyboardEvent,
    root: root as unknown as ParentNode,
  });

  assert.equal(handled, true);
  assert.equal(video.currentTime, 0);
});

test("ignores arrow keys from editable targets", () => {
  const { root, video } = createFixture();
  const event = new FakeKeyboardEvent("ArrowRight", {
    tagName: "INPUT",
    closest: () => null,
  });

  const handled = handlePlayerKeyboardShortcut({
    event: event as unknown as KeyboardEvent,
    root: root as unknown as ParentNode,
  });

  assert.equal(handled, false);
  assert.equal(video.currentTime, 12);
  assert.equal(event.defaultPrevented, false);
});

test("ignores arrow seeking for live playback", () => {
  const { root, video } = createFixture({ live: true });
  const event = new FakeKeyboardEvent("ArrowRight");

  const handled = handlePlayerKeyboardShortcut({
    event: event as unknown as KeyboardEvent,
    root: root as unknown as ParentNode,
  });

  assert.equal(handled, false);
  assert.equal(video.currentTime, 12);
});
