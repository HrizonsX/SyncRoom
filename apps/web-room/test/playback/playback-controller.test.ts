import assert from "node:assert/strict";
import test from "node:test";
import type { ClientMessage } from "@syncroom/protocol";
import {
  createPlaybackElementController,
  createWebRoomPlaybackController,
} from "../../src/playback/playback-controller.js";
import type { WebRoomState } from "../../src/ui/render.js";
import { createInitialWebRoomVoiceState } from "../../src/voice/voice-state.js";

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
  readyState = 1;
  buffered?: TimeRanges;
  error: { code?: number; message?: string } | null = null;
  webkitDisplayingFullscreen = false;
  webkitPresentationMode: "inline" | "fullscreen" | "picture-in-picture" =
    "inline";
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

function createBufferedRanges(
  ranges: Array<{ start: number; end: number }>,
): TimeRanges {
  return {
    length: ranges.length,
    start(index: number) {
      const range = ranges[index];
      if (!range) {
        throw new DOMException("IndexSizeError", "IndexSizeError");
      }
      return range.start;
    },
    end(index: number) {
      const range = ranges[index];
      if (!range) {
        throw new DOMException("IndexSizeError", "IndexSizeError");
      }
      return range.end;
    },
  };
}

class FailingOncePlayVideoElement extends FakeEventedVideoElement {
  playAttempts = 0;

  override async play(): Promise<void> {
    this.playAttempts += 1;
    if (this.playAttempts === 1) {
      throw new Error("play interrupted while media is buffering");
    }
    await super.play();
  }
}

class FakePlayToggleControl {
  disabled = false;
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  hasAttribute(name: string): boolean {
    return name === "disabled" && this.disabled;
  }
}

class FakeMediaRequestTarget {
  private readonly listeners = new Map<string, Set<(event?: Event) => void>>();

  addEventListener(type: string, listener: (event?: Event) => void): void {
    const listeners =
      this.listeners.get(type) ?? new Set<(event?: Event) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event?: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, event?: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakePageLifecycleTarget {
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
}

function createPlaybackRoot(video: FakeEventedVideoElement): ParentNode {
  return {
    querySelector(selector: string) {
      return selector === '[data-playback-video="true"]' ? video : null;
    },
  } as ParentNode;
}

function createPlaybackRootWithPlayToggle(
  video: FakeEventedVideoElement,
  playToggle: FakePlayToggleControl,
): ParentNode {
  return {
    querySelector(selector: string) {
      if (selector === '[data-playback-video="true"]') {
        return video;
      }
      if (selector === "media-play-button") {
        return playToggle;
      }
      return null;
    },
  } as ParentNode;
}

function createPlaybackRootWithMediaController(
  video: FakeEventedVideoElement,
  mediaController: FakeMediaRequestTarget,
  playToggle = new FakePlayToggleControl(),
): ParentNode {
  return {
    querySelector(selector: string) {
      if (selector === '[data-playback-video="true"]') {
        return video;
      }
      if (selector === "media-controller") {
        return mediaController;
      }
      if (selector === "media-play-button") {
        return playToggle;
      }
      return null;
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

test("configures Shaka live playback to stop fetching while paused", async () => {
  const configs: Array<Record<string, unknown>> = [];
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    configure(config: Record<string, unknown>): void {
      configs.push(config);
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createPlaybackElementController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });
  const video = new FakeVideoElement();

  await controller.load(video, {
    url: "https://syncroom.example.test/proxy/live/playlist.m3u8",
    sourceType: "m3u8",
    engine: "shaka",
    isLive: true,
  });

  assert.deepEqual(configs, [
    {
      manifest: {
        continueLoadingWhenPaused: false,
        defaultPresentationDelay: 6,
      },
      streaming: {
        bufferBehind: 10,
        bufferingGoal: 8,
        lowLatencyMode: false,
        rebufferingGoal: 3,
        stopFetchingOnPause: true,
      },
    },
  ]);
});

test("recreates Shaka Player when switching quality on the same video element", async () => {
  const loadedUrls: string[] = [];
  const destroyedPlayers: number[] = [];
  const constructedPlayers: number[] = [];
  class FakeShakaPlayer {
    constructor() {
      constructedPlayers.push(1);
    }

    async attach(): Promise<void> {
      return undefined;
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
    url: "https://syncroom.example.test/proxy/manifest/live-720p.m3u8",
    sourceType: "m3u8",
    engine: "shaka",
    isLive: true,
    candidateId: "hls-live-720p",
  });
  await controller.load(video, {
    url: "https://syncroom.example.test/proxy/manifest/live-1080p.m3u8",
    sourceType: "m3u8",
    engine: "shaka",
    isLive: true,
    candidateId: "hls-live-1080p",
  });

  assert.deepEqual(loadedUrls, [
    "https://syncroom.example.test/proxy/manifest/live-720p.m3u8",
    "https://syncroom.example.test/proxy/manifest/live-1080p.m3u8",
  ]);
  assert.equal(constructedPlayers.length, 2);
  assert.deepEqual(destroyedPlayers, [1]);
});

test("reloads live playback on the first play after pausing", async () => {
  const configs: Array<Record<string, unknown>> = [];
  const loadedUrls: string[] = [];
  let attachedVideo: FakeEventedVideoElement | undefined;
  let now = 10_000;
  class FakeShakaPlayer {
    async attach(video: FakeEventedVideoElement): Promise<void> {
      attachedVideo = video;
      return undefined;
    }

    configure(config: Record<string, unknown>): void {
      configs.push(config);
    }

    async load(url: string): Promise<void> {
      loadedUrls.push(url);
      if (loadedUrls.length > 1 && attachedVideo) {
        attachedVideo.paused = true;
      }
    }
  }
  class ResumeTrackingVideoElement extends FakeEventedVideoElement {
    playCalls = 0;

    async play(): Promise<void> {
      this.playCalls += 1;
      await super.play();
    }
  }
  const controller = createPlaybackElementController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    now: () => now,
  });
  const video = new ResumeTrackingVideoElement();
  const source = {
    url: "https://syncroom.example.test/proxy/live/playlist.m3u8",
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };

  await controller.load(video, source);
  video.paused = true;
  video.emit("pause");
  now += 2_000;
  video.paused = false;
  video.emit("play");
  await waitForCondition(
    () => loadedUrls.length === 2,
    "live playback did not reload on first play after pause",
  );

  assert.deepEqual(loadedUrls, [source.url, source.url]);
  assert.equal(video.paused, false);
  assert.equal(video.playCalls, 1);
  assert.deepEqual(configs.at(-1), {
    manifest: {
      continueLoadingWhenPaused: true,
      defaultPresentationDelay: 6,
    },
    streaming: {
      bufferBehind: 10,
      bufferingGoal: 8,
      lowLatencyMode: false,
      rebufferingGoal: 3,
      stopFetchingOnPause: true,
    },
  });
});

test("reports live reload failures after a long pause", async () => {
  const runtimeErrors: unknown[] = [];
  const loadedUrls: string[] = [];
  let now = 10_000;
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    configure(): void {
      return undefined;
    }

    async load(url: string): Promise<void> {
      loadedUrls.push(url);
      if (loadedUrls.length > 1) {
        throw new Error("HTTP 404 expired live manifest");
      }
    }
  }
  const controller = createPlaybackElementController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    now: () => now,
    onRuntimeError: (error) => runtimeErrors.push(error),
  });
  const video = new FakeEventedVideoElement();
  const source = {
    url: "https://syncroom.example.test/proxy/live/playlist.m3u8",
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };

  await controller.load(video, source);
  video.paused = true;
  video.emit("pause");
  now += 2_000;
  video.paused = false;
  video.emit("play");
  await waitForCondition(
    () => runtimeErrors.length === 1,
    "live reload failure was not reported",
  );

  assert.deepEqual(loadedUrls, [source.url, source.url]);
  assert.match(
    runtimeErrors[0] instanceof Error
      ? runtimeErrors[0].message
      : String(runtimeErrors[0]),
    /404 expired live manifest/,
  );
});

test("does not reload live playback for transient pause play events", async () => {
  const configs: Array<Record<string, unknown>> = [];
  const loadedUrls: string[] = [];
  let now = 10_000;
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    configure(config: Record<string, unknown>): void {
      configs.push(config);
    }

    async load(url: string): Promise<void> {
      loadedUrls.push(url);
    }
  }
  const controller = createPlaybackElementController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    now: () => now,
  });
  const video = new FakeEventedVideoElement();
  const source = {
    url: "https://syncroom.example.test/proxy/live/playlist.m3u8",
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };

  await controller.load(video, source);
  video.paused = true;
  video.emit("pause");
  now += 200;
  video.paused = false;
  video.emit("play");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(loadedUrls, [source.url]);
  assert.deepEqual(configs.at(-1), {
    manifest: {
      continueLoadingWhenPaused: true,
      defaultPresentationDelay: 6,
    },
    streaming: {
      bufferBehind: 10,
      bufferingGoal: 8,
      lowLatencyMode: false,
      rebufferingGoal: 3,
      stopFetchingOnPause: true,
    },
  });
});

test("restores Shaka paused fetching defaults for non-live playback", async () => {
  const configs: Array<Record<string, unknown>> = [];
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    configure(config: Record<string, unknown>): void {
      configs.push(config);
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createPlaybackElementController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });
  const video = new FakeVideoElement();

  await controller.load(video, {
    url: "https://syncroom.example.test/proxy/live/playlist.m3u8",
    sourceType: "m3u8",
    engine: "shaka",
    isLive: true,
  });
  await controller.load(video, {
    url: "https://syncroom.example.test/proxy/vod/manifest.mpd",
    sourceType: "mpd",
    engine: "shaka",
  });

  assert.deepEqual(configs.at(-1), {
    manifest: {
      continueLoadingWhenPaused: true,
    },
    streaming: {
      bufferBehind: 30,
      bufferingGoal: 8,
      rebufferingGoal: 3,
      stopFetchingOnPause: false,
    },
  });
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

test("reports Shaka runtime errors after a source has loaded", async () => {
  const playbackErrors: unknown[] = [];
  const players: FakeShakaPlayer[] = [];
  class FakeShakaPlayer {
    private readonly listeners = new Set<(event: unknown) => void>();

    constructor() {
      players.push(this);
    }

    async attach(): Promise<void> {
      return undefined;
    }

    addEventListener(type: "error", listener: (event: unknown) => void): void {
      if (type === "error") {
        this.listeners.add(listener);
      }
    }

    removeEventListener(
      type: "error",
      listener: (event: unknown) => void,
    ): void {
      if (type === "error") {
        this.listeners.delete(listener);
      }
    }

    async load(): Promise<void> {
      return undefined;
    }

    async destroy(): Promise<void> {
      this.listeners.clear();
    }

    emitRuntimeError(event: unknown): void {
      for (const listener of this.listeners) {
        listener(event);
      }
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    onPlaybackError: (error) => playbackErrors.push(error),
  });
  const video = new FakeEventedVideoElement();

  await controller.sync(
    createPlaybackRoot(video),
    createJoinedPlaybackState("https://syncroom.example.test/manifest-a.mpd"),
  );
  players[0]?.emitRuntimeError({
    detail: {
      category: "NETWORK",
      code: 404,
      data: ["segment-a.m4s"],
    },
  });

  assert.equal(playbackErrors.length, 1);
  assert.match(
    playbackErrors[0] instanceof Error
      ? playbackErrors[0].message
      : String(playbackErrors[0]),
    /404.*segment-a\.m4s/,
  );

  await controller.sync(
    createPlaybackRoot(video),
    createJoinedPlaybackState("https://syncroom.example.test/manifest-b.mpd"),
  );
  players[0]?.emitRuntimeError({ detail: "stale segment 404" });

  assert.equal(playbackErrors.length, 1);
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

test("reports native runtime errors after MP4 playback has loaded", async () => {
  const playbackErrors: unknown[] = [];
  const video = new FakeEventedVideoElement();
  video.readyState = 1;
  const playbackSource = {
    url: "https://cdn.example.test/video.mp4",
    sourceType: "mp4" as const,
    engine: "native" as const,
  };
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for native MP4 playback");
    },
    onPlaybackError: (error) => playbackErrors.push(error),
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
  });
  video.error = { code: 2, message: "HTTP 404 expired mp4 url" };
  video.emit("error");

  assert.equal(playbackErrors.length, 1);
  assert.match(
    playbackErrors[0] instanceof Error
      ? playbackErrors[0].message
      : String(playbackErrors[0]),
    /404 expired mp4 url/,
  );
});

test("loads FLV and TS live sources through mpegts.js", async () => {
  const createdSources: unknown[] = [];
  const createdConfigs: unknown[] = [];
  const lifecycleCalls: string[] = [];
  const attachedVideos: FakeVideoElement[] = [];
  const controller = createPlaybackElementController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for FLV playback");
    },
    loadMpegtsPlayer: async () => ({
      isSupported: () => true,
      createPlayer(source: unknown, config: unknown) {
        createdSources.push(source);
        createdConfigs.push(config);
        return {
          attachMediaElement(video: FakeVideoElement) {
            lifecycleCalls.push("attach");
            attachedVideos.push(video);
          },
          load() {
            lifecycleCalls.push("load");
          },
          unload() {
            lifecycleCalls.push("unload");
          },
          detachMediaElement() {
            lifecycleCalls.push("detach");
          },
          destroy() {
            lifecycleCalls.push("destroy");
          },
        };
      },
    }),
  });
  const video = new FakeVideoElement();

  await controller.load(video, {
    url: "https://syncroom.example.test/live.flv",
    sourceType: "flv",
    engine: "mpegts",
    isLive: true,
  });
  await controller.load(video, {
    url: "https://syncroom.example.test/live.ts",
    sourceType: "ts",
    engine: "mpegts",
    isLive: true,
  });
  await controller.dispose();

  assert.deepEqual(createdSources, [
    {
      type: "flv",
      url: "https://syncroom.example.test/live.flv",
      isLive: true,
    },
    {
      type: "mpegts",
      url: "https://syncroom.example.test/live.ts",
      isLive: true,
    },
  ]);
  assert.deepEqual(createdConfigs, [
    {
      enableStashBuffer: true,
      stashInitialSize: 1048576,
      lazyLoad: false,
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 10,
      autoCleanupMinBackwardDuration: 5,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 6,
      liveBufferLatencyMinRemain: 2,
    },
    {
      enableStashBuffer: true,
      stashInitialSize: 1048576,
      lazyLoad: false,
      autoCleanupSourceBuffer: true,
      autoCleanupMaxBackwardDuration: 10,
      autoCleanupMinBackwardDuration: 5,
      liveBufferLatencyChasing: true,
      liveBufferLatencyMaxLatency: 6,
      liveBufferLatencyMinRemain: 2,
    },
  ]);
  assert.deepEqual(lifecycleCalls, [
    "attach",
    "load",
    "unload",
    "detach",
    "destroy",
    "attach",
    "load",
    "unload",
    "detach",
    "destroy",
  ]);
  assert.deepEqual(attachedVideos, [video, video]);
  assert.equal(video.src, "");
  assert.deepEqual(video.removedAttributes, ["src", "src"]);
});

test("reports mpegts runtime errors after FLV playback has loaded", async () => {
  const playbackErrors: unknown[] = [];
  let createdPlayer:
    | {
        emitRuntimeError: (...args: unknown[]) => void;
      }
    | undefined;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for FLV playback");
    },
    loadMpegtsPlayer: async () => ({
      isSupported: () => true,
      createPlayer() {
        const listeners = new Set<(...args: unknown[]) => void>();
        const player = {
          attachMediaElement() {
            return undefined;
          },
          load() {
            return undefined;
          },
          on(event: "error", listener: (...args: unknown[]) => void) {
            if (event === "error") {
              listeners.add(listener);
            }
          },
          off(event: "error", listener: (...args: unknown[]) => void) {
            if (event === "error") {
              listeners.delete(listener);
            }
          },
          emitRuntimeError(...args: unknown[]) {
            for (const listener of listeners) {
              listener(...args);
            }
          },
        };
        createdPlayer = player;
        return player;
      },
    }),
    onPlaybackError: (error) => playbackErrors.push(error),
  });
  const video = new FakeEventedVideoElement();
  const playbackSource = {
    url: "https://cdn.example.test/live.flv",
    sourceType: "flv" as const,
    engine: "mpegts" as const,
    isLive: true,
  };

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
  });
  createdPlayer?.emitRuntimeError("NETWORK_ERROR", "HTTP_STATUS", {
    code: 404,
    url: "expired.flv",
  });

  assert.equal(playbackErrors.length, 1);
  assert.match(
    playbackErrors[0] instanceof Error
      ? playbackErrors[0].message
      : String(playbackErrors[0]),
    /404.*expired\.flv/,
  );
});

test("notifies when a new playback source finishes loading", async () => {
  const video = new FakeEventedVideoElement();
  const loadedSources: unknown[] = [];
  const playbackSource = {
    url: "https://syncroom.example.test/video.mp4",
    sourceType: "mp4" as const,
    engine: "native" as const,
  };
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for native MP4 playback");
    },
    onPlaybackLoaded: (source) => loadedSources.push(source),
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
  });
  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
  });

  assert.deepEqual(loadedSources, [playbackSource]);
});

test("waits for native MP4 metadata before applying refreshed playback", async () => {
  const video = new FakeEventedVideoElement();
  video.readyState = 0;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for native MP4 playback");
    },
  });
  const playbackSource = {
    url: "https://syncroom.example.test/video.mp4",
    sourceType: "mp4" as const,
    engine: "native" as const,
  };
  const syncPromise = controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
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
  });

  await waitForCondition(
    () => video.loadCount === 1,
    "native MP4 load did not start",
  );
  await Promise.resolve();
  assert.equal(video.currentTime, 0);

  video.readyState = 1;
  video.emit("loadedmetadata");
  await syncPromise;

  assert.equal(video.currentTime, 18);
});

test("keeps waiting for slow native MP4 metadata without reporting timeout", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const video = new FakeEventedVideoElement();
  video.readyState = 0;
  const playbackErrors: unknown[] = [];
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for native MP4 playback");
    },
    onPlaybackError: (error) => playbackErrors.push(error),
  });
  const playbackSource = {
    url: "https://syncroom.example.test/video.mp4",
    sourceType: "mp4" as const,
    engine: "native" as const,
  };
  const syncPromise = controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
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
  });

  await Promise.resolve();
  assert.equal(video.loadCount, 1);
  t.mock.timers.tick(8_000);
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(playbackErrors, []);
  assert.equal(video.currentTime, 0);

  video.readyState = 1;
  video.emit("loadedmetadata");
  await syncPromise;

  assert.equal(video.currentTime, 18);
});

test("reports native MP4 load errors during refreshed playback hydration", async () => {
  const video = new FakeEventedVideoElement();
  video.readyState = 0;
  video.error = { code: 4, message: "Unsupported source" };
  const playbackErrors: unknown[] = [];
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => {
      throw new Error("Shaka should not be loaded for native MP4 playback");
    },
    onPlaybackError: (error) => playbackErrors.push(error),
  });
  const playbackSource = {
    url: "https://syncroom.example.test/video.mp4",
    sourceType: "mp4" as const,
    engine: "native" as const,
  };
  const syncPromise = controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
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
  });

  await waitForCondition(
    () => video.loadCount === 1,
    "native MP4 load did not start",
  );
  await Promise.resolve();
  video.emit("error");
  await syncPromise;

  assert.equal(video.currentTime, 0);
  assert.equal(playbackErrors.length, 1);
  assert.match(
    playbackErrors[0] instanceof Error
      ? playbackErrors[0].message
      : String(playbackErrors[0]),
    /Native media failed to load.*Unsupported source/,
  );
});

test("syncs web-room playback events with the original shared video URL", async () => {
  const video = new FakeEventedVideoElement();
  const mediaController = new FakeMediaRequestTarget();
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

  await controller.sync(
    createPlaybackRootWithMediaController(video, mediaController),
    {
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
    },
  );

  assert.equal(video.currentTime, 18);
  now = 5_600;
  video.paused = false;
  mediaController.emit("mediaseekrequest", { detail: 33 } as unknown as Event);
  video.currentTime = 33;
  video.emit("seeked");

  assert.deepEqual(dispatched, [
    {
      type: "playback:update",
      payload: {
        memberToken: "valid-member-token-123",
        playback: {
          url: "https://www.bilibili.com/video/BV1xx411c7mD",
          currentTime: 33,
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

test("keeps delayed new-member hydration seek and rate echoes non-explicit", async () => {
  const video = new FakeEventedVideoElement();
  const dispatched: Array<Extract<ClientMessage, { type: "playback:update" }>> =
    [];
  let now = 5_000;
  let seq = 0;
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  const controller = createWebRoomPlaybackController({
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-joiner",
      url: sharedUrl,
    }),
    nextSeq: () => {
      seq += 1;
      return seq;
    },
    dispatchPlaybackUpdate: (message) => dispatched.push(message),
    now: () => now,
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(
      "https://syncroom.example.test/proxy/segment/movie.mp4",
    ),
    currentMemberId: "member-joiner",
    playbackUrl: sharedUrl,
    playbackSource: {
      url: "https://syncroom.example.test/proxy/segment/movie.mp4",
      sourceType: "mp4",
      engine: "native",
    },
    playback: {
      url: sharedUrl,
      currentTime: 120,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 8,
    },
  });

  now = 6_500;
  video.currentTime = 0;
  video.emit("ratechange");
  video.emit("seeked");

  assert.equal(dispatched.length, 2);
  for (const message of dispatched) {
    assert.equal(message.payload.playback.currentTime, 0);
    assert.equal(message.payload.playback.syncIntent, undefined);
    assert.equal(message.payload.playback.userInitiated, undefined);
  }
});

test("suppresses delayed remote seek echoes during Safari native fullscreen", async () => {
  const video = new FakeEventedVideoElement();
  video.webkitDisplayingFullscreen = true;
  video.webkitPresentationMode = "fullscreen";
  const dispatched: Array<Extract<ClientMessage, { type: "playback:update" }>> =
    [];
  let now = 5_000;
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  const controller = createWebRoomPlaybackController({
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-follower",
      url: sharedUrl,
    }),
    nextSeq: () => 1,
    dispatchPlaybackUpdate: (message) => dispatched.push(message),
    now: () => now,
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(
      "https://syncroom.example.test/proxy/segment/movie.mp4",
    ),
    currentMemberId: "member-follower",
    playbackUrl: sharedUrl,
    playbackSource: {
      url: "https://syncroom.example.test/proxy/segment/movie.mp4",
      sourceType: "mp4",
      engine: "native",
    },
    playback: {
      url: sharedUrl,
      currentTime: 120,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 8,
      syncIntent: "explicit-seek",
      userInitiated: true,
    },
  });

  assert.equal(video.currentTime, 120);
  now = 6_500;
  video.emit("seeked");
  assert.equal(dispatched.length, 0);

  video.currentTime = 150;
  video.emit("seeked");
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.payload.playback.syncIntent, "explicit-seek");
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

test("does not broadcast unload-time pause while the page is refreshing", async () => {
  const video = new FakeEventedVideoElement();
  const pageLifecycleTarget = new FakePageLifecycleTarget();
  const dispatched: unknown[] = [];
  let seq = 0;
  const playbackSource = {
    url: "https://syncroom.example.test/video.mp4",
    sourceType: "mp4" as const,
    engine: "native" as const,
  };
  const controller = createWebRoomPlaybackController({
    pageLifecycleTarget,
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
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
  });

  pageLifecycleTarget.emit("pagehide");
  video.paused = true;
  video.emit("pause");

  assert.deepEqual(dispatched, []);
});

test("does not broadcast pause when media pauses just before pagehide", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const video = new FakeEventedVideoElement();
  const pageLifecycleTarget = new FakePageLifecycleTarget();
  const dispatched: unknown[] = [];
  let seq = 0;
  const playbackSource = {
    url: "https://syncroom.example.test/video.mp4",
    sourceType: "mp4" as const,
    engine: "native" as const,
  };
  const controller = createWebRoomPlaybackController({
    pageLifecycleTarget,
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
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
  });

  video.paused = true;
  video.emit("pause");
  pageLifecycleTarget.emit("pagehide");
  t.mock.timers.tick(150);

  assert.deepEqual(dispatched, []);
});

test("does not seek or pause live playback from persisted room playback state", async () => {
  const video = new FakeEventedVideoElement();
  video.currentTime = 62;
  video.paused = false;
  const playbackSource = {
    url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    playbackSource,
    playback: {
      url: playbackSource.url,
      currentTime: 0,
      playState: "paused",
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 0,
    },
  });

  assert.equal(video.currentTime, 62);
  assert.equal(video.paused, false);
});

test("resumes live playback from refreshed room state when the room was playing", async () => {
  const video = new FakeEventedVideoElement();
  video.currentTime = 62;
  video.paused = true;
  const sharedUrl = "https://live.bilibili.com/22889518";
  const playbackSource = {
    url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playbackSource,
    playback: {
      url: sharedUrl,
      currentTime: 0,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 1,
    },
  });

  assert.equal(video.currentTime, 62);
  assert.equal(video.paused, false);
});

test("retries refreshed live playback when the initial play is interrupted", async () => {
  class InterruptedFirstPlayVideoElement extends FakeEventedVideoElement {
    playCalls = 0;

    override async play(): Promise<void> {
      this.playCalls += 1;
      if (this.playCalls === 1) {
        throw new Error("play interrupted by source load");
      }
      this.paused = false;
    }
  }

  const video = new InterruptedFirstPlayVideoElement();
  video.currentTime = 62;
  video.paused = true;
  const sharedUrl = "https://live.bilibili.com/22889518";
  const playbackSource = {
    url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playbackSource,
    playback: {
      url: sharedUrl,
      currentTime: 0,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 1,
    },
  });

  assert.equal(video.playCalls, 1);
  assert.equal(video.paused, true);

  video.emit("canplay");
  await Promise.resolve();

  assert.equal(video.playCalls, 2);
  assert.equal(video.paused, false);
});

test("starts refreshed live playback muted when autoplay blocks sound", async () => {
  class AutoplayBlockedVideoElement extends FakeEventedVideoElement {
    muted = false;
    playCalls = 0;

    override async play(): Promise<void> {
      this.playCalls += 1;
      if (!this.muted) {
        const error = new Error("autoplay blocked");
        error.name = "NotAllowedError";
        throw error;
      }
      this.paused = false;
    }
  }

  const video = new AutoplayBlockedVideoElement();
  video.currentTime = 62;
  video.paused = true;
  const sharedUrl = "https://live.bilibili.com/22889518";
  const playbackSource = {
    url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playbackSource,
    playback: {
      url: sharedUrl,
      currentTime: 0,
      playState: "playing",
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 1,
    },
  });

  assert.equal(video.playCalls, 2);
  assert.equal(video.muted, true);
  assert.equal(video.paused, false);
});

test("starts live playback from a user initiated shared state", async () => {
  const video = new FakeEventedVideoElement();
  const sharedUrl = "https://live.bilibili.com/22889518";
  const playbackSource = {
    url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playbackSource,
    playback: {
      url: sharedUrl,
      currentTime: 0,
      playState: "playing",
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 1,
    },
  });

  assert.equal(video.paused, false);
});

test("syncs local live play and pause without broadcasting live seek or buffering", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const video = new FakeEventedVideoElement();
  const dispatched: unknown[] = [];
  const sharedUrl = "https://live.bilibili.com/22889518";
  const playbackSource = {
    url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  let now = 5_000;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: sharedUrl,
    }),
    nextSeq: () => 1,
    dispatchPlaybackUpdate: (message) => dispatched.push(message),
    now: () => now,
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(playbackSource.url),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playbackSource,
    playback: {
      url: sharedUrl,
      currentTime: 0,
      playState: "playing",
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 1,
    },
  });

  now = 5_600;
  video.paused = false;
  video.emit("play");
  video.paused = true;
  video.emit("pause");
  video.currentTime = 24;
  video.emit("seeked");
  video.emit("waiting");
  t.mock.timers.tick(150);

  assert.deepEqual(dispatched, [
    {
      type: "playback:update",
      payload: {
        memberToken: "valid-member-token-123",
        playback: {
          url: sharedUrl,
          currentTime: 0,
          playState: "playing",
          playbackRate: 1,
          updatedAt: 5_600,
          serverTime: 5_600,
          actorId: "member-guest",
          seq: 1,
        },
      },
    },
    {
      type: "playback:update",
      payload: {
        memberToken: "valid-member-token-123",
        playback: {
          url: sharedUrl,
          currentTime: 0,
          playState: "paused",
          playbackRate: 1,
          updatedAt: 5_600,
          serverTime: 5_600,
          actorId: "member-guest",
          seq: 1,
        },
      },
    },
  ]);
});

test("syncs media-controller live play requests from the video surface", async () => {
  const video = new FakeEventedVideoElement();
  const mediaController = new FakeMediaRequestTarget();
  const dispatched: unknown[] = [];
  const sourceUrl = "https://cdn.example.test/live.m3u8";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  const playbackSource = {
    url: sourceUrl,
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  let now = 6_000;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: sharedUrl,
    }),
    nextSeq: () => 1,
    dispatchPlaybackUpdate: (message) => dispatched.push(message),
    now: () => now,
  });

  await controller.sync(
    createPlaybackRootWithMediaController(video, mediaController),
    {
      ...createJoinedPlaybackState(playbackSource.url),
      currentMemberId: "member-guest",
      playbackUrl: sharedUrl,
      playbackSource,
      playback: {
        url: sharedUrl,
        currentTime: 0,
        playState: "playing",
        userInitiated: true,
        playbackRate: 1,
        updatedAt: 5_000,
        serverTime: 5_000,
        actorId: "member-host",
        seq: 1,
      },
    },
  );

  now = 6_600;
  video.paused = false;
  mediaController.emit("mediapauserequest");
  video.paused = true;
  video.emit("pause");

  assert.deepEqual(dispatched, [
    {
      type: "playback:update",
      payload: {
        memberToken: "valid-member-token-123",
        playback: {
          url: sharedUrl,
          currentTime: 0,
          playState: "paused",
          syncIntent: "explicit-pause",
          userInitiated: true,
          playbackRate: 1,
          updatedAt: 6_600,
          serverTime: 6_600,
          actorId: "member-guest",
          seq: 1,
        },
      },
    },
  ]);
});

test("reports VOD buffering through the buffer coordination channel", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const video = new FakeEventedVideoElement();
  const reports: unknown[] = [];
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  let now = 1_000;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: () => undefined,
    dispatchPlaybackBufferReport: (report) => reports.push(report),
    nextSeq: () => 1,
    bufferReportDelayMs: 10,
    now: () => now,
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 12,
      playState: "playing",
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-host",
      seq: 1,
    },
  });

  now = 2_000;
  video.currentTime = 12;
  video.emit("waiting");
  t.mock.timers.tick(9);
  assert.deepEqual(reports, []);
  t.mock.timers.tick(1);
  assert.deepEqual(reports, [
    {
      state: "buffering",
      currentTime: 12,
      bufferAheadSeconds: 0,
      playbackRevision: JSON.stringify([sharedUrl, "member-host", 1, 1_000]),
    },
  ]);

  video.emit("playing");
  assert.deepEqual(reports.at(-1), {
    state: "ready",
    currentTime: 12,
    bufferAheadSeconds: 0,
    playbackRevision: JSON.stringify([sharedUrl, "member-host", 1, 1_000]),
  });
});

test("does not chase a projected timeline when the same playback revision rerenders", async () => {
  const video = new FakeEventedVideoElement();
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  let now = 2_000;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-follower",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: () => undefined,
    nextSeq: () => 1,
    now: () => now,
  });
  const playingState = {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-follower",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 120,
      playState: "playing" as const,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-host",
      seq: 3,
    },
  };

  await controller.sync(createPlaybackRoot(video), playingState);
  assert.equal(video.currentTime, 121);

  video.currentTime = 121.25;
  now = 7_000;
  await controller.sync(createPlaybackRoot(video), {
    ...playingState,
    playbackSync: {
      strategy: "smooth",
      hold: { active: false },
      bufferingMemberIds: ["member-follower"],
    },
  });
  assert.equal(video.currentTime, 121.25);

  await controller.sync(createPlaybackRoot(video), {
    ...playingState,
    playback: {
      ...playingState.playback,
      currentTime: 200,
      updatedAt: 7_000,
      serverTime: 7_000,
      actorId: "member-seeker",
      seq: 4,
      syncIntent: "explicit-seek",
    },
  });
  assert.equal(video.currentTime, 200);
});

test("continues reporting ready buffer growth while VOD wait mode is holding", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const video = new FakeEventedVideoElement();
  const reports: unknown[] = [];
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  let now = 1_000;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: () => undefined,
    dispatchPlaybackBufferReport: (report) => reports.push(report),
    nextSeq: () => 1,
    bufferReportDelayMs: 10,
    now: () => now,
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 12,
      playState: "playing",
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-host",
      seq: 1,
    },
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 1_500,
        deadlineAt: 11_500,
      },
      bufferingMemberIds: ["member-guest"],
    },
  });

  now = 2_000;
  video.currentTime = 12;
  video.buffered = createBufferedRanges([{ start: 12, end: 13 }]);
  video.emit("canplay");
  assert.deepEqual(reports, [
    {
      state: "ready",
      currentTime: 12,
      bufferAheadSeconds: 1,
      playbackRevision: JSON.stringify([sharedUrl, "member-host", 1, 1_000]),
    },
  ]);

  video.buffered = createBufferedRanges([{ start: 12, end: 15 }]);
  video.emit("progress");
  assert.deepEqual(reports.at(-1), {
    state: "ready",
    currentTime: 12,
    bufferAheadSeconds: 3,
    playbackRevision: JSON.stringify([sharedUrl, "member-host", 1, 1_000]),
  });
});

test("seeks to the held VOD target before reporting readiness", async (t) => {
  const video = new FakeEventedVideoElement();
  const reports: unknown[] = [];
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  video.currentTime = 12;
  video.buffered = createBufferedRanges([{ start: 12, end: 20 }]);
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: () => undefined,
    dispatchPlaybackBufferReport: (report) => reports.push(report),
    nextSeq: () => 1,
    now: () => 1_000,
  });
  t.after(() => controller.dispose());

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 120,
      playState: "playing",
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-host",
      seq: 2,
    },
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 1_000,
        deadlineAt: 31_000,
        playbackRevision: "barrier-seek-120",
      },
      bufferingMemberIds: ["member-guest"],
    },
  });

  assert.equal(video.currentTime, 120);
  assert.deepEqual(reports, [
    {
      state: "buffering",
      currentTime: 120,
      bufferAheadSeconds: 0,
      playbackRevision: JSON.stringify([sharedUrl, "member-host", 2, 1_000]),
    },
  ]);
});

test("keeps the buffer reporter bound when player controls rerender during a hold", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const video = new FakeEventedVideoElement();
  const reports: unknown[] = [];
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  video.currentTime = 12;
  video.buffered = createBufferedRanges([{ start: 12, end: 16 }]);
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  let now = 2_000;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-follower",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: () => undefined,
    dispatchPlaybackBufferReport: (report) => reports.push(report),
    nextSeq: () => 1,
    now: () => now,
  });
  const heldState = {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-follower",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 12,
      playState: "playing" as const,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-host",
      seq: 3,
    },
    playbackSync: {
      strategy: "wait" as const,
      hold: {
        active: true,
        reasonMemberId: "member-follower",
        startedAt: 1_500,
        playbackRevision: "barrier-1",
      },
      bufferingMemberIds: ["member-follower"],
    },
  };

  await controller.sync(
    createPlaybackRootWithPlayToggle(video, new FakePlayToggleControl()),
    heldState,
  );
  assert.equal(reports.length, 1);
  now = 2_600;
  t.mock.timers.tick(500);
  assert.equal(reports.length, 1);

  await controller.sync(
    createPlaybackRootWithPlayToggle(video, new FakePlayToggleControl()),
    heldState,
  );
  video.buffered = createBufferedRanges([{ start: 12, end: 19 }]);
  now = 3_200;
  t.mock.timers.tick(500);

  assert.deepEqual(reports.at(-1), {
    state: "ready",
    currentTime: 12,
    bufferAheadSeconds: 7,
    playbackRevision: JSON.stringify([sharedUrl, "member-host", 3, 1_000]),
  });
  assert.equal(reports.length, 2);
});

test("counts a tiny buffered-range gap after seek as ready buffer ahead", async () => {
  const video = new FakeEventedVideoElement();
  const reports: unknown[] = [];
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  let now = 1_000;
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: () => undefined,
    dispatchPlaybackBufferReport: (report) => reports.push(report),
    nextSeq: () => 1,
    now: () => now,
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 12,
      playState: "playing",
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-host",
      seq: 1,
    },
  });

  now = 2_000;
  video.currentTime = 12;
  video.buffered = createBufferedRanges([{ start: 12.05, end: 15.25 }]);
  video.emit("canplay");

  assert.deepEqual(reports, [
    {
      state: "ready",
      currentTime: 12,
      bufferAheadSeconds: 3.25,
      playbackRevision: JSON.stringify([sharedUrl, "member-host", 1, 1_000]),
    },
  ]);
});

test("applies room playback hold without broadcasting a local pause", async () => {
  const video = new FakeEventedVideoElement();
  video.paused = false;
  const dispatched: unknown[] = [];
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-guest",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: (message) => dispatched.push(message),
    nextSeq: () => 1,
    now: () => 2_000,
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 12,
      playState: "playing",
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-host",
      seq: 1,
    },
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 1_500,
        deadlineAt: 11_500,
      },
      bufferingMemberIds: ["member-guest"],
    },
  });

  assert.equal(video.paused, true);
  assert.deepEqual(dispatched, []);
});

test("resumes playback after wait-mode hold releases for the local playback actor", async () => {
  const video = new FakeEventedVideoElement();
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-host",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: () => undefined,
    nextSeq: () => 1,
    now: () => 2_000,
  });
  const playingState = {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-host",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 42,
      playState: "playing" as const,
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-host",
      seq: 1,
    },
  };

  await controller.sync(createPlaybackRoot(video), playingState);
  assert.equal(video.paused, false);

  await controller.sync(createPlaybackRoot(video), {
    ...playingState,
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-guest",
        startedAt: 1_500,
        deadlineAt: 11_500,
      },
      bufferingMemberIds: ["member-guest"],
    },
  });
  assert.equal(video.paused, true);

  await controller.sync(createPlaybackRoot(video), {
    ...playingState,
    playbackSync: {
      strategy: "wait",
      hold: { active: false },
      bufferingMemberIds: [],
    },
  });

  assert.equal(video.paused, false);
});

test("resumes playback after wait-mode hold releases for a remote playback actor", async () => {
  const video = new FakeEventedVideoElement();
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-follower",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: () => undefined,
    nextSeq: () => 1,
    now: () => 2_000,
  });
  const playingState = {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-follower",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 120,
      playState: "playing" as const,
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-seeker",
      seq: 3,
    },
  };

  await controller.sync(createPlaybackRoot(video), playingState);
  assert.equal(video.paused, false);

  await controller.sync(createPlaybackRoot(video), {
    ...playingState,
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-follower",
        startedAt: 1_500,
        deadlineAt: 11_500,
      },
      bufferingMemberIds: ["member-follower"],
    },
  });
  assert.equal(video.paused, true);

  await controller.sync(createPlaybackRoot(video), {
    ...playingState,
    playbackSync: {
      strategy: "wait",
      hold: { active: false },
      bufferingMemberIds: [],
    },
  });

  assert.equal(video.paused, false);
});

test("retries remote wait-mode resume when the first VOD play attempt is interrupted", async () => {
  const video = new FailingOncePlayVideoElement();
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-follower",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: () => undefined,
    nextSeq: () => 1,
    now: () => 2_000,
  });
  const playingState = {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-follower",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 120,
      playState: "playing" as const,
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-seeker",
      seq: 3,
    },
  };

  await controller.sync(createPlaybackRoot(video), {
    ...playingState,
    playbackSync: {
      strategy: "wait",
      hold: {
        active: true,
        reasonMemberId: "member-follower",
        startedAt: 1_500,
        deadlineAt: 11_500,
      },
      bufferingMemberIds: ["member-follower"],
    },
  });
  assert.equal(video.paused, true);

  await controller.sync(createPlaybackRoot(video), {
    ...playingState,
    playbackSync: {
      strategy: "wait",
      hold: { active: false },
      bufferingMemberIds: [],
    },
  });
  assert.equal(video.paused, true);
  assert.equal(video.playAttempts, 1);

  video.emit("canplay");
  await waitForCondition(
    () => !video.paused && video.playAttempts >= 2,
    "remote follower should retry VOD playback after media becomes playable",
  );
});

test("keeps wait-mode resume intent when player controls are rebound during render", async () => {
  const video = new FailingOncePlayVideoElement();
  const sourceUrl = "https://cdn.example.test/video.mpd";
  const sharedUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
    getSyncContext: () => ({
      memberToken: "valid-member-token-123",
      actorId: "member-follower",
      url: sharedUrl,
    }),
    dispatchPlaybackUpdate: () => undefined,
    nextSeq: () => 1,
    now: () => 2_000,
  });
  const playingState = {
    ...createJoinedPlaybackState(sourceUrl),
    currentMemberId: "member-follower",
    playbackUrl: sharedUrl,
    playback: {
      url: sharedUrl,
      currentTime: 120,
      playState: "playing" as const,
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 1_000,
      serverTime: 1_000,
      actorId: "member-seeker",
      seq: 3,
    },
  };

  await controller.sync(
    createPlaybackRootWithPlayToggle(video, new FakePlayToggleControl()),
    {
      ...playingState,
      playbackSync: {
        strategy: "wait",
        hold: {
          active: true,
          reasonMemberId: "member-follower",
          startedAt: 1_500,
          deadlineAt: 11_500,
        },
        bufferingMemberIds: ["member-follower"],
      },
    },
  );
  assert.equal(video.paused, true);

  await controller.sync(
    createPlaybackRootWithPlayToggle(video, new FakePlayToggleControl()),
    {
      ...playingState,
      playbackSync: {
        strategy: "wait",
        hold: { active: false },
        bufferingMemberIds: [],
      },
    },
  );
  assert.equal(video.paused, true);
  assert.equal(video.playAttempts, 1);

  video.emit("canplay");
  await waitForCondition(
    () => !video.paused && video.playAttempts >= 2,
    "remote follower should keep hold-resume intent after player chrome rerenders",
  );
});

test("applies later remote live pause without seeking to the remote live timestamp", async () => {
  const video = new FakeEventedVideoElement();
  video.currentTime = 30;
  const sharedUrl = "https://live.bilibili.com/22889518";
  const playbackSource = {
    url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
    sourceType: "m3u8" as const,
    engine: "shaka" as const,
    isLive: true,
  };
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(): Promise<void> {
      return undefined;
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });
  const initialState = {
    ...createJoinedPlaybackState(playbackSource.url),
    currentMemberId: "member-guest",
    playbackUrl: sharedUrl,
    playbackSource,
    playback: {
      url: sharedUrl,
      currentTime: 0,
      playState: "playing" as const,
      userInitiated: true,
      playbackRate: 1,
      updatedAt: 5_000,
      serverTime: 5_000,
      actorId: "member-host",
      seq: 1,
    },
  };

  await controller.sync(createPlaybackRoot(video), initialState);
  assert.equal(video.paused, false);
  video.currentTime = 30;

  await controller.sync(createPlaybackRoot(video), {
    ...initialState,
    playback: {
      ...initialState.playback,
      playState: "paused",
      currentTime: 12,
      updatedAt: 6_000,
      serverTime: 6_000,
      seq: 2,
    },
  });

  assert.equal(video.paused, true);
  assert.equal(video.currentTime, 30);
});

test("reloads live playback when the provider candidate changes but the URL stays the same", async () => {
  const video = new FakeEventedVideoElement();
  const loadedUrls: string[] = [];
  const sharedUrl = "https://live.bilibili.com/22889518";
  const liveUrl = "https://syncroom.example.test/proxy/manifest/live.m3u8";
  class FakeShakaPlayer {
    async attach(): Promise<void> {
      return undefined;
    }

    async load(url: string): Promise<void> {
      loadedUrls.push(url);
    }
  }
  const controller = createWebRoomPlaybackController({
    loadShakaPlayer: async () => ({ Player: FakeShakaPlayer }),
  });

  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(liveUrl),
    playbackUrl: sharedUrl,
    playbackSource: {
      url: liveUrl,
      sourceType: "m3u8",
      engine: "shaka",
      isLive: true,
      candidateId: "hls-live-1080p",
    },
  });
  await controller.sync(createPlaybackRoot(video), {
    ...createJoinedPlaybackState(liveUrl),
    playbackUrl: sharedUrl,
    playbackSource: {
      url: liveUrl,
      sourceType: "m3u8",
      engine: "shaka",
      isLive: true,
      candidateId: "hls-live-720p",
    },
  });

  assert.deepEqual(loadedUrls, [liveUrl, liveUrl]);
});
