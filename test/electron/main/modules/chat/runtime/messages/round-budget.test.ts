/**
 * @file round-budget.test.ts
 * @description ChatRuntime 连续模型步骤预算提示测试。
 */
import type { AIUserChoiceAnswerData, ChatMessageRecord } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { appendRoundBudgetPrompt, isRoundBudgetStop } from '../../../../../../../electron/main/modules/chat/runtime/messages/round-budget.mjs';

/**
 * 创建空 Assistant 消息。
 * @returns 可追加预算问题的消息
 */
function createAssistant(): ChatMessageRecord {
  return {
    id: 'assistant-budget',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    parts: [],
    createdAt: '2026-08-10T00:00:00.000Z',
    loading: false,
    finished: true
  };
}

describe('runtime round budget prompt', (): void => {
  it('appends a valid recoverable question after the round budget is exhausted', (): void => {
    const message = createAssistant();
    let sequence = 0;

    appendRoundBudgetPrompt(message, (): string => `id-${sequence++}`);

    expect(message).toMatchObject({ loading: true, finished: false });
    expect(message.parts).toEqual([
      expect.objectContaining({
        id: 'id-2',
        type: 'tool',
        toolCallId: 'runtime-round-budget-id-0',
        toolName: 'question',
        status: 'done',
        result: expect.objectContaining({
          status: 'awaiting_user_input',
          data: expect.objectContaining({
            questionId: 'runtime-round-question-id-1',
            options: [
              { label: '继续', value: 'continue' },
              { label: '停止', value: 'stop' }
            ]
          })
        })
      })
    ]);
  });

  it.each([
    { answers: ['stop'], expected: true },
    { answers: [], expected: true },
    { answers: ['continue'], expected: false }
  ])('recognizes whether the synthetic prompt should stop: $answers', ({ answers, expected }): void => {
    const message = createAssistant();
    let sequence = 0;
    appendRoundBudgetPrompt(message, (): string => `id-${sequence++}`);
    const part = message.parts[0];
    if (part?.type !== 'tool' || part.result?.status !== 'awaiting_user_input') throw new Error('Round budget prompt was not created');
    const answer: AIUserChoiceAnswerData = {
      questionId: part.result.data.questionId,
      toolCallId: part.toolCallId,
      answers
    };

    expect(isRoundBudgetStop(message, answer)).toBe(expected);
  });
});
