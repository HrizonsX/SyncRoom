import type { RoomCode } from "./common.js";
import type {
  DanmakuMode,
  PlaybackState,
  SharedVideo,
  VideoProviderId,
  WebPlaybackBrowserLabel,
  WebPlaybackReportEvent,
  WebPlaybackSystemLabel,
  WebPlayerErrorStage,
} from "./domain.js";

export interface ClientHelloPayload {
  displayName?: string;
  protocolVersion?: number;
}

export interface CreateRoomMessage {
  type: "room:create";
  payload?: ClientHelloPayload;
}

export interface JoinRoomMessage {
  type: "room:join";
  payload: {
    roomCode: RoomCode;
    joinToken: string;
    memberToken?: string;
    displayName?: string;
    protocolVersion?: number;
  };
}

export interface ProfileUpdateMessage {
  type: "profile:update";
  payload: {
    memberToken: string;
    displayName: string;
  };
}

export interface LeaveRoomMessage {
  type: "room:leave";
  payload?: {
    memberToken?: string;
  };
}

export interface ShareVideoMessage {
  type: "video:share";
  payload: {
    memberToken: string;
    video: SharedVideo;
    playback?: PlaybackState;
  };
}

export interface PlaybackUpdateMessage {
  type: "playback:update";
  payload: {
    memberToken: string;
    playback: PlaybackState;
  };
}

export interface SyncRequestMessage {
  type: "sync:request";
  payload: {
    memberToken: string;
  };
}

export interface SyncPingMessage {
  type: "sync:ping";
  payload: {
    clientSendTime: number;
  };
}

export interface VoiceAccessMessage {
  type: "voice:access";
  payload: {
    memberToken: string;
  };
}

export interface ClientVoiceStateMessage {
  type: "voice:state";
  payload: {
    memberToken: string;
    connected: boolean;
    muted: boolean;
    speaking?: boolean;
  };
}

export interface ChatMessage {
  type: "chat:message";
  payload: {
    memberToken: string;
    roomCode?: RoomCode;
    content: string;
  };
}

export interface DanmakuMessage {
  type: "danmaku:message";
  payload: {
    memberToken: string;
    roomCode?: RoomCode;
    content: string;
    videoTime: number;
    mode?: DanmakuMode;
    color?: string;
  };
}

export interface PlaybackReportMessage {
  type: "playback:report";
  payload: {
    memberToken: string;
    event: WebPlaybackReportEvent;
    providerId?: VideoProviderId;
    stage?: WebPlayerErrorStage;
    browser?: WebPlaybackBrowserLabel;
    system?: WebPlaybackSystemLabel;
  };
}

export type ClientMessage =
  | CreateRoomMessage
  | JoinRoomMessage
  | ProfileUpdateMessage
  | LeaveRoomMessage
  | ShareVideoMessage
  | PlaybackUpdateMessage
  | SyncRequestMessage
  | SyncPingMessage
  | VoiceAccessMessage
  | ClientVoiceStateMessage
  | ChatMessage
  | DanmakuMessage
  | PlaybackReportMessage;
