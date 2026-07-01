import assert from "node:assert/strict";
import test from "node:test";
import {
  createProviderApiClient,
  ProviderApiError,
} from "../src/provider-api-client.js";

test("provider API client parses through the requested provider", async () => {
  let requestUrl = "";
  let requestBody: unknown;
  const fetchImpl: typeof fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          providerId: "generic",
          sourceId: "generic:source",
          sourceUrl: "https://example.com/watch/123",
          title: "Generic Video",
          items: [],
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  };
  const client = createProviderApiClient(
    "wss://syncroom.example.test",
    fetchImpl,
  );

  const result = await client.parse({
    providerId: "generic",
    roomCode: "ABC123",
    memberToken: "valid-member-token-123",
    url: "https://example.com/watch/123",
    policy: { proxy: false, shared: false },
  });

  assert.equal(
    requestUrl,
    "https://syncroom.example.test/api/providers/generic/parse",
  );
  assert.deepEqual(requestBody, {
    roomCode: "ABC123",
    memberToken: "valid-member-token-123",
    url: "https://example.com/watch/123",
    policy: { proxy: false, shared: false },
  });
  assert.equal(result.providerId, "generic");
});

test("provider API client starts auth through the requested provider", async () => {
  let requestUrl = "";
  let requestBody: unknown;
  const fetchImpl: typeof fetch = async (url, init) => {
    requestUrl = String(url);
    requestBody =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    return new Response(
      JSON.stringify({
        ok: true,
        data: {
          providerId: "iqiyi",
          method: "qr",
          flowId: "iqiyi-flow-1",
          status: "pending",
          expiresAt: 61_000,
          message: "iQIYI authorization request is pending.",
        },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  };
  const client = createProviderApiClient(
    "wss://syncroom.example.test",
    fetchImpl,
  );

  const result = await client.startAuth({
    providerId: "iqiyi",
    roomCode: "ABC123",
    memberToken: "valid-member-token-123",
    method: "qr",
  });

  assert.equal(
    requestUrl,
    "https://syncroom.example.test/api/providers/iqiyi/auth/start",
  );
  assert.deepEqual(requestBody, {
    roomCode: "ABC123",
    memberToken: "valid-member-token-123",
    method: "qr",
  });
  assert.equal(result.providerId, "iqiyi");
});

test("provider API client preserves safe provider error reasons", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "provider_parse_failed",
          message: "Provider request failed.",
          reason: "live_room_offline",
        },
      }),
      {
        status: 400,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  const client = createProviderApiClient(
    "ws://syncroom.example.test",
    fetchImpl,
  );

  await assert.rejects(
    () =>
      client.parse({
        providerId: "bilibili",
        roomCode: "ABC123",
        memberToken: "valid-member-token-123",
        url: "https://live.bilibili.com/1977907472",
        policy: { proxy: false, shared: false },
      }),
    (error) =>
      error instanceof ProviderApiError &&
      error.code === "provider_parse_failed" &&
      error.reason === "live_room_offline",
  );
});
