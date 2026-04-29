/**
 * @file useSession.ts
 * @description 会话管理 hook
 */
import type { Message } from '../utils/types';
import type { ChatSession } from 'types/chat';
import { nextTick, ref } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useSettingStore } from '@/stores/setting';

/**
 * 会话管理 Hook 的依赖项
 */
interface SessionOptions {
  /** 重置用量面板 */
  resetUsagePanel: () => void;
  /** 设置已加载的消息 */
  setLoadedMessages: (messages: Message[]) => void;
  /** 聚焦输入框 */
  focusInput: () => void;
  /** 判断是否正在加载流式响应 */
  isStreamLoading: () => boolean;
  /** 销毁确认控制器 */
  disposeConfirmationController: () => void;
  /** 重置历史加载状态 */
  resetHistoryState: () => void;
}

/**
 * 会话管理 hook
 * @param options - 依赖项配置
 * @returns 会话状态和操作方法
 */
export function useSession(options: SessionOptions) {
  const chatStore = useChatStore();
  const settingStore = useSettingStore();

  /** 当前会话信息 */
  const currentSession = ref<ChatSession | undefined>(undefined);
  /** 会话加载状态 */
  const loading = ref(false);

  /**
   * 创建新会话
   * 1. 检查是否正在输出，是则中断
   * 2. 清理确认控制器状态
   * 3. 重置会话相关状态
   * 4. 自动聚焦输入框
   */
  async function createNewSession(): Promise<void> {
    if (options.isStreamLoading()) return;

    options.disposeConfirmationController();
    settingStore.setChatSidebarActiveSessionId(null);
    currentSession.value = undefined;
    options.resetUsagePanel();
    options.setLoadedMessages([]);
    options.resetHistoryState();
    // 新会话创建后自动聚焦输入框，提升用户体验
    await nextTick();
    options.focusInput();
  }

  /**
   * 切换会话
   * 1. 检查是否正在输出或加载中，是则中断
   * 2. 清理确认控制器状态
   * 3. 更新激活会话 ID
   * 4. 加载新会话的消息列表
   * @param sessionId - 目标会话 ID
   */
  async function switchSession(sessionId: string): Promise<void> {
    if (options.isStreamLoading()) return;
    if (loading.value) return;

    loading.value = true;
    options.disposeConfirmationController();
    settingStore.setChatSidebarActiveSessionId(sessionId);
    options.resetUsagePanel();
    options.resetHistoryState();

    try {
      options.setLoadedMessages(await chatStore.getSessionMessages(sessionId));
    } finally {
      loading.value = false;
    }
  }

  /**
   * 初始化加载当前激活会话
   */
  async function initializeActiveSession(): Promise<void> {
    if (settingStore.chatSidebarActiveSessionId) {
      options.setLoadedMessages(await chatStore.getSessionMessages(settingStore.chatSidebarActiveSessionId));
    }
  }

  /**
   * 刷新会话历史列表
   * @param sessionHistoryRef - 会话历史组件引用
   */
  async function refreshSessionHistory(sessionHistoryRef: { refreshSessions: () => Promise<void> } | null | undefined): Promise<void> {
    await sessionHistoryRef?.refreshSessions();
  }

  return {
    currentSession,
    loading,
    createNewSession,
    switchSession,
    initializeActiveSession,
    refreshSessionHistory
  };
}
