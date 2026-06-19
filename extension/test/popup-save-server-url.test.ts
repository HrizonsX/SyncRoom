import assert from "node:assert/strict";
import test from "node:test";

import { bindPopupActions } from "../src/popup/popup-actions";
import { createPopupUiStateStore } from "../src/popup/popup-store";
import {
  createServerUrlDraftState,
  updateServerUrlDraft,
} from "../src/popup/server-url-draft";
import type { PopupRefs } from "../src/popup/popup-view";
import type { BackgroundPopupState } from "../src/shared/messages";
import { setLocaleForTests } from "../src/shared/i18n";
import { createInitialVoiceRuntimeState } from "../src/shared/voice-state";

const REF_KEYS = [
  "serverStatus",
  "roomStatus",
  "membersStatus",
  "message",
  "roomPanelJoined",
  "roomPanelIdle",
  "roomCodeInput",
  "copyRoomButton",
  "shareCurrentVideoButton",
  "sharedVideoPanel",
  "sharedVideoCard",
  "sharedVideoTitle",
  "sharedVideoMeta",
  "sharedVideoOwner",
  "sharedVideoOwnerText",
  "easterEgg",
  "voiceStatus",
  "voiceError",
  "logs",
  "memberList",
  "advancedDetails",
  "advancedState",
  "copyLogsButton",
  "serverUrlInput",
  "saveServerUrlButton",
  "confirmDialog",
  "confirmTitle",
  "confirmDescription",
  "confirmConfirmButton",
  "confirmCancelButton",
  "debugMemberStatus",
  "retryStatusValue",
  "retryStatusCount",
  "clockOffsetStatus",
  "rttStatus",
  "createRoomButton",
  "joinRoomButton",
  "leaveRoomButton",
] as const;

function createFakeRef(): EventTarget & Record<string, unknown> {
  const target = new EventTarget();
  const element = target as EventTarget & Record<string, unknown>;
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  element.value = "";
  element.disabled = false;
  element.textContent = "";
  element.hidden = false;
  element.innerHTML = "";
  element.open = false;
  element.title = "";
  element.classList = {
    toggle: (name: string, force?: boolean) => {
      if (force === false) {
        classes.delete(name);
        return false;
      }
      if (force === true || !classes.has(name)) {
        classes.add(name);
        return true;
      }
      classes.delete(name);
      return false;
    },
    contains: (name: string) => classes.has(name),
    add: (name: string) => {
      classes.add(name);
    },
    remove: (name: string) => {
      classes.delete(name);
    },
  };
  element.setAttribute = (name: string, value: string) => {
    attributes.set(name, value);
  };
  element.getAttribute = (name: string) => attributes.get(name);
  return element;
}

function createRefs(): PopupRefs {
  const refs = Object.create(null) as Record<string, unknown>;
  for (const key of REF_KEYS) {
    refs[key] = createFakeRef();
  }
  return refs as unknown as PopupRefs;
}

function createVoiceMicClickEvent(disabled = false): Event {
  const button = {
    disabled,
    closest: (selector: string) =>
      selector === "[data-voice-mic-toggle]" ? button : null,
  };
  const event = new Event("click");
  Object.defineProperty(event, "target", {
    value: button,
  });
  return event;
}

function createState(
  overrides: Partial<BackgroundPopupState> = {},
): BackgroundPopupState {
  return {
    connected: true,
    serverUrl: "ws://current.example/",
    error: null,
    roomCode: null,
    joinToken: null,
    memberId: null,
    displayName: null,
    roomState: null,
    pendingCreateRoom: false,
    pendingJoinRoomCode: null,
    retryInMs: null,
    retryAttempt: 0,
    retryAttemptMax: 5,
    clockOffsetMs: null,
    rttMs: null,
    voice: createInitialVoiceRuntimeState(),
    logs: [],
    ...overrides,
  };
}

function wrapStateMessage(state: BackgroundPopupState): {
  type: "background:state";
  payload: BackgroundPopupState;
} {
  return { type: "background:state", payload: state };
}

const validActiveVideoResponse = {
  ok: true,
  payload: {
    video: {
      videoId: "BVnext",
      url: "https://www.bilibili.com/video/BVnext",
      title: "Next Video",
    },
    playback: null,
  },
  tabId: 9,
};

function installChromeRuntimeStub(
  handler: (message: unknown) => BackgroundPopupState,
): void {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      async sendMessage(message: unknown): Promise<unknown> {
        return wrapStateMessage(handler(message));
      },
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

type BindArgs = Parameters<typeof bindPopupActions>[0];

function buildBindings(overrides: Partial<BindArgs> = {}): BindArgs {
  const refs = overrides.refs ?? createRefs();
  const uiStateStore = overrides.uiStateStore ?? createPopupUiStateStore();
  const serverUrlDraft =
    overrides.serverUrlDraft ?? createServerUrlDraftState();
  return {
    refs,
    leaveGuardMs: 0,
    uiStateStore,
    serverUrlDraft,
    queryState: async () => createState(),
    applyActionState: () => {},
    render: () => {},
    sendPopupLog: async () => {},
    applyRoomActionControlState: () => {},
    getPopupState: () => null,
    ...overrides,
  };
}

test("saveServerUrl surfaces a notice when the backend silently normalizes the URL", async () => {
  setLocaleForTests("zh-CN");
  try {
    const refs = createRefs();
    const uiStateStore = createPopupUiStateStore();
    const serverUrlDraft = createServerUrlDraftState();
    updateServerUrlDraft(serverUrlDraft, "   ", "ws://current.example/");

    installChromeRuntimeStub((message) => {
      const typed = message as { type?: string };
      if (typed.type === "popup:set-server-url") {
        return createState({ serverUrl: "ws://default.example/" });
      }
      return createState();
    });

    bindPopupActions(buildBindings({ refs, uiStateStore, serverUrlDraft }));

    (refs.saveServerUrlButton as unknown as EventTarget).dispatchEvent(
      new Event("click"),
    );
    await flushMicrotasks();

    const message = uiStateStore.getState().localStatusMessage ?? "";
    assert.match(message, /ws:\/\/default\.example\//);
    assert.match(message, /调整/);
  } finally {
    setLocaleForTests(null);
  }
});

test("saveServerUrl surfaces a notice when only surrounding whitespace was trimmed", async () => {
  setLocaleForTests("zh-CN");
  try {
    const refs = createRefs();
    const uiStateStore = createPopupUiStateStore();
    const serverUrlDraft = createServerUrlDraftState();
    updateServerUrlDraft(
      serverUrlDraft,
      "  ws://trimmed.example/  ",
      "ws://current.example/",
    );

    const requests: unknown[] = [];
    installChromeRuntimeStub((message) => {
      const typed = message as { type?: string; serverUrl?: string };
      if (typed.type === "popup:set-server-url") {
        requests.push(typed.serverUrl);
        return createState({ serverUrl: "ws://trimmed.example/" });
      }
      return createState();
    });

    bindPopupActions(buildBindings({ refs, uiStateStore, serverUrlDraft }));

    (refs.saveServerUrlButton as unknown as EventTarget).dispatchEvent(
      new Event("click"),
    );
    await flushMicrotasks();

    assert.deepEqual(requests, ["ws://trimmed.example/"]);
    const message = uiStateStore.getState().localStatusMessage ?? "";
    assert.match(message, /ws:\/\/trimmed\.example\//);
    assert.match(message, /调整/);
  } finally {
    setLocaleForTests(null);
  }
});

test("saveServerUrl leaves localStatusMessage untouched when the backend reports an error", async () => {
  setLocaleForTests("zh-CN");
  try {
    const refs = createRefs();
    const uiStateStore = createPopupUiStateStore();
    const serverUrlDraft = createServerUrlDraftState();
    updateServerUrlDraft(
      serverUrlDraft,
      "http://oops",
      "ws://current.example/",
    );

    installChromeRuntimeStub((message) => {
      const typed = message as { type?: string };
      if (typed.type === "popup:set-server-url") {
        return createState({
          serverUrl: "ws://current.example/",
          error: "服务端地址必须以 ws:// 或 wss:// 开头。",
        });
      }
      return createState();
    });

    bindPopupActions(buildBindings({ refs, uiStateStore, serverUrlDraft }));

    (refs.saveServerUrlButton as unknown as EventTarget).dispatchEvent(
      new Event("click"),
    );
    await flushMicrotasks();

    assert.equal(uiStateStore.getState().localStatusMessage, null);
  } finally {
    setLocaleForTests(null);
  }
});

test("saveServerUrl clears a previous localStatusMessage on a successful save", async () => {
  setLocaleForTests("zh-CN");
  try {
    const refs = createRefs();
    const uiStateStore = createPopupUiStateStore();
    const serverUrlDraft = createServerUrlDraftState();
    updateServerUrlDraft(
      serverUrlDraft,
      "ws://next.example/",
      "ws://current.example/",
    );
    uiStateStore.patch({ localStatusMessage: "leftover" });

    installChromeRuntimeStub((message) => {
      const typed = message as { type?: string };
      if (typed.type === "popup:set-server-url") {
        return createState({ serverUrl: "ws://next.example/" });
      }
      return createState();
    });

    bindPopupActions(buildBindings({ refs, uiStateStore, serverUrlDraft }));

    (refs.saveServerUrlButton as unknown as EventTarget).dispatchEvent(
      new Event("click"),
    );
    await flushMicrotasks();

    assert.equal(uiStateStore.getState().localStatusMessage, null);
  } finally {
    setLocaleForTests(null);
  }
});

test("advanced details state icon updates immediately on native toggle", () => {
  setLocaleForTests("zh-CN");
  try {
    const refs = createRefs();
    const details = refs.advancedDetails as unknown as EventTarget & {
      open: boolean;
    };

    bindPopupActions(buildBindings({ refs }));

    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    assert.equal(refs.advancedState.textContent, "");
    assert.equal(refs.advancedState.classList.contains("is-open"), true);
    assert.equal(refs.advancedState.getAttribute("aria-label"), "已展开");
    assert.equal(refs.advancedState.title, "已展开");

    details.open = false;
    details.dispatchEvent(new Event("toggle"));
    assert.equal(refs.advancedState.textContent, "");
    assert.equal(refs.advancedState.classList.contains("is-open"), false);
    assert.equal(refs.advancedState.getAttribute("aria-label"), "展开");
    assert.equal(refs.advancedState.title, "展开");
  } finally {
    setLocaleForTests(null);
  }
});

test("join room easter egg clears fupengzi without sending a join request", async () => {
  setLocaleForTests("zh-CN");
  const previousChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
  try {
    const refs = createRefs();
    const uiStateStore = createPopupUiStateStore();
    const requests: unknown[] = [];
    const storageWrites: unknown[] = [];
    refs.roomCodeInput.value = "fupengzi";

    installChromeRuntimeStub((message) => {
      requests.push(message);
      return createState();
    });
    (
      globalThis as unknown as {
        chrome: {
          runtime: unknown;
          storage: {
            session: {
              set(value: unknown): Promise<void>;
            };
          };
        };
      }
    ).chrome.storage = {
      session: {
        async set(value: unknown): Promise<void> {
          storageWrites.push(value);
        },
      },
    };

    bindPopupActions(buildBindings({ refs, uiStateStore }));

    (refs.joinRoomButton as unknown as EventTarget).dispatchEvent(
      new Event("click"),
    );
    await flushMicrotasks();

    assert.deepEqual(requests, []);
    assert.equal(refs.roomCodeInput.value, "");
    assert.equal(uiStateStore.getState().roomCodeDraft, "");
    assert.equal(uiStateStore.getState().localStatusMessage, null);
    assert.equal(uiStateStore.getState().easterEggVisible, true);
    assert.equal(uiStateStore.getState().easterEggEffectActive, true);
    assert.deepEqual(storageWrites, [
      {
        "syncroom-popup-ui": {
          easterEggEffectActive: true,
        },
      },
    ]);

    refs.roomCodeInput.value = "ROOM01:join-token";
    (refs.roomCodeInput as unknown as EventTarget).dispatchEvent(
      new Event("input"),
    );

    assert.equal(uiStateStore.getState().easterEggVisible, false);
    assert.equal(uiStateStore.getState().easterEggEffectActive, true);
  } finally {
    (globalThis as unknown as { chrome?: unknown }).chrome = previousChrome;
    setLocaleForTests(null);
  }
});

test("share current video uses the inline confirmation before creating a room", async () => {
  setLocaleForTests("en-US");
  const previousWindow = (globalThis as unknown as { window?: unknown }).window;
  try {
    const refs = createRefs();
    const requests: unknown[] = [];
    const currentState = createState();
    let nativeConfirmCalled = false;

    (globalThis as unknown as { window: unknown }).window = {
      confirm() {
        nativeConfirmCalled = true;
        return true;
      },
    };
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        async sendMessage(message: unknown): Promise<unknown> {
          requests.push(message);
          const type = (message as { type?: string }).type;
          if (type === "popup:get-active-video") {
            return validActiveVideoResponse;
          }
          if (type === "popup:share-current-video") {
            return wrapStateMessage(currentState);
          }
          return wrapStateMessage(currentState);
        },
      },
    };

    bindPopupActions(
      buildBindings({
        refs,
        queryState: async () => currentState,
        getPopupState: () => currentState,
      }),
    );

    (refs.shareCurrentVideoButton as unknown as EventTarget).dispatchEvent(
      new Event("click"),
    );
    await flushMicrotasks();

    assert.equal(nativeConfirmCalled, false);
    assert.equal(
      (refs.confirmDialog as unknown as { hidden: boolean }).hidden,
      false,
    );
    assert.equal(
      (refs.confirmTitle as unknown as { textContent: string }).textContent,
      "Create room and sync?",
    );
    assert.deepEqual(requests, [{ type: "popup:get-active-video" }]);

    (refs.confirmConfirmButton as unknown as EventTarget).dispatchEvent(
      new Event("click"),
    );
    await flushMicrotasks();

    assert.equal(
      (refs.confirmDialog as unknown as { hidden: boolean }).hidden,
      true,
    );
    assert.deepEqual(
      requests.map((request) => (request as { type?: string }).type),
      ["popup:get-active-video", "popup:share-current-video"],
    );
  } finally {
    setLocaleForTests(null);
    (globalThis as unknown as { window?: unknown }).window = previousWindow;
  }
});

test("share current video can cancel the inline replacement confirmation", async () => {
  setLocaleForTests("en-US");
  try {
    const refs = createRefs();
    const requests: unknown[] = [];
    const currentState = createState({
      roomCode: "ROOM01",
      roomState: {
        roomCode: "ROOM01",
        sharedVideo: {
          videoId: "BVold",
          url: "https://www.bilibili.com/video/BVold",
          title: "Old Video",
          sharedByMemberId: "member-1",
        },
        playback: null,
        members: [{ id: "member-1", name: "Alice" }],
      },
    });

    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        async sendMessage(message: unknown): Promise<unknown> {
          requests.push(message);
          const type = (message as { type?: string }).type;
          if (type === "popup:get-active-video") {
            return validActiveVideoResponse;
          }
          if (type === "popup:share-current-video") {
            return wrapStateMessage(currentState);
          }
          return wrapStateMessage(currentState);
        },
      },
    };

    bindPopupActions(
      buildBindings({
        refs,
        queryState: async () => currentState,
        getPopupState: () => currentState,
      }),
    );

    (refs.shareCurrentVideoButton as unknown as EventTarget).dispatchEvent(
      new Event("click"),
    );
    await flushMicrotasks();

    assert.equal(
      (refs.confirmTitle as unknown as { textContent: string }).textContent,
      "Replace shared video?",
    );

    (refs.confirmCancelButton as unknown as EventTarget).dispatchEvent(
      new Event("click"),
    );
    await flushMicrotasks();

    assert.equal(
      (refs.confirmDialog as unknown as { hidden: boolean }).hidden,
      true,
    );
    assert.deepEqual(
      requests.map((request) => (request as { type?: string }).type),
      ["popup:get-active-video"],
    );
  } finally {
    setLocaleForTests(null);
  }
});

test("voice mic button sends a toggle request from current muted state", async () => {
  setLocaleForTests("en-US");
  const callOrder: string[] = [];
  try {
    const refs = createRefs();
    const requests: unknown[] = [];
    const voice = createInitialVoiceRuntimeState();
    voice.status = "connected";
    voice.muted = true;
    const currentState = createState({
      roomCode: "ROOM01",
      voice,
    });

    installChromeRuntimeStub((message) => {
      callOrder.push((message as { type?: string }).type ?? "unknown");
      requests.push(message);
      return currentState;
    });

    bindPopupActions(
      buildBindings({
        refs,
        queryState: async () => currentState,
        getPopupState: () => currentState,
      }),
    );

    (refs.memberList as unknown as EventTarget).dispatchEvent(
      createVoiceMicClickEvent(),
    );
    await flushMicrotasks();

    assert.deepEqual(requests, [
      {
        type: "popup:voice-toggle-mic",
        enabled: true,
      },
    ]);
    assert.deepEqual(callOrder, ["popup:voice-toggle-mic"]);
  } finally {
    setLocaleForTests(null);
  }
});

test("voice mic button sends a mute request from current unmuted state", async () => {
  setLocaleForTests("en-US");
  try {
    const refs = createRefs();
    const requests: unknown[] = [];
    const voice = createInitialVoiceRuntimeState();
    voice.status = "connected";
    voice.muted = false;
    const currentState = createState({
      roomCode: "ROOM01",
      voice,
    });

    installChromeRuntimeStub((message) => {
      requests.push(message);
      return currentState;
    });

    bindPopupActions(
      buildBindings({
        refs,
        queryState: async () => currentState,
        getPopupState: () => currentState,
      }),
    );

    (refs.memberList as unknown as EventTarget).dispatchEvent(
      createVoiceMicClickEvent(),
    );
    await flushMicrotasks();

    assert.deepEqual(requests, [
      {
        type: "popup:voice-toggle-mic",
        enabled: false,
      },
    ]);
  } finally {
    setLocaleForTests(null);
  }
});

test("voice mic button sends retry request when voice failed", async () => {
  setLocaleForTests("en-US");
  try {
    const refs = createRefs();
    const requests: unknown[] = [];
    const voice = createInitialVoiceRuntimeState();
    voice.status = "failed";
    voice.muted = true;
    const currentState = createState({
      roomCode: "ROOM01",
      voice,
    });

    installChromeRuntimeStub((message) => {
      requests.push(message);
      return currentState;
    });

    bindPopupActions(
      buildBindings({
        refs,
        queryState: async () => currentState,
        getPopupState: () => currentState,
      }),
    );

    (refs.memberList as unknown as EventTarget).dispatchEvent(
      createVoiceMicClickEvent(),
    );
    await flushMicrotasks();

    assert.deepEqual(requests, [{ type: "popup:voice-retry" }]);
  } finally {
    setLocaleForTests(null);
  }
});
