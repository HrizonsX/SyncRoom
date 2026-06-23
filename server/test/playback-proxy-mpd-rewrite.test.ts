import assert from "node:assert/strict";
import test from "node:test";
import { createPlaybackProxyService } from "../src/playback-proxy/service.js";

test("rewrites MPD media resources to SyncRoom proxy segment URLs", async () => {
  const ids = ["manifest-1.mpd", "segment-video", "segment-audio"];
  const service = createPlaybackProxyService({
    publicBaseUrl: "https://syncroom.example.test",
    createResourceId: () => ids.shift() ?? "extra-id",
    now: () => 1_000,
    defaultTtlMs: 60_000,
  });

  const registered = service.registerMpdManifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://upos.example.test/dash/master.mpd",
    manifest: `<?xml version="1.0" encoding="UTF-8"?>
<MPD type="static" mediaPresentationDuration="PT60S">
  <Period>
    <AdaptationSet mimeType="video/mp4" codecs="hev1.1.6.L120.90">
      <Representation id="video-1080p" bandwidth="5000000" width="1920" height="1080">
        <BaseURL>https://upos.example.test/video/</BaseURL>
        <SegmentTemplate initialization="init.mp4" media="seg-$Number$.m4s" startNumber="1" />
      </Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" codecs="mp4a.40.2">
      <Representation id="audio" bandwidth="128000">
        <BaseURL>https://upos.example.test/audio/</BaseURL>
        <SegmentTemplate initialization="audio-init.mp4" media="audio-$Number$.m4s" startNumber="1" />
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`,
  });

  assert.deepEqual(registered, {
    manifestId: "manifest-1.mpd",
    manifestUrl: "https://syncroom.example.test/proxy/manifest/manifest-1.mpd",
    expiresAt: 61_000,
  });

  const manifestResource = await service.resolveResource({
    kind: "manifest",
    resourceId: "manifest-1.mpd",
    headers: {},
  });
  assert.ok(manifestResource);
  assert.equal(manifestResource.contentType, "application/dash+xml");
  const rewritten = manifestResource.body.toString();

  assert.match(rewritten, /bandwidth="5000000"/);
  assert.match(rewritten, /mimeType="audio\/mp4"/);
  assert.match(rewritten, /codecs="hev1\.1\.6\.L120\.90"/);
  assert.match(
    rewritten,
    /https:\/\/syncroom\.example\.test\/proxy\/segment\/segment-video\//,
  );
  assert.match(
    rewritten,
    /https:\/\/syncroom\.example\.test\/proxy\/segment\/segment-audio\//,
  );
  assert.doesNotMatch(rewritten, /upos\.example\.test/);
});
