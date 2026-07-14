import assert from "node:assert/strict";
import test from "node:test";
import { VideoProviderError } from "../src/providers/video-provider.js";
import { createMediaExtractorClient } from "../src/providers/media-extractor-client.js";

test("media extractor client posts extract requests and validates candidates", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = createMediaExtractorClient({
    baseUrl: "http://127.0.0.1:8790/",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify({
          title: "Generic Video",
          sourceUrl: "https://example.com/watch/123",
          isLive: false,
          candidates: [
            {
              id: "hls",
              sourceType: "m3u8",
              url: "https://cdn.example.com/index.m3u8",
              qualityLabel: "720P",
              upstreamHeaders: {
                Referer: "https://example.com/",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });

  const result = await client.extract({
    url: "https://example.com/watch/123",
    platform: "generic",
    headers: {
      Referer: "https://example.com/",
    },
  });

  assert.deepEqual(result, {
    title: "Generic Video",
    sourceUrl: "https://example.com/watch/123",
    isLive: false,
    candidates: [
      {
        id: "hls",
        sourceType: "m3u8",
        url: "https://cdn.example.com/index.m3u8",
        qualityLabel: "720P",
        upstreamHeaders: {
          Referer: "https://example.com/",
        },
      },
    ],
  });
  assert.equal(requests[0]?.url, "http://127.0.0.1:8790/extract");
  assert.equal(requests[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    url: "https://example.com/watch/123",
    platform: "generic",
    headers: {
      Referer: "https://example.com/",
    },
  });
});

test("media extractor client maps no playable candidates to provider parse errors", async () => {
  const client = createMediaExtractorClient({
    baseUrl: "http://127.0.0.1:8790",
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: "no_playable_candidates",
          message: "No supported playable candidates were found.",
        }),
        { status: 422 },
      ),
  });

  await assert.rejects(
    () =>
      client.extract({
        url: "https://example.com/watch/empty",
        platform: "generic",
      }),
    (error) =>
      error instanceof VideoProviderError &&
      error.code === "provider_parse_failed" &&
      error.reason === "extractor_no_playable_candidates",
  );
});

test("media extractor client maps transport failures to provider parse errors", async () => {
  const client = createMediaExtractorClient({
    baseUrl: "http://127.0.0.1:8790",
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });

  await assert.rejects(
    () =>
      client.extract({
        url: "https://unsupported.example.test/watch",
        platform: "generic",
      }),
    (error) =>
      error instanceof VideoProviderError &&
      error.code === "provider_parse_failed" &&
      error.reason === "extractor_unavailable",
  );
});

test("media extractor client maps non-json HTTP failures to provider parse errors", async () => {
  const client = createMediaExtractorClient({
    baseUrl: "http://127.0.0.1:8790",
    fetch: async () =>
      new Response("unsupported site", {
        status: 422,
        headers: { "content-type": "text/plain" },
      }),
  });

  await assert.rejects(
    () =>
      client.extract({
        url: "https://unsupported.example.test/watch",
        platform: "generic",
      }),
    (error) =>
      error instanceof VideoProviderError &&
      error.code === "provider_parse_failed" &&
      error.reason === "extractor_http_422",
  );
});

test("media extractor client preserves extractor error reasons", async () => {
  const client = createMediaExtractorClient({
    baseUrl: "http://127.0.0.1:8790",
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: "unsupported_url",
          message: "URL is not supported by the extractor.",
        }),
        { status: 422 },
      ),
  });

  await assert.rejects(
    () =>
      client.extract({
        url: "https://haokan.baidu.com/v?vid=1",
        platform: "generic",
      }),
    (error) =>
      error instanceof VideoProviderError &&
      error.code === "provider_parse_failed" &&
      error.reason === "extractor_unsupported_url",
  );
});

test("media extractor client maps extractor auth requirements", async () => {
  const client = createMediaExtractorClient({
    baseUrl: "http://127.0.0.1:8790",
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: "auth_required",
          message: "Extractor requires cookies or authentication.",
        }),
        { status: 401 },
      ),
  });

  await assert.rejects(
    () =>
      client.extract({
        url: "https://www.youtube.com/watch?v=keOaQm6RpBg",
        platform: "generic",
      }),
    (error) =>
      error instanceof VideoProviderError &&
      error.code === "provider_parse_failed" &&
      error.reason === "extractor_auth_required",
  );
});

test("media extractor client rejects malformed extraction responses", async () => {
  const client = createMediaExtractorClient({
    baseUrl: "http://127.0.0.1:8790",
    fetch: async () =>
      new Response(
        JSON.stringify({
          title: "Bad",
          sourceUrl: "https://example.com/watch/bad",
          candidates: [],
        }),
        { status: 200 },
      ),
  });

  await assert.rejects(
    () =>
      client.extract({
        url: "https://example.com/watch/bad",
        platform: "generic",
      }),
    (error) =>
      error instanceof VideoProviderError &&
      error.code === "provider_parse_failed" &&
      error.reason === "extractor_invalid_response",
  );
});
