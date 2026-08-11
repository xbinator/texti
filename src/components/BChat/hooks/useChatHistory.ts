/**
 * @file useChatHistory.ts
 * @description 聊天历史加载 hook
 */
import type { Message } from '../utils/types';
import type { ChatMessageHistoryCursor } from 'types/chat';
import { ref, type Ref } from 'vue';
import { useChatSessionStore } from '@/stores/chat/session';
import {
  applyRuntimeDelta,
  createHistoryState,
  mergeLoadedMessages as mergeHistoryMessages,
  normalizeLoadedMessages,
  removeLiveMessage as removeHistoryMessage,
  replaceLoadedMessages,
  type RuntimeAddressedDelta,
  upsertLiveMessage as upsertHistoryMessage
} from './historyReconciliation';

/** 历史分页响应返回后判断目标会话是否仍然可见。 */
type CurrentSessionGuard = (sessionId: string) => boolean;

/** 历史分页需要共享的可变状态。 */
interface HistoryPageContext {
  /** 会话存储。 */
  chatStore: ReturnType<typeof useChatSessionStore>;
  /** 当前展示消息。 */
  messages: Ref<Message[]>;
  /** 是否仍可能存在更早消息。 */
  hasMoreHistory: Ref<boolean>;
  /** 分页请求是否执行中。 */
  historyLoading: Ref<boolean>;
}

/** 实时消息操作需要共享的状态。 */
interface LiveHistoryContext {
  /** 当前展示消息。 */
  messages: Ref<Message[]>;
  /** 是否仍可能存在更早消息。 */
  hasMoreHistory: Ref<boolean>;
  /** 历史与实时事件的竞争状态。 */
  reconciliationState: ReturnType<typeof createHistoryState>;
}

/** 聊天历史 Hook 对外能力。 */
export interface ChatHistoryController {
  /** 当前展示消息。 */
  messages: Ref<Message[]>;
  /** 是否仍可能存在更早消息。 */
  hasMoreHistory: Ref<boolean>;
  /** 分页请求是否执行中。 */
  historyLoading: Ref<boolean>;
  /** 获取更早历史的游标。 */
  getHistoryCursor: () => ChatMessageHistoryCursor | undefined;
  /** 替换当前会话历史。 */
  setLoadedMessages: (loadedMessages: Message[]) => void;
  /** 获取 Renderer 本地 revision。 */
  getMessageRevision: () => number;
  /** 合并并发返回的持久历史。 */
  mergeLoadedMessages: (loadedMessages: Message[], baselineRevision: number) => void;
  /** 写入 Runtime 权威消息。 */
  upsertLiveMessage: (nextMessage: Message, runtimeRevision?: number) => void;
  /** 应用 Runtime 小型增量。 */
  applyLiveDelta: (delta: RuntimeAddressedDelta) => boolean;
  /** 删除 Runtime 实时消息。 */
  removeLiveMessage: (messageId: string) => void;
  /** 读取当前消息之前的全部历史。 */
  fetchAllPriorHistory: (sessionId: string) => Promise<Message[]>;
  /** 加载一页更早历史。 */
  loadHistory: (sessionId: string, isCurrentSession?: CurrentSessionGuard) => Promise<void>;
}

/** 实时消息协调操作集合。 */
type LiveHistoryActions = Pick<
  ChatHistoryController,
  'setLoadedMessages' | 'getMessageRevision' | 'mergeLoadedMessages' | 'upsertLiveMessage' | 'applyLiveDelta' | 'removeLiveMessage'
>;

/**
 * 创建只负责历史快照与 Runtime 实时事件协调的操作。
 * @param context - 实时消息共享状态
 * @returns 实时消息操作
 */
function createLiveActions(context: LiveHistoryContext): LiveHistoryActions {
  /** 用持久消息刷新当前会话。 */
  function setLoadedMessages(loadedMessages: Message[]): void {
    context.messages.value = replaceLoadedMessages(context.reconciliationState, context.messages.value, loadedMessages);
    context.hasMoreHistory.value = loadedMessages.length > 0;
  }

  /** 读取 Renderer 本地单调 revision。 */
  function getMessageRevision(): number {
    return context.reconciliationState.messageRevision;
  }

  /** 合并持久历史，并让请求后的实时事件胜出。 */
  function mergeLoadedMessages(loadedMessages: Message[], baselineRevision: number): void {
    context.hasMoreHistory.value = loadedMessages.length > 0;
    context.messages.value = mergeHistoryMessages(context.reconciliationState, context.messages.value, loadedMessages, baselineRevision);
  }

  /** 新增或合并一条 Runtime 权威消息。 */
  function upsertLiveMessage(nextMessage: Message, runtimeRevision?: number): void {
    upsertHistoryMessage(context.reconciliationState, context.messages.value, nextMessage, runtimeRevision);
  }

  /** 删除 Runtime 实时消息。 */
  function removeLiveMessage(messageId: string): void {
    removeHistoryMessage(context.reconciliationState, context.messages.value, messageId);
  }

  /** 连续应用 Main Runtime 的小型增量。 */
  function applyLiveDelta(delta: RuntimeAddressedDelta): boolean {
    return applyRuntimeDelta(context.reconciliationState, context.messages.value, delta);
  }

  return { setLoadedMessages, getMessageRevision, mergeLoadedMessages, upsertLiveMessage, applyLiveDelta, removeLiveMessage };
}

/**
 * 顺序读取当前可见消息之前的全部历史。
 * @param chatStore - 会话存储
 * @param initialCursor - 第一页游标
 * @param sessionId - 会话 ID
 * @returns 当前可见消息之前的历史消息
 */
async function fetchPriorHistory(
  chatStore: ReturnType<typeof useChatSessionStore>,
  initialCursor: ChatMessageHistoryCursor | undefined,
  sessionId: string
): Promise<Message[]> {
  const historyMessages: Message[] = [];
  let cursor = initialCursor;
  while (cursor) {
    // 顺序读取上一段历史，下一轮游标依赖本轮返回的最早消息
    // eslint-disable-next-line no-await-in-loop
    const batchMessages = await chatStore.getSessionMessages(sessionId, cursor);
    if (!batchMessages.length) break;
    historyMessages.unshift(...batchMessages);
    const firstMessage = batchMessages[0];
    cursor = { beforeCreatedAt: firstMessage.createdAt, beforeRole: firstMessage.role, beforeId: firstMessage.id };
  }
  return historyMessages;
}

/**
 * 加载并合并一页更早历史。
 * @param context - 分页共享状态
 * @param cursor - 更早历史游标
 * @param sessionId - 会话 ID
 * @param isCurrentSession - 响应返回后的会话守卫
 */
async function loadHistoryPage(
  context: HistoryPageContext,
  cursor: ChatMessageHistoryCursor,
  sessionId: string,
  isCurrentSession?: CurrentSessionGuard
): Promise<void> {
  context.historyLoading.value = true;
  try {
    const historyMessages = await context.chatStore.getSessionMessages(sessionId, cursor);
    if (isCurrentSession && !isCurrentSession(sessionId)) return;
    context.hasMoreHistory.value = historyMessages.length > 0;
    if (!historyMessages.length) return;
    context.messages.value = [...normalizeLoadedMessages(historyMessages), ...context.messages.value];
  } finally {
    context.historyLoading.value = false;
  }
}

/**
 * 聊天历史加载 hook
 * @returns 聊天历史状态和操作方法
 */
export function useChatHistory(): ChatHistoryController {
  const chatStore = useChatSessionStore();

  const messages = ref<Message[]>([]);
  const hasMoreHistory = ref(false);
  const historyLoading = ref(false);
  const reconciliationState = createHistoryState();
  const liveActions = createLiveActions({ messages, hasMoreHistory, reconciliationState });

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
   * 读取当前可见消息之前的所有持久化历史，避免重新生成时覆盖未加载消息
   * @param sessionId - 会话 ID
   * @returns 当前可见消息之前的历史消息
   */
  async function fetchAllPriorHistory(sessionId: string): Promise<Message[]> {
    return fetchPriorHistory(chatStore, getHistoryCursor(), sessionId);
  }

  /**
   * 加载当前会话中更早的一段历史消息
   * @param sessionId - 会话 ID
   * @param isCurrentSession - 响应返回时判断该会话是否仍在当前视图
   */
  async function loadHistory(sessionId: string, isCurrentSession?: CurrentSessionGuard): Promise<void> {
    if (historyLoading.value || !hasMoreHistory.value) return;

    const cursor = getHistoryCursor();
    if (!cursor) return;
    return loadHistoryPage({ chatStore, messages, hasMoreHistory, historyLoading }, cursor, sessionId, isCurrentSession);
  }

  return {
    messages,
    hasMoreHistory,
    historyLoading,
    ...liveActions,
    getHistoryCursor,
    fetchAllPriorHistory,
    loadHistory
  };
}
