import type {
  ErrorMessage,
  AnnouncementUpdateMessage,
  RoomCreatedMessage,
  RoomJoinedMessage,
  RoomMemberJoinedMessage,
  RoomMemberLeftMessage,
  RoomStateMessage,
  ServerMessage,
  SyncPongMessage,
  VoiceAccessGrantedMessage,
  ServerVoiceStateMessage,
  ServerChatMessage,
  ServerDanmakuMessage,
} from "../types/server-message.js";
import type {
  AnnouncementItem,
  AnnouncementState,
  PlaybackState,
  PlaybackSyncState,
  RoomChatMessage,
  RoomMember,
  RoomState,
  SharedVideo,
} from "../types/domain.js";
import {
  ANNOUNCEMENT_ID_MAX_LENGTH,
  ANNOUNCEMENT_TEXT_MAX_LENGTH,
  CHAT_MESSAGE_MAX_LENGTH,
  DANMAKU_MESSAGE_MAX_LENGTH,
  DANMAKU_MODES,
  MAX_ANNOUNCEMENT_ITEMS,
  PLAYBACK_SYNC_STRATEGIES,
  ROOM_CHAT_HISTORY_LIMIT,
  ROOM_CHAT_MESSAGE_KINDS,
  ROOM_MEMBER_PERMISSION_NAMES,
  ROOM_SYSTEM_CHAT_EVENT_TYPES,
  isPlaybackSyncIntent,
} from "../types/domain.js";
import { isErrorCode } from "../types/common.js";
import { isProviderPlaybackDescriptor } from "./domain.js";
import {
  isActorId,
  isFiniteNumber,
  isOptionalPositiveInteger,
  isOptionalString,
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
const LIVEKIT_TOKEN_MIN_LENGTH = 16;
const LIVEKIT_TOKEN_MAX_LENGTH = 4096;
const LIVEKIT_ROOM_NAME_MAX_LENGTH = 128;
const CLIENT_MESSAGE_TYPES = new Set([
  "room:create",
  "room:join",
  "profile:update",
  "room:leave",
  "video:share",
  "playback:update",
  "playback:buffer",
  "playback:sync-strategy:set",
  "sync:request",
  "sync:ping",
  "voice:access",
  "voice:state",
  "chat:message",
  "danmaku:message",
  "room:member-permission:set",
  "room:member:kick",
  "room:host:transfer",
]);
const DANMAKU_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isBoundedString(value: unknown, maxLength: number): value is string {
  return isString(value) && value.length <= maxLength;
}

function isNonEmptyBoundedString(
  value: unknown,
  maxLength: number,
): value is string {
  return isBoundedString(value, maxLength) && value.trim().length > 0;
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

function isDanmakuColor(value: unknown): value is string {
  return typeof value === "string" && DANMAKU_COLOR_PATTERN.test(value);
}

function isLiveKitUrl(value: unknown): value is string {
  if (!isBoundedString(value, URL_MAX_LENGTH)) {
    return false;
  }
  try {
    const parsedUrl = new URL(value);
    return parsedUrl.protocol === "ws:" || parsedUrl.protocol === "wss:";
  } catch {
    return false;
  }
}

function isLiveKitToken(value: unknown): value is string {
  return (
    isString(value) &&
    value.length >= LIVEKIT_TOKEN_MIN_LENGTH &&
    value.length <= LIVEKIT_TOKEN_MAX_LENGTH
  );
}

function isSharedVideo(value: unknown): value is SharedVideo {
  return (
    isRecord(value) &&
    isBoundedString(value.videoId, TITLE_MAX_LENGTH) &&
    isBoundedString(value.url, URL_MAX_LENGTH) &&
    isSharedVideoReference({ videoId: value.videoId, url: value.url }) &&
    isBoundedString(value.title, TITLE_MAX_LENGTH) &&
    isOptionalString(value.sharedByMemberId) &&
    (value.sharedByMemberId === undefined ||
      isActorId(value.sharedByMemberId)) &&
    (value.sharedByDisplayName === undefined ||
      isBoundedString(value.sharedByDisplayName, DISPLAY_NAME_MAX_LENGTH)) &&
    (value.provider === undefined ||
      isProviderPlaybackDescriptor(value.provider))
  );
}

function isPlaybackState(value: unknown): value is PlaybackState {
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

function isPlaybackSyncState(value: unknown): value is PlaybackSyncState {
  if (
    !isRecord(value) ||
    !(
      typeof value.strategy === "string" &&
      (PLAYBACK_SYNC_STRATEGIES as readonly string[]).includes(value.strategy)
    ) ||
    !isRecord(value.hold) ||
    typeof value.hold.active !== "boolean" ||
    !Array.isArray(value.bufferingMemberIds) ||
    !value.bufferingMemberIds.every((memberId) => isActorId(memberId))
  ) {
    return false;
  }

  return (
    (value.hold.reasonMemberId === undefined ||
      isActorId(value.hold.reasonMemberId)) &&
    (value.hold.startedAt === undefined ||
      isFiniteNumber(value.hold.startedAt)) &&
    (value.hold.deadlineAt === undefined ||
      isFiniteNumber(value.hold.deadlineAt)) &&
    (value.hold.playbackRevision === undefined ||
      (typeof value.hold.playbackRevision === "string" &&
        value.hold.playbackRevision.length <= 1_024))
  );
}

export function isRoomMember(value: unknown): value is RoomMember {
  const permissions = isRecord(value) ? value.permissions : undefined;
  return (
    isRecord(value) &&
    isActorId(value.id) &&
    isBoundedString(value.name, DISPLAY_NAME_MAX_LENGTH) &&
    (permissions === undefined ||
      (isRecord(permissions) &&
        ROOM_MEMBER_PERMISSION_NAMES.every(
          (permission) => typeof permissions[permission] === "boolean",
        )))
  );
}

function isRoomChatMessage(value: unknown): value is RoomChatMessage {
  return (
    isRecord(value) &&
    (value.kind === undefined ||
      isOneOf(value.kind, ROOM_CHAT_MESSAGE_KINDS)) &&
    (value.systemEventType === undefined ||
      isOneOf(value.systemEventType, ROOM_SYSTEM_CHAT_EVENT_TYPES)) &&
    (value.kind !== "system" || value.systemEventType !== undefined) &&
    isActorId(value.memberId) &&
    isBoundedString(value.displayName, DISPLAY_NAME_MAX_LENGTH) &&
    isNonEmptyBoundedString(value.content, CHAT_MESSAGE_MAX_LENGTH) &&
    isFiniteNumber(value.timestamp)
  );
}

function isOptionalRoomChatHistory(
  value: unknown,
): value is RoomChatMessage[] | undefined {
  return (
    value === undefined ||
    (Array.isArray(value) &&
      value.length <= ROOM_CHAT_HISTORY_LIMIT &&
      value.every((message) => isRoomChatMessage(message)))
  );
}

export function isRoomState(value: unknown): value is RoomState {
  return (
    isRecord(value) &&
    isRoomCode(value.roomCode) &&
    (value.hostMemberId === undefined || isActorId(value.hostMemberId)) &&
    (value.sharedVideo === null || isSharedVideo(value.sharedVideo)) &&
    (value.playback === null || isPlaybackState(value.playback)) &&
    (value.playbackSync === undefined ||
      isPlaybackSyncState(value.playbackSync)) &&
    Array.isArray(value.members) &&
    value.members.every((member) => isRoomMember(member)) &&
    isOptionalRoomChatHistory(value.chatMessages)
  );
}

function isRoomCreatedMessage(value: unknown): value is RoomCreatedMessage {
  return (
    isRecord(value) &&
    value.type === "room:created" &&
    isRecord(value.payload) &&
    isRoomCode(value.payload.roomCode) &&
    isActorId(value.payload.memberId) &&
    isToken(value.payload.joinToken) &&
    isToken(value.payload.memberToken) &&
    isOptionalPositiveInteger(value.payload.serverProtocolVersion)
  );
}

function isRoomJoinedMessage(value: unknown): value is RoomJoinedMessage {
  return (
    isRecord(value) &&
    value.type === "room:joined" &&
    isRecord(value.payload) &&
    isRoomCode(value.payload.roomCode) &&
    isActorId(value.payload.memberId) &&
    isToken(value.payload.memberToken) &&
    isOptionalPositiveInteger(value.payload.serverProtocolVersion)
  );
}

function isRoomStateMessage(value: unknown): value is RoomStateMessage {
  return (
    isRecord(value) && value.type === "room:state" && isRoomState(value.payload)
  );
}

function isRoomMemberJoinedMessage(
  value: unknown,
): value is RoomMemberJoinedMessage {
  return (
    isRecord(value) &&
    value.type === "room:member-joined" &&
    isRecord(value.payload) &&
    isRoomCode(value.payload.roomCode) &&
    isRoomMember(value.payload.member)
  );
}

function isRoomMemberLeftMessage(
  value: unknown,
): value is RoomMemberLeftMessage {
  return (
    isRecord(value) &&
    value.type === "room:member-left" &&
    isRecord(value.payload) &&
    isRoomCode(value.payload.roomCode) &&
    isRoomMember(value.payload.member)
  );
}

export function isErrorMessage(value: unknown): value is ErrorMessage {
  return (
    isRecord(value) &&
    value.type === "error" &&
    isRecord(value.payload) &&
    isErrorCode(value.payload.code) &&
    isBoundedString(value.payload.message, TITLE_MAX_LENGTH) &&
    (value.payload.messageType === undefined ||
      (isString(value.payload.messageType) &&
        CLIENT_MESSAGE_TYPES.has(value.payload.messageType))) &&
    isOptionalPositiveInteger(value.payload.retryAfterMs)
  );
}

function isSyncPongMessage(value: unknown): value is SyncPongMessage {
  return (
    isRecord(value) &&
    value.type === "sync:pong" &&
    isRecord(value.payload) &&
    isFiniteNumber(value.payload.clientSendTime) &&
    isFiniteNumber(value.payload.serverReceiveTime) &&
    isFiniteNumber(value.payload.serverSendTime)
  );
}

function isVoiceAccessGrantedMessage(
  value: unknown,
): value is VoiceAccessGrantedMessage {
  return (
    isRecord(value) &&
    value.type === "voice:access-granted" &&
    isRecord(value.payload) &&
    isLiveKitUrl(value.payload.livekitUrl) &&
    isLiveKitToken(value.payload.token) &&
    isBoundedString(value.payload.roomName, LIVEKIT_ROOM_NAME_MAX_LENGTH) &&
    isActorId(value.payload.participantIdentity) &&
    isFiniteNumber(value.payload.expiresAt)
  );
}

function isVoiceStateMessage(value: unknown): value is ServerVoiceStateMessage {
  return (
    isRecord(value) &&
    value.type === "voice:state" &&
    isRecord(value.payload) &&
    isRoomCode(value.payload.roomCode) &&
    isActorId(value.payload.memberId) &&
    typeof value.payload.connected === "boolean" &&
    typeof value.payload.muted === "boolean" &&
    (value.payload.speaking === undefined ||
      typeof value.payload.speaking === "boolean")
  );
}

function isAnnouncementItem(value: unknown): value is AnnouncementItem {
  return (
    isRecord(value) &&
    isNonEmptyBoundedString(value.id, ANNOUNCEMENT_ID_MAX_LENGTH) &&
    isNonEmptyBoundedString(value.text, ANNOUNCEMENT_TEXT_MAX_LENGTH)
  );
}

export function isAnnouncementState(
  value: unknown,
): value is AnnouncementState {
  return (
    isRecord(value) &&
    isFiniteNumber(value.version) &&
    isFiniteNumber(value.updatedAt) &&
    Array.isArray(value.items) &&
    value.items.length <= MAX_ANNOUNCEMENT_ITEMS &&
    value.items.every((item) => isAnnouncementItem(item))
  );
}

function isAnnouncementUpdateMessage(
  value: unknown,
): value is AnnouncementUpdateMessage {
  return (
    isRecord(value) &&
    value.type === "announcement:update" &&
    isAnnouncementState(value.payload)
  );
}

function isServerChatMessage(value: unknown): value is ServerChatMessage {
  return (
    isRecord(value) &&
    value.type === "chat:message" &&
    isRecord(value.payload) &&
    isRoomCode(value.payload.roomCode) &&
    isActorId(value.payload.memberId) &&
    isBoundedString(value.payload.displayName, DISPLAY_NAME_MAX_LENGTH) &&
    isBoundedString(value.payload.content, CHAT_MESSAGE_MAX_LENGTH) &&
    value.payload.content.trim().length > 0 &&
    isFiniteNumber(value.payload.timestamp)
  );
}

function isServerDanmakuMessage(value: unknown): value is ServerDanmakuMessage {
  return (
    isRecord(value) &&
    value.type === "danmaku:message" &&
    isRecord(value.payload) &&
    isRoomCode(value.payload.roomCode) &&
    isActorId(value.payload.memberId) &&
    isBoundedString(value.payload.displayName, DISPLAY_NAME_MAX_LENGTH) &&
    isNonEmptyBoundedString(
      value.payload.content,
      DANMAKU_MESSAGE_MAX_LENGTH,
    ) &&
    isNonNegativeFiniteNumber(value.payload.videoTime) &&
    isOneOf(value.payload.mode, DANMAKU_MODES) &&
    isDanmakuColor(value.payload.color) &&
    isFiniteNumber(value.payload.timestamp)
  );
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || !isString(value.type)) {
    return false;
  }

  switch (value.type) {
    case "room:created":
      return isRoomCreatedMessage(value);
    case "room:joined":
      return isRoomJoinedMessage(value);
    case "room:state":
      return isRoomStateMessage(value);
    case "room:member-joined":
      return isRoomMemberJoinedMessage(value);
    case "room:member-left":
      return isRoomMemberLeftMessage(value);
    case "error":
      return isErrorMessage(value);
    case "sync:pong":
      return isSyncPongMessage(value);
    case "voice:access-granted":
      return isVoiceAccessGrantedMessage(value);
    case "voice:state":
      return isVoiceStateMessage(value);
    case "announcement:update":
      return isAnnouncementUpdateMessage(value);
    case "chat:message":
      return isServerChatMessage(value);
    case "danmaku:message":
      return isServerDanmakuMessage(value);
    default:
      return false;
  }
}
