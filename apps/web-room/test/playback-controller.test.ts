import assert from "node:assert/strict";
import test from "node:test";
import {
  createPlaybackElementController,
  createWebRoomPlaybackController,
} from "../src/playback-controller.js";
import type { WebRoomState } from "../src/render.js";
import { createInitialWebRoomVoiceState } from "../src/voice-state.js";

class FakeVideoElement {
  src = "";
  readonly removedAttributes: string[] = [];
  loadCount = 0;

  removeAttribute(name: string): void {
    this.removedAttributes.push(name);
    if (name === "src") {
      this.src = "";
    }
  }

  load(): void {
    this.loadCount += 1;
  }
}

class FakeEventedVideoElement extends FakeVideoElement {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }

  async play(): Promise<void> {
    this.paused = false;
  }

  pause(): void {
    this.paused = true;
  }
}

function createPlaybackRoot(video: FakeEventedVideoElement): ParentNode {
  return {
    querySelector(selector: string) {
      return selector === '[data-playback-video="true"]' ? video : null;
    },
  } as ParentNode;
}

async function waitForCondition(
  condition: () => boolean,
  message: string,
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(message);
}

function createJoinedPlaybackState(
  sourceUrl: string,
): Extract<WebRoomState, { view: "joined" }> {
  return {
    view: "joined",
    connectionState: "connected",
    roomCode: "ABC123",
    currentMemberId: "member-host",
    hostMemberId: "member-host",
    displayName: "Alice",
    authStatus: "authorized",
    voice: createInitialWebRoomVoiceState(),
    playbackUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    playbackSource: {
      url: sourceUrl,
      sourceType: "mpd",
      engine: "shaka",
    },
    members: [{ id: "member-host", name: "Alice" }],
    chatMessages: [],
    danmakuMessages: [],
    diagnostics: [],
  };
}

test("loads DASH and HLS sources through Shaka Player", async () => {
  const loadedUrls: string[] = [];
  const attachedVideos: FakeVideoElement[] = [];
  const destroyedPlayers: number[] = [];
  class FakeShakaPlayer {
    async attach(video: FakeVideoElement): Promise<void> {
      attachedVideos.push(video);
    }

    async load(url: string): Promise<void> {
      loadedUrls.push(url);
    }

    async destroy(): Promise<void> {
      destroyedPlayers.push(1);
    }
  }
  const controller = createPlaybackElementController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });
  const video = new FakeVideoElement();

  await controller.load(video, {
    url: "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
    sourceType: "mpd",
    engine: "shaka",
  });

  assert.deepEqual(attachedVideos, [video]);
  assert.deepEqual(loadedUrls, [
    "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
  ]);
  assert.deepEqual(video.removedAttributes, ["src"]);
  assert.equal(video.src, "");
  assert.equal(video.loadCount, 0);

  await controller.dispose();
  assert.deepEqual(destroyedPlayers, [1]);
});

test("deduplicates concurrent Shaka loads for the same video source", async () => {
  const loadedUrls: string[] = [];
  let resolveLoad: (() => void) | undefined;
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    load(url: string): Promise<void> {
      loadedUrls.push(url);
      return new Promise((resolve) => {
        resolveLoad = resolve;
      });
    }
  }
  const controller = createPlaybackElementController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });
  const video = new FakeVideoElement();
  const source = {
    url: "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
    sourceType: "mpd" as const,
    engine: "shaka" as const,
  };

  const firstLoad = controller.load(video, source);
  await waitForCondition(
    () => loadedUrls.length === 1,
    "first Shaka load did not start",
  );
  const secondLoad = controller.load(video, source);
  await Promise.resolve();

  assert.deepEqual(loadedUrls, [source.url]);
  resolveLoad?.();
  assert.equal(await firstLoad, true);
  assert.equal(await secondLoad, false);
});

test("ignores stale Shaka load errors after a newer sync starts", async () => {
  type Deferred = {
    resolve: () => void;
    reject: (error: Error) => void;
  };
  const pendingLoads = new Map<string, Deferred>();
  const playbackErrors: unknown[] = [];
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    load(url: string): Promise<void> {
      return new Promise((resolve, reject) => {
        pendingLoads.set(url, { resolve, reject });
      });
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    onPlaybackError: (error) => playbackErrors.push(error),
  });
  const video = new FakeEventedVideoElement();

  const firstSync = controller.sync(
    createPlaybackRoot(video),
    createJoinedPlaybackState("https://syncroom.example.test/manifest-a.mpd"),
  );
  await waitForCondition(
    () => pendingLoads.has("https://syncroom.example.test/manifest-a.mpd"),
    "first Shaka load did not start",
  );
  const secondSync = controller.sync(
    createPlaybackRoot(video),
    createJoinedPlaybackState("https://syncroom.example.test/manifest-b.mpd"),
  );
  await waitForCondition(
    () => pendingLoads.has("https://syncroom.example.test/manifest-b.mpd"),
    "second Shaka load did not start",
  );

  pendingLoads
    .get("https://syncroom.example.test/manifest-a.mpd")
    ?.reject(new Error("Shaka Error NETWORK.OPERATION_ABORTED"));
  await firstSync;
  assert.deepEqual(playbackErrors, []);

  pendingLoads.get("https://syncroom.example.test/manifest-b.mpd")?.resolve();
  await secondSync;
  assert.deepEqual(playbackErrors, []);
});

test("loads MP4 sources with the native video element", async () => {
  const controller = createPlaybackElementController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for native MP4 playback");
    },
  });
  const video = new FakeVideoElement();

  await controller.load(video, {
    url: "https://syncroom.example.test/video.mp4",
    sourceType: "mp4",
    engine: "native",
  });

  assert.equal(video.src, "https://syncroom.example.test/video.mp4");
  assert.equal(video.loadCount, 1);
});

test("syncs web-room playback events with the original shared video URL", async () => {
  const video = new FakeEventedVideoElement();
  const dispatched: unknown[] = [];
  let seq = 0;
  let now = 5_000;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for native MP4 playback");
    },
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-host",
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
    }),
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    dispatchPlaybackUpdate: (message) => dispatched.push(message),
    now: () => now,
  });

  await controller.sync(createPlaybackRoot(video), {
    view: "joined",
    connectionState: "connected",
    roomCode: "ABC123",
    currentMemberId: "member-host",
    hostMemberId: "member-host",
    displayName: "Alice",
    authStatus: "authorized",
    voice: createInitialWebRoomVoiceState(),
    playbackUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    playbackSource: {
      url: "https://syncroom.example.test/proxy/segment/segment-1",
      sourceType: "mp4",
      engine: "native",
    },
    playback: {
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      currentTime: 18,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-guest",
      seq: 2,
    },
    members: [{ id: "member-host", name: "Alice" }],
    chatMessages: [],
    danmakuMessages: [],
    diagnostics: [],
  });

  assert.equal(video.currentTime, 18);
  now = 5_600;
  video.currentTime = 21;
  video.paused = false;
  video.emit("seeked");

  assert.deepEqual(dispatched, [
    {
      type: "playback:update",
      payload: {
        memberToken: "valid-member-token-123",
        playback: {
          url: "https://www.bilibili.com/video/BV1xx411c7mD",
          currentTime: 21,
          playState: "playing",
          syncIntent: "explicit-seek",
          userInitiated: true,
          playbackRate: 1,
          updatedAt: 5_600,
          serverTime: 5_600,
          actorId: "member-host",
          seq: 1,
        },
      },
    },
  ]);
});

test("applies persisted self playback after a refreshed media element loads", async () => {
  const video = new FakeEventedVideoElement();
  let now = 8_000;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for native MP4 playback");
    },
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-host",
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
    }),
    nextSeq: () => 1,
    dispatchPlaybackUpdate: () => undefined,
    now: () => now,
  });

  const state = {
    view: "joined" as const,
    connectionState: "connected" as const,
    roomCode: "ABC123",
    currentMemberId: "member-host",
    hostMemberId: "member-host",
    displayName: "Alice",
    authStatus: "authorized" as const,
    voice: createInitialWebRoomVoiceState(),
    playbackUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    playbackSource: {
      url: "https://syncroom.example.test/proxy/segment/segment-1",
      sourceType: "mp4" as const,
      engine: "native" as const,
    },
    playback: {
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      currentTime: 42,
      playState: "playing" as const,
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 9,
    },
    members: [{ id: "member-host", name: "Alice" }],
    chatMessages: [],
    danmakuMessages: [],
    diagnostics: [],
  };

  await controller.sync(createPlaybackRoot(video), state);

  assert.equal(video.currentTime, 45);
  assert.equal(video.paused, false);

  video.currentTime = 0;
  now = 8_100;
  await controller.sync(createPlaybackRoot(video), state);

  assert.equal(video.currentTime, 0);
});

test("hydrates persisted self playback when a refreshed controller sees an already loaded source", async () => {
  const video = new FakeEventedVideoElement();
  let now = 8_000;
  const playbackSource = {
    url: "https://syncroom.example.test/video.mp4",
    sourceType: "mp4" as const,
    engine: "native" as const,
  };
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for native MP4 playback");
    },
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-host",
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
    }),
    nextSeq: () => 1,
    dispatchPlaybackUpdate: () => undefined,
    now: () => now,
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
  });

  video.currentTime = 0;
  video.paused = true;
  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
    playback: {
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      currentTime: 42,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 9,
    },
  });

  assert.equal(video.currentTime, 45);
  assert.equal(video.paused, false);

  video.currentTime = 0;
  now = 8_100;
  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
    playback: {
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      currentTime: 42,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 9,
    },
  });

  assert.equal(video.currentTime, 0);
});
