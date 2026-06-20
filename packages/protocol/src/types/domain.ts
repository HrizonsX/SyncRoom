import type { PlaybackPlayState, RoomCode } from "./common.js";

export const PLAYBACK_SYNC_INTENTS = [
  "explicit-seek",
  "explicit-ratechange",
] as const;

export type PlaybackSyncIntent = (typeof PLAYBACK_SYNC_INTENTS)[number];
export const VIDEO_PROVIDER_IDS = ["bilibili"] as const;
export type VideoProviderId = (typeof VIDEO_PROVIDER_IDS)[number];
export const PLAYBACK_SOURCE_TYPES = ["mpd", "m3u8", "mp4"] as const;
export type PlaybackSourceType = (typeof PLAYBACK_SOURCE_TYPES)[number];
export const PROVIDER_ITEM_KINDS = ["part", "episode", "live"] as const;
export type ProviderItemKind = (typeof PROVIDER_ITEM_KINDS)[number];
export const WEB_PLAYER_ERROR_STAGES = [
  "manifest",
  "segment",
  "decode",
  "network",
  "unknown",
] as const;
export type WebPlayerErrorStage = (typeof WEB_PLAYER_ERROR_STAGES)[number];
export const WEB_PLAYBACK_REPORT_EVENTS = [
  "startup_failure",
  "direct_link_success",
  "direct_link_failure",
  "proxy_fallback",
  "player_error",
] as const;
export type WebPlaybackReportEvent =
  (typeof WEB_PLAYBACK_REPORT_EVENTS)[number];
export const WEB_PLAYBACK_BROWSER_LABELS = [
  "chrome",
  "edge",
  "firefox",
  "safari",
  "other",
  "unknown",
] as const;
export type WebPlaybackBrowserLabel =
  (typeof WEB_PLAYBACK_BROWSER_LABELS)[number];
export const WEB_PLAYBACK_SYSTEM_LABELS = [
  "windows",
  "macos",
  "linux",
  "android",
  "ios",
  "other",
  "unknown",
] as const;
export type WebPlaybackSystemLabel =
  (typeof WEB_PLAYBACK_SYSTEM_LABELS)[number];
export const MAX_ANNOUNCEMENT_ITEMS = 8;
export const ANNOUNCEMENT_TEXT_MAX_LENGTH = 160;
export const ANNOUNCEMENT_ID_MAX_LENGTH = 64;
export const CHAT_MESSAGE_MAX_LENGTH = 500;
export const ROOM_CHAT_HISTORY_LIMIT = 200;
export const ROOM_CHAT_MESSAGE_KINDS = ["user", "system"] as const;
export type RoomChatMessageKind = (typeof ROOM_CHAT_MESSAGE_KINDS)[number];
export const ROOM_SYSTEM_CHAT_EVENT_TYPES = [
  "member_joined",
  "member_left",
  "voice_unmuted",
  "voice_muted",
] as const;
export type RoomSystemChatEventType =
  (typeof ROOM_SYSTEM_CHAT_EVENT_TYPES)[number];
export const DANMAKU_MESSAGE_MAX_LENGTH = 120;
export const DANMAKU_MODES = ["scroll", "top", "bottom"] as const;
export type DanmakuMode = (typeof DANMAKU_MODES)[number];

export function isPlaybackSyncIntent(
  value: unknown,
): value is PlaybackSyncIntent {
  return (
    typeof value === "string" &&
    (PLAYBACK_SYNC_INTENTS as readonly string[]).includes(value)
  );
}

export function isExplicitControlSyncIntent(
  syncIntent: PlaybackSyncIntent | null | undefined,
): boolean {
  return syncIntent === "explicit-seek" || syncIntent === "explicit-ratechange";
}

export interface PlaybackProxyPolicy {
  proxy: boolean;
  shared: boolean;
}

export interface ProviderItemSelection {
  itemId: string;
  title: string;
  kind: ProviderItemKind;
  aid?: string;
  bvid?: string;
  cid?: string;
  epId?: string;
  seasonId?: string;
  roomId?: string;
  durationSeconds?: number;
}

export interface ProviderPlaybackCandidate {
  id: string;
  sourceType: PlaybackSourceType;
  url: string;
  mimeType?: string;
  codecs?: string;
  qualityLabel?: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  default?: boolean;
}

export interface ProviderPlaybackDescriptor {
  providerId: VideoProviderId;
  sourceId: string;
  sourceUrl: string;
  title: string;
  item: ProviderItemSelection;
  policy: PlaybackProxyPolicy;
  candidates: ProviderPlaybackCandidate[];
  defaultCandidateId?: string;
}

export interface SharedVideo {
  videoId: string;
  url: string;
  title: string;
  sharedByMemberId?: string;
  sharedByDisplayName?: string;
  provider?: ProviderPlaybackDescriptor;
}

export interface PlaybackState {
  url: string;
  currentTime: number;
  playState: PlaybackPlayState;
  syncIntent?: PlaybackSyncIntent;
  /**
   * Hint that this state transition was driven by an explicit user gesture
   * (e.g. clicking pause) rather than a buffer stall, hydration, or
   * remote-state application. Receivers may use this to skip flicker-defence
   * debounces and apply the transition without delay. Optional for
   * backward-compatibility: legacy senders omit it; legacy receivers ignore it.
   */
  userInitiated?: boolean;
  playbackRate: number;
  updatedAt: number;
  serverTime: number;
  actorId: string;
  seq: number;
}

export interface RoomMember {
  id: string;
  name: string;
  permissions?: RoomMemberPermissions;
}

export const ROOM_MEMBER_PERMISSION_NAMES = [
  "voice",
  "playbackControl",
  "chat",
  "danmaku",
] as const;

export type RoomMemberPermissionName =
  (typeof ROOM_MEMBER_PERMISSION_NAMES)[number];

export type RoomMemberPermissions = Record<RoomMemberPermissionName, boolean>;

export const DEFAULT_ROOM_MEMBER_PERMISSIONS: RoomMemberPermissions = {
  voice: true,
  playbackControl: true,
  chat: true,
  danmaku: true,
};

export function createDefaultRoomMemberPermissions(): RoomMemberPermissions {
  return { ...DEFAULT_ROOM_MEMBER_PERMISSIONS };
}

export interface RoomChatMessage {
  kind?: RoomChatMessageKind;
  systemEventType?: RoomSystemChatEventType;
  memberId: string;
  displayName: string;
  content: string;
  timestamp: number;
}

export interface RoomState {
  roomCode: RoomCode;
  hostMemberId?: string;
  sharedVideo: SharedVideo | null;
  playback: PlaybackState | null;
  members: RoomMember[];
  chatMessages?: RoomChatMessage[];
}

export interface AnnouncementItem {
  id: string;
  text: string;
}

export interface AnnouncementState {
  version: number;
  updatedAt: number;
  items: AnnouncementItem[];
}
