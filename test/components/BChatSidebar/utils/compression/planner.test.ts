/**
 * @file planner.test.ts
 * @description Planner 模块测试：消息保留规则切分、未完成交互识别。
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

/**
 * 创建带工具调用的 assistant 消息。
 */
function makeToolCallMsg(id: string, toolCallId: string, toolName: string, hasResult = true): Message {
  const parts: Message['parts'] = [{ type: 'tool-call', toolCallId, toolName, input: {} }];
  if (hasResult) {
    parts.push({
      type: 'tool-result',
      toolCallId,
      toolName,
      result: { status: 'success', data: {} } as never
    });
  }
  return makeMsg({ id, role: 'assistant', content: 'tool call', parts });
}

/**
 * 创建含等待用户选择的工具结果消息。
 */
function makeAwaitingUserChoiceMsg(id: string): Message {
  return makeMsg({
    id,
    role: 'assistant',
    content: 'awaiting choice',
    parts: [
      {
        type: 'tool-result',
        toolCallId: 'tc-choice',
        toolName: 'ask_user_choice',
        result: { status: 'awaiting_user_input', data: { questionId: 'q1', question: 'choose' } } as never
      }
    ]
  });
}

/**
 * 创建含未完成确认卡片的消息。
 */
function makePendingConfirmationMsg(id: string): Message {
  return makeMsg({
    id,
    role: 'assistant',
    content: 'pending confirmation',
    parts: [
      {
        type: 'confirmation',
        confirmationId: 'cf-1',
        toolName: 'write_file',
        title: 'Write file?',
        description: 'Need confirmation',
        riskLevel: 'write',
        confirmationStatus: 'pending',
        executionStatus: 'idle'
      } as never
    ]
  });
}

describe('planner - classifyMessages', () => {
  it('preserves messages with unfinished tool calls (no tool-result)', async () => {
    const { planCompression } = await import('@/components/BChatSidebar/utils/compression/planner');
    const msg = makeToolCallMsg('m1', 'tc-1', 'read', false);
    const messages: Message[] = [msg];

    const result = planCompression(messages, 0);
    expect(result.preservedMessages).toContain(msg);
    expect(result.compressibleMessages).not.toContain(msg);
  });

  it('does not preserve messages with completed tool calls', async () => {
    const { planCompression } = await import('@/components/BChatSidebar/utils/compression/planner');
    const msg = makeToolCallMsg('m1', 'tc-1', 'read', true);
    const messages: Message[] = [msg];

    const result = planCompression(messages, 0);
    expect(result.preservedMessages).not.toContain(msg);
  });

  it('preserves messages with awaiting user choice', async () => {
    const { planCompression } = await import('@/components/BChatSidebar/utils/compression/planner');
    const msg = makeAwaitingUserChoiceMsg('m1');
    const messages: Message[] = [msg];

    const result = planCompression(messages, 0);
    expect(result.preservedMessages).toContain(msg);
  });

  it('preserves messages with pending confirmation card', async () => {
    const { planCompression } = await import('@/components/BChatSidebar/utils/compression/planner');
    const msg = makePendingConfirmationMsg('m1');
    const messages: Message[] = [msg];

    const result = planCompression(messages, 0);
    expect(result.preservedMessages).toContain(msg);
  });

  it('preserves recent messages within the preserve window', async () => {
    const { planCompression } = await import('@/components/BChatSidebar/utils/compression/planner');
    const messages: Message[] = [
      makeMsg({ id: 'm1', role: 'user', content: 'old msg 1' }),
      makeMsg({ id: 'm2', role: 'assistant', content: 'old reply 1' }),
      makeMsg({ id: 'm3', role: 'user', content: 'recent msg' }),
      makeMsg({ id: 'm4', role: 'assistant', content: 'recent reply' })
    ];

    // 保留最近 2 轮（即 4 条 user+assistant 消息）
    const result = planCompression(messages, 2);
    expect(result.preservedMessages).toHaveLength(4);
    expect(result.compressibleMessages).toHaveLength(0);
  });

  it('classifies old messages as compressible', async () => {
    const { planCompression } = await import('@/components/BChatSidebar/utils/compression/planner');
    const messages: Message[] = [
      makeMsg({ id: 'm1', role: 'user', content: 'old msg 1' }),
      makeMsg({ id: 'm2', role: 'assistant', content: 'old reply 1' }),
      makeMsg({ id: 'm3', role: 'user', content: 'old msg 2' }),
      makeMsg({ id: 'm4', role: 'assistant', content: 'old reply 2' }),
      makeMsg({ id: 'm5', role: 'user', content: 'recent msg' }),
      makeMsg({ id: 'm6', role: 'assistant', content: 'recent reply' })
    ];

    // 保留最近 2 轮（即 4 条），m1-m2 应被标记为可压缩
    const result = planCompression(messages, 2);
    expect(result.compressibleMessages.length).toBeGreaterThan(0);
    expect(result.compressibleMessages).toContain(messages[0]); // m1
  });

  it('excludes current user message from compressible', async () => {
    const { planCompression } = await import('@/components/BChatSidebar/utils/compression/planner');
    const currentMsg = makeMsg({ id: 'current', role: 'user', content: 'current question' });
    const messages: Message[] = [
      makeMsg({ id: 'm1', role: 'user', content: 'old msg' }),
      makeMsg({ id: 'm2', role: 'assistant', content: 'old reply' }),
      currentMsg
    ];

    const result = planCompression(messages, 1, currentMsg.id, [currentMsg.id]);
    expect(result.compressibleMessages).not.toContain(currentMsg);
    expect(result.preservedMessages).not.toContain(currentMsg);
  });

  it('identifies preservedMessageIds for unfinished interactions in compressible range', async () => {
    const { planCompression } = await import('@/components/BChatSidebar/utils/compression/planner');
    const pendingMsg = makePendingConfirmationMsg('m2');
    const messages: Message[] = [
      makeMsg({ id: 'm1', role: 'user', content: 'old msg' }),
      pendingMsg, // 位于可压缩区间但含未完成确认
      makeMsg({ id: 'm3', role: 'user', content: 'recent msg' }),
      makeMsg({ id: 'm4', role: 'assistant', content: 'recent reply' })
    ];

    // 保留最近 1 轮（2 条），m1-m2 在可压缩区间
    const result = planCompression(messages, 1);
    // m2 有未完成确认，应放入 preservedMessageIds
    expect(result.preservedMessageIds).toContain('m2');
    expect(result.preservedMessages).toContain(pendingMsg);
  });

  it('does not preserve completed confirmations', async () => {
    const { planCompression } = await import('@/components/BChatSidebar/utils/compression/planner');
    const completedMsg = makeMsg({
      id: 'm1',
      role: 'assistant',
      content: 'done',
      parts: [
        {
          type: 'confirmation',
          confirmationId: 'cf-1',
          toolName: 'write_file',
          title: 'Write file?',
          description: 'Need confirmation',
          riskLevel: 'write',
          confirmationStatus: 'approved',
          executionStatus: 'success'
        } as never
      ]
    });
    // Need enough messages so m1 falls outside the recent window
    const messages: Message[] = [
      completedMsg,
      makeMsg({ id: 'm2', role: 'user', content: 'm2' }),
      makeMsg({ id: 'm3', role: 'assistant', content: 'm3' }),
      makeMsg({ id: 'm4', role: 'user', content: 'recent msg' }),
      makeMsg({ id: 'm5', role: 'assistant', content: 'recent reply' })
    ];

    // Preserve 1 round (2 messages), m1 falls in older section
    const result = planCompression(messages, 1);
    // Completed confirmation should be compressible, not preserved
    expect(result.preservedMessages).not.toContain(completedMsg);
    expect(result.compressibleMessages).toContain(completedMsg);
  });
});
