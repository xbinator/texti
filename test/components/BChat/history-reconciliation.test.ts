/**
 * @file history-reconciliation.test.ts
 * @description BChat 历史快照与 Runtime 实时消息竞争协调测试。
 */
import type { Message } from '../../../src/components/BChat/utils/types';
import type { ChatRuntimeMessageDelta } from 'types/chat-runtime';
import { describe, expect, it } from 'vitest';
import { applyRuntimeDelta, createHistoryState, upsertLiveMessage } from '../../../src/components/BChat/hooks/historyReconciliation';

/**
 * 创建 Runtime Assistant 消息。
 * @param runtimeId - 产生该消息的 Runtime
 * @param content - 消息正文
 * @returns 可参与 revision 竞争的消息
 */
function createMessage(runtimeId: string, content: string): Message {
  return {
    id: 'assistant-history',
    runtimeId,
    role: 'assistant',
    content,
    parts: [{ id: 'text-history', type: 'text', text: content }],
    createdAt: '2026-08-10T00:00:00.000Z',
    loading: true,
    finished: false
  };
}

describe('history reconciliation', (): void => {
  it('rejects stale checkpoints but accepts revision zero from a replacement runtime', (): void => {
    const state = createHistoryState();
    const messages: Message[] = [];

    upsertLiveMessage(state, messages, createMessage('runtime-a', 'revision five'), 5);
    upsertLiveMessage(state, messages, createMessage('runtime-a', 'stale revision four'), 4);
    expect(messages[0]?.content).toBe('revision five');

    upsertLiveMessage(state, messages, createMessage('runtime-b', 'replacement runtime'), 0);
    expect(messages[0]?.content).toBe('replacement runtime');
    expect(state.runtimeMessageRevisions.get('assistant-history')).toEqual({ runtimeId: 'runtime-b', revision: 0 });
    expect(state.messageRevision).toBe(2);
  });

  it('applies a continuous Runtime delta and advances both revision clocks', (): void => {
    const state = createHistoryState();
    const messages: Message[] = [];
    upsertLiveMessage(state, messages, createMessage('runtime-a', 'start'), 0);
    const delta: ChatRuntimeMessageDelta = {
      messageId: 'assistant-history',
      baseRevision: 0,
      revision: 1,
      mutations: [{ kind: 'append-text', partId: 'text-history', text: ' continued' }]
    };

    expect(applyRuntimeDelta(state, messages, delta)).toBe(true);
    expect(messages[0]?.content).toBe('start continued');
    expect(state.runtimeMessageRevisions.get('assistant-history')).toEqual({ runtimeId: 'runtime-a', revision: 1 });
    expect(state.messageRevision).toBe(2);
  });
});
