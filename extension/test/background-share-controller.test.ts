import assert from "node:assert/strict";
import test from "node:test";
import { PROTOCOL_VERSION } from "@syncroom/protocol";
import { createBackgroundRuntimeState } from "../src/background/runtime-state";
import { createShareController } from "../src/background/share-controller";

function installSelfStub() {
  const originalSelf = globalThis.self;
  Object.assign(globalThis, {
    self: {
      setTimeout,
      clearTimeout,
    },
  });

  return {
    restore() {
      Object.assign(globalThis, { self: originalSelf });
    },
  };
}

function createControllerHarness() {
  const runtimeState = createBackgroundRuntimeState();
  const sendToServerCalls: Array<unknown> = [];
  const rememberedSharedTabs: Array<{
    tabId?: number;
    videoUrl?: string | null;
  }> = [];
  let notifyAllCalls = 0;

  const controller = createShareController({
    connectionState: runtimeState.connection,
    roomSessionState: runtimeState.room,
    shareState: runtimeState.share,
    log: () => {},
    sendToServer: (message) => {
      sendToServerCalls.push(message);
    },
    connect: async () => {
      runtimeState.connection.connected = true;
    },
    persistState: async () => {},
    notifyAll: () => {
      notifyAllCalls += 1;
    },
    rememberSharedSourceTab: (tabId, videoUrl) => {
      rememberedSharedTabs.push({ tabId, videoUrl });
    },
  });

  return {
    runtimeState,
    controller,
    sendToServerCalls,
    rememberedSharedTabs,
    get notifyAllCalls() {
      return notifyAllCalls;
    },
  };
}

function installChromeTabsStub(args: {
  activeTabUrl: string;
  response: unknown;
}) {
  const originalChrome = globalThis.chrome;
  Object.assign(globalThis, {
    chrome: {
      tabs: {
        query: async () => [{ id: 321, url: args.activeTabUrl }],
        sendMessage: async () => args.response,
      },
    },
  });

  return {
    restore() {
      Object.assign(globalThis, { chrome: originalChrome });
    },
  };
}

test("background share controller forwards a share without playback when content omits stale snapshot", async () => {
  const selfHarness = installSelfStub();
  const harness = createControllerHarness();
  harness.runtimeState.connection.connected = true;
  harness.runtimeState.room.roomCode = "ROOM01";
  harness.runtimeState.room.memberToken = "member-token-1";
  harness.runtimeState.room.memberId = "member-1";

  try {
    await harness.controller.queueOrSendSharedVideo(
      {
        video: {
          videoId: "BV199W9zEEcH",
          url: "https://www.bilibili.com/video/BV199W9zEEcH",
          title: "New Video",
        },
        playback: null,
      },
      123,
    );

    assert.deepEqual(harness.rememberedSharedTabs, [
      {
        tabId: 123,
        videoUrl: "https://www.bilibili.com/video/BV199W9zEEcH",
      },
    ]);
    assert.deepEqual(harness.sendToServerCalls, [
      {
        type: "video:share",
        payload: {
          memberToken: "member-token-1",
          video: {
            videoId: "BV199W9zEEcH",
            url: "https://www.bilibili.com/video/BV199W9zEEcH",
            title: "New Video",
          },
        },
      },
    ]);
    assert.equal(harness.notifyAllCalls, 0);
  } finally {
    selfHarness.restore();
  }
});

test("background share controller sends create request with protocolVersion when sharing outside a room", async () => {
  const selfHarness = installSelfStub();
  const harness = createControllerHarness();
  harness.runtimeState.connection.connected = true;
  harness.runtimeState.room.displayName = "Alice";

  try {
    await harness.controller.queueOrSendSharedVideo(
      {
        video: {
          videoId: "BV199W9zEEcH",
          url: "https://www.bilibili.com/video/BV199W9zEEcH",
          title: "New Video",
        },
        playback: null,
      },
      123,
    );

    assert.deepEqual(harness.sendToServerCalls, [
      {
        type: "room:create",
        payload: {
          displayName: "Alice",
          protocolVersion: PROTOCOL_VERSION,
        },
      },
    ]);
    assert.equal(harness.runtimeState.room.pendingCreateRoom, false);
  } finally {
    selfHarness.restore();
  }
});

test("background share controller accepts generic html5 active video payloads", async () => {
  const harness = createControllerHarness();
  const chromeHarness = installChromeTabsStub({
    activeTabUrl: "https://example.com/watch?v=abc",
    response: {
      ok: true,
      payload: {
        video: {
          videoId: "web:0123456789abcdef",
          url: "https://example.com/watch?v=abc",
          title: "Example Video",
        },
        playback: null,
      },
    },
  });

  try {
    const result = await harness.controller.getActiveVideoPayload();

    assert.equal(result.ok, true);
    assert.equal(result.tabId, 321);
    assert.equal(result.payload?.video.title, "Example Video");
    assert.equal(result.error, undefined);
  } finally {
    chromeHarness.restore();
  }
});
