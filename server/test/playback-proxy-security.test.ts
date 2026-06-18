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

async function createProxyServer(
  service: ReturnType<typeof createPlaybackProxyService>,
) {
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
  return { server, baseUrl: await listen(server) };
}

test("segment proxy rejects private IP literal resources before fetch", async () => {
  let fetchCount = 0;
  const ids = ["live.m3u8", "segment-1"];
  const service = createPlaybackProxyService({
    createResourceId: () => ids.shift() ?? "extra-id",
    fetch: async () => {
      fetchCount += 1;
      return new Response("should not fetch");
    },
  });
  service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://safe.example.test/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
http://127.0.0.1/segment.ts
`,
  });
  const { server, baseUrl } = await createProxyServer(service);

  try {
    const response = await fetch(`${baseUrl}/proxy/segment/segment-1`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "proxy_forbidden");
    assert.equal(fetchCount, 0);
  } finally {
    await close(server);
  }
});

test("segment proxy rejects benchmark IP literal resources before fetch", async () => {
  let fetchCount = 0;
  const ids = ["live.m3u8", "segment-1"];
  const service = createPlaybackProxyService({
    createResourceId: () => ids.shift() ?? "extra-id",
    fetch: async () => {
      fetchCount += 1;
      return new Response("should not fetch");
    },
  });
  service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://safe.example.test/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
http://198.18.1.77/segment.ts
`,
  });
  const { server, baseUrl } = await createProxyServer(service);

  try {
    const response = await fetch(`${baseUrl}/proxy/segment/segment-1`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "proxy_forbidden");
    assert.equal(fetchCount, 0);
  } finally {
    await close(server);
  }
});

test("segment proxy rejects hostnames that resolve to private networks", async () => {
  let fetchCount = 0;
  const ids = ["live.m3u8", "segment-1"];
  const service = createPlaybackProxyService({
    createResourceId: () => ids.shift() ?? "extra-id",
    resolveHostname: async () => ["10.0.0.7"],
    fetch: async () => {
      fetchCount += 1;
      return new Response("should not fetch");
    },
  });
  service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://cdn.example.test/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
segment.ts
`,
  });
  const { server, baseUrl } = await createProxyServer(service);

  try {
    const response = await fetch(`${baseUrl}/proxy/segment/segment-1`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error.code, "proxy_forbidden");
    assert.equal(fetchCount, 0);
  } finally {
    await close(server);
  }
});

test("segment proxy allows hostnames that resolve to fake-ip benchmark ranges", async () => {
  const upstreamRequests: string[] = [];
  const ids = ["live.m3u8", "segment-1"];
  const service = createPlaybackProxyService({
    createResourceId: () => ids.shift() ?? "extra-id",
    resolveHostname: async () => ["198.18.1.77"],
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
    manifestUrl: "https://pze9061c.edge.mountaintoys.cn/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
segment.ts
`,
  });
  const { server, baseUrl } = await createProxyServer(service);

  try {
    const response = await fetch(`${baseUrl}/proxy/segment/segment-1`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "segment-bytes");
    assert.deepEqual(upstreamRequests, [
      "https://pze9061c.edge.mountaintoys.cn/segment.ts",
    ]);
  } finally {
    await close(server);
  }
});

test("segment proxy error responses redact upstream credentials and URLs", async () => {
  const ids = ["live.m3u8", "segment-1"];
  const service = createPlaybackProxyService({
    createResourceId: () => ids.shift() ?? "extra-id",
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async () => {
      throw new Error(
        "upstream failed Cookie: SESSDATA=secret https://upos.example.test/segment.ts?token=secret",
      );
    },
  });
  service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://upos.example.test/live.m3u8",
    manifest: `#EXTM3U
#EXTINF:4.000,
segment.ts
`,
  });
  const { server, baseUrl } = await createProxyServer(service);

  try {
    const response = await fetch(`${baseUrl}/proxy/segment/segment-1`);
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.match(body, /proxy_internal_error/);
    assert.doesNotMatch(body, /SESSDATA|token=secret|upos\.example\.test/i);
  } finally {
    await close(server);
  }
});
