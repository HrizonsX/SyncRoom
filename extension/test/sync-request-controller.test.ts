import assert from "node:assert/strict";
import test from "node:test";
import { createSyncRequestController } from "../src/background/sync-request-controller";

test("sync request controller prefers cached room state over server refresh", () => {
  const controller = createSyncRequestController();

  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: true,
    }),
    false,
  );
});

test("sync request controller coalesces in-flight room state refreshes", () => {
  let now = 1_000;
  const controller = createSyncRequestController({
    now: () => now,
    inFlightTimeoutMs: 5_000,
  });

  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: false,
    }),
    true,
  );
  controller.markRoomStateRequested("ROOM01");

  now += 1_000;
  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: false,
    }),
    false,
  );
});

test("sync request controller cools down after a matching rate limit", () => {
  let now = 1_000;
  const controller = createSyncRequestController({
    now: () => now,
    minIntervalMs: 0,
    inFlightTimeoutMs: 1_000,
    rateLimitedCooldownMs: 30_000,
  });

  controller.markRoomStateRequested("ROOM01");
  now += 100;
  assert.equal(controller.markRateLimited(), true);

  now += 10_000;
  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: false,
    }),
    false,
  );

  now += 20_001;
  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: false,
    }),
    true,
  );
});
