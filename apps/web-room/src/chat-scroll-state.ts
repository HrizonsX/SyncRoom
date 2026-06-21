export type ChatScrollState = {
  scrollTop: number;
  scrollBottom: number;
  atBottom: boolean;
};

const CHAT_SCROLL_BOTTOM_TOLERANCE_PX = 4;

export function readChatScrollState(root: ParentNode): ChatScrollState | null {
  const chatList = root.querySelector<HTMLElement>(".chat-list");
  if (!chatList) {
    return null;
  }

  const scrollBottom =
    chatList.scrollHeight - chatList.clientHeight - chatList.scrollTop;
  return {
    scrollTop: chatList.scrollTop,
    scrollBottom,
    atBottom: scrollBottom <= CHAT_SCROLL_BOTTOM_TOLERANCE_PX,
  };
}

export function restoreChatScrollState(
  root: ParentNode,
  state: ChatScrollState | null,
): void {
  if (!state) {
    return;
  }

  const chatList = root.querySelector<HTMLElement>(".chat-list");
  if (!chatList) {
    return;
  }

  chatList.scrollTop =
    chatList.scrollHeight -
    chatList.clientHeight -
    (state.atBottom ? 0 : state.scrollBottom);
}
