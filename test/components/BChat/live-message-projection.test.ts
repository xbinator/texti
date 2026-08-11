/**
 * @file live-message-projection.test.ts
 * @description Renderer Assistant 实时 mutation 纯投影测试。
 */
import type { Message } from '../../../src/components/BChat/utils/types';
import type { ChatRuntimeMessageMutation } from 'types/chat-runtime';
import { describe, expect, it } from 'vitest';
import { applyMutations, validateMutations } from '../../../src/components/BChat/hooks/liveMessageProjection';

/**
 * 创建含工具 Part 的 Renderer 消息。
 * @returns 可应用追加 mutation 的消息
 */
function createMessage(): Message {
  return {
    id: 'assistant-projection',
    role: 'assistant',
    content: '',
    thinking: '',
    parts: [
      {
        id: 'tool-part',
        type: 'tool',
        toolCallId: 'tool-call-1',
        toolName: 'read_file',
        status: 'inputting',
        input: null,
        inputText: '{'
      }
    ],
    createdAt: '2026-08-10T00:00:00.000Z',
    loading: true,
    finished: false
  };
}

describe('live message projection', (): void => {
  it('validates the whole batch before appending text, thinking and tool input', (): void => {
    const message = createMessage();
    const mutations: ChatRuntimeMessageMutation[] = [
      { kind: 'append-text', partId: 'text-part', text: 'hello' },
      { kind: 'append-reasoning', partId: 'thinking-part', text: 'inspect' },
      { kind: 'append-tool-input', toolCallId: 'tool-call-1', text: '"path":"CONTEXT.md"}' }
    ];

    expect(validateMutations(message, mutations)).toBe(true);
    applyMutations(message, mutations);

    expect(message.content).toBe('hello');
    expect(message.thinking).toBe('inspect');
    expect(message.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'text-part', type: 'text', text: 'hello' }),
        expect.objectContaining({ id: 'thinking-part', type: 'thinking', thinking: 'inspect' }),
        expect.objectContaining({ toolCallId: 'tool-call-1', inputText: '{"path":"CONTEXT.md"}' })
      ])
    );
  });

  it('rejects a conflicting batch without changing the message', (): void => {
    const message = createMessage();
    message.parts.push({ id: 'shared-part', type: 'text', text: 'existing' });
    const before = structuredClone(message);
    const mutations: ChatRuntimeMessageMutation[] = [
      { kind: 'append-text', partId: 'new-part', text: 'safe-prefix' },
      { kind: 'append-reasoning', partId: 'shared-part', text: 'conflict' }
    ];

    expect(validateMutations(message, mutations)).toBe(false);
    expect(message).toEqual(before);
  });
});
