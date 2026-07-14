import { Redis } from "ioredis";
import type {
  VideoAuthSessionKey,
  VideoAuthSessionRecord,
  VideoAuthSessionStore,
} from "./video-auth-session.js";

export type RedisVideoAuthSessionStoreOptions = {
  keyPrefix: string;
};

export type RedisVideoAuthSessionStore = VideoAuthSessionStore & {
  close: () => Promise<void>;
};

function encodeKeyPart(value: string): string {
  return encodeURIComponent(value);
}

function cloneRecord(record: VideoAuthSessionRecord): VideoAuthSessionRecord {
  return JSON.parse(JSON.stringify(record)) as VideoAuthSessionRecord;
}

function createRedisVideoAuthSessionKeys(keyPrefix: string) {
  const recordKey = (key: VideoAuthSessionKey): string =>
    `${keyPrefix}record:${encodeKeyPart(key.roomCode)}:${encodeKeyPart(
      key.providerId,
    )}:${encodeKeyPart(key.ownerMemberId)}`;
  const roomIndexKey = (roomCode: string): string =>
    `${keyPrefix}room:${encodeKeyPart(roomCode)}`;
  const ownerIndexKey = (args: {
    roomCode: string;
    ownerMemberId: string;
  }): string =>
    `${keyPrefix}owner:${encodeKeyPart(args.roomCode)}:${encodeKeyPart(
      args.ownerMemberId,
    )}`;
  return {
    expiryIndexKey: `${keyPrefix}expiry`,
    ownerIndexKey,
    recordKey,
    roomIndexKey,
  };
}

function parseRecord(value: string | null): VideoAuthSessionRecord | null {
  if (!value) {
    return null;
  }
  return JSON.parse(value) as VideoAuthSessionRecord;
}

export async function createRedisVideoAuthSessionStore(
  redisUrl: string,
  options: RedisVideoAuthSessionStoreOptions,
): Promise<RedisVideoAuthSessionStore> {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const keys = createRedisVideoAuthSessionKeys(options.keyPrefix);

  await redis.connect();

  async function getRecordByRedisKey(
    recordKey: string,
  ): Promise<VideoAuthSessionRecord | null> {
    return parseRecord(await redis.get(recordKey));
  }

  async function deleteRecordByRedisKey(
    recordKey: string,
  ): Promise<VideoAuthSessionRecord | null> {
    const record = await getRecordByRedisKey(recordKey);
    const transaction = redis.multi();
    transaction.del(recordKey);
    transaction.zrem(keys.expiryIndexKey, recordKey);
    if (record) {
      transaction.srem(keys.roomIndexKey(record.roomCode), recordKey);
      transaction.srem(
        keys.ownerIndexKey({
          roomCode: record.roomCode,
          ownerMemberId: record.ownerMemberId,
        }),
        recordKey,
      );
    }
    await transaction.exec();
    return record;
  }

  async function deleteRecordKeys(recordKeys: string[]): Promise<number> {
    let deletedCount = 0;
    for (const recordKey of recordKeys) {
      const deleted = await deleteRecordByRedisKey(recordKey);
      if (deleted) {
        deletedCount += 1;
      }
    }
    return deletedCount;
  }

  return {
    async get(key) {
      const record = await getRecordByRedisKey(keys.recordKey(key));
      return record ? cloneRecord(record) : null;
    },
    async set(record) {
      const recordKey = keys.recordKey(record);
      const transaction = redis.multi();
      transaction.set(recordKey, JSON.stringify(record));
      transaction.sadd(keys.roomIndexKey(record.roomCode), recordKey);
      transaction.sadd(
        keys.ownerIndexKey({
          roomCode: record.roomCode,
          ownerMemberId: record.ownerMemberId,
        }),
        recordKey,
      );
      transaction.zadd(
        keys.expiryIndexKey,
        String(record.expiresAt),
        recordKey,
      );
      await transaction.exec();
    },
    async delete(key) {
      return (await deleteRecordByRedisKey(keys.recordKey(key))) !== null;
    },
    async deleteRoom(roomCode) {
      const roomKey = keys.roomIndexKey(roomCode);
      const recordKeys = await redis.smembers(roomKey);
      const deletedCount = await deleteRecordKeys(recordKeys);
      await redis.del(roomKey);
      return deletedCount;
    },
    async deleteOwner(args) {
      const ownerKey = keys.ownerIndexKey(args);
      const recordKeys = await redis.smembers(ownerKey);
      const deletedCount = await deleteRecordKeys(recordKeys);
      await redis.del(ownerKey);
      return deletedCount;
    },
    async deleteExpired(currentTime) {
      const recordKeys = await redis.zrangebyscore(
        keys.expiryIndexKey,
        0,
        currentTime,
      );
      let deletedCount = 0;
      for (const recordKey of recordKeys) {
        const record = await getRecordByRedisKey(recordKey);
        if (!record) {
          await redis.zrem(keys.expiryIndexKey, recordKey);
          continue;
        }
        if (record.expiresAt > currentTime) {
          await redis.zadd(
            keys.expiryIndexKey,
            String(record.expiresAt),
            recordKey,
          );
          continue;
        }
        await deleteRecordByRedisKey(recordKey);
        deletedCount += 1;
      }
      return deletedCount;
    },
    async close() {
      await redis.quit();
    },
  };
}
