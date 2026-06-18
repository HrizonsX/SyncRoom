import type { ServerMessage } from "@bili-syncplay/protocol";
import type { WebRoomVoiceState } from "./voice-state.js";
import {
  WebRoomVoiceRuntimeError,
  type WebRoomVoiceRuntime,
  type WebRoomVoiceRuntimeEvent,
} from "./voice-runtime.js";

type VoiceSessionContext = {
  roomCode: string;
  memberToken: string;
  memberId: string;
  connected: boolean;
};

export type WebRoomVoiceController = {
  requestAccess: (options?: { forceRefresh?: boolean }) => void;
  toggleMicrophone: () => Promise<void>;
  handleServerMessage: (message: ServerMessage) => Promise<boolean>;
  handleRuntimeEvent: (event: WebRoomVoiceRuntimeEvent) => void;
  disconnect: (reason: string) => Promise<void>;
};

export function createWebRoomVoiceController(args: {
  getSession: () => VoiceSessionContext | null;
  getVoiceState: () => WebRoomVoiceState | null;
  setVoiceState: (voice: WebRoomVoiceState) => void;
  runtime: WebRoomVoiceRuntime;
  sendVoiceAccess: (memberToken: string) => void;
  sendVoiceState: (input: {
    memberToken: string;
    connected: boolean;
    muted: boolean;
    speaking?: boolean;
  }) => void;
  log: (message: string) => void;
}): WebRoomVoiceController {
  function updateVoiceState(
    updater: (voice: WebRoomVoiceState) => WebRoomVoiceState,
  ): void {
    const voice = args.getVoiceState();
    if (!voice) {
      return;
    }
    args.setVoiceState(updater(voice));
  }

  function requestAccess(options: { forceRefresh?: boolean } = {}): void {
    const session = args.getSession();
    if (!session) {
      return;
    }

    const voice = args.getVoiceState();
    if (!voice) {
      return;
    }

    const requestKey = `${session.roomCode}:${session.memberToken}`;
    if (
      !options.forceRefresh &&
      voice.accessRequestedFor === requestKey &&
      voice.status !== "failed" &&
      voice.status !== "unavailable"
    ) {
      return;
    }

    args.setVoiceState({
      ...ensureSelfParticipant(voice, session.memberId),
      status: "requesting",
      error: null,
      muted: true,
      roomCode: session.roomCode,
      accessRequestedFor: requestKey,
    });
    args.sendVoiceAccess(session.memberToken);
    args.log("voice access requested");
  }

  async function handleServerMessage(message: ServerMessage): Promise<boolean> {
    if (message.type === "voice:access-granted") {
      await connectWithAccess(message.payload);
      return true;
    }

    if (message.type === "voice:state") {
      const memberId =
        typeof message.payload.memberId === "string"
          ? message.payload.memberId
          : "";
      updateParticipantState({
        memberId,
        connected: message.payload.connected,
        muted: message.payload.muted,
        speaking: message.payload.speaking ?? false,
      });
      args.log("voice:state received");
      return true;
    }

    if (message.type === "error" && isVoiceErrorCode(message.payload.code)) {
      await handleVoiceError(message.payload.code, message.payload.message);
      return true;
    }

    return false;
  }

  function handleRuntimeEvent(event: WebRoomVoiceRuntimeEvent): void {
    switch (event.type) {
      case "participant-state":
        updateParticipantState({
          memberId: event.participantIdentity,
          connected: event.connected,
          muted: event.muted,
          speaking: event.speaking ?? false,
        });
        return;
      case "connection-state":
        updateVoiceState((voice) => ({
          ...voice,
          status: event.connected ? "connected" : "failed",
          error: event.connected ? null : "语音连接已断开。",
        }));
        return;
      case "audio-playback-failed":
        updateVoiceState((voice) => ({
          ...voice,
          error: event.message || "语音播放失败。",
        }));
        return;
      case "diagnostic-log":
        args.log(event.message);
        return;
    }
  }

  async function connectWithAccess(
    payload: Extract<
      ServerMessage,
      { type: "voice:access-granted" }
    >["payload"],
  ): Promise<void> {
    updateVoiceState((voice) => ({
      ...voice,
      status: "connecting",
      error: null,
      roomName: payload.roomName,
      participantIdentity: payload.participantIdentity,
      expiresAt: payload.expiresAt,
      muted: true,
    }));

    try {
      await args.runtime.connect({
        livekitUrl: payload.livekitUrl,
        token: payload.token,
        roomName: payload.roomName,
        participantIdentity: payload.participantIdentity,
      });
      updateParticipantState({
        memberId: payload.participantIdentity,
        connected: true,
        muted: true,
        speaking: false,
      });
      updateVoiceState((voice) => ({
        ...voice,
        status: "connected",
        error: null,
        muted: true,
      }));
      sendCurrentVoiceState({ connected: true, muted: true });
      args.log("voice:access-granted received");
    } catch (error) {
      updateVoiceState((voice) => ({
        ...voice,
        status: "failed",
        error: formatRuntimeError(error, "语音连接失败。"),
        muted: true,
      }));
      args.log(`voice connection failed: ${formatError(error)}`);
    }
  }

  async function toggleMicrophone(): Promise<void> {
    const voice = args.getVoiceState();
    if (!voice) {
      return;
    }

    if (voice.status !== "connected") {
      requestAccess({ forceRefresh: true });
      return;
    }

    const enabled = voice.muted;
    try {
      await args.runtime.setMicrophoneEnabled(enabled);
      updateParticipantState({
        memberId:
          args.getSession()?.memberId ?? voice.participantIdentity ?? "",
        connected: true,
        muted: !enabled,
        speaking: voice.speaking,
      });
      updateVoiceState((currentVoice) => ({
        ...currentVoice,
        muted: !enabled,
        error: null,
      }));
      sendCurrentVoiceState({ connected: true, muted: !enabled });
      args.log(enabled ? "voice microphone enabled" : "voice microphone muted");
    } catch (error) {
      updateVoiceState((currentVoice) => ({
        ...currentVoice,
        muted: true,
        error:
          error instanceof WebRoomVoiceRuntimeError && error.permissionDenied
            ? "浏览器没有授予麦克风权限。"
            : formatRuntimeError(error, "麦克风切换失败。"),
      }));
      sendCurrentVoiceState({ connected: true, muted: true });
      args.log(`voice microphone toggle failed: ${formatError(error)}`);
    }
  }

  async function disconnect(reason: string): Promise<void> {
    const voice = args.getVoiceState();
    const wasConnected =
      voice?.status === "connected" ||
      voice?.status === "connecting" ||
      voice?.status === "requesting";
    if (wasConnected) {
      sendCurrentVoiceState({ connected: false, muted: true });
    }
    try {
      await args.runtime.disconnect();
    } catch (error) {
      args.log(
        `voice disconnect ignored after ${reason}: ${formatError(error)}`,
      );
    }
    updateVoiceState((currentVoice) => ({
      ...currentVoice,
      status: "idle",
      muted: true,
      speaking: false,
      error: null,
      roomCode: null,
      roomName: null,
      participantIdentity: null,
      expiresAt: null,
      accessRequestedFor: null,
      participants: {},
    }));
    args.log(`voice state cleared (${reason})`);
  }

  async function handleVoiceError(
    code: Extract<ServerMessage, { type: "error" }>["payload"]["code"],
    message: string,
  ): Promise<void> {
    await args.runtime.disconnect();
    updateVoiceState((voice) => ({
      ...voice,
      status:
        code === "voice_unavailable" || code === "voice_capacity_reached"
          ? "unavailable"
          : "failed",
      error: localizeVoiceServerError(code, message),
      roomName: null,
      participantIdentity: null,
      expiresAt: null,
      muted: true,
      participants: {},
    }));
    args.log(`voice access rejected: ${code}`);
  }

  function sendCurrentVoiceState(input: {
    connected: boolean;
    muted: boolean;
  }): void {
    const session = args.getSession();
    const voice = args.getVoiceState();
    if (!session?.connected || !voice) {
      return;
    }
    args.sendVoiceState({
      memberToken: session.memberToken,
      connected: input.connected,
      muted: input.muted,
      speaking: voice.speaking,
    });
  }

  function updateParticipantState(state: {
    memberId: string;
    connected: boolean;
    muted: boolean;
    speaking: boolean;
  }): void {
    if (state.memberId.length === 0) {
      return;
    }
    const session = args.getSession();
    updateVoiceState((voice) => ({
      ...voice,
      muted: state.memberId === session?.memberId ? state.muted : voice.muted,
      speaking:
        state.memberId === session?.memberId ? state.speaking : voice.speaking,
      participants: {
        ...voice.participants,
        [state.memberId]: {
          memberId: state.memberId,
          connected: state.connected,
          muted: state.muted,
          speaking: state.speaking,
        },
      },
    }));
  }

  return {
    requestAccess,
    toggleMicrophone,
    handleServerMessage,
    handleRuntimeEvent,
    disconnect,
  };
}

function ensureSelfParticipant(
  voice: WebRoomVoiceState,
  memberId: string,
): WebRoomVoiceState {
  if (voice.participants[memberId]) {
    return voice;
  }
  return {
    ...voice,
    participants: {
      ...voice.participants,
      [memberId]: {
        memberId,
        connected: false,
        muted: true,
        speaking: false,
      },
    },
  };
}

function isVoiceErrorCode(code: string): boolean {
  return (
    code === "voice_unavailable" ||
    code === "voice_capacity_reached" ||
    code === "voice_token_failed"
  );
}

function localizeVoiceServerError(code: string, fallback: string): string {
  if (code === "voice_unavailable") {
    return "语音服务不可用。";
  }
  if (code === "voice_capacity_reached") {
    return "语音房间人数已满。";
  }
  if (code === "voice_token_failed") {
    return "语音凭证签发失败。";
  }
  return fallback;
}

function formatRuntimeError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
