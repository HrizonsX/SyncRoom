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

function headersToRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  if (!headers) {
    return {};
  }
  return Object.fromEntries(new Headers(headers).entries());
}

test("segment proxy forwards provider headers and Range requests", async () => {
  const upstreamRequests: Array<{
    url: string;
    headers: Record<string, string>;
  }> = [];
  const ids = ["live.m3u8", "segment-1"];
  const service = createPlaybackProxyService({
    createResourceId: () => ids.shift() ?? "extra-id",
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async (url, init) => {
      upstreamRequests.push({
        url: String(url),
        headers: headersToRecord(init?.headers),
      });
      return new Response("0123456789", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-9/100",
          "accept-ranges": "bytes",
          "content-length": "10",
        },
      });
    },
  });
  service.registerM3u8Manifest({
    roomCode: "ABC123",
    providerId: "bilibili",
    manifestUrl: "https://upos.example.test/live.m3u8",
    upstreamHeaders: {
      Referer: "https://www.bilibili.com",
      "User-Agent": "SyncRoom Test UA",
    },
    manifest: `#EXTM3U
#EXTINF:4.000,
segment-1.m4s
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
    const response = await fetch(`${baseUrl}/proxy/segment/segment-1`, {
      headers: {
        Range: "bytes=0-9",
      },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 0-9/100");
    assert.equal(response.headers.get("accept-ranges"), "bytes");
    assert.equal(response.headers.get("content-length"), "10");
    assert.equal(await response.text(), "0123456789");
    assert.deepEqual(upstreamRequests, [
      {
        url: "https://upos.example.test/segment-1.m4s",
        headers: {
          range: "bytes=0-9",
          referer: "https://www.bilibili.com",
          "user-agent": "SyncRoom Test UA",
        },
      },
    ]);
  } finally {
    await close(server);
  }
});

test("segment proxy accepts trailing slash URLs emitted by DASH BaseURL", async () => {
  const upstreamRequests: Array<{
    url: string;
    headers: Record<string, string>;
  }> = [];
  const service = createPlaybackProxyService({
    createResourceId: () => "dash-video",
    resolveHostname: async () => ["93.184.216.34"],
    fetch: async (url, init) => {
      upstreamRequests.push({
        url: String(url),
        headers: headersToRecord(init?.headers),
      });
      return new Response("init-bytes", {
        status: 206,
        headers: {
          "content-type": "video/mp4",
          "content-range": "bytes 0-9/100",
          "accept-ranges": "bytes",
          "content-length": "10",
        },
      });
    },
  });
  service.registerSegment({
    roomCode: "ABC123",
    providerId: "bilibili",
    upstreamUrl: "https://upos.example.test/movie.m4s?token=secret",
    upstreamHeaders: {
      Referer: "https://www.bilibili.com",
    },
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
    const response = await fetch(`${baseUrl}/proxy/segment/dash-video/`, {
      headers: {
        Range: "bytes=0-9",
      },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), "bytes 0-9/100");
    assert.equal(await response.text(), "init-bytes");
    assert.deepEqual(upstreamRequests, [
      {
        url: "https://upos.example.test/movie.m4s?token=secret",
        headers: {
          range: "bytes=0-9",
          referer: "https://www.bilibili.com",
        },
      },
    ]);
  } finally {
    await close(server);
  }
});
