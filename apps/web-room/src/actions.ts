import type { WebRoomAppController } from "./app-controller.js";
import type { WebRoomAuthMethod } from "./render.js";

const ROOM_CODE_PATTERN = /\b([a-z0-9]{6})\b/i;
const JOIN_TOKEN_LABEL_PATTERN =
  /(?:加入口令|口令号|口令|joinToken|token)\s*[:：]?\s*([^\s]+)/i;

type ImmediateActionController = Pick<
  WebRoomAppController,
  "toggleVoice" | "setBilibiliAuthMethod" | "startBilibiliAuth"
>;

export function formatRoomJoinInvite(input: {
  roomCode: string;
  joinToken: string;
}): string {
  return `房间号：${input.roomCode} 口令：${input.joinToken}`;
}

export function parseRoomJoinInvite(text: string): {
  roomCode?: string;
  joinToken?: string;
} {
  const roomCode = text.match(ROOM_CODE_PATTERN)?.[1]?.toUpperCase();
  const labeledToken = text.match(JOIN_TOKEN_LABEL_PATTERN)?.[1];
  if (roomCode && labeledToken) {
    return { roomCode, joinToken: labeledToken.trim() };
  }

  const tokens = text
    .replace(ROOM_CODE_PATTERN, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const joinToken = tokens.find(
    (item) =>
      !["房间号", "口令", "口令号", "加入口令"].includes(item) &&
      item.length >= 8,
  );

  return {
    ...(roomCode ? { roomCode } : {}),
    ...(joinToken ? { joinToken } : {}),
  };
}

export function handleWebRoomImmediateAction(input: {
  action: string;
  controller: ImmediateActionController;
}): boolean {
  if (input.action === "voice-toggle") {
    input.controller.toggleVoice();
    return true;
  }

  if (input.action === "bilibili-auth-method-qr") {
    const method: WebRoomAuthMethod = "qr";
    input.controller.setBilibiliAuthMethod(method);
    void input.controller.startBilibiliAuth({ method });
    return true;
  }

  return false;
}
