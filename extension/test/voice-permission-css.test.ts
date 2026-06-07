import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const permissionCss = readFileSync(
  path.resolve(import.meta.dirname, "../public/voice-permission.css"),
  "utf8",
);

test("microphone permission page uses the refined SyncRoom surface", () => {
  assert.match(ruleBody("body"), /display:\s*grid/);
  assert.match(ruleBody("body"), /place-items:\s*center/);
  assert.match(ruleBody(".permission-shell"), /max-width:\s*360px/);
  assert.match(ruleBody(".permission-shell"), /border-radius:\s*18px/);
  assert.match(ruleBody(".permission-mark"), /#202b3d/);
  assert.doesNotMatch(permissionCss, /#1d4ed8/);
  assert.match(ruleBody("button"), /box-shadow:/);
});

function ruleBody(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(
    permissionCss,
  );
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}
