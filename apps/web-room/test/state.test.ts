import assert from "node:assert/strict";
import test from "node:test";
import { applyServerMessage, createInitialJoinedState } from "../src/state.js";

test("applies room state messages to renderable web-room state", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const nextState = applyServerMessage(state, {
    type: "room:state",
    payload: {
      roomCode: "ABC123",
      sharedVideo: {
        videoId: "BV1xx411c7mD",
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        title: "Shared Bilibili title",
      },
      playback: {
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        currentTime: 12,
        playState: "playing",
        playbackRate: 1,
        updatedAt: 1,
        serverTime: 1,
        actorId: "member-1",
        seq: 1,
      },
      members: [
        { id: "member-1", name: "Alice" },
        { id: "member-2", name: "Bob" },
      ],
    },
  });

  assert.equal(nextState.videoTitle, "Shared Bilibili title");
  assert.deepEqual(nextState.members, [
    { id: "member-1", name: "Alice" },
    { id: "member-2", name: "Bob" },
  ]);
  assert.equal(
    nextState.playbackUrl,
    "https://www.bilibili.com/video/BV1xx411c7mD",
  );
  assert.deepEqual(nextState.playback, {
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    currentTime: 12,
    playState: "playing",
    playbackRate: 1,
    updatedAt: 1,
    serverTime: 1,
    actorId: "member-1",
    seq: 1,
  });
  assert.match(nextState.diagnostics.at(-1) ?? "", /room:state/);
});

test("restores host identity from room state after refresh rejoin", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-host",
    hostMemberId: "",
    displayName: "Alice",
  });

  const nextState = applyServerMessage(state, {
    type: "room:state",
    payload: {
      roomCode: "ABC123",
      hostMemberId: "member-host",
      sharedVideo: null,
      playback: null,
      members: [{ id: "member-host", name: "Alice" }],
    },
  });

  assert.equal(nextState.hostMemberId, "member-host");
});

test("extracts member-safe provider playback status from room state", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-2",
    hostMemberId: "member-host",
    displayName: "Bob",
  });

  const nextState = applyServerMessage(state, {
    type: "room:state",
    payload: {
      roomCode: "ABC123",
      sharedVideo: {
        videoId: "BV1xx411c7mD",
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        title: "Shared Bilibili title",
        provider: {
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
        },
      },
      playback: null,
      members: [],
    },
  });

  assert.deepEqual(nextState.providerPlaybackStatus, {
    providerId: "bilibili",
    itemTitle: "Part 1",
    sourceType: "mpd",
    proxy: true,
    shared: false,
  });
  assert.doesNotMatch(
    JSON.stringify(nextState.providerPlaybackStatus),
    /manifest-1|sourceUrl|SESSDATA|Cookie/i,
  );
});

test("applies chat rate-limit errors as a client cooldown", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const nextState = applyServerMessage(
    state,
    {
      type: "error",
      payload: {
        code: "chat_rate_limited",
        message: "Chat messages are limited to one message every 5 seconds.",
        messageType: "chat:message",
        retryAfterMs: 4_000,
      },
    },
    { now: () => 10_000 },
  );

  assert.equal(nextState.chatCooldownUntil, 14_000);
  assert.match(nextState.diagnostics.at(-1) ?? "", /chat cooldown/);
});

test("applies announcement updates and chat broadcasts", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const withAnnouncement = applyServerMessage(state, {
    type: "announcement:update",
    payload: {
      version: 1,
      updatedAt: 1,
      items: [{ id: "notice-1", text: "今晚 20:00 开始" }],
    },
  });
  const withChat = applyServerMessage(withAnnouncement, {
    type: "chat:message",
    payload: {
      roomCode: "ABC123",
      memberId: "member-2",
      displayName: "Bob",
      content: "收到",
      timestamp: 1_725_000_000_000,
    },
  });

  assert.equal(withChat.announcement, "今晚 20:00 开始");
  assert.equal(withChat.chatMessages.length, 1);
  assert.equal(withChat.chatMessages[0]?.content, "收到");
});

test("adds centered system chat messages for room member lifecycle events", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const withJoined = applyServerMessage(
    state,
    {
      type: "room:member-joined",
      payload: {
        roomCode: "ABC123",
        member: { id: "member-2", name: "Bob" },
      },
    },
    { now: () => 12_000 },
  );
  const withLeft = applyServerMessage(
    withJoined,
    {
      type: "room:member-left",
      payload: {
        roomCode: "ABC123",
        member: { id: "member-2", name: "Bob" },
      },
    },
    { now: () => 13_000 },
  );
  const messages = withLeft.chatMessages as Array<{
    kind?: string;
    systemEventType?: string;
    content: string;
    timestamp: number;
  }>;

  assert.deepEqual(
    messages.map((message) => ({
      kind: message.kind,
      systemEventType: message.systemEventType,
      content: message.content,
      timestamp: message.timestamp,
    })),
    [
      {
        kind: "system",
        systemEventType: "member_joined",
        content: "Bob 加入了房间",
        timestamp: 12_000,
      },
      {
        kind: "system",
        systemEventType: "member_left",
        content: "Bob 离开了房间",
        timestamp: 13_000,
      },
    ],
  );
});

test("adds voice system chat messages only when microphone mute state changes", () => {
  const baseState = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });
  const state = {
    ...baseState,
    members: [
      { id: "member-1", name: "Alice" },
      { id: "member-2", name: "Bob" },
    ],
    voice: {
      ...baseState.voice,
      participants: {
        "member-2": {
          memberId: "member-2",
          connected: true,
          muted: true,
          speaking: false,
        },
      },
    },
  };

  const withOpenMic = applyServerMessage(
    state,
    {
      type: "voice:state",
      payload: {
        roomCode: "ABC123",
        memberId: "member-2",
        connected: true,
        muted: false,
        speaking: false,
      },
    },
    { now: () => 14_000 },
  );
  const withDuplicateOpenMic = applyServerMessage(
    withOpenMic,
    {
      type: "voice:state",
      payload: {
        roomCode: "ABC123",
        memberId: "member-2",
        connected: true,
        muted: false,
        speaking: true,
      },
    },
    { now: () => 15_000 },
  );
  const withCloseMic = applyServerMessage(
    withDuplicateOpenMic,
    {
      type: "voice:state",
      payload: {
        roomCode: "ABC123",
        memberId: "member-2",
        connected: true,
        muted: true,
        speaking: false,
      },
    },
    { now: () => 16_000 },
  );
  const messages = withCloseMic.chatMessages as Array<{
    kind?: string;
    systemEventType?: string;
    content: string;
    timestamp: number;
  }>;

  assert.deepEqual(
    messages.map((message) => ({
      kind: message.kind,
      systemEventType: message.systemEventType,
      content: message.content,
      timestamp: message.timestamp,
    })),
    [
      {
        kind: "system",
        systemEventType: "voice_unmuted",
        content: "Bob 开启了麦克风",
        timestamp: 14_000,
      },
      {
        kind: "system",
        systemEventType: "voice_muted",
        content: "Bob 关闭了麦克风",
        timestamp: 16_000,
      },
    ],
  );
});

test("applies private room danmaku broadcasts as ephemeral joined-state messages", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const withDanmaku = applyServerMessage(state, {
    type: "danmaku:message",
    payload: {
      roomCode: "ABC123",
      memberId: "member-2",
      displayName: "Bob",
      content: "<script>alert(1)</script>",
      videoTime: 42.25,
      mode: "scroll",
      color: "#ffffff",
      timestamp: 1_725_000_000_000,
    },
  });
  const withRoomState = applyServerMessage(withDanmaku, {
    type: "room:state",
    payload: {
      roomCode: "ABC123",
      sharedVideo: null,
      playback: null,
      members: [{ id: "member-1", name: "Alice" }],
    },
  });

  assert.equal(withDanmaku.danmakuMessages.length, 1);
  assert.equal(
    withDanmaku.danmakuMessages[0]?.content,
    "<script>alert(1)</script>",
  );
  assert.equal(withRoomState.danmakuMessages.length, 1);
});
