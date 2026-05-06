/**
 * @file summarizer.test.ts
 * @description Summarizer 模块测试：规则裁剪逻辑。
 */
import { describe, expect, it } from 'vitest';
import type { Message } from '@/components/BChatSidebar/utils/types';

/**
 * 创建测试用基础消息。
 */
function makeMsg(overrides: Partial<Message> & { id: string }): Message {
  return {
    role: 'user',
    content: '',
    parts: [],
    loading: false,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

describe('summarizer - ruleTrim', () => {
  it('removes empty assistant placeholder messages', async () => {
    const { ruleTrim } = await import('@/components/BChatSidebar/utils/compression/summarizer');
    const messages: Message[] = [
      makeMsg({ id: 'm1', role: 'user', content: 'Hello' }),
      makeMsg({ id: 'm2', role: 'assistant', content: '', parts: [], loading: true }),
      makeMsg({ id: 'm3', role: 'user', content: 'World' })
    ];

    const result = ruleTrim(messages);
    const ids = result.items.map((i) => i.messageId);
    expect(ids).not.toContain('m2');
    expect(ids).toContain('m1');
    expect(ids).toContain('m3');
  });

  it('preserves normal text messages', async () => {
    const { ruleTrim } = await import('@/components/BChatSidebar/utils/compression/summarizer');
    const messages: Message[] = [makeMsg({ id: 'm1', role: 'user', content: 'Hello' }), makeMsg({ id: 'm2', role: 'assistant', content: 'Hi there' })];

    const result = ruleTrim(messages);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].trimmedText).toBe('Hello');
    expect(result.items[1].trimmedText).toBe('Hi there');
  });

  it('truncates long content to respect input char limit', async () => {
    const { ruleTrim } = await import('@/components/BChatSidebar/utils/compression/summarizer');
    // Create messages with total content exceeding 200 chars
    const longText = 'A'.repeat(150);
    const messages: Message[] = [makeMsg({ id: 'm1', role: 'user', content: longText }), makeMsg({ id: 'm2', role: 'assistant', content: longText })];

    // Use a very small limit
    const result = ruleTrim(messages, 100);
    expect(result.charCount).toBeLessThanOrEqual(150); // Allow some overhead
    expect(result.truncated).toBe(true);
  });

  it('returns charCount for trimmed items', async () => {
    const { ruleTrim } = await import('@/components/BChatSidebar/utils/compression/summarizer');
    const messages: Message[] = [makeMsg({ id: 'm1', role: 'user', content: 'Hello' }), makeMsg({ id: 'm2', role: 'assistant', content: 'World' })];

    const result = ruleTrim(messages);
    expect(result.charCount).toBeGreaterThan(0);
    expect(result.truncated).toBe(false);
  });

  it('deduplicates repeated error messages', async () => {
    const { ruleTrim } = await import('@/components/BChatSidebar/utils/compression/summarizer');
    const errorContent = 'Network error occurred';
    const messages: Message[] = [
      makeMsg({ id: 'm1', role: 'user', content: 'do something' }),
      makeMsg({ id: 'm2', role: 'assistant', content: errorContent, parts: [{ type: 'error', text: errorContent } as never] }),
      makeMsg({ id: 'm3', role: 'assistant', content: errorContent, parts: [{ type: 'error', text: errorContent } as never] }),
      makeMsg({ id: 'm4', role: 'assistant', content: errorContent, parts: [{ type: 'error', text: errorContent } as never] })
    ];

    const result = ruleTrim(messages);
    // Should deduplicate consecutive same error assistant messages
    const errorCount = result.items.filter((i) => i.trimmedText.includes('error')).length;
    expect(errorCount).toBe(1);
  });

  it('preserves tool call and result summaries', async () => {
    const { ruleTrim } = await import('@/components/BChatSidebar/utils/compression/summarizer');
    const messages: Message[] = [
      makeMsg({
        id: 'm1',
        role: 'assistant',
        content: 'tool result',
        parts: [
          { type: 'tool-call' as never, toolCallId: 't1', toolName: 'read', input: { path: '/test.ts' } },
          { type: 'tool-result' as never, toolCallId: 't1', toolName: 'read', result: { status: 'success', toolName: 'read', data: 'file content' } }
        ]
      })
    ];

    const result = ruleTrim(messages);
    expect(result.items).toHaveLength(1);
    // Should contain tool name
    expect(result.items[0].trimmedText.toLowerCase()).toMatch(/read/);
  });

  it('compresses long thinking content to key conclusion', async () => {
    const { ruleTrim } = await import('@/components/BChatSidebar/utils/compression/summarizer');
    const longThinking = 'A'.repeat(500);
    const messages: Message[] = [
      makeMsg({
        id: 'm1',
        role: 'assistant',
        content: 'result',
        parts: [{ type: 'thinking' as never, thinking: longThinking }]
      })
    ];

    const result = ruleTrim(messages);
    // Thinking content should be truncated
    const text = result.items[0].trimmedText;
    expect(text.length).toBeLessThan(longThinking.length);
  });

  it('handles empty message list', async () => {
    const { ruleTrim } = await import('@/components/BChatSidebar/utils/compression/summarizer');
    const result = ruleTrim([]);
    expect(result.items).toHaveLength(0);
    expect(result.charCount).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('handles file reference messages with path and intent', async () => {
    const { ruleTrim } = await import('@/components/BChatSidebar/utils/compression/summarizer');
    const messages: Message[] = [
      makeMsg({
        id: 'm1',
        role: 'user',
        content: 'Read this file: src/app.ts lines 1-30',
        references: [
          {
            token: '{{#file:1-30}}',
            path: '/project/src/app.ts',
            selectedContent: 'import React from "react";\nfunction App() {\n  return <div>Hello</div>;\n}',
            fullContent: 'import React from "react";\nfunction App() {\n  return <div>Hello</div>;\n}\n\nexport default App;',
            startLine: 1,
            endLine: 30
          }
        ]
      })
    ];

    const result = ruleTrim(messages);
    expect(result.items).toHaveLength(1);
    const text = result.items[0].trimmedText;
    // Should contain file path
    expect(text).toMatch(/app\.ts/);
    // Should contain line range
    expect(text).toMatch(/1-30/);
  });
});
