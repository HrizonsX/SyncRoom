import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultPersistenceConfig } from "../src/app.js";
import { createInMemoryVideoAuthSessionStore } from "../src/video-auth-session.js";
import {
  createVideoAuthSessionStoreForPersistence,
  type CreateRedisVideoAuthSessionStore,
} from "../src/video-auth-store-factory.js";

test("video auth store factory keeps memory storage unless runtime store is redis", async () => {
  let redisStoreCreated = false;
  const redisStore = createInMemoryVideoAuthSessionStore();
  const createRedisStore: CreateRedisVideoAuthSessionStore = async () => {
    redisStoreCreated = true;
    return redisStore;
  };

  const store = await createVideoAuthSessionStoreForPersistence(
    {
      ...getDefaultPersistenceConfig(),
      provider: "redis",
      runtimeStoreProvider: "memory",
    },
    { createRedisStore },
  );

  assert.notEqual(store, redisStore);
  assert.equal(redisStoreCreated, false);
});

test("video auth store factory uses redis namespaced temporary storage for multi-node runtime", async () => {
  const redisStore = createInMemoryVideoAuthSessionStore();
  let observed:
    | {
        redisUrl: string;
        keyPrefix: string;
      }
    | undefined;
  const createRedisStore: CreateRedisVideoAuthSessionStore = async (
    redisUrl,
    options,
  ) => {
    observed = {
      redisUrl,
      keyPrefix: options.keyPrefix,
    };
    return redisStore;
  };

  const store = await createVideoAuthSessionStoreForPersistence(
    {
      ...getDefaultPersistenceConfig(),
      runtimeStoreProvider: "redis",
      redisUrl: "redis://cache.internal:6379",
      redisNamespace: "tenant-a",
    },
    { createRedisStore },
  );

  assert.equal(store, redisStore);
  assert.deepEqual(observed, {
    redisUrl: "redis://cache.internal:6379",
    keyPrefix: "tenant-a:video-auth:",
  });
});
