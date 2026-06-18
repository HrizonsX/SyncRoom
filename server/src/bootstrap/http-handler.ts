import type { IncomingMessage, ServerResponse } from "node:http";
import { tryHandleAdminPanel } from "../admin-panel.js";
import type { createSecurityPolicy } from "../security.js";
import type { AdminUiConfig } from "../types.js";
import type { PlaybackProxyRouter } from "../playback-proxy/router.js";
import type { VideoProviderRouter } from "../providers/video-provider-router.js";

export function createHttpRequestHandler(args: {
  adminRouter: {
    handle: (
      request: IncomingMessage,
      response: ServerResponse,
    ) => Promise<boolean>;
  };
  securityPolicy: ReturnType<typeof createSecurityPolicy>;
  playbackProxyRouter?: PlaybackProxyRouter;
  videoProviderRouter?: VideoProviderRouter;
  adminUiConfig?: AdminUiConfig;
  metricsEnabled?: boolean;
}) {
  function createCorsHeaders(origin: string | null): Record<string, string> {
    const originCheck = args.securityPolicy.isOriginAllowed(origin);
    if (!origin || !originCheck.ok) {
      return {};
    }
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      vary: "origin",
    };
  }

  function withResponseHeaders(
    response: ServerResponse,
    extraHeaders: Record<string, string>,
  ): ServerResponse {
    if (Object.keys(extraHeaders).length === 0) {
      return response;
    }
    const originalWriteHead = response.writeHead.bind(
      response,
    ) as ServerResponse["writeHead"];
    response.writeHead = ((
      statusCode: number,
      statusMessageOrHeaders?: unknown,
      headers?: unknown,
    ) => {
      if (
        typeof statusMessageOrHeaders === "object" &&
        statusMessageOrHeaders !== null &&
        !Array.isArray(statusMessageOrHeaders)
      ) {
        return originalWriteHead(statusCode, {
          ...extraHeaders,
          ...(statusMessageOrHeaders as Record<string, string>),
        });
      }
      if (
        typeof headers === "object" &&
        headers !== null &&
        !Array.isArray(headers)
      ) {
        return originalWriteHead(statusCode, statusMessageOrHeaders as string, {
          ...extraHeaders,
          ...(headers as Record<string, string>),
        });
      }
      return originalWriteHead(statusCode, extraHeaders);
    }) as ServerResponse["writeHead"];
    return response;
  }

  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const adminUiEnabled = args.adminUiConfig?.enabled !== false;
    const metricsEnabled = args.metricsEnabled ?? true;
    if (pathname === "/metrics" && !metricsEnabled) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: false,
          error: {
            code: "not_found",
            message: "Not found.",
          },
        }),
      );
      return;
    }
    if (pathname === "/api/connection-check") {
      const originHeader = request.headers.origin;
      const origin = typeof originHeader === "string" ? originHeader : null;
      const originCheck = args.securityPolicy.isOriginAllowed(origin);
      const responseHeaders: Record<string, string> = {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        vary: "origin",
      };
      if (originCheck.ok && origin) {
        responseHeaders["access-control-allow-origin"] = origin;
        responseHeaders["access-control-allow-methods"] = "GET, OPTIONS";
        responseHeaders["access-control-allow-headers"] = "content-type";
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, responseHeaders);
        response.end();
        return;
      }
      if (request.method !== "GET") {
        response.writeHead(405, responseHeaders);
        response.end(
          JSON.stringify({
            ok: false,
            error: {
              code: "method_not_allowed",
              message: "Method not allowed.",
            },
          }),
        );
        return;
      }
      response.writeHead(200, responseHeaders);
      response.end(
        JSON.stringify({
          ok: true,
          data: {
            websocketAllowed: originCheck.ok,
          },
        }),
      );
      return;
    }

    try {
      if (args.playbackProxyRouter) {
        const handled = await args.playbackProxyRouter.handle(
          request,
          response,
        );
        if (handled) {
          return;
        }
      }

      if (args.videoProviderRouter) {
        const isProviderApiRequest = pathname.startsWith("/api/providers/");
        if (isProviderApiRequest) {
          const originHeader = request.headers.origin;
          const origin = typeof originHeader === "string" ? originHeader : null;
          const originCheck = args.securityPolicy.isOriginAllowed(origin);
          const corsHeaders = createCorsHeaders(origin);
          if (request.method === "OPTIONS") {
            response.writeHead(originCheck.ok ? 204 : 403, corsHeaders);
            response.end();
            return;
          }
          if (origin && !originCheck.ok) {
            response.writeHead(403, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            response.end(
              JSON.stringify({
                ok: false,
                error: {
                  code: "origin_not_allowed",
                  message: "Origin is not allowed.",
                },
              }),
            );
            return;
          }
          const handled = await args.videoProviderRouter.handle(
            request,
            withResponseHeaders(response, corsHeaders),
          );
          if (handled) {
            return;
          }
        }
        const handled = await args.videoProviderRouter.handle(
          request,
          response,
        );
        if (handled) {
          return;
        }
      }

      const handled =
        adminUiEnabled ||
        pathname === "/api/announcements" ||
        pathname === "/healthz" ||
        pathname === "/readyz" ||
        pathname === "/metrics"
          ? await args.adminRouter.handle(request, response)
          : false;
      if (handled) {
        return;
      }

      if (
        !adminUiEnabled &&
        (pathname === "/admin" ||
          pathname.startsWith("/admin/") ||
          pathname.startsWith("/api/admin/"))
      ) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            ok: false,
            error: {
              code: "not_found",
              message: "Not found.",
            },
          }),
        );
        return;
      }

      const adminPanelHandled = await tryHandleAdminPanel(
        request,
        response,
        args.adminUiConfig,
      );
      if (adminPanelHandled) {
        return;
      }

      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ ok: true, service: "bili-syncplay-server" }),
      );
    } catch {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          ok: false,
          error: {
            code: "internal_error",
            message: "Internal server error.",
          },
        }),
      );
    }
  };
}
