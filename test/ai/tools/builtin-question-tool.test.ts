/**
 * @file builtin-question-tool.test.ts
 * @description question 工具输入框模式校验与载荷测试。
 */
import type { AIAwaitingUserChoiceQuestion, AIToolExecutionResult } from 'types/ai';
import { describe, expect, it } from 'vitest';
import { createQuestionTool } from '@/ai/tools/builtin/QuestionTool';

/**
 * 创建可独立执行的 question 工具。
 * @returns 测试用 question 工具
 */
function createTool() {
  return createQuestionTool({
    getPendingQuestion: () => null,
    createQuestionId: () => 'question-1'
  });
}

/**
 * 断言工具结果处于等待用户输入状态并返回问题载荷。
 * @param result - 工具执行结果
 * @returns 等待用户输入的问题载荷
 */
function expectAwaitingQuestion(result: AIToolExecutionResult<AIAwaitingUserChoiceQuestion>): AIAwaitingUserChoiceQuestion {
  expect(result.status).toBe('awaiting_user_input');
  if (result.status !== 'awaiting_user_input') {
    throw new Error('unexpected result status');
  }
  return result.data;
}

describe('question tool input mode', (): void => {
  it('accepts an input-mode question without options and keeps the placeholder', async (): Promise<void> => {
    const tool = createTool();

    const data = expectAwaitingQuestion(await tool.execute({ question: '请描述你的需求', mode: 'input', placeholder: '例如：接入支付宝支付' }));

    expect(data).toMatchObject({
      questionId: 'question-1',
      question: '请描述你的需求',
      mode: 'input',
      options: [],
      placeholder: '例如：接入支付宝支付'
    });
  });

  it('supports input-mode questions in batch payloads', async (): Promise<void> => {
    const tool = createTool();

    const data = expectAwaitingQuestion(
      await tool.execute({
        questions: [
          { question: '选择支付方式', mode: 'single', options: [{ label: '微信', value: 'wechat' }] },
          { question: '请输入收货地址', mode: 'input', placeholder: '省市区 + 详细地址' }
        ]
      })
    );

    expect(data.mode).toBe('single');
    expect(data.questions).toHaveLength(2);
    expect(data.questions?.[1]).toMatchObject({
      question: '请输入收货地址',
      mode: 'input',
      options: [],
      placeholder: '省市区 + 详细地址'
    });
  });

  it('rejects input-mode questions that provide options', async (): Promise<void> => {
    const tool = createTool();

    const result = await tool.execute({
      question: '请选择或输入',
      mode: 'input',
      options: [{ label: '选项', value: 'option' }]
    });

    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.error.message).toContain('输入模式不能提供可选项');
    }
  });

  it('rejects input-mode questions that set maxSelections', async (): Promise<void> => {
    const tool = createTool();

    const result = await tool.execute({ question: '请输入', mode: 'input', maxSelections: 2 });

    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.error.message).toContain('输入问题不能设置 maxSelections');
    }
  });

  it('still requires options for single/multiple modes', async (): Promise<void> => {
    const tool = createTool();

    const result = await tool.execute({ question: '请选择', mode: 'single' });

    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.error.message).toBe('至少需要提供一个可选项。');
    }
  });

  it('exposes input mode and placeholder in the tool definition schema', (): void => {
    const { properties } = createTool().definition.parameters;

    expect(properties.mode).toMatchObject({ enum: ['single', 'multiple', 'input'] });
    expect(properties.placeholder).toBeDefined();

    const questionsSchema = properties.questions as { items: { required: string[] } };
    expect(questionsSchema.items.required).toEqual(['question', 'mode']);
  });
});
