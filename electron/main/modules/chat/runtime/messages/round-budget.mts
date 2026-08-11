/**
 * @file round-budget.mts
 * @description ChatRuntime 连续模型步骤预算的可恢复用户确认消息。
 */
import type { AIUserChoiceAnswerData, ChatMessageRecord } from 'types/chat';

/** 连续步骤预算工具调用的稳定 ID 前缀。 */
const ROUND_BUDGET_TOOL_PREFIX = 'runtime-round-budget-';

/**
 * 在 Assistant 尾部追加一个结构合法的续轮预算确认问题。
 * @param message - 已达到连续步骤预算的 Assistant
 * @param createId - 唯一 ID 生成器
 */
export function appendRoundBudgetPrompt(message: ChatMessageRecord, createId: () => string): void {
  const toolCallId = `${ROUND_BUDGET_TOOL_PREFIX}${createId()}`;
  const questionId = `runtime-round-question-${createId()}`;
  const question = '本次任务已连续执行 32 个模型步骤，是否继续？';
  const options = [
    { label: '继续', value: 'continue' },
    { label: '停止', value: 'stop' }
  ];
  message.parts.push({
    id: createId(),
    type: 'tool',
    toolCallId,
    toolName: 'question',
    status: 'done',
    input: { question, mode: 'single', options },
    result: {
      toolName: 'question',
      status: 'awaiting_user_input',
      data: { questionId, toolCallId, question, mode: 'single', options }
    }
  });
  message.loading = true;
  message.finished = false;
}

/**
 * 判断用户是否要求结束由步骤预算产生的暂停。
 * @param message - 含等待问题的 Assistant
 * @param answer - Renderer 提交的用户答案
 * @returns 匹配预算问题且选择停止或取消时返回 true
 */
export function isRoundBudgetStop(message: ChatMessageRecord, answer: AIUserChoiceAnswerData): boolean {
  const matchingPart = message.parts.find(
    (part): boolean =>
      part.type === 'tool' &&
      part.toolCallId === answer.toolCallId &&
      part.toolCallId.startsWith(ROUND_BUDGET_TOOL_PREFIX) &&
      part.result?.status === 'awaiting_user_input' &&
      part.result.data.questionId === answer.questionId
  );
  if (!matchingPart) return false;

  const selectedValues = [...answer.answers, ...(answer.questionAnswers ?? []).flatMap((questionAnswer): string[] => questionAnswer.answers)];
  if (selectedValues.includes('stop')) return true;
  const hasFreeText = Boolean(
    answer.otherText?.trim() || (answer.questionAnswers ?? []).some((questionAnswer): boolean => Boolean(questionAnswer.text?.trim()))
  );
  return selectedValues.length === 0 && !hasFreeText;
}
