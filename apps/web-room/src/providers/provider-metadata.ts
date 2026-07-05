import type { VideoProviderId } from "@syncroom/protocol";

type ProviderHostMatcher = {
  providerId: VideoProviderId;
  exactHosts: ReadonlySet<string>;
  suffixes: readonly string[];
};

type ProviderAuthMessages = {
  pending: string;
  qrPending: string;
  unavailable: string;
  verificationFailed: string;
  failed: string;
};

const PROVIDER_HOST_MATCHERS: readonly ProviderHostMatcher[] = [
  {
    providerId: "bilibili",
    exactHosts: new Set([
      "bilibili.com",
      "www.bilibili.com",
      "m.bilibili.com",
      "live.bilibili.com",
      "bangumi.bilibili.com",
      "b23.tv",
      "www.b23.tv",
    ]),
    suffixes: [".bilibili.com"],
  },
  {
    providerId: "iqiyi",
    exactHosts: new Set([
      "iqiyi.com",
      "www.iqiyi.com",
      "m.iqiyi.com",
      "iq.com",
      "www.iq.com",
    ]),
    suffixes: [".iqiyi.com", ".iq.com"],
  },
  {
    providerId: "huya",
    exactHosts: new Set(["huya.com", "www.huya.com", "m.huya.com"]),
    suffixes: [".huya.com"],
  },
];

const PROVIDER_AUTH_MESSAGES: Record<VideoProviderId, ProviderAuthMessages> = {
  bilibili: {
    pending: "Provider authorization request is pending.",
    qrPending: "Bilibili QR authorization request is pending.",
    unavailable: "Provider authorization failed.",
    verificationFailed: "Bilibili authorization could not be verified.",
    failed: "Bilibili authorization failed.",
  },
  generic: {
    pending: "Provider authorization request is pending.",
    qrPending: "Provider authorization request is pending.",
    unavailable: "Provider authorization failed.",
    verificationFailed: "Bilibili authorization could not be verified.",
    failed: "Bilibili authorization failed.",
  },
  iqiyi: {
    pending: "iQIYI authorization request is pending.",
    qrPending: "iQIYI authorization request is pending.",
    unavailable: "iQIYI authorization is not connected yet.",
    verificationFailed: "iQIYI authorization could not be verified.",
    failed: "iQIYI authorization is not connected yet.",
  },
  huya: {
    pending: "Huya authorization request is pending.",
    qrPending: "Huya authorization request is pending.",
    unavailable: "Huya authorization is not connected yet.",
    verificationFailed: "Huya authorization could not be verified.",
    failed: "Huya QR authorization failed.",
  },
};

function providerMatchesHost(
  matcher: ProviderHostMatcher,
  hostname: string,
): boolean {
  return (
    matcher.exactHosts.has(hostname) ||
    matcher.suffixes.some((suffix) => hostname.endsWith(suffix))
  );
}

/**
 * 平台域名归属和授权文案放在同一份元数据里。
 * 新增平台时优先扩展这里，避免把条件判断散落到房间控制器。
 */
export function getProviderIdForParseUrl(url: string): VideoProviderId {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return (
      PROVIDER_HOST_MATCHERS.find((matcher) =>
        providerMatchesHost(matcher, hostname),
      )?.providerId ?? "generic"
    );
  } catch {
    return "generic";
  }
}

export function getProviderAuthPendingMessage(
  providerId: VideoProviderId,
): string {
  return PROVIDER_AUTH_MESSAGES[providerId].pending;
}

export function getProviderAuthQrPendingMessage(
  providerId: VideoProviderId,
): string {
  return PROVIDER_AUTH_MESSAGES[providerId].qrPending;
}

export function getProviderAuthUnavailableMessage(
  providerId: VideoProviderId,
): string {
  return PROVIDER_AUTH_MESSAGES[providerId].unavailable;
}

export function getProviderAuthVerificationFailedMessage(
  providerId: VideoProviderId,
): string {
  return PROVIDER_AUTH_MESSAGES[providerId].verificationFailed;
}

export function getProviderAuthFailedMessage(
  providerId: VideoProviderId,
): string {
  return PROVIDER_AUTH_MESSAGES[providerId].failed;
}
