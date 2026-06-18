import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import type {
  ProviderAuthController,
  ProviderAuthFlowDetails,
  ProviderAuthPollResult,
  ProviderSmsAuthInput,
  ProviderMatchedUrl,
  ProviderParseInput,
  ProviderParseResult,
  ProviderPlayableItem,
  VideoProviderAdapter,
} from "./video-provider.js";
import {
  createUnavailableProviderAuth,
  VideoProviderError,
} from "./video-provider.js";
import type {
  VideoAuthCredentials,
  VideoAuthProfile,
  VideoAuthStatus,
} from "../video-auth-session.js";
import type { LogEvent } from "../types.js";

const BILIBILI_VIDEO_HOSTS = new Set([
  "bilibili.com",
  "www.bilibili.com",
  "m.bilibili.com",
]);
const BILIBILI_LIVE_HOSTS = new Set(["live.bilibili.com"]);
const BILIBILI_SHORT_HOSTS = new Set(["b23.tv", "www.b23.tv"]);
const BILIBILI_QR_GENERATE_URL =
  "https://passport.bilibili.com/x/passport-login/web/qrcode/generate";
const BILIBILI_QR_POLL_URL =
  "https://passport.bilibili.com/x/passport-login/web/qrcode/poll";
const BILIBILI_CAPTCHA_URL =
  "https://passport.bilibili.com/x/passport-login/captcha";
const BILIBILI_SMS_SEND_URL =
  "https://passport.bilibili.com/x/passport-login/web/sms/send";
const BILIBILI_SMS_LOGIN_URL =
  "https://passport.bilibili.com/x/passport-login/web/login/sms";
const BILIBILI_BUVID_URL = "https://api.bilibili.com/x/frontend/finger/spi";
const BILIBILI_NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const BILIBILI_VIEW_URL = "https://api.bilibili.com/x/web-interface/view";
const BILIBILI_WBI_PLAYURL_URL =
  "https://api.bilibili.com/x/player/wbi/playurl";
const BILIBILI_PGC_SEASON_URL = "https://api.bilibili.com/pgc/view/web/season";
const BILIBILI_PGC_PLAYURL_URL =
  "https://api.bilibili.com/pgc/player/web/playurl";
const BILIBILI_LIVE_ROOM_INFO_URL =
  "https://api.live.bilibili.com/room/v1/Room/get_info";
const BILIBILI_LIVE_PLAYURL_URL =
  "https://api.live.bilibili.com/room/v1/Room/playUrl";
const BILIBILI_AUTH_REFERER = "https://passport.bilibili.com/login";
const BILIBILI_WEB_REFERER = "https://www.bilibili.com";
const BILIBILI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DEFAULT_QR_FLOW_TTL_MS = 180_000;
const DEFAULT_SMS_FLOW_TTL_MS = 180_000;
const WBI_KEY_TTL_MS = 600_000;
const QR_FLOW_PREFIX = "qr:";
const SMS_FLOW_PREFIX = "sms:";
const WBI_MIXIN_KEY_TABLE = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
];
const BILIBILI_AUTH_COOKIE_NAMES = new Set([
  "SESSDATA",
  "bili_jct",
  "DedeUserID",
  "DedeUserID__ckMd5",
  "sid",
]);

type BilibiliProviderAuthSessions = {
  authorize: (args: {
    roomCode: string;
    providerId: "bilibili";
    ownerMemberId: string;
    profile: VideoAuthProfile | null;
    credentials: VideoAuthCredentials;
  }) => Promise<VideoAuthStatus>;
  getStatus: (key: {
    roomCode: string;
    providerId: "bilibili";
    ownerMemberId: string;
  }) => Promise<VideoAuthStatus | null>;
  getCredentials: (key: {
    roomCode: string;
    providerId: "bilibili";
    ownerMemberId: string;
  }) => Promise<VideoAuthCredentials | null>;
  logout: (key: {
    roomCode: string;
    providerId: "bilibili";
    ownerMemberId: string;
  }) => Promise<boolean>;
};

export type BilibiliProviderOptions = {
  fetch?: typeof fetch;
  authSessions?: BilibiliProviderAuthSessions;
  logEvent?: LogEvent;
  now?: () => number;
  qrFlowTtlMs?: number;
  smsFlowTtlMs?: number;
  createFlowId?: () => string;
};

type PendingQrFlow = {
  method: "qr";
  flowId: string;
  qrCodeKey: string;
  roomCode: string;
  ownerMemberId: string;
  expiresAt: number;
};

type PendingSmsFlow = {
  method: "sms";
  flowId: string;
  roomCode: string;
  ownerMemberId: string;
  expiresAt: number;
  captchaToken: string;
  captchaChallenge: string | null;
  phoneNumber: string | null;
  countryCode: string;
  smsCaptchaKey: string | null;
};

type PendingAuthFlow = PendingQrFlow | PendingSmsFlow;

type BilibiliApiEnvelope<TData> = {
  code?: unknown;
  message?: unknown;
  ttl?: unknown;
  data?: TData;
  result?: TData;
};

type BilibiliQrGenerateData = {
  url?: unknown;
  qrcode_key?: unknown;
  qrcodeKey?: unknown;
};

type BilibiliQrPollData = {
  code?: unknown;
  message?: unknown;
  url?: unknown;
  refresh_token?: unknown;
};

type BilibiliCaptchaData = {
  type?: unknown;
  token?: unknown;
  geetest?: {
    gt?: unknown;
    challenge?: unknown;
  };
  tencent?: {
    appid?: unknown;
  };
};

type BilibiliBuvidData = {
  b_3?: unknown;
  b_4?: unknown;
};

type BilibiliSmsSendData = {
  captcha_key?: unknown;
};

type BilibiliSmsLoginData = {
  url?: unknown;
  status?: unknown;
  is_new?: unknown;
};

type BilibiliNavData = {
  isLogin?: unknown;
  mid?: unknown;
  uname?: unknown;
  face?: unknown;
  vipStatus?: unknown;
  vipType?: unknown;
  vip_label?: {
    text?: unknown;
  };
  wbi_img?: {
    img_url?: unknown;
    sub_url?: unknown;
  };
};

type BilibiliVideoViewData = {
  aid?: unknown;
  bvid?: unknown;
  title?: unknown;
  pages?: unknown;
};

type BilibiliPlayUrlData = {
  quality?: unknown;
  accept_quality?: unknown;
  accept_description?: unknown;
  durl?: unknown;
  dash?: unknown;
  support_formats?: unknown;
  is_preview?: unknown;
  has_paid?: unknown;
  timelength?: unknown;
};

type DashRepresentation = {
  id: string;
  quality: number | null;
  baseUrl: string;
  backupUrls?: string[];
  bandwidth?: number;
  mimeType: string;
  codecs?: string;
  width?: number;
  height?: number;
  frameRate?: string;
  initialization?: string;
  indexRange?: string;
};

type BilibiliPgcSeasonData = {
  season_id?: unknown;
  title?: unknown;
  episodes?: unknown;
};

type BilibiliLiveRoomInfoData = {
  title?: unknown;
  user_cover?: unknown;
  uid?: unknown;
  room_id?: unknown;
  sort_id?: unknown;
  live_status?: unknown;
};

type BilibiliLivePlayUrlData = {
  accept_quality?: unknown;
  current_quality?: unknown;
  current_qn?: unknown;
  quality_description?: unknown;
  durl?: unknown;
};

type ParsedPgcId = {
  kind: "episode" | "season";
  id: string;
};

type ParsedPgcEpisode = {
  epId: string;
  cid: string;
  title: string;
  aid?: string;
  bvid?: string;
  seasonId?: string;
  durationSeconds?: number;
};

type WbiKeys = {
  imgKey: string;
  subKey: string;
};

type WbiKeyCache = {
  keys: WbiKeys | null;
  expiresAt: number;
};

type JsonResponse<TData> = {
  payload: BilibiliApiEnvelope<TData>;
  headers: Headers;
};

type CookiePair = {
  name: string;
  value: string;
};

function readPositivePage(url: URL): number | null {
  const value = url.searchParams.get("p");
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  return Number(value);
}

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function normalizeVideoUrl(rawId: string, page: number | null): string {
  return page
    ? `https://www.bilibili.com/video/${rawId}?p=${page}`
    : `https://www.bilibili.com/video/${rawId}`;
}

function matchVideoUrl(url: URL): ProviderMatchedUrl | null {
  if (!BILIBILI_VIDEO_HOSTS.has(url.hostname)) {
    return null;
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  const videoMatch = normalizedPath.match(/^\/video\/(BV[0-9A-Za-z]+|av\d+)$/);
  if (videoMatch) {
    const rawId = videoMatch[1]!;
    const page = readPositivePage(url);
    return {
      providerId: "bilibili",
      kind: "ugc",
      rawId,
      page,
      normalizedUrl: normalizeVideoUrl(rawId, page),
      requiresResolution: false,
    };
  }

  const pgcMatch = normalizedPath.match(/^\/bangumi\/play\/((?:ep|ss)\d+)$/);
  if (pgcMatch) {
    const rawId = pgcMatch[1]!;
    return {
      providerId: "bilibili",
      kind: "pgc",
      rawId,
      page: null,
      normalizedUrl: `https://www.bilibili.com/bangumi/play/${rawId}`,
      requiresResolution: false,
    };
  }

  return null;
}

function matchLiveUrl(url: URL): ProviderMatchedUrl | null {
  if (!BILIBILI_LIVE_HOSTS.has(url.hostname)) {
    return null;
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  const liveMatch = normalizedPath.match(/^\/(\d+)$/);
  if (!liveMatch) {
    return null;
  }
  const rawId = liveMatch[1]!;
  return {
    providerId: "bilibili",
    kind: "live",
    rawId,
    page: null,
    normalizedUrl: `https://live.bilibili.com/${rawId}`,
    requiresResolution: false,
  };
}

function matchShortUrl(url: URL): ProviderMatchedUrl | null {
  if (!BILIBILI_SHORT_HOSTS.has(url.hostname)) {
    return null;
  }

  const normalizedPath = url.pathname.replace(/\/+$/, "");
  const shortMatch = normalizedPath.match(/^\/([0-9A-Za-z_-]+)$/);
  if (!shortMatch) {
    return null;
  }
  const rawId = shortMatch[1]!;
  return {
    providerId: "bilibili",
    kind: "short-link",
    rawId,
    page: null,
    normalizedUrl: `https://b23.tv/${rawId}`,
    requiresResolution: true,
  };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readHttpUrl(value: unknown): string | null {
  const url = readString(value);
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? url
      : null;
  } catch {
    return null;
  }
}

function readHttpUrls(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => readHttpUrl(item))
    .filter((item): item is string => item !== null);
}

async function createQrCodeDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 1,
    scale: 6,
    type: "image/png",
  });
}

function createAuthHeaders(overrides?: HeadersInit): Headers {
  const headers = new Headers({
    accept: "application/json, text/plain, */*",
    referer: BILIBILI_AUTH_REFERER,
    "user-agent": BILIBILI_USER_AGENT,
  });
  if (overrides) {
    for (const [key, value] of new Headers(overrides).entries()) {
      headers.set(key, value);
    }
  }
  return headers;
}

async function requestBilibiliJson<TData>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<JsonResponse<TData>> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: createAuthHeaders(init.headers),
    });
  } catch (error) {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Bilibili authorization request failed.",
      error instanceof Error ? "upstream_network_error" : "upstream_error",
    );
  }

  if (!response.ok) {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Bilibili authorization request failed.",
      `upstream_http_${response.status}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Bilibili authorization response was invalid.",
      "upstream_invalid_json",
    );
  }

  if (!payload || typeof payload !== "object") {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Bilibili authorization response was invalid.",
      "upstream_invalid_payload",
    );
  }

  return {
    payload: payload as BilibiliApiEnvelope<TData>,
    headers: response.headers,
  };
}

function splitSetCookieHeader(header: string): string[] {
  return header
    .split(/,(?=\s*[^;,=\s]+=)/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function getSetCookieHeaders(headers: Headers): string[] {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(headers);
  }

  const rawHeader = headers.get("set-cookie");
  return rawHeader ? splitSetCookieHeader(rawHeader) : [];
}

function parseCookiePair(value: string): CookiePair | null {
  const pair = value.split(";", 1)[0]?.trim();
  if (!pair) {
    return null;
  }
  const separatorIndex = pair.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }
  return {
    name: pair.slice(0, separatorIndex),
    value: pair.slice(separatorIndex + 1),
  };
}

function readCookiesFromSetCookieHeaders(
  headers: Headers,
): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const header of getSetCookieHeaders(headers)) {
    const pair = parseCookiePair(header);
    if (pair) {
      cookies.set(pair.name, pair.value);
    }
  }
  return cookies;
}

function readCookiesFromLoginUrl(value: unknown): Map<string, string> {
  const cookies = new Map<string, string>();
  const loginUrl = readString(value);
  if (!loginUrl) {
    return cookies;
  }

  try {
    const url = new URL(loginUrl);
    const rawQuery = url.search.startsWith("?")
      ? url.search.slice(1)
      : url.search;
    for (const part of rawQuery.split("&")) {
      if (!part) {
        continue;
      }
      const separatorIndex = part.indexOf("=");
      const rawName =
        separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
      const cookieValue =
        separatorIndex >= 0 ? part.slice(separatorIndex + 1) : "";
      const name = decodeURIComponent(rawName.replace(/\+/g, " "));
      if (cookieValue && BILIBILI_AUTH_COOKIE_NAMES.has(name)) {
        cookies.set(name, cookieValue);
      }
    }
  } catch {
    return cookies;
  }

  return cookies;
}

function cookieStringFromMap(cookies: Map<string, string>): string {
  const preferredOrder = [
    "SESSDATA",
    "bili_jct",
    "DedeUserID",
    "DedeUserID__ckMd5",
    "sid",
  ];
  const orderedNames = [
    ...preferredOrder.filter((name) => cookies.has(name)),
    ...Array.from(cookies.keys())
      .filter((name) => !preferredOrder.includes(name))
      .sort(),
  ];
  return orderedNames
    .map((name) => `${name}=${cookies.get(name) ?? ""}`)
    .join("; ");
}

function buildProfileFromCookies(
  cookies: Map<string, string>,
): VideoAuthProfile | null {
  const id = cookies.get("DedeUserID");
  return id ? { id } : null;
}

function readProfileId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return readString(value);
}

function buildVipLabel(data: BilibiliNavData): string | undefined {
  const labelText = readString(data.vip_label?.text);
  if (labelText) {
    return labelText;
  }
  if (data.vipStatus !== 1) {
    return undefined;
  }
  return data.vipType === 2 ? "annual" : "vip";
}

function buildProfileFromNav(data: BilibiliNavData): VideoAuthProfile | null {
  const id = readProfileId(data.mid);
  if (!id) {
    return null;
  }

  const profile: VideoAuthProfile = { id };
  const displayName = readString(data.uname);
  const avatarUrl = readString(data.face);
  const vipLabel = buildVipLabel(data);
  if (displayName) {
    profile.displayName = displayName;
  }
  if (avatarUrl) {
    profile.avatarUrl = avatarUrl;
  }
  if (vipLabel) {
    profile.vipLabel = vipLabel;
  }
  return profile;
}

function readCookieCredentials(
  credentials: VideoAuthCredentials | null | undefined,
): string | null {
  return readString(credentials?.cookies);
}

function buildCredentialsFromLoginSuccess(args: {
  headers: Headers;
  dataUrl?: unknown;
  refreshToken?: unknown;
}): { credentials: VideoAuthCredentials; profile: VideoAuthProfile | null } {
  const cookies = readCookiesFromSetCookieHeaders(args.headers);
  for (const [name, value] of readCookiesFromLoginUrl(args.dataUrl)) {
    if (!cookies.has(name)) {
      cookies.set(name, value);
    }
  }

  if (!cookies.has("SESSDATA")) {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Bilibili authorization did not return required credentials.",
      "missing_sessdata",
    );
  }

  const credentials: VideoAuthCredentials = {
    cookies: cookieStringFromMap(cookies),
  };
  const csrf = cookies.get("bili_jct");
  if (csrf) {
    credentials.csrf = csrf;
  }
  const refreshToken = readString(args.refreshToken);
  if (refreshToken) {
    credentials.refreshToken = refreshToken;
  }

  return {
    credentials,
    profile: buildProfileFromCookies(cookies),
  };
}

function createFormBody(
  entries: Array<[string, string | null | undefined]>,
): string {
  const form = new URLSearchParams();
  for (const [key, value] of entries) {
    if (value !== null && value !== undefined) {
      form.set(key, value);
    }
  }
  return form.toString();
}

function normalizeCountryCode(value: string | undefined): string {
  const countryCode = value ?? "86";
  return /^\d{1,4}$/.test(countryCode) ? countryCode : "86";
}

function mapSmsFailureMessage(code: unknown): string {
  switch (code) {
    case -400:
      return "SMS request is invalid.";
    case 1002:
      return "Phone number format is invalid.";
    case 86203:
      return "SMS requests are rate limited.";
    case 1003:
      return "SMS code was already sent.";
    case 1025:
      return "SMS login is temporarily unavailable.";
    case 2400:
      return "SMS captcha token is invalid.";
    case 2406:
      return "Captcha verification failed.";
    default:
      return "SMS authorization failed.";
  }
}

function readSmsPhoneNumber(
  input: ProviderSmsAuthInput | undefined,
): string | null {
  const phoneNumber = readString(input?.phoneNumber);
  return phoneNumber && /^[0-9+\-\s]{5,32}$/.test(phoneNumber)
    ? phoneNumber.trim()
    : null;
}

function readSmsCode(input: ProviderSmsAuthInput | undefined): string | null {
  const code = readString(input?.code);
  return code && /^\d{4,8}$/.test(code) ? code : null;
}

function joinCookieStrings(
  ...values: Array<string | null | undefined>
): string | null {
  const cookies = values
    .map((value) => readString(value))
    .filter((value): value is string => value !== null);
  return cookies.length > 0 ? cookies.join("; ") : null;
}

function readCookieNames(value: string | null): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(";")
    .map((part) => part.trim().split("=")[0]?.trim())
    .filter((name): name is string => Boolean(name));
}

function createProviderHeaders(
  credentials: VideoAuthCredentials | null | undefined,
  extraCookie?: string | null,
): HeadersInit {
  const cookie = joinCookieStrings(
    readCookieCredentials(credentials),
    extraCookie,
  );
  return cookie
    ? { referer: BILIBILI_WEB_REFERER, cookie }
    : { referer: BILIBILI_WEB_REFERER };
}

function createMediaUpstreamHeaders(
  credentials: VideoAuthCredentials | null | undefined,
  extraCookie?: string | null,
): Record<string, string> | undefined {
  const cookie = joinCookieStrings(
    readCookieCredentials(credentials),
    extraCookie,
  );
  return cookie ? { Cookie: cookie } : undefined;
}

async function fetchBuvidCookieHeader(
  fetchImpl: typeof fetch,
): Promise<string> {
  const { payload } = await requestBilibiliJson<BilibiliBuvidData>(
    fetchImpl,
    BILIBILI_BUVID_URL,
    {
      headers: {
        referer: BILIBILI_WEB_REFERER,
      },
    },
  );
  if (payload.code !== 0) {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Bilibili buvid request failed.",
      "buvid_failed",
    );
  }

  const buvid3 = readString(payload.data?.b_3);
  const buvid4 = readString(payload.data?.b_4);
  if (!buvid3 || !buvid4) {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Bilibili buvid response was invalid.",
      "buvid_invalid_payload",
    );
  }
  return `buvid3=${buvid3}; buvid4=${buvid4}`;
}

async function requestBilibiliParseJson<TData>(
  fetchImpl: typeof fetch,
  url: string,
  credentials?: VideoAuthCredentials | null,
  options: { extraCookie?: string | null } = {},
): Promise<JsonResponse<TData>> {
  try {
    return await requestBilibiliJson<TData>(fetchImpl, url, {
      headers: createProviderHeaders(credentials, options.extraCookie),
    });
  } catch (error) {
    if (error instanceof VideoProviderError) {
      throw new VideoProviderError(
        "provider_parse_failed",
        "Bilibili provider request failed.",
        error.reason,
      );
    }
    throw error;
  }
}

function createVideoViewUrl(matchedUrl: ProviderMatchedUrl): string {
  const url = new URL(BILIBILI_VIEW_URL);
  if (/^av\d+$/i.test(matchedUrl.rawId)) {
    url.searchParams.set("aid", matchedUrl.rawId.slice(2));
    return url.toString();
  }
  if (/^BV[0-9A-Za-z]+$/.test(matchedUrl.rawId)) {
    url.searchParams.set("bvid", matchedUrl.rawId);
    return url.toString();
  }
  throw new VideoProviderError(
    "unsupported_source",
    "Unsupported Bilibili video source.",
    "unsupported_ugc_id",
  );
}

function createVideoPlayUrl(args: { bvid: string; cid: string }): string {
  const url = new URL(BILIBILI_WBI_PLAYURL_URL);
  url.searchParams.set("bvid", args.bvid);
  url.searchParams.set("cid", args.cid);
  url.searchParams.set("qn", "0");
  url.searchParams.set("platform", "html5");
  url.searchParams.set("high_quality", "1");
  return url.toString();
}

function readWbiAssetKey(value: unknown): string | null {
  const url = readHttpUrl(value);
  if (!url) {
    return null;
  }
  const pathParts = new URL(url).pathname.split("/");
  const fileName = pathParts.at(-1);
  if (!fileName) {
    return null;
  }
  const [key] = fileName.split(".");
  return key && /^[0-9A-Za-z]+$/.test(key) ? key : null;
}

function getWbiMixinKey(imgKey: string, subKey: string): string {
  const source = `${imgKey}${subKey}`;
  return WBI_MIXIN_KEY_TABLE.map((index) => source[index])
    .filter((value): value is string => value !== undefined)
    .join("")
    .slice(0, 32);
}

function sanitizeWbiValue(value: string): string {
  return value.replace(/[!'()*]/g, "");
}

function signWbiUrl(urlString: string, keys: WbiKeys, now: number): string {
  const url = new URL(urlString);
  const params = new URLSearchParams(url.searchParams);
  params.set("wts", String(Math.floor(now / 1000)));
  for (const [key, value] of Array.from(params.entries())) {
    params.set(key, sanitizeWbiValue(value));
  }

  const signingParams = new URLSearchParams();
  for (const [key, value] of Array.from(params.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    signingParams.set(key, value);
  }
  const mixinKey = getWbiMixinKey(keys.imgKey, keys.subKey);
  const signature = createHash("md5")
    .update(`${signingParams.toString()}${mixinKey}`)
    .digest("hex");
  params.set("w_rid", signature);
  url.search = params.toString();
  return url.toString();
}

async function readWbiKeys(args: {
  fetchImpl: typeof fetch;
  credentials?: VideoAuthCredentials | null;
  cache: WbiKeyCache;
  now: number;
}): Promise<WbiKeys> {
  if (args.cache.keys && args.cache.expiresAt > args.now) {
    return args.cache.keys;
  }

  const { payload } = await requestBilibiliParseJson<BilibiliNavData>(
    args.fetchImpl,
    BILIBILI_NAV_URL,
    args.credentials,
  );
  if (!payload.data) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili WBI key request failed.",
      "wbi_key_failed",
    );
  }

  const imgKey = readWbiAssetKey(payload.data.wbi_img?.img_url);
  const subKey = readWbiAssetKey(payload.data.wbi_img?.sub_url);
  if (!imgKey || !subKey) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili WBI key response was invalid.",
      "wbi_key_invalid_payload",
    );
  }

  const keys = { imgKey, subKey };
  args.cache.keys = keys;
  args.cache.expiresAt = args.now + WBI_KEY_TTL_MS;
  return keys;
}

async function createSignedVideoPlayUrl(args: {
  fetchImpl: typeof fetch;
  credentials?: VideoAuthCredentials | null;
  cache: WbiKeyCache;
  now: number;
  bvid: string;
  cid: string;
}): Promise<string> {
  const keys = await readWbiKeys(args);
  return signWbiUrl(
    createVideoPlayUrl({ bvid: args.bvid, cid: args.cid }),
    keys,
    args.now,
  );
}

function readPgcId(matchedUrl: ProviderMatchedUrl): ParsedPgcId {
  const match = matchedUrl.rawId.match(/^(ep|ss)(\d+)$/);
  if (!match) {
    throw new VideoProviderError(
      "unsupported_source",
      "Unsupported Bilibili bangumi source.",
      "unsupported_pgc_id",
    );
  }
  return {
    kind: match[1] === "ep" ? "episode" : "season",
    id: match[2]!,
  };
}

function createPgcSeasonUrl(pgcId: ParsedPgcId): string {
  const url = new URL(BILIBILI_PGC_SEASON_URL);
  if (pgcId.kind === "episode") {
    url.searchParams.set("ep_id", pgcId.id);
  } else {
    url.searchParams.set("season_id", pgcId.id);
  }
  return url.toString();
}

function createPgcPlayUrl(epId: string): string {
  const url = new URL(BILIBILI_PGC_PLAYURL_URL);
  url.searchParams.set("ep_id", epId);
  url.searchParams.set("qn", "112");
  url.searchParams.set("fourk", "1");
  url.searchParams.set("fnval", "0");
  return url.toString();
}

function createPgcDashPlayUrl(epId: string): string {
  const url = new URL(BILIBILI_PGC_PLAYURL_URL);
  url.searchParams.set("ep_id", epId);
  url.searchParams.set("fnver", "0");
  url.searchParams.set("platform", "pc");
  url.searchParams.set("fnval", "1168");
  return url.toString();
}

async function createSignedPgcPlayUrl(args: {
  fetchImpl: typeof fetch;
  credentials?: VideoAuthCredentials | null;
  cache: WbiKeyCache;
  now: number;
  epId: string;
  preferDash?: boolean;
}): Promise<string> {
  const keys = await readWbiKeys(args);
  const playUrl = args.preferDash
    ? createPgcDashPlayUrl(args.epId)
    : createPgcPlayUrl(args.epId);
  return signWbiUrl(playUrl, keys, args.now);
}

function createLiveRoomInfoUrl(matchedUrl: ProviderMatchedUrl): string {
  if (!/^\d+$/.test(matchedUrl.rawId)) {
    throw new VideoProviderError(
      "unsupported_source",
      "Unsupported Bilibili live room source.",
      "unsupported_live_room_id",
    );
  }
  const url = new URL(BILIBILI_LIVE_ROOM_INFO_URL);
  url.searchParams.set("room_id", matchedUrl.rawId);
  return url.toString();
}

function createLivePlayUrl(roomId: string): string {
  const url = new URL(BILIBILI_LIVE_PLAYURL_URL);
  url.searchParams.set("cid", roomId);
  url.searchParams.set("quality", "4");
  url.searchParams.set("platform", "h5");
  return url.toString();
}

function getParseCredentials(
  input: ProviderParseInput,
): VideoAuthCredentials | null | undefined {
  return input.policy.shared === false ? null : input.credentials;
}

function getNoPlaybackCandidatesReason(
  input: ProviderParseInput,
  fallbackReason: string,
): string {
  return input.policy.shared === false
    ? "anonymous_no_playback_candidates"
    : fallbackReason;
}

function readQualityLabel(args: {
  playData: BilibiliPlayUrlData;
  quality: number | null;
}): string | undefined {
  for (const format of readRecords(args.playData.support_formats)) {
    if (args.quality !== null && readInteger(format.quality) !== args.quality) {
      continue;
    }
    const label =
      readString(format.new_description) ?? readString(format.display_desc);
    if (label) {
      return label;
    }
  }

  if (Array.isArray(args.playData.accept_description)) {
    const [label] = args.playData.accept_description;
    return readString(label) ?? undefined;
  }
  return args.quality === null ? undefined : `${args.quality}P`;
}

function readCodecs(args: {
  playData: BilibiliPlayUrlData;
  quality: number | null;
}): string | undefined {
  for (const format of readRecords(args.playData.support_formats)) {
    if (args.quality !== null && readInteger(format.quality) !== args.quality) {
      continue;
    }
    if (Array.isArray(format.codecs)) {
      const codec = format.codecs.find((value) => readString(value));
      return readString(codec) ?? undefined;
    }
    return readString(format.codecs) ?? undefined;
  }
  return undefined;
}

function readBooleanLike(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (normalized === "1" || normalized === "true") {
      return true;
    }
    if (normalized === "0" || normalized === "false") {
      return false;
    }
  }
  return null;
}

function isPlaybackDataRecord(value: Record<string, unknown>): boolean {
  return (
    value.quality !== undefined ||
    value.accept_quality !== undefined ||
    value.durl !== undefined ||
    value.dash !== undefined ||
    value.support_formats !== undefined ||
    value.timelength !== undefined
  );
}

function readNestedPlayData(
  value: unknown,
  depth = 0,
): BilibiliPlayUrlData | null {
  if (!isRecord(value) || depth > 4) {
    return null;
  }

  const videoInfo = value.video_info;
  if (isRecord(videoInfo) && isPlaybackDataRecord(videoInfo)) {
    return videoInfo as BilibiliPlayUrlData;
  }
  if (isPlaybackDataRecord(value)) {
    return value as BilibiliPlayUrlData;
  }

  return (
    readNestedPlayData(value.result, depth + 1) ??
    readNestedPlayData(value.data, depth + 1) ??
    readNestedPlayData(value.raw, depth + 1)
  );
}

function readNestedPlayCode(value: unknown, depth = 0): number | null {
  if (!isRecord(value) || depth > 4) {
    return null;
  }
  const code = readInteger(value.code);
  if (code !== null) {
    return code;
  }
  return (
    readNestedPlayCode(value.result, depth + 1) ??
    readNestedPlayCode(value.data, depth + 1) ??
    readNestedPlayCode(value.raw, depth + 1)
  );
}

function readPgcPlayData(
  payload: BilibiliApiEnvelope<unknown>,
): BilibiliPlayUrlData | null {
  return (
    readNestedPlayData(payload.result) ??
    readNestedPlayData(payload.data) ??
    readNestedPlayData(payload)
  );
}

function readPgcPlayCode(payload: BilibiliApiEnvelope<unknown>): number | null {
  return (
    readInteger(payload.code) ??
    readNestedPlayCode(payload.result) ??
    readNestedPlayCode(payload.data)
  );
}

function logPgcPlayUrlDiagnostics(args: {
  logEvent?: LogEvent;
  input: ProviderParseInput;
  episode: ParsedPgcEpisode;
  credentials: VideoAuthCredentials | null | undefined;
  playData: BilibiliPlayUrlData;
  playCode: number | null;
}): void {
  if (!args.logEvent) {
    return;
  }
  const playData = args.playData;
  const durls = readRecords(playData?.durl);
  const dash = isRecord(playData?.dash) ? playData.dash : null;
  const [firstDurl] = durls;
  const acceptQuality = Array.isArray(playData?.accept_quality)
    ? playData.accept_quality
        .map((value) => readInteger(value))
        .filter((value): value is number => value !== null)
    : [];
  const cookieHeader = readCookieCredentials(args.credentials);
  args.logEvent("bilibili_pgc_playurl_resolved", {
    sourceId: args.input.matchedUrl.rawId,
    epId: args.episode.epId,
    hasCredentials: Boolean(cookieHeader),
    cookieNames: readCookieNames(cookieHeader),
    code: args.playCode,
    quality: readInteger(playData?.quality),
    acceptQuality,
    isPreview: readBooleanLike(playData?.is_preview),
    hasPaid: readBooleanLike(playData?.has_paid),
    timeLengthMs: readNumber(playData?.timelength),
    durlCount: durls.length,
    dashVideoCount: readRecords(dash?.video).length,
    dashAudioCount: readRecords(dash?.audio).length,
    firstDurlLengthMs: readNumber(firstDurl?.length),
    firstDurlSizeBytes: readNumber(firstDurl?.size),
    result: "ok",
  });
}

function readRecordField(
  record: Record<string, unknown>,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function readDashSegmentBase(record: Record<string, unknown>): {
  initialization?: string;
  indexRange?: string;
} {
  const segmentBase = readRecordField(record, "SegmentBase", "segment_base");
  if (!isRecord(segmentBase)) {
    return {};
  }
  const initialization = readString(
    readRecordField(segmentBase, "Initialization", "initialization"),
  );
  const indexRange = readString(
    readRecordField(segmentBase, "indexRange", "index_range"),
  );
  return {
    ...(initialization ? { initialization } : {}),
    ...(indexRange ? { indexRange } : {}),
  };
}

function readDashRepresentation(
  record: Record<string, unknown>,
  kind: "audio" | "video",
  index: number,
): DashRepresentation | null {
  const baseUrl =
    readHttpUrl(readRecordField(record, "baseUrl", "base_url")) ??
    readHttpUrl(readRecordField(record, "BaseURL", "baseURL"));
  if (!baseUrl) {
    return null;
  }
  const backupUrls = readHttpUrls(
    readRecordField(record, "backupUrl", "backup_url", "backupURL"),
  ).filter((url) => url !== baseUrl);

  const quality = readInteger(record.id);
  const fallbackId = `${kind}-${quality ?? index + 1}`;
  const id = readString(record.id) ?? fallbackId;
  const mimeType =
    readString(readRecordField(record, "mimeType", "mime_type")) ??
    (kind === "video" ? "video/mp4" : "audio/mp4");
  const bandwidth = readFiniteNumber(record.bandwidth) ?? undefined;
  const width = readFiniteNumber(record.width) ?? undefined;
  const height = readFiniteNumber(record.height) ?? undefined;
  const frameRate = readString(
    readRecordField(record, "frameRate", "frame_rate"),
  );
  const codecs = readString(record.codecs) ?? undefined;
  const segmentBase = readDashSegmentBase(record);

  return {
    id,
    quality,
    baseUrl,
    ...(backupUrls.length > 0 ? { backupUrls } : {}),
    mimeType,
    ...(bandwidth !== undefined ? { bandwidth } : {}),
    ...(codecs ? { codecs } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(frameRate ? { frameRate } : {}),
    ...segmentBase,
  };
}

function isLikelyHevcCodec(codecs: string | undefined): boolean {
  return /(?:hev1|hvc1)/i.test(codecs ?? "");
}

function isLikelyAvcCodec(codecs: string | undefined): boolean {
  return /(?:avc1|avc3)/i.test(codecs ?? "");
}

function sortDashVideoRepresentations(
  videos: DashRepresentation[],
): DashRepresentation[] {
  return [...videos].sort((left, right) => {
    const leftCodecRank = isLikelyAvcCodec(left.codecs)
      ? 0
      : isLikelyHevcCodec(left.codecs)
        ? 2
        : 1;
    const rightCodecRank = isLikelyAvcCodec(right.codecs)
      ? 0
      : isLikelyHevcCodec(right.codecs)
        ? 2
        : 1;
    if (leftCodecRank !== rightCodecRank) {
      return leftCodecRank - rightCodecRank;
    }
    return (
      (right.bandwidth ?? 0) - (left.bandwidth ?? 0) ||
      (right.height ?? 0) - (left.height ?? 0) ||
      (right.quality ?? 0) - (left.quality ?? 0)
    );
  });
}

function chooseDashAudioRepresentation(
  audios: DashRepresentation[],
): DashRepresentation | null {
  return (
    [...audios].sort(
      (left, right) => (right.bandwidth ?? 0) - (left.bandwidth ?? 0),
    )[0] ?? null
  );
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

function formatDurationSeconds(value: number | null): string | undefined {
  if (value === null || value < 0) {
    return undefined;
  }
  const formatted = value.toFixed(3).replace(/\.?0+$/, "");
  return `PT${formatted || "0"}S`;
}

function buildRepresentationXml(
  representation: DashRepresentation,
  kind: "audio" | "video",
  index: number,
): string {
  const attributes = [
    `id="${escapeXmlAttribute(`${kind}-${representation.id}-${index + 1}`)}"`,
    `mimeType="${escapeXmlAttribute(representation.mimeType)}"`,
    ...(representation.codecs
      ? [`codecs="${escapeXmlAttribute(representation.codecs)}"`]
      : []),
    ...(representation.bandwidth !== undefined
      ? [`bandwidth="${Math.round(representation.bandwidth)}"`]
      : []),
    ...(representation.width !== undefined
      ? [`width="${Math.round(representation.width)}"`]
      : []),
    ...(representation.height !== undefined
      ? [`height="${Math.round(representation.height)}"`]
      : []),
    ...(representation.frameRate
      ? [`frameRate="${escapeXmlAttribute(representation.frameRate)}"`]
      : []),
  ].join(" ");
  const segmentBase =
    representation.initialization || representation.indexRange
      ? `
        <SegmentBase${representation.indexRange ? ` indexRange="${escapeXmlAttribute(representation.indexRange)}"` : ""}>
          ${representation.initialization ? `<Initialization range="${escapeXmlAttribute(representation.initialization)}" />` : ""}
        </SegmentBase>`
      : "";
  return `
      <Representation ${attributes}>
        <BaseURL>${escapeXmlText(representation.baseUrl)}</BaseURL>${segmentBase}
      </Representation>`;
}

function buildDashMpd(input: {
  video: DashRepresentation;
  audio: DashRepresentation | null;
  durationSeconds: number | null;
  minBufferTimeSeconds: number | null;
}): string {
  const duration = formatDurationSeconds(input.durationSeconds);
  const minBufferTime =
    formatDurationSeconds(input.minBufferTimeSeconds) ?? "PT1.5S";
  const durationAttribute = duration
    ? ` mediaPresentationDuration="${duration}"`
    : "";
  const audioAdaptation = input.audio
    ? `
    <AdaptationSet id="audio" contentType="audio" segmentAlignment="true">
${buildRepresentationXml(input.audio, "audio", 0)}
    </AdaptationSet>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" profiles="urn:mpeg:dash:profile:isoff-on-demand:2011" minBufferTime="${minBufferTime}"${durationAttribute}>
  <Period id="0">
    <AdaptationSet id="video" contentType="video" segmentAlignment="true">
${buildRepresentationXml(input.video, "video", 0)}
    </AdaptationSet>${audioAdaptation}
  </Period>
</MPD>`;
}

function buildDashUpstreamUrlAlternates(input: {
  video: DashRepresentation;
  audio: DashRepresentation | null;
}): Record<string, string[]> | undefined {
  const alternates: Record<string, string[]> = {};
  for (const representation of [input.video, input.audio]) {
    if (!representation?.backupUrls || representation.backupUrls.length === 0) {
      continue;
    }
    alternates[representation.baseUrl] = representation.backupUrls;
  }
  return Object.keys(alternates).length > 0 ? alternates : undefined;
}

function readDashDurationSeconds(
  playData: BilibiliPlayUrlData,
  dash: Record<string, unknown>,
): number | null {
  const dashDuration = readFiniteNumber(dash.duration);
  if (dashDuration !== null) {
    return dashDuration;
  }
  const timeLengthMs = readFiniteNumber(playData.timelength);
  return timeLengthMs === null ? null : timeLengthMs / 1000;
}

function readDashPlaybackCandidates(
  playData: BilibiliPlayUrlData,
): ProviderPlayableItem["candidates"] {
  const dash = isRecord(playData.dash) ? playData.dash : null;
  if (!dash) {
    return [];
  }
  const videos = sortDashVideoRepresentations(
    readRecords(dash.video)
      .map((record, index) => readDashRepresentation(record, "video", index))
      .filter((value): value is DashRepresentation => value !== null),
  );
  if (videos.length === 0) {
    return [];
  }
  const audio = chooseDashAudioRepresentation(
    readRecords(dash.audio)
      .map((record, index) => readDashRepresentation(record, "audio", index))
      .filter((value): value is DashRepresentation => value !== null),
  );
  const durationSeconds = readDashDurationSeconds(playData, dash);
  const minBufferTimeSeconds = readFiniteNumber(
    readRecordField(dash, "minBufferTime", "min_buffer_time"),
  );

  return videos.map((video, index) => {
    const qualityLabel = readQualityLabel({ playData, quality: video.quality });
    const manifest = buildDashMpd({
      video,
      audio,
      durationSeconds,
      minBufferTimeSeconds,
    });
    const upstreamUrlAlternates = buildDashUpstreamUrlAlternates({
      video,
      audio,
    });
    return {
      id: `dash-${video.quality ?? "default"}-${index + 1}`,
      sourceType: "mpd",
      url: video.baseUrl,
      mimeType: "application/dash+xml",
      ...(video.codecs || audio?.codecs
        ? { codecs: [video.codecs, audio?.codecs].filter(Boolean).join(",") }
        : {}),
      ...(qualityLabel ? { qualityLabel } : {}),
      ...(video.width !== undefined ? { width: video.width } : {}),
      ...(video.height !== undefined ? { height: video.height } : {}),
      ...(video.bandwidth !== undefined || audio?.bandwidth !== undefined
        ? { bandwidth: (video.bandwidth ?? 0) + (audio?.bandwidth ?? 0) }
        : {}),
      default: index === 0,
      ...(upstreamUrlAlternates ? { upstreamUrlAlternates } : {}),
      manifest,
    };
  });
}

function readPlaybackCandidates(
  playData: BilibiliPlayUrlData,
  options: {
    preferDash?: boolean;
    upstreamHeaders?: Record<string, string>;
  } = {},
): ProviderPlayableItem["candidates"] {
  const dashCandidates = options.preferDash
    ? readDashPlaybackCandidates(playData)
    : [];
  if (dashCandidates.length > 0) {
    return options.upstreamHeaders
      ? dashCandidates.map((candidate) => ({
          ...candidate,
          upstreamHeaders: options.upstreamHeaders,
        }))
      : dashCandidates;
  }

  const quality = readInteger(playData.quality);
  const qualityLabel = readQualityLabel({ playData, quality });
  const codecs = readCodecs({ playData, quality });
  const candidates: ProviderPlayableItem["candidates"] = [];

  for (const [index, durl] of readRecords(playData.durl).entries()) {
    const url = readHttpUrl(durl.url);
    if (!url) {
      continue;
    }
    const order = readInteger(durl.order) ?? index + 1;
    const sizeBytes = readNumber(durl.size);
    const lengthMs = readNumber(durl.length);
    const bandwidth =
      sizeBytes && lengthMs
        ? Math.round((sizeBytes * 8) / (lengthMs / 1000))
        : undefined;
    candidates.push({
      id: `mp4-${quality ?? "default"}-${order}`,
      sourceType: "mp4",
      url,
      mimeType: "video/mp4",
      ...(codecs ? { codecs } : {}),
      ...(qualityLabel ? { qualityLabel } : {}),
      ...(bandwidth ? { bandwidth } : {}),
      ...(options.upstreamHeaders
        ? { upstreamHeaders: options.upstreamHeaders }
        : {}),
      default: index === 0,
    });
  }

  return candidates;
}

function readLiveQualityLabel(args: {
  playData: BilibiliLivePlayUrlData;
  quality: number | null;
}): string | undefined {
  for (const format of readRecords(args.playData.quality_description)) {
    const formatQuality = readInteger(format.qn) ?? readInteger(format.quality);
    if (args.quality !== null && formatQuality !== args.quality) {
      continue;
    }
    const label = readString(format.desc);
    if (label) {
      return label;
    }
  }
  return args.quality === null ? undefined : `Q${args.quality}`;
}

function isM3u8Url(value: string): boolean {
  try {
    return new URL(value).pathname.toLowerCase().endsWith(".m3u8");
  } catch {
    return false;
  }
}

function readLivePlaybackCandidates(
  playData: BilibiliLivePlayUrlData,
): ProviderPlayableItem["candidates"] {
  const quality =
    readInteger(playData.current_qn) ?? readInteger(playData.current_quality);
  const qualityLabel = readLiveQualityLabel({ playData, quality });
  const candidates: ProviderPlayableItem["candidates"] = [];

  for (const [index, durl] of readRecords(playData.durl).entries()) {
    const url = readHttpUrl(durl.url);
    if (!url || !isM3u8Url(url)) {
      continue;
    }
    const order = readInteger(durl.order) ?? index + 1;
    candidates.push({
      id: `hls-${quality ?? "default"}-${order}`,
      sourceType: "m3u8",
      url,
      mimeType: "application/vnd.apple.mpegurl",
      ...(qualityLabel ? { qualityLabel } : {}),
      default: candidates.length === 0,
    });
  }

  return candidates;
}

function readPgcDurationSeconds(value: unknown): number | undefined {
  const duration = readNumber(value);
  if (duration === null || duration < 0) {
    return undefined;
  }
  return Math.round(duration > 10_000 ? duration / 1000 : duration);
}

function readPgcPlayDurationSeconds(
  playData: BilibiliPlayUrlData,
): number | null {
  const dash = isRecord(playData.dash) ? playData.dash : null;
  const dashDuration = dash ? readFiniteNumber(dash.duration) : null;
  if (dashDuration !== null) {
    return dashDuration;
  }

  const timeLengthMs = readFiniteNumber(playData.timelength);
  if (timeLengthMs !== null) {
    return timeLengthMs / 1000;
  }

  const [firstDurl] = readRecords(playData.durl);
  const firstDurlLengthMs = readFiniteNumber(firstDurl?.length);
  return firstDurlLengthMs === null ? null : firstDurlLengthMs / 1000;
}

function isPgcPreviewPlayData(
  playData: BilibiliPlayUrlData,
  episode: ParsedPgcEpisode,
): boolean {
  if (readBooleanLike(playData.is_preview) === true) {
    return true;
  }

  const episodeDurationSeconds = episode.durationSeconds;
  const playDurationSeconds = readPgcPlayDurationSeconds(playData);
  return (
    episodeDurationSeconds !== undefined &&
    episodeDurationSeconds >= 900 &&
    playDurationSeconds !== null &&
    playDurationSeconds <= 420 &&
    playDurationSeconds < episodeDurationSeconds * 0.6
  );
}

function readPgcEpisodeTitle(
  episode: Record<string, unknown>,
  index: number,
): string {
  return (
    readString(episode.share_copy) ??
    readString(episode.long_title) ??
    readString(episode.title) ??
    `Episode ${index + 1}`
  );
}

function readPgcEpisodes(
  seasonData: BilibiliPgcSeasonData,
): ParsedPgcEpisode[] {
  const seasonId = readProfileId(seasonData.season_id);
  return readRecords(seasonData.episodes)
    .map((episode, index) => {
      const epId = readProfileId(episode.ep_id) ?? readProfileId(episode.id);
      const cid = readProfileId(episode.cid);
      if (!epId || !cid) {
        return null;
      }

      const aid = readProfileId(episode.aid);
      const bvid = readString(episode.bvid);
      const durationSeconds = readPgcDurationSeconds(episode.duration);
      return {
        epId,
        cid,
        title: readPgcEpisodeTitle(episode, index),
        ...(aid ? { aid } : {}),
        ...(bvid ? { bvid } : {}),
        ...(seasonId ? { seasonId } : {}),
        ...(durationSeconds !== undefined ? { durationSeconds } : {}),
      };
    })
    .filter((episode): episode is ParsedPgcEpisode => episode !== null);
}

function readVideoPages(viewData: BilibiliVideoViewData): Array<{
  cid: string;
  page: number;
  title: string;
  durationSeconds?: number;
}> {
  const pages = readRecords(viewData.pages)
    .map((page, index) => {
      const cid = readProfileId(page.cid);
      if (!cid) {
        return null;
      }
      const pageNo = readInteger(page.page) ?? index + 1;
      const title = readString(page.part) ?? `Part ${pageNo}`;
      const durationSeconds = readInteger(page.duration);
      return {
        cid,
        page: pageNo,
        title,
        ...(durationSeconds !== null ? { durationSeconds } : {}),
      };
    })
    .filter((page): page is NonNullable<typeof page> => page !== null);

  if (pages.length > 0) {
    return pages;
  }

  return [];
}

async function parseNormalVideo(
  fetchImpl: typeof fetch,
  input: ProviderParseInput,
  args: {
    now: () => number;
    wbiKeyCache: WbiKeyCache;
    logEvent?: LogEvent;
  },
): Promise<ProviderParseResult> {
  const parseCredentials = getParseCredentials(input);
  const { payload: viewPayload } =
    await requestBilibiliParseJson<BilibiliVideoViewData>(
      fetchImpl,
      createVideoViewUrl(input.matchedUrl),
      parseCredentials,
    );
  if (viewPayload.code !== 0 || !viewPayload.data) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili video metadata request failed.",
      "view_failed",
    );
  }

  const aid = readProfileId(viewPayload.data.aid);
  const bvid = readString(viewPayload.data.bvid) ?? input.matchedUrl.rawId;
  const title = readString(viewPayload.data.title) ?? "Bilibili Video";
  const pages = readVideoPages(viewPayload.data);
  if (pages.length === 0) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili video has no playable parts.",
      "no_video_pages",
    );
  }

  const items: ProviderPlayableItem[] = [];
  let buvidCookie: string;
  try {
    buvidCookie = await fetchBuvidCookieHeader(fetchImpl);
  } catch (error) {
    if (error instanceof VideoProviderError) {
      throw new VideoProviderError(
        "provider_parse_failed",
        "Bilibili buvid request failed.",
        error.reason,
      );
    }
    throw error;
  }
  const currentTime = args.now();
  for (const page of pages) {
    const playUrl = await createSignedVideoPlayUrl({
      fetchImpl,
      credentials: parseCredentials,
      cache: args.wbiKeyCache,
      now: currentTime,
      bvid,
      cid: page.cid,
    });
    const { payload: playPayload } =
      await requestBilibiliParseJson<BilibiliPlayUrlData>(
        fetchImpl,
        playUrl,
        parseCredentials,
        { extraCookie: buvidCookie },
      );
    if (playPayload.code !== 0 || !playPayload.data) {
      throw new VideoProviderError(
        "provider_parse_failed",
        "Bilibili playback metadata request failed.",
        "playurl_failed",
      );
    }

    const candidates = readPlaybackCandidates(playPayload.data, {
      upstreamHeaders: createMediaUpstreamHeaders(
        parseCredentials,
        buvidCookie,
      ),
    });
    if (candidates.length === 0) {
      throw new VideoProviderError(
        "provider_parse_failed",
        "Bilibili video has no supported playback candidates.",
        getNoPlaybackCandidatesReason(input, "no_playback_candidates"),
      );
    }

    items.push({
      item: {
        itemId: `cid-${page.cid}`,
        title: page.title,
        kind: "part",
        ...(aid ? { aid } : {}),
        bvid,
        cid: page.cid,
        ...(page.durationSeconds !== undefined
          ? { durationSeconds: page.durationSeconds }
          : {}),
      },
      candidates,
      defaultCandidateId: candidates[0]?.id,
    });
  }

  return {
    providerId: "bilibili",
    sourceId: bvid,
    sourceUrl: input.matchedUrl.normalizedUrl,
    title,
    items,
  };
}

async function parsePgcVideo(
  fetchImpl: typeof fetch,
  input: ProviderParseInput,
  args: {
    now: () => number;
    wbiKeyCache: WbiKeyCache;
    logEvent?: LogEvent;
  },
): Promise<ProviderParseResult> {
  const parseCredentials = getParseCredentials(input);
  const pgcId = readPgcId(input.matchedUrl);
  const { payload: seasonPayload } =
    await requestBilibiliParseJson<BilibiliPgcSeasonData>(
      fetchImpl,
      createPgcSeasonUrl(pgcId),
      parseCredentials,
    );
  if (seasonPayload.code !== 0 || !seasonPayload.result) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili bangumi metadata request failed.",
      "pgc_season_failed",
    );
  }

  const seasonData = seasonPayload.result;
  const title = readString(seasonData.title) ?? "Bilibili Bangumi";
  const episodes = readPgcEpisodes(seasonData);
  if (episodes.length === 0) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili bangumi has no playable episodes.",
      "no_pgc_episodes",
    );
  }

  const selectedEpisodes =
    pgcId.kind === "episode"
      ? episodes.filter((episode) => episode.epId === pgcId.id)
      : episodes;
  if (selectedEpisodes.length === 0) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Selected Bilibili bangumi episode was not found.",
      "pgc_episode_not_found",
    );
  }

  const items: ProviderPlayableItem[] = [];
  let buvidCookie: string;
  try {
    buvidCookie = await fetchBuvidCookieHeader(fetchImpl);
  } catch (error) {
    if (error instanceof VideoProviderError) {
      throw new VideoProviderError(
        "provider_parse_failed",
        "Bilibili buvid request failed.",
        error.reason,
      );
    }
    throw error;
  }
  const currentTime = args.now();
  for (const episode of selectedEpisodes) {
    const playUrl = await createSignedPgcPlayUrl({
      fetchImpl,
      credentials: parseCredentials,
      cache: args.wbiKeyCache,
      now: currentTime,
      epId: episode.epId,
      preferDash: input.policy.proxy === true,
    });
    const { payload: playPayload } = await requestBilibiliParseJson<unknown>(
      fetchImpl,
      playUrl,
      parseCredentials,
      { extraCookie: buvidCookie },
    );
    const playCode = readPgcPlayCode(playPayload);
    const playData = readPgcPlayData(playPayload);
    if ((playCode !== null && playCode !== 0) || !playData) {
      throw new VideoProviderError(
        "provider_parse_failed",
        "Bilibili bangumi playback metadata request failed.",
        "pgc_playurl_failed",
      );
    }
    logPgcPlayUrlDiagnostics({
      logEvent: args.logEvent,
      input,
      episode,
      credentials: parseCredentials,
      playData,
      playCode,
    });
    if (isPgcPreviewPlayData(playData, episode)) {
      throw new VideoProviderError(
        "provider_parse_failed",
        "Bilibili bangumi playback metadata is preview-only.",
        "pgc_preview_playurl",
      );
    }

    const candidates = readPlaybackCandidates(playData, {
      preferDash: input.policy.proxy === true,
      upstreamHeaders: createMediaUpstreamHeaders(
        parseCredentials,
        buvidCookie,
      ),
    });
    if (candidates.length === 0) {
      throw new VideoProviderError(
        "provider_parse_failed",
        "Bilibili bangumi has no supported playback candidates.",
        getNoPlaybackCandidatesReason(input, "no_pgc_playback_candidates"),
      );
    }

    items.push({
      item: {
        itemId: `ep-${episode.epId}`,
        title: episode.title,
        kind: "episode",
        ...(episode.aid ? { aid: episode.aid } : {}),
        ...(episode.bvid ? { bvid: episode.bvid } : {}),
        cid: episode.cid,
        epId: episode.epId,
        ...(episode.seasonId ? { seasonId: episode.seasonId } : {}),
        ...(episode.durationSeconds !== undefined
          ? { durationSeconds: episode.durationSeconds }
          : {}),
      },
      candidates,
      defaultCandidateId: candidates[0]?.id,
    });
  }

  return {
    providerId: "bilibili",
    sourceId: input.matchedUrl.rawId,
    sourceUrl: input.matchedUrl.normalizedUrl,
    title,
    items,
  };
}

async function parseLiveRoom(
  fetchImpl: typeof fetch,
  input: ProviderParseInput,
): Promise<ProviderParseResult> {
  const parseCredentials = getParseCredentials(input);
  const { payload: roomPayload } =
    await requestBilibiliParseJson<BilibiliLiveRoomInfoData>(
      fetchImpl,
      createLiveRoomInfoUrl(input.matchedUrl),
      parseCredentials,
    );
  if (roomPayload.code !== 0 || !roomPayload.data) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili live room metadata request failed.",
      "live_room_failed",
    );
  }

  const roomId = readProfileId(roomPayload.data.room_id);
  if (!roomId) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili live room metadata response was invalid.",
      "live_room_invalid_payload",
    );
  }
  if (readInteger(roomPayload.data.live_status) !== 1) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili live room is not currently live.",
      "live_room_offline",
    );
  }

  const title = readString(roomPayload.data.title) ?? `Bilibili Live ${roomId}`;
  const { payload: playPayload } =
    await requestBilibiliParseJson<BilibiliLivePlayUrlData>(
      fetchImpl,
      createLivePlayUrl(roomId),
      parseCredentials,
    );
  if (playPayload.code !== 0 || !playPayload.data) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili live playback metadata request failed.",
      "live_playurl_failed",
    );
  }

  const candidates = readLivePlaybackCandidates(playPayload.data);
  if (candidates.length === 0) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili live room has no HLS playback candidates.",
      getNoPlaybackCandidatesReason(input, "no_live_hls_candidates"),
    );
  }

  return {
    providerId: "bilibili",
    sourceId: input.matchedUrl.rawId,
    sourceUrl: input.matchedUrl.normalizedUrl,
    title,
    items: [
      {
        item: {
          itemId: `live-${roomId}`,
          title,
          kind: "live",
          roomId,
        },
        candidates,
        defaultCandidateId: candidates[0]?.id,
      },
    ],
  };
}

async function resolveShortLink(
  fetchImpl: typeof fetch,
  matchedUrl: ProviderMatchedUrl,
): Promise<ProviderMatchedUrl> {
  let response: Response;
  try {
    response = await fetchImpl(matchedUrl.normalizedUrl, {
      method: "GET",
      redirect: "manual",
      headers: createAuthHeaders({
        referer: BILIBILI_WEB_REFERER,
      }),
    });
  } catch (error) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili short link resolution failed.",
      error instanceof Error ? "short_link_network_error" : "short_link_error",
    );
  }

  const location =
    response.headers.get("location") ||
    (response.url && response.url !== matchedUrl.normalizedUrl
      ? response.url
      : null);
  if (!location) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili short link did not return a target URL.",
      "short_link_missing_location",
    );
  }

  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(location, matchedUrl.normalizedUrl);
  } catch {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili short link target URL was invalid.",
      "short_link_invalid_location",
    );
  }

  const resolved =
    matchVideoUrl(resolvedUrl) ?? matchLiveUrl(resolvedUrl) ?? null;
  if (!resolved) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Bilibili short link target is unsupported.",
      "short_link_unsupported_target",
    );
  }
  return resolved;
}

function createBilibiliAuthController(options: {
  fetchImpl: typeof fetch;
  authSessions: BilibiliProviderAuthSessions;
  now: () => number;
  qrFlowTtlMs: number;
  smsFlowTtlMs: number;
  createFlowId: () => string;
}): ProviderAuthController {
  const pendingFlows = new Map<string, PendingAuthFlow>();

  function getNow(explicitNow?: number): number {
    return explicitNow ?? options.now();
  }

  function getFlow(
    flowId: string,
    currentTime: number,
  ): PendingAuthFlow | null {
    const flow = pendingFlows.get(flowId);
    if (!flow || flow.expiresAt <= currentTime) {
      if (flow) {
        pendingFlows.delete(flowId);
      }
      return null;
    }
    return flow;
  }

  async function sendSms(flow: PendingSmsFlow, input: ProviderSmsAuthInput) {
    const phoneNumber = readSmsPhoneNumber(input);
    const token = readString(input.captcha?.token);
    const validate = readString(input.captcha?.validate);
    const challenge =
      readString(input.captcha?.challenge) ?? flow.captchaChallenge;
    if (!phoneNumber || !token || !validate || !challenge) {
      return {
        status: "failed" as const,
        message: "SMS captcha solution is required.",
      };
    }
    if (token !== flow.captchaToken) {
      return {
        status: "failed" as const,
        message: "SMS captcha token is invalid.",
      };
    }

    const countryCode = normalizeCountryCode(input.countryCode);
    const cookie = await fetchBuvidCookieHeader(options.fetchImpl);
    const { payload } = await requestBilibiliJson<BilibiliSmsSendData>(
      options.fetchImpl,
      BILIBILI_SMS_SEND_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie,
        },
        body: createFormBody([
          ["cid", countryCode],
          ["tel", phoneNumber],
          ["source", "main-fe-header"],
          ["token", token],
          ["challenge", challenge],
          ["validate", validate],
          ["seccode", `${validate}|jordan`],
        ]),
      },
    );

    if (payload.code !== 0) {
      return {
        status: "failed" as const,
        message: mapSmsFailureMessage(payload.code),
      };
    }

    const captchaKey = readString(payload.data?.captcha_key);
    if (!captchaKey) {
      throw new VideoProviderError(
        "provider_auth_unavailable",
        "Bilibili SMS response was invalid.",
        "sms_send_invalid_payload",
      );
    }
    flow.phoneNumber = phoneNumber;
    flow.countryCode = countryCode;
    flow.smsCaptchaKey = captchaKey;
    return { status: "pending" as const, message: "SMS code sent." };
  }

  async function loginWithSms(args: {
    flow: PendingSmsFlow;
    input: ProviderSmsAuthInput;
    roomCode: string;
    ownerMemberId: string;
  }): Promise<ProviderAuthPollResult> {
    const code = readSmsCode(args.input);
    const phoneNumber = args.flow.phoneNumber ?? readSmsPhoneNumber(args.input);
    if (!code) {
      return {
        status: "failed",
        message: "SMS verification code is required.",
      };
    }
    if (!phoneNumber || !args.flow.smsCaptchaKey) {
      return { status: "failed", message: "SMS code has not been sent." };
    }

    const { payload, headers } =
      await requestBilibiliJson<BilibiliSmsLoginData>(
        options.fetchImpl,
        BILIBILI_SMS_LOGIN_URL,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
          },
          body: createFormBody([
            ["cid", args.flow.countryCode],
            ["tel", phoneNumber],
            ["code", code],
            ["source", "main-fe-header"],
            ["captcha_key", args.flow.smsCaptchaKey],
          ]),
        },
      );

    if (payload.code !== 0) {
      return {
        status: "failed",
        message: mapSmsFailureMessage(payload.code),
      };
    }

    const { credentials, profile } = buildCredentialsFromLoginSuccess({
      headers,
      dataUrl: payload.data?.url,
    });
    const status = await options.authSessions.authorize({
      roomCode: args.roomCode,
      providerId: "bilibili",
      ownerMemberId: args.ownerMemberId,
      profile,
      credentials,
    });
    return {
      status: "authorized",
      profile: status.profile,
      expiresAt: status.expiresAt,
    };
  }

  async function handleSmsPoll(args: {
    flow: PendingSmsFlow;
    input: ProviderSmsAuthInput | undefined;
    roomCode: string;
    ownerMemberId: string;
  }): Promise<ProviderAuthPollResult> {
    if (!args.input) {
      return { status: "failed", message: "SMS input is required." };
    }
    if (args.input.code) {
      return loginWithSms({
        flow: args.flow,
        input: args.input,
        roomCode: args.roomCode,
        ownerMemberId: args.ownerMemberId,
      });
    }
    if (args.input.captcha) {
      return sendSms(args.flow, args.input);
    }
    return { status: "failed", message: "SMS input is required." };
  }

  return {
    async start(input): Promise<ProviderAuthFlowDetails> {
      if (input.method === "sms") {
        const { payload } = await requestBilibiliJson<BilibiliCaptchaData>(
          options.fetchImpl,
          BILIBILI_CAPTCHA_URL,
        );
        if (payload.code !== 0) {
          throw new VideoProviderError(
            "provider_auth_unavailable",
            "Bilibili SMS captcha is unavailable.",
            "sms_captcha_failed",
          );
        }

        const token = readString(payload.data?.token);
        if (!token) {
          throw new VideoProviderError(
            "provider_auth_unavailable",
            "Bilibili SMS captcha response was invalid.",
            "sms_captcha_invalid_payload",
          );
        }

        const currentTime = getNow(input.now);
        const challenge = readString(payload.data?.geetest?.challenge);
        const flow: PendingSmsFlow = {
          method: "sms",
          flowId: `${SMS_FLOW_PREFIX}${options.createFlowId()}`,
          roomCode: input.roomCode,
          ownerMemberId: input.ownerMemberId,
          expiresAt: currentTime + options.smsFlowTtlMs,
          captchaToken: token,
          captchaChallenge: challenge,
          phoneNumber: null,
          countryCode: "86",
          smsCaptchaKey: null,
        };
        pendingFlows.set(flow.flowId, flow);

        const smsCaptcha: NonNullable<ProviderAuthFlowDetails["smsCaptcha"]> = {
          token,
        };
        const type = readString(payload.data?.type);
        const gt = readString(payload.data?.geetest?.gt);
        if (type) {
          smsCaptcha.type = type;
        }
        if (gt) {
          smsCaptcha.gt = gt;
        }
        if (challenge) {
          smsCaptcha.challenge = challenge;
        }

        return {
          providerId: "bilibili",
          method: "sms",
          flowId: flow.flowId,
          status: "pending",
          expiresAt: flow.expiresAt,
          smsCaptcha,
          message: "Complete the SMS captcha challenge.",
        };
      }

      const { payload } = await requestBilibiliJson<BilibiliQrGenerateData>(
        options.fetchImpl,
        BILIBILI_QR_GENERATE_URL,
      );
      if (payload.code !== 0) {
        throw new VideoProviderError(
          "provider_auth_unavailable",
          "Bilibili QR authorization is unavailable.",
          "qr_generate_failed",
        );
      }

      const qrLoginUrl = readString(payload.data?.url);
      const qrCodeKey =
        readString(payload.data?.qrcode_key) ??
        readString(payload.data?.qrcodeKey);
      if (!qrLoginUrl || !qrCodeKey) {
        throw new VideoProviderError(
          "provider_auth_unavailable",
          "Bilibili QR authorization response was invalid.",
          "qr_generate_invalid_payload",
        );
      }
      const qrCodeUrl = await createQrCodeDataUrl(qrLoginUrl);

      const currentTime = getNow(input.now);
      const flow: PendingQrFlow = {
        method: "qr",
        flowId: `${QR_FLOW_PREFIX}${qrCodeKey}`,
        qrCodeKey,
        roomCode: input.roomCode,
        ownerMemberId: input.ownerMemberId,
        expiresAt: currentTime + options.qrFlowTtlMs,
      };
      pendingFlows.set(flow.flowId, flow);

      return {
        providerId: "bilibili",
        method: "qr",
        flowId: flow.flowId,
        status: "pending",
        expiresAt: flow.expiresAt,
        qrCodeUrl,
        message: "Scan the Bilibili QR code to authorize playback.",
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
      if (flow.method === "sms") {
        const smsResult = await handleSmsPoll({
          flow,
          input: input.sms,
          roomCode: input.roomCode,
          ownerMemberId: input.ownerMemberId,
        });
        if (smsResult.status !== "pending" && smsResult.status !== "failed") {
          pendingFlows.delete(flow.flowId);
        }
        return smsResult;
      }

      const pollUrl = new URL(BILIBILI_QR_POLL_URL);
      pollUrl.searchParams.set("qrcode_key", flow.qrCodeKey);
      const { payload, headers } =
        await requestBilibiliJson<BilibiliQrPollData>(
          options.fetchImpl,
          pollUrl.toString(),
        );
      if (payload.code !== 0) {
        return { status: "failed", message: "QR authorization failed." };
      }

      const pollCode = readNumber(payload.data?.code);
      if (pollCode === 86101) {
        return { status: "pending", message: "Waiting for scan." };
      }
      if (pollCode === 86090) {
        return {
          status: "pending",
          message: "QR code scanned; waiting for confirmation.",
        };
      }
      if (pollCode === 86038) {
        pendingFlows.delete(flow.flowId);
        return { status: "expired", message: "QR code expired." };
      }
      if (pollCode !== 0) {
        return { status: "failed", message: "QR authorization failed." };
      }

      const { credentials, profile } = buildCredentialsFromLoginSuccess({
        headers,
        dataUrl: payload.data?.url,
        refreshToken: payload.data?.refresh_token,
      });
      const status = await options.authSessions.authorize({
        roomCode: input.roomCode,
        providerId: "bilibili",
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
      const key = {
        roomCode: input.roomCode,
        providerId: "bilibili",
        ownerMemberId: input.ownerMemberId,
      } as const;
      const status = await options.authSessions.getStatus(key);
      if (!status) {
        return { authorized: false, profile: null };
      }

      const credentials =
        input.credentials ?? (await options.authSessions.getCredentials(key));
      const cookie = readCookieCredentials(credentials);
      if (!cookie) {
        return {
          authorized: true,
          profile: status.profile,
          expiresAt: status.expiresAt,
        };
      }

      const { payload } = await requestBilibiliJson<BilibiliNavData>(
        options.fetchImpl,
        BILIBILI_NAV_URL,
        {
          headers: {
            referer: BILIBILI_WEB_REFERER,
            cookie,
          },
        },
      );
      if (payload.code !== 0 || payload.data?.isLogin !== true) {
        await options.authSessions.logout(key);
        return { authorized: false, profile: null };
      }

      const navProfile = buildProfileFromNav(payload.data);
      return navProfile
        ? {
            authorized: true,
            profile: navProfile,
            expiresAt: status.expiresAt,
          }
        : {
            authorized: true,
            profile: status.profile,
            expiresAt: status.expiresAt,
          };
    },
    async logout(input) {
      await options.authSessions.logout({
        roomCode: input.roomCode,
        providerId: "bilibili",
        ownerMemberId: input.ownerMemberId,
      });
    },
  };
}

export function createBilibiliProvider(
  options: BilibiliProviderOptions = {},
): VideoProviderAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const wbiKeyCache: WbiKeyCache = { keys: null, expiresAt: 0 };
  const auth = options.authSessions
    ? createBilibiliAuthController({
        fetchImpl,
        authSessions: options.authSessions,
        now,
        qrFlowTtlMs: options.qrFlowTtlMs ?? DEFAULT_QR_FLOW_TTL_MS,
        smsFlowTtlMs: options.smsFlowTtlMs ?? DEFAULT_SMS_FLOW_TTL_MS,
        createFlowId: options.createFlowId ?? randomUUID,
      })
    : createUnavailableProviderAuth("bilibili");

  return {
    id: "bilibili",
    auth,
    matchUrl(value) {
      const url = parseUrl(value);
      if (!url) {
        return null;
      }
      return matchVideoUrl(url) ?? matchLiveUrl(url) ?? matchShortUrl(url);
    },
    async parse(input) {
      const matchedUrl =
        input.matchedUrl.kind === "short-link"
          ? await resolveShortLink(fetchImpl, input.matchedUrl)
          : input.matchedUrl;
      const resolvedInput =
        matchedUrl === input.matchedUrl ? input : { ...input, matchedUrl };
      if (resolvedInput.matchedUrl.kind === "ugc") {
        return parseNormalVideo(fetchImpl, resolvedInput, { now, wbiKeyCache });
      }
      if (resolvedInput.matchedUrl.kind === "pgc") {
        return parsePgcVideo(fetchImpl, resolvedInput, {
          now,
          wbiKeyCache,
          logEvent: options.logEvent,
        });
      }
      if (resolvedInput.matchedUrl.kind === "live") {
        return parseLiveRoom(fetchImpl, resolvedInput);
      }
      throw new VideoProviderError(
        "provider_parse_failed",
        "Bilibili source parsing is not implemented yet.",
        `${resolvedInput.matchedUrl.kind}_parse_not_implemented`,
      );
    },
  };
}
