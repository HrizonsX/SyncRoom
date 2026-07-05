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

/**
 * 读取聊天室输入框草稿，避免冷却倒计时重渲染时清空用户正在输入的内容。
 */
export function readChatInputDraftState(root: ParentNode): ChatInputDraftState {
  return readInputDraftState(root, 'input[name="chat"]');
}

/**
 * 恢复聊天室输入框草稿，保证发送保护期间用户输入不会被重渲染覆盖。
 */
export function restoreChatInputDraftState(
  root: ParentNode,
  state: ChatInputDraftState,
): void {
  restoreInputDraftState(root, 'input[name="chat"]', state);
}

/**
 * 读取播放器弹幕输入草稿，使弹幕冷却和控制栏重渲染不影响未发送文本。
 */
export function readPlayerDanmakuInputDraftState(
  root: ParentNode,
): PlayerDanmakuInputDraftState {
  return readInputDraftState(root, 'input[name="playerDanmaku"]');
}

/**
 * 恢复播放器弹幕输入草稿，保持它和聊天室输入的发送保护相互独立。
 */
export function restorePlayerDanmakuInputDraftState(
  root: ParentNode,
  state: PlayerDanmakuInputDraftState,
): void {
  restoreInputDraftState(root, 'input[name="playerDanmaku"]', state);
}
