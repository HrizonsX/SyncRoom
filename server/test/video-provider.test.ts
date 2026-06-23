import assert from "node:assert/strict";
import test from "node:test";
import {
  VideoProviderError,
  createProviderPlaybackDescriptor,
  createVideoProviderRegistry,
  toSafeProviderError,
  type ProviderParseResult,
} from "../src/providers/video-provider.js";
import { createBilibiliProvider } from "../src/providers/bilibili-provider.js";

test("video provider registry matches urls through registered adapters", () => {
  const registry = createVideoProviderRegistry([createBilibiliProvider()]);

  assert.equal(registry.get("bilibili")?.id, "bilibili");
  assert.deepEqual(
    registry.matchUrl("https://www.bilibili.com/video/BV1xx411c7mD"),
    {
      providerId: "bilibili",
      kind: "ugc",
      rawId: "BV1xx411c7mD",
      page: null,
      normalizedUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
      requiresResolution: false,
    },
  );
  assert.equal(registry.matchUrl("https://example.com/watch?v=1"), null);
  assert.throws(
    () =>
      createVideoProviderRegistry([
        createBilibiliProvider(),
        createBilibiliProvider(),
      ]),
    /Duplicate video provider adapter/,
  );
});

test("Bilibili provider exposes auth parse and playback candidate boundaries", async () => {
  const provider = createBilibiliProvider();

  assert.equal(typeof provider.auth.start, "function");
  assert.equal(typeof provider.auth.poll, "function");
  assert.equal(typeof provider.auth.logout, "function");
  assert.equal(typeof provider.auth.me, "function");
  assert.equal(typeof provider.parse, "function");

  await assert.rejects(
    () =>
      provider.auth.start({
        method: "qr",
        roomCode: "ABC123",
        ownerMemberId: "owner-1",
        now: 1_000,
      }),
    (error) =>
      error instanceof VideoProviderError &&
      error.code === "provider_auth_unavailable",
  );
  await assert.rejects(
    () =>
      provider.parse({
        matchedUrl: {
          providerId: "bilibili",
          kind: "ugc",
          rawId: "not-supported",
          page: null,
          normalizedUrl: "https://www.bilibili.com/video/not-supported",
          requiresResolution: false,
        },
        policy: { proxy: true, shared: true },
      }),
    (error) =>
      error instanceof VideoProviderError &&
      error.code === "unsupported_source",
  );
});

test("selects a normalized provider playback descriptor without leaking raw fields", () => {
  const parseResult = {
    providerId: "bilibili",
    sourceId: "BV1xx411c7mD",
    sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    title: "Shared title",
    items: [
      {
        item: {
          itemId: "cid-1",
          title: "Part 1",
          kind: "part",
          bvid: "BV1xx411c7mD",
          cid: "1",
        },
        candidates: [
          {
            id: "720p-avc",
            sourceType: "mpd",
            url: "https://syncroom.example.test/proxy/manifest.mpd",
            codecs: "avc1.640028",
            qualityLabel: "720P",
            default: true,
            biliApiResponse: { cookie: "SESSDATA=secret" },
          },
        ],
        upstreamHeaders: { Cookie: "SESSDATA=secret" },
      },
    ],
    rawApiResponse: { SESSDATA: "secret" },
  } satisfies ProviderParseResult & Record<string, unknown>;

  const descriptor = createProviderPlaybackDescriptor(parseResult, {
    itemId: "cid-1",
    policy: { proxy: true, shared: true },
  });

  assert.deepEqual(descriptor, {
    providerId: "bilibili",
    sourceId: "BV1xx411c7mD",
    sourceUrl: "https://www.bilibili.com/video/BV1xx411c7mD",
    title: "Shared title",
    item: {
      itemId: "cid-1",
      title: "Part 1",
      kind: "part",
      bvid: "BV1xx411c7mD",
      cid: "1",
    },
    policy: { proxy: true, shared: true },
    candidates: [
      {
        id: "720p-avc",
        sourceType: "mpd",
        url: "https://syncroom.example.test/proxy/manifest.mpd",
        codecs: "avc1.640028",
        qualityLabel: "720P",
        default: true,
      },
    ],
    defaultCandidateId: "720p-avc",
  });
  assert.equal(JSON.stringify(descriptor).includes("SESSDATA"), false);
});

test("provider errors are mapped to safe client-visible details", () => {
  const safeProviderError = toSafeProviderError(
    new VideoProviderError(
      "provider_parse_failed",
      "Provider request failed with Cookie: SESSDATA=secret",
      "upstream_cookie_rejected",
    ),
  );
  assert.deepEqual(safeProviderError, {
    code: "provider_parse_failed",
    message: "Provider request failed.",
    reason: "upstream_cookie_rejected",
  });

  const genericError = toSafeProviderError(
    new Error("token=secret&SESSDATA=secret"),
  );
  assert.deepEqual(genericError, {
    code: "provider_parse_failed",
    message: "Provider request failed.",
    reason: "unknown",
  });
});
