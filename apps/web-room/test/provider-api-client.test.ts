import assert from "node:assert/strict";
import test from "node:test";
import {
  createProviderApiClient,
  ProviderApiError,
} from "../src/provider-api-client.js";

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
