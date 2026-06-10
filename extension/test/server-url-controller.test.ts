import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundRuntimeState } from "../src/background/runtime-state";
import { createServerUrlController } from "../src/background/server-url-controller";

function createHarness() {
  const state = createBackgroundRuntimeState();
  const calls = {
    clearPendingLocalShare: [] as string[],
    connect: 0,
    logs: [] as string[],
    notifyAll: 0,
    persistProfileState: 0,
    refreshAnnouncements: 0,
    resetReconnectState: 0,
    stopClockSyncTimer: 0,
    invalidServerUrls: [] as Array<{ context: string; invalidUrl: string }>,
  };
  const controller = createServerUrlController({
    connectionState: state.connection,
    roomSessionState: state.room,
    shareState: state.share,
    async persistProfileState() {
      calls.persistProfileState += 1;
    },
    notifyAll() {
      calls.notifyAll += 1;
    },
    async connect() {
      calls.connect += 1;
    },
    resetReconnectState() {
      calls.resetReconnectState += 1;
    },
    stopClockSyncTimer() {
      calls.stopClockSyncTimer += 1;
    },
    clearPendingLocalShare(reason) {
      calls.clearPendingLocalShare.push(reason);
    },
    async refreshAnnouncements() {
      calls.refreshAnnouncements += 1;
    },
    log(_scope, message) {
      calls.logs.push(message);
    },
    logInvalidServerUrl(context, invalidUrl) {
      calls.invalidServerUrls.push({ context, invalidUrl });
    },
  });

  return { controller, state, calls };
}

test("server URL updates refresh announcements from the new backend", async () => {
  const { controller, state, calls } = createHarness();

  await controller.updateServerUrl("ws://sync.example.com/socket");

  assert.equal(state.connection.serverUrl, "ws://sync.example.com/socket");
  assert.equal(calls.refreshAnnouncements, 1);
  assert.equal(calls.persistProfileState, 1);
  assert.equal(calls.notifyAll, 1);
});

test("server URL updates skip announcement refresh when the URL is invalid or unchanged", async () => {
  const { controller, calls } = createHarness();

  await controller.updateServerUrl("not-a-url");
  await controller.updateServerUrl("ws://localhost:8787");

  assert.equal(calls.refreshAnnouncements, 0);
  assert.equal(calls.persistProfileState, 0);
  assert.equal(calls.invalidServerUrls.length, 1);
});
