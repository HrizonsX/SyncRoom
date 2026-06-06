import assert from "node:assert/strict";
import test from "node:test";
import { createServerMessageController } from "../src/background/server-message-controller";
import type { RoomState, ServerMessage } from "@bili-syncplay/protocol";

function createRoomState(roomCode = "ROOM01"): RoomState {
  return {
    roomCode,
    sharedVideo: null,
    playback: null,
    members: [],
  };
}

function createControllerHarness() {
  const calls = {
    receivedRoomState: [] as string[],
    rateLimited: 0,
    handledMessages: [] as ServerMessage[],
    consumedRoomStates: [] as RoomState[],
    logs: [] as string[],
    notifyAll: 0,
  };

  const controller = createServerMessageController({
    log(message) {
      calls.logs.push(message);
    },
    shouldLogIncomingMessage() {
      return true;
    },
    consumeRoomState(roomState) {
      calls.consumedRoomStates.push(roomState);
    },
    async handleRoomSessionServerMessage(message) {
      calls.handledMessages.push(message);
    },
    updateClockOffset() {},
    notifyAll() {
      calls.notifyAll += 1;
    },
    syncRequestController: {
      markRoomStateReceived(roomCode: string) {
        calls.receivedRoomState.push(roomCode);
      },
      markRateLimited() {
        calls.rateLimited += 1;
        return true;
      },
    },
  });

  return { controller, calls };
}

test("server message controller marks sync request complete when room state arrives", async () => {
  const harness = createControllerHarness();
  const roomState = createRoomState("ROOM42");

  await harness.controller.handleServerMessage({
    type: "room:state",
    payload: roomState,
  });

  assert.deepEqual(harness.calls.consumedRoomStates, [roomState]);
  assert.deepEqual(harness.calls.receivedRoomState, ["ROOM42"]);
});

test("server message controller marks recent sync request as rate limited", async () => {
  const harness = createControllerHarness();
  const message: ServerMessage = {
    type: "error",
    payload: {
      code: "rate_limited",
      message: "Too many requests.",
    },
  };

  await harness.controller.handleServerMessage(message);

  assert.equal(harness.calls.rateLimited, 1);
  assert.deepEqual(harness.calls.handledMessages, [message]);
});
