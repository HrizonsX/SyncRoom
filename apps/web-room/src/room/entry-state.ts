import type { ServerMessage } from "@syncroom/protocol";
import type { WebRoomState, WebRoomThemeMode } from "../ui/render.js";
import { formatRoomJoinInvite } from "./actions.js";

type EntryStateInput = {
  roomCode?: string;
  joinToken?: string;
  displayName?: string;
};

export function createEntryState(
  serverUrl: string,
  input: EntryStateInput = {},
  themeMode: WebRoomThemeMode = "light",
): WebRoomState {
  const roomInvite =
    input.roomCode && input.joinToken
      ? formatRoomJoinInvite({
          roomCode: input.roomCode,
          joinToken: input.joinToken,
        })
      : [input.roomCode, input.joinToken].filter(Boolean).join(" ");
  return {
    view: "entry",
    connectionState: "disconnected",
    themeMode,
    serverUrl,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(roomInvite ? { roomInvite } : {}),
    ...(input.roomCode ? { roomCode: input.roomCode } : {}),
    ...(input.joinToken ? { joinToken: input.joinToken } : {}),
  };
}

export function setConnectionState(
  state: WebRoomState,
  connectionState: WebRoomState["connectionState"],
): WebRoomState {
  return { ...state, connectionState };
}

export function withEntryError(
  state: WebRoomState,
  errorMessage: string,
): WebRoomState {
  if (state.view === "entry") {
    return {
      ...state,
      connectionState: "disconnected",
      errorMessage,
    };
  }
  return {
    ...state,
    connectionState: "disconnected",
    diagnostics: [...state.diagnostics, errorMessage].slice(-80),
  };
}

export function localizeEntryServerError(
  payload: Extract<ServerMessage, { type: "error" }>["payload"],
): string {
  if (payload.code === "room_not_found") {
    return "房间不存在或已失效。";
  }
  if (payload.code === "join_token_invalid") {
    return "加入口令无效，请检查房间邀请。";
  }
  return payload.message || "加入房间失败。";
}
