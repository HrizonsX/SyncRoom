import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRoomActionControlState,
  renderPopup,
  resetPopupRenderDebugStateForTests,
} from "../src/popup/popup-render";
import type { PopupRefs } from "../src/popup/popup-view";
import { setLocaleForTests } from "../src/shared/i18n";
import { createInitialVoiceRuntimeState } from "../src/shared/voice-state";

class FakeClassList {
  private readonly classes = new Set<string>();

  toggle(name: string, force?: boolean): void {
    if (force === false) {
      this.classes.delete(name);
      return;
    }
    if (force === true || !this.classes.has(name)) {
      this.classes.add(name);
      return;
    }
    this.classes.delete(name);
  }

  contains(name: string): boolean {
    return this.classes.has(name);
  }
}

class FakeElement {
  private ownText = "";
  hidden = false;
  disabled = false;
  value = "";
  className = "";
  title = "";
  scrollTop = 0;
  children: FakeElement[] = [];
  classList = new FakeClassList();

  set textContent(value: string) {
    this.ownText = value;
    this.children = [];
  }

  get textContent(): string {
    return `${this.ownText}${this.children.map((child) => child.textContent).join("")}`;
  }

  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.ownText = "";
    this.children = nodes;
    this.scrollTop = 0;
  }

  setAttribute(name: string, value: string): void {
    (this as unknown as Record<string, string>)[name] = value;
  }

  getAttribute(name: string): string | undefined {
    return (this as unknown as Record<string, string>)[name];
  }
}

function createElement() {
  return new FakeElement();
}

const fakeDocument = {
  activeElement: null,
  createElement: () => new FakeElement(),
  createElementNS: () => new FakeElement(),
};

function createPopupRefs(): PopupRefs {
  const advancedDetails = createElement() as unknown as HTMLDetailsElement;
  advancedDetails.open = false;
  return {
    serverStatus: createElement() as unknown as HTMLElement,
    roomStatus: createElement() as unknown as HTMLElement,
    membersStatus: createElement() as unknown as HTMLElement,
    message: createElement() as unknown as HTMLElement,
    roomPanelJoined: createElement() as unknown as HTMLElement,
    roomPanelIdle: createElement() as unknown as HTMLElement,
    announcementPanel: createElement() as unknown as HTMLElement,
    announcementTrack: createElement() as unknown as HTMLElement,
    roomCodeInput: createElement() as unknown as HTMLInputElement,
    copyRoomButton: createElement() as unknown as HTMLButtonElement,
    shareCurrentVideoButton: createElement() as unknown as HTMLButtonElement,
    sharedVideoPanel: createElement() as unknown as HTMLElement,
    sharedVideoCard: createElement() as unknown as HTMLButtonElement,
    sharedVideoTitle: createElement() as unknown as HTMLElement,
    sharedVideoMeta: createElement() as unknown as HTMLElement,
    sharedVideoOwner: createElement() as unknown as HTMLElement,
    sharedVideoOwnerText: createElement() as unknown as HTMLElement,
    easterEgg: createElement() as unknown as HTMLElement,
    voiceStatus: createElement() as unknown as HTMLElement,
    voiceError: createElement() as unknown as HTMLElement,
    logs: createElement() as unknown as HTMLElement,
    memberList: createElement() as unknown as HTMLElement,
    advancedDetails,
    advancedState: createElement() as unknown as HTMLElement,
    copyLogsButton: createElement() as unknown as HTMLButtonElement,
    serverUrlInput: createElement() as unknown as HTMLInputElement,
    saveServerUrlButton: createElement() as unknown as HTMLButtonElement,
    confirmDialog: createElement() as unknown as HTMLElement,
    confirmTitle: createElement() as unknown as HTMLElement,
    confirmDescription: createElement() as unknown as HTMLElement,
    confirmConfirmButton: createElement() as unknown as HTMLButtonElement,
    confirmCancelButton: createElement() as unknown as HTMLButtonElement,
    debugMemberStatus: createElement() as unknown as HTMLElement,
    retryStatusValue: createElement() as unknown as HTMLElement,
    retryStatusCount: createElement() as unknown as HTMLElement,
    clockOffsetStatus: createElement() as unknown as HTMLElement,
    rttStatus: createElement() as unknown as HTMLElement,
    createRoomButton: createElement() as unknown as HTMLButtonElement,
    joinRoomButton: createElement() as unknown as HTMLButtonElement,
    leaveRoomButton: createElement() as unknown as HTMLButtonElement,
  };
}

test("applyRoomActionControlState disables room actions during room transitions", () => {
  resetPopupRenderDebugStateForTests();
  const refs = createPopupRefs();
  refs.roomCodeInput.value = "ROOM01:token-1";

  applyRoomActionControlState({
    refs,
    roomActionPending: true,
    lastKnownPendingCreateRoom: false,
    lastKnownPendingJoinRoomCode: null,
    lastKnownRoomCode: null,
  });

  assert.equal(refs.createRoomButton.disabled, true);
  assert.equal(refs.joinRoomButton.disabled, true);
  assert.equal(refs.leaveRoomButton.disabled, true);
  assert.equal(refs.roomCodeInput.disabled, true);
});

test("renderPopup renders compact announcements and hides the strip when empty", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("en-US");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    const baseState = {
      connected: true,
      serverUrl: "ws://localhost:8787",
      error: null,
      roomCode: "ROOM01",
      joinToken: "join-token-1",
      memberId: "member-1",
      displayName: "Alice",
      roomState: {
        roomCode: "ROOM01",
        sharedVideo: null,
        playback: null,
        members: [{ id: "member-1", name: "Alice" }],
      },
      pendingCreateRoom: false,
      pendingJoinRoomCode: null,
      retryInMs: null,
      retryAttempt: 0,
      retryAttemptMax: 5,
      clockOffsetMs: null,
      rttMs: null,
      voice: createInitialVoiceRuntimeState(),
      logs: [],
    };

    renderPopup({
      refs,
      state: {
        ...baseState,
        announcements: {
          version: 1,
          updatedAt: 1_710_000_000_000,
          items: [
            { id: "Maintenance", text: "Starts at 20:00." },
            { id: "Feature", text: "HTML5 video sync is available." },
          ],
        },
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "ROOM01",
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.announcementPanel.hidden, false);
    assert.equal(
      refs.announcementTrack.textContent.includes(
        "Maintenance-Starts at 20:00.",
      ),
      true,
    );
    assert.equal(
      refs.announcementTrack.textContent.includes(
        "Feature-HTML5 video sync is available.",
      ),
      true,
    );
    assert.equal(refs.announcementTrack.children.length, 2);
    assert.equal(
      refs.announcementTrack.children[0]?.className,
      "announcement-slide",
    );
    assert.equal(
      refs.announcementTrack.children[0]?.firstElementChild?.className,
      "announcement-marquee",
    );
    assert.equal(
      refs.announcementTrack.children[1]?.className,
      "announcement-slide",
    );

    renderPopup({
      refs,
      state: {
        ...baseState,
        announcements: { version: 2, updatedAt: 1_710_000_010_000, items: [] },
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "ROOM01",
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.announcementPanel.hidden, true);
    assert.equal(refs.announcementTrack.textContent, "");
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup updates popup metrics, owner hint, logs, and draft values", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("en-US");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();
  const roomCodeInput = refs.roomCodeInput as unknown as {
    value: string;
  };
  const serverUrlInput = refs.serverUrlInput as unknown as {
    value: string;
  };
  const draftValues: string[] = [];

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: "ROOM01",
        joinToken: "join-token-1",
        memberId: "member-1",
        displayName: "Alice",
        roomState: {
          roomCode: "ROOM01",
          sharedVideo: {
            videoId: "BV1xx411c7mD",
            url: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
            title: "Shared Video",
            sharedByMemberId: "member-2",
          },
          playback: null,
          members: [
            { id: "member-1", name: "Alice" },
            { id: "member-2", name: "Bob" },
          ],
        },
        pendingCreateRoom: false,
        pendingJoinRoomCode: null,
        retryInMs: 2_000,
        retryAttempt: 1,
        retryAttemptMax: 5,
        clockOffsetMs: 25,
        rttMs: 60,
        voice: createInitialVoiceRuntimeState(),
        logs: [
          {
            at: 1_710_000_000_000,
            scope: "background",
            message: "Connected",
          },
        ],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: (value) => {
        draftValues.push(value);
      },
      localStatusMessage: "Ready",
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "ROOM01",
      copyRoomSuccess: true,
      copyLogsSuccess: true,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.serverStatus.textContent, "Connected");
    assert.equal(refs.serverStatus.classList.contains("is-connected"), true);
    assert.equal(refs.roomStatus.textContent, "ROOM01");
    assert.equal(refs.membersStatus.textContent, "2 members");
    assert.equal(refs.message.textContent, "Ready");
    assert.equal(roomCodeInput.value, "ROOM01:join-token-1");
    assert.equal(serverUrlInput.value, "ws://localhost:8787");
    assert.deepEqual(draftValues, ["ROOM01:join-token-1"]);
    assert.equal(refs.copyRoomButton.disabled, false);
    assert.equal(
      refs.copyRoomButton.classList.contains("success-button"),
      true,
    );
    assert.equal(
      refs.copyLogsButton.classList.contains("success-button"),
      true,
    );
    assert.equal(refs.sharedVideoTitle.textContent, "Shared Video");
    assert.equal(refs.sharedVideoMeta.textContent, "Bilibili · BV1xx411c7mD");
    assert.equal(refs.sharedVideoOwnerText.textContent, "Shared by Bob");
    assert.equal(refs.sharedVideoOwner.hidden, false);
    assert.equal(refs.clockOffsetStatus.textContent, "25ms");
    assert.equal(refs.rttStatus.textContent, "60ms");
    assert.equal(refs.logs.textContent.includes("Connected"), true);
    assert.equal(refs.memberList.textContent.includes("Bob"), true);
    assert.equal(refs.memberList.textContent.includes("Me (Alice)"), true);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup preserves debug log scroll position across log refreshes", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("en-US");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();
  refs.logs.scrollTop = 52;

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: "ROOM01",
        joinToken: null,
        memberId: "member-1",
        displayName: "Alice",
        roomState: {
          roomCode: "ROOM01",
          sharedVideo: null,
          playback: null,
          members: [{ id: "member-1", name: "Alice" }],
        },
        pendingCreateRoom: false,
        pendingJoinRoomCode: null,
        retryInMs: null,
        retryAttempt: 0,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice: createInitialVoiceRuntimeState(),
        logs: [
          { at: 1_710_000_001_000, scope: "background", message: "second" },
          { at: 1_710_000_000_000, scope: "background", message: "first" },
        ],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "ROOM01",
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.logs.scrollTop, 52);
    assert.equal(refs.logs.textContent.includes("second"), true);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup marks long shared video titles for hover scrolling", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();
  const longTitle =
    "这是一个非常非常长的共享视频标题，用来验证鼠标悬浮时可以滚动展示完整内容";

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: "ROOM01",
        joinToken: "join-token-1",
        memberId: "member-1",
        displayName: "小鹏",
        roomState: {
          roomCode: "ROOM01",
          sharedVideo: {
            videoId: "BV1xx411c7mD",
            url: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
            title: longTitle,
            sharedByMemberId: "member-1",
          },
          playback: null,
          members: [{ id: "member-1", name: "小鹏" }],
        },
        pendingCreateRoom: false,
        pendingJoinRoomCode: null,
        retryInMs: null,
        retryAttempt: 0,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice: createInitialVoiceRuntimeState(),
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "ROOM01",
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.sharedVideoTitle.title, longTitle);
    assert.equal(refs.sharedVideoTitle.className, "video-title is-scrollable");
    const titleText = (refs.sharedVideoTitle as unknown as FakeElement)
      .children[0];
    assert.equal(titleText.className, "video-title-text");
    assert.equal(titleText.textContent, longTitle);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup shows the prototype empty shared-video hint before joining a room", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: null,
        joinToken: null,
        memberId: null,
        displayName: "小鹏",
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
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.sharedVideoTitle.textContent, "暂无共享视频");
    assert.equal(
      refs.sharedVideoOwnerText.textContent,
      "加入房间后显示共享视频标题、来源和分享人。",
    );
    assert.equal(refs.sharedVideoOwner.hidden, false);
    assert.equal(refs.shareCurrentVideoButton.disabled, true);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup keeps the empty shared-video content after joining a room", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: "U62V4F",
        joinToken: "join-token-1",
        memberId: "member-1",
        displayName: "小鹏",
        roomState: {
          roomCode: "U62V4F",
          sharedVideo: null,
          playback: null,
          members: [{ id: "member-1", name: "小鹏" }],
        },
        pendingCreateRoom: false,
        pendingJoinRoomCode: null,
        retryInMs: null,
        retryAttempt: 0,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice: createInitialVoiceRuntimeState(),
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "U62V4F",
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.sharedVideoTitle.textContent, "暂无共享视频");
    assert.equal(
      refs.sharedVideoOwnerText.textContent,
      "加入房间后显示共享视频标题、来源和分享人。",
    );
    assert.equal(refs.sharedVideoOwner.hidden, false);
    assert.equal(refs.shareCurrentVideoButton.disabled, false);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup toggles the local easter egg panel", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: null,
        joinToken: null,
        memberId: null,
        displayName: "小鹏",
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
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      easterEggVisible: true,
      easterEggEffectActive: true,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.easterEgg.hidden, false);
    assert.equal(
      refs.sharedVideoPanel.classList.contains("is-easter-egg-active"),
      true,
    );

    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: null,
        joinToken: null,
        memberId: null,
        displayName: "小鹏",
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
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      easterEggVisible: false,
      easterEggEffectActive: true,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.easterEgg.hidden, true);
    assert.equal(
      refs.sharedVideoPanel.classList.contains("is-easter-egg-active"),
      true,
    );

    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: null,
        joinToken: null,
        memberId: null,
        displayName: "小彭",
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
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      easterEggVisible: false,
      easterEggEffectActive: false,
      sendPopupLog: async () => {},
    });

    assert.equal(
      refs.sharedVideoPanel.classList.contains("is-easter-egg-active"),
      false,
    );
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup debug log distinguishes background pending state from local UI pending state", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("en-US");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();
  const popupLogs: string[] = [];

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: false,
        serverUrl: "ws://localhost:8787",
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
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "ROOM01:join-token-1",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: true,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: "ROOM01",
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async (message) => {
        popupLogs.push(message);
      },
    });

    assert.deepEqual(popupLogs, [
      "Render room=none connected=false backgroundPendingJoin=none uiPendingAction=true lastKnownPendingJoin=ROOM01 lastKnownRoom=none",
    ]);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup shows retry progress after the connection error", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();
  const roomCodeInput = refs.roomCodeInput as unknown as {
    value: string;
    disabled: boolean;
  };

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: false,
        serverUrl: "ws://localhost:8787",
        error: "无法连接到同步服务器。",
        roomCode: null,
        joinToken: null,
        memberId: null,
        displayName: null,
        roomState: null,
        pendingCreateRoom: false,
        pendingJoinRoomCode: "ROOM01",
        retryInMs: 4_000,
        retryAttempt: 2,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice: createInitialVoiceRuntimeState(),
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "ROOM01:join-token-1",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: "ROOM01",
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(
      refs.message.textContent,
      "无法连接到同步服务器。重试（2/5）...",
    );
    const retryDots = (refs.message as unknown as FakeElement).children[0];
    assert.equal(retryDots.className, "status-retry-dots");
    assert.equal(retryDots.getAttribute("aria-hidden"), "true");
    assert.equal(retryDots.children.length, 3);
    assert.deepEqual(
      retryDots.children.map((child) => child.textContent),
      [".", ".", "."],
    );
    assert.equal(refs.joinRoomButton.textContent, "加入");
    assert.equal(refs.createRoomButton.textContent, "创建房间");
    assert.equal(refs.joinRoomButton.disabled, true);
    assert.equal(roomCodeInput.disabled, true);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup shows retry progress for the final scheduled retry", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: false,
        serverUrl: "ws://localhost:8787",
        error: "无法连接到同步服务器。",
        roomCode: null,
        joinToken: null,
        memberId: null,
        displayName: null,
        roomState: null,
        pendingCreateRoom: false,
        pendingJoinRoomCode: "ROOM01",
        retryInMs: 1_000,
        retryAttempt: 5,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice: createInitialVoiceRuntimeState(),
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "ROOM01:join-token-1",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: "ROOM01",
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(
      refs.message.textContent,
      "无法连接到同步服务器。重试（5/5）...",
    );
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup keeps retry progress visible during an active retry attempt", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: false,
        serverUrl: "ws://localhost:8787",
        error: "无法连接到同步服务器。",
        roomCode: null,
        joinToken: null,
        memberId: null,
        displayName: null,
        roomState: null,
        pendingCreateRoom: false,
        pendingJoinRoomCode: "ROOM01",
        retryInMs: null,
        retryAttempt: 3,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice: createInitialVoiceRuntimeState(),
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "ROOM01:join-token-1",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: "ROOM01",
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(
      refs.message.textContent,
      "无法连接到同步服务器。重试（3/5）...",
    );
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup shows the final reconnect failure without retry progress", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();
  const roomCodeInput = refs.roomCodeInput as unknown as {
    value: string;
    disabled: boolean;
  };

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: false,
        serverUrl: "ws://localhost:8787",
        error: "重试 5 次后仍无法连接到同步服务器。",
        roomCode: null,
        joinToken: null,
        memberId: null,
        displayName: null,
        roomState: null,
        pendingCreateRoom: false,
        pendingJoinRoomCode: null,
        retryInMs: null,
        retryAttempt: 5,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice: createInitialVoiceRuntimeState(),
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "ROOM01:join-token-1",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(
      refs.message.textContent,
      "重试 5 次后仍无法连接到同步服务器。",
    );
    assert.equal((refs.message as unknown as FakeElement).children.length, 0);
    assert.equal(refs.joinRoomButton.textContent, "加入");
    assert.equal(refs.joinRoomButton.disabled, false);
    assert.equal(roomCodeInput.disabled, false);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup only logs once for repeated identical pending renders", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("en-US");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();
  const popupLogs: string[] = [];

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  const renderArgs = {
    refs,
    state: {
      connected: false,
      serverUrl: "ws://localhost:8787",
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
    },
    serverUrlDraft: { value: "", dirty: false },
    roomCodeDraft: "",
    setRoomCodeDraft: () => {},
    localStatusMessage: null,
    roomActionPending: true,
    lastKnownPendingCreateRoom: false,
    lastKnownPendingJoinRoomCode: null,
    lastKnownRoomCode: null,
    copyRoomSuccess: false,
    copyLogsSuccess: false,
    sendPopupLog: async (message: string) => {
      popupLogs.push(message);
    },
  } as const;

  try {
    renderPopup(renderArgs);
    renderPopup(renderArgs);

    assert.deepEqual(popupLogs, [
      "Render room=none connected=false backgroundPendingJoin=none uiPendingAction=true lastKnownPendingJoin=none lastKnownRoom=none",
    ]);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup falls back to sharedByDisplayName when the sharer is no longer in members", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("en-US");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: "ROOM01",
        joinToken: "join-token-1",
        memberId: "member-1",
        displayName: "Alice",
        roomState: {
          roomCode: "ROOM01",
          sharedVideo: {
            videoId: "BV1xx411c7mD",
            url: "https://www.bilibili.com/video/BV1xx411c7mD?p=2",
            title: "Shared Video",
            sharedByMemberId: "stale-member-99",
            sharedByDisplayName: "Bob",
          },
          playback: null,
          members: [{ id: "member-1", name: "Alice" }],
        },
        pendingCreateRoom: false,
        pendingJoinRoomCode: null,
        retryInMs: null,
        retryAttempt: 0,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice: createInitialVoiceRuntimeState(),
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "ROOM01",
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.sharedVideoOwnerText.textContent, "Shared by Bob");
    assert.equal(refs.sharedVideoOwner.hidden, false);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup renders voice status, mic toggle, and member voice indicators", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("en-US");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();
  const voice = createInitialVoiceRuntimeState();
  voice.status = "connected";
  voice.muted = false;
  voice.error = "Microphone permission was denied.";
  voice.participants = {
    "member-1": {
      memberId: "member-1",
      connected: true,
      muted: false,
      speaking: false,
    },
    "member-2": {
      memberId: "member-2",
      connected: true,
      muted: false,
      speaking: true,
    },
  };

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: "ROOM01",
        joinToken: "join-token-1",
        memberId: "member-1",
        displayName: "Alice",
        roomState: {
          roomCode: "ROOM01",
          sharedVideo: null,
          playback: null,
          members: [
            { id: "member-1", name: "Alice" },
            { id: "member-2", name: "Bob" },
          ],
        },
        pendingCreateRoom: false,
        pendingJoinRoomCode: null,
        retryInMs: null,
        retryAttempt: 0,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice,
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "ROOM01",
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.voiceStatus.textContent, "Voice connected");
    assert.equal(
      refs.voiceError.textContent,
      "Microphone permission was denied.",
    );
    assert.equal(refs.voiceError.hidden, false);

    const selfRow = (refs.memberList as unknown as FakeElement).children[0];
    assert.equal(selfRow.className, "member-row is-self");
    const selfMicButton = selfRow.children[1];
    assert.equal(selfMicButton.className, "member-state");
    assert.equal(selfMicButton.getAttribute("data-voice-mic-toggle"), "true");
    assert.equal(selfMicButton.getAttribute("aria-label"), "Mute");
    assert.equal(selfMicButton.disabled, false);

    const bobRow = (refs.memberList as unknown as FakeElement).children[1];
    assert.equal(bobRow.className, "member-row");
    const bobIndicator = bobRow.children[1];
    assert.equal(bobIndicator.classList.contains("speaking"), true);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup treats unknown remote voice state as muted", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();
  const voice = createInitialVoiceRuntimeState();
  voice.status = "connected";
  voice.muted = true;
  voice.participants = {
    "member-1": {
      memberId: "member-1",
      connected: true,
      muted: true,
      speaking: false,
    },
  };

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: "ROOM01",
        joinToken: "join-token-1",
        memberId: "member-1",
        displayName: "Alice",
        roomState: {
          roomCode: "ROOM01",
          sharedVideo: null,
          playback: null,
          members: [
            { id: "member-1", name: "Alice" },
            { id: "member-2", name: "Bob" },
          ],
        },
        pendingCreateRoom: false,
        pendingJoinRoomCode: null,
        retryInMs: null,
        retryAttempt: 0,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice,
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "ROOM01",
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    const bobRow = (refs.memberList as unknown as FakeElement).children[1];
    const bobInfo = bobRow.children[0];
    const bobText = bobInfo.children[1];
    const bobIndicator = bobRow.children[1];
    assert.equal(bobText.textContent.includes("已静音"), true);
    assert.equal(bobIndicator.classList.contains("muted"), true);
    assert.equal(bobIndicator.classList.contains("disabled-mic"), true);
    assert.equal(bobIndicator.classList.contains("speaking"), false);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup renders a disabled self row when no room is joined", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: null,
        joinToken: null,
        memberId: null,
        displayName: "小鹏",
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
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.membersStatus.textContent, "0 人");
    assert.equal(refs.voiceStatus.textContent, "未加入房间");
    assert.equal(refs.voiceStatus.classList.contains("is-muted"), true);

    const selfRow = (refs.memberList as unknown as FakeElement).children[0];
    assert.equal(selfRow.className, "member-row is-self");
    assert.equal(selfRow.textContent.includes("我（小鹏）"), true);
    assert.equal(selfRow.textContent.includes("尚未加入房间"), false);
    const micState = selfRow.children[1];
    assert.equal(micState.classList.contains("disabled-mic"), true);
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup preserves manual advanced expansion across same room presence renders", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  const state = {
    connected: true,
    serverUrl: "ws://localhost:8787",
    error: null,
    roomCode: null,
    joinToken: null,
    memberId: null,
    displayName: "小鹏",
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
  } as const;

  try {
    const baseArgs = {
      refs,
      state,
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: null,
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    };

    renderPopup(baseArgs);
    assert.equal(refs.advancedDetails.open, false);
    refs.advancedDetails.open = true;

    renderPopup({
      ...baseArgs,
      localStatusMessage: "服务器地址已保存。",
    });

    assert.equal(refs.advancedDetails.open, true);
    assert.equal(refs.advancedState.textContent, "");
    assert.equal(refs.advancedState.classList.contains("is-open"), true);
    assert.equal(refs.advancedState.getAttribute("aria-label"), "已展开");
    assert.equal(refs.advancedState.title, "已展开");
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup keeps advanced settings collapsed by default when joined", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("zh-CN");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: "U62V4F",
        joinToken: "token",
        memberId: "member-1",
        displayName: "小鹏",
        roomState: {
          roomCode: "U62V4F",
          sharedVideo: null,
          playback: null,
          members: [{ id: "member-1", name: "小鹏" }],
        },
        pendingCreateRoom: false,
        pendingJoinRoomCode: null,
        retryInMs: null,
        retryAttempt: 0,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice: createInitialVoiceRuntimeState(),
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "U62V4F",
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.advancedDetails.open, false);
    assert.equal(refs.advancedState.textContent, "");
    assert.equal(refs.advancedState.classList.contains("is-open"), false);
    assert.equal(refs.advancedState.getAttribute("aria-label"), "展开");
    assert.equal(refs.advancedState.title, "展开");
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});

test("renderPopup enables voice retry when voice connection failed", async () => {
  resetPopupRenderDebugStateForTests();
  setLocaleForTests("en-US");
  const originalDocument = globalThis.document;
  const refs = createPopupRefs();
  const voice = createInitialVoiceRuntimeState();
  voice.status = "failed";
  voice.muted = true;
  voice.error = "Voice connection failed.";

  Object.assign(globalThis, {
    document: fakeDocument,
  });

  try {
    renderPopup({
      refs,
      state: {
        connected: true,
        serverUrl: "ws://localhost:8787",
        error: null,
        roomCode: "ROOM01",
        joinToken: "join-token-1",
        memberId: "member-1",
        displayName: "Alice",
        roomState: {
          roomCode: "ROOM01",
          sharedVideo: null,
          playback: null,
          members: [{ id: "member-1", name: "Alice" }],
        },
        pendingCreateRoom: false,
        pendingJoinRoomCode: null,
        retryInMs: null,
        retryAttempt: 0,
        retryAttemptMax: 5,
        clockOffsetMs: null,
        rttMs: null,
        voice,
        logs: [],
      },
      serverUrlDraft: { value: "", dirty: false },
      roomCodeDraft: "",
      setRoomCodeDraft: () => {},
      localStatusMessage: null,
      roomActionPending: false,
      lastKnownPendingCreateRoom: false,
      lastKnownPendingJoinRoomCode: null,
      lastKnownRoomCode: "ROOM01",
      copyRoomSuccess: false,
      copyLogsSuccess: false,
      sendPopupLog: async () => {},
    });

    assert.equal(refs.voiceStatus.textContent, "Voice failed");
    const selfRow = (refs.memberList as unknown as FakeElement).children[0];
    const selfMicButton = selfRow.children[1];
    assert.equal(selfMicButton.disabled, false);
    assert.equal(selfMicButton.classList.contains("is-retry"), true);
    assert.equal(selfMicButton.classList.contains("is-live"), false);
    assert.equal(
      (selfMicButton as unknown as Record<string, string>)["aria-pressed"],
      "false",
    );
  } finally {
    setLocaleForTests(null);
    Object.assign(globalThis, { document: originalDocument });
  }
});
