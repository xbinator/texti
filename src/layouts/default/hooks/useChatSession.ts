/**
 * @file useChatSession.ts
 * @description ChatSider 会话选择状态管理。
 */
import type { ChatSession } from 'types/chat';
import type { ComputedRef } from 'vue';
import { computed } from 'vue';
import { useChatSessionStore } from '@/stores/chat/session';
import { useSettingStore } from '@/stores/ui/setting';

/**
 * ChatSider 会话选择状态。
 */
interface ChatSessionApi {
  /** 当前激活会话，由共享 Store 集合推导。 */
  currentSession: ComputedRef<ChatSession | undefined>;
  /** 切换当前激活会话。 */
  switchSession: (sessionId: string) => Promise<void>;
  /** 进入新会话草稿态。 */
  createDraftSession: () => Promise<void>;
  /** 当前会话被删除后的外层状态同步。 */
  handleDeletedSession: (sessionId: string) => void;
}

/**
 * 管理默认布局聊天侧栏的会话选择状态。
 * @returns 会话 API
 */
export function useChatSession(): ChatSessionApi {
  const chatStore = useChatSessionStore();
  const settingStore = useSettingStore();
  /** 当前激活会话的只读计算视图。 */
  const currentSession = computed<ChatSession | undefined>(() => chatStore.findSession(settingStore.chatSidebarActiveSessionId));

  /**
   * 切换当前激活会话。
   * @param sessionId - 目标会话 ID
   */
  async function switchSession(sessionId: string): Promise<void> {
    if (sessionId === settingStore.chatSidebarActiveSessionId) return;

    settingStore.setChatSidebarActiveSessionId(sessionId);
  }

  /**
   * 进入新会话草稿态。
   */
  async function createDraftSession(): Promise<void> {
    settingStore.setChatSidebarActiveSessionId(null);
  }

  /**
   * 同步会话删除后的外层状态。
   * @param sessionId - 被删除的会话 ID
   */
  function handleDeletedSession(sessionId: string): void {
    if (sessionId !== settingStore.chatSidebarActiveSessionId) return;

    settingStore.setChatSidebarActiveSessionId(null);
  }

  return {
    currentSession,
    switchSession,
    createDraftSession,
    handleDeletedSession
  };
}
