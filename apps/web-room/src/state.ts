import type { PlaybackState } from "@syncroom/protocol";
import type {
  WebRoomChatMessage,
  WebRoomJoinedState,
  WebRoomProviderPlaybackStatus,
  WebRoomSystemChatEventType,
  WebRoomThemeMode,
} from "./render.js";
import {
  choosePreferredPlaybackCandidate,
  selectPlaybackAdapter,
  type PlaybackCandidate,
  type PlaybackSource,
} from "./playback-adapter.js";
import { createInitialWebRoomVoiceState } from "./voice-state.js";

type InitialJoinedStateInput = {
  roomCode: string;
  currentMemberId: string;
  hostMemberId?: string;
  displayName: string;
  themeMode?: WebRoomThemeMode;
  serverUrl?: string;
  joinToken?: string;
};

type RecordLike = Record<string, unknown>;

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

function appendDiagnostic(state: WebRoomJoinedState, item: string): string[] {
  return [...state.diagnostics, item].slice(-80);
}

function appendChatMessage(
  state: WebRoomJoinedState,
  message: WebRoomChatMessage,
): WebRoomChatMessage[] {
  return [...state.chatMessages, message].slice(-200);
}

const CHAT_SUCCESS_COOLDOWN_MS = 5_000;

const SYSTEM_CHAT_SUFFIX: Record<WebRoomSystemChatEventType, string> = {
  member_joined: "加入了房间",
  member_left: "离开了房间",
  voice_unmuted: "开启了麦克风",
  voice_muted: "关闭了麦克风",
};

function getSystemChatDisplayName(
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

function readPlaybackState(value: unknown): PlaybackState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const url = getString(value.url);
  const currentTime = getFiniteNumber(value.currentTime);
  const playbackRate = getFiniteNumber(value.playbackRate);
  const updatedAt = getFiniteNumber(value.updatedAt);
  const serverTime = getFiniteNumber(value.serverTime);
  const actorId = getString(value.actorId);
  const seq = getFiniteNumber(value.seq);
  if (
    url.length === 0 ||
    currentTime === undefined ||
    playbackRate === undefined ||
    updatedAt === undefined ||
    serverTime === undefined ||
    actorId.length === 0 ||
    seq === undefined ||
    (value.playState !== "playing" &&
      value.playState !== "paused" &&
      value.playState !== "buffering")
  ) {
    return undefined;
  }

  return {
    url,
    currentTime,
    playState: value.playState,
    ...(value.syncIntent === "explicit-seek" ||
    value.syncIntent === "explicit-ratechange"
      ? { syncIntent: value.syncIntent }
      : {}),
    ...(typeof value.userInitiated === "boolean"
      ? { userInitiated: value.userInitiated }
      : {}),
    playbackRate,
    updatedAt,
    serverTime,
    actorId,
    seq,
  };
}

export function createInitialJoinedState(
  input: InitialJoinedStateInput,
): WebRoomJoinedState {
  return {
    view: "joined",
    connectionState: "connected",
    themeMode: input.themeMode ?? "light",
    roomCode: input.roomCode,
    currentMemberId: input.currentMemberId,
    hostMemberId: input.hostMemberId ?? input.currentMemberId,
    displayName: input.displayName,
    serverUrl: input.serverUrl,
    joinToken: input.joinToken,
    announcement: undefined,
    videoTitle: undefined,
    authStatus: "unauthorized",
    voice: createInitialWebRoomVoiceState(),
    members: [{ id: input.currentMemberId, name: input.displayName }],
    chatMessages: [],
    danmakuMessages: [],
    diagnostics: ["joined"],
  };
}

function applyMemberJoined(
  state: WebRoomJoinedState,
  payload: RecordLike,
  currentTime: number,
): WebRoomJoinedState {
  const member = isRecord(payload.member) ? payload.member : null;
  const memberId = getString(member?.id);
  if (!member || memberId.length === 0) {
    return state;
  }

  const nextMember = {
    id: memberId,
    name: getString(member.name, "匿名成员"),
  };
  const nextState = {
    ...state,
    members: [
      ...state.members.filter((item) => item.id !== nextMember.id),
      nextMember,
    ],
    diagnostics: appendDiagnostic(state, "room:member-joined applied"),
  };
  return appendSystemChatMessage(nextState, {
    memberId: nextMember.id,
    displayName: nextMember.name,
    eventType: "member_joined",
    timestamp: currentTime,
  });
}

function applyMemberLeft(
  state: WebRoomJoinedState,
  payload: RecordLike,
  currentTime: number,
): WebRoomJoinedState {
  const member = isRecord(payload.member) ? payload.member : null;
  const leftMemberId = getString(member?.id);
  if (leftMemberId.length === 0) {
    return state;
  }
  const displayName = getSystemChatDisplayName(
    state,
    leftMemberId,
    getString(member?.name),
  );

  const nextState = {
    ...state,
    voice: {
      ...state.voice,
      participants: Object.fromEntries(
        Object.entries(state.voice.participants).filter(
          ([memberId]) => memberId !== leftMemberId,
        ),
      ),
    },
    members: state.members.filter((item) => item.id !== leftMemberId),
    diagnostics: appendDiagnostic(state, "room:member-left applied"),
  };
  return appendSystemChatMessage(nextState, {
    memberId: leftMemberId,
    displayName,
    eventType: "member_left",
    timestamp: currentTime,
  });
}

function getProviderPlaybackStatus(
  sharedVideo: RecordLike | null,
): WebRoomProviderPlaybackStatus | undefined {
  const provider = isRecord(sharedVideo?.provider)
    ? sharedVideo.provider
    : null;
  const policy = isRecord(provider?.policy) ? provider.policy : null;
  const item = isRecord(provider?.item) ? provider.item : null;
  if (
    !provider ||
    !policy ||
    typeof policy.proxy !== "boolean" ||
    typeof policy.shared !== "boolean"
  ) {
    return undefined;
  }

  const candidates = Array.isArray(provider.candidates)
    ? provider.candidates.filter(isRecord)
    : [];
  const defaultCandidateId = getString(provider.defaultCandidateId);
  const defaultCandidate =
    candidates.find(
      (candidate) =>
        getString(candidate.id).length > 0 &&
        getString(candidate.id) === defaultCandidateId,
    ) ?? candidates.find((candidate) => candidate.default === true);
  const providerId = getString(provider.providerId);
  const itemTitle = getString(item?.title, getString(provider.title));
  const sourceType = getString(defaultCandidate?.sourceType);
  if (providerId.length === 0) {
    return undefined;
  }

  return {
    providerId,
    ...(itemTitle.length > 0 ? { itemTitle } : {}),
    ...(sourceType.length > 0 ? { sourceType } : {}),
    proxy: policy.proxy,
    shared: policy.shared,
  };
}

function getProviderPlaybackSource(
  sharedVideo: RecordLike | null,
): PlaybackSource | undefined {
  const provider = isRecord(sharedVideo?.provider)
    ? sharedVideo.provider
    : null;
  if (!provider || !Array.isArray(provider.candidates)) {
    return undefined;
  }

  const candidates = provider.candidates
    .filter(isRecord)
    .map(
      (candidate): PlaybackCandidate => ({
        id: getString(candidate.id),
        sourceType: getString(candidate.sourceType),
        url: getString(candidate.url),
        codecs: getString(candidate.codecs) || undefined,
        qualityLabel: getString(candidate.qualityLabel) || undefined,
        default:
          typeof candidate.default === "boolean"
            ? candidate.default
            : undefined,
      }),
    )
    .filter(
      (candidate) =>
        candidate.id.length > 0 &&
        candidate.sourceType.length > 0 &&
        candidate.url.length > 0,
    );
  const defaultCandidateId = getString(provider.defaultCandidateId);
  const orderedCandidates =
    defaultCandidateId.length === 0
      ? candidates
      : candidates.map((candidate) => ({
          ...candidate,
          default: candidate.default || candidate.id === defaultCandidateId,
        }));
  const selectedCandidate = choosePreferredPlaybackCandidate(orderedCandidates);
  if (!selectedCandidate) {
    return undefined;
  }

  try {
    return {
      ...selectPlaybackAdapter({ sourceType: selectedCandidate.sourceType }),
      url: selectedCandidate.url,
    };
  } catch {
    return undefined;
  }
}

function applyRoomState(
  state: WebRoomJoinedState,
  payload: RecordLike,
): WebRoomJoinedState {
  const sharedVideo = isRecord(payload.sharedVideo)
    ? payload.sharedVideo
    : null;
  const members = Array.isArray(payload.members)
    ? payload.members
        .filter(isRecord)
        .map((member) => ({
          id: getString(member.id),
          name: getString(member.name, "匿名成员"),
        }))
        .filter((member) => member.id.length > 0)
    : state.members;

  return {
    ...state,
    roomCode: getString(payload.roomCode, state.roomCode),
    hostMemberId: getString(payload.hostMemberId, state.hostMemberId),
    videoTitle: sharedVideo
      ? getString(sharedVideo.title, state.videoTitle)
      : state.videoTitle,
    providerPlaybackStatus: getProviderPlaybackStatus(sharedVideo),
    playbackSource: getProviderPlaybackSource(sharedVideo),
    playbackUrl: sharedVideo
      ? getString(sharedVideo.url) || undefined
      : undefined,
    playback: readPlaybackState(payload.playback),
    members,
    diagnostics: appendDiagnostic(state, "room:state applied"),
  };
}

function applyAnnouncement(
  state: WebRoomJoinedState,
  payload: RecordLike,
): WebRoomJoinedState {
  const items = Array.isArray(payload.items)
    ? payload.items.filter(isRecord)
    : [];
  const firstItem = items[0];
  return {
    ...state,
    announcement: firstItem
      ? getString(firstItem.text, state.announcement)
      : state.announcement,
    diagnostics: appendDiagnostic(state, "announcement:update applied"),
  };
}

function applyChatMessage(
  state: WebRoomJoinedState,
  payload: RecordLike,
  currentTime: number,
): WebRoomJoinedState {
  const memberId = getString(payload.memberId);
  const nextCooldownUntil =
    memberId === state.currentMemberId
      ? Math.max(
          state.chatCooldownUntil ?? 0,
          currentTime + CHAT_SUCCESS_COOLDOWN_MS,
        )
      : state.chatCooldownUntil;

  return {
    ...state,
    ...(typeof nextCooldownUntil === "number"
      ? { chatCooldownUntil: nextCooldownUntil }
      : {}),
    chatMessages: appendChatMessage(state, {
      memberId,
      displayName: getString(payload.displayName, "匿名成员"),
      content: getString(payload.content),
      timestamp:
        typeof payload.timestamp === "number" &&
        Number.isFinite(payload.timestamp)
          ? payload.timestamp
          : currentTime,
    }),
    diagnostics: appendDiagnostic(state, "chat:message applied"),
  };
}

function getDanmakuMode(value: unknown): "scroll" | "top" | "bottom" {
  return value === "top" || value === "bottom" ? value : "scroll";
}

function getDanmakuColor(value: unknown): string {
  return typeof value === "string" &&
    /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
    ? value
    : "#ffffff";
}

function applyDanmakuMessage(
  state: WebRoomJoinedState,
  payload: RecordLike,
): WebRoomJoinedState {
  const videoTime =
    typeof payload.videoTime === "number" &&
    Number.isFinite(payload.videoTime) &&
    payload.videoTime >= 0
      ? payload.videoTime
      : 0;
  return {
    ...state,
    danmakuMessages: [
      ...state.danmakuMessages,
      {
        memberId: getString(payload.memberId),
        displayName: getString(payload.displayName, "匿名成员"),
        content: getString(payload.content),
        videoTime,
        mode: getDanmakuMode(payload.mode),
        color: getDanmakuColor(payload.color),
        timestamp:
          typeof payload.timestamp === "number" &&
          Number.isFinite(payload.timestamp)
            ? payload.timestamp
            : Date.now(),
      },
    ].slice(-200),
    diagnostics: appendDiagnostic(state, "danmaku:message applied"),
  };
}

function applyVoiceState(
  state: WebRoomJoinedState,
  payload: RecordLike,
  currentTime: number,
): WebRoomJoinedState {
  const memberId = getString(payload.memberId);
  if (memberId.length === 0) {
    return state;
  }
  const connected =
    typeof payload.connected === "boolean" ? payload.connected : false;
  const muted = typeof payload.muted === "boolean" ? payload.muted : true;
  const speaking =
    typeof payload.speaking === "boolean" ? payload.speaking : false;
  const participant = {
    memberId,
    connected,
    muted,
    speaking,
  };
  const previousParticipant = state.voice.participants[memberId];
  const nextState = {
    ...state,
    voice: {
      ...state.voice,
      muted: memberId === state.currentMemberId ? muted : state.voice.muted,
      speaking:
        memberId === state.currentMemberId ? speaking : state.voice.speaking,
      participants: {
        ...state.voice.participants,
        [memberId]: participant,
      },
    },
    diagnostics: appendDiagnostic(state, "voice:state received"),
  };

  if (
    connected &&
    previousParticipant?.connected === true &&
    previousParticipant.muted !== muted
  ) {
    return appendSystemChatMessage(nextState, {
      memberId,
      eventType: muted ? "voice_muted" : "voice_unmuted",
      timestamp: currentTime,
    });
  }

  return nextState;
}

function applyError(
  state: WebRoomJoinedState,
  payload: RecordLike,
  messageType: string,
  currentTime: number,
): WebRoomJoinedState {
  if (
    payload.code === "chat_rate_limited" &&
    payload.messageType === "chat:message" &&
    typeof payload.retryAfterMs === "number" &&
    Number.isFinite(payload.retryAfterMs)
  ) {
    return {
      ...state,
      chatCooldownUntil: currentTime + Math.max(0, payload.retryAfterMs),
      diagnostics: appendDiagnostic(state, "chat cooldown applied"),
    };
  }

  return {
    ...state,
    diagnostics: appendDiagnostic(state, `${messageType} received`),
  };
}

export function applyServerMessage(
  state: WebRoomJoinedState,
  message: unknown,
  options: { now?: () => number } = {},
): WebRoomJoinedState {
  if (!isRecord(message) || typeof message.type !== "string") {
    return state;
  }

  const payload = isRecord(message.payload) ? message.payload : {};
  switch (message.type) {
    case "room:state":
      return applyRoomState(state, payload);
    case "announcement:update":
      return applyAnnouncement(state, payload);
    case "chat:message":
      return applyChatMessage(state, payload, options.now?.() ?? Date.now());
    case "danmaku:message":
      return applyDanmakuMessage(state, payload);
    case "room:member-joined":
      return applyMemberJoined(state, payload, options.now?.() ?? Date.now());
    case "room:member-left":
      return applyMemberLeft(state, payload, options.now?.() ?? Date.now());
    case "voice:state":
      return applyVoiceState(state, payload, options.now?.() ?? Date.now());
    case "voice:access-granted":
    case "error":
      return message.type === "error"
        ? applyError(
            state,
            payload,
            message.type,
            options.now?.() ?? Date.now(),
          )
        : {
            ...state,
            diagnostics: appendDiagnostic(state, `${message.type} received`),
          };
    default:
      return state;
  }
}
