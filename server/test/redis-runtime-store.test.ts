import assert from "node:assert/strict";
import test from "node:test";
import { createRedisRuntimeStore } from "../src/redis-runtime-store.js";
import type { Session } from "../src/types.js";

const REDIS_URL = process.env.REDIS_URL;

function createKeyPrefix(): string {
  return `bsp:test:runtime:${Date.now()}:${Math.random().toString(16).slice(2)}:`;
}

function createSession(id: string): Session {
  return {
    id,
    connectionState: "attached",
    socket: {
      readyState: 1,
      OPEN: 1,
      send() {},
      close() {},
      terminate() {},
    } as Session["socket"],
    instanceId: `${id}-node`,
    remoteAddress: "127.0.0.1",
    origin: "chrome-extension://allowed-extension",
    roomCode: null,
    memberId: null,
    memberToken: null,
    displayName: id,
    joinedAt: null,
    invalidMessageCount: 0,
    rateLimitState: {
      roomCreate: { windowStart: 0, count: 0 },
      roomJoin: { windowStart: 0, count: 0 },
      videoShare: { windowStart: 0, count: 0 },
      playbackUpdate: { tokens: 0, lastRefillAt: 0 },
      syncRequest: { windowStart: 0, count: 0 },
      syncPing: { tokens: 0, lastRefillAt: 0 },
    },
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createFakeRedisClient(execPromises: Promise<unknown>[]) {
  let multiIndex = 0;
  return {
    async connect() {},
    async quit() {},
    multi() {
      const execPromise = execPromises[multiIndex++] ?? Promise.resolve(null);
      return {
        sadd() {
          return this;
        },
        srem() {
          return this;
        },
        del() {
          return this;
        },
        hset() {
          return this;
        },
        hdel() {
          return this;
        },
        exec() {
          return execPromise;
        },
      };
    },
    async hgetall() {
      return {};
    },
    async hget() {
      return null;
    },
    async smembers() {
      return [];
    },
    async scard() {
      return 0;
    },
    async sadd() {
      return null;
    },
    async srem() {
      return null;
    },
    async zadd() {
      return null;
    },
    async zremrangebyscore() {
      return null;
    },
    async zrange() {
      return [];
    },
    async zrem() {
      return null;
    },
    async zscore() {
      return null;
    },
    async set() {
      return "OK";
    },
    async del() {
      return null;
    },
  };
}

function createStatefulFakeRedisClient() {
  const sets = new Map<string, Set<string>>();
  const hashes = new Map<string, Map<string, string>>();
  const sortedSets = new Map<string, Map<string, number>>();
  const strings = new Map<string, string>();

  function getSet(key: string): Set<string> {
    const existing = sets.get(key);
    if (existing) {
      return existing;
    }
    const next = new Set<string>();
    sets.set(key, next);
    return next;
  }

  function getHash(key: string): Map<string, string> {
    const existing = hashes.get(key);
    if (existing) {
      return existing;
    }
    const next = new Map<string, string>();
    hashes.set(key, next);
    return next;
  }

  function hset(key: string, ...args: unknown[]): void {
    const hash = getHash(key);
    if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
      for (const [field, value] of Object.entries(
        args[0] as Record<string, unknown>,
      )) {
        hash.set(field, String(value));
      }
      return;
    }
    for (let index = 0; index < args.length; index += 2) {
      const field = args[index];
      const value = args[index + 1];
      if (typeof field === "string") {
        hash.set(field, String(value ?? ""));
      }
    }
  }

  function hdel(key: string, ...fields: string[]): void {
    const hash = hashes.get(key);
    for (const field of fields) {
      hash?.delete(field);
    }
    if (hash?.size === 0) {
      hashes.delete(key);
    }
  }

  function del(...keys: string[]): void {
    for (const key of keys) {
      sets.delete(key);
      hashes.delete(key);
      sortedSets.delete(key);
      strings.delete(key);
    }
  }

  return {
    async connect() {},
    async quit() {},
    multi() {
      const operations: Array<() => void> = [];
      return {
        sadd(key: string, ...members: string[]) {
          operations.push(() => {
            const set = getSet(key);
            for (const member of members) {
              set.add(member);
            }
          });
          return this;
        },
        srem(key: string, ...members: string[]) {
          operations.push(() => {
            const set = sets.get(key);
            for (const member of members) {
              set?.delete(member);
            }
            if (set?.size === 0) {
              sets.delete(key);
            }
          });
          return this;
        },
        del(...keys: string[]) {
          operations.push(() => del(...keys));
          return this;
        },
        hset(key: string, ...args: unknown[]) {
          operations.push(() => hset(key, ...args));
          return this;
        },
        hdel(key: string, ...fields: string[]) {
          operations.push(() => hdel(key, ...fields));
          return this;
        },
        async exec() {
          for (const operation of operations) {
            operation();
          }
          return null;
        },
      };
    },
    async hgetall(key: string) {
      return Object.fromEntries(hashes.get(key)?.entries() ?? []);
    },
    async hget(key: string, field: string) {
      return hashes.get(key)?.get(field) ?? null;
    },
    async smembers(key: string) {
      return Array.from(sets.get(key) ?? []);
    },
    async scard(key: string) {
      return sets.get(key)?.size ?? 0;
    },
    async sadd(key: string, ...members: string[]) {
      const set = getSet(key);
      for (const member of members) {
        set.add(member);
      }
      return null;
    },
    async srem(key: string, ...members: string[]) {
      const set = sets.get(key);
      for (const member of members) {
        set?.delete(member);
      }
      if (set?.size === 0) {
        sets.delete(key);
      }
      return null;
    },
    async zadd(key: string, score: string, member: string) {
      const zset = sortedSets.get(key) ?? new Map<string, number>();
      zset.set(member, Number(score));
      sortedSets.set(key, zset);
      return null;
    },
    async zremrangebyscore(key: string, min: number, max: number) {
      const zset = sortedSets.get(key);
      for (const [member, score] of zset?.entries() ?? []) {
        if (score >= min && score <= max) {
          zset?.delete(member);
        }
      }
      return null;
    },
    async zrange(key: string) {
      return Array.from(sortedSets.get(key)?.keys() ?? []);
    },
    async zrem(key: string, ...members: string[]) {
      const zset = sortedSets.get(key);
      for (const member of members) {
        zset?.delete(member);
      }
      return null;
    },
    async zscore(key: string, member: string) {
      const score = sortedSets.get(key)?.get(member);
      return score === undefined ? null : String(score);
    },
    async set(key: string, value: string) {
      strings.set(key, value);
      return "OK";
    },
    async eval() {
      return 1;
    },
    async del(...keys: string[]) {
      del(...keys);
      return null;
    },
  };
}

test("redis runtime store shares room sessions and member token state across instances", async (t) => {
  if (!REDIS_URL) {
    t.skip("REDIS_URL is not configured.");
    return;
  }

  let currentTime = 1_000;
  const keyPrefix = createKeyPrefix();
  const storeA = await createRedisRuntimeStore(REDIS_URL, {
    keyPrefix,
    now: () => currentTime,
  });
  const storeB = await createRedisRuntimeStore(REDIS_URL, {
    keyPrefix,
    now: () => currentTime,
  });
  const sessionA = createSession("session-a");
  const sessionB = createSession("session-b");

  try {
    storeA.registerSession(sessionA);
    storeB.registerSession(sessionB);
    storeA.markSessionJoinedRoom(sessionA.id, "ROOM01");
    storeB.markSessionJoinedRoom(sessionB.id, "ROOM01");
    storeA.addMember("ROOM01", "member-a", sessionA, "token-a");
    storeB.addMember("ROOM01", "member-b", sessionB, "token-b");

    await new Promise((resolve) => setTimeout(resolve, 25));

    const room = await storeA.getRoom("ROOM01");
    assert.ok(room);
    assert.deepEqual(Array.from(room.members.keys()).sort(), [
      "member-a",
      "member-b",
    ]);
    assert.equal(room.members.get("member-a")?.connectionState, "detached");
    assert.equal(room.members.get("member-a")?.socket, null);
    assert.equal(room.members.get("member-b")?.connectionState, "detached");
    assert.equal(room.members.get("member-b")?.socket, null);
    assert.equal(await storeA.countClusterActiveRooms(), 1);
    assert.equal(
      await storeB.findMemberIdByToken("ROOM01", "token-b"),
      "member-b",
    );

    storeA.blockMemberToken("ROOM01", "token-a", currentTime + 500);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(await storeB.isMemberTokenBlocked("ROOM01", "token-a"), true);

    currentTime += 600;
    assert.equal(await storeB.isMemberTokenBlocked("ROOM01", "token-a"), false);

    await storeA.removeMember("ROOM01", "member-a", sessionA);
    storeA.markSessionLeftRoom(sessionA.id, "ROOM01");
    storeA.unregisterSession(sessionA.id);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const roomAfterRemoval = await storeB.getRoom("ROOM01");
    assert.ok(roomAfterRemoval);
    assert.deepEqual(Array.from(roomAfterRemoval.members.keys()), ["member-b"]);
  } finally {
    await storeA.close();
    await storeB.close();
  }
});

test("redis runtime store updates session display names when the session is re-registered", async (t) => {
  if (!REDIS_URL) {
    t.skip("REDIS_URL is not configured.");
    return;
  }

  const keyPrefix = createKeyPrefix();
  const storeA = await createRedisRuntimeStore(REDIS_URL, {
    keyPrefix,
  });
  const storeB = await createRedisRuntimeStore(REDIS_URL, {
    keyPrefix,
  });
  const session = createSession("session-display");

  try {
    storeA.registerSession(session);
    storeA.markSessionJoinedRoom(session.id, "ROOM02");
    session.memberId = "member-display";
    session.memberToken = "token-display";
    storeA.addMember("ROOM02", session.memberId, session, session.memberToken);
    await new Promise((resolve) => setTimeout(resolve, 25));

    session.displayName = "Alice";
    storeA.registerSession(session);
    await new Promise((resolve) => setTimeout(resolve, 25));

    const room = await storeB.getRoom("ROOM02");
    assert.ok(room);
    assert.equal(room.members.get("member-display")?.displayName, "Alice");
  } finally {
    await storeA.close();
    await storeB.close();
  }
});

test("redis runtime store keeps only the latest room membership after rapid room switches", async (t) => {
  if (!REDIS_URL) {
    t.skip("REDIS_URL is not configured.");
    return;
  }

  const keyPrefix = createKeyPrefix();
  const store = await createRedisRuntimeStore(REDIS_URL, {
    keyPrefix,
  });
  const observer = await createRedisRuntimeStore(REDIS_URL, {
    keyPrefix,
  });
  const session = createSession("session-race");

  try {
    store.registerSession(session);
    store.markSessionJoinedRoom(session.id, "ROOMA1");
    store.markSessionJoinedRoom(session.id, "ROOMB1");
    await store.flush?.();
    await new Promise((resolve) => setTimeout(resolve, 25));

    const roomA = await observer.listClusterSessionsByRoom("ROOMA1");
    const roomB = await observer.listClusterSessionsByRoom("ROOMB1");
    const clusterSessions = await observer.listClusterSessions();
    const storedSession = clusterSessions.find(
      (entry) => entry.id === session.id,
    );

    assert.deepEqual(
      roomA.map((entry) => entry.id),
      [],
    );
    assert.deepEqual(
      roomB.map((entry) => entry.id),
      [session.id],
    );
    assert.equal(storedSession?.roomCode, "ROOMB1");
  } finally {
    await store.close();
    await observer.close();
  }
});

test("redis runtime store can purge stale sessions for a restarted instance", async (t) => {
  if (!REDIS_URL) {
    t.skip("REDIS_URL is not configured.");
    return;
  }

  const keyPrefix = createKeyPrefix();
  const store = await createRedisRuntimeStore(REDIS_URL, {
    keyPrefix,
  });
  const observer = await createRedisRuntimeStore(REDIS_URL, {
    keyPrefix,
  });
  const session = createSession("session-restart");
  session.instanceId = "room-node-a";
  session.memberId = "member-restart";
  session.memberToken = "token-restart";

  try {
    store.registerSession(session);
    store.markSessionJoinedRoom(session.id, "ROOMRS");
    store.addMember("ROOMRS", session.memberId, session, session.memberToken);
    await store.flush?.();
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.equal(
      (await observer.listClusterSessionsByRoom("ROOMRS")).length,
      1,
    );
    assert.equal(await store.purgeSessionsByInstance?.("room-node-a"), 1);
    await new Promise((resolve) => setTimeout(resolve, 25));

    assert.deepEqual(await observer.listClusterSessionsByRoom("ROOMRS"), []);
    const room = await observer.getRoom("ROOMRS");
    assert.equal(room?.members.size ?? 0, 0);
  } finally {
    await store.close();
    await observer.close();
  }
});

test("redis runtime store preserves member tokens when purging restarted instance sessions", async () => {
  const fakeRedis = createStatefulFakeRedisClient();
  const keyPrefix = "bsp:test:runtime:restart:";
  const store = await createRedisRuntimeStore("redis://unused", {
    redisClient: fakeRedis,
    keyPrefix,
  });
  const observer = await createRedisRuntimeStore("redis://unused", {
    redisClient: fakeRedis,
    keyPrefix,
  });
  const session = createSession("session-restart");
  session.instanceId = "room-node-a";
  session.roomCode = "ROOMRS";
  session.memberId = "member-restart";
  session.memberToken = "token-restart";
  session.joinedAt = 1_000;

  try {
    store.registerSession(session);
    store.markSessionJoinedRoom(session.id, "ROOMRS");
    store.addMember("ROOMRS", session.memberId, session, session.memberToken);
    await store.flush?.();

    assert.equal(
      await observer.findMemberIdByToken("ROOMRS", "token-restart"),
      "member-restart",
    );

    assert.equal(await store.purgeSessionsByInstance?.("room-node-a"), 1);
    await store.flush?.();

    const room = await observer.getRoom("ROOMRS");
    assert.equal(room?.members.size ?? 0, 0);
    assert.equal(room?.memberTokens.get("member-restart"), "token-restart");
    assert.equal(
      await observer.findMemberIdByToken("ROOMRS", "token-restart"),
      "member-restart",
    );
  } finally {
    await store.close();
    await observer.close();
  }
});

test("redis runtime store clamps dedup slot TTL to a floor when expiresAt is already in the past", async () => {
  const setCalls: Array<{
    key: string;
    value: string;
    nx: string;
    px: string;
    ms: number;
  }> = [];
  const zaddCalls: Array<{ key: string; score: string; member: string }> = [];
  const fakeRedis = {
    ...createFakeRedisClient([]),
    async set(
      key: string,
      value: string,
      nx: "NX",
      px: "PX",
      milliseconds: number,
    ) {
      setCalls.push({ key, value, nx, px, ms: milliseconds });
      return "OK";
    },
    async zadd(key: string, score: string, member: string) {
      zaddCalls.push({ key, score, member });
      return null;
    },
  };

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message: unknown) => {
    logs.push(String(message));
  };

  const currentTime = 5_000;
  const store = await createRedisRuntimeStore("redis://unused", {
    redisClient: fakeRedis,
    keyPrefix: "bsp:test:dedup:",
    now: () => currentTime,
  });

  try {
    const claimed = await store.tryClaimMessageSlot(
      "ROOMXX",
      "share:actor:url:1",
      currentTime - 10,
    );
    assert.equal(claimed, true, "slot should still be claimed via minimum TTL");
    assert.equal(setCalls.length, 1);
    assert.ok(
      setCalls[0].ms >= 1_000,
      `expected minimum TTL >= 1000ms, got ${setCalls[0].ms}`,
    );
    assert.equal(setCalls[0].nx, "NX");
    assert.equal(setCalls[0].px, "PX");
    assert.equal(zaddCalls.length, 1);
    assert.equal(Number(zaddCalls[0].score), currentTime + setCalls[0].ms);

    const clampLog = logs
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.event === "dedup_slot_ttl_clamped");
    assert.ok(clampLog, "expected dedup_slot_ttl_clamped event to be logged");
    assert.equal(clampLog.roomCode, "ROOMXX");
    assert.equal(clampLog.requestedTtlMs, -10);
    assert.equal(clampLog.appliedTtlMs, 1_000);
    // Raw key must not be logged (contains caller URL + actor id).
    assert.equal(clampLog.key, undefined);
    assert.equal(clampLog.keyKind, "share");
    assert.equal(typeof clampLog.keyHash, "string");
    assert.match(clampLog.keyHash as string, /^[0-9a-f]{16}$/);
  } finally {
    console.log = originalLog;
    await store.close();
  }
});

test("redis runtime store preserves caller-provided TTL without clamping when expiresAt is in the future", async () => {
  const setCalls: Array<{ ms: number }> = [];
  const fakeRedis = {
    ...createFakeRedisClient([]),
    async set(
      _key: string,
      _value: string,
      _nx: "NX",
      _px: "PX",
      milliseconds: number,
    ) {
      setCalls.push({ ms: milliseconds });
      return "OK";
    },
  };

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message: unknown) => {
    logs.push(String(message));
  };

  const currentTime = 5_000;
  const store = await createRedisRuntimeStore("redis://unused", {
    redisClient: fakeRedis,
    keyPrefix: "bsp:test:dedup:",
    now: () => currentTime,
  });

  try {
    // Large positive TTL: used as-is.
    const claimedLarge = await store.tryClaimMessageSlot(
      "ROOMYY",
      "share:actor:url:1",
      currentTime + 5_000,
    );
    assert.equal(claimedLarge, true);
    assert.equal(setCalls.at(-1)?.ms, 5_000);

    // Small but positive TTL: must not be extended to the floor — the caller
    // controls the dedup window and clamping would change its semantics.
    const claimedSmall = await store.tryClaimMessageSlot(
      "ROOMYY",
      "share:actor:url:2",
      currentTime + 50,
    );
    assert.equal(claimedSmall, true);
    assert.equal(setCalls.at(-1)?.ms, 50);

    const clampLogged = logs.some((line) =>
      line.includes("dedup_slot_ttl_clamped"),
    );
    assert.equal(clampLogged, false);
  } finally {
    console.log = originalLog;
    await store.close();
  }
});

test("redis runtime store rejects new pending operations after reaching the configured cap", async () => {
  const firstOperation = createDeferred<unknown>();
  const fakeRedis = createFakeRedisClient([firstOperation.promise]);
  const errors: string[] = [];
  const store = await createRedisRuntimeStore("redis://unused", {
    redisClient: fakeRedis,
    maxPendingOperations: 1,
    onPendingOperationError(context) {
      errors.push(context.reason);
    },
  });

  try {
    store.registerSession(createSession("pending-a"));
    assert.throws(
      () => store.registerSession(createSession("pending-b")),
      /backpressure/,
    );
    assert.deepEqual(errors, ["backpressure"]);

    firstOperation.resolve(null);
    await store.flush?.();

    store.registerSession(createSession("pending-c"));
    await store.flush?.();
  } finally {
    await store.close();
  }
});

test("redis runtime store removes timed out pending operations and recovers", async () => {
  const firstOperation = createDeferred<unknown>();
  const secondOperation = createDeferred<unknown>();
  const fakeRedis = createFakeRedisClient([
    firstOperation.promise,
    secondOperation.promise,
  ]);
  const errors: string[] = [];
  const store = await createRedisRuntimeStore("redis://unused", {
    redisClient: fakeRedis,
    maxPendingOperations: 1,
    pendingOperationTimeoutMs: 20,
    onPendingOperationError(context) {
      errors.push(context.reason);
    },
  });

  try {
    store.registerSession(createSession("timed-out"));
    await new Promise((resolve) => setTimeout(resolve, 40));
    await store.flush?.();

    secondOperation.resolve(null);
    store.registerSession(createSession("recovered"));
    await store.flush?.();

    assert.ok(errors.includes("timeout"));
  } finally {
    await store.close();
  }
});

test("redis runtime store counts a timed-out operation failure only once", async () => {
  const pending = createDeferred<unknown>();
  const failureOperations: string[] = [];
  const store = await createRedisRuntimeStore("redis://example.test:6379", {
    redisClient: createFakeRedisClient([pending.promise]),
    pendingOperationTimeoutMs: 5,
    metricsCollector: {
      observeRedisRuntimeStoreDuration() {},
      observeRedisRuntimeStoreFailure(operation) {
        failureOperations.push(operation);
      },
    },
  });

  try {
    const session = createSession("session-timeout");
    store.registerSession(session);

    await new Promise((resolve) => setTimeout(resolve, 20));
    pending.reject(new Error("late redis failure"));
    await store.flush?.();

    assert.deepEqual(failureOperations, ["register_session"]);
  } finally {
    await store.close();
  }
});
