import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import test from "node:test";
import { createMetricsCollector } from "../src/admin/metrics.js";
import {
  createNginxCacheMetricsListener,
  parseNginxCacheMetricsMessage,
} from "../src/nginx-cache-metrics-listener.js";
import { createInMemoryRuntimeStore } from "../src/runtime-store.js";

test("parseNginxCacheMetricsMessage accepts syslog-prefixed cache records", () => {
  assert.deepEqual(
    parseNginxCacheMetricsMessage(
      "<190>Jul 11 16:00:00 syncroom_cache: syncroom_cache status=HIT bytes=262144 request_time=0.012",
    ),
    { status: "hit", bytes: 262144, durationMs: 12 },
  );
  assert.deepEqual(
    parseNginxCacheMetricsMessage(
      "syncroom_cache status=FUTURE bytes=10 request_time=1.5",
    ),
    { status: "unknown", bytes: 10, durationMs: 1500 },
  );
  assert.equal(parseNginxCacheMetricsMessage("unrelated syslog line"), null);
});

test("Nginx cache metrics listener aggregates UDP records", async () => {
  const runtimeStore = createInMemoryRuntimeStore(() => 0);
  const metrics = createMetricsCollector({
    runtimeStore,
    roomStore: {
      async countRooms() {
        return 0;
      },
    } as never,
  });
  const listener = await createNginxCacheMetricsListener({
    port: 0,
    host: "127.0.0.1",
    metricsCollector: metrics,
    logEvent: () => undefined,
  });
  const sender = createSocket("udp4");

  try {
    await new Promise<void>((resolve, reject) => {
      sender.send(
        "syncroom_cache status=HIT bytes=262144 request_time=0.012",
        listener.port,
        "127.0.0.1",
        (error) => (error ? reject(error) : resolve()),
      );
    });

    let rendered = "";
    for (let attempt = 0; attempt < 20; attempt += 1) {
      rendered = await metrics.render();
      if (
        rendered.includes(
          'syncroom_nginx_proxy_cache_requests_total{status="hit"} 1',
        )
      ) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.match(
      rendered,
      /syncroom_nginx_proxy_cache_requests_total\{status="hit"\} 1/,
    );
    assert.match(
      rendered,
      /syncroom_nginx_proxy_cache_bytes_total\{status="hit"\} 262144/,
    );
  } finally {
    sender.close();
    await listener.close();
  }
});
