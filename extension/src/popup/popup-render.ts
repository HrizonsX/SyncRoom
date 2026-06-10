import type { RoomMember } from "@bili-syncplay/protocol";
import type { BackgroundPopupState } from "../shared/messages";
import { getUiLanguage, t } from "../shared/i18n";
import type {
  VoiceConnectionStatus,
  VoiceRuntimeState,
} from "../shared/voice-state";
import {
  getRenderedServerUrlValue,
  type ServerUrlDraftState,
} from "./server-url-draft";
import type { PopupRefs } from "./popup-view";

let lastPendingRenderLogKey: string | null = null;
const VIDEO_TITLE_SCROLL_THRESHOLD = 28;
const ANNOUNCEMENT_SLIDE_HEIGHT_PX = 32;
const ANNOUNCEMENT_MIN_ITEM_DURATION_SECONDS = 5.6;
const ANNOUNCEMENT_MAX_ITEM_DURATION_SECONDS = 14;
const ANNOUNCEMENT_SECONDS_PER_CHARACTER = 0.16;

export function resetPopupRenderDebugStateForTests(): void {
  lastPendingRenderLogKey = null;
}

export function formatInviteDraft(
  roomCode: string | null,
  joinToken: string | null,
): string {
  if (!roomCode) {
    return "";
  }
  return joinToken ? `${roomCode}:${joinToken}` : roomCode;
}

export function applyRoomActionControlState(args: {
  refs: PopupRefs;
  roomActionPending: boolean;
  lastKnownPendingCreateRoom: boolean;
  lastKnownPendingJoinRoomCode: string | null;
  lastKnownRoomCode: string | null;
}): void {
  const isRoomTransitioning =
    args.roomActionPending ||
    args.lastKnownPendingCreateRoom ||
    Boolean(args.lastKnownPendingJoinRoomCode);
  args.refs.createRoomButton.disabled = isRoomTransitioning;
  args.refs.joinRoomButton.disabled =
    isRoomTransitioning || !args.refs.roomCodeInput.value.trim();
  args.refs.leaveRoomButton.disabled = isRoomTransitioning;
  args.refs.roomCodeInput.disabled =
    isRoomTransitioning || Boolean(args.lastKnownRoomCode);
}

export function renderPopup(args: {
  refs: PopupRefs;
  state: BackgroundPopupState;
  serverUrlDraft: ServerUrlDraftState;
  roomCodeDraft: string;
  setRoomCodeDraft: (value: string) => void;
  localStatusMessage: string | null;
  roomActionPending: boolean;
  lastKnownPendingCreateRoom: boolean;
  lastKnownPendingJoinRoomCode: string | null;
  lastKnownRoomCode: string | null;
  copyRoomSuccess: boolean;
  copyLogsSuccess: boolean;
  easterEggVisible?: boolean;
  easterEggEffectActive?: boolean;
  sendPopupLog: (message: string) => Promise<void>;
}): void {
  const roomCodeFocused = document.activeElement === args.refs.roomCodeInput;
  const serverUrlFocused = document.activeElement === args.refs.serverUrlInput;

  args.refs.serverStatus.textContent = args.state.connected
    ? t("statusConnected")
    : t("statusDisconnected");
  args.refs.serverStatus.classList.toggle("is-connected", args.state.connected);
  args.refs.serverStatus.classList.toggle(
    "is-disconnected",
    !args.state.connected,
  );
  args.refs.roomStatus.textContent = args.state.roomCode ?? "-";
  args.refs.membersStatus.textContent = formatMembersCount(
    args.state.roomState?.members.length ?? 0,
  );
  args.refs.debugMemberStatus.textContent =
    args.state.displayName ?? args.state.memberId ?? "-";
  args.refs.retryStatusValue.textContent =
    args.state.retryInMs !== null
      ? t("retrySeconds", { seconds: Math.ceil(args.state.retryInMs / 1000) })
      : "-";
  args.refs.retryStatusCount.textContent =
    args.state.retryAttempt > 0
      ? `(${args.state.retryAttempt}/${args.state.retryAttemptMax})`
      : "";
  args.refs.clockOffsetStatus.textContent = formatClockMetricValue(
    args.state.clockOffsetMs,
  );
  args.refs.rttStatus.textContent = formatClockMetricValue(args.state.rttMs);
  const retryProgress = formatRetryProgress({
    retryAttempt: args.state.retryAttempt,
    retryAttemptMax: args.state.retryAttemptMax,
  });
  const retryActive = shouldShowRoomEntryRetryProgress({
    pendingCreateRoom:
      args.state.pendingCreateRoom || args.lastKnownPendingCreateRoom,
    pendingJoinRoomCode:
      args.state.pendingJoinRoomCode ?? args.lastKnownPendingJoinRoomCode,
    retryProgress,
  });
  const visibleRetryProgress =
    retryActive && !args.localStatusMessage ? retryProgress : "";
  const visibleMessage =
    args.localStatusMessage ??
    args.state.error ??
    (visibleRetryProgress ? t("connectionServerUnreachable") : null);
  renderStatusMessage(args.refs.message, visibleMessage, visibleRetryProgress);
  args.refs.message.hidden = !visibleMessage;
  renderAnnouncements(args.refs, args.state.announcements?.items ?? []);
  renderRoomActionLabels({
    createRoomButton: args.refs.createRoomButton,
    joinRoomButton: args.refs.joinRoomButton,
  });

  if (!roomCodeFocused) {
    if (args.state.roomCode) {
      const nextRoomCodeDraft = formatInviteDraft(
        args.state.roomCode,
        args.state.joinToken,
      );
      args.setRoomCodeDraft(nextRoomCodeDraft);
      args.refs.roomCodeInput.value = nextRoomCodeDraft;
    } else {
      args.refs.roomCodeInput.value = args.roomCodeDraft;
    }
  }
  args.refs.serverUrlInput.value = getRenderedServerUrlValue(
    args.serverUrlDraft,
    args.state.serverUrl,
    serverUrlFocused,
  );

  args.refs.copyRoomButton.disabled = !args.state.roomCode;
  args.refs.copyRoomButton.classList.toggle(
    "success-button",
    args.copyRoomSuccess,
  );
  args.refs.copyLogsButton.classList.toggle(
    "success-button",
    args.copyLogsSuccess,
  );
  args.refs.roomPanelJoined.hidden = !args.state.roomCode;
  args.refs.roomPanelIdle.hidden = Boolean(args.state.roomCode);
  args.refs.easterEgg.hidden = !args.easterEggVisible;
  args.refs.sharedVideoPanel.classList.toggle(
    "is-easter-egg-active",
    Boolean(args.easterEggEffectActive),
  );
  applyRoomActionControlState({
    refs: args.refs,
    roomActionPending: args.roomActionPending,
    lastKnownPendingCreateRoom: args.lastKnownPendingCreateRoom,
    lastKnownPendingJoinRoomCode: args.lastKnownPendingJoinRoomCode,
    lastKnownRoomCode: args.lastKnownRoomCode,
  });

  const hasRoom = Boolean(args.state.roomCode);
  const sharedVideo = args.state.roomState?.sharedVideo ?? null;
  const hasSharedVideo = Boolean(sharedVideo?.url);
  renderSharedVideoTitle(
    args.refs.sharedVideoTitle,
    sharedVideo?.title ?? t("stateNoSharedVideo"),
  );
  args.refs.sharedVideoMeta.textContent = formatVideoMeta(
    sharedVideo?.url ?? null,
  );
  const ownerText = formatVideoOwner(
    args.state.roomState?.members ?? [],
    sharedVideo?.sharedByMemberId ?? null,
    sharedVideo?.sharedByDisplayName ?? null,
  );
  const emptySharedVideoHint = !hasSharedVideo ? t("sharedVideoIdleHint") : "";
  args.refs.sharedVideoOwnerText.textContent =
    ownerText || emptySharedVideoHint;
  args.refs.sharedVideoOwner.hidden =
    (hasSharedVideo && !ownerText) ||
    (!hasSharedVideo && !emptySharedVideoHint);
  args.refs.sharedVideoCard.disabled = !hasSharedVideo;
  args.refs.sharedVideoCard.classList.toggle("is-empty", !hasSharedVideo);
  args.refs.shareCurrentVideoButton.disabled = !args.state.roomCode;

  renderVoiceState(args.refs, args.state.voice, hasRoom);
  renderMemberList(
    args.refs.memberList,
    args.state.roomState?.members ?? [],
    args.state.memberId,
    args.state.displayName,
    args.state.voice,
    hasRoom,
  );
  renderLogs(args.refs.logs, args.state.logs);
  renderAdvancedState(args.refs);

  if (args.state.pendingJoinRoomCode || args.roomActionPending) {
    const logKey = [
      args.state.roomCode ?? "none",
      String(args.state.connected),
      args.state.pendingJoinRoomCode ?? "none",
      String(args.roomActionPending),
      args.lastKnownPendingJoinRoomCode ?? "none",
      args.lastKnownRoomCode ?? "none",
    ].join("|");
    if (logKey === lastPendingRenderLogKey) {
      return;
    }
    lastPendingRenderLogKey = logKey;
    void args.sendPopupLog(
      `Render room=${args.state.roomCode ?? "none"} connected=${args.state.connected} backgroundPendingJoin=${args.state.pendingJoinRoomCode ?? "none"} uiPendingAction=${args.roomActionPending} lastKnownPendingJoin=${args.lastKnownPendingJoinRoomCode ?? "none"} lastKnownRoom=${args.lastKnownRoomCode ?? "none"}`,
    );
    return;
  }

  lastPendingRenderLogKey = null;
}

function renderAnnouncements(
  refs: PopupRefs,
  items: NonNullable<BackgroundPopupState["announcements"]>["items"],
): void {
  refs.announcementPanel.hidden = items.length === 0;
  if (items.length === 0) {
    refs.announcementTrack.className = "announcement-track";
    refs.announcementTrack.setAttribute("style", "");
    refs.announcementTrack.replaceChildren();
    return;
  }

  refs.announcementTrack.className =
    items.length > 1 ? "announcement-track" : "announcement-track is-single";
  const announcementTexts = items.map(formatAnnouncementDisplayText);
  const itemDurationSeconds =
    getAnnouncementItemDurationSeconds(announcementTexts);
  refs.announcementTrack.setAttribute(
    "style",
    [
      `--announcement-count: ${items.length}`,
      `--announcement-end-offset: -${items.length * ANNOUNCEMENT_SLIDE_HEIGHT_PX}px`,
      `--announcement-cycle-duration: ${items.length * itemDurationSeconds}s`,
      `--announcement-item-duration: ${itemDurationSeconds}s`,
    ].join("; "),
  );

  const renderedItems = announcementTexts.map((text, index) =>
    createAnnouncementSlide(text, index),
  );
  refs.announcementTrack.replaceChildren(...renderedItems);
}

function getAnnouncementItemDurationSeconds(texts: string[]): number {
  const longestLength = Math.max(0, ...texts.map((text) => text.length));
  const duration =
    Math.ceil(longestLength * ANNOUNCEMENT_SECONDS_PER_CHARACTER * 10) / 10;
  return Math.min(
    ANNOUNCEMENT_MAX_ITEM_DURATION_SECONDS,
    Math.max(ANNOUNCEMENT_MIN_ITEM_DURATION_SECONDS, duration),
  );
}

function formatAnnouncementDisplayText(
  item: NonNullable<BackgroundPopupState["announcements"]>["items"][number],
): string {
  const title = item.id.trim();
  const text = item.text.trim();
  if (title && text) {
    return `${title}-${text}`;
  }
  return title || text;
}

function createAnnouncementSlide(text: string, index: number): HTMLElement {
  const slide = document.createElement("span");
  slide.className = "announcement-slide";
  slide.setAttribute("data-announcement-index", String(index));
  const marquee = document.createElement("span");
  marquee.className = "announcement-marquee";
  marquee.append(createAnnouncementItem(text));
  slide.append(marquee);
  return slide;
}

function createAnnouncementItem(text: string): HTMLElement {
  const item = document.createElement("span");
  item.className = "announcement-item";
  item.textContent = text;
  return item;
}

function renderSharedVideoTitle(container: HTMLElement, title: string): void {
  const titleText = document.createElement("span");
  titleText.className = "video-title-text";
  titleText.textContent = title;
  container.replaceChildren(titleText);
  container.title = title;
  container.className =
    title.length > VIDEO_TITLE_SCROLL_THRESHOLD
      ? "video-title is-scrollable"
      : "video-title";
}

function renderRoomActionLabels(args: {
  createRoomButton: HTMLButtonElement;
  joinRoomButton: HTMLButtonElement;
}): void {
  args.createRoomButton.textContent = t("actionCreateRoom");
  args.joinRoomButton.textContent = t("actionJoin");
}

function renderStatusMessage(
  container: HTMLElement,
  message: string | null,
  retryProgress: string,
): void {
  if (!message) {
    container.replaceChildren();
    return;
  }
  container.textContent = retryProgress
    ? `${message}${t("retryProgressSuffix", { progress: retryProgress })}`
    : message;
  if (retryProgress) {
    const dots = document.createElement("span");
    dots.className = "status-retry-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) {
      const dot = document.createElement("span");
      dot.className = "status-retry-dot";
      dot.textContent = ".";
      dots.append(dot);
    }
    container.append(dots);
  }
}

function shouldShowRoomEntryRetryProgress(args: {
  pendingCreateRoom: boolean;
  pendingJoinRoomCode: string | null;
  retryProgress: string;
}): boolean {
  return (
    Boolean(args.retryProgress) &&
    (args.pendingCreateRoom || Boolean(args.pendingJoinRoomCode))
  );
}

function formatRetryProgress(args: {
  retryAttempt: number;
  retryAttemptMax: number;
}): string {
  if (args.retryAttempt <= 0 || args.retryAttemptMax <= 0) {
    return "";
  }
  return /^en\b/i.test(getUiLanguage())
    ? `(${args.retryAttempt}/${args.retryAttemptMax})`
    : `（${args.retryAttempt}/${args.retryAttemptMax}）`;
}

function formatVideoMeta(url: string | null): string {
  if (!url) {
    return t("stateNotSynced");
  }
  const match = url.match(/\/video\/([^/?]+)/);
  if (match) {
    return `Bilibili · ${match[1]}`;
  }
  try {
    return new URL(url).hostname;
  } catch {
    return t("actionOpenSharedVideo");
  }
}

function formatClockMetricValue(value: number | null): string {
  return value === null ? "-" : `${value}ms`;
}

function formatVideoOwner(
  members: RoomMember[],
  actorId: string | null,
  fallbackDisplayName: string | null,
): string {
  const liveName = actorId
    ? members.find((member) => member.id === actorId)?.name
    : undefined;
  const owner = liveName ?? fallbackDisplayName?.trim();
  return owner ? t("ownerSharedBy", { owner }) : "";
}

function renderLogs(
  container: HTMLElement,
  logs: BackgroundPopupState["logs"],
): void {
  const previousScrollTop = container.scrollTop;
  if (logs.length === 0) {
    const empty = document.createElement("div");
    empty.className = "log-empty advanced-log-line";
    empty.textContent = t("stateNoLogs");
    container.replaceChildren(empty);
    container.scrollTop = 0;
    return;
  }

  container.replaceChildren(
    ...logs.map((entry) => {
      const time = new Date(entry.at).toLocaleTimeString(getUiLanguage(), {
        hour12: false,
      });
      const line = document.createElement("div");
      line.className = "log-line advanced-log-line";
      line.textContent = `[${time}] [${entry.scope}] ${entry.message}`;
      return line;
    }),
  );
  container.scrollTop = previousScrollTop;
}

function renderMemberList(
  container: HTMLElement,
  members: RoomMember[],
  currentMemberId: string | null,
  displayName: string | null,
  voiceState: VoiceRuntimeState,
  hasRoom: boolean,
): void {
  if (!hasRoom) {
    container.replaceChildren(createSelfIdleMemberRow(displayName, voiceState));
    return;
  }

  container.replaceChildren(
    ...members.map((member) => {
      const isCurrentMember = currentMemberId === member.id;
      const row = document.createElement("div");
      row.className = isCurrentMember ? "member-row is-self" : "member-row";
      const info = document.createElement("div");
      info.className = "member-info";
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = getMemberAvatarText(member.name, isCurrentMember);
      const text = document.createElement("span");
      const name = document.createElement("span");
      name.className = "member-name";
      name.textContent = isCurrentMember
        ? t("memberSelf", { name: member.name })
        : member.name;
      const voiceText = document.createElement("span");
      voiceText.className = "member-voice";
      voiceText.textContent = formatMemberVoiceText(
        voiceState,
        member.id,
        isCurrentMember,
      );
      text.append(name, voiceText);
      info.append(avatar, text);
      row.append(
        info,
        createMemberVoiceControl({
          memberId: member.id,
          isCurrentMember,
          hasRoom,
          voiceState,
        }),
      );
      return row;
    }),
  );
}

function renderVoiceState(
  refs: PopupRefs,
  voiceState: VoiceRuntimeState,
  hasRoom: boolean,
): void {
  refs.voiceStatus.textContent = hasRoom
    ? formatVoiceStatus(voiceState.status)
    : t("stateNotInRoom");
  refs.voiceStatus.classList.toggle(
    "is-muted",
    !hasRoom || voiceState.status !== "connected",
  );
  refs.voiceError.textContent = voiceState.error ?? "";
  refs.voiceError.hidden = !voiceState.error;
}

function renderAdvancedState(refs: PopupRefs): void {
  const label = refs.advancedDetails.open
    ? t("actionExpanded")
    : t("actionExpand");
  refs.advancedState.classList.toggle("is-open", refs.advancedDetails.open);
  refs.advancedState.setAttribute("aria-label", label);
  refs.advancedState.title = label;
}

function isVoiceRetryStatus(status: VoiceConnectionStatus): boolean {
  return status === "failed" || status === "unavailable";
}

function formatVoiceStatus(status: VoiceConnectionStatus): string {
  switch (status) {
    case "requesting":
      return t("voiceStatusRequesting");
    case "connecting":
      return t("voiceStatusConnecting");
    case "connected":
      return t("voiceStatusConnected");
    case "unavailable":
      return t("voiceStatusUnavailable");
    case "failed":
      return t("voiceStatusFailed");
    case "idle":
    default:
      return t("voiceStatusIdle");
  }
}

function formatMembersCount(count: number): string {
  if (count === 1) {
    return t("membersCountSingular", { count });
  }
  return t("membersCount", { count });
}

function createSelfIdleMemberRow(
  displayName: string | null,
  voiceState: VoiceRuntimeState,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "member-row is-self";
  const info = document.createElement("div");
  info.className = "member-info";
  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.textContent = getSelfAvatarText();
  const name = document.createElement("span");
  name.className = "member-name";
  name.textContent = displayName
    ? t("memberSelf", { name: displayName })
    : t("memberSelfFallback");
  info.append(avatar, name);
  row.append(
    info,
    createMemberVoiceControl({
      memberId: null,
      isCurrentMember: true,
      hasRoom: false,
      voiceState,
    }),
  );
  return row;
}

function createMemberVoiceControl(args: {
  memberId: string | null;
  isCurrentMember: boolean;
  hasRoom: boolean;
  voiceState: VoiceRuntimeState;
}): HTMLElement {
  const participant = args.memberId
    ? getRenderedParticipant(
        args.voiceState,
        args.memberId,
        args.isCurrentMember,
      )
    : null;
  const isInteractive = args.isCurrentMember && args.hasRoom;
  const control = document.createElement(isInteractive ? "button" : "span");
  control.className = "member-state";
  if (isInteractive) {
    const canRetryVoice = isVoiceRetryStatus(args.voiceState.status);
    const disabled = args.voiceState.status !== "connected" && !canRetryVoice;
    (control as HTMLButtonElement).type = "button";
    (control as HTMLButtonElement).disabled = disabled;
    control.setAttribute("data-voice-mic-toggle", "true");
    control.setAttribute(
      "aria-pressed",
      String(args.voiceState.status === "connected" && !args.voiceState.muted),
    );
    control.setAttribute(
      "aria-label",
      canRetryVoice
        ? t("voiceActionRetry")
        : args.voiceState.muted
          ? t("voiceActionUnmute")
          : t("voiceActionMute"),
    );
    control.title = canRetryVoice
      ? t("voiceActionRetry")
      : args.voiceState.muted
        ? t("voiceActionUnmute")
        : t("voiceActionMute");
    control.classList.toggle("is-retry", canRetryVoice);
    control.classList.toggle(
      "is-live",
      args.voiceState.status === "connected" && !args.voiceState.muted,
    );
  }
  const isMutedOrUnknown =
    args.hasRoom && (!participant?.connected || participant.muted);
  control.classList.toggle("disabled-mic", !args.hasRoom);
  control.classList.toggle("muted", isMutedOrUnknown);
  control.classList.toggle(
    "speaking",
    args.hasRoom && Boolean(participant?.connected && participant.speaking),
  );
  if (args.hasRoom && !participant?.connected && !args.isCurrentMember) {
    control.classList.toggle("disabled-mic", true);
  }
  control.append(createMicIcon());
  return control;
}

function getRenderedParticipant(
  voiceState: VoiceRuntimeState,
  memberId: string,
  isCurrentMember: boolean,
): {
  connected: boolean;
  muted: boolean;
  speaking: boolean;
} | null {
  if (isCurrentMember) {
    return {
      connected: voiceState.status === "connected",
      muted: voiceState.muted,
      speaking: voiceState.speaking,
    };
  }
  return voiceState.participants[memberId] ?? null;
}

function formatMemberVoiceText(
  voiceState: VoiceRuntimeState,
  memberId: string,
  isCurrentMember: boolean,
): string {
  const participant = getRenderedParticipant(
    voiceState,
    memberId,
    isCurrentMember,
  );
  if (!participant?.connected) {
    return t("voiceMemberMuted");
  }
  if (participant.speaking) {
    return t("voiceMemberSpeaking");
  }
  return participant.muted ? t("voiceMemberMuted") : t("voiceMicUnmuted");
}

function getMemberAvatarText(name: string, isCurrentMember: boolean): string {
  if (isCurrentMember) {
    return getSelfAvatarText();
  }
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

function getSelfAvatarText(): string {
  return /^en\b/i.test(getUiLanguage()) ? "Me" : "我";
}

function createMicIcon(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const pathData of [
    "M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z",
    "M18 10v1a6 6 0 0 1-12 0v-1",
    "M12 17v4",
  ]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  return svg;
}
