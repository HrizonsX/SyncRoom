import assert from "node:assert/strict";
import test from "node:test";
import { createTabController } from "../src/background/tab-controller";
import { normalizeSharedVideoUrl } from "../src/shared/url";

type CreatedTab = { url?: string; active?: boolean };

function createHarness(sharedVideo: unknown) {
  const createdTabs: CreatedTab[] = [];
  const updatedTabs: CreatedTab[] = [];
  const chromeMock = {
    tabs: {
      async query() {
        return [];
      },
      async create(input: CreatedTab) {
        createdTabs.push(input);
        return { id: 42, ...input };
      },
      async update(_tabId: number, input: CreatedTab) {
        updatedTabs.push(input);
        return { id: 42, ...input };
      },
      async get() {
        throw new Error("missing tab");
      },
    },
  };
  (globalThis as typeof globalThis & { chrome: typeof chromeMock }).chrome =
    chromeMock;

  const roomSessionState = {
    roomState: {
      sharedVideo,
    },
  };
  const shareState = {
    sharedTabId: null,
    lastOpenedSharedUrl: null,
    openingSharedUrl: null,
  };

  const controller = createTabController({
    roomSessionState: roomSessionState as never,
    shareState,
    normalizeUrl: normalizeSharedVideoUrl,
    supportedVideoUrlPatterns: ["http://*/*", "https://*/*"],
    log: () => undefined,
  });

  return { controller, createdTabs, updatedTabs };
}

function createProviderDescriptor() {
  return {
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
      shared: true,
    },
    candidates: [
      {
        id: "dash-avc-1080p",
        sourceType: "mpd",
        url: "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
        default: true,
      },
    ],
    defaultCandidateId: "dash-avc-1080p",
  };
}

test("does not open a provider playable video when the shared page URL is not openable", async () => {
  const { controller, createdTabs, updatedTabs } = createHarness({
    videoId: "web:abc123",
    url: "chrome-extension://local-only/video",
    title: "Not a page URL",
    provider: createProviderDescriptor(),
  });

  await controller.openSharedVideoFromPopup();

  assert.equal(createdTabs.length, 0);
  assert.equal(updatedTabs.length, 0);
});

test("opens a provider shared video by its page URL when the page is openable", async () => {
  const { controller, createdTabs } = createHarness({
    videoId: "BV1xx411c7mD",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    title: "Bilibili video",
    provider: createProviderDescriptor(),
  });

  await controller.openSharedVideoFromPopup();

  assert.deepEqual(createdTabs, [
    {
      url: "https://www.bilibili.com/video/BV1xx411c7mD",
      active: true,
    },
  ]);
});
