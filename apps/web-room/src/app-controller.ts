import {
  parseSharedVideoRef,
  type ClientMessage,
  type PlaybackProxyPolicy,
  type PlaybackState,
  type ProviderPlaybackDescriptor,
  type RoomMemberPermissionName,
  type ServerMessage,
  type SharedVideo,
  type VideoProviderId,
  type WebPlaybackReportEvent,
} from "@syncroom/protocol";
import type {
  WebRoomAuthMethod,
  WebRoomPlaybackErrorStage,
  WebRoomProviderPickerItem,
  WebRoomProviderPickerState,
  WebRoomState,
  WebRoomThemeMode,
} from "./render.js";
import { formatRoomJoinInvite } from "./actions.js";
import {
  appendSystemChatMessage,
  applyServerMessage,
  createInitialJoinedState,
} from "./state.js";
import {
  clearWebRoomSession,
  createWebRoomSocketClient,
  loadWebRoomSession,
  persistWebRoomSession,
  type PersistedWebRoomSession,
  type StorageLike,
  type WebRoomSocketClient,
  type WebRoomSocketClientOptions,
} from "./room-client.js";
import { isMemberPermissionAllowed } from "./member-permissions.js";
import { createWebRoomVoiceController } from "./voice-controller.js";
import {
  createUnavailableVoiceRuntime,
  type WebRoomVoiceRuntimeEvent,
  type WebRoomVoiceRuntime,
} from "./voice-runtime.js";
import type {
  BilibiliAuthFlowResult,
  BilibiliAuthPollResult,
  BilibiliAuthStatusResult,
  ProviderApiError,
  ProviderApiClient,
} from "./provider-api-client.js";

export const DEFAULT_WEB_ROOM_SERVER_URL = "ws://localhost:8787";
export const WEB_ROOM_IDENTITY_STORAGE_KEY = "syncroom:web-room-identity";
export const WEB_ROOM_THEME_STORAGE_KEY = "syncroom:web-room-theme";

export type WebRoomPageLocation = Pick<
  Location,
  "protocol" | "host" | "hostname"
>;

const DEFAULT_DISPLAY_NAME = "网页用户";
const DEFAULT_AUTH_POLL_INTERVAL_MS = 2_000;
const CLOCK_SYNC_INTERVAL_MS = 60_000;
const DANMAKU_SEND_COOLDOWN_MS = 1_000;
const TRANSIENT_VOICE_ERROR_MS = 3_000;
const TRANSIENT_PLAYBACK_ERROR_MS = 10_000;
const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;
const DISPLAY_NAME_SUFFIX_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SERVER_MESSAGE_TYPES = new Set([
  "room:created",
  "room:joined",
  "room:state",
  "room:member-joined",
  "room:member-left",
  "error",
  "sync:pong",
  "voice:access-granted",
  "voice:state",
  "announcement:update",
  "chat:message",
  "danmaku:message",
]);
const BILIBILI_PROVIDER_HOSTS = new Set([
  "bilibili.com",
  "www.bilibili.com",
  "m.bilibili.com",
  "live.bilibili.com",
  "bangumi.bilibili.com",
  "b23.tv",
  "www.b23.tv",
]);
const IQIYI_PROVIDER_HOSTS = new Set([
  "iqiyi.com",
  "www.iqiyi.com",
  "m.iqiyi.com",
  "iq.com",
  "www.iq.com",
]);
const HUYA_PROVIDER_HOSTS = new Set(["huya.com", "www.huya.com", "m.huya.com"]);

function getProviderIdForParseUrl(url: string): VideoProviderId {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BILIBILI_PROVIDER_HOSTS.has(hostname) ||
      hostname.endsWith(".bilibili.com")
      ? "bilibili"
      : IQIYI_PROVIDER_HOSTS.has(hostname) ||
          hostname.endsWith(".iqiyi.com") ||
          hostname.endsWith(".iq.com")
        ? "iqiyi"
        : HUYA_PROVIDER_HOSTS.has(hostname) || hostname.endsWith(".huya.com")
          ? "huya"
          : "generic";
  } catch {
    return "generic";
  }
}

export type CreateRoomInput = {
  serverUrl?: string;
  displayName?: string;
};

export type JoinRoomInput = {
  serverUrl?: string;
  roomCode?: string;
  joinToken?: string;
  displayName?: string;
  memberToken?: string;
};

type AuthPollTimeoutHandle = unknown;
type AuthPollTimeoutScheduler = (
  callback: () => void,
  delayMs: number,
) => AuthPollTimeoutHandle;
type AuthPollTimeoutClearer = (handle: AuthPollTimeoutHandle) => void;
type ClockSyncIntervalHandle = unknown;
type ClockSyncIntervalScheduler = (
  callback: () => void,
  delayMs: number,
) => ClockSyncIntervalHandle;
type ClockSyncIntervalClearer = (handle: ClockSyncIntervalHandle) => void;

export type WebRoomAppControllerOptions = {
  storage?: StorageLike;
  socketFactory?: WebRoomSocketClientOptions["socketFactory"];
  defaultServerUrl?: string;
  pageLocation?: WebRoomPageLocation;
  autoReconnect?: boolean;
  onStateChange?: (state: WebRoomState) => void;
  now?: () => number;
  authPollIntervalMs?: number;
  setAuthPollTimeout?: AuthPollTimeoutScheduler;
  clearAuthPollTimeout?: AuthPollTimeoutClearer;
  setClockSyncInterval?: ClockSyncIntervalScheduler;
  clearClockSyncInterval?: ClockSyncIntervalClearer;
  providerApiClientFactory?: (serverUrl: string) => ProviderApiClient;
  voiceRuntime?: WebRoomVoiceRuntime;
  voiceRuntimeFactory?: (args: {
    onEvent: (event: WebRoomVoiceRuntimeEvent) => void;
    log: (message: string) => void;
  }) => WebRoomVoiceRuntime;
  random?: () => number;
};

export type WebRoomAppController = {
  getState: () => WebRoomState;
  createRoom: (input?: CreateRoomInput) => void;
  joinRoom: (input: JoinRoomInput) => void;
  sendChat: (content: string) => boolean;
  sendDanmaku: (
    content: string,
    options: { videoTime: number; color?: string },
  ) => boolean;
  setRoomMemberPermission: (input: {
    targetMemberId: string;
    permission: RoomMemberPermissionName;
    allowed: boolean;
  }) => void;
  kickRoomMember: (targetMemberId: string) => void;
  transferRoomHost: (targetMemberId: string) => void;
  requestVoiceAccess: () => void;
  toggleVoice: () => void;
  toggleVoiceMicrophone: () => Promise<void>;
  toggleThemeMode: () => void;
  leaveRoom: () => void;
  openAuthorizationPanel: () => void;
  setBilibiliAuthMethod: (method: WebRoomAuthMethod) => void;
  startProviderAuth: (input: {
    providerId: VideoProviderId;
    method: WebRoomAuthMethod;
  }) => Promise<void>;
  startBilibiliAuth: (input: { method: WebRoomAuthMethod }) => Promise<void>;
  logoutBilibiliAuth: () => Promise<void>;
  closeAuthorizationPanel: () => void;
  collapseBilibiliAuth: () => void;
  openProviderPicker: () => void;
  parseBilibiliUrl: (input: {
    url: string;
    proxy: boolean;
    shared: boolean;
  }) => Promise<void>;
  setProviderPickerResults: (input: {
    items: WebRoomProviderPickerItem[];
    message?: string;
  }) => void;
  selectProviderItem: (itemId: string) => void;
  selectProviderQuality: (candidateId: string) => void;
  setProviderPlaybackPolicy: (policy: {
    proxy?: boolean;
    shared?: boolean;
    url?: string;
  }) => void;
  shareSelectedProviderItem: () => void;
  showDirectPlaybackFailure: (input: {
    stage: WebRoomPlaybackErrorStage;
    message: string;
  }) => void;
  retryProviderProxyFallback: () => Promise<void>;
  reportPlaybackLoaded: () => void;
  getPlaybackSyncContext: () => {
    memberToken: string;
    actorId: string;
    url: string;
  } | null;
  sendPlaybackUpdate: (
    message: Extract<ClientMessage, { type: "playback:update" }>,
  ) => void;
};

type PendingAction =
  | {
      type: "create";
      displayName: string;
      serverUrl: string;
    }
  | {
      type: "join";
      roomCode: string;
      joinToken: string;
      memberToken?: string;
      displayName: string;
      serverUrl: string;
      reconnect?: boolean;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isServerMessage(value: unknown): value is ServerMessage {
  return (
    isRecord(value) &&
    typeof value.type === "string" &&
    SERVER_MESSAGE_TYPES.has(value.type) &&
    isRecord(value.payload)
  );
}

function isVoiceServerMessage(message: ServerMessage): boolean {
  return (
    message.type === "voice:access-granted" ||
    message.type === "voice:state" ||
    (message.type === "error" &&
      (message.payload.code === "voice_unavailable" ||
        message.payload.code === "voice_capacity_reached" ||
        message.payload.code === "voice_token_failed"))
  );
}

function getDisplayName(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, 32) : "";
}

function createDefaultDisplayName(random: () => number = Math.random): string {
  const suffix = Array.from({ length: 2 }, () => {
    const index = Math.floor(random() * DISPLAY_NAME_SUFFIX_ALPHABET.length);
    return DISPLAY_NAME_SUFFIX_ALPHABET[
      Math.min(index, DISPLAY_NAME_SUFFIX_ALPHABET.length - 1)
    ];
  }).join("");
  return `${DEFAULT_DISPLAY_NAME}${suffix}`;
}

function loadBrowserDisplayName(storage: StorageLike): string | null {
  const rawValue = storage.getItem(WEB_ROOM_IDENTITY_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    storage.removeItem(WEB_ROOM_IDENTITY_STORAGE_KEY);
    return null;
  }

  if (!isRecord(value) || typeof value.displayName !== "string") {
    storage.removeItem(WEB_ROOM_IDENTITY_STORAGE_KEY);
    return null;
  }

  const displayName = getDisplayName(value.displayName);
  if (!displayName) {
    storage.removeItem(WEB_ROOM_IDENTITY_STORAGE_KEY);
    return null;
  }

  return displayName;
}

function persistBrowserDisplayName(
  storage: StorageLike | undefined,
  displayName: string,
): void {
  const safeDisplayName = getDisplayName(displayName);
  if (!storage || !safeDisplayName) {
    return;
  }

  storage.setItem(
    WEB_ROOM_IDENTITY_STORAGE_KEY,
    JSON.stringify({ displayName: safeDisplayName }),
  );
}

function unrefTimerHandle(handle: unknown): void {
  if (!isRecord(handle)) {
    return;
  }
  const unref = handle.unref;
  if (typeof unref === "function") {
    unref.call(handle);
  }
}

function getBrowserDisplayName(
  storage: StorageLike | undefined,
  random: () => number,
): string {
  if (storage) {
    const persistedDisplayName = loadBrowserDisplayName(storage);
    if (persistedDisplayName) {
      return persistedDisplayName;
    }
  }

  const displayName = createDefaultDisplayName(random);
  persistBrowserDisplayName(storage, displayName);
  return displayName;
}

function resolveBrowserDisplayName(
  value: string | undefined,
  storage: StorageLike | undefined,
  random: () => number,
): string {
  const displayName = getDisplayName(value);
  if (displayName) {
    return displayName;
  }

  return getBrowserDisplayName(storage, random);
}

function isWebRoomThemeMode(value: unknown): value is WebRoomThemeMode {
  return value === "light" || value === "dark";
}

function loadWebRoomThemeMode(
  storage: StorageLike | undefined,
): WebRoomThemeMode {
  if (!storage) {
    return "light";
  }

  const value = storage.getItem(WEB_ROOM_THEME_STORAGE_KEY);
  if (isWebRoomThemeMode(value)) {
    return value;
  }
  if (value !== null) {
    storage.removeItem(WEB_ROOM_THEME_STORAGE_KEY);
  }
  return "light";
}

function persistWebRoomThemeMode(
  storage: StorageLike | undefined,
  themeMode: WebRoomThemeMode,
): void {
  storage?.setItem(WEB_ROOM_THEME_STORAGE_KEY, themeMode);
}

function getServerUrl(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function readCurrentPageLocation(): WebRoomPageLocation | undefined {
  return typeof globalThis.location === "object" && globalThis.location !== null
    ? globalThis.location
    : undefined;
}

function isLocalWebRoomHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

export function resolveDefaultWebRoomServerUrl(
  pageLocation: WebRoomPageLocation | undefined = readCurrentPageLocation(),
): string {
  if (!pageLocation?.protocol || !pageLocation.host) {
    return DEFAULT_WEB_ROOM_SERVER_URL;
  }

  if (pageLocation.protocol === "https:") {
    return `https://${pageLocation.host}`;
  }

  if (
    pageLocation.protocol === "http:" &&
    pageLocation.hostname &&
    !isLocalWebRoomHost(pageLocation.hostname)
  ) {
    return `http://${pageLocation.hostname}:8787`;
  }

  return DEFAULT_WEB_ROOM_SERVER_URL;
}

export function coerceWebRoomServerUrlForPage(
  serverUrl: string,
  pageLocation: WebRoomPageLocation | undefined = readCurrentPageLocation(),
): string {
  if (pageLocation?.protocol !== "https:") {
    return serverUrl;
  }

  try {
    const parsedUrl = new URL(serverUrl);
    if (
      (parsedUrl.protocol === "ws:" || parsedUrl.protocol === "http:") &&
      parsedUrl.hostname === pageLocation.hostname
    ) {
      return `https://${pageLocation.host}`;
    }
  } catch {
    return serverUrl;
  }

  return serverUrl;
}

function getRoomCode(value: string | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

function createEntryState(
  serverUrl: string,
  input: Partial<JoinRoomInput> = {},
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

function setConnectionState(
  state: WebRoomState,
  connectionState: WebRoomState["connectionState"],
): WebRoomState {
  return { ...state, connectionState };
}

function withEntryError(
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

function localizeEntryServerError(
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

export function createWebRoomAppController(
  options: WebRoomAppControllerOptions = {},
): WebRoomAppController {
  const pageLocation = options.pageLocation ?? readCurrentPageLocation();
  const defaultServerUrl =
    options.defaultServerUrl ?? resolveDefaultWebRoomServerUrl(pageLocation);
  const storage = options.storage;
  const persistedSession = storage ? loadWebRoomSession(storage) : null;
  const persistedServerUrl = persistedSession?.serverUrl
    ? coerceWebRoomServerUrlForPage(persistedSession.serverUrl, pageLocation)
    : undefined;
  const random = options.random ?? Math.random;
  const browserDisplayName = getBrowserDisplayName(storage, random);
  const browserThemeMode = loadWebRoomThemeMode(storage);
  let state: WebRoomState = createEntryState(
    persistedServerUrl ?? defaultServerUrl,
    persistedSession ?? { displayName: browserDisplayName },
    browserThemeMode,
  );
  let client: WebRoomSocketClient | null = null;
  let activeSession: PersistedWebRoomSession | null = null;
  let pendingAction: PendingAction | null = null;
  let suppressNextSocketReconnect = false;
  let authPollTimer: AuthPollTimeoutHandle | null = null;
  let authPollGeneration = 0;
  let chatCooldownTimer: AuthPollTimeoutHandle | null = null;
  let chatCooldownTimerUntil: number | null = null;
  let danmakuCooldownTimer: AuthPollTimeoutHandle | null = null;
  let danmakuCooldownTimerUntil: number | null = null;
  let voiceErrorTimer: AuthPollTimeoutHandle | null = null;
  let voiceErrorTimerKey: string | null = null;
  let playbackErrorTimer: AuthPollTimeoutHandle | null = null;
  let playbackErrorTimerKey: string | null = null;
  let clockSyncTimer: ClockSyncIntervalHandle | null = null;
  const authPollIntervalMs =
    options.authPollIntervalMs ?? DEFAULT_AUTH_POLL_INTERVAL_MS;
  const setAuthPollTimeout: AuthPollTimeoutScheduler =
    options.setAuthPollTimeout ??
    ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
  const clearAuthPollTimeout: AuthPollTimeoutClearer =
    options.clearAuthPollTimeout ??
    ((handle) =>
      globalThis.clearTimeout(
        handle as ReturnType<typeof globalThis.setTimeout>,
      ));
  const setClockSyncInterval: ClockSyncIntervalScheduler =
    options.setClockSyncInterval ??
    ((callback, delayMs) => {
      const handle = globalThis.setInterval(callback, delayMs);
      unrefTimerHandle(handle);
      return handle;
    });
  const clearClockSyncInterval: ClockSyncIntervalClearer =
    options.clearClockSyncInterval ??
    ((handle) =>
      globalThis.clearInterval(
        handle as ReturnType<typeof globalThis.setInterval>,
      ));

  function getCurrentTime(): number {
    return options.now?.() ?? Date.now();
  }

  function getCurrentThemeMode(): WebRoomThemeMode {
    return state.themeMode === "dark" ? "dark" : "light";
  }

  function clearChatCooldownTimer(): void {
    if (chatCooldownTimer === null) {
      return;
    }
    clearAuthPollTimeout(chatCooldownTimer);
    chatCooldownTimer = null;
    chatCooldownTimerUntil = null;
  }

  function clearDanmakuCooldownTimer(): void {
    if (danmakuCooldownTimer === null) {
      return;
    }
    clearAuthPollTimeout(danmakuCooldownTimer);
    danmakuCooldownTimer = null;
    danmakuCooldownTimerUntil = null;
  }

  function clearVoiceErrorTimer(): void {
    if (voiceErrorTimer === null) {
      return;
    }
    clearAuthPollTimeout(voiceErrorTimer);
    voiceErrorTimer = null;
    voiceErrorTimerKey = null;
  }

  function clearPlaybackErrorTimer(): void {
    if (playbackErrorTimer === null) {
      return;
    }
    clearAuthPollTimeout(playbackErrorTimer);
    playbackErrorTimer = null;
    playbackErrorTimerKey = null;
  }

  function handleChatCooldownTimer(): void {
    chatCooldownTimer = null;
    chatCooldownTimerUntil = null;
    if (state.view !== "joined") {
      return;
    }
    const cooldownUntil = state.chatCooldownUntil;
    if (typeof cooldownUntil !== "number") {
      return;
    }
    const remainingMs = cooldownUntil - getCurrentTime();
    if (remainingMs > 0) {
      emit({ ...state });
      return;
    }
    emit({
      ...state,
      chatCooldownUntil: undefined,
    });
  }

  function handleDanmakuCooldownTimer(): void {
    danmakuCooldownTimer = null;
    danmakuCooldownTimerUntil = null;
    if (state.view !== "joined") {
      return;
    }
    const cooldownUntil = state.danmakuCooldownUntil;
    if (typeof cooldownUntil !== "number") {
      return;
    }
    const remainingMs = cooldownUntil - getCurrentTime();
    if (remainingMs > 0) {
      emit({ ...state });
      return;
    }
    emit({
      ...state,
      danmakuCooldownUntil: undefined,
    });
  }

  function handleVoiceErrorTimer(errorKey: string): void {
    voiceErrorTimer = null;
    voiceErrorTimerKey = null;
    if (state.view !== "joined" || state.voice.error !== errorKey) {
      return;
    }
    emit({
      ...state,
      voice: {
        ...state.voice,
        error: null,
      },
    });
  }

  function getPlaybackErrorKey(
    error: Extract<WebRoomState, { view: "joined" }>["playbackError"],
  ): string | null {
    return error
      ? `${error.code}:${error.stage}:${error.message}:${String(error.canUseProxyFallback)}`
      : null;
  }

  function handlePlaybackErrorTimer(errorKey: string): void {
    playbackErrorTimer = null;
    playbackErrorTimerKey = null;
    if (
      state.view !== "joined" ||
      getPlaybackErrorKey(state.playbackError) !== errorKey
    ) {
      return;
    }
    emit({
      ...state,
      playbackError: undefined,
    });
  }

  function syncTransientUiTimers(): void {
    if (state.view !== "joined") {
      clearChatCooldownTimer();
      clearDanmakuCooldownTimer();
      clearVoiceErrorTimer();
      clearPlaybackErrorTimer();
      return;
    }

    const cooldownUntil = state.chatCooldownUntil;
    if (typeof cooldownUntil === "number") {
      const remainingMs = cooldownUntil - getCurrentTime();
      if (remainingMs <= 0) {
        clearChatCooldownTimer();
        emit({
          ...state,
          chatCooldownUntil: undefined,
        });
        return;
      }
      if (chatCooldownTimerUntil !== cooldownUntil) {
        clearChatCooldownTimer();
        chatCooldownTimerUntil = cooldownUntil;
        const nextDelayMs = Math.min(remainingMs, 1000);
        chatCooldownTimer = setAuthPollTimeout(
          handleChatCooldownTimer,
          nextDelayMs,
        );
      }
    } else {
      clearChatCooldownTimer();
    }

    const danmakuCooldownUntil = state.danmakuCooldownUntil;
    if (typeof danmakuCooldownUntil === "number") {
      const remainingMs = danmakuCooldownUntil - getCurrentTime();
      if (remainingMs <= 0) {
        clearDanmakuCooldownTimer();
        emit({
          ...state,
          danmakuCooldownUntil: undefined,
        });
        return;
      }
      if (danmakuCooldownTimerUntil !== danmakuCooldownUntil) {
        clearDanmakuCooldownTimer();
        danmakuCooldownTimerUntil = danmakuCooldownUntil;
        danmakuCooldownTimer = setAuthPollTimeout(
          handleDanmakuCooldownTimer,
          Math.min(remainingMs, 1000),
        );
      }
    } else {
      clearDanmakuCooldownTimer();
    }

    const voiceError = state.voice.error;
    if (voiceError) {
      if (voiceErrorTimerKey !== voiceError) {
        clearVoiceErrorTimer();
        voiceErrorTimerKey = voiceError;
        voiceErrorTimer = setAuthPollTimeout(
          () => handleVoiceErrorTimer(voiceError),
          TRANSIENT_VOICE_ERROR_MS,
        );
      }
    } else {
      clearVoiceErrorTimer();
    }

    const playbackErrorKey = getPlaybackErrorKey(state.playbackError);
    if (playbackErrorKey) {
      if (playbackErrorTimerKey !== playbackErrorKey) {
        clearPlaybackErrorTimer();
        playbackErrorTimerKey = playbackErrorKey;
        playbackErrorTimer = setAuthPollTimeout(
          () => handlePlaybackErrorTimer(playbackErrorKey),
          TRANSIENT_PLAYBACK_ERROR_MS,
        );
      }
    } else {
      clearPlaybackErrorTimer();
    }
  }

  function emit(nextState: WebRoomState): void {
    state = nextState;
    options.onStateChange?.(state);
    syncTransientUiTimers();
  }

  function appendDiagnostic(item: string): void {
    if (state.view !== "joined") {
      return;
    }
    emit({
      ...state,
      diagnostics: [...state.diagnostics, item].slice(-80),
    });
  }

  function appendDiagnosticItem(item: string): string[] {
    return state.view === "joined"
      ? [...state.diagnostics, item].slice(-80)
      : [];
  }

  function sendClockPing(): void {
    client?.ping(getCurrentTime());
  }

  function clearClockSyncTimer(): void {
    if (clockSyncTimer === null) {
      return;
    }
    clearClockSyncInterval(clockSyncTimer);
    clockSyncTimer = null;
  }

  function startClockSyncTimer(): void {
    clearClockSyncTimer();
    sendClockPing();
    clockSyncTimer = setClockSyncInterval(
      sendClockPing,
      CLOCK_SYNC_INTERVAL_MS,
    );
  }

  function clearBilibiliAuthPollTimer(): void {
    if (authPollTimer === null) {
      return;
    }
    clearAuthPollTimeout(authPollTimer);
    authPollTimer = null;
  }

  function resetBilibiliAuthPolling(): void {
    authPollGeneration += 1;
    clearBilibiliAuthPollTimer();
  }

  function getVoiceSessionContext() {
    if (state.view !== "joined" || !activeSession || !client) {
      return null;
    }
    return {
      roomCode: state.roomCode,
      memberToken: activeSession.memberToken,
      memberId: state.currentMemberId,
      connected: state.connectionState === "connected",
    };
  }

  function getPlaybackSyncContext() {
    if (state.view !== "joined" || !activeSession || !client) {
      return null;
    }
    if (!canUseMemberPermission("playbackControl")) {
      return null;
    }
    const url = state.playbackUrl ?? state.playback?.url;
    if (!url) {
      return null;
    }
    return {
      memberToken: activeSession.memberToken,
      actorId: state.currentMemberId,
      url,
    };
  }

  function sendPlaybackUpdate(
    message: Extract<ClientMessage, { type: "playback:update" }>,
  ): void {
    if (!client || !activeSession) {
      return;
    }
    if (!canUseMemberPermission("playbackControl")) {
      return;
    }
    client.updatePlayback(message);
  }

  function getVoiceState() {
    return state.view === "joined" ? state.voice : null;
  }

  function setVoiceState(voice: NonNullable<ReturnType<typeof getVoiceState>>) {
    if (state.view !== "joined") {
      return;
    }
    emit({
      ...state,
      voice,
    });
  }

  const voiceRuntime =
    options.voiceRuntime ??
    options.voiceRuntimeFactory?.({
      onEvent: (event) => voiceController.handleRuntimeEvent(event),
      log: appendDiagnostic,
    }) ??
    createUnavailableVoiceRuntime();
  const voiceController = createWebRoomVoiceController({
    getSession: getVoiceSessionContext,
    getVoiceState,
    setVoiceState,
    runtime: voiceRuntime,
    sendVoiceAccess: (memberToken) => client?.requestVoiceAccess(memberToken),
    sendVoiceState: (input) => client?.updateVoiceState(input),
    onLocalMicrophoneStateChange: (input) => {
      if (state.view !== "joined") {
        return;
      }
      emit(
        appendSystemChatMessage(state, {
          memberId: input.memberId,
          eventType: input.muted ? "voice_muted" : "voice_unmuted",
          timestamp: options.now?.() ?? Date.now(),
        }),
      );
    },
    log: appendDiagnostic,
  });

  function isHostState(): boolean {
    return (
      state.view === "joined" && state.currentMemberId === state.hostMemberId
    );
  }

  function getCurrentMemberState() {
    if (state.view !== "joined") {
      return null;
    }
    const currentMemberId = state.currentMemberId;
    return (
      state.members.find((member) => member.id === currentMemberId) ?? null
    );
  }

  function canUseMemberPermission(
    permission: RoomMemberPermissionName,
  ): boolean {
    if (state.view !== "joined") {
      return false;
    }
    if (isHostState()) {
      return true;
    }
    return isMemberPermissionAllowed(getCurrentMemberState(), permission);
  }

  function canManageRoomMembers(): boolean {
    return Boolean(client && activeSession && isHostState());
  }

  function requireHostAuthorizationState(): boolean {
    if (isHostState()) {
      return true;
    }
    appendDiagnostic("provider auth denied: host only");
    return false;
  }

  function getProviderRequestContext(): {
    roomCode: string;
    memberToken: string;
    apiClient: ProviderApiClient | null;
  } | null {
    if (state.view !== "joined" || !activeSession) {
      return null;
    }
    const serverUrl =
      state.serverUrl ?? activeSession.serverUrl ?? defaultServerUrl;
    return {
      roomCode: state.roomCode,
      memberToken: activeSession.memberToken,
      apiClient: options.providerApiClientFactory?.(serverUrl) ?? null,
    };
  }

  function getDefaultProviderCandidateId(
    item: WebRoomProviderPickerItem | undefined,
  ): string | undefined {
    const descriptor = item?.providerDescriptor;
    if (!descriptor) {
      return undefined;
    }
    return (
      descriptor.defaultCandidateId ??
      descriptor.candidates.find((candidate) => candidate.default === true)
        ?.id ??
      descriptor.candidates[0]?.id
    );
  }

  function getProviderResultPolicy(
    items: WebRoomProviderPickerItem[],
    fallback: PlaybackProxyPolicy,
  ): PlaybackProxyPolicy {
    const policy = items.find((item) => item.providerDescriptor?.policy)
      ?.providerDescriptor?.policy;
    return policy
      ? {
          proxy: policy.proxy,
          shared: policy.shared,
        }
      : fallback;
  }

  function getSelectedProviderPickerItem(
    picker: WebRoomProviderPickerState,
  ): WebRoomProviderPickerItem | undefined {
    return picker.items.find((item) => item.itemId === picker.selectedItemId);
  }

  function applySelectedProviderCandidate(
    descriptor: ProviderPlaybackDescriptor,
    candidateId: string | undefined,
  ): ProviderPlaybackDescriptor {
    const selectedCandidateId =
      candidateId &&
      descriptor.candidates.some((candidate) => candidate.id === candidateId)
        ? candidateId
        : (descriptor.defaultCandidateId ??
          descriptor.candidates.find((candidate) => candidate.default === true)
            ?.id ??
          descriptor.candidates[0]?.id);
    if (!selectedCandidateId) {
      return descriptor;
    }
    return {
      ...descriptor,
      defaultCandidateId: selectedCandidateId,
      candidates: descriptor.candidates.map((candidate) => ({
        ...candidate,
        default: candidate.id === selectedCandidateId,
      })),
    };
  }

  function applyBilibiliAuthFlowResult(
    method: WebRoomAuthMethod,
    result: BilibiliAuthFlowResult,
  ): void {
    if (state.view !== "joined") {
      return;
    }
    emit({
      ...state,
      authStatus: "checking",
      authPanel: {
        open: true,
        ...(result.providerId !== "bilibili"
          ? { providerId: result.providerId }
          : {}),
        method,
        phase: result.status,
        flowId: result.flowId,
        expiresAt: result.expiresAt,
        ...(result.qrCodeUrl ? { qrCodeUrl: result.qrCodeUrl } : {}),
        ...(result.message ? { message: result.message } : {}),
      },
    });
  }

  function getProviderAuthPendingMessage(providerId: VideoProviderId): string {
    if (providerId === "iqiyi") {
      return "iQIYI authorization request is pending.";
    }
    if (providerId === "huya") {
      return "Huya authorization request is pending.";
    }
    return "Provider authorization request is pending.";
  }

  function getProviderAuthUnavailableMessage(
    providerId: VideoProviderId,
  ): string {
    if (providerId === "iqiyi") {
      return "iQIYI authorization is not connected yet.";
    }
    if (providerId === "huya") {
      return "Huya authorization is not connected yet.";
    }
    return "Provider authorization failed.";
  }

  function getProviderAuthVerificationFailedMessage(
    providerId: VideoProviderId,
  ): string {
    if (providerId === "iqiyi") {
      return "iQIYI authorization could not be verified.";
    }
    if (providerId === "huya") {
      return "Huya authorization could not be verified.";
    }
    return "Bilibili authorization could not be verified.";
  }

  function getProviderAuthFailedMessage(providerId: VideoProviderId): string {
    if (providerId === "huya") {
      return "Huya QR authorization failed.";
    }
    if (providerId === "iqiyi") {
      return "iQIYI authorization is not connected yet.";
    }
    return "Bilibili authorization failed.";
  }

  function applyBilibiliAuthPollResult(
    method: WebRoomAuthMethod,
    providerId: VideoProviderId,
    result: BilibiliAuthPollResult,
  ): void {
    if (state.view !== "joined") {
      return;
    }
    const previousPanel = state.authPanel;
    if (result.status === "authorized") {
      emit({
        ...state,
        authStatus: "authorized",
        authPanel: {
          open: true,
          ...(providerId !== "bilibili" ? { providerId } : {}),
          method,
          phase: "authorized",
          ...(result.profile?.displayName
            ? { profileName: result.profile.displayName }
            : {}),
          ...(result.profile?.vipLabel
            ? { vipLabel: result.profile.vipLabel }
            : {}),
          ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
        },
      });
      return;
    }
    emit({
      ...state,
      authStatus:
        result.status === "failed" || result.status === "expired"
          ? "unauthorized"
          : "checking",
      authPanel: {
        open: true,
        ...(providerId !== "bilibili" ? { providerId } : {}),
        method,
        phase: result.status,
        ...(previousPanel?.flowId ? { flowId: previousPanel.flowId } : {}),
        ...(previousPanel?.expiresAt
          ? { expiresAt: previousPanel.expiresAt }
          : {}),
        ...(previousPanel?.qrCodeUrl
          ? { qrCodeUrl: previousPanel.qrCodeUrl }
          : {}),
        ...(result.message ? { message: result.message } : {}),
      },
    });
  }

  function applyBilibiliAuthStatusResult(
    method: WebRoomAuthMethod,
    providerId: VideoProviderId,
    result: BilibiliAuthStatusResult,
  ): void {
    if (state.view !== "joined") {
      return;
    }
    const authPanelOpen = state.authPanel?.open === true;
    if (!result.authorized) {
      emit({
        ...state,
        authStatus: "unauthorized",
        authPanel: {
          open: authPanelOpen,
          ...(providerId !== "bilibili" ? { providerId } : {}),
          method,
          phase: "failed",
          message: getProviderAuthVerificationFailedMessage(providerId),
        },
      });
      return;
    }
    emit({
      ...state,
      authStatus: "authorized",
      authPanel: {
        open: authPanelOpen,
        ...(providerId !== "bilibili" ? { providerId } : {}),
        method,
        phase: "authorized",
        ...(result.profile?.displayName
          ? { profileName: result.profile.displayName }
          : {}),
        ...(result.profile?.vipLabel
          ? { vipLabel: result.profile.vipLabel }
          : {}),
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
      },
    });
  }

  function scheduleBilibiliAuthPoll(input: {
    providerId?: VideoProviderId;
    method: WebRoomAuthMethod;
    flowId: string;
    generation: number;
  }): void {
    clearBilibiliAuthPollTimer();
    authPollTimer = setAuthPollTimeout(() => {
      if (input.generation !== authPollGeneration) {
        return;
      }
      authPollTimer = null;
      void pollBilibiliAuth(input);
    }, authPollIntervalMs);
  }

  async function pollBilibiliAuth(input: {
    providerId?: VideoProviderId;
    method: WebRoomAuthMethod;
    flowId: string;
    generation: number;
  }): Promise<void> {
    if (input.generation !== authPollGeneration) {
      return;
    }
    const context = getProviderRequestContext();
    if (!context?.apiClient) {
      return;
    }
    const providerId = input.providerId ?? "bilibili";
    const apiProviderId = providerId === "bilibili" ? undefined : providerId;
    try {
      const result = await context.apiClient.pollAuth({
        ...(apiProviderId ? { providerId: apiProviderId } : {}),
        roomCode: context.roomCode,
        memberToken: context.memberToken,
        flowId: input.flowId,
      });
      if (input.generation !== authPollGeneration) {
        return;
      }
      if (result.status === "authorized") {
        const status = await context.apiClient.getAuthStatus({
          ...(apiProviderId ? { providerId: apiProviderId } : {}),
          roomCode: context.roomCode,
          memberToken: context.memberToken,
        });
        if (input.generation !== authPollGeneration) {
          return;
        }
        applyBilibiliAuthStatusResult(input.method, providerId, status);
        resetBilibiliAuthPolling();
        return;
      }
      applyBilibiliAuthPollResult(input.method, providerId, result);
      if (result.status === "pending") {
        scheduleBilibiliAuthPoll(input);
        return;
      }
      resetBilibiliAuthPolling();
    } catch (error) {
      if (input.generation !== authPollGeneration) {
        return;
      }
      resetBilibiliAuthPolling();
      applyProviderApiFailure({
        panel: "auth",
        providerId,
        method: input.method,
        diagnostic: getProviderApiFailureDiagnostic(error, "auth"),
        message: getProviderApiFailureMessage(
          error,
          getProviderAuthFailedMessage(providerId),
        ),
      });
    }
  }

  function applyProviderApiFailure(input: {
    panel: "auth" | "picker";
    message: string;
    diagnostic?: string;
    method?: WebRoomAuthMethod;
    providerId?: VideoProviderId;
    open?: boolean;
  }): void {
    if (state.view !== "joined") {
      return;
    }
    const diagnostics = input.diagnostic
      ? appendDiagnosticItem(input.diagnostic)
      : state.diagnostics;
    if (input.panel === "auth") {
      emit({
        ...state,
        diagnostics,
        authStatus: "unauthorized",
        authPanel: {
          open: input.open ?? true,
          ...(input.providerId && input.providerId !== "bilibili"
            ? { providerId: input.providerId }
            : {}),
          method: input.method ?? state.authPanel?.method ?? "qr",
          phase: "failed",
          errorMessage: input.message,
        },
      });
      return;
    }
    emit({
      ...state,
      diagnostics,
      providerPicker: {
        ...(state.providerPicker ?? {
          open: true,
          proxy: false,
          shared: false,
          items: [],
        }),
        status: "failed",
        errorMessage: input.message,
      },
    });
  }

  function getProviderApiFailureMessage(
    error: unknown,
    fallbackMessage: string,
    providerId?: VideoProviderId,
  ): string {
    const providerError = error as Partial<ProviderApiError>;
    if (providerError.code === "provider_auth_required") {
      return "请先完成 Bilibili 授权，或关闭 shared 后再解析。";
    }
    if (providerError.code === "provider_auth_forbidden") {
      return "只有房主可以管理 Bilibili 授权和点播解析。";
    }
    if (providerError.code === "provider_auth_unavailable") {
      return fallbackMessage;
    }
    if (providerError.code === "unsupported_source") {
      return "暂不支持这个 Bilibili 链接。";
    }
    if (providerError.reason === "live_room_offline") {
      return "直播间当前未开播。";
    }
    if (providerError.reason === "anonymous_no_playback_candidates") {
      return "Bilibili 未返回匿名可播放流，请开启 shared 并完成授权后重试。";
    }
    if (providerError.reason === "no_live_hls_candidates") {
      return "直播间没有可播放的 HLS 流。";
    }
    if (
      providerError.reason === "live_room_failed" ||
      providerError.reason === "live_playurl_failed"
    ) {
      return "直播解析失败，请稍后重试。";
    }
    if (providerError.reason === "extractor_unsupported_url") {
      return "暂不支持这个链接。";
    }
    if (providerError.reason === "extractor_auth_required") {
      return "当前平台需要登录态或 Cookie，通用解析暂不支持；可以使用公开可访问的 mp4/m3u8 链接，或后续接入该平台专属 provider。";
    }
    if (providerId === "huya") {
      if (
        providerError.reason === "huya_live_room_offline" ||
        providerError.reason === "huya_live_room_unavailable"
      ) {
        return "虎牙直播间当前未开播或暂时没有可播放直播流。";
      }
      if (providerError.reason === "huya_no_live_flv_candidates") {
        return "虎牙直播间暂时没有可播放的 FLV 直播流。";
      }
      if (
        typeof providerError.reason === "string" &&
        providerError.reason.startsWith("huya_room_")
      ) {
        return "虎牙直播间请求失败，请稍后重试。";
      }
      if (providerError.code === "unsupported_source") {
        return "暂不支持这个虎牙链接。";
      }
      if (providerError.code === "provider_parse_failed") {
        return "虎牙直播解析失败，请稍后重试。";
      }
    }
    if (
      providerError.code === "provider_parse_failed" ||
      (error instanceof Error && error.message === "Provider request failed.")
    ) {
      if (providerId && providerId !== "bilibili") {
        return "解析失败，请稍后重试。";
      }
      return "解析失败，请稍后重试；如果开启了 shared，请确认 Bilibili 授权有效。";
    }
    return error instanceof Error ? error.message : fallbackMessage;
  }

  function getProviderApiFailureDiagnostic(
    error: unknown,
    panel: "auth" | "picker",
  ): string {
    const providerError = error as Partial<ProviderApiError>;
    return [
      `provider API ${panel} failed`,
      typeof providerError.code === "string" ? providerError.code : "",
      typeof providerError.reason === "string" ? providerError.reason : "",
      error instanceof Error ? error.message : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  function handleOpen(): void {
    emit(setConnectionState(state, "connected"));
    if (!pendingAction || !client) {
      return;
    }

    if (pendingAction.type === "create") {
      client.createRoom(pendingAction.displayName);
      return;
    }

    client.joinRoom({
      roomCode: pendingAction.roomCode,
      joinToken: pendingAction.joinToken,
      ...(pendingAction.memberToken
        ? { memberToken: pendingAction.memberToken }
        : {}),
      displayName: pendingAction.displayName,
    });
  }

  function requestCurrentRoomState(memberToken: string): void {
    client?.requestSync(memberToken);
  }

  function persistActiveSession(session: PersistedWebRoomSession): void {
    activeSession = session;
    if (storage) {
      persistWebRoomSession(storage, session);
    }
  }

  function handleRoomCreated(message: ServerMessage): void {
    if (message.type !== "room:created" || pendingAction?.type !== "create") {
      return;
    }

    const session: PersistedWebRoomSession = {
      roomCode: message.payload.roomCode,
      joinToken: message.payload.joinToken,
      memberToken: message.payload.memberToken,
      displayName: pendingAction.displayName,
      serverUrl: pendingAction.serverUrl,
    };
    persistActiveSession(session);
    pendingAction = null;
    emit(
      createInitialJoinedState({
        roomCode: message.payload.roomCode,
        currentMemberId: message.payload.memberId,
        hostMemberId: message.payload.memberId,
        displayName: session.displayName,
        themeMode: getCurrentThemeMode(),
        serverUrl: session.serverUrl,
        joinToken: session.joinToken,
      }),
    );
    startClockSyncTimer();
    requestCurrentRoomState(message.payload.memberToken);
  }

  function handleRoomJoined(message: ServerMessage): void {
    if (message.type !== "room:joined" || pendingAction?.type !== "join") {
      return;
    }

    const isReconnect =
      pendingAction.reconnect === true && state.view === "joined";
    const session: PersistedWebRoomSession = {
      roomCode: message.payload.roomCode,
      joinToken: pendingAction.joinToken,
      memberToken: message.payload.memberToken,
      displayName: pendingAction.displayName,
      serverUrl: pendingAction.serverUrl,
    };
    persistActiveSession(session);
    pendingAction = null;
    if (isReconnect && state.view === "joined") {
      emit({
        ...state,
        connectionState: "connected",
        roomCode: message.payload.roomCode,
        currentMemberId: message.payload.memberId,
        displayName: session.displayName,
        serverUrl: session.serverUrl,
        joinToken: session.joinToken,
      });
    } else {
      emit(
        createInitialJoinedState({
          roomCode: message.payload.roomCode,
          currentMemberId: message.payload.memberId,
          hostMemberId: "",
          displayName: session.displayName,
          themeMode: getCurrentThemeMode(),
          serverUrl: session.serverUrl,
          joinToken: session.joinToken,
        }),
      );
    }
    startClockSyncTimer();
    requestCurrentRoomState(message.payload.memberToken);
  }

  function handleMessage(message: unknown): void {
    if (!isServerMessage(message)) {
      return;
    }

    if (message.type === "room:created") {
      handleRoomCreated(message);
      return;
    }

    if (message.type === "room:joined") {
      handleRoomJoined(message);
      return;
    }

    if (isVoiceServerMessage(message)) {
      if (state.view === "joined") {
        emit(
          applyServerMessage(state, message, {
            now: options.now,
          }),
        );
      }
      void voiceController.handleServerMessage(message);
      return;
    }

    if (message.type === "error") {
      if (state.view === "entry") {
        emit(withEntryError(state, localizeEntryServerError(message.payload)));
        return;
      }
      if (message.payload.code === "member_kicked") {
        const serverUrl = state.serverUrl ?? activeSession?.serverUrl;
        resetBilibiliAuthPolling();
        void voiceController.disconnect("member kicked");
        suppressNextSocketReconnect = true;
        client?.close();
        client = null;
        activeSession = null;
        pendingAction = null;
        if (storage) {
          clearWebRoomSession(storage);
        }
        emit(
          withEntryError(
            createEntryState(
              serverUrl ?? defaultServerUrl,
              { displayName: state.displayName },
              getCurrentThemeMode(),
            ),
            "你已被房主移出房间。",
          ),
        );
        return;
      }
      emit(
        applyServerMessage(state, message, {
          now: options.now,
        }),
      );
      return;
    }

    if (state.view === "joined") {
      const wasHost = isHostState();
      emit(
        applyServerMessage(state, message, {
          now: options.now,
        }),
      );
      if (
        message.type === "room:state" &&
        !canUseMemberPermission("voice") &&
        state.voice.status !== "idle"
      ) {
        void voiceController.disconnect("voice permission disabled");
      }
      if (message.type === "room:state" && !wasHost && isHostState()) {
        void refreshBilibiliAuthStatus(state.authPanel?.method ?? "qr");
      }
    }
  }

  function handleClose(): void {
    clearClockSyncTimer();
    void voiceController.disconnect("socket closed");
    if (suppressNextSocketReconnect) {
      suppressNextSocketReconnect = false;
      emit(setConnectionState(state, "disconnected"));
      return;
    }
    if (pendingAction?.type === "join" && pendingAction.reconnect === true) {
      pendingAction = null;
      emit(setConnectionState(state, "disconnected"));
      return;
    }
    if (
      state.view === "joined" &&
      activeSession &&
      options.autoReconnect !== false
    ) {
      reconnectActiveSession(activeSession);
      return;
    }
    emit(setConnectionState(state, "disconnected"));
  }

  function handleSocketError(): void {
    emit(withEntryError(state, "服务器连接失败"));
  }

  function connect(serverUrl: string, action: PendingAction): boolean {
    resetBilibiliAuthPolling();
    pendingAction = action;
    void voiceController.disconnect("room entry changed");
    clearClockSyncTimer();
    if (client) {
      suppressNextSocketReconnect = true;
      client.close();
    }
    activeSession = null;
    emit(
      setConnectionState(
        createEntryState(serverUrl, action, getCurrentThemeMode()),
        "connecting",
      ),
    );

    try {
      client = createWebRoomSocketClient({
        serverUrl,
        socketFactory: options.socketFactory,
        onOpen: handleOpen,
        onMessage: handleMessage,
        onClose: handleClose,
        onError: handleSocketError,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "服务器地址无效";
      client = null;
      pendingAction = null;
      emit(
        withEntryError(
          createEntryState(serverUrl, action, getCurrentThemeMode()),
          message,
        ),
      );
      return false;
    }
  }

  function reconnectActiveSession(session: PersistedWebRoomSession): boolean {
    pendingAction = {
      type: "join",
      roomCode: session.roomCode,
      joinToken: session.joinToken,
      memberToken: session.memberToken,
      displayName: session.displayName,
      serverUrl: session.serverUrl,
      reconnect: true,
    };
    emit(setConnectionState(state, "connecting"));

    try {
      client = createWebRoomSocketClient({
        serverUrl: session.serverUrl,
        socketFactory: options.socketFactory,
        onOpen: handleOpen,
        onMessage: handleMessage,
        onClose: handleClose,
        onError: handleSocketError,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "服务器地址无效";
      client = null;
      pendingAction = null;
      emit(withEntryError(state, message));
      return false;
    }
  }

  function createRoom(input: CreateRoomInput = {}): void {
    const serverUrl = coerceWebRoomServerUrlForPage(
      getServerUrl(input.serverUrl, defaultServerUrl),
      pageLocation,
    );
    const displayName = resolveBrowserDisplayName(
      input.displayName,
      storage,
      random,
    );
    connect(serverUrl, {
      type: "create",
      displayName,
      serverUrl,
    });
  }

  function joinRoom(input: JoinRoomInput): void {
    const serverUrl = coerceWebRoomServerUrlForPage(
      getServerUrl(input.serverUrl, defaultServerUrl),
      pageLocation,
    );
    const roomCode = getRoomCode(input.roomCode);
    const joinToken = input.joinToken?.trim() ?? "";
    const displayName = resolveBrowserDisplayName(
      input.displayName,
      storage,
      random,
    );

    if (!ROOM_CODE_PATTERN.test(roomCode) || joinToken.length === 0) {
      emit(
        withEntryError(
          createEntryState(
            serverUrl,
            {
              roomCode,
              joinToken,
              displayName,
            },
            getCurrentThemeMode(),
          ),
          "请输入有效的房间号和加入口令",
        ),
      );
      return;
    }

    connect(serverUrl, {
      type: "join",
      roomCode,
      joinToken,
      ...(input.memberToken ? { memberToken: input.memberToken } : {}),
      displayName,
      serverUrl,
    });
  }

  function sendChat(content: string): boolean {
    const trimmed = content.trim();
    if (!client || !activeSession || trimmed.length === 0) {
      return false;
    }
    if (!canUseMemberPermission("chat")) {
      return false;
    }
    if (
      state.view === "joined" &&
      typeof state.chatCooldownUntil === "number" &&
      state.chatCooldownUntil > getCurrentTime()
    ) {
      return false;
    }
    client.sendChat({
      memberToken: activeSession.memberToken,
      content: trimmed,
    });
    return true;
  }

  function sendDanmaku(
    content: string,
    options: { videoTime: number; color?: string },
  ): boolean {
    const trimmed = content.trim();
    if (!client || !activeSession || trimmed.length === 0) {
      return false;
    }
    if (!canUseMemberPermission("danmaku")) {
      return false;
    }
    if (
      state.view === "joined" &&
      typeof state.danmakuCooldownUntil === "number" &&
      state.danmakuCooldownUntil > getCurrentTime()
    ) {
      return false;
    }
    const videoTime =
      Number.isFinite(options.videoTime) && options.videoTime >= 0
        ? options.videoTime
        : 0;
    client.sendDanmaku({
      memberToken: activeSession.memberToken,
      content: trimmed,
      videoTime,
      mode: "scroll",
      ...(options.color ? { color: options.color } : {}),
    });
    if (state.view === "joined") {
      emit({
        ...state,
        danmakuCooldownUntil: getCurrentTime() + DANMAKU_SEND_COOLDOWN_MS,
      });
    }
    return true;
  }

  function setRoomMemberPermission(input: {
    targetMemberId: string;
    permission: RoomMemberPermissionName;
    allowed: boolean;
  }): void {
    if (
      input.targetMemberId.length === 0 ||
      !canManageRoomMembers() ||
      !client ||
      !activeSession
    ) {
      return;
    }
    client.setRoomMemberPermission({
      memberToken: activeSession.memberToken,
      targetMemberId: input.targetMemberId,
      permission: input.permission,
      allowed: input.allowed,
    });
  }

  function kickRoomMember(targetMemberId: string): void {
    if (
      targetMemberId.length === 0 ||
      !canManageRoomMembers() ||
      !client ||
      !activeSession
    ) {
      return;
    }
    client.kickRoomMember({
      memberToken: activeSession.memberToken,
      targetMemberId,
    });
  }

  function transferRoomHost(targetMemberId: string): void {
    if (
      targetMemberId.length === 0 ||
      !canManageRoomMembers() ||
      !client ||
      !activeSession
    ) {
      return;
    }
    client.transferRoomHost({
      memberToken: activeSession.memberToken,
      targetMemberId,
    });
  }

  function requestVoiceAccess(): void {
    if (!canUseMemberPermission("voice")) {
      return;
    }
    voiceController.requestAccess({ forceRefresh: true });
  }

  function toggleVoice(): void {
    if (!canUseMemberPermission("voice")) {
      return;
    }
    if (state.view === "joined" && state.voice.status === "connected") {
      void voiceController.toggleMicrophone();
      return;
    }
    voiceController.requestAccess({
      forceRefresh: true,
      enableMicrophoneAfterConnect: true,
    });
  }

  function toggleVoiceMicrophone(): Promise<void> {
    if (!canUseMemberPermission("voice")) {
      return Promise.resolve();
    }
    return voiceController.toggleMicrophone();
  }

  function toggleThemeMode(): void {
    const themeMode = getCurrentThemeMode() === "dark" ? "light" : "dark";
    persistWebRoomThemeMode(storage, themeMode);
    emit({
      ...state,
      themeMode,
    });
  }

  function leaveRoom(): void {
    const previousRoomInvite =
      state.view === "joined"
        ? {
            roomCode: state.roomCode,
            joinToken: state.joinToken,
          }
        : {};
    resetBilibiliAuthPolling();
    void voiceController.disconnect("leave room requested");
    clearClockSyncTimer();
    if (client && activeSession) {
      client.leaveRoom(activeSession.memberToken);
    }
    suppressNextSocketReconnect = true;
    client?.close();
    client = null;
    activeSession = null;
    pendingAction = null;
    if (storage) {
      clearWebRoomSession(storage);
    }
    emit(
      createEntryState(
        state.serverUrl ?? defaultServerUrl,
        {
          displayName: getBrowserDisplayName(storage, random),
          ...previousRoomInvite,
        },
        getCurrentThemeMode(),
      ),
    );
  }

  function openAuthorizationPanel(): void {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    const method = state.authPanel?.method ?? "qr";
    emit({
      ...state,
      authPanel: {
        ...(state.authPanel ?? {
          method,
          phase: "idle",
        }),
        open: true,
      },
    });
    if (state.authStatus === "authorized") {
      void refreshBilibiliAuthStatus(method);
    }
  }

  function closeAuthorizationPanel(): void {
    if (state.view !== "joined" || !state.authPanel?.open) {
      return;
    }
    resetBilibiliAuthPolling();
    emit({
      ...state,
      authPanel: {
        ...state.authPanel,
        open: false,
      },
    });
  }

  function collapseBilibiliAuth(): void {
    if (state.view !== "joined" || !state.authPanel?.open) {
      return;
    }
    resetBilibiliAuthPolling();
    emit({
      ...state,
      authStatus:
        state.authStatus === "authorized" ? "authorized" : "unauthorized",
      authPanel: {
        open: true,
        method: state.authPanel.method ?? "qr",
        phase: "idle",
      },
    });
  }

  async function refreshBilibiliAuthStatus(
    method: WebRoomAuthMethod,
  ): Promise<void> {
    if (state.view !== "joined") {
      return;
    }
    const context = getProviderRequestContext();
    if (!context?.apiClient) {
      return;
    }
    try {
      const status = await context.apiClient.getAuthStatus({
        roomCode: context.roomCode,
        memberToken: context.memberToken,
      });
      applyBilibiliAuthStatusResult(method, "bilibili", status);
    } catch (error) {
      applyProviderApiFailure({
        panel: "auth",
        method,
        open: state.authPanel?.open === true,
        diagnostic: getProviderApiFailureDiagnostic(error, "auth"),
        message: getProviderApiFailureMessage(
          error,
          "Bilibili authorization check failed.",
        ),
      });
    }
  }

  function setBilibiliAuthMethod(method: WebRoomAuthMethod): void {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    resetBilibiliAuthPolling();
    emit({
      ...state,
      authPanel: {
        open: true,
        method,
        phase: "idle",
      },
    });
  }

  async function startProviderAuth(input: {
    providerId: VideoProviderId;
    method: WebRoomAuthMethod;
  }): Promise<void> {
    if (input.providerId === "bilibili") {
      await startBilibiliAuth({ method: input.method });
      return;
    }
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    resetBilibiliAuthPolling();
    const authGeneration = authPollGeneration;
    const context = getProviderRequestContext();
    const pendingMessage = getProviderAuthPendingMessage(input.providerId);
    const fallbackMessage = getProviderAuthUnavailableMessage(input.providerId);
    emit({
      ...state,
      authStatus: "checking",
      authPanel: {
        open: true,
        providerId: input.providerId,
        method: input.method,
        phase: "loading",
        message: pendingMessage,
      },
    });
    if (!context?.apiClient) {
      return;
    }
    try {
      const result = await context.apiClient.startAuth({
        providerId: input.providerId,
        roomCode: context.roomCode,
        memberToken: context.memberToken,
        method: input.method,
      });
      if (state.view !== "joined") {
        return;
      }
      emit({
        ...state,
        authStatus: "checking",
        authPanel: {
          open: true,
          providerId: input.providerId,
          method: input.method,
          phase: result.status,
          flowId: result.flowId,
          expiresAt: result.expiresAt,
          ...(result.qrCodeUrl ? { qrCodeUrl: result.qrCodeUrl } : {}),
          ...(result.message ? { message: result.message } : {}),
        },
      });
      if (result.status === "pending") {
        scheduleBilibiliAuthPoll({
          providerId: input.providerId,
          method: input.method,
          flowId: result.flowId,
          generation: authGeneration,
        });
      }
    } catch (error) {
      applyProviderApiFailure({
        panel: "auth",
        providerId: input.providerId,
        method: input.method,
        diagnostic: getProviderApiFailureDiagnostic(error, "auth"),
        message: getProviderApiFailureMessage(error, fallbackMessage),
      });
    }
  }

  async function startBilibiliAuth(input: {
    method: WebRoomAuthMethod;
  }): Promise<void> {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    const previousFlowId = state.authPanel?.flowId;
    resetBilibiliAuthPolling();
    const authGeneration = authPollGeneration;
    const context = getProviderRequestContext();
    emit({
      ...state,
      authStatus: "checking",
      authPanel: {
        open: true,
        method: input.method,
        phase: "loading",
        ...(previousFlowId ? { flowId: previousFlowId } : {}),
        message: "Bilibili QR authorization request is pending.",
      },
    });
    if (!context?.apiClient) {
      return;
    }
    try {
      const result = await context.apiClient.startAuth({
        roomCode: context.roomCode,
        memberToken: context.memberToken,
        method: input.method,
      });
      applyBilibiliAuthFlowResult(input.method, result);
      if (result.status === "pending") {
        scheduleBilibiliAuthPoll({
          providerId: "bilibili",
          method: input.method,
          flowId: result.flowId,
          generation: authGeneration,
        });
      }
    } catch (error) {
      applyProviderApiFailure({
        panel: "auth",
        method: input.method,
        diagnostic: getProviderApiFailureDiagnostic(error, "auth"),
        message: getProviderApiFailureMessage(
          error,
          "Bilibili authorization failed.",
        ),
      });
    }
  }

  async function logoutBilibiliAuth(): Promise<void> {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    resetBilibiliAuthPolling();
    const context = getProviderRequestContext();
    const method = state.authPanel?.method ?? "qr";
    emit({
      ...state,
      authStatus: "unauthorized",
      authPanel: {
        open: true,
        method,
        phase: "idle",
        message: "Bilibili authorization logout is pending.",
      },
    });
    if (!context?.apiClient) {
      return;
    }
    try {
      await context.apiClient.logoutAuth({
        roomCode: context.roomCode,
        memberToken: context.memberToken,
      });
      if (state.view !== "joined") {
        return;
      }
      emit({
        ...state,
        authStatus: "unauthorized",
        authPanel: {
          open: true,
          method,
          phase: "idle",
          message: "Bilibili authorization cleared.",
        },
      });
    } catch (error) {
      applyProviderApiFailure({
        panel: "auth",
        method,
        diagnostic: getProviderApiFailureDiagnostic(error, "auth"),
        message: getProviderApiFailureMessage(
          error,
          "Bilibili authorization logout failed.",
        ),
      });
    }
  }

  function openProviderPicker(): void {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    emit({
      ...state,
      providerPicker: state.providerPicker ?? {
        open: true,
        status: "idle",
        proxy: false,
        shared: false,
        items: [],
      },
    });
  }

  async function parseBilibiliUrl(input: {
    url: string;
    proxy: boolean;
    shared: boolean;
  }): Promise<void> {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    const context = getProviderRequestContext();
    const url = input.url.trim();
    const providerId = getProviderIdForParseUrl(url);
    const policy = {
      proxy: input.proxy,
      shared: providerId === "bilibili" ? input.shared : false,
    };
    emit({
      ...state,
      providerPicker: {
        open: true,
        status: "loading",
        url,
        proxy: policy.proxy,
        shared: policy.shared,
        items: [],
        message:
          providerId === "bilibili"
            ? "Bilibili URL parse request is pending."
            : "Provider URL parse request is pending.",
      },
    });
    if (!context?.apiClient) {
      return;
    }
    try {
      const result = await context.apiClient.parse({
        providerId,
        roomCode: context.roomCode,
        memberToken: context.memberToken,
        url,
        policy,
      });
      if (state.view !== "joined") {
        return;
      }
      const resultPolicy = getProviderResultPolicy(result.items, policy);
      emit({
        ...state,
        providerPicker: {
          open: true,
          status: "ready",
          url,
          proxy: resultPolicy.proxy,
          shared: resultPolicy.shared,
          items: result.items,
          selectedItemId: result.items[0]?.itemId,
          selectedQualityCandidateId: getDefaultProviderCandidateId(
            result.items[0],
          ),
          message: result.title,
        },
      });
    } catch (error) {
      applyProviderApiFailure({
        panel: "picker",
        diagnostic: getProviderApiFailureDiagnostic(error, "picker"),
        message: getProviderApiFailureMessage(
          error,
          providerId === "bilibili"
            ? "Bilibili URL parse failed."
            : "Provider URL parse failed.",
          providerId,
        ),
      });
    }
  }

  function setProviderPickerResults(input: {
    items: WebRoomProviderPickerItem[];
    message?: string;
  }): void {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    const previous = state.providerPicker;
    const selectedItem = input.items[0];
    emit({
      ...state,
      providerPicker: {
        open: true,
        status: "ready",
        url: previous?.url,
        proxy: previous?.proxy ?? false,
        shared: previous?.shared ?? false,
        items: input.items,
        selectedItemId: selectedItem?.itemId,
        selectedQualityCandidateId: getDefaultProviderCandidateId(selectedItem),
        ...(input.message ? { message: input.message } : {}),
      },
    });
  }

  function selectProviderItem(itemId: string): void {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    const picker = state.providerPicker;
    if (!picker || !picker.items.some((item) => item.itemId === itemId)) {
      return;
    }
    const selectedItem = picker.items.find((item) => item.itemId === itemId);
    emit({
      ...state,
      providerPicker: {
        ...picker,
        selectedItemId: itemId,
        selectedQualityCandidateId: getDefaultProviderCandidateId(selectedItem),
      },
    });
  }

  function selectProviderQuality(candidateId: string): void {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    const picker = state.providerPicker;
    if (!picker) {
      return;
    }
    const selectedItem = getSelectedProviderPickerItem(picker);
    const candidates = selectedItem?.providerDescriptor?.candidates ?? [];
    if (!candidates.some((candidate) => candidate.id === candidateId)) {
      return;
    }
    emit({
      ...state,
      providerPicker: {
        ...picker,
        selectedQualityCandidateId: candidateId,
      },
    });
  }

  function setProviderPlaybackPolicy(policy: {
    proxy?: boolean;
    shared?: boolean;
    url?: string;
  }): void {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    const picker = state.providerPicker ?? {
      open: true,
      status: "idle" as const,
      proxy: false,
      shared: false,
      items: [],
    };
    emit({
      ...state,
      providerPicker: {
        ...picker,
        url: policy.url?.trim() || picker.url,
        proxy: policy.proxy ?? picker.proxy,
        shared: policy.shared ?? picker.shared,
      },
    });
  }

  function shareSelectedProviderItem(): void {
    if (state.view !== "joined" || !requireHostAuthorizationState()) {
      return;
    }
    if (!client || !activeSession) {
      appendDiagnostic("provider share denied: room session unavailable");
      return;
    }
    if (state.connectionState !== "connected") {
      appendDiagnostic("provider share denied: room disconnected");
      return;
    }

    const picker = state.providerPicker;
    const selectedItem = picker
      ? getSelectedProviderPickerItem(picker)
      : undefined;
    if (!picker || !selectedItem) {
      appendDiagnostic("provider share denied: no selected item");
      return;
    }

    const providerDescriptor = selectedItem.providerDescriptor;
    if (!providerDescriptor) {
      appendDiagnostic("provider share denied: missing playback descriptor");
      return;
    }
    const selectedProviderDescriptor = applySelectedProviderCandidate(
      providerDescriptor,
      picker.selectedQualityCandidateId,
    );

    const sharedRef = parseSharedVideoRef(selectedProviderDescriptor.sourceUrl);
    if (!sharedRef) {
      appendDiagnostic("provider share denied: unsupported source URL");
      return;
    }

    const title =
      selectedProviderDescriptor.title.trim() ||
      selectedItem.title.trim() ||
      selectedProviderDescriptor.item.title;
    const selectedPolicy = selectedProviderDescriptor.policy;
    const video: SharedVideo = {
      videoId: sharedRef.videoId,
      url: sharedRef.normalizedUrl,
      title,
      provider: {
        ...selectedProviderDescriptor,
        item: {
          ...selectedProviderDescriptor.item,
          itemId: selectedItem.itemId,
          title,
        },
        policy: {
          proxy: selectedPolicy.proxy || picker.proxy,
          shared: selectedPolicy.shared && picker.shared,
        },
      },
    };
    const sharePlaybackTime = getCurrentTime();
    const sharePlayback: PlaybackState | undefined =
      selectedProviderDescriptor.item.kind === "live"
        ? {
            url: sharedRef.normalizedUrl,
            currentTime: 0,
            playState: "playing",
            userInitiated: true,
            playbackRate: 1,
            updatedAt: sharePlaybackTime,
            serverTime: sharePlaybackTime,
            actorId: state.currentMemberId,
            seq: 0,
          }
        : undefined;

    client.shareVideo({
      memberToken: activeSession.memberToken,
      video,
      playback: sharePlayback,
    });
    appendDiagnostic("provider video share requested");
  }

  function canUseProxyFallback(): boolean {
    if (state.view !== "joined") {
      return false;
    }
    const pickerPolicyAllowsFallback =
      state.providerPicker?.proxy === false &&
      state.providerPicker.shared === true;
    const playbackPolicyAllowsFallback =
      state.providerPlaybackStatus?.proxy === false &&
      state.providerPlaybackStatus.shared === true;
    return pickerPolicyAllowsFallback || playbackPolicyAllowsFallback;
  }

  function getCurrentProviderId(): VideoProviderId | undefined {
    if (state.view !== "joined") {
      return undefined;
    }
    const picker = state.providerPicker;
    const selectedItem = picker?.items.find(
      (item) => item.itemId === picker.selectedItemId,
    );
    const providerId =
      selectedItem?.providerDescriptor?.providerId ??
      state.providerPlaybackStatus?.providerId;
    return providerId === "bilibili" ||
      providerId === "generic" ||
      providerId === "iqiyi" ||
      providerId === "huya"
      ? providerId
      : undefined;
  }

  function reportPlayback(
    event: WebPlaybackReportEvent,
    input?: {
      stage?: WebRoomPlaybackErrorStage;
    },
  ): void {
    if (!client || !activeSession) {
      return;
    }
    client.reportPlayback({
      memberToken: activeSession.memberToken,
      event,
      providerId: getCurrentProviderId(),
      ...(input?.stage ? { stage: input.stage } : {}),
    });
  }

  function showDirectPlaybackFailure(input: {
    stage: WebRoomPlaybackErrorStage;
    message: string;
  }): void {
    if (state.view !== "joined") {
      return;
    }
    const canFallback = canUseProxyFallback();
    reportPlayback("startup_failure", { stage: input.stage });
    if (canFallback) {
      reportPlayback("direct_link_failure");
    }
    emit({
      ...state,
      diagnostics: appendDiagnosticItem(
        `direct playback failed ${input.stage} ${input.message}`,
      ),
      playbackError: {
        code: "direct_playback_failed",
        stage: input.stage,
        message: input.message,
        canUseProxyFallback: canFallback,
      },
    });
  }

  async function retryProviderProxyFallback(): Promise<void> {
    if (state.view !== "joined") {
      return;
    }
    const picker = state.providerPicker;
    if (!picker) {
      appendDiagnostic("proxy fallback denied: no provider selection");
      return;
    }
    const url = picker.url?.trim();
    if (!url) {
      appendDiagnostic("proxy fallback denied: missing provider URL");
      return;
    }
    reportPlayback("proxy_fallback");
    emit({
      ...state,
      playbackError: undefined,
    });
    await parseBilibiliUrl({
      url,
      proxy: true,
      shared: true,
    });
    if (state.view !== "joined" || state.providerPicker?.status !== "ready") {
      return;
    }
    shareSelectedProviderItem();
  }

  function reportPlaybackLoaded(): void {
    if (state.view !== "joined") {
      return;
    }
    const status = state.providerPlaybackStatus;
    if (status?.proxy === false && status.shared === true) {
      reportPlayback("direct_link_success");
    }
  }

  if (persistedSession && options.autoReconnect !== false) {
    joinRoom(persistedSession);
  }

  return {
    getState: () => state,
    createRoom,
    joinRoom,
    sendChat,
    sendDanmaku,
    setRoomMemberPermission,
    kickRoomMember,
    transferRoomHost,
    requestVoiceAccess,
    toggleVoice,
    toggleVoiceMicrophone,
    toggleThemeMode,
    leaveRoom,
    openAuthorizationPanel,
    setBilibiliAuthMethod,
    startProviderAuth,
    startBilibiliAuth,
    logoutBilibiliAuth,
    closeAuthorizationPanel,
    collapseBilibiliAuth,
    openProviderPicker,
    parseBilibiliUrl,
    setProviderPickerResults,
    selectProviderItem,
    selectProviderQuality,
    setProviderPlaybackPolicy,
    shareSelectedProviderItem,
    showDirectPlaybackFailure,
    retryProviderProxyFallback,
    reportPlaybackLoaded,
    getPlaybackSyncContext,
    sendPlaybackUpdate,
  };
}
