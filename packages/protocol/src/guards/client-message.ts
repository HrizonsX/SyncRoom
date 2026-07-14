import type {
  ClientHelloPayload,
  ChatMessage,
  ClientMessage,
  CreateRoomMessage,
  DanmakuMessage,
  JoinRoomMessage,
  LeaveRoomMessage,
  PlaybackBufferReportMessage,
  PlaybackSyncStrategySetMessage,
  PlaybackUpdateMessage,
  PlaybackReportMessage,
  ProfileUpdateMessage,
  ShareVideoMessage,
  KickRoomMemberMessage,
  SetRoomMemberPermissionMessage,
  SyncPingMessage,
  SyncRequestMessage,
  TransferRoomHostMessage,
  VoiceAccessMessage,
  ClientVoiceStateMessage,
} from "../types/client-message.js";
import type { PlaybackState, SharedVideo } from "../types/domain.js";
import {
  WEB_PLAYBACK_BROWSER_LABELS,
  WEB_PLAYBACK_REPORT_EVENTS,
  WEB_PLAYBACK_SYSTEM_LABELS,
  WEB_PLAYER_ERROR_STAGES,
  PLAYBACK_BUFFER_STATES,
  PLAYBACK_SYNC_STRATEGIES,
  DANMAKU_MESSAGE_MAX_LENGTH,
  DANMAKU_MODES,
  ROOM_MEMBER_PERMISSION_NAMES,
  VIDEO_PROVIDER_IDS,
  isPlaybackSyncIntent,
} from "../types/domain.js";
import { CHAT_MESSAGE_MAX_LENGTH } from "../types/domain.js";
import { isProviderPlaybackDescriptor } from "./domain.js";
import {
  isActorId,
  isFiniteNumber,
  isOptionalNonNegativeInteger,
  isPlaybackPlayState,
  isRecord,
  isRoomCode,
  isSharedVideoReference,
  isString,
  isToken,
} from "./primitives.js";

const DISPLAY_NAME_MAX_LENGTH = 32;
const TITLE_MAX_LENGTH = 128;
const URL_MAX_LENGTH = 2048;
const DANMAKU_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isBoundedString(value: unknown, maxLength: number): value is string {
  return isString(value) && value.length <= maxLength;
}

function isOptionalBoundedString(
  value: unknown,
  maxLength: number,
): value is string | undefined {
  return value === undefined || isBoundedString(value, maxLength);
}

function isOneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === "string" && allowed.includes(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isOptionalDanmakuMode(
  value: unknown,
): value is DanmakuMessage["payload"]["mode"] {
  return value === undefined || isOneOf(value, DANMAKU_MODES);
}

function isOptionalDanmakuColor(value: unknown): value is string | undefined {
  return (
    value === undefined ||
    (typeof value === "string" && DANMAKU_COLOR_PATTERN.test(value))
  );
}

export function isClientHelloPayload(
  value: unknown,
): value is ClientHelloPayload {
  return (
    isRecord(value) &&
    isOptionalBoundedString(value.displayName, DISPLAY_NAME_MAX_LENGTH) &&
    isOptionalNonNegativeInteger(value.protocolVersion)
  );
}

export function isSharedVideo(value: unknown): value is SharedVideo {
  return (
    isRecord(value) &&
    isBoundedString(value.videoId, TITLE_MAX_LENGTH) &&
    isBoundedString(value.url, URL_MAX_LENGTH) &&
    isSharedVideoReference({ videoId: value.videoId, url: value.url }) &&
    isBoundedString(value.title, TITLE_MAX_LENGTH) &&
    isOptionalBoundedString(value.sharedByMemberId, DISPLAY_NAME_MAX_LENGTH) &&
    (value.sharedByMemberId === undefined ||
      isActorId(value.sharedByMemberId)) &&
    isOptionalBoundedString(
      value.sharedByDisplayName,
      DISPLAY_NAME_MAX_LENGTH,
    ) &&
    (value.provider === undefined ||
      isProviderPlaybackDescriptor(value.provider))
  );
}

export function isPlaybackState(value: unknown): value is PlaybackState {
  return (
    isRecord(value) &&
    isBoundedString(value.url, URL_MAX_LENGTH) &&
    isFiniteNumber(value.currentTime) &&
    isPlaybackPlayState(value.playState) &&
    (value.syncIntent === undefined ||
      isPlaybackSyncIntent(value.syncIntent)) &&
    (value.userInitiated === undefined ||
      typeof value.userInitiated === "boolean") &&
    isFiniteNumber(value.playbackRate) &&
    isFiniteNumber(value.updatedAt) &&
    isFiniteNumber(value.serverTime) &&
    isActorId(value.actorId) &&
    isFiniteNumber(value.seq)
  );
}

function isCreateRoomMessage(value: unknown): value is CreateRoomMessage {
  return (
    isRecord(value) &&
    value.type === "room:create" &&
    (value.payload === undefined || isClientHelloPayload(value.payload))
  );
}

function isJoinRoomPayload(
  value: unknown,
): value is JoinRoomMessage["payload"] {
  return (
    isRecord(value) &&
    isRoomCode(value.roomCode) &&
    isToken(value.joinToken) &&
    (value.memberToken === undefined || isToken(value.memberToken)) &&
    isOptionalBoundedString(value.displayName, DISPLAY_NAME_MAX_LENGTH) &&
    isOptionalNonNegativeInteger(value.protocolVersion)
  );
}

function isJoinRoomMessage(value: unknown): value is JoinRoomMessage {
  return (
    isRecord(value) &&
    value.type === "room:join" &&
    isJoinRoomPayload(value.payload)
  );
}

function isProfileUpdatePayload(
  value: unknown,
): value is ProfileUpdateMessage["payload"] {
  return (
    isRecord(value) &&
    isToken(value.memberToken) &&
    isBoundedString(value.displayName, DISPLAY_NAME_MAX_LENGTH)
  );
}

function isProfileUpdateMessage(value: unknown): value is ProfileUpdateMessage {
  return (
    isRecord(value) &&
    value.type === "profile:update" &&
    isProfileUpdatePayload(value.payload)
  );
}

function isLeaveRoomPayload(
  value: unknown,
): value is NonNullable<LeaveRoomMessage["payload"]> {
  return (
    isRecord(value) &&
    (value.memberToken === undefined || isToken(value.memberToken))
  );
}

function isLeaveRoomMessage(value: unknown): value is LeaveRoomMessage {
  return (
    isRecord(value) &&
    value.type === "room:leave" &&
    (value.payload === undefined || isLeaveRoomPayload(value.payload))
  );
}

function isShareVideoPayload(
  value: unknown,
): value is ShareVideoMessage["payload"] {
  return (
    isRecord(value) &&
    isToken(value.memberToken) &&
    isSharedVideo(value.video) &&
    (value.playback === undefined || isPlaybackState(value.playback))
  );
}

function isShareVideoMessage(value: unknown): value is ShareVideoMessage {
  return (
    isRecord(value) &&
    value.type === "video:share" &&
    isShareVideoPayload(value.payload)
  );
}

function isPlaybackUpdatePayload(
  value: unknown,
): value is PlaybackUpdateMessage["payload"] {
  return (
    isRecord(value) &&
    isToken(value.memberToken) &&
    isPlaybackState(value.playback)
  );
}

function isPlaybackUpdateMessage(
  value: unknown,
): value is PlaybackUpdateMessage {
  return (
    isRecord(value) &&
    value.type === "playback:update" &&
    isPlaybackUpdatePayload(value.payload)
  );
}

function isSyncRequestPayload(
  value: unknown,
): value is SyncRequestMessage["payload"] {
  return isRecord(value) && isToken(value.memberToken);
}

function isSyncRequestMessage(value: unknown): value is SyncRequestMessage {
  return (
    isRecord(value) &&
    value.type === "sync:request" &&
    isSyncRequestPayload(value.payload)
  );
}

function isSyncPingPayload(
  value: unknown,
): value is SyncPingMessage["payload"] {
  return isRecord(value) && isFiniteNumber(value.clientSendTime);
}

function isSyncPingMessage(value: unknown): value is SyncPingMessage {
  return (
    isRecord(value) &&
    value.type === "sync:ping" &&
    isSyncPingPayload(value.payload)
  );
}

function isVoiceAccessPayload(
  value: unknown,
): value is VoiceAccessMessage["payload"] {
  return isRecord(value) && isToken(value.memberToken);
}

function isVoiceAccessMessage(value: unknown): value is VoiceAccessMessage {
  return (
    isRecord(value) &&
    value.type === "voice:access" &&
    isVoiceAccessPayload(value.payload)
  );
}

function isVoiceStatePayload(
  value: unknown,
): value is ClientVoiceStateMessage["payload"] {
  return (
    isRecord(value) &&
    isToken(value.memberToken) &&
    typeof value.connected === "boolean" &&
    typeof value.muted === "boolean" &&
    (value.speaking === undefined || typeof value.speaking === "boolean")
  );
}

function isVoiceStateMessage(value: unknown): value is ClientVoiceStateMessage {
  return (
    isRecord(value) &&
    value.type === "voice:state" &&
    isVoiceStatePayload(value.payload)
  );
}

function isChatPayload(value: unknown): value is ChatMessage["payload"] {
  return (
    isRecord(value) &&
    isToken(value.memberToken) &&
    (value.roomCode === undefined || isRoomCode(value.roomCode)) &&
    isBoundedString(value.content, CHAT_MESSAGE_MAX_LENGTH) &&
    value.content.trim().length > 0
  );
}

function isChatMessage(value: unknown): value is ChatMessage {
  return (
    isRecord(value) &&
    value.type === "chat:message" &&
    isChatPayload(value.payload)
  );
}

function isDanmakuPayload(value: unknown): value is DanmakuMessage["payload"] {
  return (
    isRecord(value) &&
    isToken(value.memberToken) &&
    (value.roomCode === undefined || isRoomCode(value.roomCode)) &&
    isBoundedString(value.content, DANMAKU_MESSAGE_MAX_LENGTH) &&
    value.content.trim().length > 0 &&
    isNonNegativeFiniteNumber(value.videoTime) &&
    isOptionalDanmakuMode(value.mode) &&
    isOptionalDanmakuColor(value.color)
  );
}

function isDanmakuMessage(value: unknown): value is DanmakuMessage {
  return (
    isRecord(value) &&
    value.type === "danmaku:message" &&
    isDanmakuPayload(value.payload)
  );
}

function isMemberManagementTargetPayload(
  value: unknown,
): value is KickRoomMemberMessage["payload"] {
  return (
    isRecord(value) &&
    isToken(value.memberToken) &&
    isActorId(value.targetMemberId)
  );
}

function isSetRoomMemberPermissionPayload(
  value: unknown,
): value is SetRoomMemberPermissionMessage["payload"] {
  return (
    isRecord(value) &&
    isToken(value.memberToken) &&
    isActorId(value.targetMemberId) &&
    isOneOf(value.permission, ROOM_MEMBER_PERMISSION_NAMES) &&
    typeof value.allowed === "boolean"
  );
}

function isSetRoomMemberPermissionMessage(
  value: unknown,
): value is SetRoomMemberPermissionMessage {
  return (
    isRecord(value) &&
    value.type === "room:member-permission:set" &&
    isSetRoomMemberPermissionPayload(value.payload)
  );
}

function isKickRoomMemberMessage(
  value: unknown,
): value is KickRoomMemberMessage {
  return (
    isRecord(value) &&
    value.type === "room:member:kick" &&
    isMemberManagementTargetPayload(value.payload)
  );
}

function isTransferRoomHostMessage(
  value: unknown,
): value is TransferRoomHostMessage {
  return (
    isRecord(value) &&
    value.type === "room:host:transfer" &&
    isMemberManagementTargetPayload(value.payload)
  );
}

function playbackReportNeedsStage(
  event: PlaybackReportMessage["payload"]["event"],
): boolean {
  return event === "startup_failure" || event === "player_error";
}

function isPlaybackReportPayload(
  value: unknown,
): value is PlaybackReportMessage["payload"] {
  if (
    !isRecord(value) ||
    !isToken(value.memberToken) ||
    !isOneOf(value.event, WEB_PLAYBACK_REPORT_EVENTS) ||
    (value.providerId !== undefined &&
      !isOneOf(value.providerId, VIDEO_PROVIDER_IDS)) ||
    (value.stage !== undefined &&
      !isOneOf(value.stage, WEB_PLAYER_ERROR_STAGES)) ||
    (value.browser !== undefined &&
      !isOneOf(value.browser, WEB_PLAYBACK_BROWSER_LABELS)) ||
    (value.system !== undefined &&
      !isOneOf(value.system, WEB_PLAYBACK_SYSTEM_LABELS))
  ) {
    return false;
  }

  if (playbackReportNeedsStage(value.event)) {
    return isOneOf(value.stage, WEB_PLAYER_ERROR_STAGES);
  }

  return true;
}

function isPlaybackReportMessage(
  value: unknown,
): value is PlaybackReportMessage {
  return (
    isRecord(value) &&
    value.type === "playback:report" &&
    isPlaybackReportPayload(value.payload)
  );
}

function isPlaybackBufferReportPayload(
  value: unknown,
): value is PlaybackBufferReportMessage["payload"] {
  return (
    isRecord(value) &&
    isToken(value.memberToken) &&
    isOneOf(value.state, PLAYBACK_BUFFER_STATES) &&
    isNonNegativeFiniteNumber(value.currentTime) &&
    (value.bufferAheadSeconds === undefined ||
      isNonNegativeFiniteNumber(value.bufferAheadSeconds)) &&
    (value.playbackRevision === undefined ||
      (typeof value.playbackRevision === "string" &&
        value.playbackRevision.length <= 1_024))
  );
}

function isPlaybackBufferReportMessage(
  value: unknown,
): value is PlaybackBufferReportMessage {
  return (
    isRecord(value) &&
    value.type === "playback:buffer" &&
    isPlaybackBufferReportPayload(value.payload)
  );
}

function isPlaybackSyncStrategySetMessage(
  value: unknown,
): value is PlaybackSyncStrategySetMessage {
  return (
    isRecord(value) &&
    value.type === "playback:sync-strategy:set" &&
    isRecord(value.payload) &&
    isToken(value.payload.memberToken) &&
    isOneOf(value.payload.strategy, PLAYBACK_SYNC_STRATEGIES)
  );
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "room:create":
      return isCreateRoomMessage(value);
    case "room:join":
      return isJoinRoomMessage(value);
    case "profile:update":
      return isProfileUpdateMessage(value);
    case "room:leave":
      return isLeaveRoomMessage(value);
    case "video:share":
      return isShareVideoMessage(value);
    case "playback:update":
      return isPlaybackUpdateMessage(value);
    case "playback:buffer":
      return isPlaybackBufferReportMessage(value);
    case "playback:sync-strategy:set":
      return isPlaybackSyncStrategySetMessage(value);
    case "sync:request":
      return isSyncRequestMessage(value);
    case "sync:ping":
      return isSyncPingMessage(value);
    case "voice:access":
      return isVoiceAccessMessage(value);
    case "voice:state":
      return isVoiceStateMessage(value);
    case "chat:message":
      return isChatMessage(value);
    case "danmaku:message":
      return isDanmakuMessage(value);
    case "room:member-permission:set":
      return isSetRoomMemberPermissionMessage(value);
    case "room:member:kick":
      return isKickRoomMemberMessage(value);
    case "room:host:transfer":
      return isTransferRoomHostMessage(value);
    case "playback:report":
      return isPlaybackReportMessage(value);
    default:
      return false;
  }
}
