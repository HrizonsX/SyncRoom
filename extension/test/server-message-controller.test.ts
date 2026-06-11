import assert from "node:assert/strict";
import test from "node:test";
import { createServerMessageController } from "../src/background/server-message-controller";
import type {
  AnnouncementState,
  RoomState,
  ServerMessage,
} from "@syncroom/protocol";

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
    rateLimited: [] as Array<number | undefined>,
    handledMessages: [] as ServerMessage[],
    consumedRoomStates: [] as RoomState[],
    announcementStates: [] as AnnouncementState[],
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
    handleAnnouncementUpdate(announcements) {
      calls.announcementStates.push(announcements);
    },
    updateClockOffset() {},
    notifyAll() {
      calls.notifyAll += 1;
    },
    syncRequestController: {
      markRoomStateReceived(roomCode: string) {
        calls.receivedRoomState.push(roomCode);
      },
      markRateLimited(retryAfterMs?: number) {
        calls.rateLimited.push(retryAfterMs);
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

test("server message controller handles announcement updates without room lifecycle side effects", async () => {
  const harness = createControllerHarness();
  const announcements: AnnouncementState = {
    version: 1,
    updatedAt: 1_710_000_000_000,
    items: [{ id: "notice-1", text: "Maintenance starts at 20:00." }],
  };

  await harness.controller.handleServerMessage({
    type: "announcement:update",
    payload: announcements,
  });

  assert.deepEqual(harness.calls.announcementStates, [announcements]);
  assert.deepEqual(harness.calls.handledMessages, []);
  assert.deepEqual(harness.calls.consumedRoomStates, []);
  assert.deepEqual(harness.calls.logs, ["<- announcement:update"]);
  assert.equal(harness.calls.notifyAll, 1);
});

test("server message controller marks recent sync request as rate limited", async () => {
  const harness = createControllerHarness();
  const message: ServerMessage = {
    type: "error",
    payload: {
      code: "rate_limited",
      message: "Too many requests.",
      messageType: "sync:request",
      retryAfterMs: 7_500,
    },
  };

  await harness.controller.handleServerMessage(message);

  assert.deepEqual(harness.calls.rateLimited, [7_500]);
  assert.deepEqual(harness.calls.handledMessages, [message]);
});
