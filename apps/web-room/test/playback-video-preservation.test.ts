import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canReusePlaybackVideoElement,
  getPlaybackVideoReuseKey,
  type PlaybackVideoIdentityElement,
} from "../src/playback-video-preservation.js";

function elementWithAttributes(
  attributes: Record<string, string>,
): PlaybackVideoIdentityElement {
  return {
    getAttribute(name: string) {
      return attributes[name] ?? null;
    },
  };
}

describe("playback video preservation", () => {
  it("builds a reuse key from playback source identity", () => {
    assert.equal(
      getPlaybackVideoReuseKey(
        elementWithAttributes({
          "data-source-url": "http://localhost:8787/proxy/manifest/1",
          "data-source-type": "mpd",
          "data-playback-engine": "shaka",
        }),
      ),
      "http://localhost:8787/proxy/manifest/1\nmpd\nshaka",
    );
  });

  it("does not reuse when source identity changes", () => {
    const existing = elementWithAttributes({
      "data-source-url": "http://localhost:8787/proxy/manifest/1",
      "data-source-type": "mpd",
      "data-playback-engine": "shaka",
    });
    const next = elementWithAttributes({
      "data-source-url": "http://localhost:8787/proxy/manifest/2",
      "data-source-type": "mpd",
      "data-playback-engine": "shaka",
    });

    assert.equal(canReusePlaybackVideoElement(existing, next), false);
  });

  it("reuses when source identity is unchanged", () => {
    const existing = elementWithAttributes({
      "data-source-url": "http://localhost:8787/proxy/manifest/1",
      "data-source-type": "mpd",
      "data-playback-engine": "shaka",
    });
    const next = elementWithAttributes({
      "data-source-url": "http://localhost:8787/proxy/manifest/1",
      "data-source-type": "mpd",
      "data-playback-engine": "shaka",
    });

    assert.equal(canReusePlaybackVideoElement(existing, next), true);
  });
});
