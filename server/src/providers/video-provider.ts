import type {
  ErrorCode,
  PlaybackProxyPolicy,
  ProviderItemSelection,
  ProviderPlaybackCandidate,
  ProviderPlaybackDescriptor,
  VideoProviderId,
} from "@syncroom/protocol";
import type {
  VideoAuthCredentials,
  VideoAuthProfile,
} from "../video-auth-session.js";

export type ProviderMatchedItemKind = "ugc" | "pgc" | "live" | "short-link";
export type ProviderAuthMethod = "qr" | "sms";
export type ProviderAuthFlowStatus =
  | "pending"
  | "authorized"
  | "expired"
  | "failed";

export type ProviderSmsCaptchaDetails = {
  type?: string;
  token: string;
  gt?: string;
  challenge?: string;
};

export type ProviderSmsAuthInput = {
  phoneNumber?: string;
  countryCode?: string;
  code?: string;
  captcha?: {
    token?: string;
    challenge?: string;
    validate?: string;
  };
};

export type ProviderMatchedUrl = {
  providerId: VideoProviderId;
  kind: ProviderMatchedItemKind;
  rawId: string;
  page: number | null;
  normalizedUrl: string;
  requiresResolution: boolean;
};

export type ProviderAuthStartInput = {
  method: ProviderAuthMethod;
  roomCode: string;
  ownerMemberId: string;
  displayName?: string | null;
  now?: number;
};

export type ProviderAuthFlowDetails = {
  providerId: VideoProviderId;
  method: ProviderAuthMethod;
  flowId: string;
  status: Exclude<ProviderAuthFlowStatus, "authorized">;
  expiresAt: number;
  qrCodeUrl?: string;
  smsCaptchaKey?: string;
  smsCaptcha?: ProviderSmsCaptchaDetails;
  message?: string;
};

export type ProviderAuthPollInput = {
  flowId: string;
  roomCode: string;
  ownerMemberId: string;
  now?: number;
  sms?: ProviderSmsAuthInput;
};

export type ProviderAuthPollResult =
  | {
      status: "pending" | "expired" | "failed";
      message?: string;
    }
  | {
      status: "authorized";
      profile: VideoAuthProfile | null;
      expiresAt?: number;
    };

export type ProviderAuthMeInput = {
  roomCode: string;
  ownerMemberId: string;
  credentials?: VideoAuthCredentials | null;
};

export type ProviderAuthMeResult = {
  authorized: boolean;
  profile: VideoAuthProfile | null;
  expiresAt?: number;
};

export type ProviderAuthLogoutInput = {
  roomCode: string;
  ownerMemberId: string;
  credentials?: VideoAuthCredentials | null;
};

export type ProviderAuthController = {
  start: (input: ProviderAuthStartInput) => Promise<ProviderAuthFlowDetails>;
  poll: (input: ProviderAuthPollInput) => Promise<ProviderAuthPollResult>;
  me: (input: ProviderAuthMeInput) => Promise<ProviderAuthMeResult>;
  logout: (input: ProviderAuthLogoutInput) => Promise<void>;
};

export type ProviderPlayableItem = {
  item: ProviderItemSelection & Record<string, unknown>;
  candidates: Array<ProviderPlaybackCandidate & Record<string, unknown>>;
  defaultCandidateId?: string;
} & Record<string, unknown>;

export type ProviderParseInput = {
  matchedUrl: ProviderMatchedUrl;
  policy: PlaybackProxyPolicy;
  credentials?: VideoAuthCredentials | null;
};

export type ProviderParseResult = {
  providerId: VideoProviderId;
  sourceId: string;
  sourceUrl: string;
  title: string;
  items: ProviderPlayableItem[];
};

export type SafeProviderError = {
  code: ErrorCode;
  message: string;
  reason: string;
};

export type VideoProviderAdapter = {
  id: VideoProviderId;
  auth: ProviderAuthController;
  matchUrl: (url: string) => ProviderMatchedUrl | null;
  parse: (input: ProviderParseInput) => Promise<ProviderParseResult>;
};

export type VideoProviderRegistry = {
  get: (providerId: VideoProviderId) => VideoProviderAdapter | null;
  matchUrl: (url: string) => ProviderMatchedUrl | null;
};

const SAFE_PROVIDER_MESSAGES: Partial<Record<ErrorCode, string>> = {
  provider_auth_unavailable: "Provider authorization is unavailable.",
  provider_auth_forbidden: "Provider authorization is not allowed.",
  provider_parse_failed: "Provider request failed.",
  proxy_expired: "Provider proxy resource expired.",
  proxy_forbidden: "Provider proxy resource is forbidden.",
  direct_playback_failed: "Direct playback failed.",
  unsupported_source: "Provider source is unsupported.",
};

export class VideoProviderError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly reason = "unknown",
  ) {
    super(message);
    this.name = "VideoProviderError";
  }
}

function safeReason(value: string): string {
  return /^[a-z0-9_.:-]+$/i.test(value) ? value : "unknown";
}

export function toSafeProviderError(error: unknown): SafeProviderError {
  if (error instanceof VideoProviderError) {
    return {
      code: error.code,
      message: SAFE_PROVIDER_MESSAGES[error.code] ?? "Provider request failed.",
      reason: safeReason(error.reason),
    };
  }

  return {
    code: "provider_parse_failed",
    message: "Provider request failed.",
    reason: "unknown",
  };
}

export function createUnavailableProviderAuth(
  providerId: VideoProviderId,
): ProviderAuthController {
  async function unavailable(action: string): Promise<never> {
    throw new VideoProviderError(
      "provider_auth_unavailable",
      `${providerId} authorization is not implemented yet.`,
      `${action}_not_implemented`,
    );
  }

  return {
    start: () => unavailable("auth_start"),
    poll: () => unavailable("auth_poll"),
    me: () => unavailable("auth_me"),
    logout: () => unavailable("auth_logout"),
  };
}

export async function unavailableProviderParse(
  providerId: VideoProviderId,
): Promise<ProviderParseResult> {
  throw new VideoProviderError(
    "provider_parse_failed",
    `${providerId} parsing is not implemented yet.`,
    "parse_not_implemented",
  );
}

function copyString<T extends string>(
  target: Record<string, unknown>,
  key: T,
  value: unknown,
): void {
  if (typeof value === "string") {
    target[key] = value;
  }
}

function copyNumber<T extends string>(
  target: Record<string, unknown>,
  key: T,
  value: unknown,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    target[key] = value;
  }
}

function sanitizeItem(
  item: ProviderItemSelection & Record<string, unknown>,
): ProviderItemSelection {
  const sanitized: Record<string, unknown> = {
    itemId: item.itemId,
    title: item.title,
    kind: item.kind,
  };
  copyString(sanitized, "aid", item.aid);
  copyString(sanitized, "bvid", item.bvid);
  copyString(sanitized, "cid", item.cid);
  copyString(sanitized, "epId", item.epId);
  copyString(sanitized, "seasonId", item.seasonId);
  copyString(sanitized, "roomId", item.roomId);
  copyNumber(sanitized, "durationSeconds", item.durationSeconds);
  return sanitized as unknown as ProviderItemSelection;
}

function sanitizeCandidate(
  candidate: ProviderPlaybackCandidate & Record<string, unknown>,
): ProviderPlaybackCandidate {
  const sanitized: Record<string, unknown> = {
    id: candidate.id,
    sourceType: candidate.sourceType,
    url: candidate.url,
  };
  copyString(sanitized, "mimeType", candidate.mimeType);
  copyString(sanitized, "codecs", candidate.codecs);
  copyString(sanitized, "qualityLabel", candidate.qualityLabel);
  copyNumber(sanitized, "width", candidate.width);
  copyNumber(sanitized, "height", candidate.height);
  copyNumber(sanitized, "bandwidth", candidate.bandwidth);
  if (typeof candidate.default === "boolean") {
    sanitized.default = candidate.default;
  }
  return sanitized as unknown as ProviderPlaybackCandidate;
}

export function createProviderPlaybackDescriptor(
  result: ProviderParseResult,
  selection: {
    itemId: string;
    policy: PlaybackProxyPolicy;
  },
): ProviderPlaybackDescriptor {
  const selected = result.items.find(
    (item) => item.item.itemId === selection.itemId,
  );
  if (!selected) {
    throw new VideoProviderError(
      "provider_parse_failed",
      "Selected provider item was not found.",
      "item_not_found",
    );
  }

  const candidates = selected.candidates.map(sanitizeCandidate);
  const defaultCandidate =
    selected.defaultCandidateId ??
    candidates.find((candidate) => candidate.default)?.id ??
    candidates[0]?.id;

  return {
    providerId: result.providerId,
    sourceId: result.sourceId,
    sourceUrl: result.sourceUrl,
    title: result.title,
    item: sanitizeItem(selected.item),
    policy: {
      proxy: selection.policy.proxy,
      shared: selection.policy.shared,
    },
    candidates,
    ...(defaultCandidate ? { defaultCandidateId: defaultCandidate } : {}),
  };
}

export function createVideoProviderRegistry(
  adapters: readonly VideoProviderAdapter[],
): VideoProviderRegistry {
  const adapterMap = new Map<VideoProviderId, VideoProviderAdapter>();
  for (const adapter of adapters) {
    if (adapterMap.has(adapter.id)) {
      throw new Error(`Duplicate video provider adapter: ${adapter.id}`);
    }
    adapterMap.set(adapter.id, adapter);
  }

  return {
    get(providerId) {
      return adapterMap.get(providerId) ?? null;
    },
    matchUrl(url) {
      for (const adapter of adapterMap.values()) {
        const matched = adapter.matchUrl(url);
        if (matched) {
          return matched;
        }
      }
      return null;
    },
  };
}
