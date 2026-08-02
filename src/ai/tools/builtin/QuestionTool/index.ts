/**
 * @file QuestionTool/index.ts
 * @description 内置 question 工具执行器：暂停工具流程，等待用户回答一个或多个问题后继续。
 */
import type { AIChoiceOption, AIAwaitingUserChoiceItem, AIAwaitingUserChoiceQuestion, AIToolExecutor } from 'types/ai';
import { createAwaitingUserInputResult, createToolFailureResult } from '../../results';

/** 工具共享名称常量。 */
export const QUESTION_TOOL_NAME = 'question';

/** 旧版工具名称，仅用于读取历史会话数据。 */
export const LEGACY_ASK_USER_QUESTION_TOOL_NAME = 'ask_user_question';

/** 执行器接受的最大选项数量。 */
const MAX_CHOICE_OPTIONS = 10;

/**
 * 单个问题输入。
 */
export interface QuestionItemInput {
  /** 向用户展示的问题文本。 */
  question: string;
  /** 题目模式：单选、多选或输入框。 */
  mode: 'single' | 'multiple' | 'input';
  /** 可选项列表（单选/多选必填）。 */
  options?: AIChoiceOption[];
  /** 多选模式下允许选择的最大数量。 */
  maxSelections?: number;
  /** 输入框模式下的占位提示文本。 */
  placeholder?: string;
}

/**
 * 问题工具输入。
 */
export interface QuestionToolInput {
  /** 旧版单问题调用时向用户展示的问题文本。 */
  question?: string;
  /** 旧版单问题调用的选择模式。 */
  mode?: 'single' | 'multiple' | 'input';
  /** 旧版单问题调用的可选项列表。 */
  options?: AIChoiceOption[];
  /** 多选模式下允许选择的最大数量。 */
  maxSelections?: number;
  /** 输入框模式下的占位提示文本。 */
  placeholder?: string;
  /** 同一次工具调用中向用户展示的问题列表。 */
  questions?: QuestionItemInput[];
}

/**
 * 待回答问题快照。
 */
export interface PendingQuestionSnapshot {
  /** 当前待回答问题的标识符。 */
  questionId: string;
  /** 关联的工具调用标识符。 */
  toolCallId: string;
}

/**
 * 问题工具的工厂选项。
 */
export interface CreateQuestionToolOptions {
  /** 读取当前待回答问题，不存在时返回 null。 */
  getPendingQuestion: () => PendingQuestionSnapshot | null;
  /** 生成稳定的问题标识符。 */
  createQuestionId: () => string;
}

/**
 * 校验单个选项。
 * @param option - 待校验的选项
 * @returns 选项是否包含可用的 label 和 value
 */
function isValidChoiceOption(option: AIChoiceOption): boolean {
  return typeof option.label === 'string' && option.label.trim().length > 0 && typeof option.value === 'string' && option.value.trim().length > 0;
}

/**
 * 将旧版单问题输入和批量输入归一化为问题列表。
 * @param input - 原始工具输入
 * @returns 问题列表；输入不包含可用问题结构时返回 null
 */
function normalizeQuestionInput(input: QuestionToolInput): QuestionItemInput[] | null {
  if (Array.isArray(input.questions)) {
    return input.questions;
  }

  if (typeof input.question === 'undefined' && typeof input.mode === 'undefined' && typeof input.options === 'undefined') {
    return null;
  }

  return [
    {
      question: input.question ?? '',
      mode: input.mode ?? ('single' as const),
      options: input.options ?? [],
      maxSelections: input.maxSelections,
      placeholder: input.placeholder
    }
  ];
}

/**
 * 在执行时校验单个归一化问题。
 * @param question - 问题条目
 * @returns 校验错误信息，合法时返回 null
 */
function validateQuestionItem(question: QuestionItemInput): string | null {
  if (typeof question.question !== 'string' || question.question.trim().length === 0) {
    return '问题内容不能为空。';
  }

  if (question.mode !== 'single' && question.mode !== 'multiple' && question.mode !== 'input') {
    return 'mode 只能是 single、multiple 或 input。';
  }

  if (question.mode === 'input') {
    if ((question.options ?? []).length > 0) {
      return '输入模式不能提供可选项。';
    }

    if (typeof question.maxSelections !== 'undefined') {
      return '输入问题不能设置 maxSelections。';
    }

    return null;
  }

  const options = question.options ?? [];
  if (options.length === 0) {
    return '至少需要提供一个可选项。';
  }

  if (options.length > MAX_CHOICE_OPTIONS) {
    return `可选项数量不能超过 ${MAX_CHOICE_OPTIONS} 个。`;
  }

  if (!options.every((option) => isValidChoiceOption(option))) {
    return '每个选项都必须提供非空的 label 和 value。';
  }

  if (question.mode === 'single') {
    if (typeof question.maxSelections !== 'undefined') {
      return '单选问题不能设置 maxSelections。';
    }

    return null;
  }

  if (typeof question.maxSelections !== 'undefined') {
    if (!Number.isInteger(question.maxSelections) || question.maxSelections < 1) {
      return '多选问题的 maxSelections 必须是大于 0 的整数。';
    }

    if (question.maxSelections > options.length) {
      return '多选问题的 maxSelections 不能超过可选项数量。';
    }
  }

  return null;
}

/**
 * 问题工具校验结果。
 */
type QuestionToolValidationResult = { valid: true; questions: QuestionItemInput[] } | { valid: false; error: string };

/**
 * 在执行时校验问题工具输入。
 * @param input - 原始工具输入
 * @returns 归一化问题列表且无错误，或返回校验错误
 */
function validateQuestionToolInput(input: QuestionToolInput): QuestionToolValidationResult {
  const questions = normalizeQuestionInput(input);

  if (!questions || questions.length === 0) {
    return { valid: false, error: '至少需要提供一个问题。' };
  }

  for (const question of questions) {
    const error = validateQuestionItem(question);
    if (error) {
      return { valid: false, error };
    }
  }

  return { valid: true, questions };
}

/**
 * 构建等待用户输入的结果载荷。
 * @param questions - 已校验的问题列表
 * @param questionId - 生成的问题标识符
 * @returns 通过工具终止结果发送的问题载荷
 */
function createQuestionPayload(questions: QuestionItemInput[], questionId: string): AIAwaitingUserChoiceQuestion {
  const [firstQuestion] = questions;
  const normalizedQuestions: AIAwaitingUserChoiceItem[] = questions.map((question) => ({
    question: question.question,
    mode: question.mode,
    options: question.options ?? [],
    maxSelections: question.mode === 'multiple' ? question.maxSelections : undefined,
    placeholder: question.mode === 'input' ? question.placeholder : undefined
  }));

  return {
    questionId,
    toolCallId: '',
    question: firstQuestion.question,
    mode: firstQuestion.mode,
    options: firstQuestion.options ?? [],
    maxSelections: firstQuestion.mode === 'multiple' ? firstQuestion.maxSelections : undefined,
    placeholder: firstQuestion.mode === 'input' ? firstQuestion.placeholder : undefined,
    questions: normalizedQuestions
  };
}

/**
 * 创建内置 question 工具。
 * @param options - 工厂依赖
 * @returns 配置完成的只读工具执行器
 */
export function createQuestionTool(options: CreateQuestionToolOptions): AIToolExecutor<QuestionToolInput, AIAwaitingUserChoiceQuestion> {
  return {
    definition: {
      name: QUESTION_TOOL_NAME,
      description: '向用户发起一个或多个单选/多选/输入问题，并等待用户回答后继续。',
      source: 'builtin',
      riskLevel: 'read',
      permissionCategory: 'system',
      requiresActiveDocument: false,
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '向用户展示的问题文本。' },
          mode: { type: 'string', enum: ['single', 'multiple', 'input'], description: '题目模式：单选、多选或输入框。' },
          options: {
            type: 'array',
            description: '可选项列表（单选/多选必填），最多 10 项。',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string', description: '显示给用户的文本。' },
                value: { type: 'string', description: '提交给模型的值。' },
                description: { type: 'string', description: '可选的补充说明。' }
              },
              required: ['label', 'value'],
              additionalProperties: false
            }
          },
          maxSelections: { type: 'number', description: '多选时允许选择的最大数量。' },
          placeholder: { type: 'string', description: '输入框模式的占位提示文本。' },
          questions: {
            type: 'array',
            description: '同一次工具调用展示的问题列表。',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: '向用户展示的问题文本。' },
                mode: { type: 'string', enum: ['single', 'multiple', 'input'], description: '题目模式：单选、多选或输入框。' },
                options: {
                  type: 'array',
                  description: '可选项列表（单选/多选必填），最多 10 项。',
                  items: {
                    type: 'object',
                    properties: {
                      label: { type: 'string', description: '显示给用户的文本。' },
                      value: { type: 'string', description: '提交给模型的值。' },
                      description: { type: 'string', description: '可选的补充说明。' }
                    },
                    required: ['label', 'value'],
                    additionalProperties: false
                  }
                },
                maxSelections: { type: 'number', description: '多选时允许选择的最大数量。' },
                placeholder: { type: 'string', description: '输入框模式的占位提示文本。' }
              },
              required: ['question', 'mode'],
              additionalProperties: false
            }
          }
        },
        required: [],
        additionalProperties: false
      }
    },
    async execute(input: QuestionToolInput) {
      if (options.getPendingQuestion()) {
        return createToolFailureResult(QUESTION_TOOL_NAME, 'EXECUTION_FAILED', '当前已有待回答问题，请等待用户先完成作答。');
      }

      const validationResult = validateQuestionToolInput(input);

      if (!validationResult.valid) {
        return createToolFailureResult(QUESTION_TOOL_NAME, 'INVALID_INPUT', validationResult.error);
      }

      return createAwaitingUserInputResult(QUESTION_TOOL_NAME, createQuestionPayload(validationResult.questions, options.createQuestionId()));
    }
  };
}
