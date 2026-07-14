import type { IncomingMessage, ServerResponse } from "node:http";
import type { PlaybackProxyController } from "./controller.js";
import type { PlaybackProxyResourceKind } from "./service.js";

function createCorsHeaders(request: IncomingMessage): Record<string, string> {
  const origin =
    typeof request.headers.origin === "string" ? request.headers.origin : "*";
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "Range, Content-Type",
    "access-control-expose-headers":
      "Accept-Ranges, Content-Length, Content-Range, Content-Type",
    ...(origin !== "*" ? { vary: "Origin" } : {}),
  };
}

function sendRouteNotFound(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  response.writeHead(404, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...createCorsHeaders(request),
  });
  response.end(
    JSON.stringify({
      ok: false,
      error: {
        code: "proxy_route_not_found",
        message: "Proxy route not found.",
      },
    }),
  );
}

function getProxyRoute(
  request: IncomingMessage,
): { kind: PlaybackProxyResourceKind; resourceId: string } | null {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  const match = pathname.match(/^\/proxy\/(manifest|segment)\/([^/]+)\/?$/);
  if (!match) {
    return null;
  }

  try {
    return {
      kind: match[1] as PlaybackProxyResourceKind,
      resourceId: decodeURIComponent(match[2]),
    };
  } catch {
    return {
      kind: match[1] as PlaybackProxyResourceKind,
      resourceId: "",
    };
  }
}

export function createPlaybackProxyRouter(args: {
  controller: PlaybackProxyController;
}) {
  return {
    async handle(
      request: IncomingMessage,
      response: ServerResponse,
    ): Promise<boolean> {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (!pathname.startsWith("/proxy/")) {
        return false;
      }

      const route = getProxyRoute(request);
      if (!route) {
        sendRouteNotFound(request, response);
        return true;
      }

      await args.controller.handleResource({
        request,
        response,
        kind: route.kind,
        resourceId: route.resourceId,
      });
      return true;
    },
  };
}

export type PlaybackProxyRouter = ReturnType<typeof createPlaybackProxyRouter>;
