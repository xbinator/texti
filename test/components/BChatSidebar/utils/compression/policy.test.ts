/**
 * @file policy.test.ts
 * @description Policy 模块测试：双阈值判断、上下文字符体积估算。
 */
import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import type { ConversationSummaryRecord } from '@/components/BChatSidebar/utils/compression/types';
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

/**
 * 创建测试用摘要记录。
 */
function makeSummary(overrides: Partial<ConversationSummaryRecord> = {}): ConversationSummaryRecord {
  return {
    id: 'summary-1',
    sessionId: 'session-1',
    buildMode: 'incremental',
    coveredStartMessageId: 'm1',
    coveredEndMessageId: 'm10',
    coveredUntilMessageId: 'm10',
    sourceMessageIds: ['m1'],
    preservedMessageIds: [],
    summaryText: '',
    structuredSummary: {
      goal: 'Test',
      recentTopic: 'Testing',
      userPreferences: [],
      constraints: [],
      decisions: [],
      importantFacts: [],
      fileContext: [],
      openQuestions: [],
      pendingActions: []
    },
    triggerReason: 'message_count',
    messageCountSnapshot: 10,
    charCountSnapshot: 2000,
    schemaVersion: 1,
    status: 'valid',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

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

describe('evaluateCompression with effective context', () => {
  it('counts summary overhead and preserved passthrough messages when evaluating compression', async () => {
    const { evaluateCompression } = await import('@/components/BChatSidebar/utils/compression/policy');

    // 摘要注入开销 + preserved passthrough 消息应被计入 charCount
    const summary = makeSummary({
      coveredUntilMessageId: 'm10',
      preservedMessageIds: ['m11'],
      summaryText: 'S'.repeat(5000)
    });
    const messages: Message[] = [
      makeMsg({ id: 'm11', role: 'assistant', content: 'P'.repeat(10000), parts: [{ type: 'text', text: 'P'.repeat(10000) } as never] }),
      makeMsg({ id: 'm12', role: 'user', content: 'recent', parts: [{ type: 'text', text: 'recent' } as never] })
    ];

    const result = evaluateCompression(messages, summary);
    // 有效上下文包含：summary 系统消息(5000+) + preserved m11(10000+) + recent m12(6)
    // 所以至少 15000
    expect(result.charCount).toBeGreaterThanOrEqual(15000);
    expect(result.shouldCompress).toBe(true);
  });

  it('includes summary overhead in charCount when summary exists', async () => {
    const { evaluateCompression } = await import('@/components/BChatSidebar/utils/compression/policy');

    const summary = makeSummary({
      coveredUntilMessageId: 'm5',
      preservedMessageIds: [],
      summaryText: 'A'.repeat(3000)
    });
    const messages: Message[] = [
      makeMsg({ id: 'm1', role: 'user', content: 'hello', parts: [{ type: 'text', text: 'hello' } as never] }),
      makeMsg({ id: 'm2', role: 'assistant', content: 'hi', parts: [{ type: 'text', text: 'hi' } as never] }),
      makeMsg({ id: 'm3', role: 'user', content: 'hello', parts: [{ type: 'text', text: 'hello' } as never] }),
      makeMsg({ id: 'm4', role: 'assistant', content: 'hi', parts: [{ type: 'text', text: 'hi' } as never] }),
      makeMsg({ id: 'm5', role: 'user', content: 'hello', parts: [{ type: 'text', text: 'hello' } as never] }),
      makeMsg({ id: 'm6', role: 'assistant', content: 'R'.repeat(25000), parts: [{ type: 'text', text: 'R'.repeat(25000) } as never] })
    ];

    const result = evaluateCompression(messages, summary);
    // summary 系统消息(~3000) + recent m6(25000)
    expect(result.charCount).toBeGreaterThanOrEqual(28000);
    expect(result.shouldCompress).toBe(true);
  });
});
