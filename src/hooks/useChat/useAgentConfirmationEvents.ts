/**
 * @file useAgentConfirmationEvents.ts
 * @description Child Agent confirmation application event 订阅、Renderer 重载恢复与单调队列投影。
 */
import type { ChatAgentApplicationEvent, ChatAgentHandlerResult } from 'types/chat-agent';
import { onScopeDispose } from 'vue';
import { logger } from '@/shared/logger';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { useChatConfirmationQueueStore } from '@/stores/chat/confirmationQueue';
import { asyncTo } from '@/utils/asyncTo';

/**
 * 解包 Chat Agent IPC 信封。
 * @param result - Agent handler 结果
 * @returns 成功数据
 */
function unwrapAgentResult<T>(result: ChatAgentHandlerResult<T>): T {
  if (!result.ok) {
    const error = new Error(result.error);
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.data;
}

/**
 * 注册应用级 confirmation event，并在订阅后恢复全部 pending snapshot。
 * 事件和 list 响应统一由 Store 的 version + updatedAt cursor 收敛。
 */
export function useAgentConfirmationEvents(): void {
  const electronAPI = getElectronAPI();
  if (typeof electronAPI.chatAgentOnEvent !== 'function' || typeof electronAPI.chatAgentListConfirmations !== 'function') return;
  const queue = useChatConfirmationQueueStore();
  let disposed = false;

  /**
   * 只消费 confirmation 判别分支。
   * @param event - Main application event
   */
  function handleEvent(event: ChatAgentApplicationEvent): void {
    if (disposed || event.type !== 'confirmation.updated') return;
    queue.applyAgent(event.confirmation);
  }

  /**
   * 从 Main 事实源恢复全部 pending confirmation。
   */
  async function recover(): Promise<void> {
    const [requestError, response] = await asyncTo(electronAPI.chatAgentListConfirmations());
    if (requestError || !response) throw requestError ?? new Error('Chat Agent confirmation recovery returned no response');
    if (disposed) return;
    queue.applySnapshot(unwrapAgentResult(response));
  }

  // 必须先订阅再 list，避免恢复窗口内丢失新增或决议事件。
  const disposeEvent = electronAPI.chatAgentOnEvent(handleEvent);
  recover().catch((error: unknown): void => {
    logger.error(`[chat-agent-confirmation-recovery] ${error instanceof Error ? error.message : String(error)}`);
  });

  onScopeDispose((): void => {
    disposed = true;
    disposeEvent();
  });
}
