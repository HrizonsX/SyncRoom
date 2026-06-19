import type {
  PlaybackProxyPolicy,
  ProviderPlaybackDescriptor,
} from "@syncroom/protocol";
import type { WebRoomAuthMethod, WebRoomProviderPickerItem } from "./render.js";

type JsonObject = Record<string, unknown>;

export class ProviderApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "ProviderApiError";
  }
}

export type BilibiliAuthFlowResult = {
  providerId: "bilibili";
  method: WebRoomAuthMethod;
  flowId: string;
  status: "pending" | "expired" | "failed";
  expiresAt: number;
  qrCodeUrl?: string;
  message?: string;
};

export type BilibiliAuthPollResult =
  | {
      status: "pending" | "expired" | "failed";
      message?: string;
    }
  | {
      status: "authorized";
      profile: {
        id: string;
        displayName?: string;
        avatarUrl?: string;
        vipLabel?: string;
      } | null;
      expiresAt?: number;
    };

export type BilibiliAuthStatusResult = {
  authorized: boolean;
  profile: {
    id: string;
    displayName?: string;
    avatarUrl?: string;
    vipLabel?: string;
  } | null;
  expiresAt?: number;
};

export type BilibiliParseResult = {
  providerId: "bilibili";
  sourceId: string;
  sourceUrl: string;
  title: string;
  items: WebRoomProviderPickerItem[];
};

export type ProviderApiClient = {
  startAuth: (input: {
    roomCode: string;
    memberToken: string;
    method: WebRoomAuthMethod;
  }) => Promise<BilibiliAuthFlowResult>;
  pollAuth: (input: {
    roomCode: string;
    memberToken: string;
    flowId: string;
  }) => Promise<BilibiliAuthPollResult>;
  getAuthStatus: (input: {
    roomCode: string;
    memberToken: string;
  }) => Promise<BilibiliAuthStatusResult>;
  logoutAuth: (input: {
    roomCode: string;
    memberToken: string;
  }) => Promise<{ loggedOut: true }>;
  parse: (input: {
    roomCode: string;
    memberToken: string;
    url: string;
    policy: PlaybackProxyPolicy;
  }) => Promise<BilibiliParseResult>;
};

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeServerUrlToHttp(serverUrl: string): string {
  const parsedUrl = new URL(serverUrl);
  if (parsedUrl.protocol === "ws:") {
    parsedUrl.protocol = "http:";
  } else if (parsedUrl.protocol === "wss:") {
    parsedUrl.protocol = "https:";
  }
  return parsedUrl.toString().replace(/\/+$/, "");
}

async function postJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<T> {
  const response = await fetchImpl(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as unknown;
  if (!isRecord(payload) || payload.ok !== true || !("data" in payload)) {
    const error = isRecord(payload) ? payload.error : null;
    const code =
      isRecord(error) && typeof error.code === "string"
        ? error.code
        : "provider_request_failed";
    const message =
      isRecord(error) && typeof error.message === "string"
        ? error.message
        : "Provider request failed.";
    throw new ProviderApiError(code, message, response.status);
  }
  return payload.data as T;
}

function coerceProviderItems(items: WebRoomProviderPickerItem[]) {
  return items.map((item) => ({
    ...item,
    providerDescriptor: item.providerDescriptor as
      | ProviderPlaybackDescriptor
      | undefined,
  }));
}

export function createProviderApiClient(
  serverUrl: string,
  fetchImpl: typeof fetch = fetch,
): ProviderApiClient {
  const baseUrl = normalizeServerUrlToHttp(serverUrl);
  return {
    startAuth(input) {
      return postJson(
        fetchImpl,
        baseUrl,
        "/api/providers/bilibili/auth/start",
        {
          roomCode: input.roomCode,
          memberToken: input.memberToken,
          method: input.method,
        },
      );
    },
    pollAuth(input) {
      return postJson(fetchImpl, baseUrl, "/api/providers/bilibili/auth/poll", {
        roomCode: input.roomCode,
        memberToken: input.memberToken,
        flowId: input.flowId,
      });
    },
    getAuthStatus(input) {
      return postJson(
        fetchImpl,
        baseUrl,
        "/api/providers/bilibili/auth/status",
        input,
      );
    },
    logoutAuth(input) {
      return postJson(
        fetchImpl,
        baseUrl,
        "/api/providers/bilibili/auth/logout",
        input,
      );
    },
    async parse(input) {
      const result = await postJson<BilibiliParseResult>(
        fetchImpl,
        baseUrl,
        "/api/providers/bilibili/parse",
        input,
      );
      return {
        ...result,
        items: coerceProviderItems(result.items),
      };
    },
  };
}
