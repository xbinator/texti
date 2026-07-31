/**
 * @file use-rollback.test.ts
 * @description BChat 用户消息回退 hook 测试。
 */
import { ref, type Ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { useRollback } from '@/components/BChat/hooks/useRollback';
import type { UseRollbackOptions } from '@/components/BChat/hooks/useRollback';
import type { Message } from '@/components/BChat/utils/types';

/**
 * 创建测试消息。
 * @param id - 消息 ID
 * @param role - 消息角色
 * @returns 测试消息
 */
function createMessage(id: string, role: Message['role']): Message {
  return {
    id,
    role,
    content: id,
    parts: role === 'interrupt' ? [] : [{ id: 'part0052', type: 'text', text: id }],
    createdAt: '2026-06-22T00:00:00.000Z',
    loading: false,
    finished: true
  };
}

/**
 * 创建回退控制器测试夹具。
 * @param messages - 初始消息列表
 * @returns 回退控制器与响应式消息列表
 */
function createRollbackFixture(messages: Message[]): {
  canRollback: (message: Message) => boolean;
  rollback: (message: Message) => Promise<void>;
  messages: Ref<Message[]>;
} {
  const sourceMessages = ref<Message[]>(messages);
  const options: UseRollbackOptions = {
    messages: sourceMessages,
    getSessionId: () => 'session-1',
    isSessionActive: () => true,
    fetchAllPriorHistory: async () => [],
    persistMessages: async () => undefined,
    restoreInput: vi.fn(),
    expireConfirmation: vi.fn(),
    focusInput: vi.fn()
  };
  const rollback = useRollback(options);

  return { canRollback: rollback.canRollback, rollback: rollback.rollback, messages: sourceMessages };
}

describe('useRollback', (): void => {
  it('allows rollback when a user message is followed only by an interrupt status message', (): void => {
    const userMessage = createMessage('user-1', 'user');
    const interruptMessage = createMessage('interrupt-1', 'interrupt');
    const { canRollback } = createRollbackFixture([userMessage, interruptMessage]);

    expect(canRollback(userMessage)).toBe(true);
  });

  it('retains complete earlier messages when truncating a checkpoint-bearing conversation', async (): Promise<void> => {
    const firstUser = createMessage('user-1', 'user');
    const firstAssistant = createMessage('assistant-1', 'assistant');
    firstAssistant.parts = [
      { id: 'source-1', type: 'text', text: '第一轮回答' },
      { id: 'checkpoint-1', type: 'compaction', status: 'skipped', trigger: 'manual', errorCode: 'NO_NEW_CONTENT', createdAt: 1, completedAt: 2 }
    ];
    const secondUser = createMessage('user-2', 'user');
    const secondAssistant = createMessage('assistant-2', 'assistant');
    const messages = ref<Message[]>([firstUser, firstAssistant, secondUser, secondAssistant]);
    const persistMessages = vi.fn(async (): Promise<void> => undefined);
    const rollback = useRollback({
      messages,
      getSessionId: (): string => 'session-1',
      isSessionActive: (): boolean => true,
      fetchAllPriorHistory: async (): Promise<Message[]> => [],
      persistMessages,
      restoreInput: vi.fn(),
      expireConfirmation: vi.fn(),
      focusInput: vi.fn()
    });

    await rollback.rollback(secondUser);

    expect(messages.value).toEqual([firstUser, firstAssistant]);
    expect(messages.value[1].parts).toEqual(firstAssistant.parts);
    expect(persistMessages).toHaveBeenCalledWith('session-1', [firstUser, firstAssistant]);
  });

  it('does not replace another session messages when history resolves after a switch', async (): Promise<void> => {
    const firstUser = createMessage('session-a-user', 'user');
    const firstAssistant = createMessage('session-a-assistant', 'assistant');
    const messages = ref<Message[]>([firstUser, firstAssistant]);
    const sessionBMessage = createMessage('session-b-message', 'assistant');
    let activeSessionId = 'session-a';
    let resolveHistory: (history: Message[]) => void = (): void => undefined;
    const history = new Promise<Message[]>((resolve): void => {
      resolveHistory = resolve;
    });
    const rollback = useRollback({
      messages,
      getSessionId: (): string => 'session-a',
      isSessionActive: (sessionId: string): boolean => sessionId === activeSessionId,
      fetchAllPriorHistory: (): Promise<Message[]> => history,
      persistMessages: vi.fn(async (): Promise<void> => undefined),
      restoreInput: vi.fn(),
      expireConfirmation: vi.fn(),
      focusInput: vi.fn()
    });

    const operation = rollback.rollback(firstUser);
    activeSessionId = 'session-b';
    messages.value = [sessionBMessage];
    resolveHistory([]);
    await operation;

    expect(messages.value).toEqual([sessionBMessage]);
  });
});
