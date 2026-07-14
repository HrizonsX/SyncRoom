import assert from "node:assert/strict";
import test from "node:test";
import { reportCurrentUser } from "../src/content/user-reporter.js";

test("does not perform browser-side Bilibili nav lookups", async () => {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  const messages: unknown[] = [];
  globalThis.fetch = (async (input: unknown) => {
    requests.push(input);
    throw new Error("unexpected fetch");
  }) as typeof fetch;

  try {
    await reportCurrentUser(async (message) => {
      messages.push(message);
      return { ok: true };
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests, []);
  assert.deepEqual(messages, []);
});
