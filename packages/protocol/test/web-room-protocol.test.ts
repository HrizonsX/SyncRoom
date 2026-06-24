import assert from "node:assert/strict";
import test from "node:test";
import {
  isClientMessage,
  isProviderPlaybackDescriptor,
  isServerMessage,
} from "../src/index.js";

const VALID_TOKEN = "valid-member-token-123";

const validProviderPlaybackDescriptor = {
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
      qualityLabel: "1080P",
      codecs: "avc1.640028,mp4a.40.2",
      default: true,
    },
    {
      id: "hls-live",
      sourceType: "m3u8",
      url: "https://syncroom.example.test/proxy/manifest/live.m3u8",
      qualityLabel: "Live",
    },
  ],
  defaultCandidateId: "dash-avc-1080p",
};

test("accepts a valid provider playback descriptor", () => {
  assert.equal(
    isProviderPlaybackDescriptor(validProviderPlaybackDescriptor),
    true,
  );
});

test("accepts a generic provider playback descriptor", () => {
  assert.equal(
    isProviderPlaybackDescriptor({
      ...validProviderPlaybackDescriptor,
      providerId: "generic",
      sourceId: "https://example.com/watch/123",
      sourceUrl: "https://example.com/watch/123",
      title: "Generic video",
      item: {
        itemId: "default",
        title: "Generic video",
        kind: "part",
      },
      policy: {
        proxy: true,
        shared: false,
      },
      candidates: [
        {
          id: "hls",
          sourceType: "m3u8",
          url: "https://cdn.example.com/video/index.m3u8",
          qualityLabel: "HLS",
          default: true,
        },
      ],
      defaultCandidateId: "hls",
    }),
    true,
  );
});

test("accepts an iQIYI provider playback descriptor", () => {
  assert.equal(
    isProviderPlaybackDescriptor({
      ...validProviderPlaybackDescriptor,
      providerId: "iqiyi",
      sourceId: "iqiyi:123",
      sourceUrl: "https://www.iqiyi.com/v_123.html",
      title: "iQIYI video",
    }),
    true,
  );
});

test("rejects provider playback descriptors with unsupported provider or source type", () => {
  assert.equal(
    isProviderPlaybackDescriptor({
      ...validProviderPlaybackDescriptor,
      providerId: "other-provider",
    }),
    false,
  );
  assert.equal(
    isProviderPlaybackDescriptor({
      ...validProviderPlaybackDescriptor,
      candidates: [
        {
          id: "flv",
          sourceType: "flv",
          url: "https://syncroom.example.test/video.flv",
        },
      ],
    }),
    false,
  );
});

test("accepts video:share carrying valid provider playback metadata", () => {
  assert.equal(
    isClientMessage({
      type: "video:share",
      payload: {
        memberToken: VALID_TOKEN,
        video: {
          videoId: "BV1xx411c7mD",
          url: "https://www.bilibili.com/video/BV1xx411c7mD",
          title: "Bilibili video",
          provider: validProviderPlaybackDescriptor,
        },
      },
    }),
    true,
  );
});

test("rejects video:share when provider playback policy is malformed", () => {
  assert.equal(
    isClientMessage({
      type: "video:share",
      payload: {
        memberToken: VALID_TOKEN,
        video: {
          videoId: "BV1xx411c7mD",
          url: "https://www.bilibili.com/video/BV1xx411c7mD",
          title: "Bilibili video",
          provider: {
            ...validProviderPlaybackDescriptor,
            policy: {
              proxy: "yes",
              shared: true,
            },
          },
        },
      },
    }),
    false,
  );
});

test("accepts legacy shared video without provider metadata", () => {
  assert.equal(
    isClientMessage({
      type: "video:share",
      payload: {
        memberToken: VALID_TOKEN,
        video: {
          videoId: "BV1xx411c7mD",
          url: "https://www.bilibili.com/video/BV1xx411c7mD",
          title: "Legacy video",
        },
      },
    }),
    true,
  );
});

test("accepts a valid chat client message", () => {
  assert.equal(
    isClientMessage({
      type: "chat:message",
      payload: {
        memberToken: VALID_TOKEN,
        content: "今晚看第 3 集",
      },
    }),
    true,
  );
});

test("accepts a valid private room danmaku client message", () => {
  assert.equal(
    isClientMessage({
      type: "danmaku:message",
      payload: {
        memberToken: VALID_TOKEN,
        content: "front row",
        videoTime: 123.45,
        mode: "scroll",
        color: "#ffffff",
      },
    }),
    true,
  );
});

test("rejects malformed private room danmaku client messages", () => {
  assert.equal(
    isClientMessage({
      type: "danmaku:message",
      payload: {
        memberToken: VALID_TOKEN,
        content: "",
        videoTime: 1,
      },
    }),
    false,
  );
  assert.equal(
    isClientMessage({
      type: "danmaku:message",
      payload: {
        memberToken: VALID_TOKEN,
        content: "x".repeat(121),
        videoTime: 1,
      },
    }),
    false,
  );
  assert.equal(
    isClientMessage({
      type: "danmaku:message",
      payload: {
        memberToken: VALID_TOKEN,
        content: "negative time",
        videoTime: -1,
      },
    }),
    false,
  );
  assert.equal(
    isClientMessage({
      type: "danmaku:message",
      payload: {
        memberToken: VALID_TOKEN,
        content: "bad color",
        videoTime: 1,
        color: "red",
      },
    }),
    false,
  );
});

test("rejects invalid chat client messages", () => {
  assert.equal(
    isClientMessage({
      type: "chat:message",
      payload: {
        memberToken: "short",
        content: "hello",
      },
    }),
    false,
  );
  assert.equal(
    isClientMessage({
      type: "chat:message",
      payload: {
        memberToken: VALID_TOKEN,
        content: "x".repeat(501),
      },
    }),
    false,
  );
});

test("accepts low-cardinality playback report client messages", () => {
  assert.equal(
    isClientMessage({
      type: "playback:report",
      payload: {
        memberToken: VALID_TOKEN,
        event: "startup_failure",
        providerId: "bilibili",
        stage: "manifest",
      },
    }),
    true,
  );
  assert.equal(
    isClientMessage({
      type: "playback:report",
      payload: {
        memberToken: VALID_TOKEN,
        event: "player_error",
        providerId: "bilibili",
        stage: "decode",
        browser: "chrome",
        system: "windows",
      },
    }),
    true,
  );
  assert.equal(
    isClientMessage({
      type: "playback:report",
      payload: {
        memberToken: VALID_TOKEN,
        event: "proxy_fallback",
        providerId: "generic",
      },
    }),
    true,
  );
});

test("rejects playback report messages with high-cardinality labels", () => {
  assert.equal(
    isClientMessage({
      type: "playback:report",
      payload: {
        memberToken: VALID_TOKEN,
        event: "startup_failure",
        providerId: "bilibili",
        stage: "https://cdn.example.com/video.m4s?SESSDATA=secret",
      },
    }),
    false,
  );
  assert.equal(
    isClientMessage({
      type: "playback:report",
      payload: {
        memberToken: VALID_TOKEN,
        event: "player_error",
        providerId: "bilibili",
        stage: "decode",
        browser: "Chrome 126.0.1234.0",
        system: "Windows 11 build 22631",
      },
    }),
    false,
  );
});

test("accepts a valid server danmaku broadcast", () => {
  assert.equal(
    isServerMessage({
      type: "danmaku:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-1",
        displayName: "Alice",
        content: "<b>spoiler</b>",
        videoTime: 123.45,
        mode: "scroll",
        color: "#fff",
        timestamp: 1_725_000_000_000,
      },
    }),
    true,
  );
});

test("rejects malformed server danmaku broadcasts", () => {
  assert.equal(
    isServerMessage({
      type: "danmaku:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-1",
        displayName: "Alice",
        content: "hello",
        videoTime: Number.NaN,
        mode: "scroll",
        color: "#fff",
        timestamp: 1,
      },
    }),
    false,
  );
  assert.equal(
    isServerMessage({
      type: "danmaku:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-1",
        displayName: "Alice",
        content: "hello",
        videoTime: 1,
        mode: "float",
        color: "#fff",
        timestamp: 1,
      },
    }),
    false,
  );
});

test("accepts a valid server chat broadcast", () => {
  assert.equal(
    isServerMessage({
      type: "chat:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-1",
        displayName: "Alice",
        content: "<img src=x onerror=alert(1)>",
        timestamp: 1_725_000_000_000,
      },
    }),
    true,
  );
});

test("rejects malformed server chat broadcasts", () => {
  assert.equal(
    isServerMessage({
      type: "chat:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-1",
        displayName: "x".repeat(33),
        content: "hello",
        timestamp: 1,
      },
    }),
    false,
  );
  assert.equal(
    isServerMessage({
      type: "chat:message",
      payload: {
        roomCode: "ABC123",
        memberId: "member-1",
        displayName: "Alice",
        content: "hello",
        timestamp: Number.NaN,
      },
    }),
    false,
  );
});
