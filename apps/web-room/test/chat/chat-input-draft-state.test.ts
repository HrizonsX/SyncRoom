import assert from "node:assert/strict";
import test from "node:test";
import {
  readChatInputDraftState,
  readPlayerDanmakuInputDraftState,
  restoreChatInputDraftState,
  restorePlayerDanmakuInputDraftState,
} from "../../src/chat/chat-input-draft-state.js";

type FakeInput = {
  name: string;
  value: string;
};

function createRoot(chatInput: FakeInput | null) {
  return {
    querySelector(selector: string) {
      assert.equal(selector, 'input[name="chat"]');
      return chatInput;
    },
  } as unknown as ParentNode;
}

function createPlayerDanmakuRoot(playerDanmakuInput: FakeInput | null) {
  return {
    querySelector(selector: string) {
      assert.equal(selector, 'input[name="playerDanmaku"]');
      return playerDanmakuInput;
    },
  } as unknown as ParentNode;
}

test("restores a typed chat draft after cooldown rerender", () => {
  const draft = readChatInputDraftState(
    createRoot({ name: "chat", value: "发送保护期间输入" }),
  );
  const rerenderedInput = { name: "chat", value: "" };

  restoreChatInputDraftState(createRoot(rerenderedInput), draft);

  assert.equal(rerenderedInput.value, "发送保护期间输入");
});

test("leaves the rerendered chat input empty when no draft existed", () => {
  const draft = readChatInputDraftState(
    createRoot({ name: "chat", value: "" }),
  );
  const rerenderedInput = { name: "chat", value: "" };

  restoreChatInputDraftState(createRoot(rerenderedInput), draft);

  assert.equal(rerenderedInput.value, "");
});

test("restores a typed player danmaku draft after cooldown rerender", () => {
  const draft = readPlayerDanmakuInputDraftState(
    createPlayerDanmakuRoot({ name: "playerDanmaku", value: "draft danmaku" }),
  );
  const rerenderedInput = { name: "playerDanmaku", value: "" };

  restorePlayerDanmakuInputDraftState(
    createPlayerDanmakuRoot(rerenderedInput),
    draft,
  );

  assert.equal(rerenderedInput.value, "draft danmaku");
});
