import { createSocket, type Socket } from "node:dgram";
import type {
  MetricsCollector,
  NginxProxyCacheStatus,
} from "./admin/metrics.js";
import type { LogEvent } from "./types.js";

const CACHE_METRICS_PATTERN =
  /syncroom_cache\s+status=([^\s]+)\s+bytes=(\d+)\s+request_time=([\d.]+)/;
const KNOWN_CACHE_STATUSES = new Set<NginxProxyCacheStatus>([
  "hit",
  "miss",
  "bypass",
  "expired",
  "stale",
  "updating",
  "revalidated",
  "unknown",
]);

export type NginxCacheMetricsRecord = {
  status: NginxProxyCacheStatus;
  bytes: number;
  durationMs: number;
};

export type NginxCacheMetricsListener = {
  port: number;
  close: () => Promise<void>;
};

export function parseNginxCacheMetricsMessage(
  message: string,
): NginxCacheMetricsRecord | null {
  const match = CACHE_METRICS_PATTERN.exec(message);
  if (!match) {
    return null;
  }

  const rawStatus = match[1]!.toLowerCase();
  const bytes = Number(match[2]);
  const durationSeconds = Number(match[3]);
  if (!Number.isSafeInteger(bytes) || !Number.isFinite(durationSeconds)) {
    return null;
  }

  return {
    status: KNOWN_CACHE_STATUSES.has(rawStatus as NginxProxyCacheStatus)
      ? (rawStatus as NginxProxyCacheStatus)
      : "unknown",
    bytes,
    durationMs: durationSeconds * 1_000,
  };
}

export async function createNginxCacheMetricsListener(options: {
  port: number;
  metricsCollector: MetricsCollector;
  logEvent: LogEvent;
  host?: string;
}): Promise<NginxCacheMetricsListener> {
  const socket = createSocket("udp4");
  const host = options.host ?? "127.0.0.1";

  socket.on("message", (message) => {
    const record = parseNginxCacheMetricsMessage(message.toString("utf8"));
    if (record) {
      options.metricsCollector.recordNginxProxyCacheRequest(record);
    }
  });

  await bindSocket(socket, options.port, host);
  socket.on("error", (error) => {
    options.logEvent("nginx_cache_metrics_listener_error", {
      host,
      port: options.port,
      result: "error",
      error: error.message,
    });
  });
  const address = socket.address();
  options.logEvent("nginx_cache_metrics_listener_started", {
    host,
    port: address.port,
    result: "ok",
  });

  let closed = false;
  return {
    port: address.port,
    close: () => {
      if (closed) {
        return Promise.resolve();
      }
      closed = true;
      return closeSocket(socket);
    },
  };
}

function bindSocket(socket: Socket, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      socket.off("listening", onListening);
      try {
        socket.close();
      } catch {
        // A failed bind may leave the socket unbound, in which case close()
        // throws because there is no active UDP handle to release.
      }
      reject(error);
    };
    const onListening = () => {
      socket.off("error", onError);
      resolve();
    };
    socket.once("error", onError);
    socket.once("listening", onListening);
    socket.bind(port, host);
  });
}

function closeSocket(socket: Socket): Promise<void> {
  return new Promise((resolve) => {
    socket.close(() => resolve());
  });
}
