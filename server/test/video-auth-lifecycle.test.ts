import assert from "node:assert/strict";
import test from "node:test";
import type { WebSocket } from "ws";
import { createActiveRoomRegistry } from "../src/active-room-registry.js";
import {
  getDefaultPersistenceConfig,
  getDefaultSecurityConfig,
} from "../src/app.js";
import { createSessionRateLimitState } from "../src/rate-limit.js";
import { createInMemoryRoomStore } from "../src/room-store.js";
import { createRoomService } from "../src/room-service.js";
import type { LogEvent, Session } from "../src/types.js";
import {
  createInMemoryVideoAuthSessionStore,
  createVideoAuthSessionService,
} from "../src/video-auth-session.js";

function createSession(id: string): Session {
  const config = getDefaultSecurityConfig();
  return {
    id,
    connectionState: "attached",
    socket: {} as WebSocket,
    remoteAddress: "127.0.0.1",
    origin: "chrome-extension://allowed-extension",
    roomCode: null,
    memberId: null,
    displayName: `User-${id}`,
    memberToken: null,
    joinedAt: null,
    invalidMessageCount: 0,
    rateLimitState: createSessionRateLimitState(config, 0),
  };
}

function createTokenGenerator(): () => string {
  let id = 0;
  return () => `token-${++id}`.padEnd(16, "x");
}

test("room service clears host video auth when the host leaves the room", async () => {
  let currentTime = 1_000;
  const authService = createVideoAuthSessionService({
    store: createInMemoryVideoAuthSessionStore(),
    now: () => currentTime,
    defaultTtlMs: 600_000,
  });
  const roomStore = createInMemoryRoomStore({ now: () => currentTime });
  const service = createRoomService({
    config: getDefaultSecurityConfig(),
    persistence: getDefaultPersistenceConfig(),
    roomStore,
    activeRooms: createActiveRoomRegistry(),
    generateToken: createTokenGenerator(),
    logEvent: (() => undefined) satisfies LogEvent,
    now: () => currentTime,
    createRoomCode: () => "AUTH01",
    videoAuthLifecycle: {
      clearOwner: (args) => authService.clearOwner(args),
      clearRoom: (roomCode) => authService.clearRoom(roomCode),
      pruneExpired: () => authService.pruneExpired(),
    },
  });

  const host = createSession("host");
  const created = await service.createRoomForSession(host, "Alice");
  const ownerMemberId = host.memberId ?? host.id;

  await authService.authorize({
    roomCode: created.room.code,
    providerId: "bilibili",
    ownerMemberId,
    profile: { id: "mid-1", displayName: "Alice B" },
    credentials: { cookies: "SESSDATA=secret" },
  });

  await (
    service.leaveRoomForSession as (
      session: Session,
      options: { reason: "explicit" },
    ) => Promise<unknown>
  )(host, { reason: "explicit" });

  assert.equal(
    await authService.getStatus({
      roomCode: created.room.code,
      providerId: "bilibili",
      ownerMemberId,
    }),
    null,
  );

  currentTime += 1;
});

test("room service preserves host video auth during refresh disconnect", async () => {
  const currentTime = 2_000;
  const authService = createVideoAuthSessionService({
    store: createInMemoryVideoAuthSessionStore(),
    now: () => currentTime,
    defaultTtlMs: 600_000,
  });
  const roomStore = createInMemoryRoomStore({ now: () => currentTime });
  const service = createRoomService({
    config: getDefaultSecurityConfig(),
    persistence: getDefaultPersistenceConfig(),
    roomStore,
    activeRooms: createActiveRoomRegistry(),
    generateToken: createTokenGenerator(),
    logEvent: (() => undefined) satisfies LogEvent,
    now: () => currentTime,
    createRoomCode: () => "AUTH03",
    videoAuthLifecycle: {
      clearOwner: (args) => authService.clearOwner(args),
      clearRoom: (roomCode) => authService.clearRoom(roomCode),
      pruneExpired: () => authService.pruneExpired(),
    },
  });

  const host = createSession("host");
  const created = await service.createRoomForSession(host, "Alice");
  const ownerMemberId = host.memberId ?? host.id;

  await authService.authorize({
    roomCode: created.room.code,
    providerId: "bilibili",
    ownerMemberId,
    profile: { id: "mid-1", displayName: "Alice B" },
    credentials: { cookies: "SESSDATA=secret" },
  });

  await service.leaveRoomForSession(host);

  assert.deepEqual(
    await authService.getStatus({
      roomCode: created.room.code,
      providerId: "bilibili",
      ownerMemberId,
    }),
    {
      authorized: true,
      providerId: "bilibili",
      profile: { id: "mid-1", displayName: "Alice B" },
      expiresAt: 602_000,
    },
  );
});

test("room service clears room auth for expired room cleanup and owner ttl expiry", async () => {
  let currentTime = 10_000;
  const authService = createVideoAuthSessionService({
    store: createInMemoryVideoAuthSessionStore(),
    now: () => currentTime,
    defaultTtlMs: 600_000,
  });
  const roomStore = createInMemoryRoomStore({ now: () => currentTime });
  const service = createRoomService({
    config: getDefaultSecurityConfig(),
    persistence: getDefaultPersistenceConfig(),
    roomStore,
    activeRooms: createActiveRoomRegistry(),
    generateToken: createTokenGenerator(),
    logEvent: (() => undefined) satisfies LogEvent,
    now: () => currentTime,
    createRoomCode: () => "AUTH02",
    videoAuthLifecycle: {
      clearOwner: (args) => authService.clearOwner(args),
      clearRoom: (roomCode) => authService.clearRoom(roomCode),
      pruneExpired: () => authService.pruneExpired(),
    },
  });

  const expiredRoom = await roomStore.createRoom({
    code: "EXP001",
    joinToken: "join-token-expired",
    createdAt: 9_000,
    ownerMemberId: "owner-expired",
    ownerDisplayName: "Expired Owner",
  });
  await roomStore.updateRoom(expiredRoom.code, expiredRoom.version, {
    expiresAt: currentTime,
    lastActiveAt: 9_500,
  });
  await authService.authorize({
    roomCode: expiredRoom.code,
    providerId: "bilibili",
    ownerMemberId: "owner-expired",
    profile: { id: "mid-expired" },
    credentials: { cookies: "SESSDATA=expired" },
  });

  assert.equal(await service.deleteExpiredRooms(), 1);
  assert.equal(
    await authService.getStatus({
      roomCode: expiredRoom.code,
      providerId: "bilibili",
      ownerMemberId: "owner-expired",
    }),
    null,
  );

  await roomStore.createRoom({
    code: "LIVE01",
    joinToken: "join-token-active",
    createdAt: currentTime,
    ownerMemberId: "owner-live",
    ownerDisplayName: "Live Owner",
  });
  await authService.authorize({
    roomCode: "LIVE01",
    providerId: "bilibili",
    ownerMemberId: "owner-live",
    profile: { id: "mid-live" },
    credentials: { cookies: "SESSDATA=live" },
    ttlMs: 50,
  });

  currentTime += 51;
  assert.equal(await service.deleteExpiredRooms(), 0);
  assert.equal(
    await authService.getStatus({
      roomCode: "LIVE01",
      providerId: "bilibili",
      ownerMemberId: "owner-live",
    }),
    null,
  );
});
