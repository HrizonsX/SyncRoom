import type {
  DanmakuMode,
  PlaybackSyncState,
  PlaybackState,
  ProviderPlaybackDescriptor,
  RoomMemberPermissions,
  VideoProviderId,
} from "@syncroom/protocol";
import type { PlaybackSource } from "../playback/playback-adapter.js";
import type { WebRoomVoiceState } from "../voice/voice-state.js";

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
  providerId?: VideoProviderId;
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
  playbackSync?: PlaybackSyncState;
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
