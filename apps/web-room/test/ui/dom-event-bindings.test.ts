import assert from "node:assert/strict";
import test from "node:test";
import {
  bindWebRoomDomEvents,
  COPY_ROOM_INVITE_SUCCESS_LABEL,
} from "../../src/ui/dom-event-bindings.js";
import type { WebRoomAppController } from "../../src/room/app-controller.js";

type ClickListener = (event: Event) => void;

class FakeElement {
  dataset: Record<string, string> = {};
  textContent = "";
  clearableWrapper: FakeElement | null = null;
  input: FakeInput | null = null;

  closest(selector: string): FakeElement | null {
    if (selector === "[data-action]") {
      return this;
    }
    return selector === ".clearable-input" ? this.clearableWrapper : null;
  }

  querySelector(): FakeInput | null {
    return this.input;
  }
}

class FakeInput {
  disabled = false;
  focused = false;
  dispatchedEvents: Event[] = [];

  constructor(
    readonly name: string,
    public value: string,
  ) {}

  dispatchEvent(event: Event): boolean {
    this.dispatchedEvents.push(event);
    return true;
  }

  focus(): void {
    this.focused = true;
  }
}

class FakeRoot {
  clickListener: ClickListener | null = null;
  input: FakeInput | null = null;

  addEventListener(type: string, listener: EventListener): void {
    if (type === "click") {
      this.clickListener = listener as ClickListener;
    }
  }

  querySelector(selector: string): FakeInput | null {
    return selector === 'input[name="bilibiliUrl"]' ? this.input : null;
  }
}

test("clears a provider URL and persists the empty value in controller state", () => {
  const previousElement = globalThis.Element;
  const clearedPolicies: Array<{ url?: string }> = [];
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: FakeElement,
  });

  try {
    const input = new FakeInput(
      "bilibiliUrl",
      "https://www.bilibili.com/video/BV1test",
    );
    const wrapper = new FakeElement();
    wrapper.input = input;
    const button = new FakeElement();
    button.dataset.action = "clear-text-input";
    button.clearableWrapper = wrapper;
    const root = new FakeRoot();
    root.input = input;

    bindWebRoomDomEvents({
      root: root as unknown as HTMLElement,
      controller: {
        setProviderPlaybackPolicy(policy) {
          clearedPolicies.push(policy);
        },
      } as WebRoomAppController,
    });

    root.clickListener?.({ target: button } as unknown as Event);

    assert.equal(input.value, "");
    assert.equal(input.focused, true);
    assert.equal(input.dispatchedEvents.length, 1);
    assert.deepEqual(clearedPolicies, [{ url: "" }]);
  } finally {
    Object.defineProperty(globalThis, "Element", {
      configurable: true,
      value: previousElement,
    });
  }
});

test("shows localized copied text after copying the room invite", async () => {
  const previousElement = globalThis.Element;
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const writtenText: string[] = [];
  Object.defineProperty(globalThis, "Element", {
    configurable: true,
    value: FakeElement,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText(value: string) {
          writtenText.push(value);
          return Promise.resolve();
        },
      },
    },
  });

  try {
    const root = new FakeRoot();
    const button = new FakeElement();
    button.dataset.action = "copy-room-invite";
    button.dataset.roomCode = "ABC123";
    button.dataset.joinToken = "join-token";
    button.textContent = "复制";
    bindWebRoomDomEvents({
      root: root as unknown as HTMLElement,
      controller: {} as WebRoomAppController,
    });

    root.clickListener?.({ target: button } as unknown as Event);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    assert.deepEqual(writtenText, ["ABC123:join-token"]);
    assert.equal(button.textContent, COPY_ROOM_INVITE_SUCCESS_LABEL);
    assert.equal(button.textContent, "已复制");
  } finally {
    Object.defineProperty(globalThis, "Element", {
      configurable: true,
      value: previousElement,
    });
    if (previousNavigatorDescriptor) {
      Object.defineProperty(
        globalThis,
        "navigator",
        previousNavigatorDescriptor,
      );
    }
  }
});
