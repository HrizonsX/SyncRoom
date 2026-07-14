import type {
  WebRoomChatMessage,
  WebRoomJoinedState,
  WebRoomSystemChatEventType,
} from "../ui/render.js";

type RecordLike = Record<string, unknown>;

export const CHAT_SUCCESS_COOLDOWN_MS = 5_000;
export const DANMAKU_SUCCESS_COOLDOWN_MS = 1_000;

const ROOM_CHAT_HISTORY_LIMIT = 200;
const SYSTEM_CHAT_SUFFIX: Record<WebRoomSystemChatEventType, string> = {
  member_joined: "加入了房间",
  member_left: "离开了房间",
  voice_unmuted: "开启了麦克风",
  voice_muted: "关闭了麦克风",
};

function isRecord(value: unknown): value is RecordLike {
  return typeof value === "object" && value !== null;
}

function getString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function getFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function appendChatMessage(
  state: WebRoomJoinedState,
  message: WebRoomChatMessage,
): WebRoomChatMessage[] {
  return [...state.chatMessages, message].slice(-ROOM_CHAT_HISTORY_LIMIT);
}

function getChatMessageKey(message: WebRoomChatMessage): string {
  return [
    message.kind ?? "user",
    message.systemEventType ?? "",
    message.memberId,
    message.timestamp,
    message.content,
  ].join(":");
}

export function readRoomChatHistory(
  value: unknown,
): WebRoomChatMessage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .filter(isRecord)
    .map((item) => {
      const timestamp = getFiniteNumber(item.timestamp);
      const kind: WebRoomChatMessage["kind"] =
        item.kind === "system" ? "system" : undefined;
      const systemEventType: WebRoomSystemChatEventType | undefined =
        item.systemEventType === "member_joined" ||
        item.systemEventType === "member_left" ||
        item.systemEventType === "voice_unmuted" ||
        item.systemEventType === "voice_muted"
          ? item.systemEventType
          : undefined;
      return {
        ...(kind ? { kind } : {}),
        ...(systemEventType ? { systemEventType } : {}),
        memberId: getString(item.memberId),
        displayName: getString(item.displayName, "匿名成员"),
        content: getString(item.content),
        timestamp: timestamp ?? Date.now(),
      };
    })
    .filter(
      (message) =>
        message.memberId.length > 0 &&
        message.content.trim().length > 0 &&
        Number.isFinite(message.timestamp),
    )
    .slice(-ROOM_CHAT_HISTORY_LIMIT);
}

export function mergeChatMessages(
  currentMessages: WebRoomChatMessage[],
  incomingMessages: WebRoomChatMessage[] | undefined,
): WebRoomChatMessage[] {
  if (!incomingMessages) {
    return currentMessages;
  }

  const merged = new Map<string, WebRoomChatMessage>();
  for (const message of [...currentMessages, ...incomingMessages]) {
    merged.set(getChatMessageKey(message), message);
  }
  // 刷新重连时服务端会回放最近聊天记录；按稳定 key 合并，避免同一条消息重复出现。
  return Array.from(merged.values())
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-ROOM_CHAT_HISTORY_LIMIT);
}

export function getSystemChatDisplayName(
  state: WebRoomJoinedState,
  memberId: string,
  fallback?: string,
): string {
  const fallbackName = fallback?.trim();
  if (fallbackName) {
    return fallbackName;
  }

  const memberName = state.members.find(
    (member) => member.id === memberId,
  )?.name;
  if (memberName?.trim()) {
    return memberName;
  }

  if (memberId === state.currentMemberId && state.displayName.trim()) {
    return state.displayName;
  }

  return "匿名成员";
}

export function appendSystemChatMessage(
  state: WebRoomJoinedState,
  input: {
    memberId: string;
    displayName?: string;
    eventType: WebRoomSystemChatEventType;
    timestamp: number;
  },
): WebRoomJoinedState {
  if (input.memberId.length === 0) {
    return state;
  }

  const displayName = getSystemChatDisplayName(
    state,
    input.memberId,
    input.displayName,
  );

  return {
    ...state,
    chatMessages: appendChatMessage(state, {
      kind: "system",
      systemEventType: input.eventType,
      memberId: input.memberId,
      displayName,
      content: `${displayName} ${SYSTEM_CHAT_SUFFIX[input.eventType]}`,
      timestamp: input.timestamp,
    }),
  };
}
