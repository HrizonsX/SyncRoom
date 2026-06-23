import assert from "node:assert/strict";
import test from "node:test";
import {
  createVideoAuthSessionService,
  type VideoAuthSessionStore,
} from "../src/video-auth-session.js";
import { createRedisVideoAuthSessionStore } from "../src/redis-video-auth-session-store.js";

const REDIS_URL = process.env.REDIS_URL;

function assertVideoAuthStoreShape(store: VideoAuthSessionStore): void {
  assert.equal(typeof store.get, "function");
  assert.equal(typeof store.set, "function");
  assert.equal(typeof store.delete, "function");
  assert.equal(typeof store.deleteRoom, "function");
  assert.equal(typeof store.deleteOwner, "function");
  assert.equal(typeof store.deleteExpired, "function");
}

test("redis video auth session store shares temporary auth across service instances", async (t) => {
  if (!REDIS_URL) {
    t.skip("REDIS_URL is not configured.");
    return;
  }

  const keyPrefix = `test:video-auth:${Date.now()}:`;
  const store = await createRedisVideoAuthSessionStore(REDIS_URL, {
    keyPrefix,
  });
  assertVideoAuthStoreShape(store satisfies VideoAuthSessionStore);

  try {
    const firstService = createVideoAuthSessionService({
      store,
      now: () => 1_000,
      defaultTtlMs: 600_000,
    });
    const secondService = createVideoAuthSessionService({
      store,
      now: () => 1_000,
      defaultTtlMs: 600_000,
    });

    await firstService.authorize({
      roomCode: "ROOM01",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
      profile: { id: "mid-1", displayName: "Alice" },
      credentials: { cookies: "SESSDATA=secret" },
    });

    assert.deepEqual(
      await secondService.getCredentials({
        roomCode: "ROOM01",
        providerId: "bilibili",
        ownerMemberId: "owner-1",
      }),
      { cookies: "SESSDATA=secret" },
    );
    assert.equal(await secondService.clearRoom("ROOM01"), 1);
    assert.equal(
      await firstService.getCredentials({
        roomCode: "ROOM01",
        providerId: "bilibili",
        ownerMemberId: "owner-1",
      }),
      null,
    );
  } finally {
    await store.close();
  }
});
