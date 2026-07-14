import { getRedisVideoAuthSessionKeyPrefix } from "./redis-namespace.js";
import {
  createRedisVideoAuthSessionStore,
  type RedisVideoAuthSessionStore,
  type RedisVideoAuthSessionStoreOptions,
} from "./redis-video-auth-session-store.js";
import type { PersistenceConfig } from "./types.js";
import {
  createInMemoryVideoAuthSessionStore,
  type VideoAuthSessionStore,
} from "./video-auth-session.js";

export type CreateRedisVideoAuthSessionStore = (
  redisUrl: string,
  options: RedisVideoAuthSessionStoreOptions,
) => Promise<RedisVideoAuthSessionStore | VideoAuthSessionStore>;

export async function createVideoAuthSessionStoreForPersistence(
  persistenceConfig: PersistenceConfig,
  options: {
    createRedisStore?: CreateRedisVideoAuthSessionStore;
  } = {},
): Promise<VideoAuthSessionStore> {
  if (persistenceConfig.runtimeStoreProvider !== "redis") {
    return createInMemoryVideoAuthSessionStore();
  }

  const createRedisStore =
    options.createRedisStore ?? createRedisVideoAuthSessionStore;
  return await createRedisStore(persistenceConfig.redisUrl, {
    keyPrefix: getRedisVideoAuthSessionKeyPrefix(
      persistenceConfig.redisNamespace,
    ),
  });
}
