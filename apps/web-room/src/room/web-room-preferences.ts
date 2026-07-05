import type { WebRoomThemeMode } from "../ui/render.js";
import type { StorageLike } from "./room-client.js";

export const WEB_ROOM_IDENTITY_STORAGE_KEY = "syncroom:web-room-identity";
export const WEB_ROOM_THEME_STORAGE_KEY = "syncroom:web-room-theme";

const DEFAULT_DISPLAY_NAME = "网页用户";
const DISPLAY_NAME_SUFFIX_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeWebRoomDisplayName(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, 32) : "";
}

export function createDefaultDisplayName(
  random: () => number = Math.random,
): string {
  const suffix = Array.from({ length: 2 }, () => {
    const index = Math.floor(random() * DISPLAY_NAME_SUFFIX_ALPHABET.length);
    return DISPLAY_NAME_SUFFIX_ALPHABET[
      Math.min(index, DISPLAY_NAME_SUFFIX_ALPHABET.length - 1)
    ];
  }).join("");
  return `${DEFAULT_DISPLAY_NAME}${suffix}`;
}

export function loadBrowserDisplayName(storage: StorageLike): string | null {
  const rawValue = storage.getItem(WEB_ROOM_IDENTITY_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    storage.removeItem(WEB_ROOM_IDENTITY_STORAGE_KEY);
    return null;
  }

  if (!isRecord(value) || typeof value.displayName !== "string") {
    storage.removeItem(WEB_ROOM_IDENTITY_STORAGE_KEY);
    return null;
  }

  const displayName = normalizeWebRoomDisplayName(value.displayName);
  if (!displayName) {
    storage.removeItem(WEB_ROOM_IDENTITY_STORAGE_KEY);
    return null;
  }

  return displayName;
}

export function persistBrowserDisplayName(
  storage: StorageLike | undefined,
  displayName: string,
): void {
  const safeDisplayName = normalizeWebRoomDisplayName(displayName);
  if (!storage || !safeDisplayName) {
    return;
  }

  // 存储归一化后的昵称，避免畸形或超长值在刷新后反复恢复。
  storage.setItem(
    WEB_ROOM_IDENTITY_STORAGE_KEY,
    JSON.stringify({ displayName: safeDisplayName }),
  );
}

export function getBrowserDisplayName(
  storage: StorageLike | undefined,
  random: () => number,
): string {
  if (storage) {
    const persistedDisplayName = loadBrowserDisplayName(storage);
    if (persistedDisplayName) {
      return persistedDisplayName;
    }
  }

  const displayName = createDefaultDisplayName(random);
  persistBrowserDisplayName(storage, displayName);
  return displayName;
}

export function resolveBrowserDisplayName(
  value: string | undefined,
  storage: StorageLike | undefined,
  random: () => number,
): string {
  const displayName = normalizeWebRoomDisplayName(value);
  if (displayName) {
    return displayName;
  }

  return getBrowserDisplayName(storage, random);
}

export function isWebRoomThemeMode(value: unknown): value is WebRoomThemeMode {
  return value === "light" || value === "dark";
}

export function loadWebRoomThemeMode(
  storage: StorageLike | undefined,
): WebRoomThemeMode {
  if (!storage) {
    return "light";
  }

  const value = storage.getItem(WEB_ROOM_THEME_STORAGE_KEY);
  if (isWebRoomThemeMode(value)) {
    return value;
  }
  if (value !== null) {
    storage.removeItem(WEB_ROOM_THEME_STORAGE_KEY);
  }
  return "light";
}

export function persistWebRoomThemeMode(
  storage: StorageLike | undefined,
  themeMode: WebRoomThemeMode,
): void {
  storage?.setItem(WEB_ROOM_THEME_STORAGE_KEY, themeMode);
}
