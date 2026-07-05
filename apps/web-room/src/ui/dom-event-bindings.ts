import { findPlaybackVideoElement } from "../playback/playback-video-preservation.js";
import { handlePlayerKeyboardShortcut } from "../playback/player-keyboard-shortcuts.js";
import type { WebRoomAppController } from "../room/app-controller.js";
import {
  formatRoomJoinInvite,
  handleWebRoomImmediateAction,
  parseRoomJoinInvite,
} from "../room/actions.js";

export type WebRoomDomEventBindingOptions = {
  root: HTMLElement;
  controller: WebRoomAppController;
};

export const COPY_ROOM_INVITE_SUCCESS_LABEL = "已复制";

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

function setPlayerDanmakuPanelOpen(root: HTMLElement, open: boolean): void {
  const player = root.querySelector<HTMLElement>(".player-media-controller");
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

function togglePlayerDanmakuPanel(root: HTMLElement): void {
  const player = root.querySelector<HTMLElement>(".player-media-controller");
  setPlayerDanmakuPanelOpen(
    root,
    !(player?.classList.contains("is-danmaku-panel-open") ?? false),
  );
}

function setPlayerVolumePanelOpen(root: HTMLElement, open: boolean): void {
  root
    .querySelector<HTMLElement>(".player-volume-control")
    ?.classList.toggle("is-volume-open", open);
}

function updatePlayerVolumePanelFromClick(
  root: HTMLElement,
  target: Element | null,
): void {
  const volumeControl = target?.closest<HTMLElement>(".player-volume-control");
  if (!volumeControl) {
    setPlayerVolumePanelOpen(root, false);
    return;
  }

  if (target?.closest("media-volume-range")) {
    setPlayerVolumePanelOpen(root, true);
    return;
  }

  volumeControl.classList.toggle("is-volume-open");
}

function sendPlayerDanmaku(
  root: HTMLElement,
  controller: WebRoomAppController,
  sourceElement: HTMLElement,
): void {
  const controls = sourceElement.closest<HTMLElement>(
    "[data-player-danmaku-controls]",
  );
  const input = controls?.querySelector<HTMLInputElement>(
    'input[name="playerDanmaku"]',
  );
  const colorInput = root.querySelector<HTMLInputElement>(
    'input[name="danmakuColor"]',
  );

  const sent = controller.sendDanmaku(input?.value ?? "", {
    videoTime: getCurrentPlaybackTime(root),
    color: colorInput?.value,
  });

  if (!sent) {
    return;
  }

  if (input) {
    input.value = "";
  }
  if (controls?.dataset.playerDanmakuControls === "popover") {
    setPlayerDanmakuPanelOpen(root, false);
  }
}

function sendChatInput(
  controller: WebRoomAppController,
  input: HTMLInputElement | null,
): void {
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

// 页面事件代理集中在这里，避免入口文件同时承担启动装配和交互分发职责。
/**
 * 绑定网页房间的 DOM 事件代理，把按钮、输入框和快捷操作统一分发到应用控制器。
 */
export function bindWebRoomDomEvents({
  root,
  controller,
}: WebRoomDomEventBindingOptions): void {
  root.addEventListener("click", (event) => {
    const targetElement = event.target instanceof Element ? event.target : null;
    updatePlayerVolumePanelFromClick(root, targetElement);

    const actionElement = targetElement?.closest<HTMLElement>("[data-action]");
    const action = actionElement?.dataset.action;
    if (!action) {
      return;
    }
    if (handleWebRoomImmediateAction({ action, controller })) {
      return;
    }

    if (action === "toggle-player-danmaku") {
      togglePlayerDanmakuPanel(root);
      return;
    }

    if (action === "send-player-danmaku") {
      sendPlayerDanmaku(root, controller, actionElement);
      return;
    }

    if (action === "toggle-theme-mode") {
      controller.toggleThemeMode();
      return;
    }

    if (action === "create-room") {
      controller.createRoom({
        serverUrl: getInputValue(root, "serverUrl"),
        displayName: getInputValue(root, "displayName"),
      });
      return;
    }

    if (action === "join-room") {
      const invite = parseRoomJoinInvite(getInputValue(root, "roomInvite"));
      controller.joinRoom({
        serverUrl: getInputValue(root, "serverUrl"),
        displayName: getInputValue(root, "displayName"),
        roomCode: invite.roomCode ?? getInputValue(root, "roomInvite"),
        joinToken: invite.joinToken,
      });
      return;
    }

    if (action === "send-chat") {
      sendChatInput(
        controller,
        root.querySelector<HTMLInputElement>('input[name="chat"]'),
      );
      return;
    }

    if (action === "send-danmaku") {
      const chatInput =
        root.querySelector<HTMLInputElement>('input[name="chat"]');
      const colorInput = root.querySelector<HTMLInputElement>(
        'input[name="danmakuColor"]',
      );
      const sent = controller.sendDanmaku(chatInput?.value ?? "", {
        videoTime: getCurrentPlaybackTime(root),
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
        actionElement.textContent = COPY_ROOM_INVITE_SUCCESS_LABEL;
      });
      return;
    }

    if (action === "parse-bilibili-url") {
      controller.parseBilibiliUrl({
        url: getInputValue(root, "bilibiliUrl"),
        proxy: getInputChecked(root, "providerProxy"),
        shared: getInputChecked(root, "providerShared"),
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

  root.addEventListener("keydown", (event) => {
    if (handlePlayerKeyboardShortcut({ event, root })) {
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
      sendChatInput(controller, input);
      return;
    }

    if (input.dataset.playerDanmakuInput !== "true") {
      return;
    }

    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      sendPlayerDanmaku(root, controller, input);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setPlayerDanmakuPanelOpen(root, false);
    }
  });

  root.addEventListener("change", (event) => {
    const input = event.target as HTMLInputElement | null;
    if (
      !input ||
      (input.name !== "providerProxy" && input.name !== "providerShared")
    ) {
      return;
    }
    controller.setProviderPlaybackPolicy({
      proxy: getInputChecked(root, "providerProxy"),
      shared: getInputChecked(root, "providerShared"),
      url: getInputValue(root, "bilibiliUrl"),
    });
  });

  root.addEventListener("paste", (event) => {
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
      root,
      "roomInvite",
      formatRoomJoinInvite({
        roomCode: parsed.roomCode,
        joinToken: parsed.joinToken,
      }),
    );
  });
}
