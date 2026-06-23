import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRoomJoinInvite,
  handleWebRoomImmediateAction,
  parseRoomJoinInvite,
} from "../src/actions.js";

test("voice button action delegates to the voice controller", () => {
  const calls: string[] = [];
  const handled = handleWebRoomImmediateAction({
    action: "voice-toggle",
    controller: {
      toggleVoice: () => {
        calls.push("toggle-voice");
      },
      setBilibiliAuthMethod: () => {
        calls.push("method");
      },
      startBilibiliAuth: async () => {
        calls.push("auth");
      },
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, ["toggle-voice"]);
});

test("QR tab action starts the QR authorization flow", () => {
  const calls: string[] = [];
  const handled = handleWebRoomImmediateAction({
    action: "bilibili-auth-method-qr",
    controller: {
      toggleVoice: () => {
        calls.push("voice");
      },
      setBilibiliAuthMethod: (method) => {
        calls.push(`method:${method}`);
      },
      startBilibiliAuth: async (input) => {
        calls.push(`auth:${input.method}`);
      },
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(calls, ["method:qr", "auth:qr"]);
});

test("formats copied room invite as room code plus join token", () => {
  const invite = formatRoomJoinInvite({
    roomCode: "ABC123",
    joinToken: "valid-join-token-123",
  });

  assert.equal(invite, "ABC123:valid-join-token-123");
  assert.deepEqual(parseRoomJoinInvite(invite), {
    roomCode: "ABC123",
    joinToken: "valid-join-token-123",
  });
});

test("parses a pasted room invite into join fields", () => {
  assert.deepEqual(parseRoomJoinInvite("abc123:valid-join-token-123"), {
    roomCode: "ABC123",
    joinToken: "valid-join-token-123",
  });
});
