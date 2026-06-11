export interface BilibiliVideoRef {
  videoId: string;
  normalizedUrl: string;
}

export type SharedVideoRef = BilibiliVideoRef;

const SUPPORTED_BILIBILI_HOSTS = new Set(["www.bilibili.com"]);
const GENERIC_VIDEO_ID_PREFIX = "web:";

function isSupportedBilibiliHost(hostname: string): boolean {
  return SUPPORTED_BILIBILI_HOSTS.has(hostname);
}

function parseSupportedBilibiliPath(pathname: string): {
  kind: "video" | "bangumi" | "festival" | "watchlater";
  id: string;
} | null {
  const normalizedPath = pathname.replace(/\/+$/, "");
  const videoMatch = normalizedPath.match(/^\/video\/([^/?]+)$/);
  if (videoMatch) {
    return { kind: "video", id: videoMatch[1] };
  }

  const bangumiMatch = normalizedPath.match(/^\/bangumi\/play\/([^/?]+)$/);
  if (bangumiMatch) {
    return { kind: "bangumi", id: bangumiMatch[1] };
  }

  if (/^\/festival\/[^/?]+$/.test(normalizedPath)) {
    return { kind: "festival", id: normalizedPath };
  }

  if (
    normalizedPath === "/list/watchlater" ||
    normalizedPath === "/medialist/play/watchlater"
  ) {
    return { kind: "watchlater", id: normalizedPath };
  }

  return null;
}

export function parseBilibiliVideoRef(
  url: string | undefined | null,
): BilibiliVideoRef | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!isSupportedBilibiliHost(parsed.hostname)) {
      return null;
    }

    const supportedPath = parseSupportedBilibiliPath(parsed.pathname);
    if (!supportedPath) {
      return null;
    }

    const bvid = parsed.searchParams.get("bvid");
    if (
      (supportedPath.kind === "festival" ||
        supportedPath.kind === "watchlater") &&
      bvid
    ) {
      const cid = parsed.searchParams.get("cid");
      const p = parsed.searchParams.get("p");
      return {
        videoId: cid ? `${bvid}:${cid}` : p ? `${bvid}:p${p}` : bvid,
        normalizedUrl: cid
          ? `https://www.bilibili.com/video/${bvid}?cid=${cid}`
          : p
            ? `https://www.bilibili.com/video/${bvid}?p=${p}`
            : `https://www.bilibili.com/video/${bvid}`,
      };
    }

    if (supportedPath.kind === "watchlater") {
      return null;
    }

    const p = parsed.searchParams.get("p");
    const cid =
      supportedPath.kind === "video" ? parsed.searchParams.get("cid") : null;
    const basePath = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
    const videoId = cid
      ? `${supportedPath.id}:${cid}`
      : p
        ? `${supportedPath.id}:p${p}`
        : supportedPath.id;
    const normalizedUrl = cid
      ? `${basePath}?cid=${cid}`
      : p
        ? `${basePath}?p=${p}`
        : basePath;
    return { videoId, normalizedUrl };
  } catch (err) {
    if (
      !(err instanceof TypeError) &&
      (typeof process === "undefined" || process.env.NODE_ENV !== "production")
    ) {
      console.debug(
        "[syncroom] parseBilibiliVideoRef: unexpected error parsing URL",
        url,
        err,
      );
    }
    return null;
  }
}

export function normalizeBilibiliUrl(
  url: string | undefined | null,
): string | null {
  return parseBilibiliVideoRef(url)?.normalizedUrl ?? null;
}

function hashStringToFixedHex(input: string): string {
  let first = 0x811c9dc5;
  let second = 0x9747b28c;
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 0x01000193);
    second ^= code + index;
    second = Math.imul(second, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function parseGenericHtml5VideoRef(
  url: string | undefined | null,
): SharedVideoRef | null {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    parsed.hash = "";
    parsed.username = "";
    parsed.password = "";
    const normalizedUrl = parsed.toString();
    return {
      videoId: `${GENERIC_VIDEO_ID_PREFIX}${hashStringToFixedHex(normalizedUrl)}`,
      normalizedUrl,
    };
  } catch {
    return null;
  }
}

export function parseSharedVideoRef(
  url: string | undefined | null,
): SharedVideoRef | null {
  return parseBilibiliVideoRef(url) ?? parseGenericHtml5VideoRef(url);
}

export function normalizeSharedVideoUrl(
  url: string | undefined | null,
): string | null {
  return parseSharedVideoRef(url)?.normalizedUrl ?? null;
}
