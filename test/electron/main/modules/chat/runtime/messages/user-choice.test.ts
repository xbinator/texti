/**
 * @file user-choice.test.ts
 * @description ChatRuntime 用户选择消息辅助函数测试。
 */
import type { AIUserChoiceAnswerData, ChatMessageRecord } from 'types/chat';
import { describe, expect, it } from 'vitest';
import { applyUserChoiceAnswer } from '../../../../../../../electron/main/modules/chat/runtime/messages/user-choice.mjs';

/**
 * 创建等待用户选择的 assistant 消息。
 * @returns assistant 消息
 */
function createAwaitingChoiceMessage(): ChatMessageRecord {
  return {
    id: 'assistant-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    parts: [
      {
        id: 'part0061',
        type: 'tool',
        toolCallId: 'tool-call-1',
        toolName: 'ask_user_choice',
        status: 'done',
        input: { question: '继续吗？' },
        result: {
          toolName: 'ask_user_choice',
          status: 'awaiting_user_input',
          data: {
            questionId: 'question-1',
            toolCallId: 'tool-call-1',
            question: '继续吗？',
            mode: 'single',
            options: [{ label: '继续', value: 'yes' }]
          }
        }
      }
    ],
    createdAt: '2026-06-19T00:00:00.000Z',
    finished: false,
    loading: false
  };
}

describe('user-choice message helpers', () => {
  it('marks input-mode text answers as success instead of cancelled', (): void => {
    const assistantMessage = createAwaitingChoiceMessage();
    const answer: AIUserChoiceAnswerData = {
      questionId: 'question-1',
      toolCallId: 'tool-call-1',
      answers: [],
      questionAnswers: [{ question: '继续吗？', answers: [], text: '自定义回复' }]
    };

    const updatedMessage = applyUserChoiceAnswer([assistantMessage], answer);

    expect(updatedMessage).toBe(assistantMessage);
    expect(assistantMessage.parts[0]).toMatchObject({
      type: 'tool',
      result: {
        toolName: 'ask_user_choice',
        status: 'success',
        data: answer
      }
    });
  });

  it('marks awaiting user choice tool result as cancelled when answer is empty', (): void => {
    const assistantMessage = createAwaitingChoiceMessage();
    const answer: AIUserChoiceAnswerData = {
      questionId: 'question-1',
      toolCallId: 'tool-call-1',
      answers: []
    };

    const updatedMessage = applyUserChoiceAnswer([assistantMessage], answer);

    expect(updatedMessage).toBe(assistantMessage);
    expect(assistantMessage.parts[0]).toMatchObject({
      type: 'tool',
      result: {
        toolName: 'ask_user_choice',
        status: 'cancelled',
        error: { code: 'USER_CANCELLED', message: '用户取消了选择' }
      }
    });
  });
});
