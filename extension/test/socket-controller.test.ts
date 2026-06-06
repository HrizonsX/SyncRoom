import assert from "node:assert/strict";
import test from "node:test";
import { createSocketController } from "../src/background/socket-controller";
import { createBackgroundRuntimeState } from "../src/background/runtime-state";

test("socket controller releases pending room entry after reconnect attempts are exhausted", () => {
  const runtimeState = createBackgroundRuntimeState();
  const logs: string[] = [];
  let notifyAllCalls = 0;
  let persistCalls = 0;

  runtimeState.room.pendingCreateRoom = true;
  runtimeState.room.pendingJoinRoomCode = "ROOM01";
  runtimeState.room.pendingJoinToken = "join-token-1";
  runtimeState.room.pendingJoinRequestSent = true;
  runtimeState.connection.reconnectAttempt = 5;

  const controller = createSocketController({
    connectionState: runtimeState.connection,
    roomSessionState: runtimeState.room,
    maxReconnectAttempts: 5,
    log(_scope, message) {
      logs.push(message);
    },
    logInvalidServerUrl() {},
    logConnectionProbeFailure() {},
    notifyAll() {
      notifyAllCalls += 1;
    },
    stopClockSyncTimer() {},
    syncClock() {},
    startClockSyncTimer() {},
    clearPendingLocalShare() {},
    sendJoinRequest() {},
    sendToServer() {},
    async handleServerMessage() {},
    buildConnectionCheckUrl() {
      return null;
    },
    buildHealthcheckUrl() {
      return null;
    },
    onOpen() {},
    onAdminSessionReset() {},
    formatAdminSessionResetReason(reason) {
      return reason;
    },
    reconnectFailedMessage() {
      return "Reconnect failed.";
    },
    persistState() {
      persistCalls += 1;
    },
  });

  controller.scheduleReconnect();

  assert.equal(runtimeState.connection.lastError, "Reconnect failed.");
  assert.equal(runtimeState.room.pendingCreateRoom, false);
  assert.equal(runtimeState.room.pendingJoinRoomCode, null);
  assert.equal(runtimeState.room.pendingJoinToken, null);
  assert.equal(runtimeState.room.pendingJoinRequestSent, false);
  assert.equal(persistCalls, 1);
  assert.equal(notifyAllCalls, 1);
  assert.ok(logs.includes("Reconnect exhausted after 5 attempts"));
});

test("socket controller releases pending join after final websocket error", async () => {
  const runtimeState = createBackgroundRuntimeState();
  const logs: string[] = [];
  let notifyAllCalls = 0;
  let persistCalls = 0;

  runtimeState.room.pendingJoinRoomCode = "ROOM01";
  runtimeState.room.pendingJoinToken = "join-token-1";
  runtimeState.connection.reconnectAttempt = 5;

  const originalChrome = globalThis.chrome;
  const originalWebSocket = globalThis.WebSocket;
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static latest: FakeWebSocket | null = null;
    readyState = FakeWebSocket.CONNECTING;
    private readonly listeners = new Map<string, Array<() => void>>();

    constructor(_url: string) {
      FakeWebSocket.latest = this;
    }

    addEventListener(type: string, listener: () => void): void {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    dispatch(type: string): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener();
      }
    }
  }

  Object.assign(globalThis, {
    chrome: {
      runtime: {
        getURL() {
          return "chrome-extension://test-extension/";
        },
      },
    } as unknown as typeof chrome,
    WebSocket: FakeWebSocket as unknown as typeof WebSocket,
  });

  try {
    const controller = createSocketController({
      connectionState: runtimeState.connection,
      roomSessionState: runtimeState.room,
      maxReconnectAttempts: 5,
      log(_scope, message) {
        logs.push(message);
      },
      logInvalidServerUrl() {},
      logConnectionProbeFailure() {},
      notifyAll() {
        notifyAllCalls += 1;
      },
      stopClockSyncTimer() {},
      syncClock() {},
      startClockSyncTimer() {},
      clearPendingLocalShare() {},
      sendJoinRequest() {},
      sendToServer() {},
      async handleServerMessage() {},
      buildConnectionCheckUrl() {
        return null;
      },
      buildHealthcheckUrl() {
        return null;
      },
      onOpen() {},
      onAdminSessionReset() {},
      formatAdminSessionResetReason(reason) {
        return reason;
      },
      reconnectFailedMessage() {
        return "Reconnect failed.";
      },
      persistState() {
        persistCalls += 1;
      },
    });

    await controller.connect();
    FakeWebSocket.latest?.dispatch("error");

    assert.equal(runtimeState.connection.lastError, "Reconnect failed.");
    assert.equal(runtimeState.room.pendingJoinRoomCode, null);
    assert.equal(runtimeState.room.pendingJoinToken, null);
    assert.equal(persistCalls, 1);
    assert.equal(notifyAllCalls, 1);
    assert.ok(logs.includes("Reconnect exhausted after 5 attempts"));
  } finally {
    Object.assign(globalThis, {
      chrome: originalChrome,
      WebSocket: originalWebSocket,
    });
  }
});
