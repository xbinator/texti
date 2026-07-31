/**
 * @file use-chat-history.test.ts
 * @description BChat 历史快照与 Runtime 实时增量合并测试。
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatHistory } from '@/components/BChat/hooks/useChatHistory';
import type { Message } from '@/components/BChat/utils/types';
import { useChatSessionStore } from '@/stores/chat/session';

/**
 * 创建最小聊天消息。
 * @param id - 消息 ID
 * @param content - 消息文本
 * @returns 聊天消息
 */
function createMessage(id: string, content: string): Message {
  return {
    id,
    role: 'assistant',
    content,
    parts: [{ id: `${id}-part`, type: 'text', text: content }],
    createdAt: '2026-07-31T00:00:00.000Z',
    loading: false,
    finished: true
  };
}

describe('useChatHistory', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
  });

  it('keeps only post-baseline live changes when another session history resolves', (): void => {
    const history = useChatHistory();
    history.setLoadedMessages([createMessage('session-a-message', 'session A')]);
    const baselineRevision = history.getMessageRevision();

    history.upsertLiveMessage(createMessage('session-b-message', 'new live content'));
    history.mergeLoadedMessages([createMessage('session-b-message', 'old persisted content')], baselineRevision);

    expect(history.messages.value).toEqual([expect.objectContaining({ id: 'session-b-message', content: 'new live content' })]);
  });

  it('discards an older-page response after the active session changes', async (): Promise<void> => {
    const history = useChatHistory();
    const chatStore = useChatSessionStore();
    let activeSessionId = 'session-a';
    let resolveHistory: (messages: Message[]) => void = (): void => undefined;
    const historyResponse = new Promise<Message[]>((resolve): void => {
      resolveHistory = resolve;
    });
    vi.spyOn(chatStore, 'getSessionMessages').mockReturnValueOnce(historyResponse);
    history.setLoadedMessages([createMessage('session-a-current', 'session A current')]);
    history.hasMoreHistory.value = true;

    const loading = history.loadHistory('session-a', (sessionId: string): boolean => sessionId === activeSessionId);
    activeSessionId = 'session-b';
    history.setLoadedMessages([createMessage('session-b-current', 'session B current')]);
    resolveHistory([createMessage('session-a-older', 'session A older')]);
    await loading;

    expect(history.messages.value).toEqual([expect.objectContaining({ id: 'session-b-current' })]);
  });
});
