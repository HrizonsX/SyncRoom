import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type {
  PlaybackProxyResourceKind,
  PlaybackProxyService,
} from "./service.js";
import { PlaybackProxyError } from "./service.js";

const RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

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

function sendJsonError(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...createCorsHeaders(request),
  });
  response.end(
    JSON.stringify({
      ok: false,
      error: { code, message },
    }),
  );
}

function isReadableStreamBody(
  value: unknown,
): value is ReadableStream<Uint8Array> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ReadableStream<Uint8Array>).getReader === "function"
  );
}

function sendResourceBody(
  response: ServerResponse,
  body: string | Uint8Array | ReadableStream<Uint8Array>,
): void {
  if (!isReadableStreamBody(body)) {
    response.end(body);
    return;
  }

  const stream = Readable.fromWeb(
    body as Parameters<typeof Readable.fromWeb>[0],
  );
  stream.on("error", (error) => {
    response.destroy(error);
  });
  stream.pipe(response);
}

export function createPlaybackProxyController(args: {
  service: PlaybackProxyService;
}) {
  return {
    async handleResource(input: {
      request: IncomingMessage;
      response: ServerResponse;
      kind: PlaybackProxyResourceKind;
      resourceId: string;
    }): Promise<void> {
      const { request, response, kind, resourceId } = input;

      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "cache-control": "no-store",
          ...createCorsHeaders(request),
        });
        response.end();
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          allow: "GET, HEAD",
          ...createCorsHeaders(request),
        });
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

      if (!RESOURCE_ID_PATTERN.test(resourceId)) {
        sendJsonError(
          request,
          response,
          400,
          "proxy_invalid_resource_id",
          "Invalid proxy resource id.",
        );
        return;
      }

      try {
        const resource = await args.service.resolveResource({
          kind,
          resourceId,
          headers: request.headers,
          method: request.method === "HEAD" ? "HEAD" : "GET",
        });
        if (!resource) {
          sendJsonError(
            request,
            response,
            404,
            "proxy_resource_not_found",
            "Proxy resource not found or expired.",
          );
          return;
        }

        response.writeHead(resource.statusCode ?? 200, {
          "content-type": resource.contentType,
          "cache-control": "no-store",
          ...createCorsHeaders(request),
          ...(resource.headers ?? {}),
        });
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        sendResourceBody(response, resource.body);
      } catch (error) {
        if (error instanceof PlaybackProxyError) {
          sendJsonError(
            request,
            response,
            error.statusCode,
            error.code,
            error.message,
          );
          return;
        }
        sendJsonError(
          request,
          response,
          500,
          "proxy_internal_error",
          "Playback proxy failed.",
        );
      }
    },
  };
}

export type PlaybackProxyController = ReturnType<
  typeof createPlaybackProxyController
>;
