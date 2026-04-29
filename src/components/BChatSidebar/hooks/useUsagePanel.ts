/**
 * @file useUsagePanel.ts
 * @description 用量面板状态管理 hook
 */
import type { AIUsage } from 'types/ai';
import { ref } from 'vue';
import { useChatStore } from '@/stores/chat';
import { useSettingStore } from '@/stores/setting';

/**
 * 用量面板状态管理 hook
 * @returns 用量面板状态和操作方法
 */
export function useUsagePanel() {
  const chatStore = useChatStore();
  const settingStore = useSettingStore();

  /** 用量面板是否已展开 */
  const open = ref(false);
  /** 用量面板加载状态 */
  const loading = ref(false);
  /** 持久化会话用量 */
  const usage = ref<AIUsage | undefined>(undefined);
  /** 用量面板错误信息 */
  const error = ref<string | undefined>(undefined);

  /**
   * 获取当前激活的会话 ID
   * @returns 当前激活的会话 ID
   */
  function getActiveSessionId() {
    return settingStore.chatSidebarActiveSessionId;
  }

  /**
   * 重置用量面板状态
   */
  function reset(): void {
    open.value = false;
    loading.value = false;
    usage.value = undefined;
    error.value = undefined;
  }

  /**
   * 刷新当前会话的用量面板数据
   * 仅在面板打开且会话 ID 匹配时更新
   * @param sessionId - 要刷新用量的会话 ID
   * @param currentSessionId - 当前会话 ID（可选，用于备用）
   */
  async function refresh(sessionId: string, currentSessionId?: string) {
    const activeSessionId = getActiveSessionId() ?? currentSessionId;
    if (!open.value || activeSessionId !== sessionId) {
      return;
    }

    try {
      const sessionUsage = await chatStore.getSessionUsage(sessionId);
      if ((getActiveSessionId() ?? currentSessionId) !== sessionId) {
        return;
      }

      usage.value = sessionUsage;
    } catch (err: unknown) {
      if ((getActiveSessionId() ?? currentSessionId) !== sessionId) {
        return;
      }

      error.value = err instanceof Error ? err.message : '加载会话用量失败';
    } finally {
      if ((getActiveSessionId() ?? currentSessionId) === sessionId) {
        loading.value = false;
      }
    }
  }

  /**
   * 打开用量面板并加载会话用量数据
   * @param currentSessionId - 当前会话 ID（可选，用于备用）
   */
  async function openPanel(currentSessionId?: string) {
    const sessionId = getActiveSessionId() ?? currentSessionId;
    open.value = true;
    error.value = undefined;
    usage.value = undefined;

    if (!sessionId) {
      loading.value = false;
      return;
    }

    loading.value = true;
    await refresh(sessionId);
  }

  /**
   * 关闭用量面板
   */
  function close(): void {
    open.value = false;
  }

  return {
    open,
    loading,
    usage,
    error,
    reset,
    openPanel,
    refresh,
    close
  };
}
