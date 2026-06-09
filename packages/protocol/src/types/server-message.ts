import type { ErrorCode, RoomCode } from "./common.js";
import type { ClientMessage } from "./client-message.js";
import type { AnnouncementState, RoomMember, RoomState } from "./domain.js";

export interface RoomCreatedMessage {
  type: "room:created";
  payload: {
    roomCode: RoomCode;
    memberId: string;
    joinToken: string;
    memberToken: string;
    serverProtocolVersion?: number;
  };
}

export interface RoomJoinedMessage {
  type: "room:joined";
  payload: {
    roomCode: RoomCode;
    memberId: string;
    memberToken: string;
    serverProtocolVersion?: number;
  };
}

export interface RoomStateMessage {
  type: "room:state";
  payload: RoomState;
}

export interface RoomMemberJoinedMessage {
  type: "room:member-joined";
  payload: {
    roomCode: RoomCode;
    member: RoomMember;
  };
}

export interface RoomMemberLeftMessage {
  type: "room:member-left";
  payload: {
    roomCode: RoomCode;
    member: RoomMember;
  };
}

export interface ErrorMessage {
  type: "error";
  payload: {
    code: ErrorCode;
    message: string;
    messageType?: ClientMessage["type"];
    retryAfterMs?: number;
  };
}

export interface SyncPongMessage {
  type: "sync:pong";
  payload: {
    clientSendTime: number;
    serverReceiveTime: number;
    serverSendTime: number;
  };
}

export interface VoiceAccessGrantedMessage {
  type: "voice:access-granted";
  payload: {
    livekitUrl: string;
    token: string;
    roomName: string;
    participantIdentity: string;
    expiresAt: number;
  };
}

export interface ServerVoiceStateMessage {
  type: "voice:state";
  payload: {
    roomCode: RoomCode;
    memberId: string;
    connected: boolean;
    muted: boolean;
    speaking?: boolean;
  };
}

export interface AnnouncementUpdateMessage {
  type: "announcement:update";
  payload: AnnouncementState;
}

export type ServerMessage =
  | RoomCreatedMessage
  | RoomJoinedMessage
  | RoomStateMessage
  | RoomMemberJoinedMessage
  | RoomMemberLeftMessage
  | ErrorMessage
  | SyncPongMessage
  | VoiceAccessGrantedMessage
  | ServerVoiceStateMessage
  | AnnouncementUpdateMessage;
