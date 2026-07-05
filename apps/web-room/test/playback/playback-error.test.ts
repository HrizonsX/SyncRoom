import assert from "node:assert/strict";
import test from "node:test";
import {
  getPlaybackErrorMessage,
  getPlaybackErrorStage,
} from "../../src/playback/playback-error.js";

test("converts verbose Shaka manifest errors to safe user-facing text", () => {
  const stage = getPlaybackErrorStage({
    toString: () =>
      'shaka.util.Error { "code": 1002, "data": [ "https://syncroom.example.test/proxy/manifest.mpd" ], "stack": "Error: Shaka Error 1002" }',
  });
  const message = getPlaybackErrorMessage(stage);

  assert.equal(stage, "manifest");
  assert.match(message, /播放清单加载失败/);
  assert.doesNotMatch(message, /syncroom\.example\.test|stack|Shaka Error/);
});

test("maps playback startup errors to stable stages", () => {
  assert.equal(getPlaybackErrorStage(new Error("HTTP 404 segment")), "segment");
  assert.equal(
    getPlaybackErrorStage(new Error("network fetch failed")),
    "network",
  );
  assert.equal(
    getPlaybackErrorStage(new Error("codec decode failed")),
    "decode",
  );
  assert.equal(
    getPlaybackErrorStage(new Error("unexpected player error")),
    "unknown",
  );
});
