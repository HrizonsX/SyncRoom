import assert from "node:assert/strict";
import test from "node:test";
import type { WebSocket } from "ws";
import { createAdminActionService } from "../src/admin/action-service.js";
import { createAuditLogService } from "../src/admin/audit-log.js";
import type { GlobalEventStore } from "../src/admin/global-event-store.js";
import { createAdminRoomQueryService } from "../src/admin/room-query-service.js";
import type { AdminSession } from "../src/admin/types.js";
import { createActiveRoomRegistry } from "../src/active-room-registry.js";
import {
  getDefaultPersistenceConfig,
  getDefaultSecurityConfig,
} from "../src/app.js";
import {
  createProviderPlaybackDescriptor,
  type ProviderParseResult,
} from "../src/providers/video-provider.js";
import { createSessionRateLimitState } from "../src/rate-limit.js";
import { createInMemoryRoomStore, roomStateOf } from "../src/room-store.js";
import { createRoomService } from "../src/room-service.js";
import { createInMemoryRuntimeStore } from "../src/runtime-store.js";
import type { PersistedRoom, Session } from "../src/types.js";
import {
  createInMemoryVideoAuthSessionStore,
  createVideoAuthSessionService,
} from "../src/video-auth-session.js";

const SENSITIVE_VALUES = [
  "SESSDATA=secret",
  "csrf-secret",
  "raw-token",
  "Bearer provider-secret",
];

const ACTOR: AdminSession = {
  id: "admin-session",
  adminId: "admin-1",
  username: "admin",
  role: "admin",
  createdAt: 1,
  expiresAt: 2,
  lastSeenAt: 1,
};

const stubEventStore: GlobalEventStore = {
  async append() {},
  async query() {
    return { items: [], pagination: { page: 1, pageSize: 0, total: 0 } };
  },
};

function assertNoSensitiveValues(value: unknown): void {
  const text = JSON.stringify(value);
  for (const sensitiveValue of SENSITIVE_VALUES) {
    assert.equal(
      text.includes(sensitiveValue),
      false,
      `payload leaked ${sensitiveValue}: ${text}`,
    );
  }
}

function createSession(id: string, roomCode: string | null = null): Session {
  const config = getDefaultSecurityConfig();
  return {
    id,
    connectionState: "attached",
    socket: {} as WebSocket,
    instanceId: "node-a",
    remoteAddress: "127.0.0.1",
    origin: "chrome-extension://allowed-extension",
    roomCode,
    memberId: roomCode ? id : null,
    displayName: `User-${id}`,
    memberToken: roomCode ? `member-token-${id}` : null,
    joinedAt: roomCode ? 1_000 : null,
    invalidMessageCount: 0,
    rateLimitState: createSessionRateLimitState(config, 0),
  };
}

function createRoom(code = "ROOM01"): PersistedRoom {
  return {
    code,
    joinToken: "join-token",
    createdAt: 1_000,
    ownerMemberId: "owner",
    ownerDisplayName: "Alice",
    sharedVideo: null,
    playback: null,
    version: 0,
    lastActiveAt: 1_000,
    expiresAt: null,
  };
}

test("auth status room payloads and Admin room views omit provider credentials", async () => {
  const authService = createVideoAuthSessionService({
    store: createInMemoryVideoAuthSessionStore(),
    now: () => 1_000,
    defaultTtlMs: 600_000,
  });
  await authService.authorize({
    roomCode: "ROOM01",
    providerId: "bilibili",
    ownerMemberId: "owner",
    profile: { id: "mid-1", displayName: "Alice" },
    credentials: {
      cookies: "SESSDATA=secret",
      csrf: "csrf-secret",
      authorization: "Bearer provider-secret",
    },
  });
  assertNoSensitiveValues(
    await authService.getStatus({
      roomCode: "ROOM01",
      providerId: "bilibili",
      ownerMemberId: "owner",
    }),
  );

  const parseResult: ProviderParseResult = {
    providerId: "bilibili",
    sourceId: "BV1safe",
    sourceUrl: "https://www.bilibili.com/video/BV1safe",
    title: "Safe Video",
    items: [
      {
        item: {
          itemId: "part-1",
          title: "Part 1",
          kind: "part",
          bvid: "BV1safe",
          cid: "cid-1",
        },
        candidates: [
          {
            id: "dash",
            sourceType: "mpd",
            url: "/proxy/manifest/opaque",
            rawHeaders: {
              Cookie: "SESSDATA=secret",
              Authorization: "Bearer provider-secret",
            },
          },
        ],
        rawApiResponse: {
          csrf: "csrf-secret",
        },
      },
    ],
  };
  const provider = createProviderPlaybackDescriptor(parseResult, {
    itemId: "part-1",
    policy: { proxy: true, shared: true },
  });
  const roomStore = createInMemoryRoomStore({ now: () => 1_000 });
  const room = await roomStore.createRoom({
    code: "ROOM01",
    joinToken: "join-token",
    createdAt: 1_000,
    ownerMemberId: "owner",
    ownerDisplayName: "Alice",
  });
  const savedRoom = await roomStore.saveRoom({
    ...room,
    sharedVideo: {
      videoId: "BV1safe",
      url: "https://www.bilibili.com/video/BV1safe",
      title: "Safe Video",
      sharedByMemberId: "owner",
      provider,
    },
  });
  assertNoSensitiveValues(roomStateOf(savedRoom, null));

  const runtimeStore = createInMemoryRuntimeStore(() => 1_000);
  const service = createAdminRoomQueryService({
    instanceId: "node-a",
    roomStore,
    runtimeStore,
    eventStore: stubEventStore,
  });

  assertNoSensitiveValues(
    await service.listRooms({
      status: "all",
      includeExpired: true,
      page: 1,
      pageSize: 20,
      sortBy: "lastActiveAt",
      sortOrder: "desc",
    }),
  );
  assertNoSensitiveValues(await service.getRoomDetail("ROOM01"));
});

test("room service redacts provider credentials from auth lifecycle cleanup logs", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const roomStore = createInMemoryRoomStore({ now: () => 1_000 });
  const service = createRoomService({
    config: getDefaultSecurityConfig(),
    persistence: getDefaultPersistenceConfig(),
    roomStore,
    activeRooms: createActiveRoomRegistry(),
    generateToken: (() => {
      let id = 0;
      return () => `token-${++id}`.padEnd(16, "x");
    })(),
    logEvent(event, data) {
      events.push({ event, data });
    },
    now: () => 1_000,
    createRoomCode: () => "ROOM01",
    videoAuthLifecycle: {
      clearOwner: async () => {
        throw new Error(
          "cleanup failed Cookie: SESSDATA=secret; csrf=csrf-secret; token=raw-token",
        );
      },
    },
  });
  const host = createSession("host");
  await service.createRoomForSession(host, "Alice");

  await service.leaveRoomForSession(host, { reason: "explicit" });

  assert.ok(
    events.some(
      (entry) => entry.event === "video_auth_lifecycle_cleanup_failed",
    ),
  );
  assertNoSensitiveValues(events);
});

test("Admin room deletion logs redact provider credentials from auth cleanup failures", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const session = createSession("owner", "ROOM01");
  const service = createAdminActionService({
    instanceId: "node-a",
    roomStore: {
      getRoom: async (roomCode) => createRoom(roomCode),
      updateRoom: async () => {
        throw new Error("updateRoom should not be called.");
      },
      deleteRoom: async () => {},
      listRooms: async () => [],
      countRooms: async () => 1,
      isReady: async () => true,
      createRoom: async () => {
        throw new Error("createRoom should not be called.");
      },
      saveRoom: async (room) => room,
    },
    runtimeStore: {
      listSessionsByRoom: () => [session],
      getSession: () => session,
      deleteRoom: () => {},
    },
    listClusterSessions: async () => [session],
    listClusterSessionsByRoom: async () => [session],
    requestAdminCommand: async () => ({
      requestId: "req-close",
      targetInstanceId: "node-a",
      executorInstanceId: "node-a",
      status: "ok",
      sessionId: session.id,
      roomCode: "ROOM01",
      completedAt: 1_000,
    }),
    auditLogService: createAuditLogService(),
    ipBlockStore: {
      list: async () => [],
      add: async () => ({ created: true }),
      delete: async () => true,
    },
    getRoomStateByCode: async () => null,
    publishRoomStateUpdate: async () => {},
    publishRoomDeleted: async () => {},
    videoAuthLifecycle: {
      clearRoom: async () => {
        throw new Error(
          "cleanup failed Authorization: Bearer provider-secret; Cookie: SESSDATA=secret",
        );
      },
    },
    logEvent(event, data) {
      events.push({ event, data });
    },
    now: () => 1_000,
  });

  await service.closeRoom(ACTOR, "ROOM01", "cleanup");

  assert.ok(
    events.some(
      (entry) => entry.event === "video_auth_lifecycle_cleanup_failed",
    ),
  );
  assertNoSensitiveValues(events);
});
