import type { RuntimeStore } from "../runtime-store.js";
import type { RoomStore } from "../room-store.js";
import { ROOM_EVENT_TYPES, type RoomEventType } from "../room-event-bus.js";

const DEFAULT_HISTOGRAM_BUCKETS_SECONDS = [
  0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5,
] as const;

const CORE_EVENT_NAMES = [
  "room_created",
  "room_joined",
  "ws_connection_rejected",
  "rate_limited",
] as const;

const PLAYBACK_STARTUP_FAILURE_STAGES = [
  "manifest",
  "segment",
  "decode",
  "network",
  "unknown",
] as const;

const DIRECT_LINK_PLAYBACK_OUTCOMES = [
  "success",
  "failure",
  "proxy_fallback",
] as const;

const MEMBER_PLAYER_BROWSER_LABELS = [
  "chrome",
  "edge",
  "firefox",
  "safari",
  "other",
  "unknown",
] as const;

const MEMBER_PLAYER_SYSTEM_LABELS = [
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
  "other",
  "unknown",
] as const;

export type MonitoredMessageType =
  | "video:share"
  | "playback:update"
  | "room:join"
  | "room:leave";

export type PlaybackStartupFailureStage =
  (typeof PLAYBACK_STARTUP_FAILURE_STAGES)[number];
export type DirectLinkPlaybackOutcome =
  (typeof DIRECT_LINK_PLAYBACK_OUTCOMES)[number];
export type MemberPlayerBrowserLabel =
  (typeof MEMBER_PLAYER_BROWSER_LABELS)[number];
export type MemberPlayerSystemLabel =
  (typeof MEMBER_PLAYER_SYSTEM_LABELS)[number];

type LabelValues = Record<string, string>;

type HistogramSample = {
  bucketCounts: number[];
  count: number;
  sum: number;
  labels: LabelValues;
};

type HistogramMetric = {
  help: string;
  buckets: readonly number[];
  samples: Map<string, HistogramSample>;
};

type CounterSample = {
  labels: LabelValues;
  value: number;
};

type CounterMetric = {
  help: string;
  samples: Map<string, CounterSample>;
};

export type MetricsCollector = {
  bindRuntimeStore: (runtimeStore: RuntimeStore) => void;
  recordEvent: (event: string) => void;
  recordPlaybackStartupFailure: (input: {
    roomCode?: string;
    providerId?: string;
    stage: PlaybackStartupFailureStage;
  }) => void;
  recordDirectLinkPlaybackOutcome: (input: {
    roomCode: string;
    providerId?: string;
    outcome: DirectLinkPlaybackOutcome;
  }) => void;
  recordMemberPlayerError: (input: {
    roomCode?: string;
    providerId?: string;
    stage: PlaybackStartupFailureStage;
    browser?: MemberPlayerBrowserLabel;
    system?: MemberPlayerSystemLabel;
  }) => void;
  recordProxyTraffic: (input: {
    roomCode: string;
    providerId?: string;
    bytes: number;
  }) => void;
  observeMessageHandlerDuration: (
    messageType: MonitoredMessageType,
    durationMs: number,
  ) => void;
  observeRedisRuntimeStoreDuration: (
    operation: string,
    durationMs: number,
  ) => void;
  observeRedisRuntimeStoreFailure: (operation: string) => void;
  observeRedisRoomEventBusPublishDuration: (durationMs: number) => void;
  observeRedisRoomEventBusPublishFailure: () => void;
  recordRoomEventPublishDropped: (eventType: RoomEventType) => void;
  render: () => Promise<string>;
};

function createLabelKey(labels: LabelValues): string {
  return JSON.stringify(
    Object.entries(labels).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function escapeLabelValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}

function formatLabels(labels: LabelValues): string {
  const entries = Object.entries(labels).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  if (entries.length === 0) {
    return "";
  }

  return `{${entries
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(",")}}`;
}

function formatMetricLine(
  name: string,
  value: number,
  labels: LabelValues = {},
): string {
  return `${name}${formatLabels(labels)} ${value}`;
}

function normalizeEnumLabel<T extends readonly string[]>(
  value: string | undefined,
  allowed: T,
): T[number] | "unknown" {
  return allowed.includes(value ?? "") ? (value as T[number]) : "unknown";
}

function normalizeProviderLabel(providerId: string | undefined): string {
  if (!providerId) {
    return "unknown";
  }
  const normalized = providerId.trim().toLowerCase();
  return /^[a-z0-9_-]{1,32}$/.test(normalized) ? normalized : "unknown";
}

function normalizeRoomCodeLabel(roomCode: string | undefined): string {
  if (!roomCode) {
    return "unknown";
  }
  const normalized = roomCode.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(normalized) ? normalized : "unknown";
}

function normalizeByteCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function ensureCounterSample(
  metric: CounterMetric,
  labels: LabelValues,
): CounterSample {
  const key = createLabelKey(labels);
  const existing = metric.samples.get(key);
  if (existing) {
    return existing;
  }

  const sample: CounterSample = {
    labels,
    value: 0,
  };
  metric.samples.set(key, sample);
  return sample;
}

function ensureHistogramSample(
  metric: HistogramMetric,
  labels: LabelValues,
): HistogramSample {
  const key = createLabelKey(labels);
  const existing = metric.samples.get(key);
  if (existing) {
    return existing;
  }

  const sample: HistogramSample = {
    bucketCounts: Array.from({ length: metric.buckets.length }, () => 0),
    count: 0,
    sum: 0,
    labels,
  };
  metric.samples.set(key, sample);
  return sample;
}

export function createMetricsCollector(options: {
  runtimeStore: RuntimeStore;
  roomStore: RoomStore;
}): MetricsCollector {
  let runtimeStore = options.runtimeStore;
  const eventCounter: CounterMetric = {
    help: "Total structured log events grouped by event name",
    samples: new Map(),
  };
  const redisFailureCounter: CounterMetric = {
    help: "Total Redis metric-instrumented operation failures",
    samples: new Map(),
  };
  const roomEventPublishDroppedCounter: CounterMetric = {
    help: "Total room event publishes dropped after backpressure timeout, grouped by event type",
    samples: new Map(),
  };
  const playbackStartupFailureCounter: CounterMetric = {
    help: "Total web playback startup failures grouped by coarse stage and provider",
    samples: new Map(),
  };
  const directLinkPlaybackCounter: CounterMetric = {
    help: "Total direct-link playback outcomes for proxy=false shared=true selections",
    samples: new Map(),
  };
  const memberPlayerErrorCounter: CounterMetric = {
    help: "Total member player errors grouped by coarse browser, system, provider, and stage labels",
    samples: new Map(),
  };
  const proxyTrafficBytesCounter: CounterMetric = {
    help: "Total playback proxy response bytes aggregated by room and provider",
    samples: new Map(),
  };
  const proxyRequestCounter: CounterMetric = {
    help: "Total playback proxy segment requests aggregated by room and provider",
    samples: new Map(),
  };
  const messageDurationHistogram: HistogramMetric = {
    help: "Duration of monitored message handler paths in seconds",
    buckets: DEFAULT_HISTOGRAM_BUCKETS_SECONDS,
    samples: new Map(),
  };
  const redisRuntimeStoreDurationHistogram: HistogramMetric = {
    help: "Duration of Redis runtime store operations in seconds",
    buckets: DEFAULT_HISTOGRAM_BUCKETS_SECONDS,
    samples: new Map(),
  };
  const redisRoomEventBusPublishDurationHistogram: HistogramMetric = {
    help: "Duration of Redis room event bus publish operations in seconds",
    buckets: DEFAULT_HISTOGRAM_BUCKETS_SECONDS,
    samples: new Map(),
  };

  for (const eventName of CORE_EVENT_NAMES) {
    ensureCounterSample(eventCounter, { event: eventName });
  }

  // Pre-seed every room event type to 0 so dashboards can distinguish
  // "no drops" from "metric never emitted" — drops are rare but the
  // critical room_member_* types must be observable the moment they occur.
  for (const eventType of ROOM_EVENT_TYPES) {
    ensureCounterSample(roomEventPublishDroppedCounter, {
      event_type: eventType,
    });
  }

  function incrementCounter(
    metric: CounterMetric,
    labels: LabelValues,
    value = 1,
  ): void {
    ensureCounterSample(metric, labels).value += value;
  }

  function observeHistogram(
    metric: HistogramMetric,
    labels: LabelValues,
    durationMs: number,
  ): void {
    const sample = ensureHistogramSample(metric, labels);
    const durationSeconds = Math.max(durationMs, 0) / 1_000;
    sample.count += 1;
    sample.sum += durationSeconds;
    for (const [index, bucket] of metric.buckets.entries()) {
      if (durationSeconds <= bucket) {
        sample.bucketCounts[index] += 1;
      }
    }
  }

  async function render(): Promise<string> {
    const totalNonExpired = await options.roomStore.countRooms({
      keyword: undefined,
      includeExpired: false,
    });
    const eventSamples = Array.from(eventCounter.samples.values()).sort(
      (a, b) => (a.labels.event ?? "").localeCompare(b.labels.event ?? ""),
    );
    const redisFailureSamples = Array.from(
      redisFailureCounter.samples.values(),
    ).sort((a, b) => {
      const left = `${a.labels.component}:${a.labels.operation}`;
      const right = `${b.labels.component}:${b.labels.operation}`;
      return left.localeCompare(right);
    });
    const roomEventPublishDroppedSamples = Array.from(
      roomEventPublishDroppedCounter.samples.values(),
    ).sort((a, b) =>
      (a.labels.event_type ?? "").localeCompare(b.labels.event_type ?? ""),
    );
    const playbackStartupFailureSamples = Array.from(
      playbackStartupFailureCounter.samples.values(),
    ).sort((a, b) =>
      createLabelKey(a.labels).localeCompare(createLabelKey(b.labels)),
    );
    const directLinkPlaybackSamples = Array.from(
      directLinkPlaybackCounter.samples.values(),
    ).sort((a, b) =>
      createLabelKey(a.labels).localeCompare(createLabelKey(b.labels)),
    );
    const memberPlayerErrorSamples = Array.from(
      memberPlayerErrorCounter.samples.values(),
    ).sort((a, b) =>
      createLabelKey(a.labels).localeCompare(createLabelKey(b.labels)),
    );
    const proxyTrafficBytesSamples = Array.from(
      proxyTrafficBytesCounter.samples.values(),
    ).sort((a, b) =>
      createLabelKey(a.labels).localeCompare(createLabelKey(b.labels)),
    );
    const proxyRequestSamples = Array.from(
      proxyRequestCounter.samples.values(),
    ).sort((a, b) =>
      createLabelKey(a.labels).localeCompare(createLabelKey(b.labels)),
    );
    const histogramMetrics = [
      {
        name: "syncroom_message_handler_duration_seconds",
        metric: messageDurationHistogram,
      },
      {
        name: "syncroom_redis_runtime_store_duration_seconds",
        metric: redisRuntimeStoreDurationHistogram,
      },
      {
        name: "syncroom_redis_room_event_bus_publish_duration_seconds",
        metric: redisRoomEventBusPublishDurationHistogram,
      },
    ] as const;

    const lines = [
      "# HELP syncroom_connections Current websocket connection count",
      "# TYPE syncroom_connections gauge",
      formatMetricLine(
        "syncroom_connections",
        runtimeStore.getConnectionCount(),
      ),
      "# HELP syncroom_active_rooms Current active room count",
      "# TYPE syncroom_active_rooms gauge",
      formatMetricLine(
        "syncroom_active_rooms",
        runtimeStore.getActiveRoomCount(),
      ),
      "# HELP syncroom_rooms_non_expired Current non-expired room count",
      "# TYPE syncroom_rooms_non_expired gauge",
      formatMetricLine("syncroom_rooms_non_expired", totalNonExpired),
      "# HELP syncroom_events_total Total structured log events grouped by event name",
      "# TYPE syncroom_events_total counter",
      ...eventSamples.map((sample) =>
        formatMetricLine("syncroom_events_total", sample.value, sample.labels),
      ),
      "# HELP syncroom_room_created_total Total room_created events",
      "# TYPE syncroom_room_created_total counter",
      formatMetricLine(
        "syncroom_room_created_total",
        ensureCounterSample(eventCounter, { event: "room_created" }).value,
      ),
      "# HELP syncroom_room_joined_total Total room_joined events",
      "# TYPE syncroom_room_joined_total counter",
      formatMetricLine(
        "syncroom_room_joined_total",
        ensureCounterSample(eventCounter, { event: "room_joined" }).value,
      ),
      "# HELP syncroom_ws_connection_rejected_total Total rejected websocket upgrades",
      "# TYPE syncroom_ws_connection_rejected_total counter",
      formatMetricLine(
        "syncroom_ws_connection_rejected_total",
        ensureCounterSample(eventCounter, {
          event: "ws_connection_rejected",
        }).value,
      ),
      "# HELP syncroom_rate_limited_total Total rate_limited events",
      "# TYPE syncroom_rate_limited_total counter",
      formatMetricLine(
        "syncroom_rate_limited_total",
        ensureCounterSample(eventCounter, { event: "rate_limited" }).value,
      ),
      "# HELP syncroom_redis_operation_failures_total Total Redis metric-instrumented operation failures",
      "# TYPE syncroom_redis_operation_failures_total counter",
      ...redisFailureSamples.map((sample) =>
        formatMetricLine(
          "syncroom_redis_operation_failures_total",
          sample.value,
          sample.labels,
        ),
      ),
      "# HELP syncroom_room_event_publish_dropped_total Total room event publishes dropped after backpressure timeout, grouped by event type",
      "# TYPE syncroom_room_event_publish_dropped_total counter",
      ...roomEventPublishDroppedSamples.map((sample) =>
        formatMetricLine(
          "syncroom_room_event_publish_dropped_total",
          sample.value,
          sample.labels,
        ),
      ),
      "# HELP syncroom_playback_startup_failures_total Total web playback startup failures grouped by coarse stage and provider",
      "# TYPE syncroom_playback_startup_failures_total counter",
      ...playbackStartupFailureSamples.map((sample) =>
        formatMetricLine(
          "syncroom_playback_startup_failures_total",
          sample.value,
          sample.labels,
        ),
      ),
      "# HELP syncroom_direct_link_playback_total Total direct-link playback outcomes for proxy=false shared=true selections",
      "# TYPE syncroom_direct_link_playback_total counter",
      ...directLinkPlaybackSamples.map((sample) =>
        formatMetricLine(
          "syncroom_direct_link_playback_total",
          sample.value,
          sample.labels,
        ),
      ),
      "# HELP syncroom_member_player_errors_total Total member player errors grouped by coarse browser, system, provider, and stage labels",
      "# TYPE syncroom_member_player_errors_total counter",
      ...memberPlayerErrorSamples.map((sample) =>
        formatMetricLine(
          "syncroom_member_player_errors_total",
          sample.value,
          sample.labels,
        ),
      ),
      "# HELP syncroom_proxy_traffic_bytes_total Total playback proxy response bytes aggregated by room and provider",
      "# TYPE syncroom_proxy_traffic_bytes_total counter",
      ...proxyTrafficBytesSamples.map((sample) =>
        formatMetricLine(
          "syncroom_proxy_traffic_bytes_total",
          sample.value,
          sample.labels,
        ),
      ),
      "# HELP syncroom_proxy_requests_total Total playback proxy segment requests aggregated by room and provider",
      "# TYPE syncroom_proxy_requests_total counter",
      ...proxyRequestSamples.map((sample) =>
        formatMetricLine(
          "syncroom_proxy_requests_total",
          sample.value,
          sample.labels,
        ),
      ),
    ];

    for (const { name, metric } of histogramMetrics) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} histogram`);
      const samples = Array.from(metric.samples.values()).sort((left, right) =>
        createLabelKey(left.labels).localeCompare(createLabelKey(right.labels)),
      );
      for (const sample of samples) {
        for (const [index, bucket] of metric.buckets.entries()) {
          lines.push(
            formatMetricLine(
              `${name}_bucket`,
              sample.bucketCounts[index] ?? 0,
              {
                ...sample.labels,
                le: String(bucket),
              },
            ),
          );
        }
        lines.push(
          formatMetricLine(`${name}_bucket`, sample.count, {
            ...sample.labels,
            le: "+Inf",
          }),
        );
        lines.push(formatMetricLine(`${name}_sum`, sample.sum, sample.labels));
        lines.push(
          formatMetricLine(`${name}_count`, sample.count, sample.labels),
        );
      }
    }

    return `${lines.join("\n")}\n`;
  }

  return {
    bindRuntimeStore(nextRuntimeStore) {
      runtimeStore = nextRuntimeStore;
    },
    recordEvent(event) {
      incrementCounter(eventCounter, { event });
    },
    recordPlaybackStartupFailure(input) {
      incrementCounter(playbackStartupFailureCounter, {
        provider: normalizeProviderLabel(input.providerId),
        stage: normalizeEnumLabel(input.stage, PLAYBACK_STARTUP_FAILURE_STAGES),
      });
    },
    recordDirectLinkPlaybackOutcome(input) {
      incrementCounter(directLinkPlaybackCounter, {
        outcome: normalizeEnumLabel(
          input.outcome,
          DIRECT_LINK_PLAYBACK_OUTCOMES,
        ),
        provider: normalizeProviderLabel(input.providerId),
        room_code: normalizeRoomCodeLabel(input.roomCode),
      });
    },
    recordMemberPlayerError(input) {
      incrementCounter(memberPlayerErrorCounter, {
        browser: normalizeEnumLabel(
          input.browser,
          MEMBER_PLAYER_BROWSER_LABELS,
        ),
        provider: normalizeProviderLabel(input.providerId),
        stage: normalizeEnumLabel(input.stage, PLAYBACK_STARTUP_FAILURE_STAGES),
        system: normalizeEnumLabel(input.system, MEMBER_PLAYER_SYSTEM_LABELS),
      });
    },
    recordProxyTraffic(input) {
      const labels = {
        provider: normalizeProviderLabel(input.providerId),
        room_code: normalizeRoomCodeLabel(input.roomCode),
      };
      incrementCounter(
        proxyTrafficBytesCounter,
        labels,
        normalizeByteCount(input.bytes),
      );
      incrementCounter(proxyRequestCounter, labels);
    },
    observeMessageHandlerDuration(messageType, durationMs) {
      observeHistogram(
        messageDurationHistogram,
        { message_type: messageType },
        durationMs,
      );
    },
    observeRedisRuntimeStoreDuration(operation, durationMs) {
      observeHistogram(
        redisRuntimeStoreDurationHistogram,
        { operation },
        durationMs,
      );
    },
    observeRedisRuntimeStoreFailure(operation) {
      incrementCounter(redisFailureCounter, {
        component: "runtime_store",
        operation,
      });
    },
    observeRedisRoomEventBusPublishDuration(durationMs) {
      observeHistogram(
        redisRoomEventBusPublishDurationHistogram,
        { operation: "publish" },
        durationMs,
      );
    },
    observeRedisRoomEventBusPublishFailure() {
      incrementCounter(redisFailureCounter, {
        component: "room_event_bus",
        operation: "publish",
      });
    },
    recordRoomEventPublishDropped(eventType) {
      incrementCounter(roomEventPublishDroppedCounter, {
        event_type: eventType,
      });
    },
    render,
  };
}

export function createMetricsService(options: {
  runtimeStore: RuntimeStore;
  roomStore: RoomStore;
}) {
  return createMetricsCollector(options);
}
