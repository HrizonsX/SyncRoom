import "media-chrome";
import { createWebRoomAppController } from "./room/app-controller.js";
import {
  createWebRoomPlaybackController,
  type WebRoomPlaybackControllerOptions,
} from "./playback/playback-controller.js";
import {
  findPlaybackVideoElement,
  preservePlaybackVideoElement,
} from "./playback/playback-video-preservation.js";
import {
  readPlayerChromeAutohideState,
  restorePlayerChromeAutohideState,
} from "./playback/player-chrome-preservation.js";
import {
  captureDanmakuLayerAnimationSnapshots,
  findDanmakuLayerElement,
  parkDanmakuLayerElement,
  preserveDanmakuLayerElement,
  removeDanmakuLayerParkingElement,
  restoreDanmakuLayerAnimationSnapshots,
} from "./danmaku/danmaku-layer-preservation.js";
import {
  readChatScrollState,
  restoreChatScrollState,
} from "./chat/chat-scroll-state.js";
import {
  readChatInputDraftState,
  readPlayerDanmakuInputDraftState,
  restoreChatInputDraftState,
  restorePlayerDanmakuInputDraftState,
} from "./chat/chat-input-draft-state.js";
import {
  readDisclosureOpenState,
  restoreDisclosureOpenState,
} from "./ui/disclosure-state.js";
import { syncPlayerFullscreenTarget } from "./playback/fullscreen-target.js";
import { createProviderApiClient } from "./providers/provider-api-client.js";
import {
  getPlaybackErrorMessage,
  getPlaybackErrorStage,
} from "./playback/playback-error.js";
import { bindWebRoomDomEvents } from "./ui/dom-event-bindings.js";
import { renderWebRoomApp, type WebRoomState } from "./ui/render.js";
import { createWebRoomLiveKitVoiceRuntime } from "./voice/voice-runtime.js";

const app = document.querySelector<HTMLDivElement>("#app");

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
    const shouldRestorePlayerChromeAutohide =
      state.view === "joined" &&
      state.playbackSource !== undefined &&
      state.playback?.playState === "playing";
    const playerChromeAutohideState = shouldRestorePlayerChromeAutohide
      ? readPlayerChromeAutohideState(appRoot)
      : null;
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
      // Web-room 使用整页字符串重绘；重绘前后要显式保住视频、弹幕、
      // 草稿和滚动位置，否则播放中刷新状态会打断媒体或让聊天跳回顶部。
      appRoot.innerHTML = renderWebRoomApp(state);
      restoreChatInputDraftState(appRoot, chatInputDraftState);
      restorePlayerDanmakuInputDraftState(
        appRoot,
        playerDanmakuInputDraftState,
      );
      restoreChatScrollState(appRoot, chatScrollState);
      restoreDisclosureOpenState(appRoot, disclosureOpenState);
      preservePlaybackVideoElement(appRoot, existingPlaybackVideo);
      restorePlayerChromeAutohideState(appRoot, playerChromeAutohideState);
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
      // 同一个源的同一个加载错误只提示一次，避免底层播放器连续失败时刷屏。
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

  bindWebRoomDomEvents({ root: appRoot, controller });

  render(controller.getState());
}
