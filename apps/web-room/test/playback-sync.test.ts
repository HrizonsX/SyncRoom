import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRemotePlaybackState,
  bindPlaybackSyncControls,
  createPlaybackUpdateMessage,
  type MediaElementLike,
} from "../src/playback-sync.js";

function createMedia(
  overrides: Partial<MediaElementLike> = {},
): MediaElementLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    currentTime: 12,
    playbackRate: 1,
    paused: false,
    play() {
      calls.push("play");
    },
    pause() {
      calls.push("pause");
    },
    calls,
    ...overrides,
  } as MediaElementLike & { calls: string[] };
}

test("creates playback:update messages from local player events", () => {
  const media = createMedia({
    currentTime: 42.5,
    playbackRate: 1.25,
    paused: false,
  });

  assert.deepEqual(
    createPlaybackUpdateMessage({
      memberToken: "valid-member-token-123",
      actorId: "member-1",
      url: "https://syncroom.example.test/video.mpd",
      media,
      event: "seeked",
      seq: 7,
      now: () => 1_000,
    }),
    {
      type: "playback:update",
      payload: {
        memberToken: "valid-member-token-123",
        playback: {
          url: "https://syncroom.example.test/video.mpd",
          currentTime: 42.5,
          playState: "playing",
          syncIntent: "explicit-seek",
          userInitiated: true,
          playbackRate: 1.25,
          updatedAt: 1_000,
          serverTime: 1_000,
          actorId: "member-1",
          seq: 7,
        },
      },
    },
  );
});

test("normalizes non-positive local playback rate before broadcasting", () => {
  const media = createMedia({
    currentTime: 42.5,
    playbackRate: 0,
    paused: false,
  });

  assert.equal(
    createPlaybackUpdateMessage({
      memberToken: "valid-member-token-123",
      actorId: "member-1",
      url: "https://syncroom.example.test/video.mpd",
      media,
      event: "play",
      seq: 7,
      now: () => 1_000,
    }).payload.playback.playbackRate,
    1,
  );
});

test("binds player events to playback update dispatch", () => {
  const listeners = new Map<string, Set<() => void>>();
  const media = {
    ...createMedia({ paused: false }),
    addEventListener(type: string, listener: () => void) {
      const items = listeners.get(type) ?? new Set<() => void>();
      items.add(listener);
      listeners.set(type, items);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const dispatched: unknown[] = [];
  let seq = 0;
  const binding = bindPlaybackSyncControls({
    media,
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-1",
      url: "https://syncroom.example.test/video.mpd",
    }),
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    now: () => 2_000,
    dispatch(message) {
      dispatched.push(message);
    },
  });

  listeners.get("play")?.forEach((listener) => listener());
  binding.dispose();
  listeners.get("pause")?.forEach((listener) => listener());

  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0], {
    type: "playback:update",
    payload: {
      memberToken: "valid-member-token-123",
      playback: {
        url: "https://syncroom.example.test/video.mpd",
        currentTime: 12,
        playState: "playing",
        userInitiated: true,
        playbackRate: 1,
        updatedAt: 2_000,
        serverTime: 2_000,
        actorId: "member-1",
        seq: 1,
      },
    },
  });
});

test("dispatches explicit seek on seeking when seeked is not bound", () => {
  const listeners = new Map<string, Set<() => void>>();
  const media = {
    ...createMedia({ currentTime: 64, paused: false }),
    addEventListener(type: string, listener: () => void) {
      const items = listeners.get(type) ?? new Set<() => void>();
      items.add(listener);
      listeners.set(type, items);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const dispatched: unknown[] = [];
  const binding = bindPlaybackSyncControls({
    media,
    events: ["seeking"],
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-1",
      url: "https://syncroom.example.test/video.mpd",
    }),
    nextSeq: () => 7,
    now: () => 3_000,
    dispatch(message) {
      dispatched.push(message);
    },
  });

  listeners.get("seeking")?.forEach((listener) => listener());
  binding.dispose();

  assert.deepEqual(dispatched, [
    {
      type: "playback:update",
      payload: {
        memberToken: "valid-member-token-123",
        playback: {
          url: "https://syncroom.example.test/video.mpd",
          currentTime: 64,
          playState: "playing",
          syncIntent: "explicit-seek",
          userInitiated: true,
          playbackRate: 1,
          updatedAt: 3_000,
          serverTime: 3_000,
          actorId: "member-1",
          seq: 7,
        },
      },
    },
  ]);
});

test("dispatches final seeked position instead of intermediate drag position", () => {
  const listeners = new Map<string, Set<() => void>>();
  const media = {
    ...createMedia({ currentTime: 24, paused: false }),
    addEventListener(type: string, listener: () => void) {
      const items = listeners.get(type) ?? new Set<() => void>();
      items.add(listener);
      listeners.set(type, items);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const dispatched: unknown[] = [];
  let seq = 0;
  const binding = bindPlaybackSyncControls({
    media,
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-1",
      url: "https://syncroom.example.test/video.mpd",
    }),
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    now: () => 4_000,
    dispatch(message) {
      dispatched.push(message);
    },
  });

  media.currentTime = 36;
  listeners.get("seeking")?.forEach((listener) => listener());
  media.currentTime = 72;
  listeners.get("seeked")?.forEach((listener) => listener());
  binding.dispose();

  assert.deepEqual(dispatched, [
    {
      type: "playback:update",
      payload: {
        memberToken: "valid-member-token-123",
        playback: {
          url: "https://syncroom.example.test/video.mpd",
          currentTime: 72,
          playState: "playing",
          syncIntent: "explicit-seek",
          userInitiated: true,
          playbackRate: 1,
          updatedAt: 4_000,
          serverTime: 4_000,
          actorId: "member-1",
          seq: 1,
        },
      },
    },
  ]);
});

test("defers range-drag seek updates until pointer release", () => {
  const listeners = new Map<string, Set<() => void>>();
  const rangeListeners = new Map<string, Set<() => void>>();
  const media = {
    ...createMedia({ currentTime: 24, paused: false }),
    addEventListener(type: string, listener: () => void) {
      const items = listeners.get(type) ?? new Set<() => void>();
      items.add(listener);
      listeners.set(type, items);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const timeRangeControl = {
    addEventListener(type: string, listener: () => void) {
      const items = rangeListeners.get(type) ?? new Set<() => void>();
      items.add(listener);
      rangeListeners.set(type, items);
    },
    removeEventListener(type: string, listener: () => void) {
      rangeListeners.get(type)?.delete(listener);
    },
  };
  const dispatched: unknown[] = [];
  let now = 4_000;
  let seq = 0;
  const binding = bindPlaybackSyncControls({
    media,
    timeRangeControl,
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-1",
      url: "https://syncroom.example.test/video.mpd",
    }),
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    now: () => now,
    dispatch(message) {
      dispatched.push(message);
    },
  });

  rangeListeners.get("pointerdown")?.forEach((listener) => listener());
  media.currentTime = 36;
  rangeListeners.get("input")?.forEach((listener) => listener());
  listeners.get("seeked")?.forEach((listener) => listener());
  now = 7_000;
  media.currentTime = 96;
  rangeListeners.get("input")?.forEach((listener) => listener());
  listeners.get("seeked")?.forEach((listener) => listener());

  assert.deepEqual(dispatched, []);

  now = 8_000;
  rangeListeners.get("pointerup")?.forEach((listener) => listener());
  now = 8_050;
  listeners.get("seeked")?.forEach((listener) => listener());
  binding.dispose();

  assert.deepEqual(dispatched, [
    {
      type: "playback:update",
      payload: {
        memberToken: "valid-member-token-123",
        playback: {
          url: "https://syncroom.example.test/video.mpd",
          currentTime: 96,
          playState: "playing",
          syncIntent: "explicit-seek",
          userInitiated: true,
          playbackRate: 1,
          updatedAt: 8_000,
          serverTime: 8_000,
          actorId: "member-1",
          seq: 1,
        },
      },
    },
  ]);
});

test("defers local pause briefly so page teardown can suppress it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const listeners = new Map<string, Set<() => void>>();
  const media = {
    ...createMedia({ paused: true }),
    addEventListener(type: string, listener: () => void) {
      const items = listeners.get(type) ?? new Set<() => void>();
      items.add(listener);
      listeners.set(type, items);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const dispatched: unknown[] = [];
  let pageEnding = false;
  const binding = bindPlaybackSyncControls({
    media,
    getContext: () =>
      pageEnding
        ? null
        : {
            memberToken: "valid-member-token-123",
            actorId: "member-1",
            url: "https://syncroom.example.test/video.mpd",
          },
    nextSeq: () => 1,
    dispatch(message) {
      dispatched.push(message);
    },
  });

  listeners.get("pause")?.forEach((listener) => listener());
  pageEnding = true;
  t.mock.timers.tick(150);

  assert.deepEqual(dispatched, []);
  binding.dispose();
});

test("dispatches ordinary local pause after the lifecycle guard", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const listeners = new Map<string, Set<() => void>>();
  const media = {
    ...createMedia({ paused: true }),
    addEventListener(type: string, listener: () => void) {
      const items = listeners.get(type) ?? new Set<() => void>();
      items.add(listener);
      listeners.set(type, items);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const dispatched: unknown[] = [];
  const binding = bindPlaybackSyncControls({
    media,
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-1",
      url: "https://syncroom.example.test/video.mpd",
    }),
    nextSeq: () => 1,
    now: () => 2_000,
    dispatch(message) {
      dispatched.push(message);
    },
  });

  listeners.get("pause")?.forEach((listener) => listener());
  assert.deepEqual(dispatched, []);
  t.mock.timers.tick(150);

  assert.equal(dispatched.length, 1);
  assert.deepEqual(dispatched[0], {
    type: "playback:update",
    payload: {
      memberToken: "valid-member-token-123",
      playback: {
        url: "https://syncroom.example.test/video.mpd",
        currentTime: 12,
        playState: "paused",
        userInitiated: true,
        playbackRate: 1,
        updatedAt: 2_000,
        serverTime: 2_000,
        actorId: "member-1",
        seq: 1,
      },
    },
  });
  binding.dispose();
});

test("dispatches rapid play toggle clicks as explicit last-intent controls", () => {
  const listeners = new Map<string, Set<() => void>>();
  const toggleListeners = new Map<string, Set<() => void>>();
  const media = {
    ...createMedia({ paused: true }),
    addEventListener(type: string, listener: () => void) {
      const items = listeners.get(type) ?? new Set<() => void>();
      items.add(listener);
      listeners.set(type, items);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const playToggleControl = {
    addEventListener(type: string, listener: () => void) {
      const items = toggleListeners.get(type) ?? new Set<() => void>();
      items.add(listener);
      toggleListeners.set(type, items);
    },
    removeEventListener(type: string, listener: () => void) {
      toggleListeners.get(type)?.delete(listener);
    },
  };
  const dispatched: unknown[] = [];
  let seq = 0;
  const binding = bindPlaybackSyncControls({
    media,
    playToggleControl,
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-1",
      url: "https://syncroom.example.test/video.mpd",
    }),
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    now: () => 2_000,
    dispatch(message) {
      dispatched.push(message);
    },
  });

  toggleListeners.get("click")?.forEach((listener) => listener());
  toggleListeners.get("click")?.forEach((listener) => listener());

  assert.equal(dispatched.length, 2);
  assert.deepEqual(
    dispatched.map((message) => {
      const playback = (
        message as Extract<
          ReturnType<typeof createPlaybackUpdateMessage>,
          { type: "playback:update" }
        >
      ).payload.playback;
      return [playback.playState, playback.syncIntent, playback.seq];
    }),
    [
      ["playing", "explicit-play", 1],
      ["paused", "explicit-pause", 2],
    ],
  );
  binding.dispose();
});

test("does not broadcast transient waiting events by default", () => {
  const listeners = new Map<string, Set<() => void>>();
  const media = {
    ...createMedia({ paused: false }),
    addEventListener(type: string, listener: () => void) {
      const items = listeners.get(type) ?? new Set<() => void>();
      items.add(listener);
      listeners.set(type, items);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
  };
  const dispatched: unknown[] = [];
  const binding = bindPlaybackSyncControls({
    media,
    getContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-1",
      url: "https://syncroom.example.test/video.mpd",
    }),
    nextSeq: () => 1,
    dispatch(message) {
      dispatched.push(message);
    },
  });

  listeners.get("waiting")?.forEach((listener) => listener());
  binding.dispose();

  assert.deepEqual(dispatched, []);
});

test("applies remote playback by seeking, rate changing, and playing", async () => {
  const media = createMedia({
    currentTime: 10,
    playbackRate: 1,
    paused: true,
  });

  const result = await applyRemotePlaybackState({
    media,
    localMemberId: "member-1",
    currentUrl: "https://syncroom.example.test/video.mpd",
    now: () => 1,
    playback: {
      url: "https://syncroom.example.test/video.mpd",
      currentTime: 20,
      playState: "playing",
      playbackRate: 1.5,
      updatedAt: 1,
      serverTime: 1,
      actorId: "member-2",
      seq: 2,
    },
  });

  assert.deepEqual(result, {
    applied: true,
    actions: ["seek", "ratechange", "play"],
  });
  assert.equal(media.currentTime, 20);
  assert.equal(media.playbackRate, 1.5);
  assert.deepEqual(media.calls, ["play"]);
});

test("projects remote playing time from server time before seeking", async () => {
  const media = createMedia({
    currentTime: 10,
    playbackRate: 1,
    paused: false,
  });

  const result = await applyRemotePlaybackState({
    media,
    localMemberId: "member-1",
    currentUrl: "https://syncroom.example.test/video.mpd",
    now: () => 4_000,
    playback: {
      url: "https://syncroom.example.test/video.mpd",
      currentTime: 20,
      playState: "playing",
      playbackRate: 1.5,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-2",
      seq: 2,
    },
  });

  assert.deepEqual(result, {
    applied: true,
    actions: ["seek", "ratechange"],
  });
  assert.equal(media.currentTime, 24.5);
  assert.equal(media.playbackRate, 1.5);
});

test("treats non-positive remote playback rate as normal speed", async () => {
  const media = createMedia({
    currentTime: 23,
    playbackRate: 1,
    paused: false,
  });

  const result = await applyRemotePlaybackState({
    media,
    localMemberId: "member-1",
    currentUrl: "https://syncroom.example.test/live.m3u8",
    now: () => 4_000,
    playback: {
      url: "https://syncroom.example.test/live.m3u8",
      currentTime: 20,
      playState: "playing",
      playbackRate: 0,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-2",
      seq: 2,
    },
  });

  assert.deepEqual(result, {
    applied: true,
    actions: [],
  });
  assert.equal(media.currentTime, 23);
  assert.equal(media.playbackRate, 1);
});

test("applies remote pause and skips local echo or mismatched urls", async () => {
  const media = createMedia({ currentTime: 10, paused: false });

  assert.deepEqual(
    await applyRemotePlaybackState({
      media,
      localMemberId: "member-1",
      currentUrl: "https://syncroom.example.test/video.mpd",
      playback: {
        url: "https://syncroom.example.test/video.mpd",
        currentTime: 10.2,
        playState: "paused",
        playbackRate: 1,
        updatedAt: 1,
        serverTime: 1,
        actorId: "member-2",
        seq: 2,
      },
    }),
    { applied: true, actions: ["pause"] },
  );

  assert.deepEqual(media.calls, ["pause"]);
  assert.deepEqual(
    await applyRemotePlaybackState({
      media,
      localMemberId: "member-1",
      currentUrl: "https://syncroom.example.test/video.mpd",
      playback: {
        url: "https://syncroom.example.test/video.mpd",
        currentTime: 50,
        playState: "playing",
        playbackRate: 1,
        updatedAt: 1,
        serverTime: 1,
        actorId: "member-1",
        seq: 3,
      },
    }),
    { applied: false, actions: [], reason: "local_echo" },
  );
  media.paused = true;
  assert.deepEqual(
    await applyRemotePlaybackState({
      media,
      localMemberId: "member-1",
      currentUrl: "https://syncroom.example.test/video.mpd",
      allowLocalEcho: true,
      now: () => 1,
      playback: {
        url: "https://syncroom.example.test/video.mpd",
        currentTime: 50,
        playState: "playing",
        playbackRate: 1,
        updatedAt: 1,
        serverTime: 1,
        actorId: "member-1",
        seq: 4,
      },
    }),
    { applied: true, actions: ["seek", "play"] },
  );
  assert.deepEqual(
    await applyRemotePlaybackState({
      media,
      localMemberId: "member-1",
      currentUrl: "https://syncroom.example.test/other.mpd",
      playback: {
        url: "https://syncroom.example.test/video.mpd",
        currentTime: 50,
        playState: "playing",
        playbackRate: 1,
        updatedAt: 1,
        serverTime: 1,
        actorId: "member-2",
        seq: 5,
      },
    }),
    { applied: false, actions: [], reason: "url_mismatch" },
  );
});
