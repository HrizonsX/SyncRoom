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

  closest(selector: string): FakeElement | null {
    return selector === "[data-action]" ? this : null;
  }
}

class FakeRoot {
  clickListener: ClickListener | null = null;

  addEventListener(type: string, listener: EventListener): void {
    if (type === "click") {
      this.clickListener = listener as ClickListener;
    }
  }

  querySelector(): null {
    return null;
  }
}

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
