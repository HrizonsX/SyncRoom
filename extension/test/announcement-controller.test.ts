import assert from "node:assert/strict";
import test from "node:test";
import type { AnnouncementState } from "@syncroom/protocol";
import {
  createAnnouncementController,
  toAnnouncementsApiUrl,
} from "../src/background/announcement-controller";
import { createBackgroundRuntimeState } from "../src/background/runtime-state";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function createAnnouncementState(id: string): AnnouncementState {
  return {
    version: 1,
    updatedAt: 1_710_000_000_000,
    items: [{ id, text: `${id} notice` }],
  };
}

function createAnnouncementResponse(state: AnnouncementState): Response {
  return {
    ok: true,
    async json() {
      return { ok: true, data: state };
    },
  } as Response;
}

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
    "syncroom-announcements": cachedState,
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
  assert.deepEqual(localBucket["syncroom-announcements"], serverState);
  assert.equal(notifyAllCalls, 2);
});

test("announcement refresh starts a new request when the server URL changes while a previous request is in flight", async () => {
  const localBucket = installChromeLocalStorage();
  const runtimeState = createBackgroundRuntimeState();
  const oldServerState = createAnnouncementState("old-server");
  const newServerState = createAnnouncementState("new-server");
  const fetchResponses = new Map<
    string,
    ReturnType<typeof createDeferred<Response>>
  >();
  const fetchUrls: string[] = [];
  const logs: string[] = [];
  let notifyAllCalls = 0;
  let serverUrl = "ws://old.example.test/ws";

  const controller = createAnnouncementController({
    announcementState: runtimeState.announcements,
    getServerUrl: () => serverUrl,
    fetchImpl: async (input) => {
      const url = String(input);
      fetchUrls.push(url);
      const deferred = createDeferred<Response>();
      fetchResponses.set(url, deferred);
      return deferred.promise;
    },
    log(_scope, message) {
      logs.push(message);
    },
    notifyAll() {
      notifyAllCalls += 1;
    },
  });

  const oldRefresh = controller.refreshAnnouncements();
  assert.deepEqual(fetchUrls, ["http://old.example.test/api/announcements"]);

  serverUrl = "ws://new.example.test/ws";
  const newRefresh = controller.refreshAnnouncements();
  assert.deepEqual(fetchUrls, [
    "http://old.example.test/api/announcements",
    "http://new.example.test/api/announcements",
  ]);

  fetchResponses
    .get("http://new.example.test/api/announcements")
    ?.resolve(createAnnouncementResponse(newServerState));
  await newRefresh;

  assert.deepEqual(runtimeState.announcements.current, newServerState);
  assert.equal(localBucket["syncroom-announcements"], newServerState);
  assert.equal(notifyAllCalls, 1);

  fetchResponses
    .get("http://old.example.test/api/announcements")
    ?.resolve(createAnnouncementResponse(oldServerState));
  await oldRefresh;

  assert.deepEqual(runtimeState.announcements.current, newServerState);
  assert.equal(localBucket["syncroom-announcements"], newServerState);
  assert.equal(notifyAllCalls, 1);
  assert.ok(logs.includes("Ignored stale announcement refresh result."));
});

test("announcement API URL conversion keeps the HTTP fetch separate from the WebSocket path", () => {
  assert.equal(
    toAnnouncementsApiUrl("wss://sync.example.com/socket"),
    "https://sync.example.com/api/announcements",
  );
  assert.equal(toAnnouncementsApiUrl("http://localhost:8787"), null);
});
