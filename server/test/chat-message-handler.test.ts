import assert from "node:assert/strict";
import test from "node:test";
import { createMessageHandler } from "../src/message-handler.js";
import { createRoomEventConsumer } from "../src/room-event-consumer.js";
import { createSessionRateLimitState } from "../src/rate-limit.js";
import { RoomServiceError } from "../src/room-service.js";
import type { RoomEventBusMessage } from "../src/room-event-bus.js";
import type { Session } from "../src/types.js";

const CONFIG = {
  maxMembersPerRoom: 8,
  rateLimits: {
    roomCreatePerMinute: 3,
    roomJoinPerMinute: 10,
    videoSharePer10Seconds: 3,
    playbackUpdatePerSecond: 8,
    playbackUpdateBurst: 12,
    syncRequestPer10Seconds: 6,
    syncPingPerSecond: 1,
    syncPingBurst: 2,
    chatMessagePer5Seconds: 1,
    danmakuMessagePer5Seconds: 2,
  },
};

function createSession(id: string, overrides: Partial<Session> = {}): Session {
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
    instanceId: "node-a",
    remoteAddress: "127.0.0.1",
    origin: "https://syncroom.example.test",
    roomCode: "ABC123",
    memberId: "member-1",
    displayName: "Alice",
    memberToken: "valid-member-token-123",
    joinedAt: 1,
    invalidMessageCount: 0,
    rateLimitState: createSessionRateLimitState(CONFIG, 0),
    ...overrides,
  };
}

function createRoomServiceStub() {
  return {
    async createRoomForSession() {
      throw new Error("unreachable");
    },
    async joinRoomForSession() {
      throw new Error("unreachable");
    },
    async leaveRoomForSession() {
      return { room: null };
    },
    async shareVideoForSession() {
      throw new Error("unreachable");
    },
    async updatePlaybackForSession() {
      throw new Error("unreachable");
    },
    async updateProfileForSession() {
      throw new Error("unreachable");
    },
    async getRoomStateForSession() {
      return {
        roomCode: "ABC123",
        sharedVideo: null,
        playback: null,
        members: [{ id: "member-1", name: "Alice" }],
      };
    },
  };
}

test("chat messages from joined members publish room chat events", async () => {
  const published: RoomEventBusMessage[] = [];
  const appended: unknown[] = [];
  const session = createSession("session-1");
  const roomService = {
    ...createRoomServiceStub(),
    async appendChatMessageForSession(
      receivedSession: Session,
      memberToken: string,
      message: {
        memberId: string;
        displayName: string;
        content: string;
        timestamp: number;
      },
    ) {
      appended.push({ receivedSession, memberToken, message });
      return {
        room: {
          code: "ABC123",
        },
      };
    },
  };
  const handler = createMessageHandler({
    config: CONFIG,
    roomService,
    logEvent() {},
    send() {},
    sendError() {
      throw new Error("sendError should not be called");
    },
    async publishRoomEvent(message) {
      published.push(message);
    },
    instanceId: "node-a",
    now: () => 1_000,
  });

  await handler.handleClientMessage(session, {
    type: "chat:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "hello",
    },
  });
  await handler.flushPendingPublishes();

  assert.deepEqual(appended, [
    {
      receivedSession: session,
      memberToken: "valid-member-token-123",
      message: {
        memberId: "member-1",
        displayName: "Alice",
        content: "hello",
        timestamp: 1_000,
      },
    },
  ]);
  assert.equal(published.length, 1);
  assert.deepEqual(published[0], {
    type: "room_chat_message",
    roomCode: "ABC123",
    memberId: "member-1",
    displayName: "Alice",
    content: "hello",
    timestamp: 1_000,
    sourceInstanceId: "node-a",
    emittedAt: 1_000,
  });
});

test("chat messages are rate limited per websocket session", async () => {
  const errors: unknown[][] = [];
  const published: RoomEventBusMessage[] = [];
  let now = 0;
  const session = createSession("session-1", {
    rateLimitState: createSessionRateLimitState(CONFIG, now),
  });
  const handler = createMessageHandler({
    config: CONFIG,
    roomService: createRoomServiceStub(),
    logEvent() {},
    send() {},
    sendError(...args) {
      errors.push(args);
    },
    async publishRoomEvent(message) {
      published.push(message);
    },
    instanceId: "node-a",
    now: () => now,
  });

  await handler.handleClientMessage(session, {
    type: "chat:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "first",
    },
  });
  now = 1_000;
  await handler.handleClientMessage(session, {
    type: "chat:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "second",
    },
  });
  await handler.flushPendingPublishes();

  assert.equal(published.length, 1);
  assert.deepEqual(errors, [
    [
      session.socket,
      "chat_rate_limited",
      "Chat messages are limited to one message every 5 seconds.",
      {
        messageType: "chat:message",
        retryAfterMs: 4_000,
      },
    ],
  ]);
});

test("danmaku messages use the configured five second window", async () => {
  const errors: unknown[][] = [];
  const published: RoomEventBusMessage[] = [];
  let now = 0;
  const config = {
    ...CONFIG,
    rateLimits: {
      ...CONFIG.rateLimits,
      chatMessagePer5Seconds: 10,
    },
  };
  const session = createSession("session-1", {
    rateLimitState: createSessionRateLimitState(config, now),
  });
  const handler = createMessageHandler({
    config,
    roomService: createRoomServiceStub(),
    logEvent() {},
    send() {},
    sendError(...args) {
      errors.push(args);
    },
    async publishRoomEvent(message) {
      published.push(message);
    },
    instanceId: "node-a",
    now: () => now,
  });

  await handler.handleClientMessage(session, {
    type: "danmaku:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "first",
      videoTime: 1,
    },
  });
  now = 500;
  await handler.handleClientMessage(session, {
    type: "danmaku:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "second",
      videoTime: 2,
    },
  });
  now = 1_000;
  await handler.handleClientMessage(session, {
    type: "danmaku:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "third",
      videoTime: 3,
    },
  });
  await handler.flushPendingPublishes();

  assert.equal(
    published.filter((message) => message.type === "room_danmaku_message")
      .length,
    2,
  );
  assert.deepEqual(errors, [
    [
      session.socket,
      "chat_rate_limited",
      "Danmaku messages are limited to one message every second.",
      {
        messageType: "danmaku:message",
        retryAfterMs: 4_000,
      },
    ],
  ]);
});

test("chat messages from non-members are rejected without broadcast", async () => {
  const errors: unknown[][] = [];
  const published: RoomEventBusMessage[] = [];
  const session = createSession("session-1", {
    roomCode: null,
    memberId: null,
    memberToken: null,
  });
  const roomService = {
    ...createRoomServiceStub(),
    async getRoomStateForSession() {
      throw new RoomServiceError("not_in_room", "Not in room.", "not_in_room");
    },
  };
  const handler = createMessageHandler({
    config: CONFIG,
    roomService,
    logEvent() {},
    send() {},
    sendError(...args) {
      errors.push(args);
    },
    async publishRoomEvent(message) {
      published.push(message);
    },
    instanceId: "node-a",
  });

  await handler.handleClientMessage(session, {
    type: "chat:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "hello",
    },
  });

  assert.deepEqual(published, []);
  assert.equal(errors[0]?.[1], "not_in_room");
});

test("room event consumer broadcasts chat messages to local room sessions", async () => {
  const sent: unknown[] = [];
  const session = createSession("session-1");
  const roomEventBus = {
    async publish() {},
    async subscribe(
      handler: (message: RoomEventBusMessage) => Promise<void> | void,
    ) {
      await handler({
        type: "room_chat_message",
        roomCode: "ABC123",
        memberId: "member-2",
        displayName: "Bob",
        content: "<b>hi</b>",
        timestamp: 1_725_000_000_000,
        sourceInstanceId: "node-b",
        emittedAt: 1_725_000_000_000,
      });
      return async () => {};
    },
  };

  await createRoomEventConsumer({
    roomEventBus,
    async getRoomStateByCode() {
      throw new Error("chat should not load durable room state");
    },
    listLocalSessionsByRoom() {
      return [session];
    },
    send(_socket, message) {
      sent.push(message);
    },
  });

  assert.deepEqual(sent, [
    {
      type: "chat:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-2",
        displayName: "Bob",
        content: "<b>hi</b>",
        timestamp: 1_725_000_000_000,
      },
    },
  ]);
});

test("danmaku messages from joined members publish ephemeral room danmaku events", async () => {
  const published: RoomEventBusMessage[] = [];
  const session = createSession("session-1");
  const handler = createMessageHandler({
    config: CONFIG,
    roomService: createRoomServiceStub(),
    logEvent() {},
    send() {},
    sendError() {
      throw new Error("sendError should not be called");
    },
    async publishRoomEvent(message) {
      published.push(message);
    },
    instanceId: "node-a",
    now: () => 1_000,
  });

  await handler.handleClientMessage(session, {
    type: "danmaku:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "front row",
      videoTime: 42.25,
      mode: "scroll",
      color: "#ffffff",
    },
  });
  await handler.flushPendingPublishes();

  assert.equal(published.length, 1);
  assert.deepEqual(published[0], {
    type: "room_danmaku_message",
    roomCode: "ABC123",
    memberId: "member-1",
    displayName: "Alice",
    content: "front row",
    videoTime: 42.25,
    mode: "scroll",
    color: "#ffffff",
    timestamp: 1_000,
    sourceInstanceId: "node-a",
    emittedAt: 1_000,
  });
});

test("danmaku messages use a separate rate limit from text chat", async () => {
  const errors: unknown[][] = [];
  const published: RoomEventBusMessage[] = [];
  let now = 0;
  const session = createSession("session-1", {
    rateLimitState: createSessionRateLimitState(CONFIG, now),
  });
  const handler = createMessageHandler({
    config: CONFIG,
    roomService: createRoomServiceStub(),
    logEvent() {},
    send() {},
    sendError(...args) {
      errors.push(args);
    },
    async publishRoomEvent(message) {
      published.push(message);
    },
    instanceId: "node-a",
    now: () => now,
  });

  await handler.handleClientMessage(session, {
    type: "chat:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "hello",
    },
  });
  now = 1_000;
  await handler.handleClientMessage(session, {
    type: "danmaku:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "first danmaku",
      videoTime: 12,
    },
  });
  now = 2_000;
  await handler.handleClientMessage(session, {
    type: "danmaku:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "second danmaku",
      videoTime: 13,
    },
  });
  now = 3_000;
  await handler.handleClientMessage(session, {
    type: "danmaku:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "third danmaku",
      videoTime: 14,
    },
  });
  await handler.flushPendingPublishes();

  assert.equal(
    published.filter((message) => message.type === "room_chat_message").length,
    1,
  );
  assert.equal(
    published.filter((message) => message.type === "room_danmaku_message")
      .length,
    2,
  );
  assert.deepEqual(errors, [
    [
      session.socket,
      "chat_rate_limited",
      "Danmaku messages are limited to one message every second.",
      {
        messageType: "danmaku:message",
        retryAfterMs: 2_000,
      },
    ],
  ]);
});

test("room event consumer broadcasts danmaku without loading durable room state", async () => {
  const sent: unknown[] = [];
  const session = createSession("session-1");
  const roomEventBus = {
    async publish() {},
    async subscribe(
      handler: (message: RoomEventBusMessage) => Promise<void> | void,
    ) {
      await handler({
        type: "room_danmaku_message",
        roomCode: "ABC123",
        memberId: "member-2",
        displayName: "Bob",
        content: "<b>hi</b>",
        videoTime: 42.25,
        mode: "scroll",
        color: "#ffffff",
        timestamp: 1_725_000_000_000,
        sourceInstanceId: "node-b",
        emittedAt: 1_725_000_000_000,
      });
      return async () => {};
    },
  };

  await createRoomEventConsumer({
    roomEventBus,
    async getRoomStateByCode() {
      throw new Error("danmaku should not load durable room state");
    },
    listLocalSessionsByRoom() {
      return [session];
    },
    send(_socket, message) {
      sent.push(message);
    },
  });

  assert.deepEqual(sent, [
    {
      type: "danmaku:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-2",
        displayName: "Bob",
        content: "<b>hi</b>",
        videoTime: 42.25,
        mode: "scroll",
        color: "#ffffff",
        timestamp: 1_725_000_000_000,
      },
    },
  ]);
});
