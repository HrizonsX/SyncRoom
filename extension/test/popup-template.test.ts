import assert from "node:assert/strict";
import test from "node:test";
import { renderPopupTemplate } from "../src/popup/popup-template";
import { setLocaleForTests } from "../src/shared/i18n";

test("popup room section heading renders a decorative room icon before the label", () => {
  setLocaleForTests("en-US");
  try {
    const html = renderPopupTemplate();
    const headingMatch =
      /<span class="premium-heading-left">([\s\S]*?)Room([\s\S]*?)<\/span>/.exec(
        html,
      );

    assert.ok(headingMatch, "missing room section heading");
    const headingHtml = headingMatch[0];
    assert.match(headingHtml, /class="room-heading-icon"/);
    assert.match(headingHtml, /aria-hidden="true"/);
    assert.ok(
      headingHtml.indexOf("room-heading-icon") < headingHtml.indexOf("Room"),
      "room icon should render before the Room label",
    );
  } finally {
    setLocaleForTests(null);
  }
});

test("popup template renders a short product tagline under the SyncRoom name", () => {
  setLocaleForTests("zh-CN");
  try {
    const html = renderPopupTemplate();

    assert.match(html, /class="brand-copy"/);
    assert.match(html, /class="popup-tagline"/);
    assert.match(html, /同频观影，好友同声/);
    assert.ok(
      html.indexOf('class="popup-title brand-title"') <
        html.indexOf('class="popup-tagline"'),
      "tagline should render directly under the product title",
    );
  } finally {
    setLocaleForTests(null);
  }
});

test("popup template integrates voice controls into the online members panel", () => {
  setLocaleForTests("zh-CN");
  try {
    const html = renderPopupTemplate();

    assert.doesNotMatch(html, /sectionVoiceChat/);
    assert.doesNotMatch(html, /voice-panel/);
    assert.match(html, /id="members-status"/);
    assert.match(html, /id="voice-status"/);
    assert.match(html, /id="member-list"/);
    assert.match(html, /id="voice-error"/);
    assert.ok(
      html.indexOf('id="voice-status"') > html.indexOf("在线成员"),
      "voice status should live in the members heading",
    );
  } finally {
    setLocaleForTests(null);
  }
});

test("popup template includes the inline share confirmation dialog", () => {
  setLocaleForTests("en-US");
  try {
    const html = renderPopupTemplate();

    assert.match(html, /id="confirm-dialog"/);
    assert.match(html, /role="dialog"/);
    assert.match(html, /aria-modal="true"/);
    assert.match(html, /id="confirm-title"/);
    assert.match(html, /id="confirm-description"/);
    assert.match(html, /id="confirm-confirm"/);
    assert.match(html, /id="confirm-cancel"/);
  } finally {
    setLocaleForTests(null);
  }
});

test("popup template maps advanced settings to the prototype structure", () => {
  setLocaleForTests("en-US");
  try {
    const html = renderPopupTemplate();

    assert.match(html, /class="advanced-summary advanced-row"/);
    assert.match(html, /class="advanced-state-icon"/);
    assert.match(html, /class="advanced-state-chevron"/);
    assert.match(html, /aria-label="Expand"/);
    assert.doesNotMatch(html, /id="advanced-state">Expand/);
    assert.match(html, /class="advanced-content advanced-content-preview"/);
    assert.match(html, /class="setting-group advanced-field"/);
    assert.match(html, /class="settings-row advanced-setting-row"/);
    assert.match(html, /class="info-grid advanced-metrics"/);
    assert.equal(html.match(/class="info-item advanced-metric"/g)?.length, 4);
    assert.match(html, /id="clock-offset-status"/);
    assert.match(html, /id="rtt-status"/);
    assert.doesNotMatch(html, /id="clock-status"/);
    assert.match(html, /class="logs-header advanced-log-head"/);
    assert.match(html, /class="log-box advanced-log-box"/);
    assert.match(html, /class="video-title-text"/);
    assert.match(html, /id="easter-egg"/);
    assert.match(html, /class="easter-egg"/);
    assert.match(html, /hidden/);
    assert.doesNotMatch(html, /id="shared-video-owner-extra"/);
    assert.doesNotMatch(html, /class="video-owner-extra"/);
  } finally {
    setLocaleForTests(null);
  }
});
