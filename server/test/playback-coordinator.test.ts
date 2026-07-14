import assert from "node:assert/strict";
import test from "node:test";
import type { PlaybackState, SharedVideo } from "@syncroom/protocol";
import {
  coordinatePlaybackCommand,
  coordinatePlaybackBufferReport,
  coordinatePlaybackHoldExpiry,
  coordinatePlaybackMemberJoin,
  coordinatePlaybackMemberDeparture,
  coordinatePlaybackSyncStrategyChange,
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
  assert.equal(held.hold.deadlineAt, 12_000);
  assert.deepEqual(held.bufferingMemberIds, ["member-guest"]);
});

test("wait mode starts a readiness barrier for every active member on play", () => {
  const room = createRoom({
    playback: createPlayback({ playState: "paused" }),
  });
  const nextPlayback = createPlayback({
    playState: "playing",
    actorId: "member-host",
    seq: 2,
    serverTime: 2_000,
  });

  const coordinated = coordinatePlaybackCommand({
    room,
    nextPlayback,
    activeMemberIds: ["member-host", "member-guest"],
    command: "play",
    currentTime: 2_000,
  });

  assert.equal(coordinated.playbackSync.hold.active, true);
  assert.deepEqual(coordinated.playbackSync.bufferingMemberIds, [
    "member-host",
    "member-guest",
  ]);
  assert.equal(
    coordinated.playbackSync.hold.playbackRevision,
    coordinated.playbackRevision,
  );
  assert.equal(coordinated.playback, nextPlayback);
});

test("wait readiness barrier ignores stale and shallow ready reports", () => {
  const nextPlayback = createPlayback({
    currentTime: 120,
    actorId: "member-host",
    seq: 2,
    serverTime: 2_000,
  });
  const barrier = coordinatePlaybackCommand({
    room: createRoom(),
    nextPlayback,
    activeMemberIds: ["member-host", "member-guest"],
    command: "seek",
    currentTime: 2_000,
  });
  const barrierRoom = createRoom({
    playback: barrier.playback,
    playbackSync: barrier.playbackSync,
  });

  const stale = coordinatePlaybackBufferReport({
    room: barrierRoom,
    memberId: "member-guest",
    report: {
      state: "ready",
      currentTime: 120,
      bufferAheadSeconds: 8,
      playbackRevision: "stale-revision",
    },
    currentTime: 3_000,
  });
  assert.deepEqual(stale.playbackSync.bufferingMemberIds, [
    "member-host",
    "member-guest",
  ]);

  const shallow = coordinatePlaybackBufferReport({
    room: barrierRoom,
    memberId: "member-guest",
    report: {
      state: "ready",
      currentTime: 120,
      bufferAheadSeconds: 4,
      playbackRevision: barrier.playbackRevision,
    },
    currentTime: 4_000,
  });
  assert.deepEqual(shallow.playbackSync.bufferingMemberIds, [
    "member-host",
    "member-guest",
  ]);

  const ready = coordinatePlaybackBufferReport({
    room: barrierRoom,
    memberId: "member-guest",
    report: {
      state: "ready",
      currentTime: 120,
      bufferAheadSeconds: 6,
      playbackRevision: barrier.playbackRevision,
    },
    currentTime: 5_000,
  });
  assert.deepEqual(ready.playbackSync.bufferingMemberIds, ["member-host"]);
  assert.equal(ready.playbackSync.hold.active, true);
});

test("new member joining a playing wait room holds only for that member", () => {
  const joined = coordinatePlaybackMemberJoin({
    room: createRoom(),
    memberId: "member-new",
    currentTime: 3_000,
  });

  assert.equal(joined.playbackSync.hold.active, true);
  assert.deepEqual(joined.playbackSync.bufferingMemberIds, ["member-new"]);
  assert.equal(joined.playback?.currentTime, 42);
  assert.equal(joined.playback?.serverTime, 3_000);
});

test("explicit pause clears an active readiness barrier", () => {
  const room = createRoom({
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 2_000,
        playbackRevision: "revision-1",
      },
      bufferingMemberIds: ["member-guest"],
    },
  });
  const paused = coordinatePlaybackCommand({
    room,
    nextPlayback: createPlayback({ playState: "paused", seq: 2 }),
    activeMemberIds: ["member-host", "member-guest"],
    command: "pause",
    currentTime: 3_000,
  });

  assert.equal(paused.playbackSync.hold.active, false);
  assert.deepEqual(paused.playbackSync.bufferingMemberIds, []);
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

test("coordinator ignores waiting reports that already have enough buffered media", () => {
  const playbackSync = updatePlaybackSyncForBufferReport({
    room: createRoom(),
    memberId: "member-guest",
    report: {
      state: "buffering",
      currentTime: 40,
      bufferAheadSeconds: 8,
    },
    currentTime: 2_000,
  });

  assert.equal(playbackSync.hold.active, false);
  assert.deepEqual(playbackSync.bufferingMemberIds, []);
});

test("coordinator releases an active hold when waiting already has enough buffered media", () => {
  const heldRoom = createRoom({
    playback: createPlayback({ currentTime: 42, serverTime: 3_000 }),
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 3_000,
      },
      bufferingMemberIds: ["member-guest"],
    },
  });

  const released = coordinatePlaybackBufferReport({
    room: heldRoom,
    memberId: "member-guest",
    report: {
      state: "buffering",
      currentTime: 42,
      bufferAheadSeconds: 8,
    },
    currentTime: 5_000,
  });

  assert.equal(released.playbackSync.hold.active, false);
  assert.deepEqual(released.playbackSync.bufferingMemberIds, []);
  assert.equal(released.playback?.currentTime, 42);
  assert.equal(released.playback?.serverTime, 5_000);
});

test("coordinator freezes and rebases the playback timeline across a wait hold", () => {
  const room = createRoom({
    playback: createPlayback({
      currentTime: 40,
      serverTime: 1_000,
      playState: "playing",
    }),
  });
  const held = coordinatePlaybackBufferReport({
    room,
    memberId: "member-guest",
    report: {
      state: "buffering",
      currentTime: 41,
      bufferAheadSeconds: 0,
    },
    currentTime: 3_000,
  });

  assert.equal(held.playbackSync.hold.active, true);
  assert.equal(held.playback?.currentTime, 42);
  assert.equal(held.playback?.serverTime, 3_000);

  const released = coordinatePlaybackBufferReport({
    room: {
      ...room,
      playback: held.playback,
      playbackSync: held.playbackSync,
    },
    memberId: "member-guest",
    report: {
      state: "ready",
      currentTime: 41,
      bufferAheadSeconds: 6,
    },
    currentTime: 8_000,
  });

  assert.equal(released.playbackSync.hold.active, false);
  assert.equal(released.playback?.currentTime, 42);
  assert.equal(released.playback?.serverTime, 8_000);
});

test("coordinator expires a wait hold without a follow-up buffer report", () => {
  const room = createRoom({
    playback: createPlayback({ currentTime: 42, serverTime: 3_000 }),
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 3_000,
        deadlineAt: 13_000,
      },
      bufferingMemberIds: ["member-guest"],
    },
  });

  const expired = coordinatePlaybackHoldExpiry({
    room,
    expectedDeadline: 13_000,
    currentTime: 13_000,
  });

  assert.equal(expired.expired, true);
  assert.equal(expired.playbackSync.hold.active, false);
  assert.deepEqual(expired.playbackSync.bufferingMemberIds, []);
  assert.equal(expired.playback?.currentTime, 42);
  assert.equal(expired.playback?.serverTime, 13_000);
});

test("an old hold deadline cannot release a newer playback barrier", () => {
  const room = createRoom({
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 4_000,
        deadlineAt: 34_000,
        playbackRevision: "new-revision",
      },
      bufferingMemberIds: ["member-guest"],
    },
  });

  const staleTimer = coordinatePlaybackHoldExpiry({
    room,
    expectedDeadline: 13_000,
    currentTime: 40_000,
  });

  assert.equal(staleTimer.expired, false);
  assert.equal(staleTimer.playbackSync.hold.active, true);
  assert.equal(staleTimer.playbackSync.hold.playbackRevision, "new-revision");
});

test("coordinator releases a hold when the last buffering member leaves", () => {
  const room = createRoom({
    playback: createPlayback({
      currentTime: 42,
      serverTime: 3_000,
      playState: "playing",
    }),
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 3_000,
      },
      bufferingMemberIds: ["member-guest"],
    },
  });

  const released = coordinatePlaybackMemberDeparture({
    room,
    memberId: "member-guest",
    currentTime: 8_000,
  });

  assert.equal(released.playbackSync.hold.active, false);
  assert.deepEqual(released.playbackSync.bufferingMemberIds, []);
  assert.equal(released.playback?.currentTime, 42);
  assert.equal(released.playback?.serverTime, 8_000);
});

test("coordinator rebases a held timeline when switching to smooth mode", () => {
  const room = createRoom({
    playback: createPlayback({
      currentTime: 42,
      serverTime: 3_000,
      playState: "playing",
    }),
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 3_000,
      },
      bufferingMemberIds: ["member-guest"],
    },
  });

  const released = coordinatePlaybackSyncStrategyChange({
    room,
    strategy: "smooth",
    currentTime: 8_000,
  });

  assert.equal(released.playbackSync.strategy, "smooth");
  assert.equal(released.playbackSync.hold.active, false);
  assert.equal(released.playback?.currentTime, 42);
  assert.equal(released.playback?.serverTime, 8_000);
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

test("coordinator stops suppressing playback updates after a hold deadline", () => {
  const room = createRoom({
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
      nextPlayback: createPlayback({ playState: "paused", seq: 2 }),
      currentTime: 12_000,
    }),
    false,
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
