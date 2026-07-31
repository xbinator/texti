/**
 * @file useChatSessionRuntime.ts
 * @description 管理 BChat 草稿会话、历史加载、会话切换与自动命名运行时态。
 */
import type { BChatResetDraftOptions, Message } from '../utils/types';
import type { ChatSession, ChatSessionModelMetadata } from 'types/chat';
import type { ComputedRef, Ref } from 'vue';
import { computed, nextTick, ref, watch } from 'vue';
import { useChatSessionStore } from '@/stores/chat/session';
import { useAutoName } from './useAutoName';
import { useChatHistory } from './useChatHistory';

/**
 * Chat Session 运行时态依赖项。
 */
interface UseChatSessionRuntimeOptions {
  /** 父级指定的会话 ID */
  sessionId: Ref<string | null>;
  /** 聚焦输入编辑器 */
  focusInput: () => void;
  /** 检查是否存在待回答用户选择 */
  hasPendingUserChoice: (messages: Message[]) => boolean;
  /** 通知新会话已创建 */
  onSessionCreated: (session: ChatSession) => void;
  /** 通知自动标题已持久化 */
  onSessionTitlePersisted: (sessionId: string, title: string) => void;
}

/**
 * Chat Session 运行时态返回值。
 */
interface UseChatSessionRuntimeReturn extends ReturnType<typeof useChatHistory> {
  /** 当前实际运行会话 ID */
  activeSessionId: ComputedRef<string | null>;
  /** BChat 为草稿创建的会话 ID */
  createdSessionId: Ref<string | null>;
  /** 用于自动命名的会话镜像 */
  autoNameSession: Ref<{ id: string; title: string } | undefined>;
  /** 确保存在可持久化会话 */
  ensureActiveSession: (title: string, model: ChatSessionModelMetadata, workspaceRoot?: string) => Promise<string>;
  /** 重置内部草稿状态，但不触发外部导航事件。 */
  resetDraftState: (resetOptions?: BChatResetDraftOptions) => Promise<void>;
  /** 加载当前会话更多历史 */
  handleLoadHistory: () => Promise<void>;
  /** 捕获自动命名快照 */
  captureAutoNameSnapshot: ReturnType<typeof useAutoName>['captureSnapshot'];
  /** 调度自动命名 */
  scheduleAutoName: ReturnType<typeof useAutoName>['scheduleAutoName'];
}

/**
 * 管理当前 BChat 的会话运行时态。
 * @param options - 会话切换与 UI 回调
 * @returns 会话 ID、历史消息和自动命名能力
 */
export function useChatSessionRuntime(options: UseChatSessionRuntimeOptions): UseChatSessionRuntimeReturn {
  const chatStore = useChatSessionStore();
  const createdSessionId = ref<string | null>(null);
  const autoNameSession = ref<{ id: string; title: string }>();
  const activeSessionId = computed<string | null>(() => options.sessionId.value ?? createdSessionId.value);
  const history = useChatHistory();
  /** 最近一次完整会话历史加载序列，用于拒绝 A-B-A 切换后的旧响应。 */
  let sessionLoadSequence = 0;

  /** 重置新会话草稿状态。 */
  async function resetDraftSessionState(resetOptions: BChatResetDraftOptions = {}): Promise<void> {
    createdSessionId.value = null;
    autoNameSession.value = undefined;
    history.setLoadedMessages([]);
    history.hasMoreHistory.value = false;
    await nextTick();
    if (resetOptions.focus !== false) options.focusInput();
  }

  /** 加载指定会话消息。 */
  async function loadSessionMessages(sessionId: string): Promise<void> {
    const requestSequence = ++sessionLoadSequence;
    history.hasMoreHistory.value = false;
    const baselineRevision = history.getMessageRevision();
    const [, messages] = await Promise.all([chatStore.loadSessionById(sessionId), chatStore.getSessionMessages(sessionId)]);
    if (requestSequence !== sessionLoadSequence || activeSessionId.value !== sessionId) return;
    history.mergeLoadedMessages(messages, baselineRevision);
  }

  watch(
    options.sessionId,
    async (nextSessionId: string | null): Promise<void> => {
      if (nextSessionId && nextSessionId === createdSessionId.value) {
        createdSessionId.value = null;
        return;
      }
      if (!nextSessionId) {
        await resetDraftSessionState();
        return;
      }

      createdSessionId.value = null;
      autoNameSession.value = undefined;
      await loadSessionMessages(nextSessionId);
    },
    { immediate: true }
  );

  /** 确保当前发送动作存在可持久化会话。 */
  async function ensureActiveSession(title: string, model: ChatSessionModelMetadata, workspaceRoot?: string): Promise<string> {
    const sessionId = activeSessionId.value;
    if (sessionId) {
      await chatStore.ensureSessionModel(sessionId, model);
      return sessionId;
    }

    const session = await chatStore.createSession('assistant', { title, model, workspaceRoot });
    createdSessionId.value = session.id;
    autoNameSession.value = session;
    options.onSessionCreated(session);
    return session.id;
  }

  /** 加载当前会话的更早历史。 */
  async function handleLoadHistory(): Promise<void> {
    const sessionId = activeSessionId.value;
    if (!sessionId) return;
    await history.loadHistory(sessionId, (requestedSessionId: string): boolean => activeSessionId.value === requestedSessionId);
  }

  const { captureSnapshot, scheduleAutoName } = useAutoName({
    getCurrentSession: (): { id: string; title: string } | undefined => autoNameSession.value,
    getFirstRoundContent: (nextMessage: Pick<Message, 'content'>) => {
      if (options.hasPendingUserChoice(history.messages.value)) {
        return null;
      }

      const userMessages = history.messages.value.filter((item: Message): boolean => item.role === 'user');
      const assistantMessages = history.messages.value.filter((item: Message): boolean => item.role === 'assistant');
      if (userMessages.length !== 1 || assistantMessages.length !== 1) return null;
      return { userMessage: userMessages[0].content, aiResponse: nextMessage.content };
    },
    onTitlePersisted: options.onSessionTitlePersisted
  });

  return {
    ...history,
    activeSessionId,
    createdSessionId,
    autoNameSession,
    ensureActiveSession,
    resetDraftState: resetDraftSessionState,
    handleLoadHistory,
    captureAutoNameSnapshot: captureSnapshot,
    scheduleAutoName
  };
}
