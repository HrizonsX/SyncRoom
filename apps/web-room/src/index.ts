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
import {
  findDanmakuLayerElement,
  preserveDanmakuLayerElement,
} from "./danmaku-layer-preservation.js";
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
  const playbackControllerRef: {
    current?: ReturnType<typeof createWebRoomPlaybackController>;
  } = {};

  function render(state: WebRoomState): void {
    const existingPlaybackVideo = findPlaybackVideoElement(appRoot);
    const existingDanmakuLayer = findDanmakuLayerElement(appRoot);
    appRoot.innerHTML = renderWebRoomApp(state);
    preservePlaybackVideoElement(appRoot, existingPlaybackVideo);
    preserveDanmakuLayerElement(appRoot, existingDanmakuLayer);
    void playbackControllerRef.current?.sync(appRoot, state);
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

    controller.sendDanmaku(input?.value ?? "", {
      videoTime: getCurrentPlaybackTime(appRoot),
      color: colorInput?.value,
    });

    if (input) {
      input.value = "";
    }
    if (controls?.dataset.playerDanmakuControls === "popover") {
      setPlayerDanmakuPanelOpen(false);
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
      const chatInput =
        appRoot.querySelector<HTMLInputElement>('input[name="chat"]');
      controller.sendChat(chatInput?.value ?? "");
      if (chatInput) {
        chatInput.value = "";
      }
      return;
    }

    if (action === "send-danmaku") {
      const chatInput =
        appRoot.querySelector<HTMLInputElement>('input[name="chat"]');
      const colorInput = appRoot.querySelector<HTMLInputElement>(
        'input[name="danmakuColor"]',
      );
      controller.sendDanmaku(chatInput?.value ?? "", {
        videoTime: getCurrentPlaybackTime(appRoot),
        color: colorInput?.value,
      });
      if (chatInput) {
        chatInput.value = "";
      }
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

    if (action === "share-provider-item") {
      controller.shareSelectedProviderItem();
      return;
    }

    if (action === "retry-provider-proxy") {
      controller.retryProviderProxyFallback();
      return;
    }

    if (action === "leave-room") {
      controller.leaveRoom();
    }
  });

  appRoot.addEventListener("keydown", (event) => {
    const input = event.target;
    if (
      !(input instanceof HTMLInputElement) ||
      input.dataset.playerDanmakuInput !== "true"
    ) {
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
