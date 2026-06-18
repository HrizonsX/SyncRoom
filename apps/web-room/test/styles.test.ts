import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../src/styles.css", import.meta.url), {
  encoding: "utf8",
});

test("styles Bilibili QR authorization as a scannable square", () => {
  assert.match(
    styles,
    /\.auth-method-qr\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*justify-items:\s*center;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.auth-qr,\s*\.auth-qr-placeholder\s*{[^}]*width:\s*min\(240px,\s*100%\);[^}]*aspect-ratio:\s*1;[^}]*}/s,
  );
});

test("styles announcement brand and chat voice action", () => {
  assert.match(
    styles,
    /\.announcement-strip\s*{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.announcement-brand\s*{[^}]*display:\s*inline-flex;[^}]*min-width:\s*0;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.announcement-brand\s+\.brand-mark\s*{[^}]*width:\s*26px;[^}]*height:\s*26px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.chat-input-row\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto auto;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.voice-toggle-button\s*{[^}]*width:\s*34px;[^}]*min-width:\s*34px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.voice-toggle-button svg\s*{[^}]*width:\s*15px;[^}]*height:\s*15px;[^}]*}/s,
  );
});

test("styles entry screen with branded header and compact action rows", () => {
  assert.match(
    styles,
    /\.web-room-entry\s*{[^}]*width:\s*100%;[^}]*max-width:\s*none;[^}]*min-height:\s*100vh;[^}]*background:[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-entry::before\s*{[^}]*content:\s*"";[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*background-size:\s*32px 32px;[^}]*opacity:\s*0\.56;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-panel\s*{[^}]*position:\s*relative;[^}]*z-index:\s*1;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-header\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(160px,\s*220px\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-brand\s*{[^}]*padding-right:\s*0;[^}]*border-right:\s*0;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-brand\.announcement-brand\s*{[^}]*padding-right:\s*0;[^}]*border-right:\s*0;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-label-text\s*{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-label-icon,\s*\.entry-button-icon\s*{[^}]*width:\s*13px;[^}]*height:\s*13px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-name-field\s*{[^}]*width:\s*100%;[^}]*justify-self:\s*end;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-actions\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-room-action-row\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto auto;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-server-settings\s*{[^}]*grid-column:\s*1 \/ -1;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.entry-server-settings summary\s*{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*cursor:\s*pointer;[^}]*}/s,
  );
});

test("styles compact room info with collapsible member list", () => {
  assert.match(
    styles,
    /\.room-code-actions\s*{[^}]*display:\s*inline-flex;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.room-code-actions\s+\.leave-room-button\s*{[^}]*min-height:\s*26px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.room-meta\s*{[^}]*padding:\s*8px;[^}]*border:\s*1px solid #e0e8f0;[^}]*border-radius:\s*8px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.room-video-info\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.member-list-disclosure\s*{[^}]*margin:\s*10px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.member-list-disclosure summary\s*{[^}]*cursor:\s*pointer;[^}]*}/s,
  );
});

test("styles diagnostics as a collapsed disclosure", () => {
  assert.match(
    styles,
    /\.diagnostics-disclosure\s*{[^}]*margin:\s*0 10px 10px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.diagnostics-disclosure summary\s*{[^}]*cursor:\s*pointer;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.diagnostics-disclosure\[open\]\s+\.diagnostics-log\s*{[^}]*display:\s*block;[^}]*}/s,
  );
});

test("styles chat messages as directional bubbles", () => {
  assert.match(
    styles,
    /\.chat-list\s*{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow-y:\s*auto;[^}]*}/s,
  );
  assert.match(styles, /\.chat-message\s*{[^}]*max-width:\s*82%;[^}]*}/s);
  assert.match(
    styles,
    /\.chat-message\.is-self\s*{[^}]*align-self:\s*flex-start;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.chat-message\.is-other\s*{[^}]*align-self:\s*flex-end;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.chat-panel\s*{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto;[^}]*overflow:\s*hidden;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.chat-system-message\s*{[^}]*align-self:\s*center;[^}]*max-width:\s*90%;[^}]*text-align:\s*center;[^}]*}/s,
  );
});

test("styles web room icons and member avatars", () => {
  assert.match(
    styles,
    /\.panel-title\s*{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.panel-title-icon,\s*\.button-icon\s*{[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.summary-icon,\s*\.settings-heading-icon\s*{[^}]*width:\s*13px;[^}]*height:\s*13px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.voice-members\s*{[^}]*display:\s*flex;[^}]*flex-wrap:\s*wrap;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.voice-member\s*{[^}]*width:\s*28px;[^}]*height:\s*28px;[^}]*border-radius:\s*999px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.voice-member-avatar\s*{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*}/s,
  );
});

test("pauses danmaku animation when playback is paused", () => {
  assert.match(
    styles,
    /\.danmaku-layer\[data-danmaku-paused="true"\]\s+\.danmaku-item\s*{[^}]*animation-play-state:\s*paused;[^}]*}/s,
  );
});

test("styles player danmaku entry for desktop control bar and mobile popover", () => {
  assert.match(
    styles,
    /\.player-controls media-time-range\[disabled\]\s*{[^}]*pointer-events:\s*none;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-danmaku-inline\s*{[^}]*display:\s*inline-flex;[^}]*flex:\s*0 1 200px;[^}]*min-width:\s*132px;[^}]*max-width:\s*min\(20vw,\s*220px\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-danmaku-send\s*{[^}]*width:\s*28px;[^}]*padding:\s*0;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-danmaku-send-icon\s*{[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-danmaku-toggle\s*{[^}]*display:\s*none;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-media-controller\.is-danmaku-panel-open\s+\.player-danmaku-popover\s*{[^}]*display:\s*grid;[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.player-danmaku-inline\s*{[^}]*display:\s*none;[^}]*}[\s\S]*\.player-danmaku-toggle\s*{[^}]*display:\s*inline-flex;[^}]*}/s,
  );
});

test("styles player volume as an upward popover control", () => {
  assert.match(
    styles,
    /\.player-volume-control\s*{[^}]*position:\s*relative;[^}]*display:\s*inline-flex;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-volume-popover\s*{[^}]*position:\s*absolute;[^}]*bottom:\s*calc\(100% \+ 10px\);[^}]*height:\s*126px;[^}]*visibility:\s*hidden;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-volume-control:hover\s+\.player-volume-popover,\s*\.player-volume-control:focus-within\s+\.player-volume-popover,\s*\.player-volume-control\.is-volume-open\s+\.player-volume-popover\s*{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-volume-range-frame\s*{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-volume-range-frame\s*{[^}]*position:\s*relative;[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-volume-popover media-volume-range\s*{[^}]*position:\s*absolute;[^}]*top:\s*50%;[^}]*left:\s*50%;[^}]*width:\s*104px;[^}]*transform:\s*translate\(-50%,\s*-50%\) rotate\(-90deg\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-volume-popover media-volume-range\s*{[^}]*--media-range-padding:\s*0px;[^}]*--media-range-padding-left:\s*0px;[^}]*--media-range-padding-right:\s*0px;[^}]*}/s,
  );
});

test("styles settings tiles with compact full-width auth and bounded errors", () => {
  assert.match(
    styles,
    /\.authorization-management-tile\s*{[^}]*grid-column:\s*1 \/ -1;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.policy-row\s*{[^}]*justify-content:\s*flex-end;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.playback-error\s*{[^}]*grid-column:\s*1 \/ span 2;[^}]*max-width:\s*520px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.policy-option\s*{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*}/s,
  );
  assert.match(styles, /\.policy-help\s*{[^}]*position:\s*relative;[^}]*}/s);
  assert.match(
    styles,
    /\.policy-help summary\s*{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.policy-help-body\s*{[^}]*position:\s*absolute;[^}]*width:\s*min\(260px,\s*72vw\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.authorization-modal-backdrop\s*{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*z-index:\s*30;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.authorization-modal\s*{[^}]*width:\s*min\(520px,\s*calc\(100vw - 32px\)\);[^}]*}/s,
  );
});

test("styles player title as a compact control bar label", () => {
  assert.match(
    styles,
    /\.player-video-title\s*{[^}]*display:\s*inline-block;[^}]*max-width:\s*min\(58%,\s*420px\);[^}]*margin:\s*10px 0 0 10px;[^}]*pointer-events:\s*none;[^}]*text-overflow:\s*ellipsis;[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.player-video-title\s*{[^}]*max-width:\s*min\(72vw,\s*260px\);[^}]*margin:\s*8px 0 0 8px;[^}]*}/s,
  );
});
