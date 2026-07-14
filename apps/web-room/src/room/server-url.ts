export const DEFAULT_WEB_ROOM_SERVER_URL = "ws://localhost:8787";

export type WebRoomPageLocation = Pick<
  Location,
  "protocol" | "host" | "hostname"
>;

export function getServerUrl(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

export function readCurrentPageLocation(): WebRoomPageLocation | undefined {
  return typeof globalThis.location === "object" && globalThis.location !== null
    ? globalThis.location
    : undefined;
}

function isLocalWebRoomHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function resolveDefaultWebRoomServerUrl(
  pageLocation: WebRoomPageLocation | undefined = readCurrentPageLocation(),
): string {
  if (!pageLocation?.protocol || !pageLocation.host) {
    return DEFAULT_WEB_ROOM_SERVER_URL;
  }

  if (pageLocation.protocol === "https:") {
    return `https://${pageLocation.host}`;
  }

  if (
    pageLocation.protocol === "http:" &&
    pageLocation.hostname &&
    !isLocalWebRoomHost(pageLocation.hostname)
  ) {
    return `http://${pageLocation.hostname}:8787`;
  }

  return DEFAULT_WEB_ROOM_SERVER_URL;
}

export function coerceWebRoomServerUrlForPage(
  serverUrl: string,
  pageLocation: WebRoomPageLocation | undefined = readCurrentPageLocation(),
): string {
  if (pageLocation?.protocol !== "https:") {
    return serverUrl;
  }

  try {
    const parsedUrl = new URL(serverUrl);
    if (
      (parsedUrl.protocol === "ws:" || parsedUrl.protocol === "http:") &&
      parsedUrl.hostname === pageLocation.hostname
    ) {
      // HTTPS 页面禁止主动建立不安全 WS/HTTP 连接；同源地址统一升到 HTTPS，
      // 后续由 provider-api-client 和 room-client 按各自协议场景再转换。
      return `https://${pageLocation.host}`;
    }
  } catch {
    return serverUrl;
  }

  return serverUrl;
}
