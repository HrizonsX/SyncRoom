import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import type {
  ProviderAuthController,
  ProviderAuthFlowDetails,
  ProviderAuthPollResult,
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

const HUYA_HOSTS = new Set(["huya.com", "www.huya.com", "m.huya.com"]);
const HUYA_REFERER = "https://www.huya.com/";
const HUYA_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const HUYA_QR_ID_URL = "https://udblgn.huya.com/qrLgn/getQrId";
const HUYA_QR_POLL_URL = "https://udblgn.huya.com/qrLgn/tryQrLogin";
const HUYA_LOGIN_CALLBACK_URL =
  "https://l.huya.com/udb_web/udbport2.php?m=HuyaLogin&do=huyaCallback";
const DEFAULT_QR_FLOW_TTL_MS = 300_000;
const QR_FLOW_PREFIX = "qr:";
const HUYA_AUTH_COOKIE_NAMES = new Set([
  "web_qrlogin_confirm_id",
  "udb_uid",
  "udb_biztoken",
  "udb_passport",
  "udb_version",
  "username",
  "nickname",
  "avatar",
  "account_token",
  "udb_l",
  "udb_n",
  "udb_oar",
]);

type HuyaProviderAuthSessions = {
  authorize: (args: {
    roomCode: string;
    providerId: "huya";
    ownerMemberId: string;
    profile: VideoAuthProfile | null;
    credentials: VideoAuthCredentials;
  }) => Promise<VideoAuthStatus>;
  getStatus: (key: {
    roomCode: string;
    providerId: "huya";
    ownerMemberId: string;
  }) => Promise<VideoAuthStatus | null>;
  getCredentials: (key: {
    roomCode: string;
    providerId: "huya";
    ownerMemberId: string;
  }) => Promise<VideoAuthCredentials | null>;
  logout: (key: {
    roomCode: string;
    providerId: "huya";
    ownerMemberId: string;
  }) => Promise<boolean>;
};

export type HuyaProviderOptions = {
  fetch?: typeof fetch;
  random?: () => number;
  authSessions?: HuyaProviderAuthSessions;
  now?: () => number;
  qrFlowTtlMs?: number;
  createFlowId?: () => string;
};

type JsonObject = Record<string, unknown>;

type HuyaQualityOption = {
  idSuffix: string;
  qualityLabel: string;
  bitrate: number | null;
};

type PendingQrFlow = {
  method: "qr";
  flowId: string;
  qrId: string;
  roomCode: string;
  ownerMemberId: string;
  expiresAt: number;
  cookiePairs: Map<string, string>;
};

type HuyaUdbEnvelope<TData> = {
  returnCode?: unknown;
  message?: unknown;
  description?: unknown;
  data?: TData;
};

type HuyaQrIdData = {
  qrId?: unknown;
};

type HuyaQrPollData = {
  stage?: unknown;
  uid?: unknown;
  yyuid?: unknown;
  passport?: unknown;
  nickName?: unknown;
  nickname?: unknown;
  avatar?: unknown;
  loginTime?: unknown;
  sign?: unknown;
};

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

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
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

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecords(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readRecordList(value: unknown): JsonObject[] {
  const records = readRecords(value);
  if (records.length > 0 || Array.isArray(value)) {
    return records;
  }
  return isRecord(value) ? readRecords(value.value) : [];
}

function createHuyaUdbRequest(
  url: string,
  uri: string,
  data: JsonObject,
): JsonObject {
  return {
    url,
    method: "post",
    uri,
    version: "2.2",
    context: "WB---",
    appId: "5002",
    lcid: "2052",
    byPass: "3",
    sdid: "",
    requestId: String(Date.now()),
    data,
  };
}

async function requestHuyaUdbJson<TData>(
  fetchImpl: typeof fetch,
  url: string,
  uri: string,
  data: JsonObject,
  cookiePairs?: Map<string, string>,
): Promise<{
  payload: HuyaUdbEnvelope<TData>;
  headers: Headers;
}> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        origin: HUYA_REFERER.replace(/\/$/, ""),
        referer: HUYA_REFERER,
        "user-agent": HUYA_USER_AGENT,
        ...(cookiePairs && cookiePairs.size > 0
          ? { cookie: formatCookieHeader(cookiePairs) }
          : {}),
      },
      body: JSON.stringify(createHuyaUdbRequest(url, uri, data)),
    });
  } catch (error) {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Huya authorization request failed.",
      error instanceof Error ? "huya_auth_network_error" : "huya_auth_error",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Huya authorization response was invalid.",
      "invalid_json",
    );
  }
  if (!isRecord(payload)) {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Huya authorization response was invalid.",
      "invalid_payload",
    );
  }

  return {
    payload: payload as HuyaUdbEnvelope<TData>,
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

function appendHuyaAuthCookies(
  cookiePairs: Map<string, string>,
  headers: Headers,
): void {
  for (const rawHeader of readSetCookieHeaders(headers)) {
    for (const setCookie of splitCombinedSetCookie(rawHeader)) {
      const pair = readCookiePair(setCookie);
      if (!pair || !HUYA_AUTH_COOKIE_NAMES.has(pair[0])) {
        continue;
      }
      cookiePairs.set(pair[0], pair[1]);
    }
  }
}

function formatCookieHeader(cookiePairs: Map<string, string>): string {
  return Array.from(cookiePairs.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function createHuyaCredentials(
  cookiePairs: Map<string, string>,
): VideoAuthCredentials {
  return cookiePairs.size > 0
    ? { cookies: formatCookieHeader(cookiePairs) }
    : {};
}

function readHuyaProfile(
  data: HuyaQrPollData | undefined,
): VideoAuthProfile | null {
  const id = readString(data?.uid) ?? readString(data?.yyuid);
  if (!id) {
    return null;
  }
  return {
    id,
    ...((readString(data?.nickName) ??
    readString(data?.nickname) ??
    readString(data?.passport))
      ? {
          displayName:
            readString(data?.nickName) ??
            readString(data?.nickname) ??
            readString(data?.passport) ??
            undefined,
        }
      : {}),
    ...(readString(data?.avatar)
      ? { avatarUrl: readString(data?.avatar) ?? undefined }
      : {}),
  };
}

async function exchangeHuyaLoginCallback(
  fetchImpl: typeof fetch,
  data: HuyaQrPollData | undefined,
  cookiePairs: Map<string, string>,
): Promise<void> {
  const loginTime = readString(data?.loginTime);
  const sign = readString(data?.sign);
  if (!loginTime || !sign) {
    return;
  }

  const callbackUrl = new URL(HUYA_LOGIN_CALLBACK_URL);
  callbackUrl.searchParams.set("loginTime", loginTime);
  callbackUrl.searchParams.set("sign", sign);
  let response: Response;
  try {
    response = await fetchImpl(callbackUrl.toString(), {
      headers: {
        accept: "text/html,application/xhtml+xml",
        referer: HUYA_REFERER,
        "user-agent": HUYA_USER_AGENT,
        ...(cookiePairs.size > 0
          ? { cookie: formatCookieHeader(cookiePairs) }
          : {}),
      },
    });
  } catch {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      "Huya login callback request failed.",
      "huya_callback_network_error",
    );
  }
  appendHuyaAuthCookies(cookiePairs, response.headers);
}

function createHuyaAuthController(options: {
  fetchImpl: typeof fetch;
  authSessions: HuyaProviderAuthSessions;
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
          "Huya SMS authorization is unavailable.",
          "sms_not_supported",
        );
      }
      const { payload, headers } = await requestHuyaUdbJson<HuyaQrIdData>(
        options.fetchImpl,
        HUYA_QR_ID_URL,
        "70001",
        {},
      );
      if (payload.returnCode !== 0) {
        throw new VideoProviderError(
          "provider_auth_unavailable",
          "Huya QR authorization is unavailable.",
          "qr_generate_failed",
        );
      }
      const qrId = readString(payload.data?.qrId);
      if (!qrId) {
        throw new VideoProviderError(
          "provider_auth_unavailable",
          "Huya QR authorization response was invalid.",
          "qr_generate_invalid_payload",
        );
      }

      const cookiePairs = new Map<string, string>();
      appendHuyaAuthCookies(cookiePairs, headers);
      const currentTime = getNow(input.now);
      const flow: PendingQrFlow = {
        method: "qr",
        flowId: `${QR_FLOW_PREFIX}${options.createFlowId()}`,
        qrId,
        roomCode: input.roomCode,
        ownerMemberId: input.ownerMemberId,
        expiresAt: currentTime + options.qrFlowTtlMs,
        cookiePairs,
      };
      pendingFlows.set(flow.flowId, flow);

      return {
        providerId: "huya",
        method: "qr",
        flowId: flow.flowId,
        status: "pending",
        expiresAt: flow.expiresAt,
        qrCodeUrl: await createQrCodeDataUrl(
          `https://udblgn.huya.com/qrLgn/getQrImg?k=${encodeURIComponent(qrId)}`,
        ),
        message: "Scan the Huya QR code to authorize playback.",
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

      const { payload, headers } = await requestHuyaUdbJson<HuyaQrPollData>(
        options.fetchImpl,
        HUYA_QR_POLL_URL,
        "70003",
        {
          qrId: flow.qrId,
          remember: 0,
          behavior: "",
          page: HUYA_REFERER,
        },
        flow.cookiePairs,
      );
      appendHuyaAuthCookies(flow.cookiePairs, headers);

      if (payload.returnCode !== 0) {
        return { status: "failed", message: "Huya QR authorization failed." };
      }
      const stage = readFiniteNumber(payload.data?.stage);
      if (stage === 0 || stage === 4 || stage === null) {
        return {
          status: "pending",
          message: "Waiting for Huya scan confirmation.",
        };
      }
      if (stage === 1) {
        return {
          status: "pending",
          message: "QR code scanned; waiting for confirmation.",
        };
      }
      if (stage === 5) {
        pendingFlows.delete(flow.flowId);
        return { status: "expired", message: "QR code expired." };
      }
      if (stage !== 2 && stage !== 3) {
        pendingFlows.delete(flow.flowId);
        return { status: "failed", message: "Huya QR authorization failed." };
      }

      await exchangeHuyaLoginCallback(
        options.fetchImpl,
        payload.data,
        flow.cookiePairs,
      );
      const profile = readHuyaProfile(payload.data);
      const status = await options.authSessions.authorize({
        roomCode: input.roomCode,
        providerId: "huya",
        ownerMemberId: input.ownerMemberId,
        profile,
        credentials: createHuyaCredentials(flow.cookiePairs),
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
        providerId: "huya",
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
        providerId: "huya",
        ownerMemberId: input.ownerMemberId,
      });
    },
  };
}

function normalizeHuyaUrl(value: string): ProviderMatchedUrl | null {
  const url = parseUrl(value);
  if (!url || !HUYA_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }
  const roomId = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean)[0];
  if (!roomId || !/^[A-Za-z0-9_-]+$/.test(roomId)) {
    return null;
  }
  return {
    providerId: "huya",
    kind: "live",
    rawId: roomId,
    page: null,
    normalizedUrl: `https://www.huya.com/${roomId}`,
    requiresResolution: false,
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractBalancedObject(
  source: string,
  startIndex: number,
): string | null {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index]!;
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }
  return null;
}

function readStreamObject(pageHtml: string): JsonObject {
  const patterns = [/\bstream\s*:\s*/g, /"stream"\s*:\s*/g];
  for (const pattern of patterns) {
    for (const match of pageHtml.matchAll(pattern)) {
      const objectStart = pageHtml.indexOf("{", match.index + match[0].length);
      if (objectStart < 0) {
        continue;
      }
      const objectText = extractBalancedObject(pageHtml, objectStart);
      if (!objectText) {
        continue;
      }
      try {
        const parsed = JSON.parse(objectText) as unknown;
        if (isRecord(parsed)) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
  }
  throw new VideoProviderError(
    "provider_parse_failed",
    "Huya stream metadata was not found.",
    "huya_stream_not_found",
  );
}

async function fetchHuyaRoomPage(
  fetchImpl: typeof fetch,
  url: string,
  credentials?: VideoAuthCredentials | null,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
        referer: HUYA_REFERER,
        "user-agent": HUYA_USER_AGENT,
        ...(typeof credentials?.cookies === "string"
          ? { cookie: credentials.cookies }
          : {}),
      },
    });
  } catch (error) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Huya room page request failed.",
      error instanceof Error ? "huya_room_network_error" : "huya_room_error",
    );
  }
  if (!response.ok) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Huya room page request failed.",
      `huya_room_http_${response.status}`,
    );
  }
  return await response.text();
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function readFirstStreamData(stream: JsonObject): JsonObject {
  const data = readRecordList(stream.data);
  const first = data[0];
  if (!first) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Huya stream metadata was invalid.",
      "huya_stream_empty",
    );
  }
  return {
    ...stream,
    ...first,
    vMultiStreamInfo: first.vMultiStreamInfo ?? stream.vMultiStreamInfo,
    iWebDefaultBitRate: first.iWebDefaultBitRate ?? stream.iWebDefaultBitRate,
    iFrameRate: first.iFrameRate ?? stream.iFrameRate,
  };
}

function isHuyaRoomOffline(gameLiveInfo: JsonObject): boolean {
  const liveStatus = gameLiveInfo.liveStatus ?? gameLiveInfo.isOn;
  if (liveStatus === 0 || liveStatus === false) {
    return true;
  }
  if (typeof liveStatus === "string") {
    const normalized = liveStatus.toLowerCase();
    return (
      normalized === "0" ||
      normalized === "off" ||
      normalized === "offline" ||
      normalized === "false"
    );
  }
  return false;
}

function readQualityOptions(value: unknown): HuyaQualityOption[] {
  const options = readRecordList(value).flatMap((item) => {
    const bitrate = readFiniteNumber(item.iBitRate);
    const label =
      readString(item.sDisplayName) ??
      (bitrate && bitrate > 0 ? `${bitrate}K` : null);
    if (!label) {
      return [];
    }
    return [
      {
        idSuffix: bitrate && bitrate > 0 ? String(bitrate) : "source",
        qualityLabel: label,
        bitrate: bitrate && bitrate > 0 ? bitrate : null,
      },
    ];
  });
  return options.length > 0
    ? options
    : [{ idSuffix: "source", qualityLabel: "Source", bitrate: null }];
}

function hasPublicStreamInfos(streamData: JsonObject): boolean {
  return readRecordList(streamData.gameStreamInfoList).length > 0;
}

function toUnsignedHuyaUid(value: number): string {
  const uid = BigInt(Math.trunc(value));
  const transformed =
    (uid & 0xffffffff00000000n) |
    ((uid & 0xffffffffn) >> 24n) |
    ((uid & 0xffffffn) << 8n);
  return transformed.toString();
}

function refreshHuyaAntiCode(args: {
  antiCode: string;
  streamName: string;
  streamInfo: JsonObject;
  quality: HuyaQualityOption;
  random: () => number;
}): URLSearchParams {
  const params = new URLSearchParams(decodeHtmlEntities(args.antiCode));
  if (args.quality.bitrate && args.quality.bitrate > 0) {
    params.set("ratio", String(args.quality.bitrate));
  } else {
    params.delete("ratio");
  }

  const fm = params.get("fm");
  const wsTime = params.get("wsTime");
  const ctype = params.get("ctype") ?? "tars_mobile";
  const t = params.get("t") ?? "100";
  if (!fm || !wsTime) {
    return params;
  }

  const wsTimeNumber = Number.parseInt(wsTime, 16);
  if (!Number.isFinite(wsTimeNumber)) {
    return params;
  }

  const currentTime = wsTimeNumber + args.random();
  const uuid = Math.trunc(
    ((currentTime % 10_000_000) * 1_000_000) % 0xffffffff,
  );
  const presenterUid = readFiniteNumber(args.streamInfo.lPresenterUid);
  const uid =
    presenterUid &&
    !args.streamName.startsWith(String(Math.trunc(presenterUid)))
      ? Math.trunc(presenterUid)
      : uuid;
  const seqId = Math.trunc(currentTime * 1000) + uid;
  const u = toUnsignedHuyaUid(uid);

  params.set("u", u);
  params.set("seqid", String(seqId));
  params.set("ver", "1");
  params.set("uuid", String(uuid));
  params.set("t", t);

  const fmPrefix =
    Buffer.from(fm, "base64").toString("utf8").split("_")[0] || fm;
  const ss = md5([String(seqId), ctype, t].join("|"));
  params.set(
    "wsSecret",
    md5([fmPrefix, u, args.streamName, ss, wsTime].join("_")),
  );
  return params;
}

function createHuyaStreamUrl(args: {
  streamInfo: JsonObject;
  quality: HuyaQualityOption;
  random: () => number;
}): string | null {
  const flvUrl = normalizeHuyaMediaBaseUrl(readString(args.streamInfo.sFlvUrl));
  const streamName = readString(args.streamInfo.sStreamName);
  const suffix = readString(args.streamInfo.sFlvUrlSuffix) ?? "flv";
  const antiCode = readString(args.streamInfo.sFlvAntiCode);
  if (!flvUrl || !streamName || suffix.toLowerCase() !== "flv" || !antiCode) {
    return null;
  }
  const params = refreshHuyaAntiCode({
    antiCode,
    streamName,
    streamInfo: args.streamInfo,
    quality: args.quality,
    random: args.random,
  });
  return `${flvUrl}/${streamName}.${suffix}?${params.toString()}`;
}

function normalizeHuyaMediaBaseUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.startsWith("//") ? `https:${value}` : value;
  const url = parseUrl(normalized);
  if (!url) {
    return null;
  }
  // Huya sometimes emits http FLV CDN URLs. The web room is served over HTTPS,
  // so direct playback must use HTTPS instead of relying on browser mixed-content fallback.
  url.protocol = "https:";
  return url.toString().replace(/\/+$/, "");
}

function createUniqueCandidateId(usedIds: Set<string>, baseId: string): string {
  let nextId = baseId;
  let suffix = 2;
  while (usedIds.has(nextId)) {
    nextId = `${baseId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(nextId);
  return nextId;
}

function sortStreamInfos(left: JsonObject, right: JsonObject): number {
  const leftMaster = readFiniteNumber(left.iIsMaster) ?? 0;
  const rightMaster = readFiniteNumber(right.iIsMaster) ?? 0;
  if (leftMaster !== rightMaster) {
    return rightMaster - leftMaster;
  }
  return (
    (readFiniteNumber(left.iLineIndex) ?? 0) -
    (readFiniteNumber(right.iLineIndex) ?? 0)
  );
}

function createHuyaCandidates(input: {
  streamData: JsonObject;
  random: () => number;
}): ProviderPlayableItem["candidates"] {
  const streamInfos = readRecordList(input.streamData.gameStreamInfoList).sort(
    sortStreamInfos,
  );
  const qualities = readQualityOptions(input.streamData.vMultiStreamInfo);
  const usedIds = new Set<string>();
  const candidates: ProviderPlayableItem["candidates"] = [];

  for (const quality of qualities) {
    for (const streamInfo of streamInfos) {
      const url = createHuyaStreamUrl({
        streamInfo,
        quality,
        random: input.random,
      });
      if (!url) {
        continue;
      }
      candidates.push({
        id: createUniqueCandidateId(usedIds, `huya-flv-${quality.idSuffix}`),
        sourceType: "flv",
        url,
        mimeType: "video/x-flv",
        qualityLabel: quality.qualityLabel,
        default: candidates.length === 0,
        upstreamHeaders: {
          Referer: HUYA_REFERER,
          Origin: "https://www.huya.com",
          "User-Agent": HUYA_USER_AGENT,
        },
      });
      break;
    }
  }
  return candidates;
}

function readHuyaTitle(gameLiveInfo: JsonObject, rawId: string): string {
  return (
    readString(gameLiveInfo.roomName) ??
    readString(gameLiveInfo.introduction) ??
    readString(gameLiveInfo.nick) ??
    `Huya Live ${rawId}`
  );
}

async function parseHuyaLiveRoom(
  fetchImpl: typeof fetch,
  input: ProviderParseInput,
  random: () => number,
): Promise<ProviderParseResult> {
  const pageHtml = await fetchHuyaRoomPage(
    fetchImpl,
    input.matchedUrl.normalizedUrl,
    input.credentials,
  );
  const streamData = readFirstStreamData(readStreamObject(pageHtml));
  const gameLiveInfo = isRecord(streamData.gameLiveInfo)
    ? streamData.gameLiveInfo
    : {};
  if (isHuyaRoomOffline(gameLiveInfo)) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Huya live room is not currently live.",
      "huya_live_room_offline",
    );
  }
  if (!hasPublicStreamInfos(streamData)) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Huya live room has no public live stream candidates.",
      "huya_live_room_unavailable",
    );
  }
  const title = readHuyaTitle(gameLiveInfo, input.matchedUrl.rawId);
  const candidates = createHuyaCandidates({ streamData, random });
  if (candidates.length === 0) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Huya live room has no FLV playback candidates.",
      "huya_no_live_flv_candidates",
    );
  }

  return {
    providerId: "huya",
    sourceId: `huya:${input.matchedUrl.rawId}`,
    sourceUrl: input.matchedUrl.normalizedUrl,
    title,
    items: [
      {
        item: {
          itemId: `live-${input.matchedUrl.rawId}`,
          title,
          kind: "live",
          roomId: input.matchedUrl.rawId,
        },
        candidates,
        defaultCandidateId: candidates[0]?.id,
      },
    ],
  };
}

export function createHuyaProvider(
  options: HuyaProviderOptions = {},
): VideoProviderAdapter {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;
  const auth = options.authSessions
    ? createHuyaAuthController({
        fetchImpl,
        authSessions: options.authSessions,
        now,
        qrFlowTtlMs: options.qrFlowTtlMs ?? DEFAULT_QR_FLOW_TTL_MS,
        createFlowId: options.createFlowId ?? randomUUID,
      })
    : createUnavailableProviderAuth("huya");
  return {
    id: "huya",
    auth,
    matchUrl(value) {
      return normalizeHuyaUrl(value);
    },
    async parse(input) {
      if (input.matchedUrl.kind !== "live") {
        throw new VideoProviderError(
          "provider_parse_failed",
          "Huya source parsing is not implemented yet.",
          `${input.matchedUrl.kind}_parse_not_implemented`,
        );
      }
      return parseHuyaLiveRoom(fetchImpl, input, random);
    },
  };
}
