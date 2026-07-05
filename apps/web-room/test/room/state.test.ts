import assert from "node:assert/strict";
import test from "node:test";
import {
  applyServerMessage,
  createInitialJoinedState,
} from "../../src/room/state.js";

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
  assert.match(
    nextState.diagnostics.at(-1) ?? "",
    /room:state applied members:2 chat:0 source:- playback:playing/,
  );
});

test("preserves explicit live play and pause intents from room state", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const nextState = applyServerMessage(state, {
    type: "room:state",
    payload: {
      roomCode: "ABC123",
      sharedVideo: null,
      playback: {
        url: "https://live.example.test/room.m3u8",
        currentTime: 0,
        playState: "paused",
        syncIntent: "explicit-pause",
        userInitiated: true,
        playbackRate: 1,
        updatedAt: 1,
        serverTime: 1,
        actorId: "member-2",
        seq: 3,
      },
      members: [{ id: "member-1", name: "Alice" }],
    },
  });

  assert.equal(nextState.playback?.syncIntent, "explicit-pause");
  assert.equal(nextState.playback?.userInitiated, true);
});

test("does not append duplicate room state diagnostics for unchanged summaries", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });
  const roomStateMessage = {
    type: "room:state" as const,
    payload: {
      roomCode: "ABC123",
      playback: {
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        currentTime: 12,
        playState: "playing" as const,
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
  };

  const firstState = applyServerMessage(state, roomStateMessage);
  const secondState = applyServerMessage(firstState, roomStateMessage);

  assert.equal(secondState.diagnostics.length, firstState.diagnostics.length);
  assert.equal(
    secondState.diagnostics.filter((item) =>
      item.includes("room:state applied"),
    ).length,
    1,
  );
});

test("restores room chat history from room state after refresh rejoin", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-2",
    displayName: "Bob",
  });

  const nextState = applyServerMessage(state, {
    type: "room:state",
    payload: {
      roomCode: "ABC123",
      sharedVideo: null,
      playback: null,
      members: [
        { id: "member-1", name: "Alice" },
        { id: "member-2", name: "Bob" },
      ],
      chatMessages: [
        {
          memberId: "member-1",
          displayName: "Alice",
          content: "hello",
          timestamp: 1_000,
        },
        {
          kind: "system",
          systemEventType: "member_joined",
          memberId: "member-1",
          displayName: "Alice",
          content: "Alice 加入了房间",
          timestamp: 1_500,
        },
        {
          memberId: "member-2",
          displayName: "Bob",
          content: "收到",
          timestamp: 2_000,
        },
      ],
    },
  });

  assert.deepEqual(nextState.chatMessages, [
    {
      memberId: "member-1",
      displayName: "Alice",
      content: "hello",
      timestamp: 1_000,
    },
    {
      kind: "system",
      systemEventType: "member_joined",
      memberId: "member-1",
      displayName: "Alice",
      content: "Alice 加入了房间",
      timestamp: 1_500,
    },
    {
      memberId: "member-2",
      displayName: "Bob",
      content: "收到",
      timestamp: 2_000,
    },
  ]);
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

test("restores host provider picker from shared provider room state after refresh", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-host",
    hostMemberId: "member-host",
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
              id: "mp4-360p",
              sourceType: "mp4",
              url: "https://syncroom.example.test/proxy/segment/video-360.mp4",
              qualityLabel: "360P",
              default: false,
            },
            {
              id: "mp4-720p",
              sourceType: "mp4",
              url: "https://syncroom.example.test/proxy/segment/video-720.mp4",
              qualityLabel: "720P",
              default: true,
            },
          ],
          defaultCandidateId: "mp4-720p",
        },
      },
      playback: null,
      members: [{ id: "member-host", name: "Alice" }],
    },
  });

  assert.equal(nextState.providerPicker?.status, "ready");
  assert.equal(
    nextState.providerPicker?.url,
    "https://www.bilibili.com/video/BV1xx411c7mD",
  );
  assert.equal(nextState.providerPicker?.proxy, true);
  assert.equal(nextState.providerPicker?.shared, false);
  assert.equal(
    nextState.providerPicker?.selectedItemId,
    "BV1xx411c7mD:cid-987654",
  );
  assert.equal(
    nextState.providerPicker?.selectedQualityCandidateId,
    "mp4-720p",
  );
  assert.equal(nextState.providerPicker?.items.length, 1);
  assert.deepEqual(nextState.providerPicker?.items[0]?.providerDescriptor, {
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
        id: "mp4-360p",
        sourceType: "mp4",
        url: "https://syncroom.example.test/proxy/segment/video-360.mp4",
        qualityLabel: "360P",
        default: false,
      },
      {
        id: "mp4-720p",
        sourceType: "mp4",
        url: "https://syncroom.example.test/proxy/segment/video-720.mp4",
        qualityLabel: "720P",
        default: true,
      },
    ],
    defaultCandidateId: "mp4-720p",
  });
});

test("restores host provider picker with the first candidate when no default is marked", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-host",
    hostMemberId: "member-host",
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
        provider: {
          providerId: "bilibili",
          sourceId: "BV1xx411c7mD",
          sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
          title: "Bilibili video",
          item: {
            itemId: "BV1xx411c7mD:cid-987654",
            title: "Part 1",
            kind: "part",
          },
          policy: {
            proxy: true,
            shared: true,
          },
          candidates: [
            {
              id: "mp4-360p",
              sourceType: "mp4",
              url: "https://syncroom.example.test/proxy/segment/video-360.mp4",
            },
          ],
        },
      },
      playback: null,
      members: [{ id: "member-host", name: "Alice" }],
    },
  });

  assert.equal(
    nextState.providerPicker?.selectedQualityCandidateId,
    "mp4-360p",
  );
});

test("marks live provider playback sources for non-seekable controls", () => {
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
        videoId: "22889518",
        url: "https://live.bilibili.com/22889518",
        title: "Live Room",
        provider: {
          providerId: "bilibili",
          sourceId: "22889518",
          sourceUrl: "https://live.bilibili.com/22889518",
          title: "Live Room",
          item: {
            itemId: "live-22889518",
            title: "Live Room",
            kind: "live",
            roomId: "22889518",
          },
          policy: {
            proxy: true,
            shared: true,
          },
          candidates: [
            {
              id: "hls-live",
              sourceType: "m3u8",
              url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
              qualityLabel: "超清",
              default: true,
            },
          ],
          defaultCandidateId: "hls-live",
        },
      },
      playback: null,
      members: [],
    },
  });

  assert.deepEqual(nextState.playbackSource, {
    url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
    sourceType: "m3u8",
    engine: "shaka",
    isLive: true,
    candidateId: "hls-live",
  });
});

test("uses the selected live provider candidate as the playback source identity", () => {
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
        videoId: "22889518",
        url: "https://live.bilibili.com/22889518",
        title: "Live Room",
        provider: {
          providerId: "bilibili",
          sourceId: "22889518",
          sourceUrl: "https://live.bilibili.com/22889518",
          title: "Live Room",
          item: {
            itemId: "live-22889518",
            title: "Live Room",
            kind: "live",
            roomId: "22889518",
          },
          policy: {
            proxy: true,
            shared: true,
          },
          candidates: [
            {
              id: "hls-live-1080p",
              sourceType: "m3u8",
              url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
              qualityLabel: "1080P",
              default: false,
            },
            {
              id: "hls-live-720p",
              sourceType: "m3u8",
              url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
              qualityLabel: "720P",
              default: true,
            },
          ],
          defaultCandidateId: "hls-live-720p",
        },
      },
      playback: null,
      members: [],
    },
  });

  assert.equal(nextState.playbackSource?.candidateId, "hls-live-720p");
});

test("uses provider video titles for refreshed shared Bilibili room state", () => {
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
        title: "anthropic_成片_白板版",
        provider: {
          providerId: "bilibili",
          title: "Anthropic史：从OpenAI叛逃者，到估值万亿的AI帝国",
          item: {
            itemId: "BV1xx411c7mD:cid-987654",
            title: "anthropic_成片_白板版",
            kind: "part",
          },
          policy: {
            proxy: true,
            shared: true,
          },
        },
      },
      playback: null,
      members: [],
    },
  });

  assert.equal(
    nextState.videoTitle,
    "Anthropic史：从OpenAI叛逃者，到估值万亿的AI帝国",
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

test("starts a chat cooldown after the current member message is accepted", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const nextState = applyServerMessage(
    state,
    {
      type: "chat:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-1",
        displayName: "Alice",
        content: "刚发送成功",
        timestamp: 1_725_000_000_000,
      },
    },
    { now: () => 10_000 },
  );

  assert.equal(nextState.chatMessages.length, 1);
  assert.equal(nextState.chatMessages[0]?.content, "刚发送成功");
  assert.equal(nextState.chatCooldownUntil, 15_000);
});

test("does not start a chat cooldown for other members messages", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const nextState = applyServerMessage(
    state,
    {
      type: "chat:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-2",
        displayName: "Bob",
        content: "收到",
        timestamp: 1_725_000_000_000,
      },
    },
    { now: () => 10_000 },
  );

  assert.equal(nextState.chatMessages.length, 1);
  assert.equal(nextState.chatCooldownUntil, undefined);
});

test("records non-chat server errors in diagnostics with code and message", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const nextState = applyServerMessage(state, {
    type: "error",
    payload: {
      code: "invalid_payload",
      message: "Invalid provider request.",
      messageType: "video:share",
    },
  });

  assert.match(nextState.diagnostics.at(-1) ?? "", /invalid_payload/);
  assert.match(nextState.diagnostics.at(-1) ?? "", /Invalid provider request/);
  assert.match(nextState.diagnostics.at(-1) ?? "", /video:share/);
});

test("applies sync pong samples as room clock metrics", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const firstState = applyServerMessage(
    state,
    {
      type: "sync:pong",
      payload: {
        clientSendTime: 1_000,
        serverReceiveTime: 1_120,
        serverSendTime: 1_130,
      },
    },
    { now: () => 1_250 },
  );

  assert.equal(firstState.rttMs, 240);
  assert.equal(firstState.clockOffsetMs, 0);
  assert.match(firstState.diagnostics.at(-1) ?? "", /sync:pong/);

  const secondState = applyServerMessage(
    firstState,
    {
      type: "sync:pong",
      payload: {
        clientSendTime: 2_000,
        serverReceiveTime: 2_170,
        serverSendTime: 2_170,
      },
    },
    { now: () => 2_260 },
  );

  assert.equal(secondState.rttMs, 246);
  assert.equal(secondState.clockOffsetMs, 12);
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

test("applies playback sync state from room:state", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const next = applyServerMessage(state, {
    type: "room:state",
    payload: {
      roomCode: "ABC123",
      sharedVideo: null,
      playback: null,
      playbackSync: {
        strategy: "wait",
        hold: {
          active: true,
          reasonMemberId: "member-2",
          startedAt: 1_000,
          deadlineAt: 11_000,
        },
        bufferingMemberIds: ["member-2"],
      },
      members: [{ id: "member-1", name: "Alice" }],
    },
  });

  assert.equal(next.playbackSync?.strategy, "wait");
  assert.equal(next.playbackSync?.hold.active, true);
  assert.equal(next.playbackSync?.hold.reasonMemberId, "member-2");
  assert.deepEqual(next.playbackSync?.bufferingMemberIds, ["member-2"]);
});

test("assigns unique render keys to rapid duplicate danmaku messages", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });
  const payload = {
    roomCode: "ABC123",
    memberId: "member-2",
    displayName: "Bob",
    content: "same",
    videoTime: 42.25,
    mode: "scroll",
    color: "#ffffff",
    timestamp: 1_725_000_000_000,
  };

  const first = applyServerMessage(state, {
    type: "danmaku:message",
    payload,
  });
  const second = applyServerMessage(first, {
    type: "danmaku:message",
    payload,
  });

  assert.equal(second.danmakuMessages.length, 2);
  assert.notEqual(
    second.danmakuMessages[0]?.renderKey,
    second.danmakuMessages[1]?.renderKey,
  );
});

test("starts a one-second danmaku cooldown after the current member message is accepted", () => {
  const state = createInitialJoinedState({
    roomCode: "ABC123",
    currentMemberId: "member-1",
    displayName: "Alice",
  });

  const nextState = applyServerMessage(
    state,
    {
      type: "danmaku:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-1",
        displayName: "Alice",
        content: "front row",
        videoTime: 42.25,
        mode: "scroll",
        color: "#ffffff",
        timestamp: 1_725_000_000_000,
      },
    },
    { now: () => 10_000 },
  );

  assert.equal(nextState.danmakuMessages.length, 1);
  assert.equal(nextState.danmakuCooldownUntil, 11_000);
});
