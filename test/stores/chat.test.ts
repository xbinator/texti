/**
 * @file chat.test.ts
 * @description 验证聊天 store 的消息持久化字段映射。
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessageRecord } from 'types/chat';
import type { Message } from '@/components/BChat/types';

type AddMessageMock = (message: ChatMessageRecord) => Promise<void>;
type SetSessionMessagesMock = (sessionId: string, messages: ChatMessageRecord[]) => Promise<void>;
type UpdateSessionLastMessageAtMock = (sessionId: string, lastMessageAt: string) => Promise<void>;
type AddSessionUsageMock = (sessionId: string, usage: NonNullable<Message['usage']>) => Promise<void>;
type UpdateSessionUsageMock = (sessionId: string, usage: NonNullable<Message['usage']> | undefined) => Promise<void>;

/**
 * 模拟消息写入存储层的行为。
 */
const addMessageMock = vi.fn<AddMessageMock>();

/**
 * 模拟会话消息整体替换行为。
 */
const setSessionMessagesMock = vi.fn<SetSessionMessagesMock>();

/**
 * 模拟会话最近消息时间更新行为。
 */
const updateSessionLastMessageAtMock = vi.fn<UpdateSessionLastMessageAtMock>();

/**
 * 模拟会话 usage 累加行为。
 */
const addSessionUsageMock = vi.fn<AddSessionUsageMock>();

/**
 * 模拟会话 usage 重算写入行为。
 */
const updateSessionUsageMock = vi.fn<UpdateSessionUsageMock>();

vi.mock('@/shared/storage', () => ({
  chatStorage: {
    addMessage: addMessageMock,
    setSessionMessages: setSessionMessagesMock,
    updateSessionLastMessageAt: updateSessionLastMessageAtMock,
    addSessionUsage: addSessionUsageMock,
    updateSessionUsage: updateSessionUsageMock
  }
}));

describe('useChatStore', () => {
  beforeEach(() => {
    vi.resetModules();
    addMessageMock.mockReset();
    setSessionMessagesMock.mockReset();
    updateSessionLastMessageAtMock.mockReset();
    addSessionUsageMock.mockReset();
    updateSessionUsageMock.mockReset();
    setActivePinia(createPinia());
  });

  it('persists assistant thinking content with chat messages', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const chatStore = useChatStore();
    const message: Message = {
      id: 'assistant-1',
      role: 'assistant',
      content: '最终答案',
      thinking: '先分析问题',
      createdAt: '2026-04-21T00:00:00.000Z'
    };

    await chatStore.addSessionMessage('session-1', message);

    const persistedRecord = addMessageMock.mock.calls[0]?.[0] as ChatMessageRecord | undefined;

    expect(persistedRecord?.thinking).toBe('先分析问题');
  });

  it('adds assistant usage to the active session when a message completes', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const chatStore = useChatStore();
    const message: Message = {
      id: 'assistant-2',
      role: 'assistant',
      content: '回答',
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
      createdAt: '2026-04-21T00:00:00.000Z'
    };

    await chatStore.addSessionMessage('session-1', message);

    expect(addSessionUsageMock).toHaveBeenCalledWith('session-1', { inputTokens: 3, outputTokens: 5, totalTokens: 8 });
  });

  it('recalculates session usage from retained messages when session messages are replaced', async () => {
    const { useChatStore } = await import('@/stores/chat');
    const chatStore = useChatStore();
    const messages: Message[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '旧回答',
        usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 },
        createdAt: '2026-04-21T00:00:00.000Z'
      },
      {
        id: 'assistant-2',
        role: 'assistant',
        content: '新回答',
        usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
        createdAt: '2026-04-21T00:00:01.000Z'
      }
    ];

    await chatStore.setSessionMessages('session-1', messages);

    expect(updateSessionUsageMock).toHaveBeenCalledWith('session-1', { inputTokens: 5, outputTokens: 9, totalTokens: 14 });
  });
});
