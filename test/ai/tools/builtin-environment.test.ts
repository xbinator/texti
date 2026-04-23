/**
 * @file builtin-environment.test.ts
 * @description 内置环境工具测试。
 */
import type { AIToolContext } from 'types/ai';
import { describe, expect, it } from 'vitest';
import { createBuiltinEnvironmentTools } from '@/ai/tools/builtin/environment';

/**
 * 创建环境工具测试上下文。
 * @returns AI 工具上下文
 */
function createContext(): AIToolContext {
  return {
    document: {
      id: 'doc-1',
      title: 'My Note',
      path: '/tmp/my-note.md',
      getContent: () => 'alpha beta'
    },
    editor: {
      getSelection: () => ({ from: 0, to: 0, text: '' }),
      insertAtCursor: async () => undefined,
      replaceSelection: async () => undefined,
      replaceDocument: async () => undefined
    }
  };
}

describe('built-in environment tools', () => {
  it('reads the current time', async () => {
    const tools = createBuiltinEnvironmentTools();
    const result = await tools.getCurrentTime.execute({}, createContext());

    expect(result.status).toBe('success');
    if (result.status !== 'success') {
      throw new Error('Expected get_current_time to succeed');
    }

    expect(result.data).toEqual({
      iso: expect.any(String),
      timestamp: expect.any(Number),
      locale: expect.any(String)
    });
    expect(new Date(result.data.iso).toISOString()).toBe(result.data.iso);
  });
});
