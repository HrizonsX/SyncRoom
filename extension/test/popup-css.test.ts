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

test("popup keeps the designed light theme in system dark mode", () => {
  assert.match(ruleBody(":root"), /color-scheme:\s*only light/);
  assert.doesNotMatch(popupCss, /prefers-color-scheme:\s*dark/);
  assert.doesNotMatch(popupCss, /color-scheme:\s*dark/);
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

test("current room member count pill uses a green status dot", () => {
  const capacityDotRules = exactRuleBodies(".capacity-pill::before");
  const finalCapacityDotRule = capacityDotRules.at(-1) ?? "";
  assert.match(finalCapacityDotRule, /background:\s*var\(--green\)/);
  assert.doesNotMatch(capacityDotRules.join("\n"), /var\(--amber\)/);
});

test("brand tagline is compact and sits under the product name", () => {
  assert.match(ruleBody(".brand-copy"), /display:\s*flex/);
  assert.match(ruleBody(".brand-copy"), /flex-direction:\s*column/);
  assert.match(ruleBody(".popup-tagline"), /font-size:\s*10px/);
  assert.match(ruleBody(".popup-tagline"), /color:\s*var\(--text-subtle\)/);
});

test("brand mark and title have lightweight hover motion", () => {
  assert.match(ruleBody(".brand-mark:hover"), /animation:\s*brandMarkSpin/);
  assert.match(ruleBody(".brand-title:hover"), /animation:\s*brandTitlePulse/);
  assert.match(popupCss, /@keyframes\s+brandMarkSpin/);
  assert.match(popupCss, /rotate\(360deg\)/);
  assert.match(popupCss, /@keyframes\s+brandTitlePulse/);
  assert.match(popupCss, /scale\(1\.08\)/);
  assert.match(popupCss, /scale\(0\.98\)/);
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
    /animation:\s*videoTitleScroll\s+4\.8s/,
  );
  assert.match(popupCss, /@keyframes\s+videoTitleScroll/);
});

test("announcement strip uses a gray surface with vertical item cycling and per-item scrolling", () => {
  assert.match(ruleBody(".announcement-strip"), /min-height:\s*32px/);
  assert.match(ruleBody(".announcement-strip"), /(?:^|\n)\s*height:\s*32px/);
  assert.match(ruleBody(".announcement-strip"), /overflow:\s*hidden/);
  assert.match(ruleBody(".announcement-strip"), /#f3f4f6/);
  assert.match(
    ruleBody(".announcement-track"),
    /animation:\s*announcementStackCycle/,
  );
  assert.match(ruleBody(".announcement-track"), /(?:^|\n)\s*height:\s*32px/);
  assert.match(ruleBody(".announcement-track"), /flex-direction:\s*column/);
  assert.match(ruleBody(".announcement-slide"), /padding:\s*0 12px 0 8px/);
  assert.match(ruleBody(".announcement-marquee"), /overflow:\s*hidden/);
  assert.match(ruleBody(".announcement-marquee"), /min-width:\s*0/);
  assert.match(ruleBody(".announcement-item"), /announcementTextSweep/);
  assert.match(ruleBody(".announcement-item"), /padding-right:\s*8px/);
  assert.match(
    popupCss,
    /\.announcement-strip:hover \.announcement-track,\s*\.announcement-strip:hover \.announcement-item\s*\{[\s\S]*animation-play-state:\s*paused/,
  );
  assert.match(popupCss, /@keyframes\s+announcementStackCycle/);
  assert.match(popupCss, /@keyframes\s+announcementTextSweep/);
  assert.match(
    popupCss,
    /@keyframes\s+announcementStackCycle[\s\S]*translateY/,
  );
  assert.match(popupCss, /prefers-reduced-motion:\s*reduce/);
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
  assert.match(
    ruleBody(".video-card-button.is-empty ~ .video-subline .video-owner-text"),
    /white-space:\s*normal/,
  );
  assert.match(
    ruleBody(".video-card-button.is-empty ~ .video-subline .video-owner-text"),
    /-webkit-line-clamp:\s*2/,
  );
});

test("idle room entry leaves a little more space before the join button", () => {
  assert.match(ruleBody(".idle-room-input"), /margin-right:\s*4px/);
});

test("room code easter egg uses the refined popup surface style", () => {
  assert.match(ruleBody(".easter-egg"), /display:\s*grid/);
  assert.match(ruleBody(".easter-egg"), /border:\s*1px solid var\(--border\)/);
  assert.match(ruleBody(".easter-egg"), /border-radius:\s*12px/);
  assert.match(ruleBody(".easter-mark"), /var\(--dark\)/);
  assert.match(ruleBody(".easter-dot"), /animation:\s*easterDotPulse/);
  assert.match(popupCss, /@keyframes\s+easterDotPulse/);
});

test("room code easter egg adds a subtle marquee ring to the shared video card", () => {
  assert.match(
    ruleBody(".video-panel.is-easter-egg-active"),
    /position:\s*relative/,
  );
  assert.match(
    ruleBody(".video-panel.is-easter-egg-active"),
    /box-shadow:[\s\S]*rgba\(34,\s*211,\s*238,\s*0\.2\)/,
  );
  assert.match(
    ruleBody(".video-panel.is-easter-egg-active::before"),
    /linear-gradient/,
  );
  assert.doesNotMatch(
    ruleBody(".video-panel.is-easter-egg-active::before"),
    /repeating-linear-gradient/,
  );
  assert.match(
    ruleBody(".video-panel.is-easter-egg-active::before"),
    /#22d3ee/,
  );
  assert.match(
    ruleBody(".video-panel.is-easter-egg-active::before"),
    /#a78bfa/,
  );
  assert.match(
    ruleBody(".video-panel.is-easter-egg-active::before"),
    /#f472b6/,
  );
  assert.doesNotMatch(
    ruleBody(".video-panel.is-easter-egg-active::before"),
    /#202838|#8c96a6/,
  );
  assert.match(
    ruleBody(".video-panel.is-easter-egg-active::before"),
    /filter:[\s\S]*drop-shadow\(0 0 10px/,
  );
  assert.doesNotMatch(
    ruleBody(".video-panel.is-easter-egg-active::before"),
    /conic-gradient/,
  );
  assert.match(
    ruleBody(".video-panel.is-easter-egg-active::before"),
    /animation:\s*sharedVideoMarqueeRing/,
  );
  assert.match(
    ruleBody(".video-panel.is-easter-egg-active::after"),
    /inset:\s*2px/,
  );
  assert.match(popupCss, /@keyframes\s+sharedVideoMarqueeRing/);
  assert.match(
    keyframesBody("sharedVideoMarqueeRing"),
    /background-position:\s*-200% 0/,
  );
  assert.doesNotMatch(
    keyframesBody("sharedVideoMarqueeRing"),
    /transform:\s*rotate/,
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
  const matches = exactRuleBodies(selector);
  assert.ok(matches[0], `Missing exact CSS rule for ${selector}`);
  return matches[0];
}

function exactRuleBodies(selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return Array.from(
    popupCss.matchAll(
      new RegExp(`(?:^|\\n)${escapedSelector}\\s*\\{([^}]*)\\}`, "g"),
    ),
    (match) => match[1],
  );
}

function keyframesBody(name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `@keyframes\\s+${escapedName}\\s*\\{\\s*to\\s*\\{([^}]*)\\}`,
  ).exec(popupCss);
  assert.ok(match, `Missing keyframes for ${name}`);
  return match[1];
}
