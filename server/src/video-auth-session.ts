import type { ErrorCode, VideoProviderId } from "@syncroom/protocol";
import { MEMBER_TOKEN_INVALID_MESSAGE } from "./messages.js";
import type { PersistedRoom, Session } from "./types.js";

export type VideoAuthAction = "start" | "poll" | "status" | "parse" | "logout";

export type VideoAuthProfile = {
  id: string;
  displayName?: string;
  avatarUrl?: string;
  vipLabel?: string;
};

export type VideoAuthCredentials = Record<string, unknown>;

export type VideoAuthSessionRecord = {
  roomCode: string;
  providerId: VideoProviderId;
  ownerMemberId: string;
  profile: VideoAuthProfile | null;
  credentials: VideoAuthCredentials;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
};

export type VideoAuthStatus = {
  authorized: true;
  providerId: VideoProviderId;
  profile: VideoAuthProfile | null;
  expiresAt: number;
};

export type VideoAuthAccessContext = {
  roomCode: string;
  providerId: VideoProviderId;
  ownerMemberId: string;
  displayName: string | null;
};

export type VideoAuthSessionKey = {
  roomCode: string;
  providerId: VideoProviderId;
  ownerMemberId: string;
};

export type VideoAuthSessionStore = {
  get: (key: VideoAuthSessionKey) => Promise<VideoAuthSessionRecord | null>;
  set: (record: VideoAuthSessionRecord) => Promise<void>;
  delete: (key: VideoAuthSessionKey) => Promise<boolean>;
  deleteRoom: (roomCode: string) => Promise<number>;
  deleteOwner: (args: {
    roomCode: string;
    ownerMemberId: string;
  }) => Promise<number>;
  deleteExpired: (currentTime: number) => Promise<number>;
};

export type VideoAuthLifecycle = {
  clearRoom?: (roomCode: string) => Promise<number> | number;
  clearOwner?: (args: {
    roomCode: string;
    ownerMemberId: string;
  }) => Promise<number> | number;
  pruneExpired?: () => Promise<number> | number;
};

export const DEFAULT_VIDEO_AUTH_OWNER_OFFLINE_TTL_MS = 10 * 60_000;

export class VideoAuthSessionError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = "VideoAuthSessionError";
  }
}

function createKey(key: VideoAuthSessionKey): string {
  return `${key.roomCode}:${key.providerId}:${key.ownerMemberId}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneRecord(record: VideoAuthSessionRecord): VideoAuthSessionRecord {
  return {
    ...record,
    profile: record.profile ? cloneJson(record.profile) : null,
    credentials: cloneJson(record.credentials),
  };
}

export function createInMemoryVideoAuthSessionStore(): VideoAuthSessionStore {
  const records = new Map<string, VideoAuthSessionRecord>();

  return {
    async get(key) {
      const record = records.get(createKey(key));
      return record ? cloneRecord(record) : null;
    },
    async set(record) {
      records.set(createKey(record), cloneRecord(record));
    },
    async delete(key) {
      return records.delete(createKey(key));
    },
    async deleteRoom(roomCode) {
      let deletedCount = 0;
      for (const [key, record] of records.entries()) {
        if (record.roomCode !== roomCode) {
          continue;
        }
        records.delete(key);
        deletedCount += 1;
      }
      return deletedCount;
    },
    async deleteOwner(args) {
      let deletedCount = 0;
      for (const [key, record] of records.entries()) {
        if (
          record.roomCode !== args.roomCode ||
          record.ownerMemberId !== args.ownerMemberId
        ) {
          continue;
        }
        records.delete(key);
        deletedCount += 1;
      }
      return deletedCount;
    },
    async deleteExpired(currentTime) {
      let deletedCount = 0;
      for (const [key, record] of records.entries()) {
        if (record.expiresAt > currentTime) {
          continue;
        }
        records.delete(key);
        deletedCount += 1;
      }
      return deletedCount;
    },
  };
}

export function createVideoAuthSessionService(options: {
  store: VideoAuthSessionStore;
  defaultTtlMs: number;
  now?: () => number;
}): {
  authorize: (args: {
    roomCode: string;
    providerId: VideoProviderId;
    ownerMemberId: string;
    profile: VideoAuthProfile | null;
    credentials: VideoAuthCredentials;
    ttlMs?: number;
  }) => Promise<VideoAuthStatus>;
  getStatus: (key: VideoAuthSessionKey) => Promise<VideoAuthStatus | null>;
  getCredentials: (
    key: VideoAuthSessionKey,
  ) => Promise<VideoAuthCredentials | null>;
  logout: (key: VideoAuthSessionKey) => Promise<boolean>;
  clearRoom: (roomCode: string) => Promise<number>;
  clearOwner: (args: {
    roomCode: string;
    ownerMemberId: string;
  }) => Promise<number>;
  pruneExpired: () => Promise<number>;
  requireHostAccess: (args: {
    room: PersistedRoom;
    session: Session;
    memberToken: string;
    providerId: VideoProviderId;
    action: VideoAuthAction;
  }) => VideoAuthAccessContext;
} {
  const now = options.now ?? Date.now;

  function toStatus(record: VideoAuthSessionRecord): VideoAuthStatus {
    return {
      authorized: true,
      providerId: record.providerId,
      profile: record.profile ? cloneJson(record.profile) : null,
      expiresAt: record.expiresAt,
    };
  }

  async function getActiveRecord(
    key: VideoAuthSessionKey,
  ): Promise<VideoAuthSessionRecord | null> {
    const record = await options.store.get(key);
    if (!record) {
      return null;
    }
    if (record.expiresAt <= now()) {
      await options.store.delete(key);
      return null;
    }
    return record;
  }

  return {
    async authorize(args) {
      const currentTime = now();
      const record: VideoAuthSessionRecord = {
        roomCode: args.roomCode,
        providerId: args.providerId,
        ownerMemberId: args.ownerMemberId,
        profile: args.profile ? cloneJson(args.profile) : null,
        credentials: cloneJson(args.credentials),
        createdAt: currentTime,
        updatedAt: currentTime,
        expiresAt: currentTime + (args.ttlMs ?? options.defaultTtlMs),
      };
      await options.store.set(record);
      return toStatus(record);
    },
    async getStatus(key) {
      const record = await getActiveRecord(key);
      return record ? toStatus(record) : null;
    },
    async getCredentials(key) {
      const record = await getActiveRecord(key);
      return record ? cloneJson(record.credentials) : null;
    },
    logout(key) {
      return options.store.delete(key);
    },
    clearRoom(roomCode) {
      return options.store.deleteRoom(roomCode);
    },
    clearOwner(args) {
      return options.store.deleteOwner(args);
    },
    pruneExpired() {
      return options.store.deleteExpired(now());
    },
    requireHostAccess(args) {
      const actorMemberId = args.session.memberId ?? args.session.id;
      if (
        !args.session.roomCode ||
        args.session.roomCode !== args.room.code ||
        !args.room.ownerMemberId ||
        actorMemberId !== args.room.ownerMemberId
      ) {
        throw new VideoAuthSessionError(
          "provider_auth_forbidden",
          "Provider authorization is only available to the room owner.",
          "host_only",
        );
      }
      if (
        !args.session.memberToken ||
        args.memberToken !== args.session.memberToken
      ) {
        throw new VideoAuthSessionError(
          "member_token_invalid",
          MEMBER_TOKEN_INVALID_MESSAGE,
          "member_token_invalid",
        );
      }

      return {
        roomCode: args.room.code,
        providerId: args.providerId,
        ownerMemberId: actorMemberId,
        displayName: args.room.ownerDisplayName ?? args.session.displayName,
      };
    },
  };
}

export type VideoAuthSessionService = ReturnType<
  typeof createVideoAuthSessionService
>;
