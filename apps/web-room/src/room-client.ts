import type {
  ClientMessage,
  DanmakuMode,
  PlaybackState,
  SharedVideo,
  VideoProviderId,
  WebPlaybackBrowserLabel,
  WebPlaybackReportEvent,
  WebPlaybackSystemLabel,
  WebPlayerErrorStage,
} from "@syncroom/protocol";

const WEB_ROOM_PROTOCOL_VERSION = 3;
export const WEB_ROOM_SESSION_STORAGE_KEY = "syncroom:web-room-session";
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
  send: (data: string) => void;
  close?: () => void;
  addEventListener?: (
    type: "open" | "message" | "close" | "error",
    listener: (event: { data?: unknown }) => void,
  ) => void;
};

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

export function normalizeServerUrlToWebSocket(serverUrl: string): string {
  const parsedUrl = new URL(serverUrl);
  if (parsedUrl.protocol === "https:") {
    parsedUrl.protocol = "wss:";
  } else if (parsedUrl.protocol === "http:") {
    parsedUrl.protocol = "ws:";
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

function sendJson(socket: WebSocketLike, message: unknown): void {
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

export function persistWebRoomSession(
  storage: StorageLike,
  state: Partial<PersistedWebRoomSession> & Record<string, unknown>,
): void {
  const safeState: PersistedWebRoomSession = {
    roomCode: String(state.roomCode ?? ""),
    joinToken: String(state.joinToken ?? ""),
    memberToken: String(state.memberToken ?? ""),
    displayName: String(state.displayName ?? ""),
    serverUrl: String(state.serverUrl ?? ""),
  };
  storage.setItem(WEB_ROOM_SESSION_STORAGE_KEY, JSON.stringify(safeState));
}

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
