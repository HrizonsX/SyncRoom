import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  createSyncServer,
  getDefaultPersistenceConfig,
  getDefaultSecurityConfig,
} from "../src/app.js";
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

test("playback proxy router owns manifest and segment proxy paths", async () => {
  const router = createPlaybackProxyRouter({
    controller: createPlaybackProxyController({
      service: createPlaybackProxyService(),
    }),
  });
  const server = createServer(async (request, response) => {
    if (await router.handle(request, response)) {
      return;
    }
    response.writeHead(418, { "content-type": "text/plain" });
    response.end("unhandled");
  });
  const baseUrl = await listen(server);

  try {
    const manifest = await fetch(`${baseUrl}/proxy/manifest/missing`);
    assert.equal(manifest.status, 404);
    assert.equal(
      (await manifest.json()).error.code,
      "proxy_resource_not_found",
    );

    const segment = await fetch(`${baseUrl}/proxy/segment/missing`);
    assert.equal(segment.status, 404);
    assert.equal((await segment.json()).error.code, "proxy_resource_not_found");

    const rejectedMethod = await fetch(`${baseUrl}/proxy/manifest/missing`, {
      method: "POST",
    });
    assert.equal(rejectedMethod.status, 405);
    assert.equal(
      (await rejectedMethod.json()).error.code,
      "method_not_allowed",
    );

    const unrelated = await fetch(`${baseUrl}/api/admin/me`);
    assert.equal(unrelated.status, 418);
  } finally {
    await close(server);
  }
});

test("playback proxy routes expose CORS headers for Shaka manifest loading", async () => {
  let nextId = 0;
  const service = createPlaybackProxyService({
    createResourceId: () => `resource-${++nextId}`,
  });
  const router = createPlaybackProxyRouter({
    controller: createPlaybackProxyController({
      service,
    }),
  });
  const server = createServer(async (request, response) => {
    if (await router.handle(request, response)) {
      return;
    }
    response.writeHead(418, { "content-type": "text/plain" });
    response.end("unhandled");
  });
  const baseUrl = await listen(server);

  try {
    const registered = service.registerMpdManifest({
      roomCode: "ROOM1",
      providerId: "bilibili",
      manifest:
        '<?xml version="1.0"?><MPD xmlns="urn:mpeg:dash:schema:mpd:2011" />',
      publicBaseUrl: baseUrl,
    });

    const manifest = await fetch(registered.manifestUrl, {
      headers: {
        origin: "http://127.0.0.1:4173",
      },
    });
    assert.equal(manifest.status, 200);
    assert.equal(
      manifest.headers.get("access-control-allow-origin"),
      "http://127.0.0.1:4173",
    );
    assert.match(
      manifest.headers.get("access-control-expose-headers") ?? "",
      /Content-Range/,
    );
    assert.equal(manifest.headers.get("content-type"), "application/dash+xml");

    const preflight = await fetch(registered.manifestUrl, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:4173",
        "access-control-request-headers": "range",
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "http://127.0.0.1:4173",
    );
    assert.match(
      preflight.headers.get("access-control-allow-headers") ?? "",
      /Range/,
    );

    const missing = await fetch(`${baseUrl}/proxy/manifest/missing`, {
      headers: {
        origin: "http://127.0.0.1:4173",
      },
    });
    assert.equal(missing.status, 404);
    assert.equal(
      missing.headers.get("access-control-allow-origin"),
      "http://127.0.0.1:4173",
    );
  } finally {
    await close(server);
  }
});

test("sync server mounts playback proxy routes before generic fallback", async () => {
  const server = await createSyncServer(
    getDefaultSecurityConfig(),
    getDefaultPersistenceConfig(),
  );
  const baseUrl = await listen(server.httpServer);

  try {
    const response = await fetch(`${baseUrl}/proxy/manifest/missing`);
    assert.equal(response.status, 404);
    assert.equal(
      (await response.json()).error.code,
      "proxy_resource_not_found",
    );
  } finally {
    await server.close();
  }
});
