import type {
  PlaybackProxyPolicy,
  ProviderPlaybackDescriptor,
  VideoProviderId,
} from "@syncroom/protocol";
import type { WebRoomAuthMethod, WebRoomProviderPickerItem } from "./render.js";

type JsonObject = Record<string, unknown>;

export class ProviderApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = "ProviderApiError";
  }
}

export type ProviderAuthFlowResult = {
  providerId: VideoProviderId;
  method: WebRoomAuthMethod;
  flowId: string;
  status: "pending" | "expired" | "failed";
  expiresAt: number;
  qrCodeUrl?: string;
  message?: string;
};
export type BilibiliAuthFlowResult = ProviderAuthFlowResult;

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

export type ProviderParseResult = {
  providerId: VideoProviderId;
  sourceId: string;
  sourceUrl: string;
  title: string;
  items: WebRoomProviderPickerItem[];
};

export type ProviderApiClient = {
  startAuth: (input: {
    providerId?: VideoProviderId;
    roomCode: string;
    memberToken: string;
    method: WebRoomAuthMethod;
  }) => Promise<ProviderAuthFlowResult>;
  pollAuth: (input: {
    providerId?: VideoProviderId;
    roomCode: string;
    memberToken: string;
    flowId: string;
  }) => Promise<BilibiliAuthPollResult>;
  getAuthStatus: (input: {
    providerId?: VideoProviderId;
    roomCode: string;
    memberToken: string;
  }) => Promise<BilibiliAuthStatusResult>;
  logoutAuth: (input: {
    providerId?: VideoProviderId;
    roomCode: string;
    memberToken: string;
  }) => Promise<{ loggedOut: true }>;
  parse: (input: {
    providerId: VideoProviderId;
    roomCode: string;
    memberToken: string;
    url: string;
    policy: PlaybackProxyPolicy;
  }) => Promise<ProviderParseResult>;
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
    const reason =
      isRecord(error) && typeof error.reason === "string"
        ? error.reason
        : undefined;
    throw new ProviderApiError(code, message, response.status, reason);
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
  const getProviderAuthPath = (
    providerId: VideoProviderId | undefined,
    action: string,
  ) => `/api/providers/${providerId ?? "bilibili"}/auth/${action}`;
  return {
    startAuth(input) {
      const { providerId, ...body } = input;
      return postJson(
        fetchImpl,
        baseUrl,
        getProviderAuthPath(providerId, "start"),
        body,
      );
    },
    pollAuth(input) {
      const { providerId, ...body } = input;
      return postJson(
        fetchImpl,
        baseUrl,
        getProviderAuthPath(providerId, "poll"),
        body,
      );
    },
    getAuthStatus(input) {
      const { providerId, ...body } = input;
      return postJson(
        fetchImpl,
        baseUrl,
        getProviderAuthPath(providerId, "status"),
        body,
      );
    },
    logoutAuth(input) {
      const { providerId, ...body } = input;
      return postJson(
        fetchImpl,
        baseUrl,
        getProviderAuthPath(providerId, "logout"),
        body,
      );
    },
    async parse(input) {
      const { providerId, ...body } = input;
      const result = await postJson<ProviderParseResult>(
        fetchImpl,
        baseUrl,
        `/api/providers/${providerId}/parse`,
        body,
      );
      return {
        ...result,
        items: coerceProviderItems(result.items),
      };
    },
  };
}
