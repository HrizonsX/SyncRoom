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
import { createGenericProvider } from "../src/providers/generic-provider.js";
import { createHuyaProvider } from "../src/providers/huya-provider.js";
import { createIqiyiProvider } from "../src/providers/iqiyi-provider.js";

test("video provider registry matches urls through registered adapters", () => {
  const registry = createVideoProviderRegistry([
    createBilibiliProvider(),
    createIqiyiProvider(),
    createHuyaProvider(),
    createGenericProvider({
      extractorClient: {
        async extract() {
          throw new Error("generic provider should not parse during matching");
        },
      },
    }),
  ]);

  assert.equal(registry.get("bilibili")?.id, "bilibili");
  assert.equal(registry.get("generic")?.id, "generic");
  assert.equal(registry.get("huya")?.id, "huya");
  assert.equal(registry.get("iqiyi")?.id, "iqiyi");
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
  assert.deepEqual(registry.matchUrl("https://example.com/watch?v=1"), {
    providerId: "generic",
    kind: "ugc",
    rawId: "generic:20c653445e9a2384",
    page: null,
    normalizedUrl: "https://example.com/watch?v=1",
    requiresResolution: false,
  });
  const iqiyiMatch = registry.matchUrl("https://www.iqiyi.com/v_abc123.html");
  assert.equal(iqiyiMatch?.providerId, "iqiyi");
  assert.equal(
    iqiyiMatch?.normalizedUrl,
    "https://www.iqiyi.com/v_abc123.html",
  );
  assert.equal(iqiyiMatch?.rawId.startsWith("iqiyi:"), true);
  const huyaMatch = registry.matchUrl("https://www.huya.com/cxy0714");
  assert.equal(huyaMatch?.providerId, "huya");
  assert.equal(huyaMatch?.kind, "live");
  assert.equal(huyaMatch?.rawId, "cxy0714");
  assert.equal(huyaMatch?.normalizedUrl, "https://www.huya.com/cxy0714");
  assert.throws(
    () =>
      createVideoProviderRegistry([
        createBilibiliProvider(),
        createBilibiliProvider(),
      ]),
    /Duplicate video provider adapter/,
  );
});

test("Huya provider parses public live FLV candidates from room page metadata", async () => {
  const antiCode = new URLSearchParams({
    wsSecret: "old-secret",
    wsTime: "65ff0000",
    seqid: "1",
    fm: Buffer.from("fm-prefix_extra").toString("base64"),
    ctype: "tars_mobile",
    t: "100",
  }).toString();
  const provider = createHuyaProvider({
    random: () => 0.123456,
    fetch: async () =>
      new Response(
        `<html><title>room</title><script>
window.HNF_GLOBAL_INIT = {
  stream: {
    "data": [{
      "gameLiveInfo": {
        "roomName": "虎牙直播间",
        "nick": "主播昵称",
        "profileRoom": "cxy0714",
        "roomId": 660000,
        "liveStatus": "ON"
      },
      "gameStreamInfoList": [{
        "sFlvUrl": "https://live-huya.example.com/live",
        "sStreamName": "660000-1234567890-1234567890-1",
        "sFlvUrlSuffix": "flv",
        "sFlvAntiCode": "${antiCode}",
        "iLineIndex": 0,
        "iIsMaster": 1
      }],
      "vMultiStreamInfo": [
        {"sDisplayName": "720P", "iBitRate": 2000},
        {"sDisplayName": "原画", "iBitRate": 0}
      ]
    }]
  }
};
</script></html>`,
        { status: 200 },
      ),
  });

  const matchedUrl = provider.matchUrl("https://www.huya.com/cxy0714");
  assert.ok(matchedUrl);
  const result = await provider.parse({
    matchedUrl,
    policy: { proxy: false, shared: false },
  });

  assert.equal(result.providerId, "huya");
  assert.equal(result.title, "虎牙直播间");
  assert.deepEqual(result.items[0]?.item, {
    itemId: "live-cxy0714",
    title: "虎牙直播间",
    kind: "live",
    roomId: "cxy0714",
  });
  assert.equal(result.items[0]?.defaultCandidateId, "huya-flv-2000");
  assert.equal(result.items[0]?.candidates.length, 2);
  assert.equal(result.items[0]?.candidates[0]?.sourceType, "flv");
  assert.equal(result.items[0]?.candidates[0]?.qualityLabel, "720P");
  assert.match(
    result.items[0]?.candidates[0]?.url ?? "",
    /^https:\/\/live-huya\.example\.com\/live\/660000-1234567890-1234567890-1\.flv\?/,
  );
  assert.match(result.items[0]?.candidates[0]?.url ?? "", /ratio=2000/);
  assert.equal(
    (result.items[0]?.candidates[0] as Record<string, unknown>)
      .upstreamHeaders instanceof Object,
    true,
  );
});

test("Huya provider upgrades direct FLV media urls to HTTPS for browser playback", async () => {
  const antiCode = new URLSearchParams({
    wsSecret: "old-secret",
    wsTime: "65ff0000",
    seqid: "1",
    fm: Buffer.from("fm-prefix_extra").toString("base64"),
    ctype: "tars_mobile",
    t: "100",
  }).toString();
  const provider = createHuyaProvider({
    random: () => 0.123456,
    fetch: async () =>
      new Response(
        `<script>
          var hyPlayerConfig = {
            stream: {
              "data": [{
                "gameLiveInfo": {
                  "roomName": "Huya Room",
                  "profileRoom": "cxy0714",
                  "liveStatus": "ON"
                },
                "gameStreamInfoList": [{
                  "sFlvUrl": "http://live-huya.example.com/live",
                  "sStreamName": "660000-1234567890-1234567890-1",
                  "sFlvUrlSuffix": "flv",
                  "sFlvAntiCode": "${antiCode}",
                  "iLineIndex": 0,
                  "iIsMaster": 1
                }],
                "vMultiStreamInfo": [{"sDisplayName": "720P", "iBitRate": 2000}]
              }]
            }
          };
        </script>`,
        { status: 200 },
      ),
  });

  const matchedUrl = provider.matchUrl("https://www.huya.com/cxy0714");
  assert.ok(matchedUrl);
  const result = await provider.parse({
    matchedUrl,
    policy: { proxy: false, shared: false },
  });

  assert.match(
    result.items[0]?.candidates[0]?.url ?? "",
    /^https:\/\/live-huya\.example\.com\/live\/660000-1234567890-1234567890-1\.flv\?/,
  );
});

test("Huya provider reads top-level live qualities without duplicating stream lines", async () => {
  const antiCode = new URLSearchParams({
    wsSecret: "old-secret",
    wsTime: "65ff0000",
    seqid: "1",
    fm: Buffer.from("fm-prefix_extra").toString("base64"),
    ctype: "tars_mobile",
    t: "100",
  }).toString();
  const streamInfo = {
    sFlvUrl: "https://live-huya.example.com/live",
    sStreamName: "660000-1234567890-1234567890-1",
    sFlvUrlSuffix: "flv",
    sFlvAntiCode: antiCode,
  };
  const provider = createHuyaProvider({
    random: () => 0.123456,
    fetch: async () =>
      new Response(
        `<script>
          var hyPlayerConfig = {
            stream: {
              "data": [{
                "gameLiveInfo": {
                  "roomName": "Huya Room",
                  "profileRoom": "cxy0714",
                  "liveStatus": "ON"
                },
                "gameStreamInfoList": [
                  ${JSON.stringify({ ...streamInfo, iLineIndex: 0, iIsMaster: 1 })},
                  ${JSON.stringify({ ...streamInfo, iLineIndex: 1, iIsMaster: 0 })}
                ]
              }],
              "vMultiStreamInfo": [
                {"sDisplayName": "Blue 8M", "iBitRate": 8000},
                {"sDisplayName": "Smooth", "iBitRate": 500}
              ]
            }
          };
        </script>`,
        { status: 200 },
      ),
  });

  const matchedUrl = provider.matchUrl("https://www.huya.com/cxy0714");
  assert.ok(matchedUrl);
  const result = await provider.parse({
    matchedUrl,
    policy: { proxy: false, shared: false },
  });

  assert.deepEqual(
    result.items[0]?.candidates.map((candidate) => candidate.qualityLabel),
    ["Blue 8M", "Smooth"],
  );
  assert.deepEqual(
    result.items[0]?.candidates.map((candidate) => candidate.id),
    ["huya-flv-8000", "huya-flv-500"],
  );
});

test("Huya provider reports unavailable rooms when public stream metadata is empty", async () => {
  const provider = createHuyaProvider({
    fetch: async () =>
      new Response(
        `
        <script>
          var hyPlayerConfig = {
            stream: {"data":[{"gameLiveInfo":{"nick":"cxy0714"},"gameStreamInfoList":[]}],"vMultiStreamInfo":[]}
          };
        </script>
        `,
        { status: 200 },
      ),
  });

  const matchedUrl = provider.matchUrl("https://www.huya.com/cxy0714");
  assert.ok(matchedUrl);

  await assert.rejects(
    () =>
      provider.parse({
        matchedUrl,
        policy: { proxy: false, shared: false },
      }),
    (error: unknown) =>
      error instanceof VideoProviderError &&
      error.reason === "huya_live_room_unavailable",
  );
});

test("Huya provider authorizes QR login and stores Huya credentials", async () => {
  const fetchCalls: Array<{
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }> = [];
  let authorizedArgs: {
    roomCode: string;
    providerId: "huya";
    ownerMemberId: string;
    profile: { id: string; displayName?: string } | null;
    credentials: Record<string, unknown>;
  } | null = null;
  const authSessions = {
    async authorize(args: NonNullable<typeof authorizedArgs>) {
      authorizedArgs = args;
      return {
        authorized: true as const,
        providerId: "huya" as const,
        profile: args.profile,
        expiresAt: 601_000,
      };
    },
    async getStatus() {
      return null;
    },
    async getCredentials() {
      return null;
    },
    async logout() {
      return false;
    },
  };
  const provider = createHuyaProvider({
    authSessions,
    createFlowId: () => "flow-1",
    now: () => 1_000,
    fetch: async (url, init) => {
      const requestUrl = String(url);
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      fetchCalls.push({
        url: requestUrl,
        headers,
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : init?.body,
      });
      if (requestUrl.includes("/qrLgn/getQrId")) {
        return new Response(
          JSON.stringify({
            returnCode: 0,
            data: { qrId: "huya-qr-1" },
          }),
          {
            headers: {
              "content-type": "application/json",
              "set-cookie":
                "web_qrlogin_confirm_id=confirm-1; Domain=huya.com; Path=/",
            },
          },
        );
      }
      if (requestUrl.includes("/qrLgn/tryQrLogin")) {
        assert.equal(headers.cookie, "web_qrlogin_confirm_id=confirm-1");
        return new Response(
          JSON.stringify({
            returnCode: 0,
            data: {
              stage: 2,
              uid: "123456",
              nickName: "Huya User",
              loginTime: "1710000000",
              sign: "signed-login",
            },
          }),
          { headers: { "content-type": "application/json" } },
        );
      }
      if (requestUrl.includes("/udbport2.php")) {
        assert.match(requestUrl, /loginTime=1710000000/);
        assert.match(requestUrl, /sign=signed-login/);
        return new Response("ok", {
          headers: {
            "set-cookie":
              "udb_uid=123456; Domain=huya.com; Path=/, udb_biztoken=token-1; Domain=huya.com; Path=/",
          },
        });
      }
      throw new Error(`Unexpected Huya request: ${requestUrl}`);
    },
  });

  const flow = await provider.auth.start({
    method: "qr",
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
    now: 1_000,
  });
  assert.equal(flow.providerId, "huya");
  assert.equal(flow.flowId, "qr:flow-1");
  assert.equal(flow.status, "pending");
  assert.match(flow.qrCodeUrl ?? "", /^data:image\/png;base64,/);

  const poll = await provider.auth.poll({
    flowId: "qr:flow-1",
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
    now: 2_000,
  });

  assert.equal(poll.status, "authorized");
  assert.deepEqual(authorizedArgs, {
    roomCode: "ABC123",
    providerId: "huya",
    ownerMemberId: "owner-1",
    profile: {
      id: "123456",
      displayName: "Huya User",
    },
    credentials: {
      cookies:
        "web_qrlogin_confirm_id=confirm-1; udb_uid=123456; udb_biztoken=token-1",
    },
  });
  assert.equal(fetchCalls[0]?.url, "https://udblgn.huya.com/qrLgn/getQrId");
  assert.equal(
    (fetchCalls[0]?.body as { uri?: unknown } | undefined)?.uri,
    "70001",
  );
  assert.equal(fetchCalls[1]?.url, "https://udblgn.huya.com/qrLgn/tryQrLogin");
  assert.equal(
    (fetchCalls[1]?.body as { data?: { qrId?: unknown } } | undefined)?.data
      ?.qrId,
    "huya-qr-1",
  );
});

test("Huya provider sends authorized cookies when fetching live room pages", async () => {
  let requestHeaders: Record<string, string> | null = null;
  const provider = createHuyaProvider({
    random: () => 0.123456,
    fetch: async (_url, init) => {
      requestHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      const antiCode = new URLSearchParams({
        wsSecret: "old-secret",
        wsTime: "65ff0000",
        seqid: "1",
        fm: Buffer.from("fm-prefix_extra").toString("base64"),
        ctype: "tars_mobile",
        t: "100",
      }).toString();
      return new Response(
        `<script>
window.HNF_GLOBAL_INIT = {
  stream: {"data":[{
    "gameLiveInfo":{"roomName":"Huya Room","liveStatus":"ON"},
    "gameStreamInfoList":[{
      "sFlvUrl":"https://live-huya.example.com/live",
      "sStreamName":"660000-1234567890-1234567890-1",
      "sFlvUrlSuffix":"flv",
      "sFlvAntiCode":"${antiCode}",
      "iLineIndex":0,
      "iIsMaster":1
    }],
    "vMultiStreamInfo":[{"sDisplayName":"720P","iBitRate":2000}]
  }]}
};
</script>`,
        { status: 200 },
      );
    },
  });
  const matchedUrl = provider.matchUrl("https://www.huya.com/cxy0714");
  assert.ok(matchedUrl);

  await provider.parse({
    matchedUrl,
    policy: { proxy: false, shared: false },
    credentials: {
      cookies: "udb_uid=123456; udb_biztoken=token-1",
    },
  });

  assert.equal(requestHeaders?.cookie, "udb_uid=123456; udb_biztoken=token-1");
});

test("generic provider maps extractor candidates to provider parse results", async () => {
  const provider = createGenericProvider({
    extractorClient: {
      async extract(input) {
        assert.deepEqual(input, {
          url: "https://example.com/watch/123",
          platform: "generic",
        });
        return {
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
        };
      },
    },
  });

  const matchedUrl = provider.matchUrl("https://example.com/watch/123");
  assert.ok(matchedUrl);
  const result = await provider.parse({
    matchedUrl,
    policy: { proxy: true, shared: false },
  });

  assert.deepEqual(result, {
    providerId: "generic",
    sourceId: "generic:7cb52d65f977f6b8",
    sourceUrl: "https://example.com/watch/123",
    title: "Generic Video",
    items: [
      {
        item: {
          itemId: "default",
          title: "Generic Video",
          kind: "part",
        },
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
        defaultCandidateId: "hls",
      },
    ],
  });
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
