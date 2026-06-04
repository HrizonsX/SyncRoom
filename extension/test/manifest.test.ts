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
