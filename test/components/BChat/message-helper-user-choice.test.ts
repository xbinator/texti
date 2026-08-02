/**
 * @file message-helper-user-choice.test.ts
 * @description BChat 用户选择消息辅助函数测试。
 */
import { describe, expect, it } from 'vitest';
import { userChoice } from '@/components/BChat/utils/messageHelper';
import type { Message } from '@/components/BChat/utils/types';

/**
 * 创建等待用户选择的 assistant 消息。
 * @returns 等待用户选择消息
 */
function createAwaitingChoiceMessage(): Message {
  return {
    id: 'assistant-1',
    role: 'assistant',
    content: '',
    parts: [
      {
        id: 'part-question',
        type: 'tool',
        toolCallId: 'tool-call-question',
        toolName: 'question',
        status: 'done',
        input: { question: '继续吗？' },
        result: {
          toolName: 'question',
          status: 'awaiting_user_input',
          data: {
            questionId: 'question-1',
            toolCallId: 'tool-call-question',
            question: '继续吗？',
            mode: 'single',
            options: [{ label: '继续', value: 'yes' }]
          }
        }
      }
    ],
    createdAt: '2026-07-13T00:00:00.000Z',
    loading: true,
    finished: false
  };
}

describe('message helper user choice', (): void => {
  it('applies input-mode text answers as success', (): void => {
    const message = createAwaitingChoiceMessage();

    const submitted = userChoice.submitAnswer([message], {
      questionId: 'question-1',
      toolCallId: 'tool-call-question',
      answers: [],
      questionAnswers: [{ question: '继续吗？', answers: [], text: '自定义回复' }],
      otherText: ''
    });

    expect(submitted).toBe(true);
    expect(message.parts[0]).toMatchObject({
      result: {
        toolName: 'question',
        status: 'success',
        data: {
          questionId: 'question-1',
          answers: [],
          questionAnswers: [{ question: '继续吗？', answers: [], text: '自定义回复' }],
          otherText: ''
        }
      }
    });
  });

  it('finishes an awaiting message when the user actively aborts it', (): void => {
    const message = createAwaitingChoiceMessage();

    expect(userChoice.cancelPending([message])).toBe(message);
    expect(message).toMatchObject({
      loading: false,
      finished: true,
      parts: [
        expect.objectContaining({
          result: {
            toolName: 'question',
            status: 'cancelled',
            error: { code: 'USER_CANCELLED', message: '用户中止了操作' }
          }
        })
      ]
    });
  });
});
