import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createPlaybackProxyController } from "../src/playback-proxy/controller.js";
import { createPlaybackProxyRouter } from "../src/playback-proxy/router.js";
import { createPlaybackProxyService } from "../src/playback-proxy/service.js";

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

test("segment proxy fetches only cached opaque resource mappings", async () => {
  const upstreamRequests: string[] = [];
  const ids = ["live.m3u8", "segment-1"];
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => ids.shift() ?? "extra-id",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async (url) => {
      upstreamRequests.push(String(url));
      return new Response("segment-bytes", {
        status: 200,
        headers: {
          "content-type": "video/mp2t",
        },
      });
    },
  });
  service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://live.example.test/hls/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
segment-1.ts
`,
  });

  const router = createPlaybackProxyRouter({
    controller: createPlaybackProxyController({ service }),
  });
  const server = createServer(async (request, response) => {
    if (await router.handle(request, response)) {
      return;
    }
    response.writeHead(418);
    response.end();
  });
  const baseUrl = await listen(server);

  try {
    const segment = await fetch(`${baseUrl}/proxy/segment/segment-1`);
    assert.equal(segment.status, 200);
    assert.equal(segment.headers.get("content-type"), "video/mp2t");
    assert.equal(await segment.text(), "segment-bytes");
    assert.deepEqual(upstreamRequests, [
      "https://live.example.test/hls/segment-1.ts",
    ]);

    const arbitrary = await fetch(`${baseUrl}/proxy/segment/not-cached`);
    assert.equal(arbitrary.status, 404);
    assert.equal(
      (await arbitrary.json()).error.code,
      "proxy_resource_not_found",
    );
    assert.deepEqual(upstreamRequests, [
      "https://live.example.test/hls/segment-1.ts",
    ]);
  } finally {
    await close(server);
  }
});

test("segment proxy falls back to alternate upstream URLs on CDN errors", async () => {
  const upstreamRequests: string[] = [];
  const ids = ["dash.mpd", "dash-video"];
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => ids.shift() ?? "extra-id",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async (url) => {
      upstreamRequests.push(String(url));
      if (String(url).includes("primary.example.test")) {
        return new Response("", { status: 403 });
      }
      return new Response("init-bytes", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-9/100",
          "content-length": "10",
        },
      });
    },
  });
  service.registerMpdManifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://api.example.test/movie.mpd",
    manifest: `<?xml version="1.0" encoding="UTF-8"?>
<MPD type="static">
  <Period>
    <AdaptationSet contentType="video">
      <Representation id="video">
        <BaseURL>https://primary.example.test/movie.m4s?token=primary</BaseURL>
        <SegmentBase indexRange="10-20">
          <Initialization range="0-9" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`,
    upstreamUrlAlternates: {
      "https://primary.example.test/movie.m4s?token=primary": [
        "https://backup.example.test/movie.m4s?token=backup",
      ],
    },
  } as Parameters<typeof service.registerMpdManifest>[0] & {
    upstreamUrlAlternates: Record<string, string[]>;
  });

  const router = createPlaybackProxyRouter({
    controller: createPlaybackProxyController({ service }),
  });
  const server = createServer(async (request, response) => {
    if (await router.handle(request, response)) {
      return;
    }
    response.writeHead(418);
    response.end();
  });
  const baseUrl = await listen(server);

  try {
    const segment = await fetch(`${baseUrl}/proxy/segment/dash-video/`, {
      headers: { Range: "bytes=0-9" },
    });
    assert.equal(segment.status, 206);
    assert.equal(segment.headers.get("content-range"), "bytes 0-9/100");
    assert.equal(await segment.text(), "init-bytes");
    assert.deepEqual(upstreamRequests, [
      "https://primary.example.test/movie.m4s?token=primary",
      "https://backup.example.test/movie.m4s?token=backup",
    ]);
  } finally {
    await close(server);
  }
});

test("segment proxy handles HEAD without reading upstream bodies", async () => {
  const upstreamRequests: Array<{
    url: string;
    method: string | undefined;
    range: string | undefined;
  }> = [];
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async (url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      upstreamRequests.push({
        url: String(url),
        method: init?.method,
        range: headers?.Range,
      });
      return new Response(
        new ReadableStream({
          pull() {
            throw new Error("HEAD proxy must not read upstream bodies.");
          },
        }),
        {
          status: 206,
          headers: {
            "content-type": "video/mp4",
            "content-range": "bytes 0-99/1000",
            "content-length": "100",
          },
        },
      );
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4",
  });

  const router = createPlaybackProxyRouter({
    controller: createPlaybackProxyController({ service }),
  });
  const server = createServer(async (request, response) => {
    if (await router.handle(request, response)) {
      return;
    }
    response.writeHead(418);
    response.end();
  });
  const baseUrl = await listen(server);

  try {
    const segment = await fetch(`${baseUrl}/proxy/segment/movie-mp4`, {
      method: "HEAD",
      headers: { Range: "bytes=0-99" },
    });
    assert.equal(segment.status, 206);
    assert.equal(segment.headers.get("content-range"), "bytes 0-99/1000");
    assert.equal(segment.headers.get("content-length"), "100");
    assert.equal(await segment.text(), "");
    assert.deepEqual(upstreamRequests, [
      {
        url: "https://upos.example.test/video.mp4",
        method: "HEAD",
        range: "bytes=0-99",
      },
    ]);
  } finally {
    await close(server);
  }
});

test("segment proxy decodes XML escaped MPD BaseURL query parameters", async () => {
  const upstreamRequests: string[] = [];
  const ids = ["dash.mpd", "dash-video"];
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => ids.shift() ?? "extra-id",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async (url) => {
      upstreamRequests.push(String(url));
      return new Response("init-bytes", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-9/100",
          "content-length": "10",
        },
      });
    },
  });
  service.registerMpdManifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://api.example.test/movie.mpd",
    manifest: `<?xml version="1.0" encoding="UTF-8"?>
<MPD type="static">
  <Period>
    <AdaptationSet contentType="video">
      <Representation id="video">
        <BaseURL>https://upos.example.test/movie.m4s?deadline=1&amp;token=abc</BaseURL>
        <SegmentBase indexRange="10-20">
          <Initialization range="0-9" />
        </SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`,
  });

  const router = createPlaybackProxyRouter({
    controller: createPlaybackProxyController({ service }),
  });
  const server = createServer(async (request, response) => {
    if (await router.handle(request, response)) {
      return;
    }
    response.writeHead(418);
    response.end();
  });
  const baseUrl = await listen(server);

  try {
    const segment = await fetch(`${baseUrl}/proxy/segment/dash-video/`, {
      headers: { Range: "bytes=0-9" },
    });
    assert.equal(segment.status, 206);
    assert.equal(await segment.text(), "init-bytes");
    assert.deepEqual(upstreamRequests, [
      "https://upos.example.test/movie.m4s?deadline=1&token=abc",
    ]);
  } finally {
    await close(server);
  }
});

test("segment proxy registers a single media URL as an opaque proxy resource", async () => {
  const upstreamRequests: string[] = [];
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "single-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async (url, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      upstreamRequests.push(`${String(url)}|${headers?.Referer ?? ""}`);
      return new Response("mp4-bytes", {
        status: 200,
        headers: {
          "content-type": "video/mp4",
        },
      });
    },
  });

  const registered = service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4",
    upstreamHeaders: {
      Referer: "https://www.bilibili.com",
    },
  });

  assert.deepEqual(registered, {
    segmentId: "single-mp4",
    segmentUrl: "http://syncroom.example.test/proxy/segment/single-mp4",
    expiresAt: 601_000,
  });

  const router = createPlaybackProxyRouter({
    controller: createPlaybackProxyController({ service }),
  });
  const server = createServer(async (request, response) => {
    if (await router.handle(request, response)) {
      return;
    }
    response.writeHead(418);
    response.end();
  });
  const baseUrl = await listen(server);

  try {
    const segment = await fetch(`${baseUrl}/proxy/segment/single-mp4`);
    assert.equal(segment.status, 200);
    assert.equal(segment.headers.get("content-type"), "video/mp4");
    assert.equal(await segment.text(), "mp4-bytes");
    assert.deepEqual(upstreamRequests, [
      "https://upos.example.test/video.mp4|https://www.bilibili.com",
    ]);
  } finally {
    await close(server);
  }
});

test("segment proxy aggregates traffic metrics by room and provider", async () => {
  const records: unknown[] = [];
  const ids = ["manifest-1", "segment-1"];
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => ids.shift() ?? "extra-id",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    metricsCollector: {
      recordProxyTraffic(input: unknown) {
        records.push(input);
      },
    },
    fetch: async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: {
          "content-type": "video/mp2t",
          "content-range": "bytes 0-3/10",
        },
      }),
  });
  service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://live.example.test/hls/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
segment-1.ts
`,
  });

  const segment = await service.resolveResource({
    kind: "segment",
    resourceId: "segment-1",
    headers: {},
  });

  assert.equal(segment?.statusCode, 206);
  assert.deepEqual(records, [
    { roomCode: "ABC123", providerId: "bilibili", bytes: 4 },
  ]);
});

test("segment proxy logs upstream http failures without leaking urls", async () => {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    logEvent(event, data) {
      events.push({ event, data: data ?? {} });
    },
    fetch: async () =>
      new Response("forbidden", {
        status: 403,
        headers: {
          "content-type": "text/plain",
        },
      }),
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl:
      "https://upos.example.test/video.mp4?token=secret-token&expires=1",
    upstreamHeaders: {
      Referer: "https://www.bilibili.com",
      Cookie: "SESSDATA=session-secret",
    },
  });

  const segment = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: {},
  });

  assert.equal(segment?.statusCode, 403);
  assert.deepEqual(events, [
    {
      event: "playback_proxy_upstream_http_error",
      data: {
        roomCode: "ABC123",
        providerId: "bilibili",
        resourceKind: "segment",
        statusCode: 403,
        upstreamHost: "upos.example.test",
        contentType: "text/plain",
        result: "upstream_error",
      },
    },
  ]);
  assert.equal(JSON.stringify(events).includes("secret-token"), false);
  assert.equal(JSON.stringify(events).includes("session-secret"), false);
});
