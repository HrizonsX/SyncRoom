import assert from "node:assert/strict";
import test from "node:test";
import type { AnnouncementState } from "@bili-syncplay/protocol";
import {
  createAnnouncementController,
  toAnnouncementsApiUrl,
} from "../src/background/announcement-controller";
import { createBackgroundRuntimeState } from "../src/background/runtime-state";

function installChromeLocalStorage(initial: Record<string, unknown> = {}) {
  const localBucket: Record<string, unknown> = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        async get<K extends string>(key: K): Promise<Record<K, unknown>> {
          return { [key]: localBucket[key] };
        },
        async set(values: Record<string, unknown>): Promise<void> {
          Object.assign(localBucket, values);
        },
      },
    },
  } as typeof chrome;

  return localBucket;
}

test("announcement controller loads cached storage and refreshes from the announcement API once", async () => {
  const cachedState: AnnouncementState = {
    version: 2,
    updatedAt: 1_710_000_000_000,
    items: [{ id: "cached", text: "Cached notice" }],
  };
  const serverState: AnnouncementState = {
    version: 3,
    updatedAt: 1_710_000_010_000,
    items: [{ id: "server", text: "Fresh notice" }],
  };
  const localBucket = installChromeLocalStorage({
    "bili-syncplay-announcements": cachedState,
  });
  const runtimeState = createBackgroundRuntimeState();
  const fetchUrls: string[] = [];
  let notifyAllCalls = 0;

  const controller = createAnnouncementController({
    announcementState: runtimeState.announcements,
    getServerUrl: () => "ws://localhost:8787/ws",
    fetchImpl: async (input) => {
      fetchUrls.push(String(input));
      return {
        ok: true,
        async json() {
          return { ok: true, data: serverState };
        },
      } as Response;
    },
    log() {},
    notifyAll() {
      notifyAllCalls += 1;
    },
  });

  await controller.loadCachedAnnouncements();
  assert.deepEqual(runtimeState.announcements.current, cachedState);

  const firstRefresh = controller.refreshAnnouncements();
  const duplicateRefresh = controller.refreshAnnouncements();
  await Promise.all([firstRefresh, duplicateRefresh]);

  assert.deepEqual(fetchUrls, ["http://localhost:8787/api/announcements"]);
  assert.deepEqual(runtimeState.announcements.current, serverState);
  assert.deepEqual(localBucket["bili-syncplay-announcements"], serverState);
  assert.equal(notifyAllCalls, 2);
});

test("announcement API URL conversion keeps the HTTP fetch separate from the WebSocket path", () => {
  assert.equal(
    toAnnouncementsApiUrl("wss://sync.example.com/socket"),
    "https://sync.example.com/api/announcements",
  );
  assert.equal(toAnnouncementsApiUrl("http://localhost:8787"), null);
});
