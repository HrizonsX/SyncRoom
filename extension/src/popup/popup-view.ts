export interface PopupRefs {
  serverStatus: HTMLElement;
  roomStatus: HTMLElement;
  membersStatus: HTMLElement;
  message: HTMLElement;
  roomPanelJoined: HTMLElement;
  roomPanelIdle: HTMLElement;
  roomCodeInput: HTMLInputElement;
  copyRoomButton: HTMLButtonElement;
  shareCurrentVideoButton: HTMLButtonElement;
  sharedVideoPanel: HTMLElement;
  sharedVideoCard: HTMLButtonElement;
  sharedVideoTitle: HTMLElement;
  sharedVideoMeta: HTMLElement;
  sharedVideoOwner: HTMLElement;
  sharedVideoOwnerText: HTMLElement;
  easterEgg: HTMLElement;
  voiceStatus: HTMLElement;
  voiceError: HTMLElement;
  logs: HTMLElement;
  memberList: HTMLElement;
  advancedDetails: HTMLDetailsElement;
  advancedState: HTMLElement;
  copyLogsButton: HTMLButtonElement;
  serverUrlInput: HTMLInputElement;
  saveServerUrlButton: HTMLButtonElement;
  confirmDialog: HTMLElement;
  confirmTitle: HTMLElement;
  confirmDescription: HTMLElement;
  confirmConfirmButton: HTMLButtonElement;
  confirmCancelButton: HTMLButtonElement;
  debugMemberStatus: HTMLElement;
  retryStatusValue: HTMLElement;
  retryStatusCount: HTMLElement;
  clockOffsetStatus: HTMLElement;
  rttStatus: HTMLElement;
  createRoomButton: HTMLButtonElement;
  joinRoomButton: HTMLButtonElement;
  leaveRoomButton: HTMLButtonElement;
}

export function collectPopupRefs(): PopupRefs {
  return {
    serverStatus: getById("server-status"),
    roomStatus: getById("room-status"),
    membersStatus: getById("members-status"),
    message: getById("status-message"),
    roomPanelJoined: getById("room-panel-joined"),
    roomPanelIdle: getById("room-panel-idle"),
    roomCodeInput: getById("room-code") as HTMLInputElement,
    copyRoomButton: getById("copy-room") as HTMLButtonElement,
    shareCurrentVideoButton: getById(
      "share-current-video",
    ) as HTMLButtonElement,
    sharedVideoPanel: getById("shared-video-panel"),
    sharedVideoCard: getById("shared-video-card") as HTMLButtonElement,
    sharedVideoTitle: getById("shared-video-title"),
    sharedVideoMeta: getById("shared-video-meta"),
    sharedVideoOwner: getById("shared-video-owner"),
    sharedVideoOwnerText: getById("shared-video-owner-text"),
    easterEgg: getById("easter-egg"),
    voiceStatus: getById("voice-status"),
    voiceError: getById("voice-error"),
    logs: getById("debug-logs"),
    memberList: getById("member-list"),
    advancedDetails: getById("advanced-details") as HTMLDetailsElement,
    advancedState: getById("advanced-state"),
    copyLogsButton: getById("copy-logs") as HTMLButtonElement,
    serverUrlInput: getById("server-url") as HTMLInputElement,
    saveServerUrlButton: getById("save-server-url") as HTMLButtonElement,
    confirmDialog: getById("confirm-dialog"),
    confirmTitle: getById("confirm-title"),
    confirmDescription: getById("confirm-description"),
    confirmConfirmButton: getById("confirm-confirm") as HTMLButtonElement,
    confirmCancelButton: getById("confirm-cancel") as HTMLButtonElement,
    debugMemberStatus: getById("member-status"),
    retryStatusValue: getById("retry-status-value"),
    retryStatusCount: getById("retry-status-count"),
    clockOffsetStatus: getById("clock-offset-status"),
    rttStatus: getById("rtt-status"),
    createRoomButton: getById("create-room") as HTMLButtonElement,
    joinRoomButton: getById("join-room") as HTMLButtonElement,
    leaveRoomButton: getById("leave-room") as HTMLButtonElement,
  };
}

function getById(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing popup element: ${id}`);
  }
  return node;
}
