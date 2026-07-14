import assert from "node:assert/strict";
import test from "node:test";
import {
  WEB_ROOM_IDENTITY_STORAGE_KEY,
  WEB_ROOM_THEME_STORAGE_KEY,
  getBrowserDisplayName,
  loadBrowserDisplayName,
  loadWebRoomThemeMode,
  persistWebRoomThemeMode,
  resolveBrowserDisplayName,
} from "../../src/room/web-room-preferences.js";
import type { StorageLike } from "../../src/room/room-client.js";

class MemoryStorage implements StorageLike {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

test("loads a safe persisted web-room display name and removes malformed values", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    WEB_ROOM_IDENTITY_STORAGE_KEY,
    JSON.stringify({ displayName: "  Alice  " }),
  );

  assert.equal(loadBrowserDisplayName(storage), "Alice");

  storage.setItem(WEB_ROOM_IDENTITY_STORAGE_KEY, "not json");

  assert.equal(loadBrowserDisplayName(storage), null);
  assert.equal(storage.getItem(WEB_ROOM_IDENTITY_STORAGE_KEY), null);
});

test("generates and persists a bounded fallback web-room display name", () => {
  const storage = new MemoryStorage();
  const randomValues = [0, 0.999];
  const random = () => randomValues.shift() ?? 0;

  const displayName = getBrowserDisplayName(storage, random);

  assert.match(displayName, /^网页用户AZ$/);
  assert.equal(loadBrowserDisplayName(storage), displayName);
});

test("resolves explicit display names without overwriting persisted browser identity", () => {
  const storage = new MemoryStorage();
  const generatedName = getBrowserDisplayName(storage, () => 0);

  assert.equal(
    resolveBrowserDisplayName("  Bob  ", storage, () => 0.5),
    "Bob",
  );
  assert.equal(loadBrowserDisplayName(storage), generatedName);
});

test("loads, persists, and repairs web-room theme mode", () => {
  const storage = new MemoryStorage();

  assert.equal(loadWebRoomThemeMode(storage), "light");
  persistWebRoomThemeMode(storage, "dark");
  assert.equal(loadWebRoomThemeMode(storage), "dark");

  storage.setItem(WEB_ROOM_THEME_STORAGE_KEY, "solarized");

  assert.equal(loadWebRoomThemeMode(storage), "light");
  assert.equal(storage.getItem(WEB_ROOM_THEME_STORAGE_KEY), null);
});
