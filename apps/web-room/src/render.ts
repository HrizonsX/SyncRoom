import type {
  DanmakuMode,
  PlaybackState,
  ProviderPlaybackDescriptor,
  RoomMemberPermissionName,
  RoomMemberPermissions,
} from "@syncroom/protocol";
import { formatRoomJoinInvite } from "./actions.js";
import {
  getEffectiveMemberPermissions,
  isMemberPermissionAllowed,
} from "./member-permissions.js";
import type { PlaybackSource } from "./playback-adapter.js";
import type { WebRoomVoiceState } from "./voice-state.js";

export const JOINED_ROOM_REGION_ORDER = [
  "announcement",
  "player-chat",
  "room-info",
  "room-settings",
] as const;

export const NARROW_ROOM_REGION_ORDER = [
  "announcement",
  "player",
  "chat",
  "room-info",
  "room-settings",
] as const;

const WEB_ROOM_BRAND_NAME = "SyncRoom";
const WEB_ROOM_BRAND_SLOGAN = "同频观影，好友同声";

export type WebRoomThemeMode = "light" | "dark";

export type WebRoomMember = {
  id: string;
  name: string;
  permissions?: RoomMemberPermissions;
};

export type WebRoomSystemChatEventType =
  | "member_joined"
  | "member_left"
  | "voice_unmuted"
  | "voice_muted";

export type WebRoomChatMessage = {
  kind?: "user" | "system";
  systemEventType?: WebRoomSystemChatEventType;
  memberId: string;
  displayName: string;
  content: string;
  timestamp: number;
};

export type WebRoomDanmakuMessage = {
  renderKey?: string;
  memberId: string;
  displayName: string;
  content: string;
  videoTime: number;
  mode: DanmakuMode;
  color: string;
  timestamp: number;
};

export type WebRoomConnectionState =
  | "connected"
  | "connecting"
  | "disconnected";

export type WebRoomAuthStatus = "authorized" | "unauthorized" | "checking";
export type WebRoomAuthMethod = "qr";
export type WebRoomAuthPanelPhase =
  | "idle"
  | "loading"
  | "pending"
  | "authorized"
  | "failed"
  | "expired";

export type WebRoomAuthPanelState = {
  open: boolean;
  method: WebRoomAuthMethod;
  phase: WebRoomAuthPanelPhase;
  flowId?: string;
  message?: string;
  qrCodeUrl?: string;
  errorMessage?: string;
  profileName?: string;
  vipLabel?: string;
  expiresAt?: number;
};

export type WebRoomProviderPickerStatus =
  | "idle"
  | "loading"
  | "ready"
  | "failed";

export type WebRoomProviderPickerItem = {
  itemId: string;
  title: string;
  kind: "part" | "episode" | "live";
  qualityLabel?: string;
  sourceType?: string;
  durationSeconds?: number;
  providerDescriptor?: ProviderPlaybackDescriptor;
};

export type WebRoomProviderPickerState = {
  open: boolean;
  status: WebRoomProviderPickerStatus;
  url?: string;
  message?: string;
  errorMessage?: string;
  proxy: boolean;
  shared: boolean;
  items: WebRoomProviderPickerItem[];
  selectedItemId?: string;
  selectedQualityCandidateId?: string;
};

export type WebRoomProviderPlaybackStatus = {
  providerId: string;
  itemTitle?: string;
  sourceType?: string;
  proxy: boolean;
  shared: boolean;
};

export type WebRoomPlaybackErrorStage =
  | "manifest"
  | "segment"
  | "decode"
  | "network"
  | "unknown";

export type WebRoomPlaybackError = {
  code: "direct_playback_failed" | "unsupported_source";
  stage: WebRoomPlaybackErrorStage;
  message: string;
  canUseProxyFallback?: boolean;
};

export type WebRoomEntryState = {
  view: "entry";
  connectionState: WebRoomConnectionState;
  themeMode?: WebRoomThemeMode;
  serverUrl?: string;
  displayName?: string;
  roomInvite?: string;
  roomCode?: string;
  joinToken?: string;
  errorMessage?: string;
};

export type WebRoomJoinedState = {
  view: "joined";
  connectionState: WebRoomConnectionState;
  themeMode?: WebRoomThemeMode;
  roomCode: string;
  currentMemberId: string;
  hostMemberId: string;
  displayName: string;
  serverUrl?: string;
  joinToken?: string;
  announcement?: string;
  videoTitle?: string;
  authStatus: WebRoomAuthStatus;
  clockOffsetMs?: number | null;
  rttMs?: number | null;
  voice: WebRoomVoiceState;
  authPanel?: WebRoomAuthPanelState;
  providerPicker?: WebRoomProviderPickerState;
  providerPlaybackStatus?: WebRoomProviderPlaybackStatus;
  playbackSource?: PlaybackSource;
  playback?: PlaybackState;
  playbackUrl?: string;
  playbackError?: WebRoomPlaybackError;
  members: WebRoomMember[];
  chatMessages: WebRoomChatMessage[];
  danmakuMessages: WebRoomDanmakuMessage[];
  danmakuSequence?: number;
  chatCooldownUntil?: number;
  danmakuCooldownUntil?: number;
  diagnostics: string[];
};

export type WebRoomState = WebRoomEntryState | WebRoomJoinedState;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getCurrentMember(
  state: WebRoomJoinedState,
): WebRoomMember | undefined {
  return state.members.find((member) => member.id === state.currentMemberId);
}

function canCurrentMember(
  state: WebRoomJoinedState,
  permission: RoomMemberPermissionName,
): boolean {
  if (state.currentMemberId === state.hostMemberId) {
    return true;
  }
  return isMemberPermissionAllowed(getCurrentMember(state), permission);
}

function renderWebRoomBrand(className: string): string {
  const brandLabel = `${WEB_ROOM_BRAND_NAME} ${WEB_ROOM_BRAND_SLOGAN}`;

  return `
      <div class="${escapeHtml(className)} brand" aria-label="${escapeHtml(brandLabel)}">
        <span class="brand-mark" aria-hidden="true">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 21V9l9-7 9 7v12"></path>
            <path d="M9 21v-8h6v8"></path>
            <path d="M15 13h.01"></path>
          </svg>
        </span>
        <span class="announcement-brand-copy brand-copy">
          <strong class="brand-title">${WEB_ROOM_BRAND_NAME}</strong>
          <small class="brand-tagline">${WEB_ROOM_BRAND_SLOGAN}</small>
        </span>
      </div>
  `;
}

type UiIconName =
  | "nickname"
  | "invite"
  | "join"
  | "create"
  | "server"
  | "server-url"
  | "announcement"
  | "chat"
  | "room-info"
  | "settings"
  | "copy"
  | "leave"
  | "send"
  | "auth"
  | "qr"
  | "logout"
  | "parse"
  | "play"
  | "members"
  | "info"
  | "theme"
  | "close";

type EntryIconName = Extract<
  UiIconName,
  "nickname" | "invite" | "join" | "create" | "server" | "server-url"
>;

function renderIconSvg(
  name: UiIconName,
  className: string,
  dataAttribute: "data-entry-icon" | "data-ui-icon",
): string {
  const paths: Record<UiIconName, string> = {
    nickname: `
      <circle cx="12" cy="8" r="4"></circle>
      <path d="M4 21a8 8 0 0 1 16 0"></path>
    `,
    invite: `
      <path d="M10 13a5 5 0 0 0 7.07 0l2.12-2.12a5 5 0 0 0-7.07-7.07L11 4.93"></path>
      <path d="M14 11a5 5 0 0 0-7.07 0L4.81 13.12a5 5 0 0 0 7.07 7.07L13 19.07"></path>
    `,
    join: `
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
      <path d="M10 17l5-5-5-5"></path>
      <path d="M15 12H3"></path>
    `,
    create: `
      <rect x="4" y="4" width="16" height="16" rx="3"></rect>
      <path d="M12 8v8"></path>
      <path d="M8 12h8"></path>
    `,
    server: `
      <rect x="4" y="4" width="16" height="6" rx="2"></rect>
      <rect x="4" y="14" width="16" height="6" rx="2"></rect>
      <path d="M8 7h.01"></path>
      <path d="M8 17h.01"></path>
    `,
    "server-url": `
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M2 12h20"></path>
      <path d="M12 2a15 15 0 0 1 0 20"></path>
      <path d="M12 2a15 15 0 0 0 0 20"></path>
    `,
    announcement: `
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7"></path>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
    `,
    chat: `
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"></path>
    `,
    "room-info": `
      <path d="M3 21V9l9-7 9 7v12"></path>
      <path d="M9 21v-8h6v8"></path>
      <path d="M7 9h.01"></path>
      <path d="M17 9h.01"></path>
    `,
    settings: `
      <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"></path>
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.36a1.7 1.7 0 0 0-1 .24 1.7 1.7 0 0 0-.86 1.48V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8 19.43a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.64 15a1.7 1.7 0 0 0-.24-1 1.7 1.7 0 0 0-1.48-.86H2a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 3.57 8a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 3.64a1.7 1.7 0 0 0 1-.24A1.7 1.7 0 0 0 10.86 2V2a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 16 3.57a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 20.36 9c.14.32.22.66.24 1H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z"></path>
    `,
    copy: `
      <rect x="9" y="9" width="11" height="11" rx="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    `,
    leave: `
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
      <path d="M16 17l5-5-5-5"></path>
      <path d="M21 12H9"></path>
    `,
    send: `
      <path d="m22 2-7 20-4-9-9-4Z"></path>
      <path d="M22 2 11 13"></path>
    `,
    auth: `
      <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3Z"></path>
      <path d="M9 12l2 2 4-4"></path>
    `,
    qr: `
      <rect x="3" y="3" width="7" height="7" rx="1"></rect>
      <rect x="14" y="3" width="7" height="7" rx="1"></rect>
      <rect x="3" y="14" width="7" height="7" rx="1"></rect>
      <path d="M14 14h3v3"></path>
      <path d="M21 14v7h-7"></path>
    `,
    logout: `
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
      <path d="M16 17l5-5-5-5"></path>
      <path d="M21 12H9"></path>
    `,
    parse: `
      <path d="M4 5h16"></path>
      <path d="M4 12h10"></path>
      <path d="M4 19h7"></path>
      <path d="m17 16 3 3-3 3"></path>
    `,
    play: `
      <circle cx="12" cy="12" r="10"></circle>
      <path d="m10 8 6 4-6 4Z"></path>
    `,
    members: `
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
      <circle cx="9" cy="7" r="4"></circle>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    `,
    info: `
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M12 16v-4"></path>
      <path d="M12 8h.01"></path>
    `,
    theme: `
      <path d="M12 3a6 6 0 0 0 9 7.5A8 8 0 1 1 12 3Z"></path>
    `,
    close: `
      <path d="M18 6 6 18"></path>
      <path d="m6 6 12 12"></path>
    `,
  };

  return `
    <svg class="${escapeHtml(className)}" ${dataAttribute}="${escapeHtml(name)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false">
      ${paths[name]}
    </svg>
  `;
}

function renderEntryIcon(name: EntryIconName, className: string): string {
  return renderIconSvg(name, className, "data-entry-icon");
}

function renderUiIcon(name: UiIconName, className: string): string {
  return renderIconSvg(name, className, "data-ui-icon");
}

function renderEntryLabelText(label: string, icon: EntryIconName): string {
  return `
    <span class="entry-label-text">
      ${renderEntryIcon(icon, "entry-label-icon")}
      <span>${escapeHtml(label)}</span>
    </span>
  `;
}

function renderEntryButtonText(label: string, icon: EntryIconName): string {
  return `
    ${renderEntryIcon(icon, "entry-button-icon")}
    <span>${escapeHtml(label)}</span>
  `;
}

function renderPanelTitle(label: string, icon: UiIconName): string {
  return `<span class="panel-title">${renderUiIcon(icon, "panel-title-icon")}<span>${escapeHtml(label)}</span></span>`;
}

function renderSummaryLabel(label: string, icon: UiIconName): string {
  return `<span class="summary-label">${renderUiIcon(icon, "summary-icon")}<span>${escapeHtml(label)}</span></span>`;
}

function renderSettingsHeadingLabel(label: string, icon: UiIconName): string {
  return `<span class="settings-heading-label">${renderUiIcon(icon, "settings-heading-icon")}<span>${escapeHtml(label)}</span></span>`;
}

function renderButtonText(label: string, icon: UiIconName): string {
  return `${renderUiIcon(icon, "button-icon")}<span>${escapeHtml(label)}</span>`;
}

function getThemeMode(state: WebRoomState): WebRoomThemeMode {
  return state.themeMode === "dark" ? "dark" : "light";
}

function renderThemeToggle(themeMode: WebRoomThemeMode): string {
  const isDark = themeMode === "dark";
  const label = isDark ? "白天模式" : "黑夜模式";
  return `
      <button type="button" class="secondary-button theme-toggle-button" data-action="toggle-theme-mode" aria-pressed="${isDark}" title="${escapeHtml(label)}">
        ${renderButtonText(label, "theme")}
      </button>
  `;
}

function renderAnnouncementStrip(state: WebRoomJoinedState): string {
  const announcement = state.announcement || "暂无公告";
  const themeMode = getThemeMode(state);
  return `
    <section class="announcement-strip" data-region="announcement">
      ${renderWebRoomBrand("announcement-brand")}
      <span class="announcement-message">
        ${renderUiIcon("announcement", "announcement-icon")}
        <span class="announcement-text">${escapeHtml(announcement)}</span>
      </span>
      ${renderThemeToggle(themeMode)}
    </section>
  `;
}

function getSafeDanmakuColor(value: string): string {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : "#ffffff";
}

function getDanmakuMessageKey(message: WebRoomDanmakuMessage): string {
  if (message.renderKey?.trim()) {
    return message.renderKey;
  }

  return [
    message.memberId,
    message.timestamp,
    message.videoTime,
    message.mode,
    message.content,
  ].join(":");
}

const DANMAKU_SCROLL_LANE_COUNT = 4;
const DANMAKU_SCROLL_LANE_GAP_PX = 22;
const DANMAKU_SCROLL_DURATION_MS = 9_000;
const DANMAKU_HOLD_DURATION_MS = 4_500;

function getDanmakuLaneYOffset(index: number): string {
  return `${(index % DANMAKU_SCROLL_LANE_COUNT) * DANMAKU_SCROLL_LANE_GAP_PX}px`;
}

function getDanmakuAnimationDurationMs(mode: DanmakuMode): number {
  return mode === "top" || mode === "bottom"
    ? DANMAKU_HOLD_DURATION_MS
    : DANMAKU_SCROLL_DURATION_MS;
}

function getDanmakuMessageAgeMs(
  message: WebRoomDanmakuMessage,
  renderedAt: number,
): number {
  return Math.max(0, renderedAt - message.timestamp);
}

function renderDanmakuLayer(state: WebRoomJoinedState): string {
  const renderedAt = Date.now();
  const messages = state.danmakuMessages.slice(-80).filter((message) => {
    const mode =
      message.mode === "top" || message.mode === "bottom"
        ? message.mode
        : "scroll";
    return (
      getDanmakuMessageAgeMs(message, renderedAt) <
      getDanmakuAnimationDurationMs(mode)
    );
  });
  const paused = state.playback?.playState === "paused" ? "true" : "false";
  const items = messages
    .map((message, index) => {
      const mode =
        message.mode === "top" || message.mode === "bottom"
          ? message.mode
          : "scroll";
      const laneY = getDanmakuLaneYOffset(index);
      const progressDelay = `-${getDanmakuMessageAgeMs(message, renderedAt)}ms`;
      return `
              <span
                class="danmaku-item is-${mode}"
                data-danmaku-key="${escapeHtml(getDanmakuMessageKey(message))}"
                data-danmaku-video-time="${message.videoTime}"
                style="--danmaku-lane-y: ${laneY}; --danmaku-progress-delay: ${progressDelay}; color: ${escapeHtml(getSafeDanmakuColor(message.color))};"
              >${escapeHtml(message.content)}</span>
      `;
    })
    .join("");
  return `<div class="danmaku-layer" data-danmaku-layer="true" data-danmaku-paused="${paused}" noautohide aria-hidden="true">${items}</div>`;
}

function renderConnectionState(state: WebRoomConnectionState): string {
  const label = {
    connected: "已连接",
    connecting: "连接中",
    disconnected: "未连接",
  }[state];
  return `<span class="status-pill is-${state}" data-connection-state="${state}">${label}</span>`;
}

function renderPlaybackVideo(source: PlaybackSource | undefined): string {
  const sourceAttributes = source
    ? `
                data-source-url="${escapeHtml(source.url)}"
                data-source-type="${escapeHtml(source.sourceType)}"
                data-playback-engine="${escapeHtml(source.engine)}"`
    : "";

  return `
              <video
                slot="media"
                class="player-video"
                data-playback-video="true"${sourceAttributes}
                playsinline
                preload="metadata"
              ></video>
  `;
}

function renderPlayerDanmakuInlineControls(canSendDanmaku: boolean): string {
  const disabled = canSendDanmaku ? "" : " disabled";
  return `
                <div class="player-danmaku-inline" data-player-danmaku-controls="inline">
                  <input
                    class="player-danmaku-input"
                    data-player-danmaku-input="true"
                    name="playerDanmaku"
                    maxlength="120"
                    autocomplete="off"
                    ${disabled}
                    placeholder="发弹幕"
                    aria-label="发送弹幕"
                  />
                  ${renderPlayerDanmakuSendButton(canSendDanmaku)}
                </div>
                <button
                  type="button"
                  class="player-danmaku-toggle"
                  data-action="toggle-player-danmaku"
                  ${disabled}
                  aria-label="发弹幕"
                  aria-controls="player-danmaku-panel"
                  aria-expanded="false"
                >弹幕</button>
  `;
}

function renderPlayerDanmakuSendButton(canSendDanmaku: boolean): string {
  const disabled = canSendDanmaku ? "" : " disabled";
  return `
                  <button
                    type="button"
                    class="player-danmaku-send"
                    data-action="send-player-danmaku"
                    ${disabled}
                    aria-label="发送弹幕"
                  >
                    <svg class="player-danmaku-send-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="m22 2-7 20-4-9-9-4Z"></path>
                      <path d="M22 2 11 13"></path>
                    </svg>
                    <span class="visually-hidden">发送弹幕</span>
                  </button>
  `;
}

function renderPlayerVideoTitle(title: string | undefined): string {
  const normalizedTitle = title?.trim();
  if (!normalizedTitle) {
    return "";
  }

  return `
              <span slot="top-chrome" class="player-video-title" data-player-video-title="true" title="${escapeHtml(normalizedTitle)}">${escapeHtml(normalizedTitle)}</span>
  `;
}

function renderPlayerDanmakuPopover(canSendDanmaku: boolean): string {
  const disabled = canSendDanmaku ? "" : " disabled";
  return `
              <div
                id="player-danmaku-panel"
                class="player-danmaku-popover"
                data-player-danmaku-controls="popover"
                role="group"
                aria-label="发送弹幕"
              >
                <input
                  class="player-danmaku-input"
                  data-player-danmaku-input="true"
                  name="playerDanmaku"
                  maxlength="120"
                  autocomplete="off"
                  ${disabled}
                  placeholder="发弹幕"
                  aria-label="发送弹幕"
                />
                ${renderPlayerDanmakuSendButton(canSendDanmaku)}
              </div>
  `;
}

function renderPlayerVolumeControl(): string {
  return `
                <div class="player-volume-control">
                  <media-mute-button notooltip aria-label="音量"></media-mute-button>
                  <div class="player-volume-popover" aria-label="音量">
                    <div class="player-volume-range-frame">
                      <media-volume-range></media-volume-range>
                    </div>
                  </div>
                </div>
  `;
}

function renderPlayerTimePair(): string {
  return `
                <span class="player-time-pair" aria-label="当前播放时长 / 视频总时长">
                  <media-time-display notoggle></media-time-display>
                  <span class="player-time-separator" aria-hidden="true">/</span>
                  <media-duration-display></media-duration-display>
                </span>
  `;
}

function renderPlayerProgressControl(
  source: PlaybackSource | undefined,
  timeRangeDisabled: string,
): string {
  if (source?.isLive) {
    return `<div class="player-live-progress" data-player-live-progress="true" aria-label="直播进度"></div>`;
  }
  return `<media-time-range${timeRangeDisabled}></media-time-range>`;
}

function renderPlayerSurface(state: WebRoomJoinedState): string {
  const isEmpty = state.playbackSource ? "false" : "true";
  const hasPlaybackSource = Boolean(state.playbackSource);
  const isLivePlayback = state.playbackSource?.isLive === true;
  const canControlPlayback =
    hasPlaybackSource && canCurrentMember(state, "playbackControl");
  const danmakuCooldownRemainingMs =
    typeof state.danmakuCooldownUntil === "number"
      ? state.danmakuCooldownUntil - Date.now()
      : 0;
  const danmakuCoolingDown =
    typeof state.danmakuCooldownUntil === "number" &&
    danmakuCooldownRemainingMs > 0;
  const danmakuCooldownSeconds = danmakuCoolingDown
    ? Math.max(1, Math.ceil(danmakuCooldownRemainingMs / 1000))
    : 0;
  const canSendDanmaku =
    canCurrentMember(state, "danmaku") && !danmakuCoolingDown;
  const playerDisabled = canControlPlayback ? "" : " disabled";
  const timeRangeDisabled = canControlPlayback ? "" : " disabled";
  return `
            <media-controller class="player-media-controller" fullscreenelement="app" data-player-empty="${isEmpty}" data-player-live="${isLivePlayback ? "true" : "false"}" data-danmaku-cooldown="${danmakuCoolingDown ? "true" : "false"}" data-danmaku-cooldown-seconds="${danmakuCooldownSeconds}">
              ${renderPlaybackVideo(state.playbackSource)}
              ${renderDanmakuLayer(state)}
              ${renderPlayerVideoTitle(state.videoTitle)}
              ${renderPlayerDanmakuPopover(canSendDanmaku)}
              <media-control-bar class="player-controls">
                <media-play-button notooltip${playerDisabled}></media-play-button>
                ${renderPlayerProgressControl(state.playbackSource, timeRangeDisabled)}
                ${renderPlayerTimePair()}
                ${renderPlayerDanmakuInlineControls(canSendDanmaku)}
                ${renderPlayerVolumeControl()}
                <media-playback-rate-button notooltip${playerDisabled}></media-playback-rate-button>
                <media-pip-button notooltip></media-pip-button>
                <media-fullscreen-button notooltip></media-fullscreen-button>
              </media-control-bar>
            </media-controller>
    `;
}

function getEntryRoomInviteValue(state: WebRoomEntryState): string {
  if (state.roomInvite) {
    return state.roomInvite;
  }
  if (state.roomCode && state.joinToken) {
    return formatRoomJoinInvite({
      roomCode: state.roomCode,
      joinToken: state.joinToken,
    });
  }
  return [state.roomCode, state.joinToken].filter(Boolean).join(" ");
}

function renderEntry(state: WebRoomEntryState): string {
  const themeMode = getThemeMode(state);
  const buttonsDisabled =
    state.connectionState === "connecting" ? " disabled" : "";
  const error = state.errorMessage
    ? `<div class="entry-error" role="alert">${escapeHtml(state.errorMessage)}</div>`
    : "";
  const roomInvite = getEntryRoomInviteValue(state);

  return `
    <main class="web-room-shell web-room-entry" data-region="entry" data-theme-mode="${themeMode}">
      <section class="entry-panel">
        <div class="entry-header">
          <div class="entry-heading">
            <h1 class="visually-hidden">SyncRoom 网页房间</h1>
            ${renderWebRoomBrand("entry-brand announcement-brand")}
            <p>创建或加入房间后直接进入同步观影工作台。</p>
          </div>
          <label class="entry-field entry-name-field">
            ${renderEntryLabelText("昵称", "nickname")}
            <input name="displayName" autocomplete="nickname" maxlength="32" value="${escapeHtml(state.displayName ?? "")}" />
          </label>
        </div>
        <div class="entry-actions">
          <div class="entry-room-action-row">
            <label class="join-field entry-invite-field">
              ${renderEntryLabelText("房间邀请", "invite")}
              <input name="roomInvite" autocomplete="off" value="${escapeHtml(roomInvite)}" placeholder="粘贴房间号和口令" />
            </label>
            <button type="button" class="secondary-button" data-action="join-room"${buttonsDisabled}>${renderEntryButtonText("加入房间", "join")}</button>
            <button type="button" class="primary-button" data-action="create-room"${buttonsDisabled}>${renderEntryButtonText("创建房间", "create")}</button>
          </div>
          <details class="entry-server-settings">
            <summary>${renderEntryLabelText("服务器设置", "server")}</summary>
            <label class="entry-field entry-server-field">
              ${renderEntryLabelText("服务器地址", "server-url")}
              <input name="serverUrl" autocomplete="url" value="${escapeHtml(state.serverUrl ?? "")}" />
            </label>
          </details>
        </div>
        ${error}
      </section>
    </main>
  `;
}

function renderAuthorizationManagementHeaderAction(
  state: WebRoomJoinedState,
): string {
  const isHost = state.currentMemberId === state.hostMemberId;
  if (!isHost) {
    return "";
  }

  return `
    <span class="settings-heading-actions">
      <button type="button" class="secondary-button settings-heading-action" data-action="authorization-management">${renderButtonText("管理已授权平台", "auth")}</button>
    </span>
  `;
}

function renderBilibiliLogo(): string {
  return `
    <span class="platform-logo platform-logo-bilibili">
      <svg class="platform-logo-svg" viewBox="0 0 64 32" role="img" aria-label="Bilibili 官方 Logo" focusable="false">
        <rect x="8" y="8" width="48" height="20" rx="6"></rect>
        <path d="M22 8 17 3"></path>
        <path d="M42 8 47 3"></path>
        <path d="M24 18h.01"></path>
        <path d="M40 18h.01"></path>
        <path d="M29 23h6"></path>
      </svg>
    </span>
  `;
}

function localizeProviderAuthMessage(message: string): string {
  switch (message) {
    case "Bilibili QR authorization request is pending.":
      return "正在请求 B 站二维码授权。";
    case "Preparing QR login.":
      return "正在准备二维码登录。";
    case "Scan the Bilibili QR code.":
    case "Scan the Bilibili QR code to authorize playback.":
      return "请使用 B 站 App 扫描二维码。";
    case "Waiting for scan.":
      return "等待扫码。";
    case "QR code scanned; waiting for confirmation.":
      return "已扫码，请在手机上确认。";
    case "QR code expired.":
      return "二维码已过期，请重新授权。";
    case "QR authorization failed.":
      return "二维码授权失败，请重试。";
    case "Bilibili authorization could not be verified.":
      return "B 站授权未通过验证。";
    case "Bilibili authorization check failed.":
      return "B 站授权状态检查失败。";
    case "Bilibili authorization failed.":
      return "B 站授权失败，请重试。";
    case "Bilibili authorization logout is pending.":
      return "正在退出 B 站授权。";
    case "Bilibili authorization cleared.":
      return "B 站授权已清除。";
    case "Bilibili authorization logout failed.":
      return "B 站授权退出失败。";
    default:
      return message;
  }
}

function renderProviderAuthPanel(state: WebRoomJoinedState): string {
  const isHost = state.currentMemberId === state.hostMemberId;
  const panel = state.authPanel ?? {
    open: false,
    method: "qr" as const,
    phase: state.authStatus === "authorized" ? "authorized" : "idle",
  };
  if (!panel.open) {
    return "";
  }
  const profileSummary = [panel.profileName, panel.vipLabel]
    .filter((item): item is string => Boolean(item))
    .join(" - ");
  const rawMessage =
    panel.errorMessage ??
    panel.message ??
    (profileSummary || (isHost ? "Bilibili" : "房主可管理"));
  const message = localizeProviderAuthMessage(rawMessage);
  const qrCode = panel.qrCodeUrl
    ? `<img class="auth-qr" src="${escapeHtml(panel.qrCodeUrl)}" alt="Bilibili QR" />`
    : '<div class="auth-qr-placeholder">QR</div>';
  const shouldShowQrMethod =
    panel.phase === "loading" ||
    panel.phase === "pending" ||
    Boolean(panel.qrCodeUrl) ||
    state.authStatus === "checking";
  const platformAuthAction = shouldShowQrMethod
    ? ""
    : `<button type="button" class="secondary-button platform-auth-action" data-action="bilibili-login-qr">${renderButtonText("授权", "auth")}</button>`;
  const authMethod = shouldShowQrMethod
    ? `
          <div class="auth-method auth-method-qr">
            ${qrCode}
            <button type="button" class="secondary-button" data-action="collapse-bilibili-auth">${renderButtonText("收起二维码", "qr")}</button>
          </div>
        `
    : "";

  if (!isHost) {
    return `
      <section class="provider-auth-panel" data-panel="provider-auth" data-auth-host="false" data-auth-phase="${panel.phase}">
        <div class="settings-tile-heading">
          <span>Bilibili 授权</span>
          <small>${escapeHtml(message)}</small>
        </div>
        <div class="auth-readonly-status">${escapeHtml(state.authStatus)}</div>
      </section>
    `;
  }

  return `
    <div class="authorization-modal-backdrop" data-modal="authorization-management">
      <section class="authorization-modal provider-auth-panel" data-panel="provider-auth" data-auth-host="true" data-auth-method="${panel.method}" data-auth-phase="${panel.phase}" data-platform-auth-list="true" role="dialog" aria-modal="true" aria-label="授权管理">
      <div class="authorization-modal-heading">
        <div class="settings-tile-heading">
          <span>授权管理</span>
          <small>平台账号授权</small>
        </div>
        <button type="button" class="icon-button authorization-modal-close" data-action="close-authorization-management" aria-label="关闭授权管理">
          ${renderUiIcon("close", "button-icon")}
          <span class="visually-hidden">关闭授权管理</span>
        </button>
      </div>
      <div class="platform-auth-list">
        <section class="platform-auth-item" data-platform-id="bilibili">
          ${renderBilibiliLogo()}
          <div class="platform-auth-copy">
            <strong>B 站</strong>
            <small>${escapeHtml(message)}</small>
          </div>
          ${platformAuthAction}
          ${authMethod}
        </section>
      </div>
      </section>
    </div>
  `;
}

function renderProviderPickerItems(picker: WebRoomProviderPickerState): string {
  if (picker.items.length === 0) {
    return '<div class="empty-state">暂无解析结果</div>';
  }

  return picker.items
    .map((item) => {
      const selected = item.itemId === picker.selectedItemId;
      const title = item.providerDescriptor?.title.trim() || item.title;
      const selectedCandidate = selected
        ? getProviderPickerSelectedCandidate(picker, item)
        : undefined;
      const meta = [
        item.kind,
        selectedCandidate?.qualityLabel ?? item.qualityLabel,
        selectedCandidate?.sourceType ?? item.sourceType,
      ]
        .filter(Boolean)
        .join(" / ");
      return `
        <button type="button" class="provider-item-row" data-action="select-provider-item" data-item-id="${escapeHtml(item.itemId)}" data-item-selected="${selected}">
          <span>${escapeHtml(title)}</span>
          <small>${escapeHtml(meta)}</small>
        </button>
      `;
    })
    .join("");
}

function getProviderPickerSelectedItem(
  picker: WebRoomProviderPickerState,
): WebRoomProviderPickerItem | undefined {
  return picker.items.find((item) => item.itemId === picker.selectedItemId);
}

function getProviderPickerSelectedCandidate(
  picker: WebRoomProviderPickerState,
  item: WebRoomProviderPickerItem,
): ProviderPlaybackDescriptor["candidates"][number] | undefined {
  const descriptor = item.providerDescriptor;
  if (!descriptor) {
    return undefined;
  }
  const selectedCandidateId = getSelectedQualityCandidateId(picker, descriptor);
  return descriptor.candidates.find(
    (candidate) => candidate.id === selectedCandidateId,
  );
}

function getProviderCandidateLabel(
  candidate: ProviderPlaybackDescriptor["candidates"][number],
): string {
  return (
    [candidate.qualityLabel, candidate.sourceType]
      .filter(Boolean)
      .join(" / ") || candidate.id
  );
}

function getSelectedQualityCandidateId(
  picker: WebRoomProviderPickerState,
  descriptor: ProviderPlaybackDescriptor,
): string | undefined {
  if (
    picker.selectedQualityCandidateId &&
    descriptor.candidates.some(
      (candidate) => candidate.id === picker.selectedQualityCandidateId,
    )
  ) {
    return picker.selectedQualityCandidateId;
  }
  return (
    descriptor.defaultCandidateId ??
    descriptor.candidates.find((candidate) => candidate.default === true)?.id ??
    descriptor.candidates[0]?.id
  );
}

function renderProviderQualityOptions(
  picker: WebRoomProviderPickerState,
): string {
  const descriptor = getProviderPickerSelectedItem(picker)?.providerDescriptor;
  if (!descriptor || descriptor.candidates.length === 0) {
    return "";
  }
  const selectedCandidateId = getSelectedQualityCandidateId(picker, descriptor);
  const options = descriptor.candidates
    .map((candidate) => {
      const selected = candidate.id === selectedCandidateId;
      return `
        <button type="button" class="provider-quality-row" data-action="select-provider-quality" data-candidate-id="${escapeHtml(candidate.id)}" data-quality-selected="${selected}">
          <span>${escapeHtml(getProviderCandidateLabel(candidate))}</span>
        </button>
      `;
    })
    .join("");
  return `
    <div class="provider-quality-list" data-provider-quality-list="true">
      <div class="settings-tile-heading">
        <span>播放画质</span>
        <small>开始播放前选择</small>
      </div>
      <div class="provider-quality-options">${options}</div>
    </div>
  `;
}

function renderPolicyHelp(policy: "proxy" | "shared"): string {
  const message =
    policy === "proxy"
      ? "通过服务器代理加载播放清单和分片，用于跨域、鉴权或会员播放场景。"
      : "把解析后的播放源同步给房间成员，成员加入后会沿用同一播放源。";

  return `
    <span class="policy-help" data-policy-help="${policy}">
      <span class="policy-help-trigger" aria-label="${policy} 说明" tabindex="0">!</span>
      <span class="policy-help-body" role="tooltip">${escapeHtml(message)}</span>
    </span>
  `;
}

function renderProviderPickerPanel(state: WebRoomJoinedState): string {
  const isHost = state.currentMemberId === state.hostMemberId;
  const picker = state.providerPicker ?? {
    open: false,
    status: "idle" as const,
    proxy: true,
    shared: true,
    items: [],
  };
  const proxyChecked = picker.proxy ? " checked" : "";
  const sharedChecked = picker.shared ? " checked" : "";
  const messageHtml = picker.errorMessage
    ? `<small>${escapeHtml(picker.errorMessage)}</small>`
    : "";
  const shareDisabled = picker.selectedItemId ? "" : " disabled";

  if (!isHost) {
    return `
      <section class="provider-picker-panel" data-panel="host-picker" data-picker-host="false" data-picker-status="${picker.status}">
        <div class="settings-tile-heading">
          ${renderSettingsHeadingLabel("点播解析", "parse")}
          <small>房主可管理</small>
        </div>
      </section>
    `;
  }

  return `
    <section class="provider-picker-panel" data-panel="host-picker" data-picker-host="true" data-picker-status="${picker.status}">
      <div class="settings-tile-heading">
        ${renderSettingsHeadingLabel("点播解析", "parse")}
        ${messageHtml}
      </div>
      <div class="provider-url-row">
        <input name="bilibiliUrl" autocomplete="url" placeholder="粘贴视频链接" value="${escapeHtml(picker.url ?? "")}" />
        <button type="button" class="secondary-button" data-action="parse-bilibili-url">${renderButtonText("解析", "parse")}</button>
        <button type="button" class="primary-button" data-action="share-provider-item"${shareDisabled}>${renderButtonText("开始播放", "play")}</button>
      </div>
      <div class="policy-row">
        <span class="policy-option">
          <label><input name="providerProxy"${proxyChecked} type="checkbox" />proxy</label>
          ${renderPolicyHelp("proxy")}
        </span>
        <span class="policy-option">
          <label><input name="providerShared"${sharedChecked} type="checkbox" />shared</label>
          ${renderPolicyHelp("shared")}
        </span>
      </div>
      <div class="provider-result-list">${renderProviderPickerItems(picker)}</div>
      ${renderProviderQualityOptions(picker)}
    </section>
  `;
}

function renderMemberPermissionAction(
  member: WebRoomMember,
  permission: RoomMemberPermissionName,
  labels: { allow: string; deny: string },
): string {
  const allowed = getEffectiveMemberPermissions(member)[permission];
  return `
          <button
            type="button"
            class="member-action-button"
            data-action="set-member-permission"
            data-member-id="${escapeHtml(member.id)}"
            data-member-permission="${permission}"
            data-member-permission-allowed="${allowed ? "false" : "true"}"
          >${escapeHtml(allowed ? labels.deny : labels.allow)}</button>
  `;
}

function renderMemberManagementActions(
  state: WebRoomJoinedState,
  member: WebRoomMember,
): string {
  if (
    state.currentMemberId !== state.hostMemberId ||
    member.id === state.currentMemberId
  ) {
    return "";
  }

  return `
        <span class="member-actions">
          ${renderMemberPermissionAction(member, "voice", {
            deny: "禁麦",
            allow: "开麦",
          })}
          ${renderMemberPermissionAction(member, "playbackControl", {
            deny: "禁视频",
            allow: "开视频",
          })}
          ${renderMemberPermissionAction(member, "chat", {
            deny: "禁聊天",
            allow: "开聊天",
          })}
          ${renderMemberPermissionAction(member, "danmaku", {
            deny: "禁弹幕",
            allow: "开弹幕",
          })}
          <button type="button" class="member-action-button" data-action="transfer-host" data-member-id="${escapeHtml(member.id)}">转让</button>
          <button type="button" class="member-action-button is-danger" data-action="kick-member" data-member-id="${escapeHtml(member.id)}">踢出</button>
        </span>
  `;
}

function renderMembers(state: WebRoomJoinedState): string {
  return state.members
    .map((member) => {
      const hostBadge =
        member.id === state.hostMemberId
          ? '<span class="mini-badge">房主</span>'
          : "";
      const selfBadge =
        member.id === state.currentMemberId
          ? '<span class="mini-badge">我</span>'
          : "";
      return `
        <li class="member-row">
          <span class="avatar">${escapeHtml(member.name.slice(0, 1) || "?")}</span>
          <span class="member-main">
            <span class="member-identity">
              <span class="member-name">${escapeHtml(member.name)}</span>
              <span class="member-badges">${hostBadge}${selfBadge}</span>
            </span>
            ${renderMemberManagementActions(state, member)}
          </span>
        </li>
      `;
    })
    .join("");
}

function getPlaybackStatusLabel(state: WebRoomJoinedState): string {
  switch (state.playback?.playState) {
    case "playing":
      return "播放中";
    case "paused":
      return "已暂停";
    case "buffering":
      return "缓冲中";
    default:
      return state.playbackSource ? "待播放" : "未开始";
  }
}

function getPlaybackSourceLabel(state: WebRoomJoinedState): string {
  if (state.providerPlaybackStatus) {
    return [
      state.providerPlaybackStatus.providerId,
      state.providerPlaybackStatus.sourceType,
      state.providerPlaybackStatus.proxy ? "proxy" : "direct",
      state.providerPlaybackStatus.shared ? "shared" : "local",
    ]
      .filter(Boolean)
      .join(" / ");
  }

  if (state.playbackSource) {
    return [state.playbackSource.engine, state.playbackSource.sourceType]
      .filter(Boolean)
      .join(" / ");
  }

  return "未选择";
}

function renderRoomVideoInfo(state: WebRoomJoinedState): string {
  const title = state.videoTitle?.trim() || "-";

  return `
          <dl class="room-video-info" data-panel="room-video-info">
            <dt>视频标题</dt><dd>${escapeHtml(title)}</dd>
            <dt>播放源</dt><dd>${escapeHtml(getPlaybackSourceLabel(state))}</dd>
            <dt>播放状态</dt><dd>${escapeHtml(getPlaybackStatusLabel(state))}</dd>
          </dl>
  `;
}

function formatClockMetricValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value}ms`
    : "-";
}

function formatClockMetricDataValue(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : "";
}

function renderChatMessages(state: WebRoomJoinedState): string {
  if (state.chatMessages.length === 0) {
    return '<div class="empty-state chat-empty-state">还没有聊天消息</div>';
  }

  return state.chatMessages
    .map((message) => {
      const timestamp = new Date(message.timestamp).toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      if (message.kind === "system") {
        return `
        <article class="chat-system-message" data-chat-author="system" data-chat-system-event="${escapeHtml(message.systemEventType ?? "system")}">
          <time datetime="${message.timestamp}">${timestamp}</time>
          <span>${escapeHtml(message.content)}</span>
        </article>
      `;
      }

      const author =
        message.memberId === state.currentMemberId ? "self" : "other";

      return `
        <article class="chat-message is-${author}" data-chat-author="${author}">
          <div class="chat-meta">
            <span>${escapeHtml(message.displayName)}</span>
            <time datetime="${message.timestamp}">${timestamp}</time>
          </div>
          <p>${escapeHtml(message.content)}</p>
        </article>
      `;
    })
    .join("");
}

function getVoiceActionLabel(voice: WebRoomVoiceState): string {
  if (voice.status === "connected") {
    return voice.muted ? "开麦" : "静音";
  }
  if (voice.status === "requesting" || voice.status === "connecting") {
    return "连接中";
  }
  if (voice.status === "failed" || voice.status === "unavailable") {
    return "重试语音";
  }
  return "加入语音";
}

function renderVoiceToggleButton(
  voice: WebRoomVoiceState,
  canUseVoice: boolean,
): string {
  const isBusy = voice.status === "requesting" || voice.status === "connecting";
  const disabled = isBusy || !canUseVoice ? " disabled" : "";
  const label = getVoiceActionLabel(voice);

  return `
    <button
      type="button"
      class="secondary-button voice-toggle-button"
      data-action="voice-toggle"
      data-voice-status="${voice.status}"
      data-voice-muted="${voice.muted}"
      aria-label="${escapeHtml(label)}"
      title="${escapeHtml(label)}"
      ${disabled}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
        <path d="M12 19v3"></path>
      </svg>
    </button>
  `;
}

function getVoiceMemberStatus(
  participant: WebRoomVoiceState["participants"][string] | undefined,
): "offline" | "muted" | "speaking" | "unmuted" {
  if (!participant?.connected) {
    return "offline";
  }
  if (participant.speaking) {
    return "speaking";
  }
  return participant.muted ? "muted" : "unmuted";
}

function getVoiceMemberLabel(
  status: ReturnType<typeof getVoiceMemberStatus>,
): string {
  switch (status) {
    case "speaking":
      return "发言中";
    case "unmuted":
      return "开麦";
    case "muted":
      return "静音";
    case "offline":
    default:
      return "未加入";
  }
}

function renderVoiceMembers(state: WebRoomJoinedState): string {
  return state.members
    .map((member) => {
      const participant = state.voice.participants[member.id];
      const status = getVoiceMemberStatus(participant);
      const label = `${member.name} ${getVoiceMemberLabel(status)}`;
      return `
        <span class="voice-member" data-voice-member-id="${escapeHtml(member.id)}" data-voice-member-status="${status}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
          <span class="voice-member-avatar" aria-hidden="true">${escapeHtml(member.name.slice(0, 1) || "?")}</span>
        </span>
      `;
    })
    .join("");
}

function renderChatVoicePanel(state: WebRoomJoinedState): string {
  const voice = state.voice;
  const error = voice.error
    ? `<div class="voice-error" role="alert">${escapeHtml(voice.error)}</div>`
    : "";

  return `
    <section class="chat-voice-panel" data-panel="voice" data-voice-status="${voice.status}" data-voice-muted="${voice.muted}">
      <div class="voice-summary">
        ${renderUiIcon("members", "voice-summary-icon")}
        <strong>在线成员</strong>
        <small class="voice-member-count">${state.members.length}</small>
      </div>
      ${error}
      <div class="voice-members">${renderVoiceMembers(state)}</div>
    </section>
  `;
}

function renderDiagnostics(state: WebRoomJoinedState): string {
  if (state.diagnostics.length === 0) {
    return '<div class="empty-state">暂无日志</div>';
  }

  return state.diagnostics
    .map((item) => `<div class="log-line">${escapeHtml(item)}</div>`)
    .join("");
}

function renderPlaybackError(state: WebRoomJoinedState): string {
  const error = state.playbackError;
  if (!error) {
    return "";
  }

  const canUseFallback =
    error.canUseProxyFallback && state.currentMemberId === state.hostMemberId;
  const fallbackButton = canUseFallback
    ? `<button type="button" class="secondary-button" data-action="retry-provider-proxy">${renderButtonText("切回 proxy", "parse")}</button>`
    : "";

  return `
    <div class="playback-error" role="alert" data-panel="playback-error" data-playback-error-stage="${escapeHtml(error.stage)}">
      <strong>${escapeHtml(error.stage)}</strong>
      <span>${escapeHtml(error.message)}</span>
      ${fallbackButton}
    </div>
  `;
}

function renderJoined(state: WebRoomJoinedState): string {
  const themeMode = getThemeMode(state);
  const chatCooldownRemainingMs =
    typeof state.chatCooldownUntil === "number"
      ? state.chatCooldownUntil - Date.now()
      : 0;
  const chatCoolingDown =
    typeof state.chatCooldownUntil === "number" && chatCooldownRemainingMs > 0;
  const chatCooldownSeconds = chatCoolingDown
    ? Math.max(1, Math.ceil(chatCooldownRemainingMs / 1000))
    : 0;
  const chatCooldownAttribute = chatCoolingDown
    ? ` data-chat-cooldown="true" data-chat-cooldown-seconds="${chatCooldownSeconds}"`
    : ' data-chat-cooldown="false"';
  const canSendChat = canCurrentMember(state, "chat");
  const canUseVoice = canCurrentMember(state, "voice");
  const chatSendDisabled = chatCoolingDown || !canSendChat ? " disabled" : "";
  const chatInputDisabled = canSendChat ? "" : " disabled";
  const chatSendLabel = chatCoolingDown ? `${chatCooldownSeconds}s` : "发送";

  return `
    <main class="web-room-shell web-room-workspace" data-view="joined" data-theme-mode="${themeMode}">
      ${renderAnnouncementStrip(state)}
      <section class="player-chat-grid" data-region="player-chat">
        <div class="player-panel" data-panel="player" data-region="player">
          <div class="player-surface">
            ${renderPlayerSurface(state)}
          </div>
        </div>
        <aside class="chat-panel" data-panel="chat" data-region="chat">
          <div class="panel-heading">
            <h2>${renderPanelTitle("聊天室", "chat")}</h2>
          </div>
          ${renderChatVoicePanel(state)}
          <div class="chat-list">${renderChatMessages(state)}</div>
          <div class="chat-input-row"${chatCooldownAttribute}>
            <input name="chat" maxlength="500"${chatInputDisabled} />
            <button type="button" class="secondary-button" data-action="send-chat"${chatSendDisabled}>${renderButtonText(chatSendLabel, "send")}</button>
            ${renderVoiceToggleButton(state.voice, canUseVoice)}
          </div>
        </aside>
      </section>
      <section class="bottom-grid">
        <section class="info-panel" data-region="room-info" data-panel="members">
          <div class="panel-heading">
            <h2>${renderPanelTitle("房间信息", "room-info")}</h2>
            <span class="room-code-actions">
              <span>${escapeHtml(state.roomCode)}</span>
              <button
                type="button"
                class="icon-button copy-room-button"
                data-action="copy-room-invite"
                data-room-code="${escapeHtml(state.roomCode)}"
                data-join-token="${escapeHtml(state.joinToken ?? "")}"
                title="复制房间号和口令"
                aria-label="复制房间号和口令"
              >${renderButtonText("复制", "copy")}</button>
              <button type="button" class="secondary-button leave-room-button" data-action="leave-room">${renderButtonText("离开房间", "leave")}</button>
            </span>
          </div>
          ${renderRoomVideoInfo(state)}
          <dl class="room-meta">
            <dt>我的昵称</dt><dd>${escapeHtml(state.displayName)}</dd>
            <dt>服务器</dt><dd>${escapeHtml(state.serverUrl ?? "-")}</dd>
            <dt>连接状态</dt><dd>${renderConnectionState(state.connectionState)}</dd>
            <dt>偏移</dt><dd data-clock-offset-ms="${escapeHtml(formatClockMetricDataValue(state.clockOffsetMs))}">${escapeHtml(formatClockMetricValue(state.clockOffsetMs))}</dd>
            <dt>RTT</dt><dd data-clock-rtt-ms="${escapeHtml(formatClockMetricDataValue(state.rttMs))}">${escapeHtml(formatClockMetricValue(state.rttMs))}</dd>
          </dl>
          <details class="member-list-disclosure" data-disclosure-id="members">
            <summary>${renderSummaryLabel(`在线成员 ${state.members.length}`, "members")}</summary>
            <ul class="member-list">${renderMembers(state)}</ul>
          </details>
        </section>
        <section class="settings-panel" data-region="room-settings" data-panel="settings">
          <div class="panel-heading">
            <h2>${renderPanelTitle("视频设置", "settings")}</h2>
            ${renderAuthorizationManagementHeaderAction(state)}
          </div>
          <div class="settings-grid">
            ${renderProviderPickerPanel(state)}
            ${renderPlaybackError(state)}
          </div>
          <details class="diagnostics-disclosure" data-disclosure-id="diagnostics">
            <summary>${renderSummaryLabel("诊断日志", "info")}</summary>
            <div class="diagnostics-log">${renderDiagnostics(state)}</div>
          </details>
        </section>
      </section>
      ${renderProviderAuthPanel(state)}
    </main>
  `;
}

export function renderWebRoomApp(state: WebRoomState): string {
  return state.view === "entry" ? renderEntry(state) : renderJoined(state);
}
