/**
 * @file runtime-error.test.ts
 * @description ChatRuntime 错误处理与中文展示测试。
 */
import { describe, expect, it } from 'vitest';
import { finalizeFailedMessage } from '@/components/BChat/utils/messageHelper';
import { appendRuntimeErrorMessage, createRuntimeError, createRuntimeRequestError, localizeRuntimeErrorMessage } from '@/components/BChat/utils/runtimeError';
import type { Message } from '@/components/BChat/utils/types';

/**
 * 创建测试消息。
 * @param overrides - 需要覆盖的消息字段
 * @returns 测试消息
 */
function createMessage(overrides: Partial<Message>): Message {
  return {
    id: 'message-1',
    role: 'user',
    content: 'hello',
    parts: [{ id: 'part0033', type: 'text', text: 'hello' }],
    createdAt: '2026-06-23T00:00:00.000Z',
    ...overrides
  };
}

describe('runtimeError', (): void => {
  it('localizes missing file errors with the original path', (): void => {
    const message = localizeRuntimeErrorMessage({
      code: 'ENOENT',
      message: "ENOENT: no such file or directory, stat '/home/user/Desktop/Markdown 语法全量渲染测试.md'"
    });

    expect(message).toBe('文件不存在或已被移动：/home/user/Desktop/Markdown 语法全量渲染测试.md');
  });

  it('preserves unknown runtime errors', (): void => {
    expect(localizeRuntimeErrorMessage({ code: 'UNKNOWN', message: 'Provider request failed' })).toBe('Provider request failed');
  });

  it('creates errors with stable runtime codes', (): void => {
    const error = createRuntimeRequestError({
      ok: false,
      code: 'ENOENT',
      error: "ENOENT: no such file or directory, open '/tmp/missing.md'"
    });

    expect(error.message).toBe('文件不存在或已被移动：/tmp/missing.md');
    expect(error.code).toBe('ENOENT');
  });

  it('creates local preparation errors through the shared runtime error collector', (): void => {
    const error = createRuntimeError({ code: 'SKILL_UNAVAILABLE', message: '技能不可用' });

    expect(error).toMatchObject({ code: 'SKILL_UNAVAILABLE', message: '技能不可用' });
  });

  it('appends runtime errors to visible and persisted messages', async (): Promise<void> => {
    const userMessage = createMessage({ id: 'user-1', content: 'read file', parts: [{ id: 'part0034', type: 'text', text: 'read file' }] });
    const visibleMessages: Message[] = [];
    let loadedMessages: Message[] = [];
    let persistedMessages: Message[] = [];

    await appendRuntimeErrorMessage({
      sessionId: 'session-1',
      content: '文件不存在或已被移动：/tmp/missing.md',
      visibleMessages,
      precedingMessage: userMessage,
      fetchAllPriorHistory: async () => [],
      persistMessages: async (_sessionId, messages) => {
        persistedMessages = messages;
      },
      setLoadedMessages: (messages) => {
        loadedMessages = messages;
      }
    });

    expect(loadedMessages).toEqual([
      userMessage,
      expect.objectContaining({
        role: 'error',
        content: '文件不存在或已被移动：/tmp/missing.md',
        parts: [expect.objectContaining({ type: 'error', text: '文件不存在或已被移动：/tmp/missing.md' })],
        loading: false,
        finished: true
      })
    ]);
    expect(persistedMessages).toEqual(loadedMessages);
  });

  it('finalizes every pending tool part when the terminal message update is missing', (): void => {
    const message = createMessage({
      role: 'assistant',
      content: 'partial answer',
      loading: true,
      finished: false,
      parts: [
        {
          id: 'tool-inputting',
          type: 'tool',
          toolCallId: 'tool-call-inputting',
          toolName: 'read_file',
          status: 'inputting',
          input: null,
          inputText: '{"path":"'
        },
        {
          id: 'tool-awaiting',
          type: 'tool',
          toolCallId: 'tool-call-awaiting',
          toolName: 'question',
          status: 'done',
          input: {},
          result: {
            toolName: 'question',
            status: 'awaiting_user_input',
            data: {
              questionId: 'question-1',
              toolCallId: 'tool-call-awaiting',
              question: '继续吗？',
              mode: 'single',
              options: [{ label: '继续', value: 'yes' }]
            }
          }
        },
        {
          id: 'tool-success',
          type: 'tool',
          toolCallId: 'tool-call-success',
          toolName: 'read_file',
          status: 'done',
          input: {},
          result: { toolName: 'read_file', status: 'success', data: { content: 'done' } }
        }
      ]
    });

    finalizeFailedMessage(message, { code: 'REQUEST_FAILED', message: '模型调用失败' });

    expect(message).toMatchObject({ content: 'partial answer\n模型调用失败', loading: false, finished: true });
    expect(message.parts[0]).toMatchObject({
      status: 'done',
      result: { status: 'failure', error: { code: 'EXECUTION_FAILED', message: '模型调用失败' } }
    });
    expect(message.parts[0]).not.toHaveProperty('inputText');
    expect(message.parts[1]).toMatchObject({
      status: 'done',
      result: { status: 'failure', error: { code: 'EXECUTION_FAILED', message: '模型调用失败' } }
    });
    expect(message.parts[2]).toMatchObject({ result: { status: 'success' } });
    expect(message.parts.some((part) => part.type === 'error')).toBe(false);
  });
});
