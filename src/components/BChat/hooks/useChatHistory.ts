/**
 * @file useChatHistory.ts
 * @description 聊天历史加载 hook
 */
import type { Message } from '../utils/types';
import type { ChatMessageHistoryCursor, ChatMessagePart, ChatMessageToolPart } from 'types/chat';
import { ref } from 'vue';
import { keyBy } from 'lodash-es';
import { useChatSessionStore } from '@/stores/chat/session';
import { userChoice } from '../utils/messageHelper';

/**
 * 归一化从持久化层读取的消息状态。
 * @param loadedMessages - 持久化消息
 * @returns 可直接展示的消息
 */
function normalizeLoadedMessages(loadedMessages: Message[]): Message[] {
  return loadedMessages.map(userChoice.normalizePendingState);
}

/**
 * 在 Main 权威消息更新中保留执行中 Shell 的 renderer 临时状态。
 * @param current - renderer 当前消息
 * @param next - Runtime 最新消息
 * @returns 只补回缺失 Shell 临时字段的最新消息
 */
function preserveShellState(current: Message, next: Message): Message {
  const currentTools = keyBy(
    current.parts.filter((part: ChatMessagePart): part is ChatMessageToolPart => part.type === 'tool' && part.toolName === 'run_shell_command'),
    'toolCallId'
  );
  const parts = next.parts.map((part: ChatMessagePart): ChatMessagePart => {
    if (part.type !== 'tool' || part.toolName !== 'run_shell_command' || part.status === 'done') return part;
    const previous = currentTools[part.toolCallId];
    if (!previous) return part;
    return {
      ...part,
      ...(part.shellOutput === undefined && previous.shellOutput !== undefined ? { shellOutput: previous.shellOutput } : {}),
      ...(part.shellRunState === undefined && previous.shellRunState !== undefined ? { shellRunState: previous.shellRunState } : {})
    };
  });
  return { ...next, parts };
}

/**
 * 聊天历史加载 hook
 * @returns 聊天历史状态和操作方法
 */
export function useChatHistory() {
  const chatStore = useChatSessionStore();

  const messages = ref<Message[]>([]);
  const hasMoreHistory = ref(false);
  const historyLoading = ref(false);
  const messageRevision = ref<number>(0);
  /** 记录每条消息最近一次实时写入所在的 revision。 */
  const liveMessageRevisions = new Map<string, number>();
  /** 记录某条消息最近一次实时删除所在的 revision。 */
  const deletedMessageRevisions = new Map<string, number>();

  /**
   * 根据当前已加载消息计算更早历史的加载游标
   * @returns 历史加载游标，没有消息时返回 undefined
   */
  function getHistoryCursor(): ChatMessageHistoryCursor | undefined {
    const firstMessage = messages.value[0];
    if (!firstMessage) {
      return undefined;
    }

    return { beforeCreatedAt: firstMessage.createdAt, beforeRole: firstMessage.role, beforeId: firstMessage.id };
  }

  /**
   * 用一段消息刷新当前会话的历史加载状态
   * @param loadedMessages - 已加载消息
   */
  function setLoadedMessages(loadedMessages: Message[]): void {
    const normalizedMessages = normalizeLoadedMessages(loadedMessages);
    const nextIds = new Set(normalizedMessages.map((message: Message): string => message.id));
    messageRevision.value += 1;

    // 显式替换也属于本地变更，必须压过此前已发起但尚未返回的历史请求。
    messages.value.forEach((message: Message): void => {
      if (!nextIds.has(message.id)) {
        liveMessageRevisions.delete(message.id);
        deletedMessageRevisions.set(message.id, messageRevision.value);
      }
    });
    normalizedMessages.forEach((message: Message): void => {
      liveMessageRevisions.set(message.id, messageRevision.value);
      deletedMessageRevisions.delete(message.id);
    });
    messages.value = normalizedMessages;
    hasMoreHistory.value = loadedMessages.length > 0;
  }

  /**
   * 读取当前可见消息的实时 revision。
   * @returns 单调递增 revision
   */
  function getMessageRevision(): number {
    return messageRevision.value;
  }

  /**
   * 合并持久化历史，并让请求发起后收到的实时消息与删除事件胜出。
   * @param loadedMessages - 持久化层返回的消息快照
   * @param baselineRevision - 发起历史请求时的实时 revision
   */
  function mergeLoadedMessages(loadedMessages: Message[], baselineRevision: number): void {
    const normalizedMessages = normalizeLoadedMessages(loadedMessages);
    hasMoreHistory.value = loadedMessages.length > 0;
    if (messageRevision.value === baselineRevision) {
      messages.value = normalizedMessages;
      liveMessageRevisions.clear();
      deletedMessageRevisions.clear();
      return;
    }

    const currentById = new Map(messages.value.map((message: Message): [string, Message] => [message.id, message]));
    const loadedIds = new Set(normalizedMessages.map((message: Message): string => message.id));
    const mergedMessages = normalizedMessages
      .filter((message: Message): boolean => (deletedMessageRevisions.get(message.id) ?? -1) <= baselineRevision)
      .map((message: Message): Message => ((liveMessageRevisions.get(message.id) ?? -1) > baselineRevision ? currentById.get(message.id) ?? message : message));
    const appendedLiveMessages = messages.value.filter(
      (message: Message): boolean => !loadedIds.has(message.id) && (liveMessageRevisions.get(message.id) ?? -1) > baselineRevision
    );
    messages.value = [...mergedMessages, ...appendedLiveMessages];

    // 已被本次历史快照吸收的旧 revision 不再参与后续会话合并。
    [...liveMessageRevisions.entries()].forEach(([messageId, revision]: [string, number]): void => {
      if (revision <= baselineRevision) liveMessageRevisions.delete(messageId);
    });
    [...deletedMessageRevisions.entries()].forEach(([messageId, revision]: [string, number]): void => {
      if (revision <= baselineRevision) deletedMessageRevisions.delete(messageId);
    });
  }

  /**
   * 新增或合并一条 Runtime 实时消息，并推进 revision。
   * @param nextMessage - Runtime 最新消息
   */
  function upsertLiveMessage(nextMessage: Message): void {
    messageRevision.value += 1;
    liveMessageRevisions.set(nextMessage.id, messageRevision.value);
    deletedMessageRevisions.delete(nextMessage.id);
    const normalizedMessage = userChoice.normalizePendingState(nextMessage);
    const index = messages.value.findIndex((message: Message): boolean => message.id === normalizedMessage.id);
    if (index < 0) messages.value.push(normalizedMessage);
    else {
      const mergedMessage = preserveShellState(messages.value[index], normalizedMessage);
      messages.value.splice(index, 1, { ...messages.value[index], ...mergedMessage });
    }
  }

  /**
   * 删除一条 Runtime 实时消息，并记录防止旧历史将其复活的 revision。
   * @param messageId - 待删除消息 ID
   */
  function removeLiveMessage(messageId: string): void {
    messageRevision.value += 1;
    liveMessageRevisions.delete(messageId);
    deletedMessageRevisions.set(messageId, messageRevision.value);
    const index = messages.value.findIndex((message: Message): boolean => message.id === messageId);
    if (index >= 0) messages.value.splice(index, 1);
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
      cursor = { beforeCreatedAt: firstMessage.createdAt, beforeRole: firstMessage.role, beforeId: firstMessage.id };
    }

    return historyMessages;
  }

  /**
   * 加载当前会话中更早的一段历史消息
   * @param sessionId - 会话 ID
   * @param isCurrentSession - 响应返回时判断该会话是否仍在当前视图
   */
  async function loadHistory(sessionId: string, isCurrentSession?: (sessionId: string) => boolean): Promise<void> {
    if (historyLoading.value || !hasMoreHistory.value) return;

    const cursor = getHistoryCursor();
    if (!cursor) return;

    historyLoading.value = true;

    try {
      const historyMessages = await chatStore.getSessionMessages(sessionId, cursor);
      if (isCurrentSession && !isCurrentSession(sessionId)) return;
      hasMoreHistory.value = historyMessages.length > 0;
      if (!historyMessages.length) return;

      messages.value = [...normalizeLoadedMessages(historyMessages), ...messages.value];
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
    getMessageRevision,
    mergeLoadedMessages,
    upsertLiveMessage,
    removeLiveMessage,
    fetchAllPriorHistory,
    loadHistory
  };
}
