import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canReusePlaybackVideoElement,
  getPlaybackVideoReuseKey,
  preservePlaybackVideoElement,
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

class FakePlaybackVideoElement {
  private readonly attributeMap = new Map<string, string>();
  replacedWith?: unknown;

  constructor(attributes: Record<string, string>) {
    for (const [name, value] of Object.entries(attributes)) {
      this.attributeMap.set(name, value);
    }
  }

  get attributes(): Array<{ name: string; value: string }> {
    return Array.from(this.attributeMap.entries()).map(([name, value]) => ({
      name,
      value,
    }));
  }

  getAttribute(name: string): string | null {
    return this.attributeMap.get(name) ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attributeMap.has(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributeMap.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributeMap.delete(name);
  }

  replaceWith(value: unknown): void {
    this.replacedWith = value;
  }
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

  it("does not reuse when candidate identity changes", () => {
    const existing = elementWithAttributes({
      "data-source-url": "http://localhost:8787/proxy/manifest/1",
      "data-source-type": "m3u8",
      "data-playback-engine": "shaka",
      "data-source-candidate-id": "hls-avc-720p",
    });
    const next = elementWithAttributes({
      "data-source-url": "http://localhost:8787/proxy/manifest/1",
      "data-source-type": "m3u8",
      "data-playback-engine": "shaka",
      "data-source-candidate-id": "hls-avc-1080p",
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

  it("keeps the runtime video src when reusing the same playback source", () => {
    const sourceAttributes = {
      "data-source-url": "http://localhost:8787/proxy/segment/1",
      "data-source-type": "mp4",
      "data-playback-engine": "native",
    };
    const existing = new FakePlaybackVideoElement({
      ...sourceAttributes,
      src: "http://localhost:8787/proxy/segment/1",
      preload: "metadata",
    });
    const next = new FakePlaybackVideoElement({
      ...sourceAttributes,
      preload: "metadata",
      playsinline: "",
    });
    const root = {
      querySelector() {
        return next;
      },
    };

    preservePlaybackVideoElement(
      root as unknown as ParentNode,
      existing as unknown as HTMLVideoElement,
    );

    assert.equal(
      existing.getAttribute("src"),
      "http://localhost:8787/proxy/segment/1",
    );
    assert.equal(existing.replacedWith, undefined);
    assert.equal(next.replacedWith, existing);
  });
});
