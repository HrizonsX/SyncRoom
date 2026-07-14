import assert from "node:assert/strict";
import test from "node:test";
import { createBilibiliProvider } from "../src/providers/bilibili-provider.js";
import {
  VideoProviderError,
  type ProviderParseResult,
} from "../src/providers/video-provider.js";
import {
  createInMemoryVideoAuthSessionStore,
  createVideoAuthSessionService,
} from "../src/video-auth-session.js";

const provider = createBilibiliProvider();

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

function stripInternalCandidateFields(
  result: ProviderParseResult,
): ProviderParseResult {
  return {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      candidates: item.candidates.map((candidate) => {
        const {
          manifest: _manifest,
          upstreamHeaders: _upstreamHeaders,
          upstreamUrlAlternates: _upstreamUrlAlternates,
          upstreamUrls: _upstreamUrls,
          ...publicCandidate
        } = candidate as Record<string, unknown>;
        return publicCandidate;
      }),
    })),
  };
}

test("Bilibili provider matches BV and av video URLs", () => {
  assert.deepEqual(
    provider.matchUrl("https://www.bilibili.com/video/BV1xx411c7mD/?p=2&spm=1"),
    {
      providerId: "bilibili",
      kind: "ugc",
      rawId: "BV1xx411c7mD",
      page: 2,
      normalizedUrl: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
      requiresResolution: false,
    },
  );

  assert.deepEqual(
    provider.matchUrl("https://m.bilibili.com/video/av123456?vd_source=abc"),
    {
      providerId: "bilibili",
      kind: "ugc",
      rawId: "av123456",
      page: null,
      normalizedUrl: "https://www.bilibili.com/video/av123456",
      requiresResolution: false,
    },
  );
});

test("Bilibili provider matches bangumi ep and season URLs", () => {
  assert.deepEqual(
    provider.matchUrl("https://www.bilibili.com/bangumi/play/ep123456?from=1"),
    {
      providerId: "bilibili",
      kind: "pgc",
      rawId: "ep123456",
      page: null,
      normalizedUrl: "https://www.bilibili.com/bangumi/play/ep123456",
      requiresResolution: false,
    },
  );

  assert.deepEqual(
    provider.matchUrl("https://www.bilibili.com/bangumi/play/ss98765"),
    {
      providerId: "bilibili",
      kind: "pgc",
      rawId: "ss98765",
      page: null,
      normalizedUrl: "https://www.bilibili.com/bangumi/play/ss98765",
      requiresResolution: false,
    },
  );
});

test("Bilibili provider matches live room and b23 short links", () => {
  assert.deepEqual(
    provider.matchUrl("https://live.bilibili.com/123456?broadcast_type=0"),
    {
      providerId: "bilibili",
      kind: "live",
      rawId: "123456",
      page: null,
      normalizedUrl: "https://live.bilibili.com/123456",
      requiresResolution: false,
    },
  );

  assert.deepEqual(provider.matchUrl("https://b23.tv/BV1xx411c7mD"), {
    providerId: "bilibili",
    kind: "short-link",
    rawId: "BV1xx411c7mD",
    page: null,
    normalizedUrl: "https://b23.tv/BV1xx411c7mD",
    requiresResolution: true,
  });
});

test("Bilibili provider rejects unsupported urls", () => {
  assert.equal(
    provider.matchUrl("https://example.com/video/BV1xx411c7mD"),
    null,
  );
  assert.equal(
    provider.matchUrl("ftp://www.bilibili.com/video/BV1xx411c7mD"),
    null,
  );
  assert.equal(provider.matchUrl("https://live.bilibili.com/not-a-room"), null);
  assert.equal(provider.matchUrl("not a url"), null);
});

test("Bilibili provider starts QR login with safe flow details", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        message: "0",
        ttl: 1,
        data: {
          url: "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=qr-key-1",
          qrcode_key: "qr-key-1",
        },
      },
    },
  ]);
  const authSessions = createAuthService(() => 1_000);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    authSessions,
    now: () => 1_000,
  });

  const flow = await provider.auth.start({
    method: "qr",
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
    now: 1_000,
  });

  assert.deepEqual(flow, {
    providerId: "bilibili",
    method: "qr",
    flowId: "qr:qr-key-1",
    status: "pending",
    expiresAt: 181_000,
    qrCodeUrl: flow.qrCodeUrl,
    message: "Scan the Bilibili QR code to authorize playback.",
  });
  assert.match(flow.qrCodeUrl ?? "", /^data:image\/png;base64,/);
  assert.doesNotMatch(
    flow.qrCodeUrl ?? "",
    /^https:\/\/passport\.bilibili\.com\/h5-app\/passport\/login\/scan/,
  );
  assert.equal(
    mock.requests[0]?.url,
    "https://passport.bilibili.com/x/passport-login/web/qrcode/generate",
  );
  assert.equal(
    mock.requests[0]?.headers.get("referer"),
    "https://passport.bilibili.com/login",
  );
  assert.equal(JSON.stringify(flow).includes("SESSDATA"), false);
});

test("Bilibili provider maps QR poll pending scanned and expired states without storing credentials", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          url: "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=qr-key-2",
          qrcode_key: "qr-key-2",
        },
      },
    },
    {
      body: {
        code: 0,
        data: { code: 86101, message: "not scanned" },
      },
    },
    {
      body: {
        code: 0,
        data: { code: 86090, message: "scanned" },
      },
    },
    {
      body: {
        code: 0,
        data: { code: 86038, message: "expired" },
      },
    },
  ]);
  const now = 2_000;
  const authSessions = createAuthService(() => now);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    authSessions,
    now: () => now,
  });
  const flow = await provider.auth.start({
    method: "qr",
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
  });

  assert.deepEqual(
    await provider.auth.poll({
      flowId: flow.flowId,
      roomCode: "ABC123",
      ownerMemberId: "owner-1",
    }),
    { status: "pending", message: "Waiting for scan." },
  );
  assert.deepEqual(
    await provider.auth.poll({
      flowId: flow.flowId,
      roomCode: "ABC123",
      ownerMemberId: "owner-1",
    }),
    {
      status: "pending",
      message: "QR code scanned; waiting for confirmation.",
    },
  );
  assert.deepEqual(
    await provider.auth.poll({
      flowId: flow.flowId,
      roomCode: "ABC123",
      ownerMemberId: "owner-1",
    }),
    { status: "expired", message: "QR code expired." },
  );
  assert.equal(
    await authSessions.getCredentials({
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
    }),
    null,
  );
});

test("Bilibili provider stores QR login credentials server-side on success", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          url: "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=qr-key-3",
          qrcode_key: "qr-key-3",
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          code: 0,
          message: "",
          timestamp: 1_234,
          url:
            "https://passport.bilibili.com/h5-app/passport/login/callback?" +
            "SESSDATA=session-secret&bili_jct=csrf-secret&DedeUserID=10086&" +
            "DedeUserID__ckMd5=ck-md5&sid=sid-secret&Expires=1799999999&" +
            "first_domain=.bilibili.com&gourl=https%3A%2F%2Fwww.bilibili.com",
          refresh_token: "refresh-secret",
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          isLogin: true,
          mid: 10086,
        },
      },
    },
  ]);
  const authSessions = createAuthService(() => 10_000);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    authSessions,
    now: () => 10_000,
  });
  const flow = await provider.auth.start({
    method: "qr",
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
  });

  const result = await provider.auth.poll({
    flowId: flow.flowId,
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
  });

  assert.deepEqual(result, {
    status: "authorized",
    profile: { id: "10086" },
    expiresAt: 610_000,
  });
  assert.equal(JSON.stringify(result).includes("session-secret"), false);
  assert.deepEqual(
    await authSessions.getCredentials({
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
    }),
    {
      cookies:
        "SESSDATA=session-secret; bili_jct=csrf-secret; DedeUserID=10086; DedeUserID__ckMd5=ck-md5; sid=sid-secret",
      csrf: "csrf-secret",
      refreshToken: "refresh-secret",
    },
  );
  assert.equal(
    JSON.stringify(
      await authSessions.getCredentials({
        roomCode: "ABC123",
        providerId: "bilibili",
        ownerMemberId: "owner-1",
      }),
    ).includes("first_domain"),
    false,
  );
  assert.deepEqual(
    await provider.auth.me({
      roomCode: "ABC123",
      ownerMemberId: "owner-1",
    }),
    {
      authorized: true,
      profile: { id: "10086" },
      expiresAt: 610_000,
    },
  );
});

test("Bilibili provider preserves encoded QR login cookies without overriding set-cookie values", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          url: "https://passport.bilibili.com/h5-app/passport/login/scan?qrcode_key=qr-key-encoded",
          qrcode_key: "qr-key-encoded",
        },
      },
    },
    {
      setCookies: [
        "SESSDATA=header-session%2Craw; Path=/; Domain=bilibili.com; HttpOnly; Secure",
        "bili_jct=header-csrf%2Fraw; Path=/; Domain=bilibili.com; Secure",
      ],
      body: {
        code: 0,
        data: {
          code: 0,
          message: "",
          timestamp: 1_234,
          url:
            "https://passport.bilibili.com/h5-app/passport/login/callback?" +
            "SESSDATA=url-session%2Cdecoded&DedeUserID=10086&" +
            "bili_jct=url-csrf%2Fdecoded&DedeUserID__ckMd5=ck%3Dmd5&" +
            "sid=sid%2Bsecret&Expires=1799999999&" +
            "first_domain=.bilibili.com&gourl=https%3A%2F%2Fwww.bilibili.com",
          refresh_token: "refresh-secret",
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          isLogin: true,
          mid: 10086,
        },
      },
    },
  ]);
  const authSessions = createAuthService(() => 11_000);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    authSessions,
    now: () => 11_000,
  });
  const flow = await provider.auth.start({
    method: "qr",
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
  });

  await provider.auth.poll({
    flowId: flow.flowId,
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
  });

  assert.deepEqual(
    await authSessions.getCredentials({
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
    }),
    {
      cookies:
        "SESSDATA=header-session%2Craw; bili_jct=header-csrf%2Fraw; DedeUserID=10086; DedeUserID__ckMd5=ck%3Dmd5; sid=sid%2Bsecret",
      csrf: "header-csrf%2Fraw",
      refreshToken: "refresh-secret",
    },
  );
});

test("Bilibili provider starts SMS login with a captcha challenge", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          type: "geetest",
          token: "captcha-token-1",
          geetest: {
            gt: "gt-1",
            challenge: "challenge-1",
          },
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    authSessions: createAuthService(() => 20_000),
    now: () => 20_000,
    createFlowId: () => "sms-flow-1",
  });

  const flow = await provider.auth.start({
    method: "sms",
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
  });

  assert.deepEqual(flow, {
    providerId: "bilibili",
    method: "sms",
    flowId: "sms:sms-flow-1",
    status: "pending",
    expiresAt: 200_000,
    smsCaptcha: {
      type: "geetest",
      token: "captcha-token-1",
      gt: "gt-1",
      challenge: "challenge-1",
    },
    message: "Complete the SMS captcha challenge.",
  });
  assert.equal(
    mock.requests[0]?.url,
    "https://passport.bilibili.com/x/passport-login/captcha",
  );
  assert.equal(JSON.stringify(flow).includes("SESSDATA"), false);
});

test("Bilibili provider sends SMS after captcha verification", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          type: "geetest",
          token: "captcha-token-2",
          geetest: {
            gt: "gt-2",
            challenge: "challenge-2",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          b_3: "buvid-3",
          b_4: "buvid-4",
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          captcha_key: "sms-captcha-key-1",
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    authSessions: createAuthService(() => 30_000),
    now: () => 30_000,
    createFlowId: () => "sms-flow-2",
  });
  const flow = await provider.auth.start({
    method: "sms",
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
  });

  assert.deepEqual(
    await provider.auth.poll({
      flowId: flow.flowId,
      roomCode: "ABC123",
      ownerMemberId: "owner-1",
      sms: {
        phoneNumber: "13800138000",
        captcha: {
          token: "captcha-token-2",
          challenge: "challenge-2",
          validate: "validate-2",
        },
      },
    }),
    { status: "pending", message: "SMS code sent." },
  );

  assert.equal(
    mock.requests[1]?.url,
    "https://api.bilibili.com/x/frontend/finger/spi",
  );
  assert.equal(
    mock.requests[2]?.url,
    "https://passport.bilibili.com/x/passport-login/web/sms/send",
  );
  assert.equal(mock.requests[2]?.method, "POST");
  assert.equal(
    mock.requests[2]?.headers.get("cookie"),
    "buvid3=buvid-3; buvid4=buvid-4",
  );
  assert.match(mock.requests[2]?.body ?? "", /tel=13800138000/);
  assert.match(mock.requests[2]?.body ?? "", /token=captcha-token-2/);
  assert.match(mock.requests[2]?.body ?? "", /seccode=validate-2%7Cjordan/);
});

test("Bilibili provider stores SMS login credentials server-side on success", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          type: "geetest",
          token: "captcha-token-3",
          geetest: {
            gt: "gt-3",
            challenge: "challenge-3",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          b_3: "buvid-3",
          b_4: "buvid-4",
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          captcha_key: "sms-captcha-key-2",
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          url: "https://passport.bilibili.com/login/success",
          status: 0,
          is_new: false,
        },
      },
      setCookies: [
        "SESSDATA=sms-session-secret; Path=/; Domain=bilibili.com; HttpOnly; Secure",
        "bili_jct=sms-csrf-secret; Path=/; Domain=bilibili.com",
        "DedeUserID=10087; Path=/; Domain=bilibili.com",
      ],
    },
  ]);
  const authSessions = createAuthService(() => 40_000);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    authSessions,
    now: () => 40_000,
    createFlowId: () => "sms-flow-3",
  });
  const flow = await provider.auth.start({
    method: "sms",
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
  });
  await provider.auth.poll({
    flowId: flow.flowId,
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
    sms: {
      phoneNumber: "13800138000",
      captcha: {
        token: "captcha-token-3",
        challenge: "challenge-3",
        validate: "validate-3",
      },
    },
  });

  const result = await provider.auth.poll({
    flowId: flow.flowId,
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
    sms: {
      code: "123456",
    },
  });

  assert.deepEqual(result, {
    status: "authorized",
    profile: { id: "10087" },
    expiresAt: 640_000,
  });
  assert.equal(JSON.stringify(result).includes("sms-session-secret"), false);
  assert.equal(mock.requests[3]?.method, "POST");
  assert.match(mock.requests[3]?.body ?? "", /code=123456/);
  assert.match(mock.requests[3]?.body ?? "", /captcha_key=sms-captcha-key-2/);
  assert.deepEqual(
    await authSessions.getCredentials({
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
    }),
    {
      cookies:
        "SESSDATA=sms-session-secret; bili_jct=sms-csrf-secret; DedeUserID=10087",
      csrf: "sms-csrf-secret",
    },
  );
});

test("Bilibili provider reports SMS verification failures without storing credentials", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          type: "geetest",
          token: "captcha-token-4",
          geetest: {
            gt: "gt-4",
            challenge: "challenge-4",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          b_3: "buvid-3",
          b_4: "buvid-4",
        },
      },
    },
    {
      body: {
        code: 2406,
        message: "captcha failed",
      },
    },
  ]);
  const authSessions = createAuthService(() => 50_000);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    authSessions,
    now: () => 50_000,
    createFlowId: () => "sms-flow-4",
  });
  const flow = await provider.auth.start({
    method: "sms",
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
  });

  assert.deepEqual(
    await provider.auth.poll({
      flowId: flow.flowId,
      roomCode: "ABC123",
      ownerMemberId: "owner-1",
      sms: {
        phoneNumber: "13800138000",
        captcha: {
          token: "captcha-token-4",
          challenge: "challenge-4",
          validate: "bad-validate",
        },
      },
    }),
    { status: "failed", message: "Captcha verification failed." },
  );
  assert.equal(
    await authSessions.getCredentials({
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
    }),
    null,
  );
});

test("Bilibili provider me fetches non-sensitive profile from nav API", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          isLogin: true,
          mid: 10086,
          uname: "Alice B",
          face: "https://i0.hdslb.com/bfs/face/alice.jpg",
          vipStatus: 1,
          vipType: 2,
          vip_label: {
            text: "annual",
          },
        },
      },
    },
  ]);
  const authSessions = createAuthService(() => 60_000);
  await authSessions.authorize({
    roomCode: "ABC123",
    providerId: "bilibili",
    ownerMemberId: "owner-1",
    profile: { id: "10086" },
    credentials: {
      cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
      csrf: "csrf-secret",
    },
  });
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    authSessions,
    now: () => 60_000,
  });

  const status = await provider.auth.me({
    roomCode: "ABC123",
    ownerMemberId: "owner-1",
  });

  assert.deepEqual(status, {
    authorized: true,
    profile: {
      id: "10086",
      displayName: "Alice B",
      avatarUrl: "https://i0.hdslb.com/bfs/face/alice.jpg",
      vipLabel: "annual",
    },
    expiresAt: 660_000,
  });
  assert.equal(
    mock.requests[0]?.url,
    "https://api.bilibili.com/x/web-interface/nav",
  );
  assert.equal(
    mock.requests[0]?.headers.get("cookie"),
    "SESSDATA=session-secret; bili_jct=csrf-secret",
  );
  assert.equal(JSON.stringify(status).includes("session-secret"), false);
});

test("Bilibili provider me clears expired credentials when nav reports logged out", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          isLogin: false,
        },
      },
    },
  ]);
  const authSessions = createAuthService(() => 70_000);
  await authSessions.authorize({
    roomCode: "ABC123",
    providerId: "bilibili",
    ownerMemberId: "owner-1",
    profile: { id: "10086" },
    credentials: {
      cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
      csrf: "csrf-secret",
    },
  });
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    authSessions,
    now: () => 70_000,
  });

  assert.deepEqual(
    await provider.auth.me({
      roomCode: "ABC123",
      ownerMemberId: "owner-1",
    }),
    { authorized: false, profile: null },
  );
  assert.equal(
    await authSessions.getCredentials({
      roomCode: "ABC123",
      providerId: "bilibili",
      ownerMemberId: "owner-1",
    }),
    null,
  );
});

test("Bilibili provider parses normal video parts into safe playback candidates", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          aid: 123456,
          bvid: "BV1normal",
          title: "Normal Video",
          pages: [
            {
              cid: 111,
              page: 1,
              part: "Part 1",
              duration: 60,
            },
            {
              cid: 222,
              page: 2,
              part: "Part 2",
              duration: 120,
            },
          ],
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          b_3: "parse-buvid-3",
          b_4: "parse-buvid-4",
        },
      },
    },
    {
      body: {
        code: -101,
        message: "?????",
        data: {
          isLogin: false,
          wbi_img: {
            img_url:
              "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzabcdef.png",
            sub_url:
              "https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          quality: 80,
          accept_quality: [80],
          accept_description: ["1080P"],
          durl: [
            {
              order: 1,
              url: "https://upos.example.test/video-cid-111-1080p.mp4",
              length: 60_000,
              size: 9_000_000,
            },
          ],
          support_formats: [
            {
              quality: 80,
              new_description: "1080P",
              codecs: ["avc1.640028"],
            },
          ],
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          quality: 64,
          accept_quality: [64],
          accept_description: ["720P"],
          durl: [
            {
              order: 1,
              url: "https://upos.example.test/video-cid-222-720p.mp4",
              length: 120_000,
              size: 12_000_000,
            },
          ],
          support_formats: [
            {
              quality: 64,
              new_description: "720P",
              codecs: ["avc1.64001f"],
            },
          ],
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    now: () => 1_700_000_000_000,
  });

  const result = await provider.parse({
    matchedUrl: {
      providerId: "bilibili",
      kind: "ugc",
      rawId: "BV1normal",
      page: 2,
      normalizedUrl: "https://www.bilibili.com/video/BV1normal?p=2",
      requiresResolution: false,
    },
    policy: { proxy: true, shared: true },
    credentials: {
      cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
      csrf: "csrf-secret",
    },
  });

  assert.deepEqual(stripInternalCandidateFields(result), {
    providerId: "bilibili",
    sourceId: "BV1normal",
    sourceUrl: "https://www.bilibili.com/video/BV1normal?p=2",
    title: "Normal Video",
    items: [
      {
        item: {
          itemId: "cid-111",
          title: "Part 1",
          kind: "part",
          aid: "123456",
          bvid: "BV1normal",
          cid: "111",
          durationSeconds: 60,
        },
        candidates: [
          {
            id: "mp4-80-1",
            sourceType: "mp4",
            url: "https://upos.example.test/video-cid-111-1080p.mp4",
            mimeType: "video/mp4",
            codecs: "avc1.640028",
            qualityLabel: "1080P",
            bandwidth: 1200000,
            default: true,
          },
        ],
        defaultCandidateId: "mp4-80-1",
      },
      {
        item: {
          itemId: "cid-222",
          title: "Part 2",
          kind: "part",
          aid: "123456",
          bvid: "BV1normal",
          cid: "222",
          durationSeconds: 120,
        },
        candidates: [
          {
            id: "mp4-64-1",
            sourceType: "mp4",
            url: "https://upos.example.test/video-cid-222-720p.mp4",
            mimeType: "video/mp4",
            codecs: "avc1.64001f",
            qualityLabel: "720P",
            bandwidth: 800000,
            default: true,
          },
        ],
        defaultCandidateId: "mp4-64-1",
      },
    ],
  });
  assert.equal(
    JSON.stringify(stripInternalCandidateFields(result)).includes(
      "session-secret",
    ),
    false,
  );
  assert.equal(
    mock.requests[0]?.url,
    "https://api.bilibili.com/x/web-interface/view?bvid=BV1normal",
  );
  assert.equal(
    mock.requests[1]?.url,
    "https://api.bilibili.com/x/frontend/finger/spi",
  );
  assert.equal(
    mock.requests[2]?.url,
    "https://api.bilibili.com/x/web-interface/nav",
  );
  const firstPlayUrl = new URL(mock.requests[3]?.url ?? "");
  assert.equal(
    `${firstPlayUrl.origin}${firstPlayUrl.pathname}`,
    "https://api.bilibili.com/x/player/wbi/playurl",
  );
  assert.equal(firstPlayUrl.searchParams.get("bvid"), "BV1normal");
  assert.equal(firstPlayUrl.searchParams.get("cid"), "111");
  assert.equal(firstPlayUrl.searchParams.get("platform"), "html5");
  assert.equal(firstPlayUrl.searchParams.get("high_quality"), "1");
  assert.equal(firstPlayUrl.searchParams.get("wts"), "1700000000");
  assert.match(firstPlayUrl.searchParams.get("w_rid") ?? "", /^[0-9a-f]{32}$/);
  const secondPlayUrl = new URL(mock.requests[4]?.url ?? "");
  assert.equal(secondPlayUrl.searchParams.get("cid"), "222");
  assert.equal(secondPlayUrl.searchParams.get("wts"), "1700000000");
  assert.match(secondPlayUrl.searchParams.get("w_rid") ?? "", /^[0-9a-f]{32}$/);
  assert.equal(
    mock.requests[3]?.headers.get("cookie"),
    "SESSDATA=session-secret; bili_jct=csrf-secret; buvid3=parse-buvid-3; buvid4=parse-buvid-4",
  );
  assert.equal(
    mock.requests[3]?.headers.get("referer"),
    "https://www.bilibili.com",
  );
  assert.match(mock.requests[3]?.headers.get("user-agent") ?? "", /Mozilla/);
});

test("Bilibili provider expands accepted video qualities into selectable candidates", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          aid: 123456,
          bvid: "BV1quality",
          title: "Quality Video",
          pages: [
            {
              cid: 111,
              page: 1,
              part: "Part 1",
              duration: 60,
            },
          ],
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          b_3: "parse-buvid-3",
          b_4: "parse-buvid-4",
        },
      },
    },
    {
      body: {
        code: -101,
        message: "not logged in",
        data: {
          isLogin: false,
          wbi_img: {
            img_url:
              "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzabcdef.png",
            sub_url:
              "https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          quality: 80,
          accept_quality: [80, 64],
          accept_description: ["1080P", "720P"],
          durl: [
            {
              order: 1,
              url: "https://upos.example.test/video-cid-111-1080p.mp4",
              length: 60_000,
              size: 9_000_000,
            },
          ],
          support_formats: [
            {
              quality: 80,
              new_description: "1080P",
              codecs: ["avc1.640028"],
            },
            {
              quality: 64,
              new_description: "720P",
              codecs: ["avc1.64001f"],
            },
          ],
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          quality: 64,
          accept_quality: [80, 64],
          accept_description: ["1080P", "720P"],
          durl: [
            {
              order: 1,
              url: "https://upos.example.test/video-cid-111-720p.mp4",
              length: 60_000,
              size: 6_000_000,
            },
          ],
          support_formats: [
            {
              quality: 80,
              new_description: "1080P",
              codecs: ["avc1.640028"],
            },
            {
              quality: 64,
              new_description: "720P",
              codecs: ["avc1.64001f"],
            },
          ],
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    now: () => 1_700_000_000_000,
  });

  const result = await provider.parse({
    matchedUrl: {
      providerId: "bilibili",
      kind: "ugc",
      rawId: "BV1quality",
      page: 1,
      normalizedUrl: "https://www.bilibili.com/video/BV1quality",
      requiresResolution: false,
    },
    policy: { proxy: true, shared: true },
    credentials: {
      cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
      csrf: "csrf-secret",
    },
  });

  assert.deepEqual(
    result.items[0]?.candidates.map((candidate) => candidate.qualityLabel),
    ["1080P", "720P"],
  );
  assert.deepEqual(
    result.items[0]?.candidates.map((candidate) => candidate.url),
    [
      "https://upos.example.test/video-cid-111-1080p.mp4",
      "https://upos.example.test/video-cid-111-720p.mp4",
    ],
  );
  assert.equal(result.items[0]?.defaultCandidateId, "mp4-80-1");
  assert.equal(
    new URL(mock.requests[3]?.url ?? "").searchParams.get("qn"),
    "0",
  );
  assert.equal(
    new URL(mock.requests[4]?.url ?? "").searchParams.get("qn"),
    "64",
  );
});

test("Bilibili provider parses shared=false video without host credentials", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          aid: 123456,
          bvid: "BV1anonymous",
          title: "Anonymous Video",
          pages: [{ cid: 111, page: 1, part: "Part 1", duration: 60 }],
        },
      },
    },
    {
      body: {
        code: 0,
        data: { b_3: "anonymous-buvid-3", b_4: "anonymous-buvid-4" },
      },
    },
    {
      body: {
        code: 0,
        data: {
          wbi_img: {
            img_url:
              "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzabcdef.png",
            sub_url:
              "https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          quality: 64,
          accept_quality: [64],
          accept_description: ["720P"],
          durl: [
            {
              order: 1,
              url: "https://upos.example.test/anonymous-720p.mp4",
              length: 60_000,
              size: 6_000_000,
            },
          ],
          support_formats: [
            {
              quality: 64,
              new_description: "720P",
              codecs: ["avc1.64001f"],
            },
          ],
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    now: () => 1_700_000_000_000,
  });

  const result = await provider.parse({
    matchedUrl: {
      providerId: "bilibili",
      kind: "ugc",
      rawId: "BV1anonymous",
      page: null,
      normalizedUrl: "https://www.bilibili.com/video/BV1anonymous",
      requiresResolution: false,
    },
    policy: { proxy: false, shared: false },
    credentials: {
      cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
      csrf: "csrf-secret",
    },
  });

  assert.equal(
    result.items[0]?.candidates[0]?.url,
    "https://upos.example.test/anonymous-720p.mp4",
  );
  for (const request of mock.requests) {
    assert.doesNotMatch(
      request.headers.get("cookie") ?? "",
      /SESSDATA|bili_jct/,
    );
  }
});

test("Bilibili provider reports anonymous shared=false parse downgrade", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          aid: 123456,
          bvid: "BV1anonymous",
          title: "Anonymous Video",
          pages: [{ cid: 111, page: 1, part: "Part 1", duration: 60 }],
        },
      },
    },
    {
      body: {
        code: 0,
        data: { b_3: "anonymous-buvid-3", b_4: "anonymous-buvid-4" },
      },
    },
    {
      body: {
        code: 0,
        data: {
          wbi_img: {
            img_url:
              "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzabcdef.png",
            sub_url:
              "https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          quality: 64,
          accept_quality: [64],
          accept_description: ["720P"],
          durl: [],
          support_formats: [],
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    now: () => 1_700_000_000_000,
  });

  await assert.rejects(
    () =>
      provider.parse({
        matchedUrl: {
          providerId: "bilibili",
          kind: "ugc",
          rawId: "BV1anonymous",
          page: null,
          normalizedUrl: "https://www.bilibili.com/video/BV1anonymous",
          requiresResolution: false,
        },
        policy: { proxy: false, shared: false },
        credentials: {
          cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
          csrf: "csrf-secret",
        },
      }),
    (error) =>
      error instanceof VideoProviderError &&
      error.code === "provider_parse_failed" &&
      error.reason === "anonymous_no_playback_candidates",
  );
});

test("Bilibili provider parses bangumi episode into a safe playback item", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        result: {
          season_id: 98765,
          title: "Season Title",
          episodes: [
            {
              ep_id: 123456,
              cid: 333,
              aid: 456,
              bvid: "BV1pgcEp",
              title: "1",
              long_title: "Episode One",
              share_copy: "Episode 1 - One",
              duration: 1_500_000,
            },
            {
              ep_id: 123457,
              cid: 334,
              aid: 457,
              bvid: "BV1pgcEp2",
              title: "2",
              long_title: "Episode Two",
              duration: 1_600_000,
            },
          ],
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          b_3: "pgc-buvid-3",
          b_4: "pgc-buvid-4",
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          wbi_img: {
            img_url:
              "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzabcdef.png",
            sub_url:
              "https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        result: {
          quality: 80,
          accept_quality: [80],
          accept_description: ["1080P"],
          is_preview: 0,
          has_paid: true,
          timelength: 1_500_000,
          dash: {
            duration: 1500,
            minBufferTime: 1.5,
            video: [
              {
                id: 80,
                baseUrl:
                  "https://upos.example.test/pgc-ep-123456-avc.m4s?token=video",
                backupUrl: [
                  "https://backup.example.test/pgc-ep-123456-avc.m4s?token=backup",
                ],
                bandwidth: 5_000_000,
                mimeType: "video/mp4",
                codecs: "avc1.640028",
                width: 1920,
                height: 1080,
                frameRate: "24",
                SegmentBase: {
                  Initialization: "0-999",
                  indexRange: "1000-1999",
                },
              },
              {
                id: 80,
                baseUrl:
                  "https://upos.example.test/pgc-ep-123456-hevc.m4s?token=video",
                bandwidth: 4_000_000,
                mimeType: "video/mp4",
                codecs: "hev1.1.6.L120.90",
                width: 1920,
                height: 1080,
                SegmentBase: {
                  Initialization: "0-999",
                  indexRange: "1000-1999",
                },
              },
            ],
            audio: [
              {
                id: 30280,
                baseUrl:
                  "https://upos.example.test/pgc-ep-123456-audio.m4s?token=audio",
                backup_url: [
                  "https://backup.example.test/pgc-ep-123456-audio.m4s?token=backup",
                ],
                bandwidth: 192_000,
                mimeType: "audio/mp4",
                codecs: "mp4a.40.2",
                SegmentBase: {
                  Initialization: "0-199",
                  indexRange: "200-299",
                },
              },
            ],
          },
          durl: [
            {
              order: 1,
              url: "https://upos.example.test/pgc-ep-123456.mp4",
              length: 1_500_000,
              size: 150_000_000,
            },
          ],
          support_formats: [
            {
              quality: 80,
              new_description: "1080P",
              codecs: ["avc1.640028"],
            },
          ],
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    now: () => 1_700_000_000_000,
    logEvent(event, data) {
      events.push({ event, data: data ?? {} });
    },
  });

  const result = await provider.parse({
    matchedUrl: {
      providerId: "bilibili",
      kind: "pgc",
      rawId: "ep123456",
      page: null,
      normalizedUrl: "https://www.bilibili.com/bangumi/play/ep123456",
      requiresResolution: false,
    },
    policy: { proxy: true, shared: true },
    credentials: {
      cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
      csrf: "csrf-secret",
    },
  });
  const firstCandidate = result.items[0]?.candidates[0] as
    | (Record<string, unknown> & { manifest?: string })
    | undefined;
  assert.equal(typeof firstCandidate?.manifest, "string");
  assert.match(firstCandidate.manifest ?? "", /<MPD /);
  assert.match(
    firstCandidate.manifest ?? "",
    /pgc-ep-123456-avc\.m4s\?token=video/,
  );
  assert.match(
    firstCandidate.manifest ?? "",
    /pgc-ep-123456-audio\.m4s\?token=audio/,
  );
  assert.doesNotMatch(firstCandidate.manifest ?? "", /session-secret/);
  assert.deepEqual(firstCandidate.upstreamHeaders, {
    Cookie:
      "SESSDATA=session-secret; bili_jct=csrf-secret; buvid3=pgc-buvid-3; buvid4=pgc-buvid-4",
  });
  assert.deepEqual(firstCandidate.upstreamUrlAlternates, {
    "https://upos.example.test/pgc-ep-123456-audio.m4s?token=audio": [
      "https://backup.example.test/pgc-ep-123456-audio.m4s?token=backup",
    ],
    "https://upos.example.test/pgc-ep-123456-avc.m4s?token=video": [
      "https://backup.example.test/pgc-ep-123456-avc.m4s?token=backup",
    ],
  });
  const resultWithoutInternalManifest = {
    ...result,
    items: result.items.map((item) => ({
      ...item,
      candidates: item.candidates.map((candidate) => {
        const {
          manifest: _manifest,
          upstreamHeaders: _upstreamHeaders,
          upstreamUrlAlternates: _upstreamUrlAlternates,
          upstreamUrls: _upstreamUrls,
          ...publicCandidate
        } = candidate as Record<string, unknown>;
        return publicCandidate;
      }),
    })),
  };

  assert.deepEqual(resultWithoutInternalManifest, {
    providerId: "bilibili",
    sourceId: "ep123456",
    sourceUrl: "https://www.bilibili.com/bangumi/play/ep123456",
    title: "Season Title",
    items: [
      {
        item: {
          itemId: "ep-123456",
          title: "Episode 1 - One",
          kind: "episode",
          aid: "456",
          bvid: "BV1pgcEp",
          cid: "333",
          epId: "123456",
          seasonId: "98765",
          durationSeconds: 1500,
        },
        candidates: [
          {
            id: "dash-80-1",
            sourceType: "mpd",
            url: "https://upos.example.test/pgc-ep-123456-avc.m4s?token=video",
            mimeType: "application/dash+xml",
            codecs: "avc1.640028,mp4a.40.2",
            qualityLabel: "1080P",
            width: 1920,
            height: 1080,
            bandwidth: 5_192_000,
            default: true,
          },
          {
            id: "dash-80-2",
            sourceType: "mpd",
            url: "https://upos.example.test/pgc-ep-123456-hevc.m4s?token=video",
            mimeType: "application/dash+xml",
            codecs: "hev1.1.6.L120.90,mp4a.40.2",
            qualityLabel: "1080P",
            width: 1920,
            height: 1080,
            bandwidth: 4_192_000,
            default: false,
          },
        ],
        defaultCandidateId: "dash-80-1",
      },
    ],
  });
  assert.equal(
    JSON.stringify(resultWithoutInternalManifest).includes("session-secret"),
    false,
  );
  assert.equal(
    mock.requests[0]?.url,
    "https://api.bilibili.com/pgc/view/web/season?ep_id=123456",
  );
  assert.equal(
    mock.requests[1]?.url,
    "https://api.bilibili.com/x/frontend/finger/spi",
  );
  assert.equal(
    mock.requests[2]?.url,
    "https://api.bilibili.com/x/web-interface/nav",
  );
  const playUrl = new URL(mock.requests[3]?.url ?? "");
  assert.equal(
    `${playUrl.origin}${playUrl.pathname}`,
    "https://api.bilibili.com/pgc/player/web/playurl",
  );
  assert.equal(playUrl.searchParams.get("ep_id"), "123456");
  assert.equal(playUrl.searchParams.get("qn"), null);
  assert.equal(playUrl.searchParams.get("fourk"), null);
  assert.equal(playUrl.searchParams.get("fnver"), "0");
  assert.equal(playUrl.searchParams.get("platform"), "pc");
  assert.equal(playUrl.searchParams.get("fnval"), "1168");
  assert.equal(playUrl.searchParams.get("wts"), "1700000000");
  assert.match(playUrl.searchParams.get("w_rid") ?? "", /^[0-9a-f]{32}$/);
  assert.equal(
    mock.requests[3]?.headers.get("cookie"),
    "SESSDATA=session-secret; bili_jct=csrf-secret; buvid3=pgc-buvid-3; buvid4=pgc-buvid-4",
  );
  assert.deepEqual(events, [
    {
      event: "bilibili_pgc_playurl_resolved",
      data: {
        sourceId: "ep123456",
        epId: "123456",
        hasCredentials: true,
        cookieNames: ["SESSDATA", "bili_jct"],
        code: 0,
        quality: 80,
        acceptQuality: [80],
        isPreview: false,
        hasPaid: true,
        timeLengthMs: 1_500_000,
        durlCount: 1,
        dashVideoCount: 2,
        dashAudioCount: 1,
        firstDurlLengthMs: 1_500_000,
        firstDurlSizeBytes: 150_000_000,
        result: "ok",
      },
    },
  ]);
  assert.equal(JSON.stringify(events).includes("session-secret"), false);
  assert.equal(JSON.stringify(events).includes("pgc-ep-123456"), false);
});

test("Bilibili provider parses bangumi preview-only playback metadata as playable preview", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        result: {
          season_id: 98765,
          title: "Preview Season",
          episodes: [
            {
              ep_id: 123456,
              cid: 333,
              aid: 456,
              bvid: "BV1pgcPreview",
              title: "1",
              long_title: "Movie",
              duration: 7_200_000,
            },
          ],
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          b_3: "pgc-preview-buvid-3",
          b_4: "pgc-preview-buvid-4",
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          wbi_img: {
            img_url:
              "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzabcdef.png",
            sub_url:
              "https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        result: {
          quality: 32,
          accept_quality: [32],
          accept_description: ["480P 标清"],
          is_preview: 1,
          has_paid: false,
          timelength: 360_000,
          durl: [
            {
              order: 1,
              url: "https://upos.example.test/pgc-preview-6min.mp4",
              length: 360_000,
              size: 36_000_000,
            },
          ],
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    now: () => 1_700_000_000_000,
  });

  const result = await provider.parse({
    matchedUrl: {
      providerId: "bilibili",
      kind: "pgc",
      rawId: "ep123456",
      page: null,
      normalizedUrl: "https://www.bilibili.com/bangumi/play/ep123456",
      requiresResolution: false,
    },
    policy: { proxy: true, shared: true },
    credentials: {
      cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
      csrf: "csrf-secret",
    },
  });

  assert.equal(result.providerId, "bilibili");
  assert.equal(result.sourceId, "ep123456");
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0], {
    item: {
      itemId: "ep-123456",
      title: "Movie",
      kind: "episode",
      aid: "456",
      bvid: "BV1pgcPreview",
      cid: "333",
      epId: "123456",
      seasonId: "98765",
      durationSeconds: 7200,
    },
    candidates: [
      {
        id: "mp4-32-1",
        sourceType: "mp4",
        url: "https://upos.example.test/pgc-preview-6min.mp4",
        mimeType: "video/mp4",
        qualityLabel: "480P 标清",
        bandwidth: 800_000,
        upstreamHeaders: {
          Cookie:
            "SESSDATA=session-secret; bili_jct=csrf-secret; buvid3=pgc-preview-buvid-3; buvid4=pgc-preview-buvid-4",
        },
        default: true,
      },
    ],
    defaultCandidateId: "mp4-32-1",
    requiresProxy: true,
  });
});

test("Bilibili provider parses bangumi season into selectable episodes", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        result: {
          season_id: "98765",
          title: "Season Playlist",
          episodes: [
            {
              ep_id: 101,
              cid: 201,
              aid: 301,
              bvid: "BV1pgc101",
              title: "1",
              long_title: "Episode A",
              duration: 900_000,
            },
            {
              ep_id: 102,
              cid: 202,
              aid: 302,
              bvid: "BV1pgc102",
              title: "2",
              long_title: "Episode B",
              duration: 1000,
            },
          ],
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          b_3: "pgc-season-buvid-3",
          b_4: "pgc-season-buvid-4",
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          wbi_img: {
            img_url:
              "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzabcdef.png",
            sub_url:
              "https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        result: {
          quality: 64,
          accept_quality: [64],
          accept_description: ["720P"],
          durl: [
            {
              order: 1,
              url: "https://upos.example.test/pgc-ep-101.mp4",
              length: 900_000,
              size: 72_000_000,
            },
          ],
          support_formats: [
            {
              quality: 64,
              new_description: "720P",
              codecs: ["avc1.64001f"],
            },
          ],
        },
      },
    },
    {
      body: {
        code: 0,
        result: {
          quality: 80,
          accept_quality: [80],
          accept_description: ["1080P"],
          durl: [
            {
              order: 1,
              url: "https://upos.example.test/pgc-ep-102.mp4",
              length: 1_000_000,
              size: 100_000_000,
            },
          ],
          support_formats: [
            {
              quality: 80,
              new_description: "1080P",
              codecs: ["avc1.640028"],
            },
          ],
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    now: () => 1_700_000_000_000,
  });

  const result = await provider.parse({
    matchedUrl: {
      providerId: "bilibili",
      kind: "pgc",
      rawId: "ss98765",
      page: null,
      normalizedUrl: "https://www.bilibili.com/bangumi/play/ss98765",
      requiresResolution: false,
    },
    policy: { proxy: true, shared: true },
    credentials: {
      cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
      csrf: "csrf-secret",
    },
  });

  assert.deepEqual(stripInternalCandidateFields(result), {
    providerId: "bilibili",
    sourceId: "ss98765",
    sourceUrl: "https://www.bilibili.com/bangumi/play/ss98765",
    title: "Season Playlist",
    items: [
      {
        item: {
          itemId: "ep-101",
          title: "Episode A",
          kind: "episode",
          aid: "301",
          bvid: "BV1pgc101",
          cid: "201",
          epId: "101",
          seasonId: "98765",
          durationSeconds: 900,
        },
        candidates: [
          {
            id: "mp4-64-1",
            sourceType: "mp4",
            url: "https://upos.example.test/pgc-ep-101.mp4",
            mimeType: "video/mp4",
            codecs: "avc1.64001f",
            qualityLabel: "720P",
            bandwidth: 640000,
            default: true,
          },
        ],
        defaultCandidateId: "mp4-64-1",
      },
      {
        item: {
          itemId: "ep-102",
          title: "Episode B",
          kind: "episode",
          aid: "302",
          bvid: "BV1pgc102",
          cid: "202",
          epId: "102",
          seasonId: "98765",
          durationSeconds: 1000,
        },
        candidates: [
          {
            id: "mp4-80-1",
            sourceType: "mp4",
            url: "https://upos.example.test/pgc-ep-102.mp4",
            mimeType: "video/mp4",
            codecs: "avc1.640028",
            qualityLabel: "1080P",
            bandwidth: 800000,
            default: true,
          },
        ],
        defaultCandidateId: "mp4-80-1",
      },
    ],
  });
  assert.equal(
    JSON.stringify(stripInternalCandidateFields(result)).includes(
      "session-secret",
    ),
    false,
  );
  assert.equal(
    mock.requests[0]?.url,
    "https://api.bilibili.com/pgc/view/web/season?season_id=98765",
  );
  assert.equal(
    mock.requests[1]?.url,
    "https://api.bilibili.com/x/frontend/finger/spi",
  );
  assert.equal(
    mock.requests[2]?.url,
    "https://api.bilibili.com/x/web-interface/nav",
  );
  const firstPlayUrl = new URL(mock.requests[3]?.url ?? "");
  assert.equal(
    `${firstPlayUrl.origin}${firstPlayUrl.pathname}`,
    "https://api.bilibili.com/pgc/player/web/playurl",
  );
  assert.equal(firstPlayUrl.searchParams.get("ep_id"), "101");
  assert.equal(firstPlayUrl.searchParams.get("qn"), null);
  assert.equal(firstPlayUrl.searchParams.get("fourk"), null);
  assert.equal(firstPlayUrl.searchParams.get("fnval"), "1168");
  assert.equal(firstPlayUrl.searchParams.get("wts"), "1700000000");
  assert.match(firstPlayUrl.searchParams.get("w_rid") ?? "", /^[0-9a-f]{32}$/);
  const secondPlayUrl = new URL(mock.requests[4]?.url ?? "");
  assert.equal(secondPlayUrl.searchParams.get("ep_id"), "102");
  assert.equal(secondPlayUrl.searchParams.get("qn"), null);
  assert.equal(secondPlayUrl.searchParams.get("fourk"), null);
  assert.equal(secondPlayUrl.searchParams.get("fnval"), "1168");
  assert.equal(secondPlayUrl.searchParams.get("wts"), "1700000000");
  assert.match(secondPlayUrl.searchParams.get("w_rid") ?? "", /^[0-9a-f]{32}$/);
  assert.equal(
    mock.requests[3]?.headers.get("cookie"),
    "SESSDATA=session-secret; bili_jct=csrf-secret; buvid3=pgc-season-buvid-3; buvid4=pgc-season-buvid-4",
  );
  assert.equal(
    mock.requests[4]?.headers.get("cookie"),
    "SESSDATA=session-secret; bili_jct=csrf-secret; buvid3=pgc-season-buvid-3; buvid4=pgc-season-buvid-4",
  );
});

test("Bilibili provider prefers fMP4 AVC live HLS from web play info", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          title: "Live Room Title",
          user_cover: "https://i0.hdslb.com/live-cover.jpg",
          uid: 1001,
          room_id: 987654,
          sort_id: 123456,
          live_status: 1,
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          room_id: 987654,
          live_status: 1,
          playurl_info: {
            playurl: {
              g_qn_desc: [
                {
                  qn: 400,
                  desc: "蓝光",
                },
                {
                  qn: 250,
                  desc: "超清",
                },
              ],
              stream: [
                {
                  protocol_name: "http_hls",
                  format: [
                    {
                      format_name: "ts",
                      codec: [
                        {
                          codec_name: "avc",
                          current_qn: 400,
                          base_url: "/live/ts/index.m3u8?",
                          url_info: [
                            {
                              host: "https://live-play.example.test",
                              extra: "token=ts",
                            },
                          ],
                        },
                      ],
                    },
                    {
                      format_name: "fmp4",
                      codec: [
                        {
                          codec_name: "hevc",
                          current_qn: 250,
                          base_url: "/live/hevc/index.m3u8?",
                          url_info: [
                            {
                              host: "https://live-play.example.test",
                              extra: "token=hevc",
                            },
                          ],
                        },
                        {
                          codec_name: "avc",
                          current_qn: 400,
                          base_url: "/live/avc/index.m3u8?",
                          url_info: [
                            {
                              host: "https://live-play.example.test",
                              extra: "token=avc",
                            },
                            {
                              host: "https://live-backup.example.test",
                              extra: "token=avc-backup",
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({ fetch: mock.fetch });

  const result = await provider.parse({
    matchedUrl: {
      providerId: "bilibili",
      kind: "live",
      rawId: "123456",
      page: null,
      normalizedUrl: "https://live.bilibili.com/123456",
      requiresResolution: false,
    },
    policy: { proxy: true, shared: true },
    credentials: {
      cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
      csrf: "csrf-secret",
    },
  });

  assert.deepEqual(result, {
    providerId: "bilibili",
    sourceId: "123456",
    sourceUrl: "https://live.bilibili.com/123456",
    title: "Live Room Title",
    items: [
      {
        item: {
          itemId: "live-987654",
          title: "Live Room Title",
          kind: "live",
          roomId: "987654",
        },
        candidates: [
          {
            id: "hls-fmp4-avc-400-1",
            sourceType: "m3u8",
            url: "https://live-play.example.test/live/avc/index.m3u8?token=avc",
            mimeType: "application/vnd.apple.mpegurl",
            qualityLabel: "蓝光",
            codecs: "avc",
            default: true,
            upstreamUrlAlternates: {
              "https://live-play.example.test/live/avc/index.m3u8?token=avc": [
                "https://live-backup.example.test/live/avc/index.m3u8?token=avc-backup",
              ],
            },
          },
          {
            id: "hls-fmp4-hevc-250-1",
            sourceType: "m3u8",
            url: "https://live-play.example.test/live/hevc/index.m3u8?token=hevc",
            mimeType: "application/vnd.apple.mpegurl",
            qualityLabel: "超清",
            codecs: "hevc",
            default: false,
          },
        ],
        defaultCandidateId: "hls-fmp4-avc-400-1",
      },
    ],
  });
  assert.equal(JSON.stringify(result).includes("session-secret"), false);
  assert.equal(
    mock.requests[0]?.url,
    "https://api.live.bilibili.com/room/v1/Room/get_info?room_id=123456",
  );
  assert.equal(
    mock.requests[1]?.url,
    "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo?room_id=987654&protocol=0%2C1&format=0%2C1%2C2&codec=0%2C1%2C2&qn=10000&platform=web&ptype=8",
  );
  assert.equal(
    mock.requests[1]?.headers.get("cookie"),
    "SESSDATA=session-secret; bili_jct=csrf-secret",
  );
});

test("Bilibili provider rejects live rooms without an HLS playlist", async () => {
  const mock = createMockFetch([
    {
      body: {
        code: 0,
        data: {
          title: "Live Room Title",
          room_id: 987654,
          live_status: 1,
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          room_id: 987654,
          live_status: 1,
          playurl_info: {
            playurl: {
              stream: [],
            },
          },
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          current_qn: 4,
          quality_description: [
            {
              qn: 4,
              desc: "Original",
            },
          ],
          durl: [
            {
              order: 1,
              url: "https://live-play.example.test/live-987654/index.flv",
            },
          ],
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({ fetch: mock.fetch });

  await assert.rejects(
    () =>
      provider.parse({
        matchedUrl: {
          providerId: "bilibili",
          kind: "live",
          rawId: "123456",
          page: null,
          normalizedUrl: "https://live.bilibili.com/123456",
          requiresResolution: false,
        },
        policy: { proxy: true, shared: true },
      }),
    (error) =>
      error instanceof Error &&
      error.name === "VideoProviderError" &&
      "reason" in error &&
      error.reason === "no_live_hls_candidates",
  );
});

test("Bilibili provider resolves b23 short links before parsing the target video", async () => {
  const mock = createMockFetch([
    {
      status: 302,
      headers: {
        location:
          "https://www.bilibili.com/video/BV1short?p=1&share_source=copy_web",
      },
      body: {},
    },
    {
      body: {
        code: 0,
        data: {
          aid: 789,
          bvid: "BV1short",
          title: "Short Link Video",
          pages: [
            {
              cid: 456,
              page: 1,
              part: "Short Part",
              duration: 30,
            },
          ],
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          b_3: "short-buvid-3",
          b_4: "short-buvid-4",
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          wbi_img: {
            img_url:
              "https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyzabcdef.png",
            sub_url:
              "https://i0.hdslb.com/bfs/wbi/0123456789abcdef0123456789abcdef.png",
          },
        },
      },
    },
    {
      body: {
        code: 0,
        data: {
          quality: 80,
          accept_quality: [80],
          accept_description: ["1080P"],
          durl: [
            {
              order: 1,
              url: "https://upos.example.test/video-cid-456-1080p.mp4",
              length: 30_000,
              size: 6_000_000,
            },
          ],
          support_formats: [
            {
              quality: 80,
              new_description: "1080P",
              codecs: ["avc1.640028"],
            },
          ],
        },
      },
    },
  ]);
  const provider = createBilibiliProvider({
    fetch: mock.fetch,
    now: () => 1_700_000_000_000,
  });

  const result = await provider.parse({
    matchedUrl: {
      providerId: "bilibili",
      kind: "short-link",
      rawId: "BV1short",
      page: null,
      normalizedUrl: "https://b23.tv/BV1short",
      requiresResolution: true,
    },
    policy: { proxy: true, shared: true },
    credentials: {
      cookies: "SESSDATA=session-secret; bili_jct=csrf-secret",
      csrf: "csrf-secret",
    },
  });

  assert.equal(result.sourceId, "BV1short");
  assert.equal(result.sourceUrl, "https://www.bilibili.com/video/BV1short?p=1");
  assert.equal(result.title, "Short Link Video");
  assert.deepEqual(result.items[0]?.item, {
    itemId: "cid-456",
    title: "Short Part",
    kind: "part",
    aid: "789",
    bvid: "BV1short",
    cid: "456",
    durationSeconds: 30,
  });
  assert.equal(mock.requests[0]?.url, "https://b23.tv/BV1short");
  assert.equal(
    mock.requests[1]?.url,
    "https://api.bilibili.com/x/web-interface/view?bvid=BV1short",
  );
  assert.equal(
    mock.requests[4]?.headers.get("cookie"),
    "SESSDATA=session-secret; bili_jct=csrf-secret; buvid3=short-buvid-3; buvid4=short-buvid-4",
  );
  assert.equal(
    JSON.stringify(stripInternalCandidateFields(result)).includes(
      "session-secret",
    ),
    false,
  );
});
