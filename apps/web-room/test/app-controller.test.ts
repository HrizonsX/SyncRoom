import assert from "node:assert/strict";
import test from "node:test";
import type { ProviderPlaybackDescriptor } from "@syncroom/protocol";
import {
  createWebRoomAppController,
  DEFAULT_WEB_ROOM_SERVER_URL,
  coerceWebRoomServerUrlForPage,
  resolveDefaultWebRoomServerUrl,
  WEB_ROOM_IDENTITY_STORAGE_KEY,
  WEB_ROOM_THEME_STORAGE_KEY,
} from "../src/app-controller.js";
import {
  ProviderApiError,
  type ProviderApiClient,
} from "../src/provider-api-client.js";
import type { StorageLike, WebSocketLike } from "../src/room-client.js";

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

type SocketEvent = "open" | "message" | "close" | "error";
type SocketListener = (event: { data?: unknown }) => void;

class FakeSocket implements WebSocketLike {
  readonly OPEN = 1;
  readonly sent: unknown[] = [];
  readyState = 0;
  private readonly listeners = new Map<SocketEvent, SocketListener[]>();

  send(data: string): void {
    if (this.readyState !== this.OPEN) {
      throw new Error("WebSocket is already in CLOSING or CLOSED state.");
    }
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  addEventListener(type: SocketEvent, listener: SocketListener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: SocketEvent, data?: unknown): void {
    if (type === "open") {
      this.readyState = this.OPEN;
    }
    if (type === "close") {
      this.readyState = 3;
    }
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data });
    }
  }
}

class FakeVoiceRuntime {
  readonly connectCalls: unknown[] = [];
  readonly microphoneCalls: boolean[] = [];
  readonly disconnectCalls: number[] = [];

  async connect(payload: unknown): Promise<void> {
    this.connectCalls.push(payload);
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    this.microphoneCalls.push(enabled);
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls.push(1);
  }
}

async function flushAsyncTasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function createSocketRecorder() {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  return {
    sockets,
    urls,
    factory(url: string): WebSocketLike {
      const socket = new FakeSocket();
      sockets.push(socket);
      urls.push(url);
      return socket;
    },
  };
}

function createJoinedHostController(
  options: Omit<
    Parameters<typeof createWebRoomAppController>[0],
    "socketFactory"
  > = {},
) {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    ...options,
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  return { controller, recorder };
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
    proxy: false,
    shared: true,
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

const multiQualityProviderPlaybackDescriptor: ProviderPlaybackDescriptor = {
  ...providerPlaybackDescriptor,
  candidates: [
    {
      id: "dash-avc-1080p",
      sourceType: "mpd",
      url: "https://syncroom.example.test/proxy/manifest/1080.mpd",
      qualityLabel: "1080P",
      codecs: "avc1.640028,mp4a.40.2",
      default: true,
    },
    {
      id: "dash-avc-720p",
      sourceType: "mpd",
      url: "https://syncroom.example.test/proxy/manifest/720.mpd",
      qualityLabel: "720P",
      codecs: "avc1.64001f,mp4a.40.2",
    },
  ],
  defaultCandidateId: "dash-avc-1080p",
};

const genericAutoProxyProviderPlaybackDescriptor: ProviderPlaybackDescriptor = {
  providerId: "generic",
  sourceId: "generic:source",
  sourceUrl: "https://www.example.test/watch/1",
  title: "Generic Video",
  item: {
    itemId: "default",
    title: "Generic Video",
    kind: "part",
  },
  policy: {
    proxy: true,
    shared: false,
  },
  candidates: [
    {
      id: "hls-720",
      sourceType: "m3u8",
      url: "https://syncroom.example.test/proxy/manifest/generic-manifest",
      qualityLabel: "720P",
      codecs: "avc1.64001f,mp4a.40.2",
      default: true,
    },
  ],
  defaultCandidateId: "hls-720",
};

test("starts on the entry screen with the default server URL", () => {
  const controller = createWebRoomAppController({
    socketFactory: createSocketRecorder().factory,
  });

  const state = controller.getState();
  assert.equal(state.view, "entry");
  assert.equal(state.connectionState, "disconnected");
  assert.equal(state.serverUrl, DEFAULT_WEB_ROOM_SERVER_URL);
  assert.match(state.displayName ?? "", /^网页用户[A-Z]{2}$/);
});

test("resolves the default server URL from an HTTPS page origin", () => {
  assert.equal(
    resolveDefaultWebRoomServerUrl({
      protocol: "https:",
      host: "8.163.88.33",
      hostname: "8.163.88.33",
    }),
    "https://8.163.88.33",
  );
});

test("migrates same-host insecure server URLs when the web room is loaded over HTTPS", () => {
  assert.equal(
    coerceWebRoomServerUrlForPage("ws://8.163.88.33:8787", {
      protocol: "https:",
      host: "8.163.88.33",
      hostname: "8.163.88.33",
    }),
    "https://8.163.88.33",
  );
});

test("initial state migrates a persisted same-host ws URL on HTTPS pages", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    "syncroom:web-room-session",
    JSON.stringify({
      roomCode: "ABC123",
      joinToken: "valid-join-token-123",
      memberToken: "valid-member-token-123",
      displayName: "Alice",
      serverUrl: "ws://8.163.88.33:8787",
    }),
  );

  const controller = createWebRoomAppController({
    storage,
    socketFactory: createSocketRecorder().factory,
    pageLocation: {
      protocol: "https:",
      host: "8.163.88.33",
      hostname: "8.163.88.33",
    },
  });

  assert.equal(controller.getState().serverUrl, "https://8.163.88.33");
});

test("uses a generated web nickname when the display name is blank", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: " ",
    serverUrl: "http://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");

  const sent = recorder.sockets[0]?.sent[0] as
    | { payload?: { displayName?: string } }
    | undefined;
  assert.match(sent?.payload?.displayName ?? "", /^网页用户[A-Z]{2}$/);
});

test("keeps the generated web nickname fixed for the same browser storage", () => {
  const storage = new MemoryStorage();
  const firstController = createWebRoomAppController({
    storage,
    socketFactory: createSocketRecorder().factory,
    random: () => 0,
  });
  const firstDisplayName = firstController.getState().displayName ?? "";

  const secondController = createWebRoomAppController({
    storage,
    socketFactory: createSocketRecorder().factory,
    random: () => 0.99,
  });

  assert.match(firstDisplayName, /[A-Z]{2}$/);
  assert.equal(secondController.getState().displayName, firstDisplayName);
  assert.match(
    storage.getItem(WEB_ROOM_IDENTITY_STORAGE_KEY) ?? "",
    new RegExp(firstDisplayName),
  );
});

test("localizes entry room-not-found server errors", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.joinRoom({
    serverUrl: "ws://syncroom.example.test",
    displayName: "Alice",
    roomCode: "ABC123",
    joinToken: "valid-join-token-123",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "error",
      payload: {
        code: "room_not_found",
        message: "Room not found.",
      },
    }),
  );

  const state = controller.getState();
  assert.equal(state.view, "entry");
  if (state.view !== "entry") {
    throw new Error("Expected entry state.");
  }
  assert.equal(state.errorMessage, "房间不存在或已失效。");
});

test("toggles and persists the web room theme mode", () => {
  const storage = new MemoryStorage();
  const states: string[] = [];
  const controller = createWebRoomAppController({
    storage,
    onStateChange: (state) => states.push(state.themeMode ?? "light"),
  });

  assert.equal(controller.getState().themeMode, "light");

  controller.toggleThemeMode();

  assert.equal(controller.getState().themeMode, "dark");
  assert.equal(storage.getItem(WEB_ROOM_THEME_STORAGE_KEY), "dark");

  controller.toggleThemeMode();

  assert.equal(controller.getState().themeMode, "light");
  assert.equal(storage.getItem(WEB_ROOM_THEME_STORAGE_KEY), "light");
  assert.deepEqual(states.slice(-2), ["dark", "light"]);
});

test("reuses the browser web nickname after leaving a room", () => {
  const storage = new MemoryStorage();
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    storage,
    socketFactory: recorder.factory,
    random: () => 0,
  });
  const initialDisplayName = controller.getState().displayName ?? "";

  controller.createRoom({
    displayName: initialDisplayName,
    serverUrl: "http://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.leaveRoom();

  const state = controller.getState();
  assert.equal(state.view, "entry");
  assert.equal(state.displayName, initialDisplayName);
  assert.equal(state.roomInvite, "ABC123:valid-join-token-123");
  assert.match(
    storage.getItem(WEB_ROOM_IDENTITY_STORAGE_KEY) ?? "",
    new RegExp(initialDisplayName),
  );
});

test("creates a room after the websocket opens and persists safe session state", () => {
  const storage = new MemoryStorage();
  const recorder = createSocketRecorder();
  const states: unknown[] = [];
  const controller = createWebRoomAppController({
    storage,
    socketFactory: recorder.factory,
    onStateChange: (state) => states.push(state),
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "http://syncroom.example.test",
  });

  assert.equal(recorder.urls[0], "ws://syncroom.example.test");
  assert.equal(controller.getState().connectionState, "connecting");
  assert.deepEqual(recorder.sockets[0]?.sent, []);

  recorder.sockets[0]?.emit("open");
  assert.equal(controller.getState().connectionState, "connected");
  assert.deepEqual(recorder.sockets[0]?.sent, [
    {
      type: "room:create",
      payload: {
        displayName: "Alice",
        protocolVersion: 3,
      },
    },
  ]);

  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  assert.equal(controller.getState().view, "joined");
  assert.equal(
    controller.getState().view === "joined"
      ? controller.getState().roomCode
      : null,
    "ABC123",
  );
  assert.equal(
    controller.getState().view === "joined"
      ? controller.getState().joinToken
      : null,
    "valid-join-token-123",
  );
  assert.match(
    storage.getItem("syncroom:web-room-session") ?? "",
    /valid-member-token-123/,
  );
  assert.doesNotMatch(
    storage.getItem("syncroom:web-room-session") ?? "",
    /cookie|credential/i,
  );
  assert.ok(states.length >= 3);
});

test("joins a room with a join token and requests room state after join", () => {
  const storage = new MemoryStorage();
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    storage,
    socketFactory: recorder.factory,
  });

  controller.joinRoom({
    roomCode: "abc123",
    joinToken: "valid-join-token-123",
    displayName: "Bob",
    serverUrl: "wss://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");

  assert.deepEqual(recorder.sockets[0]?.sent, [
    {
      type: "room:join",
      payload: {
        roomCode: "ABC123",
        joinToken: "valid-join-token-123",
        displayName: "Bob",
        protocolVersion: 3,
      },
    },
  ]);

  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:joined",
      payload: {
        roomCode: "ABC123",
        memberId: "member-2",
        memberToken: "valid-member-token-456",
      },
    }),
  );

  assert.deepEqual(recorder.sockets[0]?.sent.at(-1), {
    type: "sync:request",
    payload: { memberToken: "valid-member-token-456" },
  });
  assert.deepEqual(
    JSON.parse(storage.getItem("syncroom:web-room-session") ?? ""),
    {
      roomCode: "ABC123",
      joinToken: "valid-join-token-123",
      memberToken: "valid-member-token-456",
      displayName: "Bob",
      serverUrl: "wss://syncroom.example.test",
    },
  );
});

test("starts web clock sync after joining and applies pong metrics", () => {
  let now = 1_000;
  const clockSyncIntervals: Array<{
    callback: () => void;
    delayMs: number;
    handle: string;
  }> = [];
  const clearedClockSyncIntervals: string[] = [];
  const { controller, recorder } = createJoinedHostController({
    now: () => now,
    setClockSyncInterval: (callback: () => void, delayMs: number) => {
      const handle = `clock-${clockSyncIntervals.length + 1}`;
      clockSyncIntervals.push({ callback, delayMs, handle });
      return handle;
    },
    clearClockSyncInterval: (handle: unknown) => {
      clearedClockSyncIntervals.push(String(handle));
    },
  });

  const clockPing = recorder.sockets[0]?.sent.find(
    (message) => (message as { type?: string }).type === "sync:ping",
  );
  assert.deepEqual(clockPing, {
    type: "sync:ping",
    payload: {
      clientSendTime: 1_000,
    },
  });
  assert.equal(clockSyncIntervals.length, 1);
  assert.equal(clockSyncIntervals[0]?.delayMs, 60_000);

  now = 1_250;
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "sync:pong",
      payload: {
        clientSendTime: 1_000,
        serverReceiveTime: 1_120,
        serverSendTime: 1_130,
      },
    }),
  );

  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.rttMs, 240);
  assert.equal(state.clockOffsetMs, 0);

  now = 61_000;
  clockSyncIntervals[0]?.callback();
  assert.deepEqual(recorder.sockets[0]?.sent.at(-1), {
    type: "sync:ping",
    payload: {
      clientSendTime: 61_000,
    },
  });

  controller.leaveRoom();
  assert.deepEqual(clearedClockSyncIntervals, ["clock-1"]);
});

test("restores a persisted web room session on refresh", () => {
  const storage = new MemoryStorage();
  const recorder = createSocketRecorder();
  storage.setItem(
    "syncroom:web-room-session",
    JSON.stringify({
      roomCode: "ABC123",
      joinToken: "valid-join-token-123",
      memberToken: "valid-member-token-123",
      displayName: "Alice",
      serverUrl: "wss://syncroom.example.test",
    }),
  );

  createWebRoomAppController({
    storage,
    socketFactory: recorder.factory,
  });
  recorder.sockets[0]?.emit("open");

  assert.equal(recorder.urls[0], "wss://syncroom.example.test");
  assert.deepEqual(recorder.sockets[0]?.sent, [
    {
      type: "room:join",
      payload: {
        roomCode: "ABC123",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
        displayName: "Alice",
        protocolVersion: 3,
      },
    },
  ]);
});

test("refreshes Bilibili authorization when refresh rejoin restores host identity", async () => {
  const storage = new MemoryStorage();
  const recorder = createSocketRecorder();
  const authStatusRequests: unknown[] = [];
  storage.setItem(
    "syncroom:web-room-session",
    JSON.stringify({
      roomCode: "ABC123",
      joinToken: "valid-join-token-123",
      memberToken: "valid-member-token-123",
      displayName: "Alice",
      serverUrl: "wss://syncroom.example.test",
    }),
  );

  const controller = createWebRoomAppController({
    storage,
    socketFactory: recorder.factory,
    providerApiClientFactory: () => ({
      startAuth: async () => {
        throw new Error("unexpected startAuth");
      },
      pollAuth: async () => {
        throw new Error("unexpected pollAuth");
      },
      getAuthStatus: async (input) => {
        authStatusRequests.push(input);
        return {
          authorized: true,
          profile: {
            id: "mid-1",
            displayName: "Alice B",
            vipLabel: "年度大会员",
          },
          expiresAt: 601_000,
        };
      },
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => {
        throw new Error("unexpected parse");
      },
    }),
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:joined",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        memberToken: "valid-member-token-123",
      },
    }),
  );
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:state",
      payload: {
        roomCode: "ABC123",
        hostMemberId: "member-host",
        sharedVideo: null,
        playback: null,
        members: [{ id: "member-host", name: "Alice" }],
      },
    }),
  );
  await flushAsyncTasks();

  assert.deepEqual(authStatusRequests, [
    {
      roomCode: "ABC123",
      memberToken: "valid-member-token-123",
    },
  ]);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  assert.equal(state.view === "joined" ? state.authStatus : null, "authorized");
  assert.equal(state.view === "joined" ? state.authPanel?.open : null, false);
  assert.equal(
    state.view === "joined" ? state.authPanel?.profileName : null,
    "Alice B",
  );
});

test("leaves a joined room and clears the persisted rejoin session", () => {
  const storage = new MemoryStorage();
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    storage,
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.leaveRoom();

  assert.deepEqual(recorder.sockets[0]?.sent.at(-1), {
    type: "room:leave",
    payload: { memberToken: "valid-member-token-123" },
  });
  assert.equal(storage.getItem("syncroom:web-room-session"), null);
  const state = controller.getState();
  assert.equal(state.view, "entry");
  assert.equal(state.connectionState, "disconnected");
  assert.equal(state.serverUrl, "ws://syncroom.example.test");
  assert.match(state.displayName ?? "", /^网页用户[A-Z]{2}$/);
});

test("manages host Bilibili authorization panel local states", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.openAuthorizationPanel();
  let state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.deepEqual(state.authPanel, {
    open: true,
    method: "qr",
    phase: "idle",
  });

  controller.startBilibiliAuth({ method: "qr" });
  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.authStatus, "checking");
  assert.deepEqual(state.authPanel, {
    open: true,
    method: "qr",
    phase: "loading",
    message: "Bilibili QR authorization request is pending.",
  });

  controller.collapseBilibiliAuth();
  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.authStatus, "unauthorized");
  assert.deepEqual(state.authPanel, {
    open: true,
    method: "qr",
    phase: "idle",
  });

  controller.logoutBilibiliAuth();
  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.authStatus, "unauthorized");
  assert.deepEqual(state.authPanel, {
    open: true,
    method: "qr",
    phase: "idle",
    message: "Bilibili authorization logout is pending.",
  });
});

test("starts host Bilibili QR authorization through the provider API", async () => {
  const recorder = createSocketRecorder();
  const calls: unknown[] = [];
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    setAuthPollTimeout: () => 1,
    clearAuthPollTimeout: () => {},
    providerApiClientFactory: (serverUrl) => ({
      startAuth: async (input) => {
        calls.push({ serverUrl, input });
        return {
          providerId: "bilibili",
          method: "qr",
          flowId: "flow-1",
          status: "pending",
          expiresAt: 61_000,
          qrCodeUrl: "data:image/png;base64,qr",
          message: "Scan the Bilibili QR code.",
        };
      },
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => ({
        providerId: "bilibili",
        sourceId: "unused",
        sourceUrl: "https://www.bilibili.com/video/BV1unused",
        title: "unused",
        items: [],
      }),
    }),
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  await controller.startBilibiliAuth({ method: "qr" });

  assert.deepEqual(calls, [
    {
      serverUrl: "ws://syncroom.example.test",
      input: {
        roomCode: "ABC123",
        memberToken: "valid-member-token-123",
        method: "qr",
      },
    },
  ]);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.authStatus, "checking");
  assert.deepEqual(state.authPanel, {
    open: true,
    method: "qr",
    phase: "pending",
    flowId: "flow-1",
    expiresAt: 61_000,
    qrCodeUrl: "data:image/png;base64,qr",
    message: "Scan the Bilibili QR code.",
  });
});

test("starts iQIYI authorization through the provider API and keeps the modal open", async () => {
  const recorder = createSocketRecorder();
  const calls: unknown[] = [];
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    providerApiClientFactory: (serverUrl) => ({
      startAuth: async (input) => {
        calls.push({ serverUrl, input });
        throw new ProviderApiError(
          "provider_auth_unavailable",
          "Provider authorization is unavailable.",
          501,
          "auth_start_not_implemented",
        );
      },
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => ({
        providerId: "generic",
        sourceId: "unused",
        sourceUrl: "https://example.com/watch",
        title: "unused",
        items: [],
      }),
    }),
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  await controller.startProviderAuth({ providerId: "iqiyi", method: "qr" });

  assert.deepEqual(calls, [
    {
      serverUrl: "ws://syncroom.example.test",
      input: {
        providerId: "iqiyi",
        roomCode: "ABC123",
        memberToken: "valid-member-token-123",
        method: "qr",
      },
    },
  ]);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.authStatus, "unauthorized");
  assert.deepEqual(state.authPanel, {
    open: true,
    providerId: "iqiyi",
    method: "qr",
    phase: "failed",
    errorMessage: "iQIYI authorization is not connected yet.",
  });
});

test("starts Huya authorization through the provider API and keeps the modal open", async () => {
  const recorder = createSocketRecorder();
  const calls: unknown[] = [];
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    providerApiClientFactory: (serverUrl) => ({
      startAuth: async (input) => {
        calls.push({ serverUrl, input });
        throw new ProviderApiError(
          "provider_auth_unavailable",
          "Provider authorization is unavailable.",
          501,
          "auth_start_not_implemented",
        );
      },
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => ({
        providerId: "generic",
        sourceId: "unused",
        sourceUrl: "https://example.com/watch",
        title: "unused",
        items: [],
      }),
    }),
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  await controller.startProviderAuth({ providerId: "huya", method: "qr" });

  assert.deepEqual(calls, [
    {
      serverUrl: "ws://syncroom.example.test",
      input: {
        providerId: "huya",
        roomCode: "ABC123",
        memberToken: "valid-member-token-123",
        method: "qr",
      },
    },
  ]);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.authStatus, "unauthorized");
  assert.deepEqual(state.authPanel, {
    open: true,
    providerId: "huya",
    method: "qr",
    phase: "failed",
    errorMessage: "Huya authorization is not connected yet.",
  });
});

test("polls iQIYI QR authorization until the host is authorized", async () => {
  const recorder = createSocketRecorder();
  const pollCalls: unknown[] = [];
  const statusCalls: unknown[] = [];
  const scheduledCallbacks: Array<() => void> = [];
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    authPollIntervalMs: 25,
    setAuthPollTimeout: (callback: () => void) => {
      scheduledCallbacks.push(callback);
      return scheduledCallbacks.length;
    },
    clearAuthPollTimeout: () => {},
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "iqiyi",
        method: "qr",
        flowId: "iqiyi-flow-1",
        status: "pending",
        expiresAt: 61_000,
        qrCodeUrl: "data:image/png;base64,iqiyi-qr",
        message: "Scan the iQIYI QR code to authorize playback.",
      }),
      pollAuth: async (input) => {
        pollCalls.push(input);
        return {
          status: "authorized",
          profile: {
            id: "iqiyi-user-1",
            displayName: "爱奇艺用户",
            avatarUrl: "https://www.iqiyipic.com/avatar.png",
          },
          expiresAt: 600_000,
        };
      },
      getAuthStatus: async (input) => {
        statusCalls.push(input);
        return {
          authorized: true,
          profile: {
            id: "iqiyi-user-1",
            displayName: "爱奇艺用户",
            avatarUrl: "https://www.iqiyipic.com/avatar.png",
          },
          expiresAt: 600_000,
        };
      },
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => ({
        providerId: "generic",
        sourceId: "unused",
        sourceUrl: "https://example.com/watch",
        title: "unused",
        items: [],
      }),
    }),
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  await controller.startProviderAuth({ providerId: "iqiyi", method: "qr" });
  assert.equal(scheduledCallbacks.length, 1);
  scheduledCallbacks[0]?.();
  await flushAsyncTasks();

  assert.deepEqual(pollCalls, [
    {
      providerId: "iqiyi",
      roomCode: "ABC123",
      memberToken: "valid-member-token-123",
      flowId: "iqiyi-flow-1",
    },
  ]);
  assert.deepEqual(statusCalls, [
    {
      providerId: "iqiyi",
      roomCode: "ABC123",
      memberToken: "valid-member-token-123",
    },
  ]);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.authStatus, "authorized");
  assert.deepEqual(state.authPanel, {
    open: true,
    providerId: "iqiyi",
    method: "qr",
    phase: "authorized",
    profileName: "爱奇艺用户",
    expiresAt: 600_000,
  });
});

test("polls Bilibili QR authorization until the host is authorized", async () => {
  const recorder = createSocketRecorder();
  const pollCalls: unknown[] = [];
  const statusCalls: unknown[] = [];
  const scheduledCallbacks: Array<() => void> = [];
  const scheduledDelays: number[] = [];
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    authPollIntervalMs: 25,
    setAuthPollTimeout: (callback: () => void, delayMs: number) => {
      scheduledCallbacks.push(callback);
      scheduledDelays.push(delayMs);
      return scheduledCallbacks.length;
    },
    clearAuthPollTimeout: () => {},
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 61_000,
        qrCodeUrl: "data:image/png;base64,qr",
        message: "Scan the Bilibili QR code.",
      }),
      pollAuth: async (input) => {
        pollCalls.push(input);
        return {
          status: "authorized",
          profile: {
            id: "bilibili-user-1",
            displayName: "Alice Bili",
          },
          expiresAt: 121_000,
        };
      },
      getAuthStatus: async (input) => {
        statusCalls.push(input);
        return {
          authorized: true,
          profile: {
            id: "bilibili-user-1",
            displayName: "Alice Bili",
            vipLabel: "annual",
          },
          expiresAt: 122_000,
        };
      },
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => ({
        providerId: "bilibili",
        sourceId: "unused",
        sourceUrl: "https://www.bilibili.com/video/BV1unused",
        title: "unused",
        items: [],
      }),
    }),
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  await controller.startBilibiliAuth({ method: "qr" });

  assert.deepEqual(scheduledDelays, [25]);
  scheduledCallbacks[0]?.();
  await flushAsyncTasks();

  assert.deepEqual(pollCalls, [
    {
      roomCode: "ABC123",
      memberToken: "valid-member-token-123",
      flowId: "flow-1",
    },
  ]);
  assert.deepEqual(statusCalls, [
    {
      roomCode: "ABC123",
      memberToken: "valid-member-token-123",
    },
  ]);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.authStatus, "authorized");
  assert.deepEqual(state.authPanel, {
    open: true,
    method: "qr",
    phase: "authorized",
    profileName: "Alice Bili",
    vipLabel: "annual",
    expiresAt: 122_000,
  });
});

test("refreshes Bilibili auth details when opening an authorized panel", async () => {
  const recorder = createSocketRecorder();
  const scheduledCallbacks: Array<() => void> = [];
  const statusCalls: unknown[] = [];
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    setAuthPollTimeout: (callback) => {
      scheduledCallbacks.push(callback);
      return scheduledCallbacks.length;
    },
    clearAuthPollTimeout: () => {},
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 61_000,
        qrCodeUrl: "data:image/png;base64,qr",
      }),
      pollAuth: async () => ({
        status: "authorized",
        profile: {
          id: "bilibili-user-1",
          displayName: "Alice Bili",
        },
      }),
      getAuthStatus: async (input) => {
        statusCalls.push(input);
        return {
          authorized: true,
          profile: {
            id: "bilibili-user-1",
            displayName: "Alice Bili",
            vipLabel: "annual",
          },
          expiresAt: 122_000,
        };
      },
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => ({
        providerId: "bilibili",
        sourceId: "unused",
        sourceUrl: "https://www.bilibili.com/video/BV1unused",
        title: "unused",
        items: [],
      }),
    }),
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  await controller.startBilibiliAuth({ method: "qr" });
  scheduledCallbacks[0]?.();
  await flushAsyncTasks();

  controller.openAuthorizationPanel();
  await flushAsyncTasks();

  assert.equal(statusCalls.length, 2);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.deepEqual(state.authPanel, {
    open: true,
    method: "qr",
    phase: "authorized",
    profileName: "Alice Bili",
    vipLabel: "annual",
    expiresAt: 122_000,
  });
});

test("keeps Bilibili authorization controls host-only", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.joinRoom({
    roomCode: "ABC123",
    joinToken: "valid-join-token-123",
    displayName: "Bob",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:joined",
      payload: {
        roomCode: "ABC123",
        memberId: "member-guest",
        memberToken: "valid-member-token-456",
      },
    }),
  );
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:state",
      payload: {
        roomCode: "ABC123",
        sharedVideo: null,
        playback: null,
        members: [
          { id: "member-host", name: "Alice" },
          { id: "member-guest", name: "Bob" },
        ],
      },
    }),
  );

  controller.openAuthorizationPanel();
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.authPanel, undefined);
  assert.ok(
    state.diagnostics.some((item) =>
      item.includes("provider auth denied: host only"),
    ),
  );
});

test("manages host Bilibili picker local parse and policy states", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.openProviderPicker();
  let state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.providerPicker?.proxy, false);
  assert.equal(state.providerPicker?.shared, false);

  controller.parseBilibiliUrl({
    url: "https://www.bilibili.com/video/BV1TEST",
    proxy: true,
    shared: true,
  });
  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.deepEqual(state.providerPicker, {
    open: true,
    status: "loading",
    url: "https://www.bilibili.com/video/BV1TEST",
    proxy: true,
    shared: true,
    items: [],
    message: "Bilibili URL parse request is pending.",
  });

  controller.setProviderPickerResults({
    items: [
      {
        itemId: "cid-1",
        title: "Part 1",
        kind: "part",
        qualityLabel: "1080P",
        sourceType: "mp4",
      },
    ],
  });
  controller.selectProviderItem("cid-1");
  controller.setProviderPlaybackPolicy({
    proxy: false,
    shared: true,
    url: "https://www.bilibili.com/video/BV1TEST",
  });
  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.providerPicker?.status, "ready");
  assert.equal(state.providerPicker?.selectedItemId, "cid-1");
  assert.equal(
    state.providerPicker?.url,
    "https://www.bilibili.com/video/BV1TEST",
  );
  assert.equal(state.providerPicker?.proxy, false);
  assert.equal(state.providerPicker?.shared, true);
});

test("keeps a typed provider URL when playback policy changes before parsing", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.setProviderPlaybackPolicy({
    proxy: false,
    shared: true,
    url: "https://www.bilibili.com/video/BV1PENDING",
  });

  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(
    state.providerPicker?.url,
    "https://www.bilibili.com/video/BV1PENDING",
  );
});

test("loads Bilibili parse results from the provider API", async () => {
  const recorder = createSocketRecorder();
  const calls: unknown[] = [];
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    providerApiClientFactory: (serverUrl) => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 1,
      }),
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async (input: Parameters<ProviderApiClient["parse"]>[0]) => {
        calls.push({ serverUrl, input });
        return {
          providerId: "bilibili",
          sourceId: "BV1xx411c7mD",
          sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
          title: "Bilibili video",
          items: [
            {
              itemId: "BV1xx411c7mD:cid-987654",
              title: "Part 1",
              kind: "part",
              qualityLabel: "1080P",
              sourceType: "mpd",
              providerDescriptor: providerPlaybackDescriptor,
            },
          ],
        };
      },
    }),
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  await controller.parseBilibiliUrl({
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    proxy: true,
    shared: true,
  });

  assert.deepEqual(calls, [
    {
      serverUrl: "ws://syncroom.example.test",
      input: {
        providerId: "bilibili",
        roomCode: "ABC123",
        memberToken: "valid-member-token-123",
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        policy: {
          proxy: true,
          shared: true,
        },
      },
    },
  ]);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.providerPicker?.status, "ready");
  assert.equal(state.providerPicker?.selectedItemId, "BV1xx411c7mD:cid-987654");
  assert.deepEqual(state.providerPicker?.items, [
    {
      itemId: "BV1xx411c7mD:cid-987654",
      title: "Part 1",
      kind: "part",
      qualityLabel: "1080P",
      sourceType: "mpd",
      providerDescriptor: providerPlaybackDescriptor,
    },
  ]);
});

test("requests voice access from the joined room session", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.requestVoiceAccess();

  assert.deepEqual(recorder.sockets[0]?.sent.at(-1), {
    type: "voice:access",
    payload: {
      memberToken: "valid-member-token-123",
    },
  });
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.voice.status, "requesting");
  assert.equal(state.voice.accessRequestedFor, "ABC123:valid-member-token-123");
  assert.match(state.diagnostics.at(-1) ?? "", /voice access requested/);
});

test("sends private room danmaku with the current playback time", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.sendDanmaku("front row", {
    videoTime: 42.25,
    color: "#00ccff",
  });

  assert.deepEqual(recorder.sockets[0]?.sent.at(-1), {
    type: "danmaku:message",
    payload: {
      memberToken: "valid-member-token-123",
      content: "front row",
      videoTime: 42.25,
      mode: "scroll",
      color: "#00ccff",
    },
  });
});

test("limits private room danmaku sends to one per second", () => {
  let now = 10_000;
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  const { controller, recorder } = createJoinedHostController({
    now: () => now,
    setAuthPollTimeout: (callback: () => void, delayMs: number) => {
      timers.push({ callback, delayMs });
      return timers.length;
    },
    clearAuthPollTimeout: () => {},
  });

  const firstAccepted = controller.sendDanmaku("first", { videoTime: 1 });
  const secondAccepted = controller.sendDanmaku("second", { videoTime: 2 });

  assert.equal(firstAccepted, true);
  assert.equal(secondAccepted, false);

  assert.equal(
    recorder.sockets[0]?.sent.filter(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "danmaku:message",
    ).length,
    1,
  );
  let state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.danmakuCooldownUntil, 11_000);
  assert.deepEqual(
    timers.map((timer) => timer.delayMs),
    [1_000],
  );

  now = 11_000;
  timers[0]?.callback();
  const thirdAccepted = controller.sendDanmaku("third", { videoTime: 3 });

  assert.equal(thirdAccepted, true);

  assert.equal(
    recorder.sockets[0]?.sent.filter(
      (message) =>
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "danmaku:message",
    ).length,
    2,
  );
  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.danmakuCooldownUntil, 12_000);
});

test("connects the LiveKit voice runtime after access is granted", async () => {
  const recorder = createSocketRecorder();
  const runtime = new FakeVoiceRuntime();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    voiceRuntime: runtime,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.requestVoiceAccess();
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "voice:access-granted",
      payload: {
        livekitUrl: "wss://livekit.example.test",
        token: "voice-token",
        roomName: "syncroom-ABC123",
        participantIdentity: "member-host",
        expiresAt: 11_000,
      },
    }),
  );
  await flushAsyncTasks();

  assert.deepEqual(runtime.connectCalls, [
    {
      livekitUrl: "wss://livekit.example.test",
      token: "voice-token",
      roomName: "syncroom-ABC123",
      participantIdentity: "member-host",
    },
  ]);
  assert.deepEqual(recorder.sockets[0]?.sent.at(-1), {
    type: "voice:state",
    payload: {
      memberToken: "valid-member-token-123",
      connected: true,
      muted: true,
      speaking: false,
    },
  });
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.voice.status, "connected");
  assert.equal(state.voice.muted, true);
  assert.deepEqual(state.voice.participants["member-host"], {
    memberId: "member-host",
    connected: true,
    muted: true,
    speaking: false,
  });
});

test("toggles the LiveKit microphone after voice is connected", async () => {
  const recorder = createSocketRecorder();
  const runtime = new FakeVoiceRuntime();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    voiceRuntime: runtime,
    now: () => 14_000,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );
  controller.requestVoiceAccess();
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "voice:access-granted",
      payload: {
        livekitUrl: "wss://livekit.example.test",
        token: "voice-token",
        roomName: "syncroom-ABC123",
        participantIdentity: "member-host",
        expiresAt: 11_000,
      },
    }),
  );
  await flushAsyncTasks();

  await controller.toggleVoiceMicrophone();

  assert.deepEqual(runtime.microphoneCalls, [true]);
  assert.deepEqual(recorder.sockets[0]?.sent.at(-1), {
    type: "voice:state",
    payload: {
      memberToken: "valid-member-token-123",
      connected: true,
      muted: false,
      speaking: false,
    },
  });
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.voice.status, "connected");
  assert.equal(state.voice.muted, false);
  assert.deepEqual(state.voice.participants["member-host"], {
    memberId: "member-host",
    connected: true,
    muted: false,
    speaking: false,
  });
  assert.deepEqual(
    state.chatMessages.filter((message) => message.kind === "system"),
    [
      {
        kind: "system",
        systemEventType: "voice_unmuted",
        memberId: "member-host",
        displayName: "Alice",
        content: "Alice 开启了麦克风",
        timestamp: 14_000,
      },
    ],
  );
});

test("enables the microphone after the first voice button click connects", async () => {
  const recorder = createSocketRecorder();
  const runtime = new FakeVoiceRuntime();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    voiceRuntime: runtime,
    now: () => 14_000,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.toggleVoice();
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "voice:access-granted",
      payload: {
        livekitUrl: "wss://livekit.example.test",
        token: "voice-token",
        roomName: "syncroom-ABC123",
        participantIdentity: "member-host",
        expiresAt: 11_000,
      },
    }),
  );
  await flushAsyncTasks();

  assert.deepEqual(runtime.connectCalls, [
    {
      livekitUrl: "wss://livekit.example.test",
      token: "voice-token",
      roomName: "syncroom-ABC123",
      participantIdentity: "member-host",
    },
  ]);
  assert.deepEqual(runtime.microphoneCalls, [true]);
  assert.deepEqual(recorder.sockets[0]?.sent.at(-1), {
    type: "voice:state",
    payload: {
      memberToken: "valid-member-token-123",
      connected: true,
      muted: false,
      speaking: false,
    },
  });
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.voice.status, "connected");
  assert.equal(state.voice.muted, false);
});

test("adds system chat messages from actual voice state websocket events", () => {
  let now = 14_000;
  const { controller, recorder } = createJoinedHostController({
    now: () => now,
  });
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:state",
      payload: {
        roomCode: "ABC123",
        hostMemberId: "member-host",
        sharedVideo: null,
        playback: null,
        members: [
          { id: "member-host", name: "Alice" },
          { id: "member-2", name: "Bob" },
        ],
      },
    }),
  );
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "voice:state",
      payload: {
        roomCode: "ABC123",
        memberId: "member-2",
        connected: true,
        muted: true,
        speaking: false,
      },
    }),
  );
  now = 15_000;
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "voice:state",
      payload: {
        roomCode: "ABC123",
        memberId: "member-2",
        connected: true,
        muted: false,
        speaking: false,
      },
    }),
  );

  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  const systemMessages = state.chatMessages.filter(
    (message) => message.kind === "system",
  );
  assert.deepEqual(systemMessages, [
    {
      kind: "system",
      systemEventType: "voice_unmuted",
      memberId: "member-2",
      displayName: "Bob",
      content: "Bob 开启了麦克风",
      timestamp: 15_000,
    },
  ]);
});

test("releases chat send cooldown after the server retry window", () => {
  let now = 10_000;
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  const { controller, recorder } = createJoinedHostController({
    now: () => now,
    setAuthPollTimeout: (callback: () => void, delayMs: number) => {
      timers.push({ callback, delayMs });
      return timers.length;
    },
    clearAuthPollTimeout: () => {},
  });

  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "error",
      payload: {
        code: "chat_rate_limited",
        message: "Chat messages are limited.",
        messageType: "chat:message",
        retryAfterMs: 4_000,
      },
    }),
  );

  let state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.chatCooldownUntil, 14_000);
  assert.deepEqual(
    timers.map((timer) => timer.delayMs),
    [1_000],
  );

  now = 11_000;
  timers[0]?.callback();

  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.chatCooldownUntil, 14_000);
  assert.deepEqual(
    timers.map((timer) => timer.delayMs),
    [1_000, 1_000],
  );

  now = 14_000;
  timers.at(-1)?.callback();

  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.chatCooldownUntil, undefined);
});

test("clears transient voice errors after three seconds", async () => {
  const timers: Array<{ callback: () => void; delayMs: number }> = [];
  const { controller, recorder } = createJoinedHostController({
    voiceRuntime: new FakeVoiceRuntime(),
    setAuthPollTimeout: (callback: () => void, delayMs: number) => {
      timers.push({ callback, delayMs });
      return timers.length;
    },
    clearAuthPollTimeout: () => {},
  });

  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "error",
      payload: {
        code: "voice_unavailable",
        message: "Voice service unavailable.",
      },
    }),
  );
  await flushAsyncTasks();

  let state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.voice.status, "unavailable");
  assert.ok(state.voice.error);
  assert.deepEqual(
    timers.map((timer) => timer.delayMs),
    [3_000],
  );

  timers[0]?.callback();

  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.voice.status, "unavailable");
  assert.equal(state.voice.error, null);
});

test("shows actionable parse guidance when shared playback needs authorization", async () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 1,
      }),
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => {
        throw new ProviderApiError(
          "provider_auth_required",
          "Bilibili authorization is required.",
          401,
        );
      },
    }),
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  await controller.parseBilibiliUrl({
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    proxy: true,
    shared: true,
  });

  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.providerPicker?.status, "failed");
  assert.match(state.diagnostics.at(-1) ?? "", /provider API picker failed/);
  assert.match(state.diagnostics.at(-1) ?? "", /provider_auth_required/);
  assert.equal(
    state.providerPicker?.errorMessage,
    "请先完成 Bilibili 授权，或关闭 shared 后再解析。",
  );
});

test("shows live room offline parse guidance without shared/proxy fallback noise", async () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 1,
      }),
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => {
        throw Object.assign(
          new ProviderApiError(
            "provider_parse_failed",
            "Provider request failed.",
            400,
          ),
          { reason: "live_room_offline" },
        );
      },
    }),
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  await controller.parseBilibiliUrl({
    url: "https://live.bilibili.com/1977907472",
    proxy: false,
    shared: false,
  });

  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.providerPicker?.status, "failed");
  assert.equal(state.providerPicker?.errorMessage, "直播间当前未开播。");
  assert.doesNotMatch(state.providerPicker?.errorMessage ?? "", /关闭/);
  assert.match(state.diagnostics.at(-1) ?? "", /live_room_offline/);
});

test("parses non-Bilibili URLs through the generic provider without shared auth", async () => {
  const parseInputs: unknown[] = [];
  const { controller } = createJoinedHostController({
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 1,
      }),
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async (input: Parameters<ProviderApiClient["parse"]>[0]) => {
        parseInputs.push(input);
        return {
          providerId: "generic",
          sourceId: "generic:source",
          sourceUrl: "https://example.com/watch/123",
          title: "Generic Video",
          items: [],
        };
      },
    }),
  });

  await controller.parseBilibiliUrl({
    url: "https://example.com/watch/123",
    proxy: false,
    shared: true,
  });

  assert.deepEqual(parseInputs, [
    {
      providerId: "generic",
      roomCode: "ABC123",
      memberToken: "valid-member-token-123",
      url: "https://example.com/watch/123",
      policy: { proxy: false, shared: false },
    },
  ]);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.providerPicker?.status, "ready");
  assert.equal(state.providerPicker?.shared, false);
});

test("parses iQIYI URLs through the iQIYI provider without shared auth", async () => {
  const parseInputs: unknown[] = [];
  const { controller } = createJoinedHostController({
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 1,
      }),
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async (input: Parameters<ProviderApiClient["parse"]>[0]) => {
        parseInputs.push(input);
        return {
          providerId: "iqiyi",
          sourceId: "iqiyi:source",
          sourceUrl: "https://www.iqiyi.com/v_abc123.html",
          title: "爱奇艺视频",
          items: [],
        };
      },
    }),
  });

  await controller.parseBilibiliUrl({
    url: "https://www.iqiyi.com/v_abc123.html",
    proxy: false,
    shared: true,
  });

  assert.deepEqual(parseInputs, [
    {
      providerId: "iqiyi",
      roomCode: "ABC123",
      memberToken: "valid-member-token-123",
      url: "https://www.iqiyi.com/v_abc123.html",
      policy: { proxy: false, shared: false },
    },
  ]);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.providerPicker?.status, "ready");
  assert.equal(state.providerPicker?.shared, false);
});

test("keeps server-required generic proxy policy when sharing parsed playback", async () => {
  const { controller, recorder } = createJoinedHostController({
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 1,
      }),
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => ({
        providerId: "generic",
        sourceId: "generic:source",
        sourceUrl: "https://www.example.test/watch/1",
        title: "Generic Video",
        items: [
          {
            itemId: "default",
            title: "Generic Video",
            kind: "part",
            qualityLabel: "720P",
            sourceType: "m3u8",
            providerDescriptor: genericAutoProxyProviderPlaybackDescriptor,
          },
        ],
      }),
    }),
  });

  await controller.parseBilibiliUrl({
    url: "https://www.example.test/watch/1",
    proxy: false,
    shared: false,
  });

  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.providerPicker?.proxy, true);
  assert.equal(state.providerPicker?.shared, false);

  controller.shareSelectedProviderItem();

  const shared = recorder.sockets[0]?.sent.at(-1) as
    | {
        payload?: {
          video?: {
            provider?: ProviderPlaybackDescriptor;
          };
        };
      }
    | undefined;
  assert.deepEqual(shared?.payload?.video?.provider?.policy, {
    proxy: true,
    shared: false,
  });
});

test("shows generic unsupported URL guidance without Bilibili auth copy", async () => {
  const { controller } = createJoinedHostController({
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 1,
      }),
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => {
        throw new ProviderApiError(
          "provider_parse_failed",
          "Extractor request failed.",
          400,
          "extractor_unsupported_url",
        );
      },
    }),
  });

  await controller.parseBilibiliUrl({
    url: "https://haokan.baidu.com/v?vid=1",
    proxy: false,
    shared: false,
  });

  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.providerPicker?.status, "failed");
  assert.equal(state.providerPicker?.errorMessage, "暂不支持这个链接。");
  assert.doesNotMatch(state.providerPicker?.errorMessage ?? "", /Bilibili/);
  assert.match(state.diagnostics.at(-1) ?? "", /extractor_unsupported_url/);
});

test("shows generic auth-required guidance without Bilibili auth copy", async () => {
  const { controller } = createJoinedHostController({
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 1,
      }),
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async () => {
        throw new ProviderApiError(
          "provider_parse_failed",
          "Extractor request failed.",
          400,
          "extractor_auth_required",
        );
      },
    }),
  });

  await controller.parseBilibiliUrl({
    url: "https://www.youtube.com/watch?v=keOaQm6RpBg",
    proxy: false,
    shared: false,
  });

  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.providerPicker?.status, "failed");
  assert.match(state.providerPicker?.errorMessage ?? "", /Cookie/);
  assert.doesNotMatch(state.providerPicker?.errorMessage ?? "", /Bilibili/);
  assert.match(state.diagnostics.at(-1) ?? "", /extractor_auth_required/);
});

test("shares the selected Bilibili item with the final proxy and shared policy", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.setProviderPickerResults({
    items: [
      {
        itemId: "BV1xx411c7mD:cid-987654",
        title: "Part 1",
        kind: "part",
        qualityLabel: "1080P",
        sourceType: "mpd",
        providerDescriptor: providerPlaybackDescriptor,
      },
    ],
  });
  controller.setProviderPlaybackPolicy({ proxy: true, shared: false });
  controller.shareSelectedProviderItem();

  const shared = recorder.sockets[0]?.sent.at(-1);
  assert.deepEqual(shared, {
    type: "video:share",
    payload: {
      memberToken: "valid-member-token-123",
      video: {
        videoId: "BV1xx411c7mD",
        url: "https://www.bilibili.com/video/BV1xx411c7mD",
        title: "Bilibili video",
        provider: {
          ...providerPlaybackDescriptor,
          item: {
            ...providerPlaybackDescriptor.item,
            title: "Bilibili video",
          },
          policy: {
            proxy: true,
            shared: false,
          },
        },
      },
    },
  });
  assert.doesNotMatch(JSON.stringify(shared), /SESSDATA|Cookie/i);
});

test("shares provider videos with the parsed video title after selecting a part", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.setProviderPickerResults({
    message: "Anthropic史：从OpenAI叛逃者，到估值万亿的AI帝国",
    items: [
      {
        itemId: "BV1xx411c7mD:cid-987654",
        title: "anthropic_成片_白板版",
        kind: "part",
        qualityLabel: "360P",
        sourceType: "mp4",
        providerDescriptor: {
          ...providerPlaybackDescriptor,
          title: "Anthropic史：从OpenAI叛逃者，到估值万亿的AI帝国",
          item: {
            ...providerPlaybackDescriptor.item,
            title: "anthropic_成片_白板版",
          },
        },
      },
    ],
  });
  controller.shareSelectedProviderItem();

  const shared = recorder.sockets[0]?.sent.at(-1) as
    | { payload?: { video?: { title?: string } } }
    | undefined;
  assert.equal(
    shared?.payload?.video?.title,
    "Anthropic史：从OpenAI叛逃者，到估值万亿的AI帝国",
  );
});

test("shares the selected provider quality as the default playback candidate", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.setProviderPickerResults({
    items: [
      {
        itemId: "BV1xx411c7mD:cid-987654",
        title: "Part 1",
        kind: "part",
        qualityLabel: "1080P",
        sourceType: "mpd",
        providerDescriptor: multiQualityProviderPlaybackDescriptor,
      },
    ],
  });
  let state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(
    state.providerPicker?.selectedQualityCandidateId,
    "dash-avc-1080p",
  );

  controller.selectProviderQuality("dash-avc-720p");
  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(
    state.providerPicker?.selectedQualityCandidateId,
    "dash-avc-720p",
  );

  controller.shareSelectedProviderItem();

  const shared = recorder.sockets[0]?.sent.at(-1) as
    | {
        payload?: {
          video?: {
            provider?: ProviderPlaybackDescriptor;
          };
        };
      }
    | undefined;
  const provider = shared?.payload?.video?.provider;
  assert.equal(provider?.defaultCandidateId, "dash-avc-720p");
  assert.equal(
    provider?.candidates.find((candidate) => candidate.id === "dash-avc-720p")
      ?.default,
    true,
  );
  assert.equal(
    provider?.candidates.find((candidate) => candidate.id === "dash-avc-1080p")
      ?.default,
    false,
  );
});

test("does not share provider playback after the room socket disconnects", () => {
  const { controller, recorder } = createJoinedHostController();

  controller.setProviderPickerResults({
    items: [
      {
        itemId: "BV1xx411c7mD:cid-987654",
        title: "Part 1",
        kind: "part",
        qualityLabel: "1080P",
        sourceType: "mpd",
        providerDescriptor: multiQualityProviderPlaybackDescriptor,
      },
    ],
  });
  const socket = recorder.sockets[0];
  const sentCount = socket?.sent.length ?? 0;
  socket?.emit("close");

  assert.doesNotThrow(() => controller.shareSelectedProviderItem());
  assert.equal(socket?.sent.length, sentCount);
  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view === "joined") {
    assert.equal(state.connectionState, "disconnected");
    assert.match(
      state.diagnostics.at(-1) ?? "",
      /provider share denied: room disconnected/,
    );
  }
});

test("shares live provider playback with an initial playing state", () => {
  const recorder = createSocketRecorder();
  let now = 10_000;
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
    now: () => now,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );

  controller.setProviderPickerResults({
    items: [
      {
        itemId: "live-22889518",
        title: "Live room",
        kind: "live",
        qualityLabel: "720P",
        sourceType: "m3u8",
        providerDescriptor: {
          providerId: "bilibili",
          sourceId: "22889518",
          sourceUrl: "https://live.bilibili.com/22889518",
          title: "Live room",
          item: {
            itemId: "live-22889518",
            title: "Live room",
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
              qualityLabel: "720P",
              codecs: "avc",
              default: true,
            },
          ],
          defaultCandidateId: "hls-live",
        },
      },
    ],
  });
  now = 10_200;
  controller.shareSelectedProviderItem();

  const shared = recorder.sockets[0]?.sent.at(-1) as
    | {
        payload?: {
          playback?: {
            playState?: string;
            currentTime?: number;
            actorId?: string;
            updatedAt?: number;
            serverTime?: number;
          };
        };
      }
    | undefined;
  assert.equal(shared?.payload?.playback?.playState, "playing");
  assert.equal(shared?.payload?.playback?.currentTime, 0);
  assert.equal(shared?.payload?.playback?.actorId, "member-host");
  assert.equal(shared?.payload?.playback?.updatedAt, 10_200);
  assert.equal(shared?.payload?.playback?.serverTime, 10_200);
});

test("exposes playback sync context and sends playback updates", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "ws://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:state",
      payload: {
        roomCode: "ABC123",
        hostMemberId: "member-host",
        sharedVideo: {
          videoId: "BV1xx411c7mD",
          url: "https://www.bilibili.com/video/BV1xx411c7mD",
          title: "Part 1",
          provider: providerPlaybackDescriptor,
        },
        playback: null,
        members: [{ id: "member-host", name: "Alice" }],
      },
    }),
  );

  assert.deepEqual(controller.getPlaybackSyncContext(), {
    memberToken: "valid-member-token-123",
    actorId: "member-host",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
  });

  controller.sendPlaybackUpdate({
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

  assert.deepEqual(recorder.sockets[0]?.sent.at(-1), {
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

test("switches direct-link failures back to freshly parsed proxy playback", async () => {
  const parseInputs: Array<Parameters<ProviderApiClient["parse"]>[0]> = [];
  const { controller, recorder } = createJoinedHostController({
    providerApiClientFactory: () => ({
      startAuth: async () => ({
        providerId: "bilibili",
        method: "qr",
        flowId: "flow-1",
        status: "pending",
        expiresAt: 1,
      }),
      pollAuth: async () => ({ status: "pending" }),
      getAuthStatus: async () => ({ authorized: false, profile: null }),
      logoutAuth: async () => ({ loggedOut: true }),
      parse: async (input: Parameters<ProviderApiClient["parse"]>[0]) => {
        parseInputs.push(input);
        const proxy = input.policy.proxy;
        return {
          providerId: "bilibili",
          sourceId: "BV1xx411c7mD",
          sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
          title: "Bilibili video",
          items: [
            {
              itemId: "BV1xx411c7mD:cid-987654",
              title: "Part 1",
              kind: "part",
              qualityLabel: proxy ? "1080P Proxy" : "1080P Direct",
              sourceType: "mpd",
              providerDescriptor: {
                ...providerPlaybackDescriptor,
                policy: input.policy,
                candidates: [
                  {
                    id: proxy ? "proxy-1080p" : "direct-1080p",
                    sourceType: "mpd",
                    url: proxy
                      ? "https://syncroom.example.test/proxy/manifest/proxy.mpd"
                      : "https://upos.example.test/direct.mpd",
                    qualityLabel: proxy ? "1080P Proxy" : "1080P Direct",
                    default: true,
                  },
                ],
                defaultCandidateId: proxy ? "proxy-1080p" : "direct-1080p",
              },
            },
          ],
        };
      },
    }),
  });

  await controller.parseBilibiliUrl({
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    proxy: false,
    shared: true,
  });
  controller.showDirectPlaybackFailure({
    stage: "segment",
    message: "Direct link segment failed.",
  });
  let state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.deepEqual(state.playbackError, {
    code: "direct_playback_failed",
    stage: "segment",
    message: "Direct link segment failed.",
    canUseProxyFallback: true,
  });
  assert.match(state.diagnostics.at(-1) ?? "", /direct playback failed/);
  assert.match(state.diagnostics.at(-1) ?? "", /segment/);
  assert.match(state.diagnostics.at(-1) ?? "", /Direct link segment failed/);
  assert.deepEqual(recorder.sockets[0]?.sent.slice(-2), [
    {
      type: "playback:report",
      payload: {
        memberToken: "valid-member-token-123",
        event: "startup_failure",
        providerId: "bilibili",
        stage: "segment",
      },
    },
    {
      type: "playback:report",
      payload: {
        memberToken: "valid-member-token-123",
        event: "direct_link_failure",
        providerId: "bilibili",
      },
    },
  ]);

  await controller.retryProviderProxyFallback();
  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.deepEqual(
    parseInputs.map((input) => input.policy),
    [
      { proxy: false, shared: true },
      { proxy: true, shared: true },
    ],
  );
  assert.equal(state.providerPicker?.proxy, true);
  assert.equal(state.providerPicker?.shared, true);
  const shared = recorder.sockets[0]?.sent.at(-1);
  assert.equal((shared as { type?: string } | undefined)?.type, "video:share");
  const sharedProvider = (
    shared as {
      payload?: { video?: { provider?: ProviderPlaybackDescriptor } };
    }
  ).payload?.video?.provider;
  assert.deepEqual(sharedProvider?.policy, {
    proxy: true,
    shared: true,
  });
  assert.equal(
    sharedProvider?.candidates[0]?.url,
    "https://syncroom.example.test/proxy/manifest/proxy.mpd",
  );
  assert.deepEqual(
    recorder.sockets[0]?.sent.filter(
      (message) => (message as { type?: string }).type === "playback:report",
    ),
    [
      {
        type: "playback:report",
        payload: {
          memberToken: "valid-member-token-123",
          event: "startup_failure",
          providerId: "bilibili",
          stage: "segment",
        },
      },
      {
        type: "playback:report",
        payload: {
          memberToken: "valid-member-token-123",
          event: "direct_link_failure",
          providerId: "bilibili",
        },
      },
      {
        type: "playback:report",
        payload: {
          memberToken: "valid-member-token-123",
          event: "proxy_fallback",
          providerId: "bilibili",
        },
      },
    ],
  );
});

test("reports direct shared playback success when a source loads", () => {
  const { controller, recorder } = createJoinedHostController();

  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:state",
      payload: {
        roomCode: "ABC123",
        hostMemberId: "member-host",
        sharedVideo: {
          videoId: "BV1xx411c7mD",
          url: "https://www.bilibili.com/video/BV1xx411c7mD",
          title: "Part 1",
          provider: providerPlaybackDescriptor,
        },
        playback: null,
        members: [{ id: "member-host", name: "Alice" }],
      },
    }),
  );

  controller.reportPlaybackLoaded();

  assert.deepEqual(recorder.sockets[0]?.sent.at(-1), {
    type: "playback:report",
    payload: {
      memberToken: "valid-member-token-123",
      event: "direct_link_success",
      providerId: "bilibili",
    },
  });
});

test("clears direct playback failure after ten seconds", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { controller } = createJoinedHostController();

  controller.showDirectPlaybackFailure({
    stage: "decode",
    message: "Direct link decode failed.",
  });
  let state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.playbackError?.message, "Direct link decode failed.");

  t.mock.timers.tick(9_999);
  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.playbackError?.message, "Direct link decode failed.");

  t.mock.timers.tick(1);
  state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.playbackError, undefined);
});

test("applies room state and LiveKit voice messages after refresh rejoin", async () => {
  const storage = new MemoryStorage();
  const recorder = createSocketRecorder();
  const runtime = new FakeVoiceRuntime();
  storage.setItem(
    "syncroom:web-room-session",
    JSON.stringify({
      roomCode: "ABC123",
      joinToken: "valid-join-token-123",
      memberToken: "valid-member-token-123",
      displayName: "Alice",
      serverUrl: "wss://syncroom.example.test",
    }),
  );
  const controller = createWebRoomAppController({
    storage,
    socketFactory: recorder.factory,
    voiceRuntime: runtime,
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:joined",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        memberToken: "valid-member-token-123",
      },
    }),
  );
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:state",
      payload: {
        roomCode: "ABC123",
        hostMemberId: "member-host",
        sharedVideo: {
          videoId: "BV1xx411c7mD",
          url: "https://www.bilibili.com/video/BV1xx411c7mD",
          title: "Shared Video",
          provider: providerPlaybackDescriptor,
        },
        playback: {
          url: "https://www.bilibili.com/video/BV1xx411c7mD",
          currentTime: 57,
          playState: "playing",
          playbackRate: 1,
          updatedAt: 5_000,
          serverTime: 5_000,
          actorId: "member-host",
          seq: 3,
        },
        members: [
          { id: "member-host", name: "Alice" },
          { id: "member-guest", name: "Bob" },
        ],
      },
    }),
  );
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "voice:access-granted",
      payload: {
        livekitUrl: "wss://livekit.example.test",
        token: "voice-token",
        roomName: "syncroom-ABC123",
        participantIdentity: "member-host",
        expiresAt: 11_000,
      },
    }),
  );
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "voice:state",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        connected: true,
        muted: false,
        speaking: true,
      },
    }),
  );
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "error",
      payload: {
        code: "voice_token_failed",
        message: "Voice is unavailable.",
        messageType: "voice:access",
      },
    }),
  );
  await flushAsyncTasks();

  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(state.hostMemberId, "member-host");
  assert.equal(state.videoTitle, "Bilibili video");
  assert.deepEqual(state.playbackSource, {
    url: "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
    sourceType: "mpd",
    engine: "shaka",
    candidateId: "dash-avc-1080p",
  });
  assert.deepEqual(state.playback, {
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    currentTime: 57,
    playState: "playing",
    playbackRate: 1,
    updatedAt: 5_000,
    serverTime: 5_000,
    actorId: "member-host",
    seq: 3,
  });
  assert.deepEqual(state.members, [
    { id: "member-host", name: "Alice" },
    { id: "member-guest", name: "Bob" },
  ]);
  assert.ok(
    state.diagnostics.some((item) =>
      item.includes("voice:access-granted received"),
    ),
  );
  assert.ok(
    state.diagnostics.some((item) => item.includes("voice:state received")),
  );
  assert.equal(state.voice.status, "failed");
  assert.ok(
    state.diagnostics.some((item) =>
      item.includes("voice access rejected: voice_token_failed"),
    ),
  );

  controller.openProviderPicker();
  const pickerState = controller.getState();
  assert.equal(pickerState.view, "joined");
  if (pickerState.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.equal(pickerState.providerPicker?.open, true);
  assert.equal(
    pickerState.diagnostics.some((item) =>
      item.includes("provider auth denied: host only"),
    ),
    false,
  );
});

test("extracts the default provider candidate as the active Shaka playback source", () => {
  const recorder = createSocketRecorder();
  const controller = createWebRoomAppController({
    socketFactory: recorder.factory,
  });

  controller.createRoom({
    displayName: "Alice",
    serverUrl: "wss://syncroom.example.test",
  });
  recorder.sockets[0]?.emit("open");
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:created",
      payload: {
        roomCode: "ABC123",
        memberId: "member-host",
        joinToken: "valid-join-token-123",
        memberToken: "valid-member-token-123",
      },
    }),
  );
  recorder.sockets[0]?.emit(
    "message",
    JSON.stringify({
      type: "room:state",
      payload: {
        roomCode: "ABC123",
        sharedVideo: {
          videoId: "BV1xx411c7mD",
          url: "https://www.bilibili.com/video/BV1xx411c7mD",
          title: "Shared Video",
          provider: providerPlaybackDescriptor,
        },
        playback: null,
        members: [{ id: "member-host", name: "Alice" }],
      },
    }),
  );

  const state = controller.getState();
  assert.equal(state.view, "joined");
  if (state.view !== "joined") {
    throw new Error("Expected joined state.");
  }
  assert.deepEqual(state.playbackSource, {
    url: "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
    sourceType: "mpd",
    engine: "shaka",
    candidateId: "dash-avc-1080p",
  });
});
