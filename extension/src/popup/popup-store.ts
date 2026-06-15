import { createStore, type StateStore } from "../shared/create-store";

export interface PopupUiState {
  roomActionPending: boolean;
  localRoomEntryPending: boolean;
  lastKnownPendingCreateRoom: boolean;
  lastKnownPendingJoinRoomCode: string | null;
  lastKnownRoomCode: string | null;
  lastRoomEnteredAt: number;
  roomCodeDraft: string;
  localStatusMessage: string | null;
  easterEggVisible: boolean;
  easterEggEffectActive: boolean;
  copyRoomSuccess: boolean;
  copyLogsSuccess: boolean;
  popupPort: chrome.runtime.Port | null;
}

export type PopupUiStateStore = StateStore<PopupUiState>;

const POPUP_UI_STORAGE_KEY = "syncroom-popup-ui";

interface PersistedPopupUiState {
  easterEggEffectActive?: boolean;
}

export function createPopupUiState(): PopupUiState {
  return {
    roomActionPending: false,
    localRoomEntryPending: false,
    lastKnownPendingCreateRoom: false,
    lastKnownPendingJoinRoomCode: null,
    lastKnownRoomCode: null,
    lastRoomEnteredAt: 0,
    roomCodeDraft: "",
    localStatusMessage: null,
    easterEggVisible: false,
    easterEggEffectActive: false,
    copyRoomSuccess: false,
    copyLogsSuccess: false,
    popupPort: null,
  };
}

export function createPopupUiStateStore(): PopupUiStateStore {
  return createStore<PopupUiState>(createPopupUiState);
}

export async function loadPersistedPopupUiState(
  store: PopupUiStateStore,
): Promise<void> {
  try {
    const result =
      await chrome.storage.session.get<
        Record<string, PersistedPopupUiState | undefined>
      >(POPUP_UI_STORAGE_KEY);
    const easterEggEffectActive =
      result[POPUP_UI_STORAGE_KEY]?.easterEggEffectActive;
    if (typeof easterEggEffectActive === "boolean") {
      store.patch({ easterEggEffectActive });
    }
  } catch {
    // Keep popup startup resilient when extension storage is unavailable.
  }
}

export async function persistPopupEasterEggEffectActive(
  easterEggEffectActive: boolean,
): Promise<void> {
  try {
    await chrome.storage.session.set({
      [POPUP_UI_STORAGE_KEY]: {
        easterEggEffectActive,
      },
    });
  } catch {
    // The animation is decorative; storage failures should not block the UI.
  }
}
