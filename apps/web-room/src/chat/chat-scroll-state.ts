export type ChatScrollState = {
  scrollTop: number;
  scrollBottom: number;
  atBottom: boolean;
};

const CHAT_SCROLL_BOTTOM_TOLERANCE_PX = 4;

/**
 * 记录聊天列表重渲染前的滚动位置，区分“正在看旧消息”和“停在最新消息”两种场景。
 */
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

/**
 * 在聊天列表重渲染后恢复滚动位置，避免消息增多时自动跳回最旧消息。
 */
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
