export type ChatInputDraftState = {
  value?: string;
};

function findChatInput(root: ParentNode): HTMLInputElement | null {
  return root.querySelector<HTMLInputElement>('input[name="chat"]');
}

export function readChatInputDraftState(root: ParentNode): ChatInputDraftState {
  const value = findChatInput(root)?.value ?? "";
  return value.length > 0 ? { value } : {};
}

export function restoreChatInputDraftState(
  root: ParentNode,
  state: ChatInputDraftState,
): void {
  if (state.value === undefined) {
    return;
  }

  const input = findChatInput(root);
  if (input) {
    input.value = state.value;
  }
}
