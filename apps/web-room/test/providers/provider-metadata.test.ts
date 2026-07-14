import assert from "node:assert/strict";
import test from "node:test";
import {
  getProviderAuthFailedMessage,
  getProviderAuthPendingMessage,
  getProviderAuthQrPendingMessage,
  getProviderAuthUnavailableMessage,
  getProviderAuthVerificationFailedMessage,
  getProviderIdForParseUrl,
} from "../../src/providers/provider-metadata.js";

test("routes parse urls to the provider that owns the host family", () => {
  assert.equal(
    getProviderIdForParseUrl("https://www.bilibili.com/video/BV1xx411c7mD"),
    "bilibili",
  );
  assert.equal(
    getProviderIdForParseUrl("https://live.bilibili.com/12345"),
    "bilibili",
  );
  assert.equal(
    getProviderIdForParseUrl("https://m.iqiyi.com/v_abc.html"),
    "iqiyi",
  );
  assert.equal(
    getProviderIdForParseUrl("https://www.iq.com/play/abc"),
    "iqiyi",
  );
  assert.equal(getProviderIdForParseUrl("https://m.huya.com/12345"), "huya");
  assert.equal(
    getProviderIdForParseUrl("https://example.com/watch/video"),
    "generic",
  );
  assert.equal(getProviderIdForParseUrl("not a url"), "generic");
});

test("keeps provider-specific authorization copy behind one metadata contract", () => {
  assert.equal(
    getProviderAuthPendingMessage("iqiyi"),
    "iQIYI authorization request is pending.",
  );
  assert.equal(
    getProviderAuthUnavailableMessage("huya"),
    "Huya authorization is not connected yet.",
  );
  assert.equal(
    getProviderAuthVerificationFailedMessage("huya"),
    "Huya authorization could not be verified.",
  );
  assert.equal(
    getProviderAuthFailedMessage("bilibili"),
    "Bilibili authorization failed.",
  );
  assert.equal(
    getProviderAuthQrPendingMessage("bilibili"),
    "Bilibili QR authorization request is pending.",
  );
});
