/**
 * @file assembler.test.ts
 * @description Assembler 模块测试：上下文组装顺序与摘要注入格式。
 */
import { describe, expect, it } from 'vitest';
import type { ConversationSummaryRecord, StructuredConversationSummary } from '@/components/BChatSidebar/utils/compression/types';
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
function makeSummaryRecord(overrides: Partial<ConversationSummaryRecord> = {}): ConversationSummaryRecord {
  const structuredSummary: StructuredConversationSummary = {
    goal: 'Test goal',
    recentTopic: 'Testing',
    userPreferences: [],
    constraints: [],
    decisions: [],
    importantFacts: [],
    fileContext: [],
    openQuestions: [],
    pendingActions: []
  };

  return {
    id: 'summary-1',
    sessionId: 'session-1',
    buildMode: 'incremental',
    coveredStartMessageId: 'm1',
    coveredEndMessageId: 'm5',
    coveredUntilMessageId: 'm3',
    sourceMessageIds: ['m1', 'm2', 'm3'],
    preservedMessageIds: [],
    summaryText: 'This is a test summary of earlier conversation.',
    structuredSummary,
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

describe('assembler - assembleContext', () => {
  it('assembles messages in correct order: system prompt, summary, preserved, recent, current', async () => {
    const { assembleContext } = await import('@/components/BChatSidebar/utils/compression/assembler');

    const summaryRecord = makeSummaryRecord({ coveredUntilMessageId: 'm3' });
    const preservedMessages: Message[] = [
      makeMsg({ id: 'm4', role: 'user', content: 'pending question', parts: [{ type: 'text', text: 'pending question' } as never] })
    ];
    const recentMessages: Message[] = [
      makeMsg({ id: 'm5', role: 'user', content: 'recent user msg', parts: [{ type: 'text', text: 'recent user msg' } as never] }),
      makeMsg({ id: 'm6', role: 'assistant', content: 'recent assistant reply', parts: [{ type: 'text', text: 'recent assistant reply' } as never] })
    ];
    const currentUserMessage = makeMsg({ id: 'm7', role: 'user', content: 'current question', parts: [{ type: 'text', text: 'current question' } as never] });

    const result = assembleContext({
      systemPrompt: 'You are a helpful assistant.',
      summaryRecord,
      preservedMessages,
      recentMessages,
      currentUserMessage
    });

    // System prompt, summary system message, 1 preserved, 2 recent (user+assistant), 1 current user
    expect(result.modelMessages.length).toBe(6);
    // First: system prompt
    expect(result.modelMessages[0].role).toBe('system');
    expect(result.modelMessages[0].content).toBe('You are a helpful assistant.');
    // Second: summary as system message
    expect(result.modelMessages[1].role).toBe('system');
    expect(typeof result.modelMessages[1].content).toBe('string');
    expect(result.modelMessages[1].content as string).toContain('conversation_summary');
    // Third: preserved message (user)
    expect(result.modelMessages[2].role).toBe('user');
    // Fourth: recent user
    expect(result.modelMessages[3].role).toBe('user');
    // Fifth: recent assistant
    expect(result.modelMessages[4].role).toBe('assistant');
    // Last: current user
    expect(result.modelMessages[5].role).toBe('user');
  });

  it('injects summary as system message with priority declaration', async () => {
    const { assembleContext } = await import('@/components/BChatSidebar/utils/compression/assembler');

    const summaryRecord = makeSummaryRecord();
    const currentUserMessage = makeMsg({ id: 'm1', role: 'user', content: 'hello' });

    const result = assembleContext({
      summaryRecord,
      preservedMessages: [],
      recentMessages: [],
      currentUserMessage
    });

    // Summary should be a system message
    const summaryMsg = result.modelMessages[0];
    expect(summaryMsg.role).toBe('system');
    const content = summaryMsg.content as string;
    // Should have the priority disclaimer
    expect(content).toContain('较早历史的压缩摘要');
    // Should contain the summary text
    expect(content).toContain('conversation_summary');
    expect(content).toContain(summaryRecord.summaryText);
  });

  it('handles no summary record (normal flow)', async () => {
    const { assembleContext } = await import('@/components/BChatSidebar/utils/compression/assembler');

    const currentUserMessage = makeMsg({ id: 'm3', role: 'user', content: 'hello', parts: [{ type: 'text', text: 'hello' } as never] });
    const recentMessages: Message[] = [
      makeMsg({ id: 'm1', role: 'user', content: 'previous question', parts: [{ type: 'text', text: 'previous question' } as never] }),
      makeMsg({ id: 'm2', role: 'assistant', content: 'previous answer', parts: [{ type: 'text', text: 'previous answer' } as never] })
    ];

    const result = assembleContext({
      systemPrompt: 'You are helpful.',
      preservedMessages: [],
      recentMessages,
      currentUserMessage
    });

    // Should only have recent messages + current user + system prompt
    expect(result.modelMessages.length).toBe(4);
    expect(result.modelMessages[0].role).toBe('system');
    expect(result.modelMessages[1].role).toBe('user');
    expect(result.modelMessages[2].role).toBe('assistant');
    expect(result.modelMessages[3].role).toBe('user');
  });

  it('preserved messages come before recent messages', async () => {
    const { assembleContext } = await import('@/components/BChatSidebar/utils/compression/assembler');

    const summaryRecord = makeSummaryRecord();
    const preservedMessages: Message[] = [makeMsg({ id: 'p1', role: 'assistant', content: 'preserved tool call' })];
    const recentMessages: Message[] = [makeMsg({ id: 'r1', role: 'user', content: 'recent msg' })];
    const currentUserMessage = makeMsg({ id: 'c1', role: 'user', content: 'current' });

    const result = assembleContext({
      summaryRecord,
      preservedMessages,
      recentMessages,
      currentUserMessage
    });

    // Find indices
    const preservedIdx = result.modelMessages.findIndex((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes('preserved'));
    const recentIdx = result.modelMessages.findIndex((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('recent'));
    const currentIdx = result.modelMessages.findIndex((m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('current'));

    expect(preservedIdx).toBeLessThan(recentIdx);
    expect(recentIdx).toBeLessThan(currentIdx);
  });

  it('handles empty preserved and empty recent messages', async () => {
    const { assembleContext } = await import('@/components/BChatSidebar/utils/compression/assembler');

    const currentUserMessage = makeMsg({ id: 'm1', role: 'user', content: 'only message' });

    const result = assembleContext({
      preservedMessages: [],
      recentMessages: [],
      currentUserMessage
    });

    expect(result.modelMessages.length).toBe(1);
    expect(result.modelMessages[0].role).toBe('user');
    expect(result.modelMessages[0].content).toBe('only message');
  });

  it('current user message is always the last message', async () => {
    const { assembleContext } = await import('@/components/BChatSidebar/utils/compression/assembler');

    const summaryRecord = makeSummaryRecord();
    const recentMessages: Message[] = [makeMsg({ id: 'm1', role: 'user', content: 'msg1' }), makeMsg({ id: 'm2', role: 'assistant', content: 'msg2' })];
    const currentUserMessage = makeMsg({ id: 'current', role: 'user', content: 'current' });

    const result = assembleContext({
      summaryRecord,
      preservedMessages: [],
      recentMessages,
      currentUserMessage
    });

    const lastMsg = result.modelMessages[result.modelMessages.length - 1];
    expect(lastMsg.role).toBe('user');
    expect(lastMsg.content).toBe('current');
  });
});
