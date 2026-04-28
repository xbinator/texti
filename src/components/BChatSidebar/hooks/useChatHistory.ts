/**
 * @file useChatHistory.ts
 * @description 聊天历史加载 hook
 */
import type { Message } from '../utils/types';
import type { ChatMessageHistoryCursor } from 'types/chat';
import { ref } from 'vue';
import { useChatStore } from '@/stores/chat';

/**
 * 聊天历史加载 hook
 * @returns 聊天历史状态和操作方法
 */
export function useChatHistory() {
  const chatStore = useChatStore();

  const messages = ref<Message[]>([]);
  const hasMoreHistory = ref(false);
  const historyLoading = ref(false);

  /**
   * 根据当前已加载消息计算更早历史的加载游标
   * @returns 历史加载游标，没有消息时返回 undefined
   */
  function getHistoryCursor(): ChatMessageHistoryCursor | undefined {
    const firstMessage = messages.value[0];
    if (!firstMessage) {
      return undefined;
    }

    return { beforeCreatedAt: firstMessage.createdAt, beforeId: firstMessage.id };
  }

  /**
   * 用一段消息刷新当前会话的历史加载状态
   * @param loadedMessages - 已加载消息
   */
  function setLoadedMessages(loadedMessages: Message[]): void {
    messages.value = loadedMessages;
    hasMoreHistory.value = loadedMessages.length > 0;
  }

  /**
   * 读取当前可见消息之前的所有持久化历史，避免重新生成时覆盖未加载消息
   * @param sessionId - 会话 ID
   * @returns 当前可见消息之前的历史消息
   */
  async function fetchAllPriorHistory(sessionId: string): Promise<Message[]> {
    const historyMessages: Message[] = [];
    let cursor = getHistoryCursor();

    while (cursor) {
      // 顺序读取上一段历史，下一轮游标依赖本轮返回的最早消息
      // eslint-disable-next-line no-await-in-loop
      const batchMessages = await chatStore.getSessionMessages(sessionId, cursor);
      if (!batchMessages.length) {
        break;
      }

      historyMessages.unshift(...batchMessages);
      const firstMessage = batchMessages[0];
      cursor = { beforeCreatedAt: firstMessage.createdAt, beforeId: firstMessage.id };
    }

    return historyMessages;
  }

  /**
   * 加载当前会话中更早的一段历史消息
   * @param sessionId - 会话 ID
   */
  async function loadHistory(sessionId: string): Promise<void> {
    if (historyLoading.value || !hasMoreHistory.value) return;

    const cursor = getHistoryCursor();
    if (!cursor) return;

    historyLoading.value = true;

    try {
      const historyMessages = await chatStore.getSessionMessages(sessionId, cursor);
      hasMoreHistory.value = historyMessages.length > 0;
      if (!historyMessages.length) return;

      messages.value = [...historyMessages, ...messages.value];
    } finally {
      historyLoading.value = false;
    }
  }

  return {
    messages,
    hasMoreHistory,
    historyLoading,
    getHistoryCursor,
    setLoadedMessages,
    fetchAllPriorHistory,
    loadHistory
  };
}
