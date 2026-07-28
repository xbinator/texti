/**
 * @file useAgentConfirmationEvents.ts
 * @description Child Agent confirmation application event 订阅、Renderer 重载恢复与单调队列投影。
 */
import type { ChatAgentApplicationEvent } from 'types/chat-agent';
import { onScopeDispose } from 'vue';
import { logger } from '@/shared/logger';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { useChatConfirmationQueueStore } from '@/stores/chat/confirmationQueue';

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

  // 必须先订阅再 list，避免恢复窗口内丢失新增或决议事件。
  const disposeEvent = electronAPI.chatAgentOnEvent(handleEvent);
  queue.recoverAgent().catch((error: unknown): void => {
    logger.error(`[chat-agent-confirmation-recovery] ${error instanceof Error ? error.message : String(error)}`);
  });

  onScopeDispose((): void => {
    disposed = true;
    disposeEvent();
  });
}
