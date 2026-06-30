import assert from "node:assert/strict";
import test from "node:test";
import type { PlaybackState, SharedVideo } from "@syncroom/protocol";
import {
  preservePlayingIntentForSeek,
  shouldIgnorePlaybackUpdateDuringHold,
  updatePlaybackSyncForBufferReport,
} from "../src/playback-coordinator.js";
import {
  createDefaultPlaybackSyncState,
  type StoredRoom,
} from "../src/room-store.js";

function createPlayback(overrides: Partial<PlaybackState> = {}): PlaybackState {
  return {
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    currentTime: 40,
    playState: "playing",
    playbackRate: 1,
    updatedAt: 1_000,
    serverTime: 1_000,
    actorId: "member-host",
    seq: 1,
    ...overrides,
  };
}

function createRoom(overrides: Partial<StoredRoom> = {}): StoredRoom {
  return {
    code: "ROOM01",
    joinToken: "join-token",
    ownerMemberId: "member-host",
    members: [],
    sharedVideo: {
      videoId: "BV1xx411c7mD",
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      title: "Video",
    },
    playback: createPlayback(),
    playbackSync: createDefaultPlaybackSyncState("wait"),
    createdAt: 1_000,
    lastActiveAt: 1_000,
    expiresAt: null,
    version: 1,
    ...overrides,
  };
}

function createLiveSharedVideo(): SharedVideo {
  return {
    videoId: "huya-live-691406",
    url: "https://www.huya.com/691406",
    title: "Live",
    provider: {
      providerId: "huya",
      sourceId: "691406",
      sourceUrl: "https://www.huya.com/691406",
      title: "Live",
      item: {
        itemId: "live:691406",
        title: "Live",
        kind: "live",
        roomId: "691406",
      },
      policy: { proxy: false, shared: false },
      candidates: [],
    },
  };
}

test("coordinator keeps explicit seek as playing intent while wait mode buffers", () => {
  const room = createRoom({
    playback: createPlayback({
      currentTime: 40,
      playState: "playing",
      actorId: "member-host",
    }),
  });
  const seek = preservePlayingIntentForSeek({
    room,
    nextPlayback: createPlayback({
      currentTime: 120,
      playState: "paused",
      syncIntent: "explicit-seek",
      actorId: "member-guest",
      seq: 2,
    }),
  });

  assert.equal(seek.currentTime, 120);
  assert.equal(seek.playState, "playing");

  const held = updatePlaybackSyncForBufferReport({
    room: { ...room, playback: seek },
    memberId: "member-guest",
    report: {
      state: "buffering",
      currentTime: 120,
      bufferAheadSeconds: 0,
    },
    currentTime: 2_000,
  });

  assert.equal(held.hold.active, true);
  assert.deepEqual(held.bufferingMemberIds, ["member-guest"]);
});

test("coordinator releases wait hold only after enough ready buffer", () => {
  const heldRoom = createRoom({
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 2_000,
        deadlineAt: 12_000,
      },
      bufferingMemberIds: ["member-guest"],
    },
  });

  const shallowReady = updatePlaybackSyncForBufferReport({
    room: heldRoom,
    memberId: "member-guest",
    report: {
      state: "ready",
      currentTime: 120,
      bufferAheadSeconds: 1,
    },
    currentTime: 3_000,
  });

  assert.equal(shallowReady.hold.active, true);
  assert.deepEqual(shallowReady.bufferingMemberIds, ["member-guest"]);

  const enoughReady = updatePlaybackSyncForBufferReport({
    room: { ...heldRoom, playbackSync: shallowReady },
    memberId: "member-guest",
    report: {
      state: "ready",
      currentTime: 120,
      bufferAheadSeconds: 6,
    },
    currentTime: 4_000,
  });

  assert.equal(enoughReady.hold.active, false);
  assert.deepEqual(enoughReady.bufferingMemberIds, []);
});

test("coordinator ignores non-explicit hold pauses without mutating playback intent", () => {
  const room = createRoom({
    playback: createPlayback({
      currentTime: 120,
      playState: "playing",
      actorId: "member-seeker",
    }),
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 2_000,
        deadlineAt: 12_000,
      },
      bufferingMemberIds: ["member-guest"],
    },
  });

  assert.equal(
    shouldIgnorePlaybackUpdateDuringHold({
      room,
      nextPlayback: createPlayback({
        currentTime: 120,
        playState: "paused",
        actorId: "member-guest",
        seq: 2,
      }),
      currentTime: 3_000,
    }),
    true,
  );
});

test("coordinator does not hold live playback on buffer reports", () => {
  const playbackSync = updatePlaybackSyncForBufferReport({
    room: createRoom({
      sharedVideo: createLiveSharedVideo(),
      playback: createPlayback({ playState: "playing" }),
      playbackSync: createDefaultPlaybackSyncState("wait"),
    }),
    memberId: "member-guest",
    report: {
      state: "buffering",
      currentTime: 0,
      bufferAheadSeconds: 0,
    },
    currentTime: 2_000,
  });

  assert.equal(playbackSync.hold.active, false);
  assert.deepEqual(playbackSync.bufferingMemberIds, ["member-guest"]);
});
