import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import type {
  ProviderAuthController,
  ProviderAuthFlowDetails,
  ProviderAuthPollResult,
  ProviderMatchedUrl,
  ProviderParseResult,
  VideoProviderAdapter,
} from "./video-provider.js";
import {
  createUnavailableProviderAuth,
  unavailableProviderParse,
  VideoProviderError,
} from "./video-provider.js";
import type {
  VideoAuthCredentials,
  VideoAuthProfile,
  VideoAuthStatus,
} from "../video-auth-session.js";
import type {
  MediaExtractorCandidate,
  MediaExtractorClient,
} from "./media-extractor-client.js";

const IQIYI_QR_TOKEN_URL =
  "https://passport.iqiyi.com/apis/qrcode/gen_login_token.action";
const IQIYI_QR_POLL_URL =
  "https://passport.iqiyi.com/apis/qrcode/is_token_login.action";
const IQIYI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const IQIYI_REFERER = "https://www.iqiyi.com/";
const IQIYI_PTID = "01010021010000000000";
const DEFAULT_QR_FLOW_TTL_MS = 300_000;
const QR_FLOW_PREFIX = "qr:";
const IQIYI_AUTH_COOKIE_NAMES = new Set([
  "P00001",
  "P00003",
  "P00004",
  "P00007",
  "P00010",
  "P01010",
  "P00PRU",
]);

type IqiyiProviderAuthSessions = {
  authorize: (args: {
    roomCode: string;
    providerId: "iqiyi";
    ownerMemberId: string;
    profile: VideoAuthProfile | null;
    credentials: VideoAuthCredentials;
  }) => Promise<VideoAuthStatus>;
  getStatus: (key: {
    roomCode: string;
    providerId: "iqiyi";
    ownerMemberId: string;
  }) => Promise<VideoAuthStatus | null>;
  getCredentials: (key: {
    roomCode: string;
    providerId: "iqiyi";
    ownerMemberId: string;
  }) => Promise<VideoAuthCredentials | null>;
  logout: (key: {
    roomCode: string;
    providerId: "iqiyi";
    ownerMemberId: string;
  }) => Promise<boolean>;
};

export type IqiyiProviderOptions = {
  fetch?: typeof fetch;
  authSessions?: IqiyiProviderAuthSessions;
  extractorClient?: MediaExtractorClient;
  now?: () => number;
  qrFlowTtlMs?: number;
  createFlowId?: () => string;
};

type PendingQrFlow = {
  method: "qr";
  flowId: string;
  token: string;
  roomCode: string;
  ownerMemberId: string;
  expiresAt: number;
};

type IqiyiApiEnvelope<TData> = {
  code?: unknown;
  msg?: unknown;
  data?: TData;
};

type IqiyiTokenData = {
  token?: unknown;
  expire?: unknown;
  url?: unknown;
};

type IqiyiPollData = {
  userinfo?: {
    uid?: unknown;
    nickname?: unknown;
    icon?: unknown;
  };
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function createFormBody(entries: Array<[string, string | number]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of entries) {
    params.set(key, String(value));
  }
  return params.toString();
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeIqiyiUrl(value: string): string | null {
  if (!isHttpUrl(value)) {
    return null;
  }
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    hostname !== "iqiyi.com" &&
    hostname !== "iq.com" &&
    !hostname.endsWith(".iqiyi.com") &&
    !hostname.endsWith(".iq.com")
  ) {
    return null;
  }
  return url.toString();
}

function createSourceId(url: string): string {
  return `iqiyi:${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

function toProviderCandidate(candidate: MediaExtractorCandidate) {
  return {
    id: candidate.id,
    sourceType: candidate.sourceType,
    url: candidate.url,
    ...(candidate.mimeType ? { mimeType: candidate.mimeType } : {}),
    ...(candidate.codecs ? { codecs: candidate.codecs } : {}),
    ...(candidate.qualityLabel ? { qualityLabel: candidate.qualityLabel } : {}),
    ...(candidate.width !== undefined ? { width: candidate.width } : {}),
    ...(candidate.height !== undefined ? { height: candidate.height } : {}),
    ...(candidate.bandwidth !== undefined
      ? { bandwidth: candidate.bandwidth }
      : {}),
    ...(candidate.upstreamHeaders
      ? { upstreamHeaders: candidate.upstreamHeaders }
      : {}),
  };
}

function createIqiyiExtractorHeaders(
  credentials: VideoAuthCredentials | null | undefined,
): Record<string, string> {
  return {
    "User-Agent": IQIYI_USER_AGENT,
    Referer: IQIYI_REFERER,
    ...(typeof credentials?.cookies === "string"
      ? { Cookie: credentials.cookies }
      : {}),
  };
}

async function requestIqiyiJson<TData>(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<{
  payload: IqiyiApiEnvelope<TData>;
  headers: Headers;
}> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "iQIYI authorization request failed.",
      error instanceof Error ? error.message : "request_failed",
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "iQIYI authorization response was invalid.",
      "invalid_json",
    );
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "iQIYI authorization response was invalid.",
      "invalid_payload",
    );
  }
  return {
    payload: payload as IqiyiApiEnvelope<TData>,
    headers: response.headers,
  };
}

async function createQrCodeDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    margin: 1,
    width: 240,
    errorCorrectionLevel: "M",
  });
}

function readSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(headers);
  }
  const combined = headers.get("set-cookie");
  return combined ? [combined] : [];
}

function splitCombinedSetCookie(value: string): string[] {
  return value.split(/,(?=\s*[A-Za-z0-9_-]+=)/g).map((item) => item.trim());
}

function readCookiePair(setCookie: string): [string, string] | null {
  const [pair] = setCookie.split(";");
  const separatorIndex = pair?.indexOf("=") ?? -1;
  if (!pair || separatorIndex <= 0) {
    return null;
  }
  const name = pair.slice(0, separatorIndex).trim();
  const value = pair.slice(separatorIndex + 1).trim();
  return name && value ? [name, value] : null;
}

function buildCookieCredentials(headers: Headers): VideoAuthCredentials {
  const cookiePairs: string[] = [];
  for (const rawHeader of readSetCookieHeaders(headers)) {
    for (const setCookie of splitCombinedSetCookie(rawHeader)) {
      const pair = readCookiePair(setCookie);
      if (!pair || !IQIYI_AUTH_COOKIE_NAMES.has(pair[0])) {
        continue;
      }
      cookiePairs.push(`${pair[0]}=${pair[1]}`);
    }
  }
  return cookiePairs.length > 0 ? { cookies: cookiePairs.join("; ") } : {};
}

function buildProfileFromPollData(
  data: IqiyiPollData | undefined,
): VideoAuthProfile | null {
  const uid = readString(data?.userinfo?.uid);
  if (!uid) {
    return null;
  }
  return {
    id: uid,
    ...(readString(data?.userinfo?.nickname)
      ? { displayName: readString(data?.userinfo?.nickname) ?? undefined }
      : {}),
    ...(readString(data?.userinfo?.icon)
      ? { avatarUrl: readString(data?.userinfo?.icon) ?? undefined }
      : {}),
  };
}

function createIqiyiAuthController(options: {
  fetchImpl: typeof fetch;
  authSessions: IqiyiProviderAuthSessions;
  now: () => number;
  qrFlowTtlMs: number;
  createFlowId: () => string;
}): ProviderAuthController {
  const pendingFlows = new Map<string, PendingQrFlow>();

  function getNow(explicitNow?: number): number {
    return explicitNow ?? options.now();
  }

  function getFlow(flowId: string, currentTime: number): PendingQrFlow | null {
    const flow = pendingFlows.get(flowId);
    if (!flow || flow.expiresAt <= currentTime) {
      if (flow) {
        pendingFlows.delete(flowId);
      }
      return null;
    }
    return flow;
  }

  return {
    async start(input): Promise<ProviderAuthFlowDetails> {
      if (input.method !== "qr") {
        throw new VideoProviderError(
          "provider_auth_unavailable",
          "iQIYI SMS authorization is unavailable.",
          "sms_not_supported",
        );
      }
      const { payload } = await requestIqiyiJson<IqiyiTokenData>(
        options.fetchImpl,
        IQIYI_QR_TOKEN_URL,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": IQIYI_USER_AGENT,
            referer: IQIYI_REFERER,
          },
          body: createFormBody([
            ["agenttype", 1],
            ["app_version", ""],
            ["device_id", ""],
            ["device_name", "网页端"],
            ["fromSDK", 1],
            ["ptid", IQIYI_PTID],
            ["sdk_version", "1.0.0"],
            ["surl", 1],
          ]),
        },
      );
      if (payload.code !== "A00000") {
        throw new VideoProviderError(
          "provider_auth_unavailable",
          "iQIYI QR authorization is unavailable.",
          "qr_generate_failed",
        );
      }
      const token = readString(payload.data?.token);
      const tokenLoginUrl = readString(payload.data?.url);
      if (!token || !tokenLoginUrl) {
        throw new VideoProviderError(
          "provider_auth_unavailable",
          "iQIYI QR authorization response was invalid.",
          "qr_generate_invalid_payload",
        );
      }

      const currentTime = getNow(input.now);
      const expireSeconds = readNumber(payload.data?.expire);
      const ttlMs = Math.min(
        options.qrFlowTtlMs,
        Math.max(1, expireSeconds ?? options.qrFlowTtlMs / 1_000) * 1_000,
      );
      const flow: PendingQrFlow = {
        method: "qr",
        flowId: `${QR_FLOW_PREFIX}${options.createFlowId()}`,
        token,
        roomCode: input.roomCode,
        ownerMemberId: input.ownerMemberId,
        expiresAt: currentTime + ttlMs,
      };
      pendingFlows.set(flow.flowId, flow);

      return {
        providerId: "iqiyi",
        method: "qr",
        flowId: flow.flowId,
        status: "pending",
        expiresAt: flow.expiresAt,
        qrCodeUrl: await createQrCodeDataUrl(tokenLoginUrl),
        message: "Scan the iQIYI QR code to authorize playback.",
      };
    },
    async poll(input): Promise<ProviderAuthPollResult> {
      const currentTime = getNow(input.now);
      const flow = getFlow(input.flowId, currentTime);
      if (!flow) {
        return { status: "expired", message: "QR code expired." };
      }
      if (
        flow.roomCode !== input.roomCode ||
        flow.ownerMemberId !== input.ownerMemberId
      ) {
        return { status: "failed", message: "Authorization flow mismatch." };
      }

      const { payload, headers } = await requestIqiyiJson<IqiyiPollData>(
        options.fetchImpl,
        IQIYI_QR_POLL_URL,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "user-agent": IQIYI_USER_AGENT,
            origin: "https://www.iqiyi.com",
            referer: IQIYI_REFERER,
          },
          body: createFormBody([
            ["agenttype", 1],
            ["app_version", ""],
            ["device_id", ""],
            ["fromSDK", 1],
            ["ptid", IQIYI_PTID],
            ["sdk_version", "1.0.0"],
            ["token", flow.token],
          ]),
        },
      );

      if (payload.code === "A00001") {
        return {
          status: "pending",
          message: "Waiting for iQIYI scan confirmation.",
        };
      }
      if (payload.code === "P00501") {
        pendingFlows.delete(flow.flowId);
        return { status: "expired", message: "QR code expired." };
      }
      if (payload.code !== "A00000") {
        return { status: "failed", message: "QR authorization failed." };
      }

      const credentials = buildCookieCredentials(headers);
      const profile = buildProfileFromPollData(payload.data);
      const status = await options.authSessions.authorize({
        roomCode: input.roomCode,
        providerId: "iqiyi",
        ownerMemberId: input.ownerMemberId,
        profile,
        credentials,
      });
      pendingFlows.delete(flow.flowId);
      return {
        status: "authorized",
        profile: status.profile,
        expiresAt: status.expiresAt,
      };
    },
    async me(input) {
      const status = await options.authSessions.getStatus({
        roomCode: input.roomCode,
        providerId: "iqiyi",
        ownerMemberId: input.ownerMemberId,
      });
      return status
        ? {
            authorized: true,
            profile: status.profile,
            expiresAt: status.expiresAt,
          }
        : { authorized: false, profile: null };
    },
    async logout(input) {
      await options.authSessions.logout({
        roomCode: input.roomCode,
        providerId: "iqiyi",
        ownerMemberId: input.ownerMemberId,
      });
    },
  };
}

export function createIqiyiProvider(
  options: IqiyiProviderOptions = {},
): VideoProviderAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const auth = options.authSessions
    ? createIqiyiAuthController({
        fetchImpl,
        authSessions: options.authSessions,
        now,
        qrFlowTtlMs: options.qrFlowTtlMs ?? DEFAULT_QR_FLOW_TTL_MS,
        createFlowId: options.createFlowId ?? randomUUID,
      })
    : createUnavailableProviderAuth("iqiyi");
  return {
    id: "iqiyi",
    auth,
    matchUrl(value): ProviderMatchedUrl | null {
      const normalizedUrl = normalizeIqiyiUrl(value);
      if (!normalizedUrl) {
        return null;
      }
      return {
        providerId: "iqiyi",
        kind: "ugc",
        rawId: createSourceId(normalizedUrl),
        page: null,
        normalizedUrl,
        requiresResolution: false,
      };
    },
    async parse(input): Promise<ProviderParseResult> {
      if (!options.extractorClient) {
        return unavailableProviderParse("iqiyi");
      }
      const extraction = await options.extractorClient.extract({
        url: input.matchedUrl.normalizedUrl,
        platform: "iqiyi",
        headers: createIqiyiExtractorHeaders(input.credentials),
      });
      const candidates = extraction.candidates.map(toProviderCandidate);
      return {
        providerId: "iqiyi",
        sourceId: input.matchedUrl.rawId,
        sourceUrl: extraction.sourceUrl,
        title: extraction.title,
        items: [
          {
            item: {
              itemId: "default",
              title: extraction.title,
              kind: extraction.isLive ? "live" : "part",
            },
            candidates,
            ...(candidates[0] ? { defaultCandidateId: candidates[0].id } : {}),
          },
        ],
      };
    },
  };
}
