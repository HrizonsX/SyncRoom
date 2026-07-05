import {
  isPlaybackSyncIntent,
  type PlaybackSyncState,
  type PlaybackState,
  type ProviderPlaybackDescriptor,
} from "@syncroom/protocol";
import type {
  WebRoomJoinedState,
  WebRoomProviderPickerItem,
  WebRoomProviderPickerState,
  WebRoomProviderPlaybackStatus,
  WebRoomThemeMode,
} from "../ui/render.js";
import { readMemberPermissions } from "./member-permissions.js";
import {
  choosePreferredPlaybackCandidate,
  selectPlaybackAdapter,
  type PlaybackCandidate,
  type PlaybackSource,
} from "../playback/playback-adapter.js";
import { createInitialWebRoomVoiceState } from "../voice/voice-state.js";
import {
  appendChatMessage,
  appendSystemChatMessage,
  CHAT_SUCCESS_COOLDOWN_MS,
  DANMAKU_SUCCESS_COOLDOWN_MS,
  getSystemChatDisplayName,
  mergeChatMessages,
  readRoomChatHistory,
} from "./chat-state.js";
export { appendSystemChatMessage } from "./chat-state.js";

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
const CLOCK_SAMPLE_SMOOTHING_PREVIOUS_WEIGHT = 0.7;
const CLOCK_SAMPLE_SMOOTHING_CURRENT_WEIGHT = 0.3;

function createDefaultPlaybackSyncState(): PlaybackSyncState {
  return {
    strategy: "smooth",
    hold: {
      active: false,
    },
    bufferingMemberIds: [],
  };
}

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

function readPlaybackSyncState(value: unknown): PlaybackSyncState {
  if (!isRecord(value)) {
    return createDefaultPlaybackSyncState();
  }
  const hold = isRecord(value.hold) ? value.hold : {};
  const strategy = value.strategy === "wait" ? "wait" : "smooth";
  const bufferingMemberIds = Array.isArray(value.bufferingMemberIds)
    ? value.bufferingMemberIds.filter(
        (memberId): memberId is string => typeof memberId === "string",
      )
    : [];
  return {
    strategy,
    hold: {
      active: hold.active === true,
      ...(typeof hold.reasonMemberId === "string"
        ? { reasonMemberId: hold.reasonMemberId }
        : {}),
      ...(typeof hold.startedAt === "number" && Number.isFinite(hold.startedAt)
        ? { startedAt: hold.startedAt }
        : {}),
      ...(typeof hold.deadlineAt === "number" &&
      Number.isFinite(hold.deadlineAt)
        ? { deadlineAt: hold.deadlineAt }
        : {}),
    },
    bufferingMemberIds,
  };
}

function appendDiagnostic(state: WebRoomJoinedState, item: string): string[] {
  return [...state.diagnostics, item].slice(-80);
}

function appendRoomStateDiagnostic(
  state: WebRoomJoinedState,
  item: string,
): string[] {
  // 播放中 room:state 会被重复推送；只记录摘要变化，避免诊断日志被刷屏。
  return state.diagnostics.at(-1) === item
    ? state.diagnostics
    : appendDiagnostic(state, item);
}

function smoothClockMetric(
  previousValue: number | null | undefined,
  sampleValue: number,
): number {
  return previousValue === null || previousValue === undefined
    ? sampleValue
    : Math.round(
        previousValue * CLOCK_SAMPLE_SMOOTHING_PREVIOUS_WEIGHT +
          sampleValue * CLOCK_SAMPLE_SMOOTHING_CURRENT_WEIGHT,
      );
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
    ...(isPlaybackSyncIntent(value.syncIntent)
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

/**
 * 构造刚加入房间时的本地可渲染状态，后续服务器消息会在这个基础上增量合并。
 */
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
    clockOffsetMs: null,
    rttMs: null,
    voice: createInitialWebRoomVoiceState(),
    playbackSync: createDefaultPlaybackSyncState(),
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

  const memberPermissions = readMemberPermissions(member.permissions);
  const nextMember = {
    id: memberId,
    ...(memberPermissions ? { permissions: memberPermissions } : {}),
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

function getSharedVideoTitle(
  sharedVideo: RecordLike | null,
  fallback?: string,
): string | undefined {
  if (!sharedVideo) {
    return fallback;
  }

  const provider = isRecord(sharedVideo.provider) ? sharedVideo.provider : null;
  const providerTitle = getString(provider?.title).trim();
  if (providerTitle.length > 0) {
    return providerTitle;
  }

  return getString(sharedVideo.title, fallback);
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
  const item = isRecord(provider.item) ? provider.item : null;
  const isLive = getString(item?.kind) === "live";

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
      candidateId: selectedCandidate.id,
      ...(isLive ? { isLive: true } : {}),
    };
  } catch {
    return undefined;
  }
}

function getProviderPickerItemKind(
  value: unknown,
): WebRoomProviderPickerItem["kind"] | undefined {
  return value === "part" || value === "episode" || value === "live"
    ? value
    : undefined;
}

function getDefaultProviderCandidateId(
  provider: RecordLike,
): string | undefined {
  const candidates = Array.isArray(provider.candidates)
    ? provider.candidates.filter(isRecord)
    : [];
  const defaultCandidateId = getString(provider.defaultCandidateId);
  if (
    defaultCandidateId &&
    candidates.some(
      (candidate) => getString(candidate.id) === defaultCandidateId,
    )
  ) {
    return defaultCandidateId;
  }

  const flaggedCandidateId = getString(
    candidates.find((candidate) => candidate.default === true)?.id,
  );
  if (flaggedCandidateId) {
    return flaggedCandidateId;
  }

  return getString(candidates[0]?.id) || undefined;
}

function createProviderPickerFromSharedVideo(
  state: WebRoomJoinedState,
  sharedVideo: RecordLike | null,
): WebRoomProviderPickerState | undefined {
  // 房主刷新后需要从房间共享视频恢复“视频设置”面板；非房主不暴露管理态。
  if (state.currentMemberId !== state.hostMemberId) {
    return state.providerPicker;
  }
  if (state.providerPicker?.status === "loading") {
    return state.providerPicker;
  }
  if (state.providerPicker && state.providerPicker.items.length > 0) {
    return state.providerPicker;
  }

  const provider = isRecord(sharedVideo?.provider)
    ? sharedVideo.provider
    : null;
  const policy = isRecord(provider?.policy) ? provider.policy : null;
  const item = isRecord(provider?.item) ? provider.item : null;
  const kind = getProviderPickerItemKind(item?.kind);
  const itemId = getString(item?.itemId);
  const itemTitle = getString(item?.title, getString(provider?.title));
  if (
    !provider ||
    !policy ||
    !item ||
    !kind ||
    itemId.length === 0 ||
    itemTitle.length === 0 ||
    typeof policy.proxy !== "boolean" ||
    typeof policy.shared !== "boolean" ||
    !Array.isArray(provider.candidates) ||
    provider.candidates.length === 0
  ) {
    return state.providerPicker;
  }

  const selectedQualityCandidateId = getDefaultProviderCandidateId(provider);
  const selectedCandidate = provider.candidates
    .filter(isRecord)
    .find(
      (candidate) => getString(candidate.id) === selectedQualityCandidateId,
    );
  return {
    open: true,
    status: "ready",
    url: getString(provider.sourceUrl, getString(sharedVideo?.url)),
    proxy: policy.proxy,
    shared: policy.shared,
    items: [
      {
        itemId,
        title: itemTitle,
        kind,
        qualityLabel: getString(selectedCandidate?.qualityLabel) || undefined,
        sourceType: getString(selectedCandidate?.sourceType) || undefined,
        durationSeconds: getFiniteNumber(item.durationSeconds),
        providerDescriptor: provider as unknown as ProviderPlaybackDescriptor,
      },
    ],
    selectedItemId: itemId,
    selectedQualityCandidateId,
    message: getString(provider.title) || undefined,
  };
}

/**
 * 应用服务器下发的完整房间快照，并保留本地可恢复的 UI 状态与聊天历史。
 */
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
        .map((member) => {
          const permissions = readMemberPermissions(member.permissions);
          return {
            id: getString(member.id),
            ...(permissions ? { permissions } : {}),
            name: getString(member.name, "匿名成员"),
          };
        })
        .filter((member) => member.id.length > 0)
    : state.members;
  const playback = readPlaybackState(payload.playback);
  const playbackSync = readPlaybackSyncState(payload.playbackSync);
  const playbackSource = getProviderPlaybackSource(sharedVideo);
  const providerPicker = createProviderPickerFromSharedVideo(
    state,
    sharedVideo,
  );
  const chatMessages = mergeChatMessages(
    state.chatMessages,
    readRoomChatHistory(payload.chatMessages),
  );

  return {
    ...state,
    roomCode: getString(payload.roomCode, state.roomCode),
    hostMemberId: getString(payload.hostMemberId, state.hostMemberId),
    videoTitle: sharedVideo
      ? getSharedVideoTitle(sharedVideo, state.videoTitle)
      : state.videoTitle,
    providerPicker,
    providerPlaybackStatus: getProviderPlaybackStatus(sharedVideo),
    playbackSource,
    playbackUrl: sharedVideo
      ? getString(sharedVideo.url) || undefined
      : undefined,
    playback,
    playbackSync,
    members,
    chatMessages,
    diagnostics: appendRoomStateDiagnostic(
      state,
      [
        "room:state applied",
        `members:${members.length}`,
        `chat:${chatMessages.length}`,
        `source:${playbackSource ? `${playbackSource.engine}/${playbackSource.sourceType}` : "-"}`,
        `playback:${playback?.playState ?? "-"}`,
      ].join(" "),
    ),
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
  currentTime: number,
): WebRoomJoinedState {
  const timestamp =
    typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp)
      ? payload.timestamp
      : currentTime;
  const memberId = getString(payload.memberId);
  const nextCooldownUntil =
    memberId === state.currentMemberId
      ? Math.max(
          state.danmakuCooldownUntil ?? 0,
          currentTime + DANMAKU_SUCCESS_COOLDOWN_MS,
        )
      : state.danmakuCooldownUntil;
  const videoTime =
    typeof payload.videoTime === "number" &&
    Number.isFinite(payload.videoTime) &&
    payload.videoTime >= 0
      ? payload.videoTime
      : 0;
  const nextSequence = (state.danmakuSequence ?? 0) + 1;
  return {
    ...state,
    danmakuSequence: nextSequence,
    ...(typeof nextCooldownUntil === "number"
      ? { danmakuCooldownUntil: nextCooldownUntil }
      : {}),
    danmakuMessages: [
      ...state.danmakuMessages,
      {
        renderKey: [state.roomCode, nextSequence, memberId, timestamp].join(
          ":",
        ),
        memberId,
        displayName: getString(payload.displayName, "匿名成员"),
        content: getString(payload.content),
        videoTime,
        mode: getDanmakuMode(payload.mode),
        color: getDanmakuColor(payload.color),
        timestamp,
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
      diagnostics: appendDiagnostic(
        state,
        [
          "chat cooldown applied",
          getString(payload.code),
          getString(payload.message),
        ]
          .filter(Boolean)
          .join(" "),
      ),
    };
  }

  if (
    payload.code === "chat_rate_limited" &&
    payload.messageType === "danmaku:message" &&
    typeof payload.retryAfterMs === "number" &&
    Number.isFinite(payload.retryAfterMs)
  ) {
    return {
      ...state,
      danmakuCooldownUntil: currentTime + Math.max(0, payload.retryAfterMs),
      diagnostics: appendDiagnostic(state, "danmaku cooldown applied"),
    };
  }

  const details = [
    "error received",
    getString(payload.code),
    getString(payload.messageType, messageType),
    getString(payload.message),
  ].filter(Boolean);

  return {
    ...state,
    diagnostics: appendDiagnostic(state, details.join(" ")),
  };
}

function applySyncPong(
  state: WebRoomJoinedState,
  payload: RecordLike,
  currentTime: number,
): WebRoomJoinedState {
  const clientSendTime = getFiniteNumber(payload.clientSendTime);
  const serverReceiveTime = getFiniteNumber(payload.serverReceiveTime);
  const serverSendTime = getFiniteNumber(payload.serverSendTime);
  if (
    clientSendTime === undefined ||
    serverReceiveTime === undefined ||
    serverSendTime === undefined
  ) {
    return state;
  }

  const sampleRtt =
    currentTime - clientSendTime - (serverSendTime - serverReceiveTime);
  const sampleOffset =
    (serverReceiveTime - clientSendTime + (serverSendTime - currentTime)) / 2;
  const rttMs = smoothClockMetric(state.rttMs, sampleRtt);
  const clockOffsetMs = smoothClockMetric(state.clockOffsetMs, sampleOffset);

  return {
    ...state,
    rttMs,
    clockOffsetMs,
    diagnostics: appendDiagnostic(
      state,
      `sync:pong applied offset=${clockOffsetMs}ms rtt=${rttMs}ms`,
    ),
  };
}

/**
 * 将服务端 WebSocket 消息折叠为新的 joined 状态，是房间状态机的统一入口。
 */
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
      return applyDanmakuMessage(state, payload, options.now?.() ?? Date.now());
    case "room:member-joined":
      return applyMemberJoined(state, payload, options.now?.() ?? Date.now());
    case "room:member-left":
      return applyMemberLeft(state, payload, options.now?.() ?? Date.now());
    case "voice:state":
      return applyVoiceState(state, payload, options.now?.() ?? Date.now());
    case "sync:pong":
      return applySyncPong(state, payload, options.now?.() ?? Date.now());
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
