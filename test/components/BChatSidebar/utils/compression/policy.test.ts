/**
 * @file policy.test.ts
 * @description Policy 模块测试：双阈值判断、上下文字符体积估算。
 */
import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';

describe('estimateContextSize', () => {
  /**
   * 测试 estimateContextSize 函数 - 计算 ModelMessage[] 的字符体积
   * RED 阶段：函数尚未实现
   */
  it('returns 0 for empty messages', async () => {
    const { estimateContextSize } = await import('@/components/BChatSidebar/utils/compression/policy');
    const modelMessages: ModelMessage[] = [];
    expect(estimateContextSize(modelMessages)).toBe(0);
  });

  it('counts characters in string content messages', async () => {
    const { estimateContextSize } = await import('@/components/BChatSidebar/utils/compression/policy');
    const modelMessages: ModelMessage[] = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there' }
    ];
    // 'Hello' = 5, 'Hi there' = 8, total = 13
    expect(estimateContextSize(modelMessages)).toBe(13);
  });

  it('counts characters in array content messages', async () => {
    const { estimateContextSize } = await import('@/components/BChatSidebar/utils/compression/policy');
    const modelMessages: ModelMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' }
        ]
      }
    ];
    // Array content parts are JSON-serialized for estimation
    const size = estimateContextSize(modelMessages);
    expect(size).toBeGreaterThan(0);
  });

  it('counts tool-call and tool-result content', async () => {
    const { estimateContextSize } = await import('@/components/BChatSidebar/utils/compression/policy');
    const modelMessages: ModelMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Using tool' },
          { type: 'tool-call' as never, toolCallId: 't1', toolName: 'read', input: { path: '/a' } }
        ]
      },
      {
        role: 'tool' as never,
        content: [
          {
            type: 'tool-result' as never,
            toolCallId: 't1',
            toolName: 'read',
            output: { type: 'json' as never, value: { data: 'result content' } }
          }
        ]
      }
    ];
    // Should count: 'Using tool' (10) + tool-call JSON (toolName+input) + tool-result JSON
    const size = estimateContextSize(modelMessages);
    expect(size).toBeGreaterThan(0);
  });

  it('handles messages with mixed content types', async () => {
    const { estimateContextSize } = await import('@/components/BChatSidebar/utils/compression/policy');
    const modelMessages: ModelMessage[] = [
      { role: 'system', content: 'System prompt here' },
      { role: 'user', content: 'User question' },
      { role: 'assistant', content: 'Assistant answer' }
    ];
    const size = estimateContextSize(modelMessages);
    expect(size).toBeGreaterThan(40); // 'System prompt here' + 'User question' + 'Assistant answer'
  });
});
