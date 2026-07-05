import type { IncomingMessage, ServerResponse } from "node:http";
import {
  isPlaybackProxyPolicy,
  isVideoProviderId,
  type PlaybackProxyPolicy,
  type ProviderPlaybackCandidate,
  type ProviderPlaybackDescriptor,
  type VideoProviderId,
} from "@syncroom/protocol";
import {
  JsonBodyParseError,
  getPathSegments,
  readJsonBody,
} from "../admin/request.js";
import {
  INVALID_JSON_REQUEST_BODY_MESSAGE,
  MEMBER_TOKEN_INVALID_MESSAGE,
  ROOM_NOT_FOUND_MESSAGE,
} from "../messages.js";
import type { PlaybackProxyService } from "../playback-proxy/service.js";
import type { RoomStore } from "../room-store.js";
import type { RuntimeStore } from "../runtime-store.js";
import type { PersistedRoom, Session } from "../types.js";
import {
  VideoAuthSessionError,
  type VideoAuthAccessContext,
  type VideoAuthSessionService,
} from "../video-auth-session.js";
import {
  VideoProviderError,
  createProviderPlaybackDescriptor,
  toSafeProviderError,
  type ProviderParseResult,
  type ProviderPlayableItem,
  type VideoProviderRegistry,
} from "./video-provider.js";

const BILIBILI_MEDIA_REFERER = "https://www.bilibili.com";
const BILIBILI_MEDIA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

type JsonObject = Record<string, unknown>;

type ProviderRouterBody = {
  roomCode?: unknown;
  memberToken?: unknown;
};

type HostProviderContext = {
  providerId: VideoProviderId;
  provider: NonNullable<ReturnType<VideoProviderRegistry["get"]>>;
  access: VideoAuthAccessContext;
};

type ProviderPickerItem = {
  itemId: string;
  title: string;
  kind: string;
  qualityLabel?: string;
  sourceType?: string;
  providerDescriptor: ProviderPlaybackDescriptor;
};

export type VideoProviderRouter = {
  handle: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<boolean>;
};

export type VideoProviderRouterOptions = {
  roomStore: RoomStore;
  runtimeStore: RuntimeStore;
  providers: VideoProviderRegistry;
  authService: VideoAuthSessionService;
  playbackProxyService: PlaybackProxyService;
  fetch?: typeof fetch;
};

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function sendError(
  response: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  reason?: string,
): void {
  sendJson(response, statusCode, {
    ok: false,
    error: {
      code,
      message,
      ...(reason ? { reason } : {}),
    },
  });
}

function readRequiredString(body: JsonObject, key: string): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readOptionalRecord(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function matchProviderUrlSafely(
  provider: HostProviderContext["provider"],
  url: string,
): ReturnType<HostProviderContext["provider"]["matchUrl"]> {
  try {
    return provider.matchUrl(url);
  } catch (error) {
    if (error instanceof TypeError) {
      // Provider adapters should return null for unsupported URLs, but URL
      // constructors can throw before that branch. Keep malformed user input
      // on the 400 path instead of surfacing it as a server fault.
      return null;
    }
    throw error;
  }
}

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function getPublicBaseUrl(request: IncomingMessage): string {
  const forwardedProto = getHeaderValue(request.headers["x-forwarded-proto"]);
  const forwardedHost = getHeaderValue(request.headers["x-forwarded-host"]);
  const proto =
    forwardedProto?.split(",")[0]?.trim() ||
    ((request.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
  const host =
    forwardedHost?.split(",")[0]?.trim() || request.headers.host || "localhost";
  return `${proto}://${host}`;
}

function createHttpSession(args: {
  request: IncomingMessage;
  room: PersistedRoom;
  memberId: string;
  memberToken: string;
  displayName: string;
}): Session {
  return {
    id: `http:${args.memberId}`,
    connectionState: "detached",
    socket: null,
    remoteAddress: args.request.socket.remoteAddress ?? null,
    origin:
      typeof args.request.headers.origin === "string"
        ? args.request.headers.origin
        : null,
    roomCode: args.room.code,
    memberId: args.memberId,
    displayName: args.displayName,
    memberToken: args.memberToken,
    joinedAt: null,
    invalidMessageCount: 0,
    rateLimitState: {} as Session["rateLimitState"],
  };
}

function createProviderHeaders(
  providerId: VideoProviderId,
  credentials: Record<string, unknown> | null | undefined,
): Record<string, string> | undefined {
  if (providerId !== "bilibili") {
    return undefined;
  }
  const headers: Record<string, string> = {
    Referer: BILIBILI_MEDIA_REFERER,
    "User-Agent": BILIBILI_MEDIA_USER_AGENT,
  };
  if (typeof credentials?.cookies === "string") {
    headers.Cookie = credentials.cookies;
  }
  return headers;
}

function readCandidateUpstreamHeaders(
  candidate: Record<string, unknown>,
): Record<string, string> | undefined {
  const value = candidate.upstreamHeaders;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (typeof headerValue === "string") {
      headers[name] = headerValue;
    }
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function readCandidateUpstreamUrlAlternates(
  candidate: Record<string, unknown>,
): Record<string, string[]> | undefined {
  const value = candidate.upstreamUrlAlternates;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const alternates: Record<string, string[]> = {};
  for (const [upstreamUrl, upstreamUrls] of Object.entries(value)) {
    if (!Array.isArray(upstreamUrls)) {
      continue;
    }
    const urls = upstreamUrls.filter(
      (url): url is string => typeof url === "string",
    );
    if (urls.length > 0) {
      alternates[upstreamUrl] = urls;
    }
  }
  return Object.keys(alternates).length > 0 ? alternates : undefined;
}

function mergeUpstreamHeaders(
  providerHeaders: Record<string, string> | undefined,
  candidate: ProviderPlaybackCandidate & Record<string, unknown>,
): Record<string, string> | undefined {
  const candidateHeaders = readCandidateUpstreamHeaders(candidate);
  if (!providerHeaders && !candidateHeaders) {
    return undefined;
  }
  return {
    ...(providerHeaders ?? {}),
    ...(candidateHeaders ?? {}),
  };
}

function getDefaultCandidate(
  descriptor: ProviderPlaybackDescriptor,
): ProviderPlaybackCandidate {
  return (
    descriptor.candidates.find(
      (candidate) => candidate.id === descriptor.defaultCandidateId,
    ) ??
    descriptor.candidates.find((candidate) => candidate.default) ??
    descriptor.candidates[0]!
  );
}

function createPickerItem(
  descriptor: ProviderPlaybackDescriptor,
): ProviderPickerItem {
  const candidate = getDefaultCandidate(descriptor);
  return {
    itemId: descriptor.item.itemId,
    title: descriptor.item.title,
    kind: descriptor.item.kind,
    ...(candidate.qualityLabel ? { qualityLabel: candidate.qualityLabel } : {}),
    sourceType: candidate.sourceType,
    providerDescriptor: descriptor,
  };
}

async function readUpstreamManifest(args: {
  fetchImpl: typeof fetch;
  url: string;
  headers: Record<string, string> | undefined;
}): Promise<string> {
  const response = await args.fetchImpl(args.url, {
    headers: args.headers,
  });
  if (!response.ok) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Provider manifest request failed.",
      `manifest_http_${response.status}`,
    );
  }
  return await response.text();
}

function readInlineManifest(
  candidate: ProviderPlaybackCandidate & Record<string, unknown>,
): string | null {
  return typeof candidate.manifest === "string" &&
    candidate.manifest.trim().length > 0
    ? candidate.manifest
    : null;
}

async function proxyCandidate(args: {
  candidate: ProviderPlaybackCandidate & Record<string, unknown>;
  roomCode: string;
  providerId: VideoProviderId;
  publicBaseUrl: string;
  upstreamHeaders: Record<string, string> | undefined;
  playbackProxyService: PlaybackProxyService;
  fetchImpl: typeof fetch;
}): Promise<ProviderPlaybackCandidate> {
  const upstreamHeaders = mergeUpstreamHeaders(
    args.upstreamHeaders,
    args.candidate,
  );
  if (
    args.candidate.sourceType === "mp4" ||
    args.candidate.sourceType === "flv" ||
    args.candidate.sourceType === "ts"
  ) {
    const upstreamUrlAlternates = readCandidateUpstreamUrlAlternates(
      args.candidate,
    );
    const registered = args.playbackProxyService.registerSegment({
      roomCode: args.roomCode,
      providerId: args.providerId,
      upstreamUrl: args.candidate.url,
      publicBaseUrl: args.publicBaseUrl,
      upstreamHeaders,
      fallbackUpstreamUrls: upstreamUrlAlternates?.[args.candidate.url],
    });
    return {
      ...args.candidate,
      url: registered.segmentUrl,
    };
  }

  if (
    args.candidate.sourceType === "m3u8" ||
    args.candidate.sourceType === "mpd"
  ) {
    const manifest =
      readInlineManifest(args.candidate) ??
      (await readUpstreamManifest({
        fetchImpl: args.fetchImpl,
        url: args.candidate.url,
        headers: upstreamHeaders,
      }));
    const registered =
      args.candidate.sourceType === "m3u8"
        ? args.playbackProxyService.registerM3u8Manifest({
            roomCode: args.roomCode,
            providerId: args.providerId,
            manifest,
            manifestUrl: args.candidate.url,
            publicBaseUrl: args.publicBaseUrl,
            upstreamHeaders,
            upstreamUrlAlternates: readCandidateUpstreamUrlAlternates(
              args.candidate,
            ),
          })
        : args.playbackProxyService.registerMpdManifest({
            roomCode: args.roomCode,
            providerId: args.providerId,
            manifest,
            manifestUrl: args.candidate.url,
            publicBaseUrl: args.publicBaseUrl,
            upstreamHeaders,
            upstreamUrlAlternates: readCandidateUpstreamUrlAlternates(
              args.candidate,
            ),
          });
    return {
      ...args.candidate,
      url: registered.manifestUrl,
    };
  }

  return args.candidate;
}

async function createPickerItems(args: {
  result: ProviderParseResult;
  policy: PlaybackProxyPolicy;
  roomCode: string;
  publicBaseUrl: string;
  upstreamHeaders: Record<string, string> | undefined;
  playbackProxyService: PlaybackProxyService;
  fetchImpl: typeof fetch;
}): Promise<ProviderPickerItem[]> {
  const items: ProviderPickerItem[] = [];
  for (const item of args.result.items) {
    const playableItem: ProviderPlayableItem = args.policy.proxy
      ? {
          ...item,
          candidates: (await Promise.all(
            item.candidates.map((candidate) =>
              proxyCandidate({
                candidate,
                roomCode: args.roomCode,
                providerId: args.result.providerId,
                publicBaseUrl: args.publicBaseUrl,
                upstreamHeaders: args.upstreamHeaders,
                playbackProxyService: args.playbackProxyService,
                fetchImpl: args.fetchImpl,
              }),
            ),
          )) as ProviderPlayableItem["candidates"],
        }
      : item;
    const descriptor = createProviderPlaybackDescriptor(
      {
        ...args.result,
        items: [playableItem],
      },
      {
        itemId: playableItem.item.itemId,
        policy: args.policy,
      },
    );
    items.push(createPickerItem(descriptor));
  }
  return items;
}

export function createVideoProviderRouter(
  options: VideoProviderRouterOptions,
): VideoProviderRouter {
  const fetchImpl = options.fetch ?? fetch;

  async function readBody(request: IncomingMessage): Promise<JsonObject> {
    const body = await readJsonBody<JsonObject>(request);
    return readOptionalRecord(body) ?? {};
  }

  async function requireHostProviderContext(
    request: IncomingMessage,
    response: ServerResponse,
    providerId: VideoProviderId,
    body: ProviderRouterBody,
    action: "start" | "poll" | "status" | "parse" | "logout",
  ): Promise<HostProviderContext | null> {
    const provider = options.providers.get(providerId);
    if (!provider) {
      sendError(response, 404, "provider_not_found", "Provider not found.");
      return null;
    }

    const roomCode =
      typeof body.roomCode === "string" ? body.roomCode.trim() : "";
    const memberToken =
      typeof body.memberToken === "string" ? body.memberToken.trim() : "";
    if (!roomCode || !memberToken) {
      sendError(response, 400, "invalid_request", "Invalid provider request.");
      return null;
    }

    const room = await options.roomStore.getRoom(roomCode);
    if (!room) {
      sendError(response, 404, "room_not_found", ROOM_NOT_FOUND_MESSAGE);
      return null;
    }

    const memberId = options.runtimeStore.findMemberIdByToken(
      room.code,
      memberToken,
    );
    if (!memberId) {
      sendError(
        response,
        401,
        "member_token_invalid",
        MEMBER_TOKEN_INVALID_MESSAGE,
      );
      return null;
    }

    const activeSession =
      options.runtimeStore.getRoom(room.code)?.members.get(memberId) ?? null;
    const session = createHttpSession({
      request,
      room,
      memberId,
      memberToken,
      displayName:
        activeSession?.displayName ??
        (memberId === room.ownerMemberId ? room.ownerDisplayName : null) ??
        "Member",
    });

    try {
      const access = options.authService.requireHostAccess({
        room,
        session,
        memberToken,
        providerId,
        action,
      });
      return { providerId, provider, access };
    } catch (error) {
      if (error instanceof VideoAuthSessionError) {
        sendError(
          response,
          error.code === "provider_auth_forbidden" ? 403 : 401,
          error.code,
          error.message,
        );
        return null;
      }
      throw error;
    }
  }

  async function handleAuthStart(
    request: IncomingMessage,
    response: ServerResponse,
    providerId: VideoProviderId,
  ): Promise<void> {
    const body = await readBody(request);
    const context = await requireHostProviderContext(
      request,
      response,
      providerId,
      body,
      "start",
    );
    if (!context) {
      return;
    }
    const method =
      body.method === "sms" ? "sms" : body.method === "qr" ? "qr" : null;
    if (!method) {
      sendError(response, 400, "invalid_request", "Invalid provider request.");
      return;
    }
    const data = await context.provider.auth.start({
      method,
      roomCode: context.access.roomCode,
      ownerMemberId: context.access.ownerMemberId,
      displayName: context.access.displayName,
    });
    sendJson(response, 200, { ok: true, data });
  }

  async function handleAuthPoll(
    request: IncomingMessage,
    response: ServerResponse,
    providerId: VideoProviderId,
  ): Promise<void> {
    const body = await readBody(request);
    const context = await requireHostProviderContext(
      request,
      response,
      providerId,
      body,
      "poll",
    );
    if (!context) {
      return;
    }
    const flowId = readRequiredString(body, "flowId");
    if (!flowId) {
      sendError(response, 400, "invalid_request", "Invalid provider request.");
      return;
    }
    const data = await context.provider.auth.poll({
      flowId,
      roomCode: context.access.roomCode,
      ownerMemberId: context.access.ownerMemberId,
      sms: readOptionalRecord(body.sms),
    });
    sendJson(response, 200, { ok: true, data });
  }

  async function handleAuthStatus(
    request: IncomingMessage,
    response: ServerResponse,
    providerId: VideoProviderId,
  ): Promise<void> {
    const body = await readBody(request);
    const context = await requireHostProviderContext(
      request,
      response,
      providerId,
      body,
      "status",
    );
    if (!context) {
      return;
    }
    const data = await context.provider.auth.me({
      roomCode: context.access.roomCode,
      ownerMemberId: context.access.ownerMemberId,
    });
    sendJson(response, 200, { ok: true, data });
  }

  async function handleAuthLogout(
    request: IncomingMessage,
    response: ServerResponse,
    providerId: VideoProviderId,
  ): Promise<void> {
    const body = await readBody(request);
    const context = await requireHostProviderContext(
      request,
      response,
      providerId,
      body,
      "logout",
    );
    if (!context) {
      return;
    }
    await context.provider.auth.logout({
      roomCode: context.access.roomCode,
      ownerMemberId: context.access.ownerMemberId,
    });
    options.playbackProxyService.clearProviderAuth(
      context.access.roomCode,
      providerId,
    );
    sendJson(response, 200, { ok: true, data: { loggedOut: true } });
  }

  async function handleParse(
    request: IncomingMessage,
    response: ServerResponse,
    providerId: VideoProviderId,
  ): Promise<void> {
    const body = await readBody(request);
    const context = await requireHostProviderContext(
      request,
      response,
      providerId,
      body,
      "parse",
    );
    if (!context) {
      return;
    }
    const url = readRequiredString(body, "url");
    const policy = body.policy;
    if (!url || !isPlaybackProxyPolicy(policy)) {
      sendError(response, 400, "invalid_request", "Invalid provider request.");
      return;
    }
    const matchedUrl = matchProviderUrlSafely(context.provider, url);
    if (!matchedUrl) {
      sendError(
        response,
        400,
        "unsupported_source",
        "Provider source is unsupported.",
      );
      return;
    }
    const parsePolicy =
      providerId === "bilibili" ? policy : { ...policy, shared: false };
    const credentials =
      providerId === "bilibili"
        ? parsePolicy.shared
          ? await options.authService.getCredentials({
              roomCode: context.access.roomCode,
              providerId,
              ownerMemberId: context.access.ownerMemberId,
            })
          : null
        : providerId === "generic"
          ? null
          : await options.authService.getCredentials({
              roomCode: context.access.roomCode,
              providerId,
              ownerMemberId: context.access.ownerMemberId,
            });
    if (providerId === "bilibili" && parsePolicy.shared && !credentials) {
      sendError(
        response,
        401,
        "provider_auth_required",
        "Bilibili authorization is required.",
      );
      return;
    }
    const result = await context.provider.parse({
      matchedUrl,
      policy: parsePolicy,
      credentials,
    });
    const upstreamHeaders = createProviderHeaders(providerId, credentials);
    const publicBaseUrl = getPublicBaseUrl(request);
    // Delivery mode is an explicit front-end choice: direct mode returns CDN
    // URLs untouched; proxy mode registers media resources under /proxy.
    const deliveryPolicy = parsePolicy;
    const items = await createPickerItems({
      result,
      policy: deliveryPolicy,
      roomCode: context.access.roomCode,
      publicBaseUrl,
      upstreamHeaders,
      playbackProxyService: options.playbackProxyService,
      fetchImpl,
    });
    sendJson(response, 200, {
      ok: true,
      data: {
        providerId: result.providerId,
        sourceId: result.sourceId,
        sourceUrl: result.sourceUrl,
        title: result.title,
        items,
      },
    });
  }

  async function dispatch(
    request: IncomingMessage,
    response: ServerResponse,
    providerId: VideoProviderId,
    tail: string[],
  ): Promise<void> {
    try {
      if (request.method !== "POST") {
        sendError(response, 405, "method_not_allowed", "Method not allowed.");
        return;
      }
      const route = tail.join("/");
      if (route === "auth/start") {
        await handleAuthStart(request, response, providerId);
        return;
      }
      if (route === "auth/poll") {
        await handleAuthPoll(request, response, providerId);
        return;
      }
      if (route === "auth/status") {
        await handleAuthStatus(request, response, providerId);
        return;
      }
      if (route === "auth/logout") {
        await handleAuthLogout(request, response, providerId);
        return;
      }
      if (route === "parse") {
        await handleParse(request, response, providerId);
        return;
      }
      sendError(response, 404, "not_found", "Not found.");
    } catch (error) {
      if (error instanceof JsonBodyParseError) {
        sendError(
          response,
          400,
          "invalid_json",
          INVALID_JSON_REQUEST_BODY_MESSAGE,
        );
        return;
      }
      if (error instanceof VideoProviderError) {
        const safeError = toSafeProviderError(error);
        sendError(
          response,
          400,
          safeError.code,
          safeError.message,
          safeError.reason,
        );
        return;
      }
      sendError(response, 500, "internal_error", "Internal server error.");
    }
  }

  return {
    async handle(request, response) {
      const segments = getPathSegments(request);
      if (
        segments.length < 3 ||
        segments[0] !== "api" ||
        segments[1] !== "providers" ||
        !isVideoProviderId(segments[2])
      ) {
        return false;
      }
      await dispatch(request, response, segments[2], segments.slice(3));
      return true;
    },
  };
}
