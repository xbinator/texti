/**
 * @file useRollback.ts
 * @description 用户消息回退 hook，支持截断消息列表、持久化及恢复输入框。
 */
import type { Message } from '../utils/types';
import type { Ref } from 'vue';
import { nextTick } from 'vue';

/**
 * useRollback hook 依赖项
 */
export interface UseRollbackOptions {
  /** 响应式消息列表 */
  messages: Ref<Message[]>;
  /** 获取当前会话 ID */
  getSessionId: () => string | undefined;
  /** 判断异步回退所属会话是否仍在当前视图。 */
  isSessionActive: (sessionId: string) => boolean;
  /** 获取已加载的所有历史消息 */
  fetchAllPriorHistory: (sessionId: string) => Promise<Message[]>;
  /** 持久化完整消息列表 */
  persistMessages: (sessionId: string, messages: Message[]) => Promise<void>;
  /** 恢复输入框内容 */
  restoreInput: (message: Message) => void;
  /** 使确认控制器过期 */
  expireConfirmation: () => void;
  /** 聚焦输入框 */
  focusInput: (options?: { moveToEnd?: boolean }) => void;
}

/**
 * useRollback hook 返回值
 */
export interface UseRollbackReturns {
  /** 回退到指定用户消息 */
  rollback: (message: Message) => Promise<void>;
  /** 判断指定消息是否可回退 */
  canRollback: (message: Message) => boolean;
}

/**
 * 用户消息回退 hook
 * @param options - 依赖项配置
 * @returns 回退操作和判断方法
 */
export function useRollback(options: UseRollbackOptions): UseRollbackReturns {
  const { messages, getSessionId, isSessionActive, fetchAllPriorHistory, persistMessages, restoreInput, expireConfirmation, focusInput } = options;

  /**
   * 判断指定消息是否可回退。
   * 条件：role === 'user'，且该消息后面存在可删除消息（user/assistant/error/interrupt），
   * 用户主动中止后仅存在 interrupt 消息时仍应允许回退并恢复输入。
   * @param message - 待判断的消息
   * @returns 是否可回退
   */
  function canRollback(message: Message): boolean {
    if (message.role !== 'user') return false;

    const index = messages.value.findIndex((m) => m.id === message.id);
    if (index === -1) return false;

    return messages.value.slice(index + 1).some((m) => ['user', 'assistant', 'error', 'interrupt'].includes(m.role));
  }

  /**
   * 回退到指定用户消息。
   * 删除该消息及其后所有消息，恢复输入框内容。
   * @param message - 目标用户消息
   */
  async function rollback(message: Message): Promise<void> {
    const sourceMessages = [...messages.value];
    const index = sourceMessages.findIndex((sourceMessage: Message): boolean => sourceMessage.id === message.id);
    if (index === -1) return;

    // 1. 获取已加载但不在当前 messages 中的历史消息
    const sessionId = getSessionId();
    const historyMessages = sessionId ? await fetchAllPriorHistory(sessionId) : [];

    // 2. 截断：保留 index 之前的消息，拼接历史消息
    const retainedMessages = sourceMessages.slice(0, index);
    const fullMessages = [...historyMessages, ...retainedMessages];

    // 3. 持久化截断后的消息列表（DELETE+INSERT 全量替换）
    if (sessionId) {
      await persistMessages(sessionId, fullMessages);
      if (!isSessionActive(sessionId)) return;
    }

    messages.value.splice(0, messages.value.length, ...fullMessages);

    // 4. 过期确认控制器
    expireConfirmation();

    // 5. 恢复输入框内容
    restoreInput(message);

    // 6. 等待编辑器内容更新后，聚焦输入框并将光标移到末尾
    await nextTick();
    focusInput({ moveToEnd: true });
  }

  return { rollback, canRollback };
}
