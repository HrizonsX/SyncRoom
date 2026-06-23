import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(
  new URL("../public/index.html", import.meta.url),
  "utf8",
);

test("hosts the app inside a stable fullscreen root", () => {
  assert.match(
    html,
    /<div id="web-room-fullscreen-root">\s*<div id="app"><\/div>\s*<\/div>/,
  );
});
