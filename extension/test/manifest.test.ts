import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manifest injects content script into generic http and https video pages", async () => {
  const manifest = JSON.parse(
    await readFile(new URL("../public/manifest.json", import.meta.url), "utf8"),
  ) as {
    host_permissions?: string[];
    content_scripts?: Array<{ matches?: string[] }>;
  };

  assert.ok(manifest.host_permissions?.includes("http://*/*"));
  assert.ok(manifest.host_permissions?.includes("https://*/*"));
  assert.ok(
    manifest.content_scripts?.some(
      (script) =>
        script.matches?.includes("http://*/*") &&
        script.matches.includes("https://*/*"),
    ),
  );
});

test("manifest locale descriptions use the syncRoom tagline", async () => {
  const zhMessages = JSON.parse(
    await readFile(
      new URL("../public/_locales/zh_CN/messages.json", import.meta.url),
      "utf8",
    ),
  ) as { extensionDescription?: { message?: string } };
  const enMessages = JSON.parse(
    await readFile(
      new URL("../public/_locales/en/messages.json", import.meta.url),
      "utf8",
    ),
  ) as { extensionDescription?: { message?: string } };

  assert.equal(zhMessages.extensionDescription?.message, "同频观影，好友同声");
  assert.equal(
    enMessages.extensionDescription?.message,
    "Watch together, speak in sync.",
  );
});

test("manifest icons exist with expected png dimensions", async () => {
  for (const [fileName, size] of [
    ["icon-16.png", 16],
    ["icon-48.png", 48],
    ["icon-128.png", 128],
  ] as const) {
    const png = await readFile(
      new URL(`../public/${fileName}`, import.meta.url),
    );
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
