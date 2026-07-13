import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync(new URL("../../src/styles.css", import.meta.url), {
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
    /\.announcement-strip\s*{[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.announcement-brand\s*{[^}]*display:\s*inline-flex;[^}]*min-width:\s*0;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.announcement-brand\s+\.brand-mark\s*{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.announcement-brand-copy strong\s*{[^}]*font-size:\s*14px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.announcement-brand-copy small\s*{[^}]*font-size:\s*11px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.announcement-message\s*{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.announcement-icon\s*{[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*}/s,
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
  assert.match(
    styles,
    /\.theme-toggle-button\s*{[^}]*min-height:\s*28px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s*{[^}]*--web-room-bg:\s*#111827;[^}]*--surface:\s*#172033;[^}]*--text-primary:\s*#f8fafc;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.provider-picker-panel,\s*\.web-room-shell\[data-theme-mode="dark"\]\s+\.provider-auth-panel,\s*\.web-room-shell\[data-theme-mode="dark"\]\s+\.settings-tile,\s*\.web-room-shell\[data-theme-mode="dark"\]\s+\.room-video-info,\s*\.web-room-shell\[data-theme-mode="dark"\]\s+\.room-meta,\s*\.web-room-shell\[data-theme-mode="dark"\]\s+\.chat-voice-panel\s*{[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.42\);[^}]*border-color:\s*#344256;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.secondary-button,\s*\.web-room-shell\[data-theme-mode="dark"\]\s+\.voice-toggle-button,\s*\.web-room-shell\[data-theme-mode="dark"\]\s+\.segment-button\s*{[^}]*border-color:\s*#46566d;[^}]*background:[^}]*rgba\(31,\s*41,\s*55,\s*0\.74\);[^}]*box-shadow:\s*inset 0 1px 0 rgba\(255,\s*255,\s*255,\s*0\.08\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.icon-button\.copy-room-button\s*{[^}]*border-color:\s*#46566d;[^}]*background:[^}]*rgba\(31,\s*41,\s*55,\s*0\.74\);[^}]*color:\s*var\(--text-secondary\);[^}]*}/s,
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
    /\.room-video-info\s*{[^}]*margin:\s*8px 10px 10px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.member-list-disclosure\s*{[^}]*margin:\s*10px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.member-list-disclosure summary\s*{[^}]*cursor:\s*pointer;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.member-main\s*{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*flex-wrap:\s*wrap;[^}]*}/s,
  );
  assert.match(styles, /\.member-identity\s*{[^}]*flex:\s*1 1 140px;[^}]*}/s);
  assert.match(
    styles,
    /\.member-badges\s*{[^}]*justify-content:\s*flex-end;[^}]*margin-left:\s*auto;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.member-actions\s*{[^}]*display:\s*inline-flex;[^}]*flex-wrap:\s*wrap;[^}]*justify-content:\s*flex-end;[^}]*margin-left:\s*auto;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.member-row\s*{[^}]*border-color:\s*#344256;[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.42\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.avatar\s*{[^}]*border-color:\s*#58708e;[^}]*background:\s*rgba\(31,\s*41,\s*55,\s*0\.82\);[^}]*color:\s*#e5edf8;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.mini-badge\s*{[^}]*border-color:\s*rgba\(125,\s*211,\s*252,\s*0\.38\);[^}]*background:\s*rgba\(14,\s*116,\s*144,\s*0\.28\);[^}]*color:\s*#e0f2fe;[^}]*}/s,
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
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.diagnostics-log\s*{[^}]*border-color:\s*#344256;[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.42\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.log-line\s*{[^}]*color:\s*#d7dee8;[^}]*}/s,
  );
});

test("styles provider parse results for dark mode", () => {
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.provider-item-row\s*{[^}]*border-color:\s*#344256;[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.56\);[^}]*color:\s*var\(--text-secondary\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.provider-item-row\[data-item-selected="true"\]\s*{[^}]*border-color:\s*rgba\(125,\s*199,\s*238,\s*0\.46\);[^}]*background:\s*rgba\(30,\s*41,\s*59,\s*0\.92\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.provider-quality-list\s*{[^}]*border-color:\s*#344256;[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.42\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.provider-quality-row\s*{[^}]*border-color:\s*#46566d;[^}]*background:\s*rgba\(31,\s*41,\s*55,\s*0\.74\);[^}]*color:\s*var\(--text-secondary\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.provider-quality-row\[data-quality-selected="true"\]\s*{[^}]*border-color:\s*rgba\(125,\s*211,\s*252,\s*0\.46\);[^}]*background:\s*rgba\(14,\s*116,\s*144,\s*0\.36\);[^}]*color:\s*#e0f2fe;[^}]*}/s,
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
    /\.chat-panel\s*{[^}]*grid-template-rows:\s*auto auto minmax\(0,\s*1fr\) auto;[^}]*height:\s*100%;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.chat-system-message\s*{[^}]*align-self:\s*center;[^}]*max-width:\s*90%;[^}]*text-align:\s*center;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.chat-message\s+p\s*{[^}]*border-color:\s*#58708e;[^}]*background:\s*rgba\(31,\s*41,\s*55,\s*0\.88\);[^}]*color:\s*#e5edf8;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.chat-message\.is-other\s+p\s*{[^}]*border-color:\s*rgba\(125,\s*211,\s*252,\s*0\.38\);[^}]*background:\s*rgba\(14,\s*116,\s*144,\s*0\.28\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.panel-heading,\s*\.web-room-shell\[data-theme-mode="dark"\]\s+\.chat-voice-panel,\s*\.web-room-shell\[data-theme-mode="dark"\]\s+\.chat-input-row\s*{[^}]*border-color:\s*#344256;[^}]*}/s,
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
    /\.panel-title-icon,\s*\.summary-icon,\s*\.settings-heading-icon,\s*\.voice-summary-icon\s*{[^}]*display:\s*block;[^}]*flex-shrink:\s*0;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.panel-title-icon,\s*\.summary-icon,\s*\.settings-heading-icon,\s*\.voice-summary-icon\s*{[^}]*align-self:\s*center;[^}]*line-height:\s*0;[^}]*transform:\s*translateZ\(0\);[^}]*backface-visibility:\s*hidden;[^}]*}/s,
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
  assert.match(
    styles,
    /\.voice-member-count\s*{[^}]*display:\s*inline-grid;[^}]*place-items:\s*center;[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*border-radius:\s*999px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.voice-member-count,\s*\.web-room-shell\[data-theme-mode="dark"\]\s+\.voice-member\s*{[^}]*border-color:\s*#58708e;[^}]*background:\s*rgba\(31,\s*41,\s*55,\s*0\.78\);[^}]*color:\s*#dbeafe;[^}]*}/s,
  );
});

test("styles danmaku animation without tying it to playback pause", () => {
  assert.match(
    styles,
    /\.danmaku-layer\s*{[^}]*inset:\s*0 0 auto;[^}]*height:\s*25%;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.danmaku-item\s*{[^}]*top:\s*calc\(8px \+ var\(--danmaku-lane-y,\s*0px\)\);[^}]*animation-name:\s*danmaku-scroll;[^}]*animation-duration:\s*9s;[^}]*animation-delay:\s*var\(--danmaku-progress-delay,\s*0ms\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.danmaku-item\.is-top,\s*\.danmaku-item\.is-bottom\s*{[^}]*animation-name:\s*danmaku-hold;[^}]*animation-duration:\s*4\.5s;[^}]*}/s,
  );
  assert.doesNotMatch(styles, /animation-play-state:\s*paused/);
});

test("styles player danmaku entry for desktop control bar and mobile popover", () => {
  assert.match(
    styles,
    /\.web-room-workspace\s*{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) minmax\(150px,\s*auto\);[^}]*height:\s*calc\(100vh - 20px\);[^}]*max-height:\s*calc\(100vh - 20px\);[^}]*overflow:\s*hidden;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-chat-grid\s*{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*max-height:\s*100%;[^}]*overflow:\s*hidden;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-panel\s*{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-surface\s*{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*aspect-ratio:\s*auto;[^}]*overflow:\s*hidden;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-controls\s*{[^}]*gap:\s*0;[^}]*right:\s*8px;[^}]*bottom:\s*4px;[^}]*left:\s*8px;[^}]*border:\s*1px solid rgba\(248,\s*250,\s*252,\s*0\.14\);[^}]*border-radius:\s*7px;[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.78\);[^}]*--media-control-background:\s*transparent;[^}]*--media-control-hover-background:\s*rgba\(248,\s*250,\s*252,\s*0\.12\);[^}]*--media-control-padding:\s*0 8px;[^}]*}/s,
  );
  assert.match(styles, /\.player-controls > \*\s*{[^}]*margin:\s*0;[^}]*}/s);
  assert.match(
    styles,
    /\.player-controls media-play-button,\s*\.player-controls media-mute-button,\s*\.player-controls media-playback-rate-button,\s*\.player-controls media-pip-button,\s*\.player-controls media-fullscreen-button\s*{[^}]*background:\s*transparent;[^}]*border-radius:\s*0;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-time-pair\s*{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-controls media-time-range\[disabled\]\s*{[^}]*pointer-events:\s*none;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-media-controller\[data-player-autohide-restored\]\[userinactive\]:not\(\s*\[mediapaused\]\s*\)\s+\.player-controls\s*{[^}]*opacity:\s*0 !important;[^}]*transition:\s*none !important;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-live-progress\s*{[^}]*pointer-events:\s*none;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-live-progress::before\s*{[^}]*width:\s*100%;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-controls media-play-button\[disabled\],\s*\.player-controls media-playback-rate-button\[disabled\]\s*{[^}]*pointer-events:\s*none;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-danmaku-inline\s*{[^}]*display:\s*inline-flex;[^}]*flex:\s*0 1 200px;[^}]*min-width:\s*132px;[^}]*max-width:\s*min\(20vw,\s*220px\);[^}]*gap:\s*0;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-danmaku-send\s*{[^}]*width:\s*28px;[^}]*border-left:\s*0;[^}]*border-radius:\s*0 999px 999px 0;[^}]*padding:\s*0;[^}]*}/s,
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

test("styles player loading indicator in the center chrome layer", () => {
  assert.match(
    styles,
    /\.player-loading-indicator\s*{[^}]*width:\s*54px;[^}]*height:\s*54px;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*opacity:\s*0;[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;[^}]*backdrop-filter:\s*none;[^}]*--media-loading-indicator-icon-width:\s*32px;[^}]*--media-loading-indicator-icon-height:\s*32px;[^}]*--media-loading-indicator-transition-delay:\s*200ms;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.player-loading-indicator\[medialoading\]:not\(\[mediapaused\]\)\s*{[^}]*opacity:\s*1;[^}]*visibility:\s*visible;[^}]*}/s,
  );
});

test("styles app fullscreen mode as player-only chrome", () => {
  assert.match(
    styles,
    /#web-room-fullscreen-root:fullscreen\s+#app\s*{[^}]*width:\s*100vw;[^}]*height:\s*100vh;[^}]*}/s,
  );
  assert.match(
    styles,
    /#web-room-fullscreen-root:fullscreen\s+\.web-room-workspace\s*{[^}]*width:\s*100vw;[^}]*height:\s*100vh;[^}]*padding:\s*0;[^}]*}/s,
  );
  assert.match(
    styles,
    /#web-room-fullscreen-root:fullscreen\s+\.announcement-strip,\s*#web-room-fullscreen-root:fullscreen\s+\.chat-panel,\s*#web-room-fullscreen-root:fullscreen\s+\.bottom-grid\s*{[^}]*display:\s*none;[^}]*}/s,
  );
  assert.match(
    styles,
    /#web-room-fullscreen-root:fullscreen\s+\.player-chat-grid\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);[^}]*height:\s*100vh;[^}]*}/s,
  );
  assert.match(
    styles,
    /#web-room-fullscreen-root:fullscreen\s+\.player-controls\s*{[^}]*right:\s*8px;[^}]*bottom:\s*6px;[^}]*left:\s*8px;[^}]*}/s,
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

test("styles settings header actions with bounded errors", () => {
  assert.match(
    styles,
    /\.settings-heading-actions\s*{[^}]*display:\s*inline-flex;[^}]*justify-content:\s*flex-end;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.settings-heading-action\s*{[^}]*min-height:\s*26px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.policy-row\s*{[^}]*align-items:\s*center;[^}]*justify-content:\s*space-between;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.policy-sync-strategy\s*{[^}]*display:\s*inline-flex;[^}]*flex:\s*1 1 220px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.policy-row\s+\.sync-strategy-options\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(84px,\s*auto\)\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.sync-strategy-button\.is-active\s*{[^}]*background:\s*#d7dee8;[^}]*color:\s*#111827;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.policy-options\s*{[^}]*display:\s*inline-flex;[^}]*justify-content:\s*flex-end;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.playback-error\s*{[^}]*display:\s*flex;[^}]*grid-column:\s*1 \/ -1;[^}]*align-items:\s*flex-start;[^}]*flex-wrap:\s*wrap;[^}]*font-size:\s*12px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.playback-error-stage\s*{[^}]*border-radius:\s*999px;[^}]*text-transform:\s*none;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.playback-error-message\s*{[^}]*flex:\s*1 1 220px;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.playback-error\s+\.secondary-button\s*{(?=[^}]*margin-left:\s*auto;)(?=[^}]*flex:\s*0 0 auto;)[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*?\.playback-error-message\s*{[^}]*flex-basis:\s*calc\(100% - 58px\);[^}]*}/,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*?\.playback-error\s+\.secondary-button\s*{[^}]*flex:\s*1 1 100%;[^}]*justify-content:\s*center;[^}]*margin-left:\s*0;[^}]*}/,
  );
  assert.match(
    styles,
    /\.policy-option\s*{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*}/s,
  );
  assert.match(styles, /\.settings-panel\s*{[^}]*overflow:\s*visible;[^}]*}/s);
  assert.match(styles, /\.policy-help\s*{[^}]*position:\s*relative;[^}]*}/s);
  assert.match(
    styles,
    /\.policy-help-trigger\s*{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.policy-help-trigger\s*{[^}]*border-color:\s*#58708e;[^}]*background:\s*rgba\(31,\s*41,\s*55,\s*0\.82\);[^}]*color:\s*#dbeafe;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.policy-help-body\s*{[^}]*position:\s*absolute;[^}]*right:\s*0;[^}]*visibility:\s*hidden;[^}]*opacity:\s*0;[^}]*pointer-events:\s*none;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.policy-help-body\s*{[^}]*border-color:\s*#58708e;[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.96\);[^}]*color:\s*#dbeafe;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.policy-help:hover\s+\.policy-help-body,\s*\.policy-help:focus-within\s+\.policy-help-body\s*{[^}]*visibility:\s*visible;[^}]*opacity:\s*1;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.authorization-modal-backdrop\s*{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*z-index:\s*30;[^}]*background:\s*rgba\(248,\s*250,\s*252,\s*0\.78\);[^}]*backdrop-filter:\s*blur\(2px\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.authorization-modal\s*{[^}]*width:\s*min\(520px,\s*calc\(100vw - 32px\)\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.authorization-modal-heading\s*{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;[^}]*align-items:\s*center;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.authorization-modal-close\s*{[^}]*width:\s*30px;[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.platform-auth-item\s*{[^}]*border-color:\s*#344256;[^}]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.42\);[^}]*}/s,
  );
  assert.match(
    styles,
    /\.web-room-shell\[data-theme-mode="dark"\]\s+\.auth-method-qr\s*{[^}]*border-top-color:\s*#344256;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.provider-url-row\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto auto;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.platform-logo-bilibili\s*{[^}]*background:\s*#00a1d6;[^}]*}/s,
  );
  assert.match(
    styles,
    /\.platform-logo-svg\s*{[^}]*width:\s*44px;[^}]*height:\s*22px;[^}]*stroke:\s*currentColor;[^}]*}/s,
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

test("keeps mobile player controls and chat composer visible", () => {
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.web-room-workspace\s*{[^}]*height:\s*auto;[^}]*max-height:\s*none;[^}]*overflow:\s*visible;[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.announcement-strip\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.announcement-brand\s*{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.announcement-text\s*{[^}]*grid-column:\s*1 \/ -1;[^}]*grid-row:\s*2;[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.theme-toggle-button\s*{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;[^}]*justify-self:\s*end;[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.player-chat-grid\s*{[^}]*grid-template-rows:\s*minmax\(170px,\s*42%\) minmax\(240px,\s*1fr\);[^}]*gap:\s*8px;[^}]*height:\s*min\(720px,\s*calc\(100vh - 62px\)\);[^}]*overflow:\s*hidden;[^}]*}/s,
  );
  assert.match(
    styles,
    /@supports\s*\(height:\s*100dvh\)\s*{[\s\S]*\.player-chat-grid\s*{[^}]*height:\s*min\(720px,\s*calc\(100dvh - 62px\)\);[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.player-panel\s*{[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.player-controls\s*{[^}]*right:\s*8px;[^}]*bottom:\s*6px;[^}]*left:\s*8px;[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.chat-panel\s*{[^}]*height:\s*auto;[^}]*min-height:\s*0;[^}]*max-height:\s*none;[^}]*}/s,
  );
  assert.match(
    styles,
    /@media\s*\(max-width:\s*820px\)\s*{[\s\S]*\.chat-list\s*{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;[^}]*}/s,
  );
});
