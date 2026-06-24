import assert from "node:assert/strict";
import test from "node:test";
import { createPlaybackProxyService } from "../src/playback-proxy/service.js";

test("playback proxy expires manifest and segment mappings by TTL", async () => {
  let now = 1_000;
  let fetchCount = 0;
  const ids = ["live.m3u8", "segment-1"];
  const service = createPlaybackProxyService({
    createResourceId: () => ids.shift() ?? "extra-id",
    now: () => now,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async () => {
      fetchCount += 1;
      return new Response("segment");
    },
  });
  service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    ttlMs: 100,
    manifestUrl: "https://cdn.example.test/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
segment.ts
#EXT-X-ENDLIST
`,
  });

  assert.ok(
    await service.resolveResource({
      kind: "manifest",
      resourceId: "live.m3u8",
      headers: {},
    }),
  );
  assert.ok(
    await service.resolveResource({
      kind: "segment",
      resourceId: "segment-1",
      headers: {},
    }),
  );
  assert.equal(fetchCount, 1);

  now = 1_101;
  assert.equal(service.cleanupExpired(), 2);
  assert.equal(
    await service.resolveResource({
      kind: "manifest",
      resourceId: "live.m3u8",
      headers: {},
    }),
    null,
  );
  assert.equal(
    await service.resolveResource({
      kind: "segment",
      resourceId: "segment-1",
      headers: {},
    }),
    null,
  );
  assert.equal(fetchCount, 1);
});

test("playback proxy extends resource TTL on active access", async () => {
  let now = 1_000;
  const ids = ["live.m3u8", "segment-1"];
  const service = createPlaybackProxyService({
    createResourceId: () => ids.shift() ?? "extra-id",
    now: () => now,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async () => new Response("segment"),
  });
  service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    ttlMs: 100,
    manifestUrl: "https://cdn.example.test/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
segment.ts
#EXT-X-ENDLIST
`,
  });

  now = 1_050;
  assert.ok(
    await service.resolveResource({
      kind: "manifest",
      resourceId: "live.m3u8",
      headers: {},
    }),
  );
  assert.ok(
    await service.resolveResource({
      kind: "segment",
      resourceId: "segment-1",
      headers: {},
    }),
  );

  now = 1_120;
  assert.equal(service.cleanupExpired(), 0);
  assert.ok(
    await service.resolveResource({
      kind: "manifest",
      resourceId: "live.m3u8",
      headers: {},
    }),
  );
  assert.ok(
    await service.resolveResource({
      kind: "segment",
      resourceId: "segment-1",
      headers: {},
    }),
  );

  now = 1_221;
  assert.equal(service.cleanupExpired(), 2);
});

test("playback proxy clears resources by room and provider auth lifecycle", async () => {
  const ids = [
    "room-a.m3u8",
    "room-a-segment",
    "room-b.m3u8",
    "room-b-segment",
  ];
  const service = createPlaybackProxyService({
    createResourceId: () => ids.shift() ?? "extra-id",
  });
  service.registerM3u8Manifest({
    roomCode: "ROOMA1",
    providerId: "bilibili",
    manifestUrl: "https://cdn-a.example.test/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
segment-a.ts
#EXT-X-ENDLIST
`,
  });
  service.registerM3u8Manifest({
    roomCode: "ROOMB2",
    providerId: "bilibili",
    manifestUrl: "https://cdn-b.example.test/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
segment-b.ts
#EXT-X-ENDLIST
`,
  });

  assert.equal(service.clearRoom("ROOMA1"), 2);
  assert.equal(
    await service.resolveResource({
      kind: "manifest",
      resourceId: "room-a.m3u8",
      headers: {},
    }),
    null,
  );
  assert.ok(
    await service.resolveResource({
      kind: "manifest",
      resourceId: "room-b.m3u8",
      headers: {},
    }),
  );

  assert.equal(service.clearProviderAuth("ROOMB2", "bilibili"), 2);
  assert.equal(
    await service.resolveResource({
      kind: "manifest",
      resourceId: "room-b.m3u8",
      headers: {},
    }),
    null,
  );
});
