import assert from "node:assert/strict";
import test from "node:test";
import { createPlaybackProxyService } from "../src/playback-proxy/service.js";

test("rewrites m3u8 media resources to SyncRoom proxy segment URLs", async () => {
  const ids = ["live.m3u8", "key-1", "init-1", "segment-1", "segment-2"];
  const service = createPlaybackProxyService({
    publicBaseUrl: "https://syncroom.example.test",
    createResourceId: () => ids.shift() ?? "extra-id",
    now: () => 2_000,
    defaultTtlMs: 30_000,
  });

  const registered = service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://live.example.test/hls/live.m3u8",
    manifest: `#EXTM3U
#EXT-X-VERSION:7
#EXT-X-TARGETDURATION:4
#EXT-X-KEY:METHOD=AES-128,URI="https://live.example.test/hls/key.key"
#EXT-X-MAP:URI="init.mp4"
#EXTINF:4.000,
segment-1.ts
#EXTINF:4.000,
https://live.example.test/hls/segment-2.ts
#EXT-X-ENDLIST
`,
  });

  assert.deepEqual(registered, {
    manifestId: "live.m3u8",
    manifestUrl: "https://syncroom.example.test/proxy/manifest/live.m3u8",
    expiresAt: 32_000,
  });

  const manifestResource = await service.resolveResource({
    kind: "manifest",
    resourceId: "live.m3u8",
    headers: {},
  });
  assert.ok(manifestResource);
  assert.equal(manifestResource.contentType, "application/vnd.apple.mpegurl");
  const rewritten = manifestResource.body.toString();

  assert.match(rewritten, /#EXT-X-TARGETDURATION:4/);
  assert.match(rewritten, /#EXTINF:4\.000,/);
  assert.match(
    rewritten,
    /URI="https:\/\/syncroom\.example\.test\/proxy\/segment\/key-1"/,
  );
  assert.match(
    rewritten,
    /URI="https:\/\/syncroom\.example\.test\/proxy\/segment\/init-1"/,
  );
  assert.match(
    rewritten,
    /https:\/\/syncroom\.example\.test\/proxy\/segment\/segment-1/,
  );
  assert.match(
    rewritten,
    /https:\/\/syncroom\.example\.test\/proxy\/segment\/segment-2/,
  );
  assert.doesNotMatch(rewritten, /live\.example\.test/);
});

test("refreshes live m3u8 manifests when the proxied manifest is requested again", async () => {
  const ids = ["live.m3u8", "segment-1", "segment-2", "segment-3"];
  const upstreamManifests = [
    `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:101
#EXTINF:4.000,
segment-101.ts
`,
    `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:102
#EXTINF:4.000,
segment-102.ts
`,
  ];
  const upstreamRequests: string[] = [];
  const service = createPlaybackProxyService({
    publicBaseUrl: "https://syncroom.example.test",
    createResourceId: () => ids.shift() ?? "extra-id",
    now: () => 2_000,
    defaultTtlMs: 30_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async (url) => {
      upstreamRequests.push(String(url));
      return new Response(upstreamManifests.shift() ?? "", {
        status: 200,
        headers: { "content-type": "application/vnd.apple.mpegurl" },
      });
    },
  });

  service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://live.example.test/hls/live.m3u8",
    manifest: `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:4
#EXT-X-MEDIA-SEQUENCE:100
#EXTINF:4.000,
segment-100.ts
`,
  });

  const firstManifest = await service.resolveResource({
    kind: "manifest",
    resourceId: "live.m3u8",
    headers: {},
  });
  const secondManifest = await service.resolveResource({
    kind: "manifest",
    resourceId: "live.m3u8",
    headers: {},
  });

  assert.match(firstManifest?.body.toString() ?? "", /MEDIA-SEQUENCE:101/);
  assert.match(secondManifest?.body.toString() ?? "", /MEDIA-SEQUENCE:102/);
  assert.deepEqual(upstreamRequests, [
    "https://live.example.test/hls/live.m3u8",
    "https://live.example.test/hls/live.m3u8",
  ]);
});
