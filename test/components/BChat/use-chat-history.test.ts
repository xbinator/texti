/**
 * @file use-chat-history.test.ts
 * @description BChat 历史快照与 Runtime 实时增量合并测试。
 */
import type { ChatMessageToolPart } from 'types/chat';
import type { ChatRuntimeMessageDelta } from 'types/chat-runtime';
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

/**
 * 创建包含 Shell 工具片段的 Runtime 消息。
 * @param status - 工具运行状态
 * @param withTransient - 是否包含 renderer 临时终端态
 * @returns Shell 工具消息
 */
function createShellMessage(status: 'executing' | 'done', withTransient: boolean): Message {
  const part: ChatMessageToolPart = {
    id: 'shell-part',
    type: 'tool',
    toolCallId: 'shell-call',
    toolName: 'run_shell_command',
    status,
    input: { command: 'printf output' },
    ...(withTransient
      ? {
          shellOutput: [{ commandId: 'shell-call', stream: 'stdout', text: 'raw output', sequence: 1, createdAt: 'now' }],
          shellRunState: { terminalContent: 'stable screen', autoAnswers: [], lastSequence: 1, finished: false }
        }
      : {}),
    ...(status === 'done'
      ? {
          result: {
            toolName: 'run_shell_command',
            status: 'success' as const,
            data: { terminalOutput: 'final output', outputMode: 'pipes' }
          }
        }
      : {})
  };
  return {
    id: 'shell-message',
    role: 'assistant',
    content: '',
    parts: [part],
    createdAt: '2026-08-07T00:00:00.000Z',
    loading: status !== 'done',
    finished: status === 'done'
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

  it('preserves renderer Shell state across executing message updates', (): void => {
    const history = useChatHistory();
    history.setLoadedMessages([createShellMessage('executing', true)]);

    history.upsertLiveMessage(createShellMessage('executing', false));

    const part = history.messages.value[0]?.parts[0];
    expect(part?.type === 'tool' ? part.shellRunState?.terminalContent : undefined).toBe('stable screen');
    expect(part?.type === 'tool' ? part.shellOutput?.[0]?.text : undefined).toBe('raw output');
  });

  it('drops renderer Shell state when the incoming tool is done', (): void => {
    const history = useChatHistory();
    history.setLoadedMessages([createShellMessage('executing', true)]);

    history.upsertLiveMessage(createShellMessage('done', false));

    const part = history.messages.value[0]?.parts[0];
    expect(part?.type === 'tool' ? part.shellRunState : undefined).toBeUndefined();
    expect(part?.type === 'tool' ? part.shellOutput : undefined).toBeUndefined();
    expect(part?.type === 'tool' ? part.result : undefined).toMatchObject({ status: 'success', data: { terminalOutput: 'final output' } });
  });

  it('applies continuous text and reasoning deltas without replacing the full message', (): void => {
    const history = useChatHistory();
    const message = createMessage('assistant-live', 'hello');
    message.finished = false;
    message.parts.push({ id: 'thinking-live', type: 'thinking', thinking: '' });
    history.upsertLiveMessage(message, 0);
    const delta: ChatRuntimeMessageDelta = {
      messageId: message.id,
      baseRevision: 0,
      revision: 2,
      mutations: [
        { kind: 'append-text', partId: `${message.id}-part`, text: ' world' },
        { kind: 'append-reasoning', partId: 'thinking-live', text: 'reason' }
      ]
    };

    expect(history.applyLiveDelta(delta)).toBe(true);
    expect(history.messages.value[0]).toMatchObject({ content: 'hello world', thinking: 'reason' });
    expect(history.messages.value[0]?.parts).toEqual([
      expect.objectContaining({ id: 'assistant-live-part', type: 'text', text: 'hello world' }),
      expect.objectContaining({ id: 'thinking-live', type: 'thinking', thinking: 'reason' })
    ]);
  });

  it('creates a missing append-only part from a continuous delta', (): void => {
    const history = useChatHistory();
    const message = createMessage('assistant-new-part', '');
    message.parts = [];
    message.finished = false;
    history.upsertLiveMessage(message, 0);

    expect(
      history.applyLiveDelta({
        messageId: message.id,
        baseRevision: 0,
        revision: 1,
        mutations: [{ kind: 'append-text', partId: 'new-text-part', text: 'first chunk' }]
      })
    ).toBe(true);
    expect(history.messages.value[0]).toMatchObject({ content: 'first chunk', parts: [{ id: 'new-text-part', type: 'text', text: 'first chunk' }] });
  });

  it('appends tool input text only when the runtime revision is continuous', (): void => {
    const history = useChatHistory();
    const message = createMessage('assistant-tool-input', '');
    message.parts = [
      {
        id: 'tool-part-live',
        type: 'tool',
        toolCallId: 'tool-call-live',
        toolName: 'search_files',
        status: 'inputting',
        input: null,
        inputText: '{'
      }
    ];
    history.upsertLiveMessage(message, 3);

    expect(
      history.applyLiveDelta({
        messageId: message.id,
        baseRevision: 3,
        revision: 4,
        mutations: [{ kind: 'append-tool-input', toolCallId: 'tool-call-live', text: '"query":"x"}' }]
      })
    ).toBe(true);
    expect(history.messages.value[0]?.parts[0]).toMatchObject({ inputText: '{"query":"x"}' });
  });

  it('rejects stale and gapped deltas until a full checkpoint restores the revision', (): void => {
    const history = useChatHistory();
    history.upsertLiveMessage(createMessage('assistant-recovery', 'revision two'), 2);

    expect(
      history.applyLiveDelta({
        messageId: 'assistant-recovery',
        baseRevision: 1,
        revision: 2,
        mutations: [{ kind: 'append-text', partId: 'assistant-recovery-part', text: ' stale' }]
      })
    ).toBe(false);
    expect(
      history.applyLiveDelta({
        messageId: 'assistant-recovery',
        baseRevision: 4,
        revision: 5,
        mutations: [{ kind: 'append-text', partId: 'assistant-recovery-part', text: ' gap' }]
      })
    ).toBe(false);

    history.upsertLiveMessage(createMessage('assistant-recovery', 'checkpoint five'), 5);
    expect(
      history.applyLiveDelta({
        messageId: 'assistant-recovery',
        baseRevision: 5,
        revision: 6,
        mutations: [{ kind: 'append-text', partId: 'assistant-recovery-part', text: ' continued' }]
      })
    ).toBe(true);
    expect(history.messages.value[0]?.content).toBe('checkpoint five continued');
  });

  it('resets the revision when a continuation Runtime reuses the assistant message', (): void => {
    const history = useChatHistory();
    const firstRuntimeMessage = createMessage('assistant-continuation', 'runtime A');
    firstRuntimeMessage.runtimeId = 'runtime-a';
    history.upsertLiveMessage(firstRuntimeMessage, 8);

    const continuedMessage = createMessage('assistant-continuation', 'runtime B checkpoint');
    continuedMessage.runtimeId = 'runtime-b';
    history.upsertLiveMessage(continuedMessage, 0);

    expect(
      history.applyLiveDelta({
        messageId: continuedMessage.id,
        baseRevision: 0,
        revision: 1,
        mutations: [{ kind: 'append-text', partId: 'assistant-continuation-part', text: ' continued' }],
        runtimeId: 'runtime-b'
      })
    ).toBe(true);
    expect(
      history.applyLiveDelta({
        messageId: continuedMessage.id,
        baseRevision: 8,
        revision: 9,
        mutations: [{ kind: 'append-text', partId: 'assistant-continuation-part', text: ' stale' }],
        runtimeId: 'runtime-a'
      })
    ).toBe(false);
    expect(history.messages.value[0]?.content).toBe('runtime B checkpoint continued');
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
