/**
 * @file runtime-error.test.ts
 * @description ChatRuntime 错误处理与中文展示测试。
 */
import { describe, expect, it } from 'vitest';
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
});
