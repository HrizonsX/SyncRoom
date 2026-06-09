import assert from "node:assert/strict";
import test from "node:test";
import {
  createPopupUiStateStore,
  loadPersistedPopupUiState,
} from "../src/popup/popup-store";

test("popup ui state store exposes stable mutable state and patch semantics", () => {
  const store = createPopupUiStateStore();
  const initialState = store.getState();

  store.patch({
    roomActionPending: true,
    roomCodeDraft: "ROOM01:token-1234567890abcdef",
    localStatusMessage: "busy",
    copyRoomSuccess: true,
  });

  const nextState = store.getState();
  assert.equal(nextState, initialState);
  assert.equal(nextState.roomActionPending, true);
  assert.equal(nextState.roomCodeDraft, "ROOM01:token-1234567890abcdef");
  assert.equal(nextState.localStatusMessage, "busy");
  assert.equal(nextState.copyRoomSuccess, true);
  assert.equal(nextState.copyLogsSuccess, false);
  assert.equal(nextState.easterEggVisible, false);
  assert.equal(nextState.easterEggEffectActive, false);
});

test("popup ui state store reset restores runtime defaults", () => {
  const store = createPopupUiStateStore();
  store.patch({
    roomActionPending: true,
    lastKnownRoomCode: "ROOM02",
    easterEggVisible: true,
    easterEggEffectActive: true,
    copyLogsSuccess: true,
  });

  const resetState = store.reset();
  assert.equal(resetState.roomActionPending, false);
  assert.equal(resetState.lastKnownRoomCode, null);
  assert.equal(resetState.copyLogsSuccess, false);
  assert.equal(resetState.roomCodeDraft, "");
  assert.equal(resetState.easterEggVisible, false);
  assert.equal(resetState.easterEggEffectActive, false);
});

test("popup ui state store restores session-persisted easter egg effect", async () => {
  const previousChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
  const sessionBucket = {
    "bili-syncplay-popup-ui": {
      easterEggEffectActive: true,
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        async get(key: string): Promise<Record<string, unknown>> {
          return { [key]: sessionBucket[key as keyof typeof sessionBucket] };
        },
      },
    },
  };

  try {
    const store = createPopupUiStateStore();
    assert.equal(store.getState().easterEggEffectActive, false);

    await loadPersistedPopupUiState(store);

    assert.equal(store.getState().easterEggEffectActive, true);
    assert.equal(store.getState().easterEggVisible, false);
  } finally {
    (globalThis as unknown as { chrome?: unknown }).chrome = previousChrome;
  }
});

test("popup ui state store ignores local easter egg effect after browser restart", async () => {
  const previousChrome = (globalThis as unknown as { chrome?: unknown }).chrome;
  const localBucket = {
    "bili-syncplay-popup-ui": {
      easterEggEffectActive: true,
    },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      session: {
        async get(key: string): Promise<Record<string, unknown>> {
          return { [key]: undefined };
        },
      },
      local: {
        async get(key: string): Promise<Record<string, unknown>> {
          return { [key]: localBucket[key as keyof typeof localBucket] };
        },
      },
    },
  };

  try {
    const store = createPopupUiStateStore();

    await loadPersistedPopupUiState(store);

    assert.equal(store.getState().easterEggEffectActive, false);
  } finally {
    (globalThis as unknown as { chrome?: unknown }).chrome = previousChrome;
  }
});
