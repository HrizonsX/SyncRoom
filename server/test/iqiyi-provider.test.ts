import assert from "node:assert/strict";
import test from "node:test";
import { createIqiyiProvider } from "../src/providers/iqiyi-provider.js";
import {
  createInMemoryVideoAuthSessionStore,
  createVideoAuthSessionService,
} from "../src/video-auth-session.js";

type MockFetchResponse = {
  body: unknown;
  headers?: Record<string, string>;
  setCookies?: string[];
  status?: number;
};

function createMockFetch(responses: MockFetchResponse[]): {
  fetch: typeof fetch;
  requests: Array<{
    url: string;
    method: string;
    headers: Headers;
    body: string;
  }>;
} {
  const pending = [...responses];
  const requests: Array<{
    url: string;
    method: string;
    headers: Headers;
    body: string;
  }> = [];
  return {
    requests,
    fetch: async (input, init) => {
      const response = pending.shift();
      if (!response) {
        throw new Error("Unexpected fetch call.");
      }
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      requests.push({
        url,
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : "",
      });

      const headers = new Headers();
      for (const [key, value] of Object.entries(response.headers ?? {})) {
        headers.set(key, value);
      }
      for (const cookie of response.setCookies ?? []) {
        headers.append("set-cookie", cookie);
      }
      return new Response(JSON.stringify(response.body), {
        status: response.status ?? 200,
        headers,
      });
    },
  };
}

function createAuthService(now: () => number) {
  return createVideoAuthSessionService({
    store: createInMemoryVideoAuthSessionStore(),
    now,
    defaultTtlMs: 600_000,
  });
}

test("iQIYI provider starts QR login with safe flow details", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: "A00000",
        data: {
          token: "iqiyi-token-1",
          expire: 300,
          url: "https://passport.iqiyi.com/apis/qrcode/token_login.action?token=iqiyi-token-1",
        },
      },
    },
  ]);
  const provider = createIqiyiProvider({
    fetch: mock.fetch,
    authSessions: createAuthService(() => 1_000),
    now: () => 1_000,
    createFlowId: () => "flow-1",
  });

  const flow = await provider.auth.start({
    method: "qr",
    roomCode: "ABC123",
    ownerMemberId: "member-host",
    now: 1_000,
  });

  assert.equal(flow.providerId, "iqiyi");
  assert.equal(flow.method, "qr");
  assert.equal(flow.flowId, "qr:flow-1");
  assert.equal(flow.status, "pending");
  assert.equal(flow.expiresAt, 301_000);
  assert.match(flow.qrCodeUrl ?? "", /^data:image\/png;base64,/);
  assert.equal(flow.message, "Scan the iQIYI QR code to authorize playback.");
  assert.equal(JSON.stringify(flow).includes("P00001"), false);
  assert.equal(
    mock.requests[0]?.url,
    "https://passport.iqiyi.com/apis/qrcode/gen_login_token.action",
  );
  assert.equal(mock.requests[0]?.method, "POST");
  assert.match(mock.requests[0]?.body ?? "", /ptid=01010021010000000000/);
});

test("iQIYI provider maps QR poll pending and expired states", async () => {
  let now = 10_000;
  const mock = createMockFetch([
    {
      body: {
        code: "A00000",
        data: {
          token: "iqiyi-token-2",
          expire: 120,
          url: "https://passport.iqiyi.com/apis/qrcode/token_login.action?token=iqiyi-token-2",
        },
      },
    },
    {
      body: {
        code: "A00001",
        msg: "找不到用户登录信息，可能手机端尚未确认",
      },
    },
  ]);
  const provider = createIqiyiProvider({
    fetch: mock.fetch,
    authSessions: createAuthService(() => now),
    now: () => now,
    createFlowId: () => "flow-2",
  });
  const flow = await provider.auth.start({
    method: "qr",
    roomCode: "ABC123",
    ownerMemberId: "member-host",
    now,
  });

  assert.deepEqual(
    await provider.auth.poll({
      flowId: flow.flowId,
      roomCode: "ABC123",
      ownerMemberId: "member-host",
      now,
    }),
    { status: "pending", message: "Waiting for iQIYI scan confirmation." },
  );
  now = 131_000;
  assert.deepEqual(
    await provider.auth.poll({
      flowId: flow.flowId,
      roomCode: "ABC123",
      ownerMemberId: "member-host",
      now,
    }),
    { status: "expired", message: "QR code expired." },
  );
});

test("iQIYI provider stores QR login credentials server-side on success", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: "A00000",
        data: {
          token: "iqiyi-token-3",
          expire: 300,
          url: "https://passport.iqiyi.com/apis/qrcode/token_login.action?token=iqiyi-token-3",
        },
      },
    },
    {
      body: {
        code: "A00000",
        data: {
          userinfo: {
            uid: "10086",
            nickname: "爱奇艺用户",
            icon: "https://www.iqiyipic.com/avatar.png",
          },
        },
      },
      setCookies: [
        "P00001=auth-cookie; Path=/; Domain=.iqiyi.com; Secure",
        "P00003=10086; Path=/; Domain=.iqiyi.com",
        "P00004=profile-cookie; Path=/; Domain=.iqiyi.com",
        "P00PRU=vip-user; Path=/; Domain=.iqiyi.com",
      ],
    },
  ]);
  const authSessions = createAuthService(() => 20_000);
  const provider = createIqiyiProvider({
    fetch: mock.fetch,
    authSessions,
    now: () => 20_000,
    createFlowId: () => "flow-3",
  });
  const flow = await provider.auth.start({
    method: "qr",
    roomCode: "ABC123",
    ownerMemberId: "member-host",
    now: 20_000,
  });

  const result = await provider.auth.poll({
    flowId: flow.flowId,
    roomCode: "ABC123",
    ownerMemberId: "member-host",
    now: 20_000,
  });

  assert.equal(result.status, "authorized");
  if (result.status !== "authorized") {
    throw new Error("Expected authorized result.");
  }
  assert.deepEqual(result.profile, {
    id: "10086",
    displayName: "爱奇艺用户",
    avatarUrl: "https://www.iqiyipic.com/avatar.png",
  });
  const credentials = await authSessions.getCredentials({
    roomCode: "ABC123",
    providerId: "iqiyi",
    ownerMemberId: "member-host",
  });
  assert.deepEqual(credentials, {
    cookies:
      "P00001=auth-cookie; P00003=10086; P00004=profile-cookie; P00PRU=vip-user",
  });
  assert.equal(JSON.stringify(result).includes("auth-cookie"), false);
});

test("iQIYI provider parses matched pages through the extractor with server cookies", async () => {
  const extractInputs: unknown[] = [];
  const provider = createIqiyiProvider({
    extractorClient: {
      async extract(input) {
        extractInputs.push(input);
        return {
          title: "爱奇艺视频",
          sourceUrl: input.url,
          isLive: false,
          candidates: [
            {
              id: "720p",
              sourceType: "m3u8",
              url: "https://cache.video.iqiyi.com/index.m3u8",
              qualityLabel: "720P",
              upstreamHeaders: input.headers,
            },
          ],
        };
      },
    },
  });
  const matchedUrl = provider.matchUrl("https://www.iqiyi.com/v_abc123.html");
  assert.ok(matchedUrl);

  const result = await provider.parse({
    matchedUrl,
    policy: { proxy: false, shared: false },
    credentials: {
      cookies: "P00001=auth-cookie; P00003=10086",
    },
  });

  assert.equal(matchedUrl.providerId, "iqiyi");
  assert.equal(matchedUrl.rawId.startsWith("iqiyi:"), true);
  assert.deepEqual(extractInputs, [
    {
      url: "https://www.iqiyi.com/v_abc123.html",
      platform: "iqiyi",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Referer: "https://www.iqiyi.com/",
        Cookie: "P00001=auth-cookie; P00003=10086",
      },
    },
  ]);
  assert.deepEqual(result, {
    providerId: "iqiyi",
    sourceId: matchedUrl.rawId,
    sourceUrl: "https://www.iqiyi.com/v_abc123.html",
    title: "爱奇艺视频",
    items: [
      {
        item: {
          itemId: "default",
          title: "爱奇艺视频",
          kind: "part",
        },
        candidates: [
          {
            id: "720p",
            sourceType: "m3u8",
            url: "https://cache.video.iqiyi.com/index.m3u8",
            qualityLabel: "720P",
            upstreamHeaders: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
              Referer: "https://www.iqiyi.com/",
              Cookie: "P00001=auth-cookie; P00003=10086",
            },
          },
        ],
        defaultCandidateId: "720p",
      },
    ],
  });
});
