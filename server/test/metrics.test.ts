import assert from "node:assert/strict";
import test from "node:test";
import { createMetricsCollector } from "../src/admin/metrics.js";
import { createInMemoryRuntimeStore } from "../src/runtime-store.js";

test("metrics collector renders event counters, histograms, and redis failure counters", async () => {
  const runtimeStore = createInMemoryRuntimeStore(() => 0);
  const metrics = createMetricsCollector({
    runtimeStore,
    roomStore: {
      async countRooms() {
        return 2;
      },
    } as never,
  });

  runtimeStore.registerSession({
    id: "session-1",
    connectionState: "detached",
    socket: null,
    instanceId: "instance-1",
    remoteAddress: "127.0.0.1",
    origin: "chrome-extension://allowed-extension",
    roomCode: null,
    memberId: null,
    displayName: "Alice",
    memberToken: null,
    joinedAt: null,
    invalidMessageCount: 0,
    rateLimitState: {
      roomCreate: { windowStart: 0, count: 0 },
      roomJoin: { windowStart: 0, count: 0 },
      videoShare: { windowStart: 0, count: 0 },
      playbackUpdate: { tokens: 0, lastRefillAt: 0 },
      syncRequest: { windowStart: 0, count: 0 },
      syncPing: { tokens: 0, lastRefillAt: 0 },
    },
  });
  runtimeStore.markSessionJoinedRoom("session-1", "ROOM01");

  metrics.recordEvent("room_created");
  metrics.observeMessageHandlerDuration("room:join", 12);
  metrics.observeRedisRuntimeStoreDuration("register_session", 8);
  metrics.observeRedisRuntimeStoreFailure("register_session");
  metrics.observeRedisRoomEventBusPublishDuration(5);
  metrics.observeRedisRoomEventBusPublishFailure();
  metrics.recordRoomEventPublishDropped("room_member_changed");
  metrics.recordRoomEventPublishDropped("room_member_changed");

  const rendered = await metrics.render();

  assert.equal(rendered.includes("syncroom_connections 1"), true);
  assert.equal(rendered.includes("syncroom_active_rooms 1"), true);
  assert.equal(rendered.includes("syncroom_rooms_non_expired 2"), true);
  assert.equal(
    rendered.includes('syncroom_events_total{event="room_created"} 1'),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_message_handler_duration_seconds_count{message_type="room:join"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_redis_runtime_store_duration_seconds_count{operation="register_session"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_redis_room_event_bus_publish_duration_seconds_count{operation="publish"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_redis_operation_failures_total{component="room_event_bus",operation="publish"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_redis_operation_failures_total{component="runtime_store",operation="register_session"} 1',
    ),
    true,
  );
  // Member-affecting drops are counted under their own event_type label so a
  // critical room_member_changed drop is never hidden behind high-frequency
  // room_state_updated drops.
  assert.equal(
    rendered.includes(
      'syncroom_room_event_publish_dropped_total{event_type="room_member_changed"} 2',
    ),
    true,
  );
  // Pre-seeded to 0 so "no drops" is distinguishable from "metric absent".
  assert.equal(
    rendered.includes(
      'syncroom_room_event_publish_dropped_total{event_type="room_state_updated"} 0',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_room_event_publish_dropped_total{event_type="voice_state_updated"} 0',
    ),
    true,
  );
});

test("metrics collector can rebind to the effective runtime store", async () => {
  const localRuntimeStore = createInMemoryRuntimeStore(() => 0);
  const sharedRuntimeStore = createInMemoryRuntimeStore(() => 0);
  const metrics = createMetricsCollector({
    runtimeStore: localRuntimeStore,
    roomStore: {
      async countRooms() {
        return 0;
      },
    } as never,
  });

  sharedRuntimeStore.registerSession({
    id: "shared-session",
    connectionState: "detached",
    socket: null,
    instanceId: "instance-shared",
    remoteAddress: "127.0.0.1",
    origin: "chrome-extension://allowed-extension",
    roomCode: null,
    memberId: null,
    displayName: "Bob",
    memberToken: null,
    joinedAt: null,
    invalidMessageCount: 0,
    rateLimitState: {
      roomCreate: { windowStart: 0, count: 0 },
      roomJoin: { windowStart: 0, count: 0 },
      videoShare: { windowStart: 0, count: 0 },
      playbackUpdate: { tokens: 0, lastRefillAt: 0 },
      syncRequest: { windowStart: 0, count: 0 },
      syncPing: { tokens: 0, lastRefillAt: 0 },
    },
  });
  sharedRuntimeStore.markSessionJoinedRoom("shared-session", "ROOM99");

  metrics.bindRuntimeStore(sharedRuntimeStore);

  const rendered = await metrics.render();

  assert.equal(rendered.includes("syncroom_connections 1"), true);
  assert.equal(rendered.includes("syncroom_active_rooms 1"), true);
});

test("metrics collector aggregates web playback and proxy observability with safe labels", async () => {
  const runtimeStore = createInMemoryRuntimeStore(() => 0);
  const metrics = createMetricsCollector({
    runtimeStore,
    roomStore: {
      async countRooms() {
        return 0;
      },
    } as never,
  });

  metrics.recordPlaybackStartupFailure({
    roomCode: "ROOM01",
    providerId: "bilibili",
    stage: "manifest",
  });
  metrics.recordPlaybackStartupFailure({
    roomCode: "ROOM01",
    providerId: "https://cdn.example.com/video.m4s?SESSDATA=secret",
    stage: "https://cdn.example.com/manifest.mpd?SESSDATA=secret" as never,
  });
  metrics.recordDirectLinkPlaybackOutcome({
    roomCode: "ROOM01",
    providerId: "bilibili",
    outcome: "success",
  });
  metrics.recordDirectLinkPlaybackOutcome({
    roomCode: "ROOM01",
    providerId: "bilibili",
    outcome: "failure",
  });
  metrics.recordDirectLinkPlaybackOutcome({
    roomCode: "ROOM01",
    providerId: "bilibili",
    outcome: "proxy_fallback",
  });
  metrics.recordMemberPlayerError({
    roomCode: "ROOM01",
    providerId: "bilibili",
    stage: "decode",
    browser: "chrome",
    system: "windows",
  });
  metrics.recordMemberPlayerError({
    roomCode: "ROOM01",
    providerId: "bilibili",
    stage: "segment",
    browser: "https://example.com?cookie=SESSDATA" as never,
    system: "Authorization: Bearer secret" as never,
  });
  metrics.recordProxyTraffic({
    roomCode: "ROOM01",
    providerId: "bilibili",
    bytes: 2048,
  });
  metrics.recordProxyTraffic({
    roomCode: "ROOM01",
    providerId: "bilibili",
    bytes: 1024,
  });
  metrics.recordProxyRequest({
    roomCode: "ROOM01",
    providerId: "bilibili",
  });
  metrics.recordProxyRequest({
    roomCode: "ROOM01",
    providerId: "bilibili",
  });
  metrics.recordProxyUpstreamTraffic({
    roomCode: "ROOM01",
    providerId: "bilibili",
    bytes: 2048,
  });
  metrics.recordProxyUpstreamRequest({
    roomCode: "ROOM01",
    providerId: "bilibili",
    outcome: "success",
  });
  metrics.recordProxyCacheEvent({
    roomCode: "ROOM01",
    providerId: "bilibili",
    event: "miss",
  });
  metrics.recordProxyCacheEvent({
    roomCode: "ROOM01",
    providerId: "bilibili",
    event: "hit",
  });
  metrics.recordNginxProxyCacheRequest({
    status: "hit",
    bytes: 262144,
    durationMs: 12,
  });
  metrics.recordNginxProxyCacheRequest({
    status: "miss",
    bytes: 262144,
    durationMs: 180,
  });

  const rendered = await metrics.render();

  assert.equal(
    rendered.includes(
      'syncroom_playback_startup_failures_total{provider="bilibili",stage="manifest"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_playback_startup_failures_total{provider="unknown",stage="unknown"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_direct_link_playback_total{outcome="success",provider="bilibili",room_code="ROOM01"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_direct_link_playback_total{outcome="failure",provider="bilibili",room_code="ROOM01"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_direct_link_playback_total{outcome="proxy_fallback",provider="bilibili",room_code="ROOM01"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_member_player_errors_total{browser="chrome",provider="bilibili",stage="decode",system="windows"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_member_player_errors_total{browser="unknown",provider="bilibili",stage="segment",system="unknown"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_proxy_traffic_bytes_total{provider="bilibili",room_code="ROOM01"} 3072',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_proxy_requests_total{provider="bilibili",room_code="ROOM01"} 2',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_proxy_upstream_traffic_bytes_total{provider="bilibili",room_code="ROOM01"} 2048',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_proxy_upstream_requests_total{outcome="success",provider="bilibili",room_code="ROOM01"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_proxy_cache_events_total{event="miss",provider="bilibili",room_code="ROOM01"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_proxy_cache_events_total{event="hit",provider="bilibili",room_code="ROOM01"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_nginx_proxy_cache_requests_total{status="hit"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_nginx_proxy_cache_requests_total{status="miss"} 1',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_nginx_proxy_cache_bytes_total{status="hit"} 262144',
    ),
    true,
  );
  assert.equal(
    rendered.includes(
      'syncroom_nginx_proxy_cache_request_duration_seconds_count{status="miss"} 1',
    ),
    true,
  );
  assert.equal(rendered.includes("SESSDATA"), false);
  assert.equal(rendered.includes("Authorization"), false);
  assert.equal(rendered.includes("https://cdn.example.com"), false);
});

test("metrics collector removes per-room proxy series when a room is cleared", async () => {
  const metrics = createMetricsCollector({
    runtimeStore: createInMemoryRuntimeStore(() => 0),
    roomStore: {
      async countRooms() {
        return 0;
      },
    } as never,
  });
  for (const roomCode of ["ROOM01", "ROOM02"]) {
    metrics.recordProxyTraffic({
      roomCode,
      providerId: "bilibili",
      bytes: 1_024,
    });
    metrics.recordProxyRequest({ roomCode, providerId: "bilibili" });
    metrics.recordProxyUpstreamTraffic({
      roomCode,
      providerId: "bilibili",
      bytes: 1_024,
    });
    metrics.recordProxyUpstreamRequest({
      roomCode,
      providerId: "bilibili",
      outcome: "success",
    });
    metrics.recordProxyCacheEvent({
      roomCode,
      providerId: "bilibili",
      event: "hit",
    });
  }

  metrics.clearProxyRoom("room01");
  const rendered = await metrics.render();

  assert.equal(rendered.includes('room_code="ROOM01"'), false);
  assert.equal(rendered.includes('room_code="ROOM02"'), true);
});
