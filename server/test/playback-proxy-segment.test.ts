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

function withTimeout<T>(
  promise: Promise<T>,
  message: string,
  timeoutMs = 1_000,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

async function readResourceBody(
  body: string | Uint8Array | ReadableStream<Uint8Array> | undefined,
): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body);
  }
  if (body instanceof Uint8Array) {
    return body;
  }

  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
  }
  return new Uint8Array(chunks.flatMap((chunk) => Array.from(chunk)));
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

test("segment proxy streams un-ranged media before the upstream body completes", async () => {
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("first-chunk"));
          },
        }),
        {
          status: 200,
          headers: {
            "content-type": "video/mp4",
          },
        },
      ),
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
  const abortController = new AbortController();

  try {
    const segment = await withTimeout(
      fetch(`${baseUrl}/proxy/segment/movie-mp4`, {
        signal: abortController.signal,
      }).catch((error: unknown) => {
        if (abortController.signal.aborted) {
          throw new Error(
            "segment response did not start before upstream body completion",
          );
        }
        throw error;
      }),
      "segment response did not start before upstream body completion",
    ).catch((error: unknown) => {
      abortController.abort();
      throw error;
    });
    assert.equal(segment.status, 200);
    assert.equal(segment.headers.get("content-type"), "video/mp4");

    const reader = segment.body?.getReader();
    assert.ok(reader);
    const firstChunk = await withTimeout(
      reader.read(),
      "segment first chunk was not streamed",
    );
    assert.equal(new TextDecoder().decode(firstChunk.value), "first-chunk");
    await reader.cancel();
  } finally {
    abortController.abort();
    server.closeAllConnections();
    await close(server);
  }
});

test("segment proxy coalesces concurrent ranged requests for the same segment", async () => {
  let fetchCount = 0;
  let releaseFetch: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async () => {
      fetchCount += 1;
      await fetchGate;
      return new Response("0123456789", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-9/100",
          "content-length": "10",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4",
  });

  const first = service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-9" },
  });
  const second = service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-9" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCount, 1);

  releaseFetch?.();
  const [firstSegment, secondSegment] = await Promise.all([first, second]);

  assert.equal(firstSegment?.statusCode, 206);
  assert.equal(secondSegment?.statusCode, 206);
  assert.ok(firstSegment?.body instanceof Uint8Array);
  assert.ok(secondSegment?.body instanceof Uint8Array);
  assert.equal(firstSegment.body.buffer, secondSegment.body.buffer);
  assert.equal(
    new TextDecoder().decode(await readResourceBody(firstSegment?.body)),
    "0123456789",
  );
  assert.equal(
    new TextDecoder().decode(await readResourceBody(secondSegment?.body)),
    "0123456789",
  );
  assert.equal(fetchCount, 1);
});

test("segment proxy streams a distinct range when concurrent cache reservations reach the byte cap", async () => {
  let fetchCount = 0;
  let releaseFirstBody: (() => void) | undefined;
  const firstBodyGate = new Promise<void>((resolve) => {
    releaseFirstBody = resolve;
  });
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    segmentCacheMaxBytes: 10,
    segmentCacheMaxEntryBytes: 10,
    fetch: async (_url, init) => {
      fetchCount += 1;
      const headers = init?.headers as Record<string, string> | undefined;
      const range = headers?.Range ?? "";
      const body =
        range === "bytes=0-5"
          ? new ReadableStream<Uint8Array>({
              async start(controller) {
                await firstBodyGate;
                controller.enqueue(new TextEncoder().encode("AAAAAA"));
                controller.close();
              },
            })
          : "BBBBBB";
      return new Response(body, {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": `${range.replace("=", " ")}/100`,
          "content-length": "6",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4",
  });

  const first = service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-5" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=6-11" },
  });
  assert.equal(fetchCount, 2);
  assert.equal(
    new TextDecoder().decode(await readResourceBody(second?.body)),
    "BBBBBB",
  );

  releaseFirstBody?.();
  assert.equal(
    new TextDecoder().decode(await readResourceBody((await first)?.body)),
    "AAAAAA",
  );
  const secondRetry = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=6-11" },
  });
  assert.equal(
    new TextDecoder().decode(await readResourceBody(secondRetry?.body)),
    "BBBBBB",
  );
  assert.equal(fetchCount, 3);
});

test("segment proxy bounds the number of distinct cache fills", async () => {
  let fetchCount = 0;
  let releaseFetch: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const cacheEvents: string[] = [];
  const service = createPlaybackProxyService({
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    segmentCacheMaxPendingEntries: 1,
    metricsCollector: {
      recordProxyCacheEvent({ event }) {
        cacheEvents.push(event);
      },
    },
    fetch: async (_url, init) => {
      fetchCount += 1;
      await fetchGate;
      const headers = init?.headers as Record<string, string> | undefined;
      const range = headers?.Range ?? "bytes=0-5";
      return new Response("AAAAAA", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": `${range.replace("=", " ")}/100`,
          "content-length": "6",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4",
  });

  const first = service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-5" },
  });
  const second = service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=6-11" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCount, 2);
  assert.deepEqual(cacheEvents.slice(0, 2), ["miss", "bypass"]);

  releaseFetch?.();
  await Promise.all([first, second]);
});

test("segment proxy does not resurrect cache or metrics after room cleanup", async () => {
  let fetchCount = 0;
  let releaseOldBody: (() => void) | undefined;
  const oldBodyGate = new Promise<void>((resolve) => {
    releaseOldBody = resolve;
  });
  const metricEvents: string[] = [];
  const service = createPlaybackProxyService({
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    metricsCollector: {
      recordProxyTraffic() {
        metricEvents.push("traffic");
      },
      recordProxyRequest() {
        metricEvents.push("request");
      },
      recordProxyUpstreamTraffic() {
        metricEvents.push("upstream-traffic");
      },
      recordProxyUpstreamRequest() {
        metricEvents.push("upstream-request");
      },
      recordProxyCacheEvent({ event }) {
        metricEvents.push(`cache-${event}`);
      },
      clearProxyRoom() {
        metricEvents.length = 0;
      },
    },
    fetch: async () => {
      fetchCount += 1;
      const body =
        fetchCount === 1
          ? new ReadableStream<Uint8Array>({
              async pull(controller) {
                await oldBodyGate;
                controller.enqueue(new TextEncoder().encode("OLD"));
                controller.close();
              },
            })
          : "NEW";
      return new Response(body, {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-2/100",
          "content-length": "3",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/old.mp4",
  });

  const pending = service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-2" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.clearRoom("ABC123"), 1);
  releaseOldBody?.();

  const oldResponse = await pending;
  assert.equal(
    new TextDecoder().decode(await readResourceBody(oldResponse?.body)),
    "OLD",
  );
  assert.deepEqual(metricEvents, []);

  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/new.mp4",
  });
  const freshResponse = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-2" },
  });
  assert.equal(fetchCount, 2);
  assert.equal(
    new TextDecoder().decode(await readResourceBody(freshResponse?.body)),
    "NEW",
  );
});

test("segment proxy clears room metrics only after its last resource expires", () => {
  let currentTime = 1_000;
  const resourceIds = ["first-segment", "second-segment"];
  const clearedRooms: string[] = [];
  const service = createPlaybackProxyService({
    now: () => currentTime,
    createResourceId: () => resourceIds.shift() ?? "unexpected-segment",
    metricsCollector: {
      clearProxyRoom(roomCode) {
        clearedRooms.push(roomCode);
      },
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/first.mp4",
    ttlMs: 100,
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/second.mp4",
    ttlMs: 200,
  });

  currentTime = 1_100;
  assert.equal(service.cleanupExpired(), 1);
  assert.deepEqual(clearedRooms, []);

  currentTime = 1_200;
  assert.equal(service.cleanupExpired(), 1);
  assert.deepEqual(clearedRooms, ["ABC123"]);
});

test("segment proxy records cache and upstream metrics separately from response bytes", async () => {
  let fetchCount = 0;
  const metricRecords: Array<{ name: string; input: Record<string, unknown> }> =
    [];
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    metricsCollector: {
      recordProxyTraffic(input) {
        metricRecords.push({ name: "traffic", input });
      },
      recordProxyRequest(input) {
        metricRecords.push({ name: "request", input });
      },
      recordProxyUpstreamTraffic(input) {
        metricRecords.push({ name: "upstream_traffic", input });
      },
      recordProxyUpstreamRequest(input) {
        metricRecords.push({ name: "upstream_request", input });
      },
      recordProxyCacheEvent(input) {
        metricRecords.push({ name: "cache", input });
      },
    },
    fetch: async () => {
      fetchCount += 1;
      return new Response("range-body", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-9/100",
          "content-length": "10",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4",
  });

  const first = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-9" },
  });
  const second = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-9" },
  });

  assert.equal(
    new TextDecoder().decode(await readResourceBody(first?.body)),
    "range-body",
  );
  assert.equal(
    new TextDecoder().decode(await readResourceBody(second?.body)),
    "range-body",
  );
  assert.equal(fetchCount, 1);
  assert.deepEqual(
    metricRecords.map((record) => record.name),
    [
      "request",
      "cache",
      "upstream_request",
      "upstream_traffic",
      "cache",
      "traffic",
      "request",
      "cache",
      "traffic",
    ],
  );
  assert.deepEqual(
    metricRecords
      .filter((record) => record.name === "cache")
      .map((record) => record.input),
    [
      { roomCode: "ABC123", providerId: "bilibili", event: "miss" },
      { roomCode: "ABC123", providerId: "bilibili", event: "store" },
      { roomCode: "ABC123", providerId: "bilibili", event: "hit" },
    ],
  );
  assert.deepEqual(
    metricRecords
      .filter((record) => record.name === "upstream_request")
      .map((record) => record.input),
    [
      {
        roomCode: "ABC123",
        providerId: "bilibili",
        outcome: "success",
      },
    ],
  );
  assert.deepEqual(
    metricRecords
      .filter((record) => record.name === "upstream_traffic")
      .map((record) => record.input),
    [{ roomCode: "ABC123", providerId: "bilibili", bytes: 10 }],
  );
  assert.deepEqual(
    metricRecords
      .filter((record) => record.name === "traffic")
      .map((record) => record.input),
    [
      { roomCode: "ABC123", providerId: "bilibili", bytes: 10 },
      { roomCode: "ABC123", providerId: "bilibili", bytes: 10 },
    ],
  );
});

test("segment proxy does not coalesce open-ended ranged requests", async () => {
  let fetchCount = 0;
  let releaseFetch: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const cacheEvents: unknown[] = [];
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    metricsCollector: {
      recordProxyCacheEvent(input) {
        cacheEvents.push(input);
      },
    },
    fetch: async () => {
      fetchCount += 1;
      await fetchGate;
      return new Response("large-mp4", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-99999999/100000000",
          "content-length": "100000000",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4",
  });

  const first = service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const second = service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-" },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fetchCount, 2);
  releaseFetch?.();
  const [firstSegment, secondSegment] = await Promise.all([first, second]);
  assert.equal(
    new TextDecoder().decode(await readResourceBody(firstSegment?.body)),
    "large-mp4",
  );
  assert.equal(
    new TextDecoder().decode(await readResourceBody(secondSegment?.body)),
    "large-mp4",
  );
  assert.deepEqual(cacheEvents, [
    { roomCode: "ABC123", providerId: "bilibili", event: "bypass" },
    { roomCode: "ABC123", providerId: "bilibili", event: "bypass" },
  ]);
});

test("segment proxy expires ranged response cache entries by TTL", async () => {
  let now = 1_000;
  let fetchCount = 0;
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => now,
    resolveHostname: async () => ["93.184.216.34"],
    segmentCacheTtlMs: 50,
    fetch: async () => {
      fetchCount += 1;
      return new Response(`range-${fetchCount}`, {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-5/100",
          "content-length": "7",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4",
  });

  const first = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-5" },
  });
  assert.equal(
    new TextDecoder().decode(await readResourceBody(first?.body)),
    "range-1",
  );
  assert.equal(fetchCount, 1);

  now = 1_049;
  const cached = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-5" },
  });
  assert.equal(
    new TextDecoder().decode(await readResourceBody(cached?.body)),
    "range-1",
  );
  assert.equal(fetchCount, 1);

  now = 1_051;
  const refreshed = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-5" },
  });
  assert.equal(
    new TextDecoder().decode(await readResourceBody(refreshed?.body)),
    "range-2",
  );
  assert.equal(fetchCount, 2);
});

test("segment proxy evicts ranged response cache entries when the byte cap is reached", async () => {
  let fetchCount = 0;
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    segmentCacheMaxBytes: 10,
    segmentCacheMaxEntryBytes: 10,
    fetch: async (_url, init) => {
      fetchCount += 1;
      const headers = init?.headers as Record<string, string> | undefined;
      const range = headers?.Range ?? "";
      const body = range === "bytes=0-5" ? "AAAAAA" : "BBBBBB";
      return new Response(body, {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": `${range.replace("=", " ")}/100`,
          "content-length": String(body.length),
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4",
  });

  const firstA = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-5" },
  });
  assert.equal(
    new TextDecoder().decode(await readResourceBody(firstA?.body)),
    "AAAAAA",
  );
  assert.equal(fetchCount, 1);

  const cachedA = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-5" },
  });
  assert.equal(
    new TextDecoder().decode(await readResourceBody(cachedA?.body)),
    "AAAAAA",
  );
  assert.equal(fetchCount, 1);

  const firstB = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=6-11" },
  });
  assert.equal(
    new TextDecoder().decode(await readResourceBody(firstB?.body)),
    "BBBBBB",
  );
  assert.equal(fetchCount, 2);

  const refetchedA = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-5" },
  });
  assert.equal(
    new TextDecoder().decode(await readResourceBody(refetchedA?.body)),
    "AAAAAA",
  );
  assert.equal(fetchCount, 3);
});

test("segment proxy stops buffering when a ranged response exceeds the entry cap", async () => {
  let fetchCount = 0;
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    segmentCacheMaxEntryBytes: 4,
    fetch: async () => {
      fetchCount += 1;
      return new Response("too-large", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-8/100",
          "content-length": "1",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4",
  });

  const segment = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-8" },
  });

  assert.equal(
    new TextDecoder().decode(await readResourceBody(segment?.body)),
    "too-large",
  );
  assert.equal(fetchCount, 2);
});

test("segment proxy drops cached ranged responses when room auth is cleared", async () => {
  let fetchCount = 0;
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async () => {
      fetchCount += 1;
      return new Response(fetchCount === 1 ? "old-auth" : "new-auth", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-7/100",
          "content-length": "8",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4?auth=old",
  });

  const oldSegment = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-7" },
  });
  assert.equal(
    new TextDecoder().decode(await readResourceBody(oldSegment?.body)),
    "old-auth",
  );
  assert.equal(fetchCount, 1);

  assert.equal(service.clearProviderAuth("ABC123", "bilibili"), 1);
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4?auth=new",
  });

  const newSegment = await service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-7" },
  });
  assert.equal(
    new TextDecoder().decode(await readResourceBody(newSegment?.body)),
    "new-auth",
  );
  assert.equal(fetchCount, 2);
});

test("segment proxy does not refetch cleared auth for pending ranged request waiters", async () => {
  let fetchCount = 0;
  let releaseFetch: (() => void) | undefined;
  const fetchGate = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  const service = createPlaybackProxyService({
    publicBaseUrl: "http://syncroom.example.test",
    createResourceId: () => "movie-mp4",
    now: () => 1_000,
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async () => {
      fetchCount += 1;
      await fetchGate;
      return new Response("old-auth", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-7/100",
          "content-length": "8",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/video.mp4?auth=old",
  });

  const owner = service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-7" },
  });
  const waiter = service.resolveResource({
    kind: "segment",
    resourceId: "movie-mp4",
    headers: { range: "bytes=0-7" },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCount, 1);

  assert.equal(service.clearProviderAuth("ABC123", "bilibili"), 1);
  releaseFetch?.();

  const [ownerSegment, waiterSegment] = await Promise.all([owner, waiter]);
  assert.equal(
    new TextDecoder().decode(await readResourceBody(ownerSegment?.body)),
    "old-auth",
  );
  assert.equal(waiterSegment, null);
  assert.equal(fetchCount, 1);
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
  assert.deepEqual(
    Array.from(await readResourceBody(segment?.body)),
    [1, 2, 3, 4],
  );
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
