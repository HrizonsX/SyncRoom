import assert from "node:assert/strict";
import test from "node:test";
import {
  choosePreferredPlaybackCandidate,
  createPlaybackStartupError,
  selectPlaybackAdapter,
} from "../src/playback-adapter.js";

test("selects Shaka for DASH and HLS and native video for MP4", () => {
  assert.equal(selectPlaybackAdapter({ sourceType: "mpd" }).engine, "shaka");
  assert.equal(selectPlaybackAdapter({ sourceType: "m3u8" }).engine, "shaka");
  assert.equal(selectPlaybackAdapter({ sourceType: "mp4" }).engine, "native");
});

test("rejects FLV sources in the first release", () => {
  assert.throws(
    () => selectPlaybackAdapter({ sourceType: "flv" }),
    /unsupported_source/,
  );
});

test("prefers H264 AVC compatible candidates over HEVC", () => {
  const selected = choosePreferredPlaybackCandidate([
    {
      id: "hevc",
      sourceType: "mpd",
      url: "https://syncroom.example.test/hevc.mpd",
      codecs: "hev1.1.6.L120.90",
      qualityLabel: "1080P HEVC",
    },
    {
      id: "avc",
      sourceType: "mpd",
      url: "https://syncroom.example.test/avc.mpd",
      codecs: "avc1.640028,mp4a.40.2",
      qualityLabel: "1080P",
    },
  ]);

  assert.equal(selected?.id, "avc");
});

test("keeps explicit default candidate when it is browser compatible", () => {
  const selected = choosePreferredPlaybackCandidate([
    {
      id: "mp4-default",
      sourceType: "mp4",
      url: "https://syncroom.example.test/video.mp4",
      default: true,
    },
    {
      id: "avc",
      sourceType: "mpd",
      url: "https://syncroom.example.test/avc.mpd",
      codecs: "avc1.640028",
    },
  ]);

  assert.equal(selected?.id, "mp4-default");
});

test("does not honor HEVC defaults that use plain codec names", () => {
  const selected = choosePreferredPlaybackCandidate([
    {
      id: "hevc-default",
      sourceType: "m3u8",
      url: "https://syncroom.example.test/hevc.m3u8",
      codecs: "hevc",
      default: true,
    },
    {
      id: "avc",
      sourceType: "m3u8",
      url: "https://syncroom.example.test/avc.m3u8",
      codecs: "avc",
    },
  ]);

  assert.equal(selected?.id, "avc");
});

test("does not honor AV1 defaults when AVC is available", () => {
  const selected = choosePreferredPlaybackCandidate([
    {
      id: "av1-default",
      sourceType: "m3u8",
      url: "https://syncroom.example.test/av1.m3u8",
      codecs: "av01.0.08M.08",
      default: true,
    },
    {
      id: "avc",
      sourceType: "m3u8",
      url: "https://syncroom.example.test/avc.m3u8",
      codecs: "avc1.640028,mp4a.40.2",
    },
  ]);

  assert.equal(selected?.id, "avc");
});

test("creates coarse playback startup errors for reporting", () => {
  assert.deepEqual(createPlaybackStartupError("decode", "HEVC not supported"), {
    code: "unsupported_source",
    stage: "decode",
    message: "HEVC not supported",
  });
  assert.deepEqual(createPlaybackStartupError("manifest", "bad manifest"), {
    code: "direct_playback_failed",
    stage: "manifest",
    message: "bad manifest",
  });
  assert.deepEqual(createPlaybackStartupError("network", "offline"), {
    code: "direct_playback_failed",
    stage: "network",
    message: "offline",
  });
  assert.deepEqual(createPlaybackStartupError("segment", "404"), {
    code: "direct_playback_failed",
    stage: "segment",
    message: "404",
  });
});
