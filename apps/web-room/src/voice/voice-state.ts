export type WebRoomVoiceConnectionStatus =
  | "idle"
  | "requesting"
  | "connecting"
  | "connected"
  | "unavailable"
  | "failed";

export type WebRoomVoiceParticipantState = {
  memberId: string;
  connected: boolean;
  muted: boolean;
  speaking: boolean;
};

export type WebRoomVoiceState = {
  status: WebRoomVoiceConnectionStatus;
  muted: boolean;
  speaking: boolean;
  error: string | null;
  roomCode: string | null;
  roomName: string | null;
  participantIdentity: string | null;
  expiresAt: number | null;
  accessRequestedFor: string | null;
  participants: Record<string, WebRoomVoiceParticipantState>;
};

export function createInitialWebRoomVoiceState(): WebRoomVoiceState {
  return {
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
  };
}
