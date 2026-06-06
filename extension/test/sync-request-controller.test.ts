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

test("sync request controller backs off expired in-flight refreshes", () => {
  let now = 1_000;
  const controller = createSyncRequestController({
    now: () => now,
    inFlightTimeoutMs: 5_000,
    jitterRatio: 0,
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

  now += 5_001;
  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: false,
    }),
    false,
  );

  now += 1_999;
  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: false,
    }),
    false,
  );

  now += 1;
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

  now += 5_001;
  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: false,
    }),
    false,
  );

  now += 3_999;
  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: false,
    }),
    false,
  );

  now += 1;
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

test("sync request controller uses server retry hints after rate limits", () => {
  let now = 1_000;
  const controller = createSyncRequestController({
    now: () => now,
    jitterRatio: 0,
  });

  controller.markRoomStateRequested("ROOM01");
  now += 100;
  assert.equal(
    (
      controller.markRateLimited as (input: { retryAfterMs: number }) => boolean
    )({ retryAfterMs: 12_000 }),
    true,
  );

  now += 11_999;
  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: false,
    }),
    false,
  );

  now += 1;
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

test("sync request controller falls back to rate limit backoff without server hints", () => {
  let now = 1_000;
  const controller = createSyncRequestController({
    now: () => now,
    jitterRatio: 0,
  });

  controller.markRoomStateRequested("ROOM01");
  now += 100;
  assert.equal(controller.markRateLimited(), true);

  now += 11_999;
  assert.equal(
    controller.shouldRequestRoomState({
      connected: true,
      roomCode: "ROOM01",
      memberToken: "member-token-1",
      hasCachedRoomState: false,
    }),
    false,
  );

  now += 1;
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
