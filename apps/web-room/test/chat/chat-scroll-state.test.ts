import assert from "node:assert/strict";
import test from "node:test";
import {
  readChatScrollState,
  restoreChatScrollState,
} from "../../src/chat/chat-scroll-state.js";

type FakeChatList = {
  className: string;
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

function createRoot(chatList: FakeChatList | null) {
  return {
    querySelector(selector: string) {
      assert.equal(selector, ".chat-list");
      return chatList;
    },
  } as unknown as ParentNode;
}

test("restores chat scroll to the bottom after rerender when it was already at latest message", () => {
  const before = {
    className: "chat-list",
    clientHeight: 100,
    scrollHeight: 300,
    scrollTop: 200,
  };
  const scrollState = readChatScrollState(createRoot(before));
  const after = {
    className: "chat-list",
    clientHeight: 100,
    scrollHeight: 360,
    scrollTop: 0,
  };

  restoreChatScrollState(createRoot(after), scrollState);

  assert.equal(after.scrollTop, 260);
});

test("restores chat scroll by distance from the latest message when the user was reading older messages", () => {
  const before = {
    className: "chat-list",
    clientHeight: 100,
    scrollHeight: 300,
    scrollTop: 80,
  };
  const scrollState = readChatScrollState(createRoot(before));
  const after = {
    className: "chat-list",
    clientHeight: 100,
    scrollHeight: 360,
    scrollTop: 0,
  };

  restoreChatScrollState(createRoot(after), scrollState);

  assert.equal(after.scrollTop, 140);
});
