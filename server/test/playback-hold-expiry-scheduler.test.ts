import assert from "node:assert/strict";
import test from "node:test";
import { createPlaybackHoldExpiryScheduler } from "../src/playback-hold-expiry-scheduler.js";
import type { PersistedRoom } from "../src/types.js";

function createRoom(deadlineAt?: number): PersistedRoom {
  return {
    code: "ROOM01",
    joinToken: "join-token",
    createdAt: 1_000,
    ownerMemberId: "member-host",
    memberPermissions: {},
    sharedVideo: null,
    playback: null,
    playbackSync:
      deadlineAt === undefined
        ? {
            strategy: "wait",
            hold: { active: false },
            bufferingMemberIds: [],
          }
        : {
            strategy: "wait",
            hold: {
              active: true,
              reasonMemberId: "member-guest",
              startedAt: 1_000,
              deadlineAt,
            },
            bufferingMemberIds: ["member-guest"],
          },
    chatMessages: [],
    version: 1,
    lastActiveAt: 1_000,
    expiresAt: null,
  };
}

async function flushTimerWork(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test("scheduler releases and broadcasts a hold without another client report", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 1_000;
  const releases: Array<{ roomCode: string; deadline: number }> = [];
  const published: string[] = [];
  const scheduler = createPlaybackHoldExpiryScheduler({
    now: () => now,
    logEvent: () => undefined,
    async releaseExpiredHold(roomCode, deadline) {
      releases.push({ roomCode, deadline });
      return { room: createRoom(), changed: true };
    },
    async publishRoomStateUpdated(roomCode) {
      published.push(roomCode);
    },
  });
  t.after(() => scheduler.stop());

  scheduler.observeRoom(createRoom(2_000));
  now = 1_999;
  t.mock.timers.tick(999);
  await flushTimerWork();
  assert.deepEqual(releases, []);

  now = 2_000;
  t.mock.timers.tick(1);
  await flushTimerWork();
  assert.deepEqual(releases, [{ roomCode: "ROOM01", deadline: 2_000 }]);
  assert.deepEqual(published, ["ROOM01"]);
});

test("scheduler cancels an old deadline when a newer barrier is observed", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 1_000;
  const deadlines: number[] = [];
  const scheduler = createPlaybackHoldExpiryScheduler({
    now: () => now,
    logEvent: () => undefined,
    async releaseExpiredHold(_roomCode, deadline) {
      deadlines.push(deadline);
      return { room: createRoom(), changed: true };
    },
    async publishRoomStateUpdated() {},
  });
  t.after(() => scheduler.stop());

  scheduler.observeRoom(createRoom(2_000));
  scheduler.observeRoom(createRoom(3_000));
  now = 2_000;
  t.mock.timers.tick(1_000);
  await flushTimerWork();
  assert.deepEqual(deadlines, []);

  now = 3_000;
  t.mock.timers.tick(1_000);
  await flushTimerWork();
  assert.deepEqual(deadlines, [3_000]);
});

test("scheduler retries a failed expiry on a bounded delay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 1_000;
  let attempts = 0;
  const published: string[] = [];
  const scheduler = createPlaybackHoldExpiryScheduler({
    now: () => now,
    logEvent: () => undefined,
    async releaseExpiredHold() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("temporary store failure");
      }
      return { room: createRoom(), changed: true };
    },
    async publishRoomStateUpdated(roomCode) {
      published.push(roomCode);
    },
  });
  t.after(() => scheduler.stop());

  scheduler.observeRoom(createRoom(2_000));
  now = 2_000;
  t.mock.timers.tick(1_000);
  await flushTimerWork();
  assert.equal(attempts, 1);

  now = 3_000;
  t.mock.timers.tick(1_000);
  await flushTimerWork();
  assert.equal(attempts, 2);
  assert.deepEqual(published, ["ROOM01"]);
});
