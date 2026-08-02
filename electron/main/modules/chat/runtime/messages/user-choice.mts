/**
 * @file user-choice.mts
 * @description ChatRuntime 用户选择消息处理辅助函数。
 */
import type { AIUserChoiceAnswerData, ChatMessageRecord, ChatMessageToolPart } from 'types/chat';

/** 会暂停并等待用户选择的工具名称。 */
export const USER_CHOICE_TOOL_NAMES = new Set(['ask_user_choice', 'ask_user_question', 'question']);

/**
 * 浅克隆消息与 part，便于安全替换 tool result。
 * @param message - 原始消息
 * @returns 克隆后的消息
 */
export function cloneRuntimeMessage(message: ChatMessageRecord): ChatMessageRecord {
  return {
    ...message,
    parts: message.parts.map((part) => ({ ...part }))
  };
}

/**
 * 判断 tool part 是否正在等待用户选择。
 * @param part - 消息片段
 * @param answer - 用户选择答案
 * @returns 是否匹配待提交问题
 */
export function isMatchingAwaitingUserChoicePart(part: ChatMessageRecord['parts'][number], answer: AIUserChoiceAnswerData): part is ChatMessageToolPart {
  return (
    part.type === 'tool' &&
    USER_CHOICE_TOOL_NAMES.has(part.toolName) &&
    part.toolCallId === answer.toolCallId &&
    part.result?.status === 'awaiting_user_input' &&
    part.result.data.questionId === answer.questionId
  );
}

/**
 * 判断用户选择答案是否表示取消。
 * @param answer - 用户选择答案
 * @returns 是否取消
 */
export function isCancelledUserChoiceAnswer(answer: AIUserChoiceAnswerData): boolean {
  const questionAnswers = answer.questionAnswers ?? [];
  return (
    answer.answers.length === 0 && (answer.otherText ?? '') === '' && questionAnswers.every((item) => item.answers.length === 0 && (item.text ?? '') === '')
  );
}

/**
 * 将用户选择答案写入待回答的 assistant tool part。
 * @param messages - 会话消息
 * @param answer - 用户选择答案
 * @returns 被更新的 assistant 消息
 */
export function applyUserChoiceAnswer(messages: ChatMessageRecord[], answer: AIUserChoiceAnswerData): ChatMessageRecord | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const resultPart = message.parts.find((part) => isMatchingAwaitingUserChoicePart(part, answer));
    if (!resultPart) continue;

    resultPart.result = isCancelledUserChoiceAnswer(answer)
      ? { toolName: resultPart.toolName, status: 'cancelled', error: { code: 'USER_CANCELLED', message: '用户取消了选择' } }
      : { toolName: resultPart.toolName, status: 'success', data: answer };
    return message;
  }

  return undefined;
}
