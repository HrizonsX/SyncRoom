import "media-chrome";
import { createWebRoomAppController } from "./app-controller.js";
import {
  formatRoomJoinInvite,
  handleWebRoomImmediateAction,
  parseRoomJoinInvite,
} from "./actions.js";
import {
  createWebRoomPlaybackController,
  type WebRoomPlaybackControllerOptions,
} from "./playback-controller.js";
import {
  findPlaybackVideoElement,
  preservePlaybackVideoElement,
} from "./playback-video-preservation.js";
import { handlePlayerKeyboardShortcut } from "./player-keyboard-shortcuts.js";
import {
  captureDanmakuLayerAnimationSnapshots,
  findDanmakuLayerElement,
  parkDanmakuLayerElement,
  preserveDanmakuLayerElement,
  removeDanmakuLayerParkingElement,
  restoreDanmakuLayerAnimationSnapshots,
} from "./danmaku-layer-preservation.js";
import {
  readChatScrollState,
  restoreChatScrollState,
} from "./chat-scroll-state.js";
import {
  readChatInputDraftState,
  readPlayerDanmakuInputDraftState,
  restoreChatInputDraftState,
  restorePlayerDanmakuInputDraftState,
} from "./chat-input-draft-state.js";
import {
  readDisclosureOpenState,
  restoreDisclosureOpenState,
} from "./disclosure-state.js";
import { syncPlayerFullscreenTarget } from "./fullscreen-target.js";
import { createProviderApiClient } from "./provider-api-client.js";
import {
  getPlaybackErrorMessage,
  getPlaybackErrorStage,
} from "./playback-error.js";
import { renderWebRoomApp, type WebRoomState } from "./render.js";
import { createWebRoomLiveKitVoiceRuntime } from "./voice-runtime.js";

const app = document.querySelector<HTMLDivElement>("#app");

function getInputValue(root: HTMLElement, name: string): string {
  return (
    root.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value ?? ""
  );
}

function getInputChecked(root: HTMLElement, name: string): boolean {
  return (
    root.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.checked ??
    false
  );
}

function setInputValue(root: HTMLElement, name: string, value: string): void {
  const input = root.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (input) {
    input.value = value;
  }
}

function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => {
      copyTextWithTextarea(text);
    });
  }
  copyTextWithTextarea(text);
  return Promise.resolve();
}

function copyTextWithTextarea(text: string): void {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function getCurrentPlaybackTime(root: HTMLElement): number {
  const video = findPlaybackVideoElement(root);
  return video && Number.isFinite(video.currentTime)
    ? Math.max(0, video.currentTime)
    : 0;
}

if (app) {
  const appRoot = app;
  let lastPlaybackErrorKey: string | undefined;
  let playbackSeq = 0;
  let activeDanmakuRoomKey: string | undefined;
  const renderedDanmakuKeys = new Set<string>();
  const playbackControllerRef: {
    current?: ReturnType<typeof createWebRoomPlaybackController>;
  } = {};

  function getDanmakuRoomKey(state: WebRoomState): string | undefined {
    return state.view === "joined"
      ? `${state.roomCode}:${state.currentMemberId}`
      : undefined;
  }

  function render(state: WebRoomState): void {
    const nextDanmakuRoomKey = getDanmakuRoomKey(state);
    const shouldPreserveDanmakuLayer =
      nextDanmakuRoomKey !== undefined &&
      nextDanmakuRoomKey === activeDanmakuRoomKey;
    if (nextDanmakuRoomKey !== activeDanmakuRoomKey) {
      renderedDanmakuKeys.clear();
      activeDanmakuRoomKey = nextDanmakuRoomKey;
    }

    const existingPlaybackVideo = findPlaybackVideoElement(appRoot);
    const existingDanmakuLayer = shouldPreserveDanmakuLayer
      ? findDanmakuLayerElement(appRoot)
      : null;
    const chatInputDraftState = readChatInputDraftState(appRoot);
    const playerDanmakuInputDraftState =
      readPlayerDanmakuInputDraftState(appRoot);
    const chatScrollState = readChatScrollState(appRoot);
    const disclosureOpenState = readDisclosureOpenState(appRoot);
    const danmakuLayerParking = parkDanmakuLayerElement(existingDanmakuLayer);
    const danmakuAnimationSnapshots =
      captureDanmakuLayerAnimationSnapshots(existingDanmakuLayer);
    document.documentElement.dataset.webRoomTheme =
      state.themeMode === "dark" ? "dark" : "light";
    try {
      appRoot.innerHTML = renderWebRoomApp(state);
      restoreChatInputDraftState(appRoot, chatInputDraftState);
      restorePlayerDanmakuInputDraftState(
        appRoot,
        playerDanmakuInputDraftState,
      );
      restoreChatScrollState(appRoot, chatScrollState);
      restoreDisclosureOpenState(appRoot, disclosureOpenState);
      preservePlaybackVideoElement(appRoot, existingPlaybackVideo);
      preserveDanmakuLayerElement(
        appRoot,
        existingDanmakuLayer,
        renderedDanmakuKeys,
      );
      syncPlayerFullscreenTarget(appRoot);
      restoreDanmakuLayerAnimationSnapshots(
        findDanmakuLayerElement(appRoot),
        danmakuAnimationSnapshots,
      );
      void playbackControllerRef.current?.sync(appRoot, state);
    } finally {
      removeDanmakuLayerParkingElement(danmakuLayerParking);
    }
  }

  const controller = createWebRoomAppController({
    storage: window.localStorage,
    providerApiClientFactory: createProviderApiClient,
    voiceRuntimeFactory: ({ onEvent, log }) =>
      createWebRoomLiveKitVoiceRuntime({
        onEvent,
        log,
      }),
    onStateChange: render,
  });
  playbackControllerRef.current = createWebRoomPlaybackController({
    getSyncContext: () => controller.getPlaybackSyncContext(),
    nextSeq: () => {
      playbackSeq += 1;
      return playbackSeq;
    },
    dispatchPlaybackUpdate: (message) => controller.sendPlaybackUpdate(message),
    dispatchPlaybackBufferReport: (report) =>
      controller.sendPlaybackBufferReport(report),
    onPlaybackLoaded: () => controller.reportPlaybackLoaded(),
    onPlaybackError: ((error, source) => {
      const message = error instanceof Error ? error.message : String(error);
      const errorKey = `${source.url}:${message}`;
      if (lastPlaybackErrorKey === errorKey) {
        return;
      }
      lastPlaybackErrorKey = errorKey;
      const stage = getPlaybackErrorStage(error);
      controller.showDirectPlaybackFailure({
        stage,
        message: getPlaybackErrorMessage(stage),
      });
    }) satisfies WebRoomPlaybackControllerOptions["onPlaybackError"],
  });

  function setPlayerDanmakuPanelOpen(open: boolean): void {
    const player = appRoot.querySelector<HTMLElement>(
      ".player-media-controller",
    );
    if (!player) {
      return;
    }

    player.classList.toggle("is-danmaku-panel-open", open);
    player
      .querySelector<HTMLElement>('[data-action="toggle-player-danmaku"]')
      ?.setAttribute("aria-expanded", String(open));

    if (open) {
      player
        .querySelector<HTMLInputElement>(
          '[data-player-danmaku-controls="popover"] input[name="playerDanmaku"]',
        )
        ?.focus();
    }
  }

  function togglePlayerDanmakuPanel(): void {
    const player = appRoot.querySelector<HTMLElement>(
      ".player-media-controller",
    );
    setPlayerDanmakuPanelOpen(
      !(player?.classList.contains("is-danmaku-panel-open") ?? false),
    );
  }

  function setPlayerVolumePanelOpen(open: boolean): void {
    appRoot
      .querySelector<HTMLElement>(".player-volume-control")
      ?.classList.toggle("is-volume-open", open);
  }

  function updatePlayerVolumePanelFromClick(target: Element | null): void {
    const volumeControl = target?.closest<HTMLElement>(
      ".player-volume-control",
    );
    if (!volumeControl) {
      setPlayerVolumePanelOpen(false);
      return;
    }

    if (target?.closest("media-volume-range")) {
      setPlayerVolumePanelOpen(true);
      return;
    }

    volumeControl.classList.toggle("is-volume-open");
  }

  function sendPlayerDanmaku(sourceElement: HTMLElement): void {
    const controls = sourceElement.closest<HTMLElement>(
      "[data-player-danmaku-controls]",
    );
    const input = controls?.querySelector<HTMLInputElement>(
      'input[name="playerDanmaku"]',
    );
    const colorInput = appRoot.querySelector<HTMLInputElement>(
      'input[name="danmakuColor"]',
    );

    const sent = controller.sendDanmaku(input?.value ?? "", {
      videoTime: getCurrentPlaybackTime(appRoot),
      color: colorInput?.value,
    });

    if (!sent) {
      return;
    }

    if (input) {
      input.value = "";
    }
    if (controls?.dataset.playerDanmakuControls === "popover") {
      setPlayerDanmakuPanelOpen(false);
    }
  }

  function sendChatInput(input: HTMLInputElement | null): void {
    if (
      !input ||
      input.closest<HTMLElement>(".chat-input-row")?.dataset.chatCooldown ===
        "true"
    ) {
      return;
    }

    if (controller.sendChat(input.value)) {
      input.value = "";
    }
  }

  appRoot.addEventListener("click", (event) => {
    const targetElement = event.target instanceof Element ? event.target : null;
    updatePlayerVolumePanelFromClick(targetElement);

    const actionElement = targetElement?.closest<HTMLElement>("[data-action]");
    const action = actionElement?.dataset.action;
    if (!action) {
      return;
    }
    if (handleWebRoomImmediateAction({ action, controller })) {
      return;
    }

    if (action === "toggle-player-danmaku") {
      togglePlayerDanmakuPanel();
      return;
    }

    if (action === "send-player-danmaku") {
      sendPlayerDanmaku(actionElement);
      return;
    }

    if (action === "toggle-theme-mode") {
      controller.toggleThemeMode();
      return;
    }

    if (action === "create-room") {
      controller.createRoom({
        serverUrl: getInputValue(appRoot, "serverUrl"),
        displayName: getInputValue(appRoot, "displayName"),
      });
      return;
    }

    if (action === "join-room") {
      const invite = parseRoomJoinInvite(getInputValue(appRoot, "roomInvite"));
      controller.joinRoom({
        serverUrl: getInputValue(appRoot, "serverUrl"),
        displayName: getInputValue(appRoot, "displayName"),
        roomCode: invite.roomCode ?? getInputValue(appRoot, "roomInvite"),
        joinToken: invite.joinToken,
      });
      return;
    }

    if (action === "send-chat") {
      sendChatInput(
        appRoot.querySelector<HTMLInputElement>('input[name="chat"]'),
      );
      return;
    }

    if (action === "send-danmaku") {
      const chatInput =
        appRoot.querySelector<HTMLInputElement>('input[name="chat"]');
      const colorInput = appRoot.querySelector<HTMLInputElement>(
        'input[name="danmakuColor"]',
      );
      const sent = controller.sendDanmaku(chatInput?.value ?? "", {
        videoTime: getCurrentPlaybackTime(appRoot),
        color: colorInput?.value,
      });
      if (sent && chatInput) {
        chatInput.value = "";
      }
      return;
    }

    if (action === "set-member-permission") {
      const targetMemberId = actionElement.dataset.memberId ?? "";
      const permission = actionElement.dataset.memberPermission;
      if (
        permission === "voice" ||
        permission === "playbackControl" ||
        permission === "chat" ||
        permission === "danmaku"
      ) {
        controller.setRoomMemberPermission({
          targetMemberId,
          permission,
          allowed: actionElement.dataset.memberPermissionAllowed === "true",
        });
      }
      return;
    }

    if (action === "kick-member") {
      controller.kickRoomMember(actionElement.dataset.memberId ?? "");
      return;
    }

    if (action === "transfer-host") {
      controller.transferRoomHost(actionElement.dataset.memberId ?? "");
      return;
    }

    if (action === "authorization-management") {
      controller.openAuthorizationPanel();
      return;
    }

    if (action === "close-authorization-management") {
      controller.closeAuthorizationPanel();
      return;
    }

    if (action === "bilibili-login-qr") {
      controller.startBilibiliAuth({ method: "qr" });
      return;
    }

    if (action === "iqiyi-login-qr") {
      controller.startProviderAuth({ providerId: "iqiyi", method: "qr" });
      return;
    }

    if (action === "huya-login-qr") {
      controller.startProviderAuth({ providerId: "huya", method: "qr" });
      return;
    }

    if (action === "collapse-bilibili-auth") {
      controller.collapseBilibiliAuth();
      return;
    }

    if (action === "bilibili-logout") {
      controller.logoutBilibiliAuth();
      return;
    }

    if (action === "copy-room-invite") {
      const text = formatRoomJoinInvite({
        roomCode: actionElement.dataset.roomCode ?? "",
        joinToken: actionElement.dataset.joinToken ?? "",
      });
      void copyTextToClipboard(text).then(() => {
        actionElement.textContent = "已复制";
      });
      return;
    }

    if (action === "parse-bilibili-url") {
      controller.parseBilibiliUrl({
        url: getInputValue(appRoot, "bilibiliUrl"),
        proxy: getInputChecked(appRoot, "providerProxy"),
        shared: getInputChecked(appRoot, "providerShared"),
      });
      return;
    }

    if (action === "select-provider-item") {
      const itemId = actionElement.dataset.itemId;
      if (itemId) {
        controller.selectProviderItem(itemId);
      }
      return;
    }

    if (action === "select-provider-quality") {
      const candidateId = actionElement.dataset.candidateId;
      if (candidateId) {
        controller.selectProviderQuality(candidateId);
      }
      return;
    }

    if (action === "set-playback-sync-strategy") {
      const strategy = actionElement.dataset.syncStrategy;
      if (strategy === "smooth" || strategy === "wait") {
        controller.setPlaybackSyncStrategy(strategy);
      }
      return;
    }

    if (action === "share-provider-item") {
      controller.shareSelectedProviderItem();
      return;
    }

    if (action === "retry-provider-proxy") {
      void controller.retryProviderProxyFallback();
      return;
    }

    if (action === "leave-room") {
      controller.leaveRoom();
    }
  });

  appRoot.addEventListener("keydown", (event) => {
    if (handlePlayerKeyboardShortcut({ event, root: appRoot })) {
      return;
    }

    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    if (input.name === "chat") {
      if (event.key !== "Enter" || event.isComposing) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      sendChatInput(input);
      return;
    }

    if (input.dataset.playerDanmakuInput !== "true") {
      return;
    }

    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      sendPlayerDanmaku(input);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setPlayerDanmakuPanelOpen(false);
    }
  });

  appRoot.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (
      !input ||
      (input.name !== "providerProxy" && input.name !== "providerShared")
    ) {
      return;
    }
    controller.setProviderPlaybackPolicy({
      proxy: getInputChecked(appRoot, "providerProxy"),
      shared: getInputChecked(appRoot, "providerShared"),
      url: getInputValue(appRoot, "bilibiliUrl"),
    });
  });

  appRoot.addEventListener("paste", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (!input || input.name !== "roomInvite") {
      return;
    }
    const parsed = parseRoomJoinInvite(
      event.clipboardData?.getData("text") ?? "",
    );
    if (!parsed.roomCode || !parsed.joinToken) {
      return;
    }
    event.preventDefault();
    setInputValue(
      appRoot,
      "roomInvite",
      formatRoomJoinInvite({
        roomCode: parsed.roomCode,
        joinToken: parsed.joinToken,
      }),
    );
  });

  render(controller.getState());
}
