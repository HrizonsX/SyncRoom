import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const popupCss = readFileSync(
  path.resolve(import.meta.dirname, "../public/popup.css"),
  "utf8",
);

test("member mic status uses green for live mic and neutral gray for muted mic", () => {
  assert.match(ruleBody(".member-state"), /#1f8564/);
  assert.match(ruleBody(".member-state.muted"), /#8c96a6/);
  assert.doesNotMatch(ruleBody(".member-state.muted"), /var\(--danger-text\)/);
});

test("room heading icon is sized and aligned with the section label", () => {
  assert.match(ruleBody(".premium-heading-left"), /inline-flex/);
  assert.match(ruleBody(".premium-heading-left"), /align-items:\s*center/);
  assert.match(ruleBody(".room-heading-icon"), /width:\s*14px/);
  assert.match(ruleBody(".room-heading-icon"), /height:\s*14px/);
  assert.match(ruleBody(".room-heading-icon svg"), /width:\s*14px/);
});

test("retry loading dots render as inline ellipsis text", () => {
  assert.doesNotMatch(ruleBody(".status-retry-dots"), /inline-block/);
  assert.doesNotMatch(ruleBody(".status-retry-dots"), /vertical-align/);
  assert.match(ruleBody(".status-retry-dots"), /white-space:\s*nowrap/);
  assert.match(ruleBody(".status-retry-dot"), /animation:\s*retryDotPulse/);
});

test("brand tagline is compact and sits under the product name", () => {
  assert.match(ruleBody(".brand-copy"), /display:\s*flex/);
  assert.match(ruleBody(".brand-copy"), /flex-direction:\s*column/);
  assert.match(ruleBody(".popup-tagline"), /font-size:\s*10px/);
  assert.match(ruleBody(".popup-tagline"), /color:\s*var\(--text-subtle\)/);
});

test("premium popup cards and member list use the prototype surface styles", () => {
  assert.match(ruleBody(".popup-shell"), /border-radius:\s*0/);
  assert.match(ruleBody(".premium-panel"), /border-radius:\s*16px/);
  assert.match(ruleBody(".room-command"), /#edf2f7/);
  assert.match(ruleBody(".member-table"), /flex-direction:\s*column/);
  assert.match(ruleBody(".member-row:hover .avatar"), /avatar-spin-once/);
});

test("popup window scrollbar is narrow and visually subdued", () => {
  assert.match(popupCss, /html,\s*body\s*\{[\s\S]*scrollbar-width:\s*thin/);
  assert.match(exactRuleBody("::-webkit-scrollbar"), /width:\s*5px/);
  assert.match(
    exactRuleBody("::-webkit-scrollbar-thumb"),
    /background:\s*#c5d0dc/,
  );
  assert.match(
    exactRuleBody("::-webkit-scrollbar-thumb"),
    /border-radius:\s*999px/,
  );
});

test("shared video title scrolls on hover only when marked as scrollable", () => {
  assert.match(ruleBody(".video-title-text"), /display:\s*inline-block/);
  assert.match(
    ruleBody(".video-title.is-scrollable:hover .video-title-text"),
    /animation:\s*videoTitleScroll/,
  );
  assert.match(popupCss, /@keyframes\s+videoTitleScroll/);
});

test("idle shared-video layout keeps the helper copy beside the action button", () => {
  assert.match(
    ruleBody(".video-card-button.is-empty ~ .video-subline"),
    /align-items:\s*center/,
  );
  assert.match(
    ruleBody(".video-card-button.is-empty ~ .video-subline .video-owner"),
    /display:\s*block/,
  );
  assert.match(
    ruleBody(".video-card-button.is-empty ~ .video-subline .video-owner"),
    /white-space:\s*normal/,
  );
  assert.match(
    ruleBody(".video-card-button.is-empty ~ .video-subline .video-owner"),
    /-webkit-line-clamp:\s*2/,
  );
});

test("advanced panel uses prototype-aligned row, metrics, and button styles", () => {
  assert.match(ruleBody(".advanced-row"), /min-height:\s*44px/);
  assert.match(ruleBody(".advanced-content-preview"), /padding:\s*0 14px 14px/);
  assert.match(
    ruleBody(".advanced-setting-row"),
    /grid-template-columns:\s*minmax\(0,\s*1fr\) auto/,
  );
  assert.match(ruleBody(".advanced-input"), /border-radius:\s*10px/);
  assert.match(ruleBody(".advanced-input"), /min-height:\s*32px/);
  assert.match(ruleBody(".advanced-input"), /box-sizing:\s*border-box/);
  assert.match(ruleBody(".advanced-mini-button"), /min-height:\s*32px/);
  assert.match(ruleBody(".advanced-mini-button"), /box-sizing:\s*border-box/);
  assert.match(
    ruleBody(".advanced-content .advanced-mini-button"),
    /background:\s*rgba\(255,\s*255,\s*255,\s*0\.66\)/,
  );
  assert.match(
    ruleBody(".advanced-metrics"),
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    ruleBody(".advanced-metric"),
    /background:\s*rgba\(255,\s*255,\s*255,\s*0\.58\)/,
  );
  assert.match(ruleBody(".advanced-log-box"), /border-radius:\s*12px/);
  assert.doesNotMatch(popupCss, /\.advanced-summary::after/);
});

test("advanced collapsed and expanded states use an icon instead of text", () => {
  assert.match(ruleBody(".advanced-state-icon"), /width:\s*24px/);
  assert.match(ruleBody(".advanced-state-icon"), /font-size:\s*0/);
  assert.match(ruleBody(".advanced-state-chevron"), /transition:\s*transform/);
  assert.match(
    ruleBody(".advanced-state-icon.is-open .advanced-state-chevron"),
    /rotate\(180deg\)/,
  );
});

test("advanced debug log lines use readable text color", () => {
  assert.match(ruleBody(".log-line"), /color:\s*var\(--text-secondary\)/);
  assert.match(ruleBody(".log-empty"), /color:\s*var\(--text-subtle\)/);
  assert.match(ruleBody(".advanced-log-line"), /flex:\s*0 0 auto/);
  assert.doesNotMatch(
    ruleBody(".advanced-log-line"),
    /color:\s*var\(--text-muted\)/,
  );
});

test("advanced debug log box uses a fixed internal scroll viewport", () => {
  assert.match(ruleBody(".advanced-content-preview"), /min-height:\s*0/);
  assert.match(ruleBody(".advanced-log-box"), /height:\s*104px/);
  assert.match(ruleBody(".advanced-log-box"), /min-height:\s*104px/);
  assert.match(ruleBody(".advanced-log-box"), /max-height:\s*104px/);
  assert.match(ruleBody(".advanced-log-box"), /flex:\s*0 0 104px/);
  assert.match(ruleBody(".advanced-log-box"), /overflow-y:\s*scroll/);
  assert.match(ruleBody(".advanced-log-box"), /overscroll-behavior:\s*contain/);
  assert.match(ruleBody(".advanced-log-box"), /scrollbar-gutter:\s*stable/);
  assert.match(ruleBody(".advanced-log-box"), /scrollbar-width:\s*thin/);
  assert.match(
    ruleBody(".advanced-log-box"),
    /scrollbar-color:\s*#c5d0dc transparent/,
  );
  assert.match(
    ruleBody(".advanced-log-box::-webkit-scrollbar"),
    /width:\s*8px/,
  );
  assert.match(
    ruleBody(".advanced-log-box::-webkit-scrollbar-thumb"),
    /background:\s*#c5d0dc/,
  );
});

test("member voice controls are styled as the integrated mic buttons", () => {
  assert.match(ruleBody(".member-state"), /border-radius:\s*999px/);
  assert.match(ruleBody("button.member-state:hover"), /translateY\(-1px\)/);
  assert.match(ruleBody(".member-state.speaking::before"), /mic-ring/);
  assert.match(ruleBody(".member-state.muted::after"), /rotate\(-45deg\)/);
});

test("inline confirm dialog follows the refined popup surface style", () => {
  assert.match(ruleBody(".confirm-overlay"), /position:\s*fixed/);
  assert.match(ruleBody(".confirm-card"), /border-radius:\s*18px/);
  assert.match(ruleBody(".confirm-title"), /font-size:\s*15px/);
  assert.match(
    ruleBody(".confirm-actions"),
    /grid-template-columns:\s*1fr 1fr/,
  );
  assert.match(ruleBody(".confirm-button-primary"), /var\(--dark\)/);
});

test("exit room button is neutral by default and only turns dangerous on hover", () => {
  assert.doesNotMatch(ruleBody(".danger-button"), /var\(--danger-bg\)/);
  assert.doesNotMatch(ruleBody(".danger-button"), /var\(--danger-text\)/);
  assert.match(ruleBody(".danger-button:hover"), /var\(--danger-border\)/);
  assert.match(ruleBody(".danger-button:hover"), /var\(--danger-text\)/);
});

function ruleBody(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(
    popupCss,
  );
  assert.ok(match, `Missing CSS rule for ${selector}`);
  return match[1];
}

function exactRuleBody(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`).exec(
    popupCss,
  );
  assert.ok(match, `Missing exact CSS rule for ${selector}`);
  return match[1];
}
