import assert from "node:assert/strict";
import test from "node:test";
import {
  VideoAuthSessionError,
  createInMemoryVideoAuthSessionStore,
  createVideoAuthSessionService,
} from "../src/video-auth-session.js";
import type { PersistedRoom, Session } from "../src/types.js";

function createRoom(overrides: Partial<PersistedRoom> = {}): PersistedRoom {
  return {
    code: "ABC123",
    joinToken: "join-token",
    createdAt: 0,
    ownerMemberId: "owner-1",
    ownerDisplayName: "Alice",
    sharedVideo: null,
    playback: null,
    version: 0,
    lastActiveAt: 0,
    expiresAt: null,
    ...overrides,
  };
}

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    connectionState: "detached",
    socket: null,
    instanceId: "node-a",
    remoteAddress: "127.0.0.1",
    origin: "https://syncroom.example.test",
    roomCode: "ABC123",
    memberId: "owner-1",
    displayName: "Alice",
    memberToken: "owner-token",
    joinedAt: 0,
    invalidMessageCount: 0,
    rateLimitState: {} as Session["rateLimitState"],
    ...overrides,
  };
}

test("video auth session keeps credentials server-side and returns safe status", async () => {
  let now = 1_000;
  const service = createVideoAuthSessionService({
    store: createInMemoryVideoAuthSessionStore(),
    now: () => now,
    defaultTtlMs: 600_000,
  });

  await service.authorize({
    roomCode: "ABC123",
    providerId: "bilibili",
    ownerMemberId: "owner-1",
    profile: {
      id: "mid-1",
      displayName: "Alice B",
      avatarUrl: "https://i0.hdslb.com/avatar.jpg",
      vipLabel: "annual",
    },
    credentials: {
      cookies: "SESSDATA=secret",
      csrf: "csrf-secret",
    },
  });

  const status = await service.getStatus({
    roomCode: "ABC123",
    providerId: "bilibili",
    ownerMemberId: "owner-1",
  });
  assert.deepEqual(status, {
    authorized: true,
    providerId: "bilibili",
    profile: {
      id: "mid-1",
      displayName: "Alice B",
      avatarUrl: "https://i0.hdslb.com/avatar.jpg",
      vipLabel: "annual",
    },
    expiresAt: 601_000,
  });
  assert.equal(JSON.stringify(status).includes("secret"), false);

  const credentials = await service.getCredentials({
    roomCode: "ABC123",
    providerId: "bilibili",
    ownerMemberId: "owner-1",
  });
  assert.deepEqual(credentials, {
    cookies: "SESSDATA=secret",
    csrf: "csrf-secret",
  });
  now = 601_001;
  assert.equal(
    await service.getCredentials({
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
    }),
    null,
  );
});

test("video auth access is host-only and survives owner refresh before ttl", () => {
  const service = createVideoAuthSessionService({
    store: createInMemoryVideoAuthSessionStore(),
    defaultTtlMs: 600_000,
  });
  const room = createRoom();
  const refreshedOwnerSession = createSession({
    id: "session-2",
    memberId: "owner-1",
    memberToken: "fresh-owner-token",
  });

  assert.deepEqual(
    service.requireHostAccess({
      room,
      session: refreshedOwnerSession,
      memberToken: "fresh-owner-token",
      providerId: "bilibili",
      action: "status",
    }),
    {
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
      displayName: "Alice",
    },
  );

  assert.throws(
    () =>
      service.requireHostAccess({
        room,
        session: createSession({
          id: "session-3",
          memberId: "member-2",
          memberToken: "member-token",
        }),
        memberToken: "member-token",
        providerId: "bilibili",
        action: "logout",
      }),
    (error) =>
      error instanceof VideoAuthSessionError &&
      error.code === "provider_auth_forbidden",
  );
  assert.throws(
    () =>
      service.requireHostAccess({
        room,
        session: refreshedOwnerSession,
        memberToken: "wrong-token",
        providerId: "bilibili",
        action: "parse",
      }),
    (error) =>
      error instanceof VideoAuthSessionError &&
      error.code === "member_token_invalid",
  );
});

test("video auth session supports logout, room cleanup, owner cleanup, and ttl pruning", async () => {
  let now = 10_000;
  const service = createVideoAuthSessionService({
    store: createInMemoryVideoAuthSessionStore(),
    now: () => now,
    defaultTtlMs: 100,
  });

  await service.authorize({
    roomCode: "ABC123",
    providerId: "bilibili",
    ownerMemberId: "owner-1",
    profile: { id: "mid-1" },
    credentials: { cookies: "SESSDATA=secret" },
  });
  await service.authorize({
    roomCode: "ABC123",
    providerId: "bilibili",
    ownerMemberId: "owner-2",
    profile: { id: "mid-2" },
    credentials: { cookies: "SESSDATA=other" },
  });

  assert.equal(
    await service.logout({
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
    }),
    true,
  );
  assert.equal(
    await service.getStatus({
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
    }),
    null,
  );

  await service.authorize({
    roomCode: "ROOM2",
    providerId: "bilibili",
    ownerMemberId: "owner-3",
    profile: { id: "mid-3" },
    credentials: { cookies: "SESSDATA=room2" },
  });

  assert.equal(await service.clearRoom("ABC123"), 1);
  assert.equal(
    await service.getCredentials({
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-2",
    }),
    null,
  );

  await service.authorize({
    roomCode: "ABC123",
    providerId: "bilibili",
    ownerMemberId: "owner-1",
    profile: { id: "mid-1" },
    credentials: { cookies: "SESSDATA=secret" },
  });
  assert.equal(
    await service.clearOwner({ roomCode: "ABC123", ownerMemberId: "owner-1" }),
    1,
  );

  now = 10_101;
  assert.equal(await service.pruneExpired(), 1);
  assert.equal(
    await service.getStatus({
      roomCode: "ROOM2",
      providerId: "bilibili",
      ownerMemberId: "owner-3",
    }),
    null,
  );
});
