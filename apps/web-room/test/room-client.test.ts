import assert from "node:assert/strict";
import test from "node:test";
import {
  isClientMessage,
  type ProviderPlaybackDescriptor,
} from "@syncroom/protocol";
import {
  createWebRoomSocketClient,
  loadWebRoomSession,
  persistWebRoomSession,
  type StorageLike,
} from "../src/room-client.js";

class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function createSentMessageRecorder() {
  const sent: unknown[] = [];
  const client = createWebRoomSocketClient({
    serverUrl: "https://syncroom.example.test",
    socketFactory(url) {
      assert.equal(url, "wss://syncroom.example.test/syncroom-ws");
      return {
        send(data) {
          sent.push(JSON.parse(data));
        },
      };
    },
  });
  return { client, sent };
}

const providerPlaybackDescriptor: ProviderPlaybackDescriptor = {
  providerId: "bilibili",
  sourceId: "BV1xx411c7mD",
  sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
  title: "Bilibili video",
  item: {
    itemId: "BV1xx411c7mD:cid-987654",
    title: "Part 1",
    kind: "part",
    cid: "987654",
    bvid: "BV1xx411c7mD",
  },
  policy: {
    proxy: true,
    shared: false,
  },
  candidates: [
    {
      id: "dash-avc-1080p",
      sourceType: "mpd",
      url: "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
      qualityLabel: "1080P",
      codecs: "avc1.640028,mp4a.40.2",
      default: true,
    },
  ],
  defaultCandidateId: "dash-avc-1080p",
};

test("sends existing room session messages over websocket", () => {
  const { client, sent } = createSentMessageRecorder();

  client.createRoom("Alice");
  client.joinRoom({
    roomCode: "ABC123",
    joinToken: "valid-join-token-123",
    memberToken: "valid-member-token-123",
    displayName: "Alice",
  });
  client.leaveRoom("valid-member-token-123");
  client.requestSync("valid-member-token-123");
  client.sendChat({
    memberToken: "valid-member-token-123",
    content: "hello",
  });
  client.sendDanmaku({
    memberToken: "valid-member-token-123",
    content: "front row",
    videoTime: 42.5,
    color: "#ffffff",
  });
  client.ping(123);

  assert.deepEqual(
    sent.map((message) => (message as { type: string }).type),
    [
      "room:create",
      "room:join",
      "room:leave",
      "sync:request",
      "chat:message",
      "danmaku:message",
      "sync:ping",
    ],
  );
  assert.deepEqual(sent[4], {
    type: "chat:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "hello",
    },
  });
  assert.deepEqual(sent[5], {
    type: "danmaku:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "front row",
      videoTime: 42.5,
      mode: "scroll",
      color: "#ffffff",
    },
  });
});

test("sends playback update messages using the shared protocol contract", () => {
  const { client, sent } = createSentMessageRecorder();

  client.updatePlayback({
    type: "playback:update",
    payload: {
      memberToken: "valid-member-token-123",
      playback: {
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        currentTime: 21,
        playState: "playing",
        playbackRate: 1,
        updatedAt: 5_000,
        serverTime: 5_000,
        actorId: "member-host",
        seq: 1,
      },
    },
  });

  assert.equal(isClientMessage(sent[0]), true);
  assert.deepEqual(sent[0], {
    type: "playback:update",
    payload: {
      memberToken: "valid-member-token-123",
      playback: {
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        currentTime: 21,
        playState: "playing",
        playbackRate: 1,
        updatedAt: 5_000,
        serverTime: 5_000,
        actorId: "member-host",
        seq: 1,
      },
    },
  });
});

test("sends host member management messages", () => {
  const { client, sent } = createSentMessageRecorder();

  client.setRoomMemberPermission({
    memberToken: "valid-member-token-123",
    targetMemberId: "member-2",
    permission: "chat",
    allowed: false,
  });
  client.kickRoomMember({
    memberToken: "valid-member-token-123",
    targetMemberId: "member-2",
  });
  client.transferRoomHost({
    memberToken: "valid-member-token-123",
    targetMemberId: "member-2",
  });

  assert.deepEqual(sent, [
    {
      type: "room:member-permission:set",
      payload: {
        memberToken: "valid-member-token-123",
        targetMemberId: "member-2",
        permission: "chat",
        allowed: false,
      },
    },
    {
      type: "room:member:kick",
      payload: {
        memberToken: "valid-member-token-123",
        targetMemberId: "member-2",
      },
    },
    {
      type: "room:host:transfer",
      payload: {
        memberToken: "valid-member-token-123",
        targetMemberId: "member-2",
      },
    },
  ]);
});

test("sends LiveKit voice access and voice state using existing contracts", () => {
  const { client, sent } = createSentMessageRecorder();

  client.requestVoiceAccess("valid-member-token-123");
  client.updateVoiceState({
    memberToken: "valid-member-token-123",
    connected: true,
    muted: false,
    speaking: true,
  });

  assert.deepEqual(sent, [
    {
      type: "voice:access",
      payload: {
        memberToken: "valid-member-token-123",
      },
    },
    {
      type: "voice:state",
      payload: {
        memberToken: "valid-member-token-123",
        connected: true,
        muted: false,
        speaking: true,
      },
    },
  ]);
});

test("sends provider video share messages with explicit proxy and shared policy", () => {
  const { client, sent } = createSentMessageRecorder();

  client.shareVideo({
    memberToken: "valid-member-token-123",
    video: {
      videoId: "BV1xx411c7mD",
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      title: "Part 1",
      provider: providerPlaybackDescriptor,
    },
  });

  assert.equal(isClientMessage(sent[0]), true);
  assert.deepEqual(sent[0], {
    type: "video:share",
    payload: {
      memberToken: "valid-member-token-123",
      video: {
        videoId: "BV1xx411c7mD",
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        title: "Part 1",
        provider: providerPlaybackDescriptor,
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(sent[0]), /SESSDATA|Cookie/i);
});

test("sends low-cardinality playback report messages", () => {
  const { client, sent } = createSentMessageRecorder();

  client.reportPlayback({
    memberToken: "valid-member-token-123",
    event: "startup_failure",
    providerId: "bilibili",
    stage: "manifest",
  });
  client.reportPlayback({
    memberToken: "valid-member-token-123",
    event: "player_error",
    providerId: "bilibili",
    stage: "decode",
    browser: "chrome",
    system: "windows",
  });

  assert.equal(isClientMessage(sent[0]), true);
  assert.equal(isClientMessage(sent[1]), true);
  assert.deepEqual(sent, [
    {
      type: "playback:report",
      payload: {
        memberToken: "valid-member-token-123",
        event: "startup_failure",
        providerId: "bilibili",
        stage: "manifest",
      },
    },
    {
      type: "playback:report",
      payload: {
        memberToken: "valid-member-token-123",
        event: "player_error",
        providerId: "bilibili",
        stage: "decode",
        browser: "chrome",
        system: "windows",
      },
    },
  ]);
});

test("persists only safe web room rejoin state", () => {
  const storage = new MemoryStorage();

  persistWebRoomSession(storage, {
    roomCode: "ABC123",
    joinToken: "valid-join-token-123",
    memberToken: "valid-member-token-123",
    displayName: "Alice",
    serverUrl: "wss://syncroom.example.test",
    authCookie: "must-not-persist",
  });

  assert.deepEqual(loadWebRoomSession(storage), {
    roomCode: "ABC123",
    joinToken: "valid-join-token-123",
    memberToken: "valid-member-token-123",
    displayName: "Alice",
    serverUrl: "wss://syncroom.example.test",
  });
  assert.doesNotMatch(
    storage.getItem("syncroom:web-room-session") ?? "",
    /authCookie|must-not-persist/,
  );
});

test("drops malformed persisted web room session state", () => {
  const storage = new MemoryStorage();

  storage.setItem(
    "syncroom:web-room-session",
    JSON.stringify({
      roomCode: "abc123",
      joinToken: "short",
      memberToken: "valid-member-token-123",
      displayName: "Alice",
      serverUrl: "wss://syncroom.example.test",
    }),
  );

  assert.equal(loadWebRoomSession(storage), null);
});
