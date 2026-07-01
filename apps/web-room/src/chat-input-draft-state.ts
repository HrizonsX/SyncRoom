export type ChatInputDraftState = {
  value?: string;
};

export type PlayerDanmakuInputDraftState = {
  value?: string;
};

function findInput(
  root: ParentNode,
  selector: string,
): HTMLInputElement | null {
  return root.querySelector<HTMLInputElement>(selector);
}

function readInputDraftState(
  root: ParentNode,
  selector: string,
): ChatInputDraftState {
  const value = findInput(root, selector)?.value ?? "";
  return value.length > 0 ? { value } : {};
}

function restoreInputDraftState(
  root: ParentNode,
  selector: string,
  state: ChatInputDraftState,
): void {
  if (state.value === undefined) {
    return;
  }

  const input = findInput(root, selector);
  if (input) {
    input.value = state.value;
  }
}

export function readChatInputDraftState(root: ParentNode): ChatInputDraftState {
  return readInputDraftState(root, 'input[name="chat"]');
}

export function restoreChatInputDraftState(
  root: ParentNode,
  state: ChatInputDraftState,
): void {
  restoreInputDraftState(root, 'input[name="chat"]', state);
}

export function readPlayerDanmakuInputDraftState(
  root: ParentNode,
): PlayerDanmakuInputDraftState {
  return readInputDraftState(root, 'input[name="playerDanmaku"]');
}

export function restorePlayerDanmakuInputDraftState(
  root: ParentNode,
  state: PlayerDanmakuInputDraftState,
): void {
  restoreInputDraftState(root, 'input[name="playerDanmaku"]', state);
}
