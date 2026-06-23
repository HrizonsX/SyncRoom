import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { PlaybackProxyPolicy } from "@syncroom/protocol";
import { createPlaybackProxyController } from "../src/playback-proxy/controller.js";
import { createPlaybackProxyRouter } from "../src/playback-proxy/router.js";
import { createPlaybackProxyService } from "../src/playback-proxy/service.js";
import {
  createVideoProviderRegistry,
  type ProviderParseInput,
  VideoProviderError,
  type VideoProviderAdapter,
} from "../src/providers/video-provider.js";
import { createVideoProviderRouter } from "../src/providers/video-provider-router.js";
import { createInMemoryRuntimeStore } from "../src/runtime-store.js";
import { createInMemoryRoomStore } from "../src/room-store.js";
import type { Session } from "../src/types.js";
import {
  createInMemoryVideoAuthSessionStore,
  createVideoAuthSessionService,
} from "../src/video-auth-session.js";

async function listen(
  server: ReturnType<typeof createServer>,
): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to determine server address.");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function createSession(input: {
  id: string;
  memberId: string;
  memberToken: string;
  displayName: string;
}): Session {
  return {
    id: input.id,
    connectionState: "detached",
    socket: null,
    remoteAddress: "127.0.0.1",
    origin: "https://room.example.test",
    roomCode: "ABC123",
    memberId: input.memberId,
    displayName: input.displayName,
    memberToken: input.memberToken,
    joinedAt: 1_000,
    invalidMessageCount: 0,
    rateLimitState: {} as Session["rateLimitState"],
  };
}

async function createRoomFixture() {
  const roomStore = createInMemoryRoomStore({ now: () => 1_000 });
  const runtimeStore = createInMemoryRuntimeStore(() => 1_000);
  await roomStore.createRoom({
    code: "ABC123",
    joinToken: "join-token",
    createdAt: 1_000,
    ownerMemberId: "owner-1",
    ownerDisplayName: "Alice",
  });
  const owner = createSession({
    id: "session-owner",
    memberId: "owner-1",
    memberToken: "owner-token",
    displayName: "Alice",
  });
  const member = createSession({
    id: "session-member",
    memberId: "member-2",
    memberToken: "member-token",
    displayName: "Bob",
  });
  runtimeStore.addMember("ABC123", "owner-1", owner, "owner-token");
  runtimeStore.addMember("ABC123", "member-2", member, "member-token");
  return { roomStore, runtimeStore };
}

function createProviderFixture(
  options: {
    parse?: VideoProviderAdapter["parse"];
  } = {},
) {
  const parseInputs: ProviderParseInput[] = [];
  const authService = createVideoAuthSessionService({
    store: createInMemoryVideoAuthSessionStore(),
    defaultTtlMs: 600_000,
    now: () => 1_000,
  });
  const provider: VideoProviderAdapter = {
    id: "bilibili",
    auth: {
      async start(input) {
        return {
          providerId: "bilibili",
          method: input.method,
          flowId: "flow-1",
          status: "pending",
          expiresAt: 61_000,
          qrCodeUrl: "data:image/png;base64,qr",
          message: "scan",
        };
      },
      async poll(input) {
        await authService.authorize({
          roomCode: input.roomCode,
          providerId: "bilibili",
          ownerMemberId: input.ownerMemberId,
          profile: { id: "mid-1", displayName: "Alice B" },
          credentials: {
            cookies: "SESSDATA=secret-cookie; bili_jct=csrf-secret",
          },
        });
        return {
          status: "authorized",
          profile: { id: "mid-1", displayName: "Alice B" },
          expiresAt: 601_000,
        };
      },
      async me(input) {
        const status = await authService.getStatus({
          roomCode: input.roomCode,
          providerId: "bilibili",
          ownerMemberId: input.ownerMemberId,
        });
        return status
          ? {
              authorized: true,
              profile: status.profile,
              expiresAt: status.expiresAt,
            }
          : { authorized: false, profile: null };
      },
      async logout(input) {
        await authService.logout({
          roomCode: input.roomCode,
          providerId: "bilibili",
          ownerMemberId: input.ownerMemberId,
        });
      },
    },
    matchUrl() {
      return {
        providerId: "bilibili",
        kind: "ugc",
        rawId: "BV1TEST",
        page: null,
        normalizedUrl: "https://www.bilibili.com/video/BV1TEST",
        requiresResolution: false,
      };
    },
    async parse(input) {
      parseInputs.push(input);
      if (options.parse) {
        return options.parse(input);
      }
      return {
        providerId: "bilibili",
        sourceId: "BV1TEST",
        sourceUrl: "https://www.bilibili.com/video/BV1TEST",
        title: "Bilibili Test",
        items: [
          {
            item: {
              itemId: "BV1TEST:cid-1",
              title: "Part 1",
              kind: "part",
              bvid: "BV1TEST",
              cid: "cid-1",
            },
            candidates: [
              {
                id: "mp4-1080p",
                sourceType: "mp4",
                url: "https://upos.example.test/video.mp4?SESSDATA=secret-cookie",
                mimeType: "video/mp4",
                qualityLabel: "1080P",
                default: true,
              },
            ],
            defaultCandidateId: "mp4-1080p",
          },
        ],
      };
    },
  };
  return {
    authService,
    parseInputs,
    registry: createVideoProviderRegistry([provider]),
  };
}

function createDashProviderFixture() {
  const parseInputs: ProviderParseInput[] = [];
  const authService = createVideoAuthSessionService({
    store: createInMemoryVideoAuthSessionStore(),
    defaultTtlMs: 600_000,
    now: () => 1_000,
  });
  const provider: VideoProviderAdapter = {
    id: "bilibili",
    auth: {
      async start(input) {
        return {
          providerId: "bilibili",
          method: input.method,
          flowId: "flow-1",
          status: "pending",
          expiresAt: 61_000,
        };
      },
      async poll() {
        return { status: "pending" };
      },
      async me() {
        return { authorized: false, profile: null };
      },
      async logout() {},
    },
    matchUrl() {
      return {
        providerId: "bilibili",
        kind: "pgc",
        rawId: "ep123456",
        page: null,
        normalizedUrl: "https://www.bilibili.com/bangumi/play/ep123456",
        requiresResolution: false,
      };
    },
    async parse(input) {
      parseInputs.push(input);
      return {
        providerId: "bilibili",
        sourceId: "ep123456",
        sourceUrl: "https://www.bilibili.com/bangumi/play/ep123456",
        title: "Bilibili PGC",
        items: [
          {
            item: {
              itemId: "ep-123456",
              title: "Episode 1",
              kind: "episode",
              epId: "123456",
            },
            candidates: [
              {
                id: "dash-80-1",
                sourceType: "mpd",
                url: "https://upos.example.test/video.m4s?SESSDATA=secret",
                mimeType: "application/dash+xml",
                qualityLabel: "1080P",
                default: true,
                upstreamHeaders: {
                  Cookie:
                    "SESSDATA=secret-cookie; bili_jct=csrf-secret; buvid3=pgc-buvid-3; buvid4=pgc-buvid-4",
                },
                upstreamUrlAlternates: {
                  "https://upos.example.test/video/": [
                    "https://upos-backup.example.test/video/",
                  ],
                },
                manifest: `<?xml version="1.0" encoding="UTF-8"?>
<MPD type="static">
  <Period>
    <AdaptationSet contentType="video">
      <Representation id="video" bandwidth="5000000">
        <BaseURL>https://upos.example.test/video/</BaseURL>
        <SegmentBase indexRange="100-200">
          <Initialization range="0-99" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`,
              },
            ],
            defaultCandidateId: "dash-80-1",
          },
        ],
      };
    },
  };
  return {
    authService,
    parseInputs,
    registry: createVideoProviderRegistry([provider]),
  };
}

async function postJson(baseUrl: string, path: string, body: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

test("video provider router rejects non-host authorization access", async () => {
  const { roomStore, runtimeStore } = await createRoomFixture();
  const { authService, registry } = createProviderFixture();
  const proxyService = createPlaybackProxyService();
  const providerRouter = createVideoProviderRouter({
    roomStore,
    runtimeStore,
    providers: registry,
    authService,
    playbackProxyService: proxyService,
  });
  const server = createServer(async (request, response) => {
    if (await providerRouter.handle(request, response)) {
      return;
    }
    response.writeHead(418);
    response.end();
  });
  const baseUrl = await listen(server);

  try {
    const result = await postJson(
      baseUrl,
      "/api/providers/bilibili/auth/start",
      {
        roomCode: "ABC123",
        memberToken: "member-token",
        method: "qr",
      },
    );

    assert.equal(result.status, 403);
    assert.deepEqual(result.body, {
      ok: false,
      error: {
        code: "provider_auth_forbidden",
        message: "Provider authorization is only available to the room owner.",
      },
    });
  } finally {
    await close(server);
  }
});

test("video provider router returns proxied descriptors without leaking credentials", async () => {
  const { roomStore, runtimeStore } = await createRoomFixture();
  const { authService, parseInputs, registry } = createProviderFixture();
  await authService.authorize({
    roomCode: "ABC123",
    providerId: "bilibili",
    ownerMemberId: "owner-1",
    profile: { id: "mid-1", displayName: "Alice B" },
    credentials: {
      cookies: "SESSDATA=secret-cookie; bili_jct=csrf-secret",
    },
  });
  const proxyService = createPlaybackProxyService({
    createResourceId: () => "proxied-mp4",
    now: () => 1_000,
  });
  const providerRouter = createVideoProviderRouter({
    roomStore,
    runtimeStore,
    providers: registry,
    authService,
    playbackProxyService: proxyService,
  });
  const proxyRouter = createPlaybackProxyRouter({
    controller: createPlaybackProxyController({ service: proxyService }),
  });
  const server = createServer(async (request, response) => {
    if (await providerRouter.handle(request, response)) {
      return;
    }
    if (await proxyRouter.handle(request, response)) {
      return;
    }
    response.writeHead(418);
    response.end();
  });
  const baseUrl = await listen(server);

  try {
    const policy = { proxy: true, shared: true } satisfies PlaybackProxyPolicy;
    const result = await postJson(baseUrl, "/api/providers/bilibili/parse", {
      roomCode: "ABC123",
      memberToken: "owner-token",
      url: "https://www.bilibili.com/video/BV1TEST",
      policy,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(
      parseInputs[0]?.credentials?.cookies,
      "SESSDATA=secret-cookie; bili_jct=csrf-secret",
    );
    const serialized = JSON.stringify(result.body);
    assert.doesNotMatch(serialized, /SESSDATA|secret-cookie|upos\.example/i);
    assert.match(serialized, /\/proxy\/segment\/proxied-mp4/);
    assert.match(
      serialized,
      new RegExp(
        `${baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/proxy/segment/proxied-mp4`,
      ),
    );
  } finally {
    await close(server);
  }
});

test("video provider router proxies inline DASH manifests without leaking upstream URLs", async () => {
  const { roomStore, runtimeStore } = await createRoomFixture();
  const { authService, parseInputs, registry } = createDashProviderFixture();
  const upstreamRequests: Array<{
    url: string;
    headers: Record<string, string>;
  }> = [];
  await authService.authorize({
    roomCode: "ABC123",
    providerId: "bilibili",
    ownerMemberId: "owner-1",
    profile: { id: "mid-1", displayName: "Alice B" },
    credentials: {
      cookies: "SESSDATA=secret-cookie; bili_jct=csrf-secret",
    },
  });
  const ids = ["dash-manifest", "dash-segment"];
  const proxyService = createPlaybackProxyService({
    createResourceId: () => ids.shift() ?? "extra-id",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async (url, init) => {
      upstreamRequests.push({
        url: String(url),
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      if (String(url).includes("upos.example.test")) {
        return new Response("", { status: 403 });
      }
      return new Response("dash-bytes", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-9/100",
          "content-length": "10",
        },
      });
    },
  });
  const providerRouter = createVideoProviderRouter({
    roomStore,
    runtimeStore,
    providers: registry,
    authService,
    playbackProxyService: proxyService,
  });
  const proxyRouter = createPlaybackProxyRouter({
    controller: createPlaybackProxyController({ service: proxyService }),
  });
  const server = createServer(async (request, response) => {
    if (await providerRouter.handle(request, response)) {
      return;
    }
    if (await proxyRouter.handle(request, response)) {
      return;
    }
    response.writeHead(418);
    response.end();
  });
  const baseUrl = await listen(server);

  try {
    const result = await postJson(baseUrl, "/api/providers/bilibili/parse", {
      roomCode: "ABC123",
      memberToken: "owner-token",
      url: "https://www.bilibili.com/bangumi/play/ep123456",
      policy: { proxy: true, shared: true },
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.ok, true);
    assert.equal(
      parseInputs[0]?.credentials?.cookies,
      "SESSDATA=secret-cookie; bili_jct=csrf-secret",
    );
    const serialized = JSON.stringify(result.body);
    assert.doesNotMatch(serialized, /SESSDATA|secret-cookie|upos\.example/i);
    assert.match(serialized, /\/proxy\/manifest\/dash-manifest/);

    const manifestResponse = await fetch(
      `${baseUrl}/proxy/manifest/dash-manifest`,
    );
    assert.equal(manifestResponse.status, 200);
    const manifest = await manifestResponse.text();
    assert.doesNotMatch(manifest, /upos\.example\.test/);
    assert.match(manifest, /\/proxy\/segment\/dash-segment\//);

    const segmentResponse = await fetch(
      `${baseUrl}/proxy/segment/dash-segment`,
      {
        headers: { Range: "bytes=0-9" },
      },
    );
    assert.equal(segmentResponse.status, 206);
    assert.equal(await segmentResponse.text(), "dash-bytes");
    assert.deepEqual(upstreamRequests, [
      {
        url: "https://upos.example.test/video/",
        headers: {
          cookie:
            "SESSDATA=secret-cookie; bili_jct=csrf-secret; buvid3=pgc-buvid-3; buvid4=pgc-buvid-4",
          range: "bytes=0-9",
          referer: "https://www.bilibili.com",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        },
      },
      {
        url: "https://upos-backup.example.test/video/",
        headers: {
          cookie:
            "SESSDATA=secret-cookie; bili_jct=csrf-secret; buvid3=pgc-buvid-3; buvid4=pgc-buvid-4",
          range: "bytes=0-9",
          referer: "https://www.bilibili.com",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        },
      },
    ]);
  } finally {
    await close(server);
  }
});

test("video provider router requires owner authorization for shared playback parse", async () => {
  const { roomStore, runtimeStore } = await createRoomFixture();
  const { authService, parseInputs, registry } = createProviderFixture();
  const proxyService = createPlaybackProxyService();
  const providerRouter = createVideoProviderRouter({
    roomStore,
    runtimeStore,
    providers: registry,
    authService,
    playbackProxyService: proxyService,
  });
  const server = createServer(async (request, response) => {
    if (await providerRouter.handle(request, response)) {
      return;
    }
    response.writeHead(418);
    response.end();
  });
  const baseUrl = await listen(server);

  try {
    const result = await postJson(baseUrl, "/api/providers/bilibili/parse", {
      roomCode: "ABC123",
      memberToken: "owner-token",
      url: "https://www.bilibili.com/video/BV1TEST",
      policy: { proxy: true, shared: true },
    });

    assert.equal(result.status, 401);
    assert.deepEqual(result.body, {
      ok: false,
      error: {
        code: "provider_auth_required",
        message: "Bilibili authorization is required.",
      },
    });
    assert.equal(parseInputs.length, 0);
  } finally {
    await close(server);
  }
});

test("video provider router returns safe provider parse reasons", async () => {
  const { roomStore, runtimeStore } = await createRoomFixture();
  const { authService, parseInputs, registry } = createProviderFixture({
    async parse() {
      throw new VideoProviderError(
        "provider_parse_failed",
        "Bilibili live room is not currently live.",
        "live_room_offline",
      );
    },
  });
  const proxyService = createPlaybackProxyService();
  const providerRouter = createVideoProviderRouter({
    roomStore,
    runtimeStore,
    providers: registry,
    authService,
    playbackProxyService: proxyService,
  });
  const server = createServer(async (request, response) => {
    if (await providerRouter.handle(request, response)) {
      return;
    }
    response.writeHead(418);
    response.end();
  });
  const baseUrl = await listen(server);

  try {
    const result = await postJson(baseUrl, "/api/providers/bilibili/parse", {
      roomCode: "ABC123",
      memberToken: "owner-token",
      url: "https://live.bilibili.com/123456",
      policy: { proxy: false, shared: false },
    });

    assert.equal(result.status, 400);
    assert.deepEqual(result.body, {
      ok: false,
      error: {
        code: "provider_parse_failed",
        message: "Provider request failed.",
        reason: "live_room_offline",
      },
    });
    assert.equal(parseInputs.length, 1);
  } finally {
    await close(server);
  }
});
