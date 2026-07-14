import type {
  ClientMessage,
  DanmakuMode,
  PlaybackBufferReport,
  PlaybackSyncStrategy,
  PlaybackState,
  RoomMemberPermissionName,
  SharedVideo,
  VideoProviderId,
  WebPlaybackBrowserLabel,
  WebPlaybackReportEvent,
  WebPlaybackSystemLabel,
  WebPlayerErrorStage,
} from "@syncroom/protocol";

const WEB_ROOM_PROTOCOL_VERSION = 3;
export const WEB_ROOM_SESSION_STORAGE_KEY = "syncroom:web-room-session";
const SECURE_WEB_SOCKET_PATH = "/syncroom-ws";
const TOKEN_MIN_LENGTH = 16;
const TOKEN_MAX_LENGTH = 128;
const DISPLAY_NAME_MAX_LENGTH = 32;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export type WebSocketLike = {
  OPEN?: number;
  readyState?: number;
  send: (data: string) => void;
  close?: () => void;
  addEventListener?: (
    type: "open" | "message" | "close" | "error",
    listener: (event: { data?: unknown }) => void,
  ) => void;
};

const DEFAULT_OPEN_READY_STATE = 1;

export type WebRoomSocketClientOptions = {
  serverUrl: string;
  socketFactory?: (url: string) => WebSocketLike;
  onOpen?: () => void;
  onMessage?: (message: unknown) => void;
  onClose?: () => void;
  onError?: () => void;
};

export type PersistedWebRoomSession = {
  roomCode: string;
  joinToken: string;
  memberToken: string;
  displayName: string;
  serverUrl: string;
};

type JoinRoomInput = Omit<PersistedWebRoomSession, "serverUrl">;
type JoinRoomRequest = Omit<JoinRoomInput, "memberToken"> & {
  memberToken?: string;
};

type VoiceStateInput = {
  memberToken: string;
  connected: boolean;
  muted: boolean;
  speaking?: boolean;
};

type ChatMessageInput = {
  memberToken: string;
  content: string;
};

type DanmakuMessageInput = {
  memberToken: string;
  content: string;
  videoTime: number;
  mode?: DanmakuMode;
  color?: string;
};

type ShareVideoInput = {
  memberToken: string;
  video: SharedVideo;
  playback?: PlaybackState;
};

type PlaybackReportInput = {
  memberToken: string;
  event: WebPlaybackReportEvent;
  providerId?: VideoProviderId;
  stage?: WebPlayerErrorStage;
  browser?: WebPlaybackBrowserLabel;
  system?: WebPlaybackSystemLabel;
};

type PlaybackBufferReportInput = {
  memberToken: string;
} & PlaybackBufferReport;

type PlaybackSyncStrategyInput = {
  memberToken: string;
  strategy: PlaybackSyncStrategy;
};

type MemberPermissionInput = {
  memberToken: string;
  targetMemberId: string;
  permission: RoomMemberPermissionName;
  allowed: boolean;
};

type MemberManagementInput = {
  memberToken: string;
  targetMemberId: string;
};

function isToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= TOKEN_MIN_LENGTH &&
    value.length <= TOKEN_MAX_LENGTH
  );
}

function isDisplayName(value: unknown): value is string {
  return typeof value === "string" && value.length <= DISPLAY_NAME_MAX_LENGTH;
}

function isServerUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  try {
    const parsedUrl = new URL(value);
    return ["http:", "https:", "ws:", "wss:"].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

/**
 * 把用户输入的 HTTP/HTTPS/WS 地址规范化为房间 WebSocket 地址。
 */
export function normalizeServerUrlToWebSocket(serverUrl: string): string {
  const parsedUrl = new URL(serverUrl);
  const shouldUseSecureProxyPath =
    parsedUrl.protocol === "https:" && parsedUrl.pathname === "/";
  if (parsedUrl.protocol === "https:") {
    parsedUrl.protocol = "wss:";
  } else if (parsedUrl.protocol === "http:") {
    parsedUrl.protocol = "ws:";
  }
  if (shouldUseSecureProxyPath) {
    parsedUrl.pathname = SECURE_WEB_SOCKET_PATH;
  }

  const serialized = parsedUrl.toString();
  if (
    parsedUrl.pathname === "/" &&
    parsedUrl.search === "" &&
    parsedUrl.hash === ""
  ) {
    return serialized.slice(0, -1);
  }
  return serialized;
}

function isSocketOpen(socket: WebSocketLike): boolean {
  if (typeof socket.readyState !== "number") {
    return true;
  }
  const openReadyState =
    typeof socket.OPEN === "number" ? socket.OPEN : DEFAULT_OPEN_READY_STATE;
  return socket.readyState === openReadyState;
}

function sendJson(socket: WebSocketLike, message: unknown): void {
  if (!isSocketOpen(socket)) {
    return;
  }
  socket.send(JSON.stringify(message));
}

function parseSocketMessage(data: unknown): unknown {
  if (typeof data !== "string") {
    return data;
  }

  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function bindSocketEvents(
  socket: WebSocketLike,
  options: WebRoomSocketClientOptions,
): void {
  socket.addEventListener?.("open", () => options.onOpen?.());
  socket.addEventListener?.("message", (event) => {
    options.onMessage?.(parseSocketMessage(event.data));
  });
  socket.addEventListener?.("close", () => options.onClose?.());
  socket.addEventListener?.("error", () => options.onError?.());
}

/**
 * 封装网页房间与后端 WebSocket 的消息发送接口，隐藏具体协议消息组装细节。
 */
export function createWebRoomSocketClient(options: WebRoomSocketClientOptions) {
  const socket = (options.socketFactory ?? ((url) => new WebSocket(url)))(
    normalizeServerUrlToWebSocket(options.serverUrl),
  );
  bindSocketEvents(socket, options);

  return {
    createRoom(displayName?: string): void {
      sendJson(socket, {
        type: "room:create",
        payload: {
          ...(displayName ? { displayName } : {}),
          protocolVersion: WEB_ROOM_PROTOCOL_VERSION,
        },
      });
    },

    joinRoom(input: JoinRoomRequest): void {
      sendJson(socket, {
        type: "room:join",
        payload: {
          roomCode: input.roomCode,
          joinToken: input.joinToken,
          ...(input.memberToken ? { memberToken: input.memberToken } : {}),
          displayName: input.displayName,
          protocolVersion: WEB_ROOM_PROTOCOL_VERSION,
        },
      });
    },

    leaveRoom(memberToken: string): void {
      sendJson(socket, {
        type: "room:leave",
        payload: { memberToken },
      });
    },

    requestSync(memberToken: string): void {
      sendJson(socket, {
        type: "sync:request",
        payload: { memberToken },
      });
    },

    sendChat(input: ChatMessageInput): void {
      sendJson(socket, {
        type: "chat:message",
        payload: {
          memberToken: input.memberToken,
          content: input.content,
        },
      });
    },

    sendDanmaku(input: DanmakuMessageInput): void {
      sendJson(socket, {
        type: "danmaku:message",
        payload: {
          memberToken: input.memberToken,
          content: input.content,
          videoTime: input.videoTime,
          mode: input.mode ?? "scroll",
          ...(input.color ? { color: input.color } : {}),
        },
      });
    },

    setRoomMemberPermission(input: MemberPermissionInput): void {
      sendJson(socket, {
        type: "room:member-permission:set",
        payload: {
          memberToken: input.memberToken,
          targetMemberId: input.targetMemberId,
          permission: input.permission,
          allowed: input.allowed,
        },
      });
    },

    kickRoomMember(input: MemberManagementInput): void {
      sendJson(socket, {
        type: "room:member:kick",
        payload: {
          memberToken: input.memberToken,
          targetMemberId: input.targetMemberId,
        },
      });
    },

    transferRoomHost(input: MemberManagementInput): void {
      sendJson(socket, {
        type: "room:host:transfer",
        payload: {
          memberToken: input.memberToken,
          targetMemberId: input.targetMemberId,
        },
      });
    },

    shareVideo(input: ShareVideoInput): void {
      sendJson(socket, {
        type: "video:share",
        payload: {
          memberToken: input.memberToken,
          video: input.video,
          ...(input.playback ? { playback: input.playback } : {}),
        },
      });
    },

    reportPlayback(input: PlaybackReportInput): void {
      sendJson(socket, {
        type: "playback:report",
        payload: {
          memberToken: input.memberToken,
          event: input.event,
          ...(input.providerId ? { providerId: input.providerId } : {}),
          ...(input.stage ? { stage: input.stage } : {}),
          ...(input.browser ? { browser: input.browser } : {}),
          ...(input.system ? { system: input.system } : {}),
        },
      });
    },

    reportPlaybackBuffer(input: PlaybackBufferReportInput): void {
      sendJson(socket, {
        type: "playback:buffer",
        payload: {
          memberToken: input.memberToken,
          state: input.state,
          currentTime: input.currentTime,
          ...(input.bufferAheadSeconds === undefined
            ? {}
            : { bufferAheadSeconds: input.bufferAheadSeconds }),
          ...(input.playbackRevision
            ? { playbackRevision: input.playbackRevision }
            : {}),
        },
      });
    },

    setPlaybackSyncStrategy(input: PlaybackSyncStrategyInput): void {
      sendJson(socket, {
        type: "playback:sync-strategy:set",
        payload: {
          memberToken: input.memberToken,
          strategy: input.strategy,
        },
      });
    },

    updatePlayback(
      message: Extract<ClientMessage, { type: "playback:update" }>,
    ): void {
      sendJson(socket, message);
    },

    ping(clientSendTime: number): void {
      sendJson(socket, {
        type: "sync:ping",
        payload: { clientSendTime },
      });
    },

    requestVoiceAccess(memberToken: string): void {
      sendJson(socket, {
        type: "voice:access",
        payload: { memberToken },
      });
    },

    updateVoiceState(input: VoiceStateInput): void {
      sendJson(socket, {
        type: "voice:state",
        payload: {
          memberToken: input.memberToken,
          connected: input.connected,
          muted: input.muted,
          ...(input.speaking === undefined ? {} : { speaking: input.speaking }),
        },
      });
    },

    close(): void {
      socket.close?.();
    },
  };
}

export type WebRoomSocketClient = ReturnType<typeof createWebRoomSocketClient>;

/**
 * 只持久化刷新重连需要的安全字段，避免把临时 UI 状态写入浏览器存储。
 */
export function persistWebRoomSession(
  storage: StorageLike,
  state: Partial<PersistedWebRoomSession> & Record<string, unknown>,
): void {
  // 只持久化刷新重连需要的安全字段，避免把临时 UI 状态或后端响应整包塞进 storage。
  const safeState: PersistedWebRoomSession = {
    roomCode: String(state.roomCode ?? ""),
    joinToken: String(state.joinToken ?? ""),
    memberToken: String(state.memberToken ?? ""),
    displayName: String(state.displayName ?? ""),
    serverUrl: String(state.serverUrl ?? ""),
  };
  storage.setItem(WEB_ROOM_SESSION_STORAGE_KEY, JSON.stringify(safeState));
}

/**
 * 从浏览器存储读取并校验可恢复的房间会话；发现脏数据时主动清理。
 */
export function loadWebRoomSession(
  storage: StorageLike,
): PersistedWebRoomSession | null {
  const rawValue = storage.getItem(WEB_ROOM_SESSION_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    storage.removeItem(WEB_ROOM_SESSION_STORAGE_KEY);
    return null;
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("roomCode" in value) ||
    !("joinToken" in value) ||
    !("memberToken" in value) ||
    !("displayName" in value) ||
    !("serverUrl" in value)
  ) {
    storage.removeItem(WEB_ROOM_SESSION_STORAGE_KEY);
    return null;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.roomCode !== "string" ||
    !ROOM_CODE_PATTERN.test(candidate.roomCode) ||
    !isToken(candidate.joinToken) ||
    !isToken(candidate.memberToken) ||
    !isDisplayName(candidate.displayName) ||
    !isServerUrl(candidate.serverUrl)
  ) {
    storage.removeItem(WEB_ROOM_SESSION_STORAGE_KEY);
    return null;
  }

  return {
    roomCode: candidate.roomCode,
    joinToken: candidate.joinToken,
    memberToken: candidate.memberToken,
    displayName: candidate.displayName,
    serverUrl: candidate.serverUrl,
  };
}

export function clearWebRoomSession(storage: StorageLike): void {
  storage.removeItem(WEB_ROOM_SESSION_STORAGE_KEY);
}
