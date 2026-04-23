/**
 * @file ask-user-choice.ts
 * @description Built-in executor for pausing tool flow until the user makes a choice.
 */
import type { AIChoiceOption, AIAwaitingUserChoiceQuestion, AIToolExecutor } from 'types/ai';
import { createAwaitingUserInputResult, createToolFailureResult } from '../results';

/** Shared tool name constant. */
const ASK_USER_CHOICE_TOOL_NAME = 'ask_user_choice';

/** Maximum number of options accepted by the executor. */
const MAX_CHOICE_OPTIONS = 10;

/**
 * Ask-user-choice tool input.
 */
export interface AskUserChoiceInput {
  /** Prompt shown to the user. */
  question: string;
  /** Selection mode. */
  mode: 'single' | 'multiple';
  /** Available options. */
  options: AIChoiceOption[];
  /** Whether free-form text input is allowed. */
  allowOther?: boolean;
  /** Maximum number of answers allowed in multiple mode. */
  maxSelections?: number;
}

/**
 * Pending question snapshot.
 */
export interface PendingQuestionSnapshot {
  /** Current pending question identifier. */
  questionId: string;
  /** Related tool call identifier. */
  toolCallId: string;
}

/**
 * Factory options for the ask_user_choice tool.
 */
export interface CreateAskUserChoiceToolOptions {
  /** Reads the current pending question, if one exists. */
  getPendingQuestion: () => PendingQuestionSnapshot | null;
  /** Creates a stable question identifier. */
  createQuestionId: () => string;
}

/**
 * Validates one choice option.
 * @param option - Option to validate.
 * @returns Whether the option has a usable label and value.
 */
function isValidChoiceOption(option: AIChoiceOption): boolean {
  return typeof option.label === 'string' && option.label.trim().length > 0 && typeof option.value === 'string' && option.value.trim().length > 0;
}

/**
 * Validates ask_user_choice input at execution time.
 * @param input - Raw tool input.
 * @returns Validation error message, or null when valid.
 */
function validateAskUserChoiceInput(input: AskUserChoiceInput): string | null {
  if (typeof input.question !== 'string' || input.question.trim().length === 0) {
    return '问题内容不能为空。';
  }

  if (!Array.isArray(input.options) || input.options.length === 0) {
    return '至少需要提供一个可选项。';
  }

  if (input.options.length > MAX_CHOICE_OPTIONS) {
    return `可选项数量不能超过 ${MAX_CHOICE_OPTIONS} 个。`;
  }

  if (!input.options.every((option) => isValidChoiceOption(option))) {
    return '每个选项都必须提供非空的 label 和 value。';
  }

  if (input.mode !== 'single' && input.mode !== 'multiple') {
    return 'mode 只能是 single 或 multiple。';
  }

  if (input.mode === 'single') {
    if (typeof input.maxSelections !== 'undefined') {
      return '单选问题不能设置 maxSelections。';
    }

    return null;
  }

  if (typeof input.maxSelections !== 'undefined') {
    if (!Number.isInteger(input.maxSelections) || input.maxSelections < 1) {
      return '多选问题的 maxSelections 必须是大于 0 的整数。';
    }

    if (input.maxSelections > input.options.length) {
      return '多选问题的 maxSelections 不能超过可选项数量。';
    }
  }

  return null;
}

/**
 * Builds the awaiting-user-input payload.
 * @param input - Validated input.
 * @param questionId - Generated question identifier.
 * @returns Question payload sent through the terminal tool result.
 */
function createQuestionPayload(input: AskUserChoiceInput, questionId: string): AIAwaitingUserChoiceQuestion {
  return {
    questionId,
    toolCallId: '',
    question: input.question,
    mode: input.mode,
    options: input.options,
    allowOther: input.allowOther ?? false,
    maxSelections: input.mode === 'multiple' ? input.maxSelections : undefined
  };
}

/**
 * Creates the built-in ask_user_choice tool.
 * @param options - Factory dependencies.
 * @returns Configured read-only tool executor.
 */
export function createAskUserChoiceTool(options: CreateAskUserChoiceToolOptions): AIToolExecutor<AskUserChoiceInput, AIAwaitingUserChoiceQuestion> {
  return {
    definition: {
      name: ASK_USER_CHOICE_TOOL_NAME,
      description: '向用户发起单选或多选问题，并等待用户选择后继续。',
      source: 'builtin',
      riskLevel: 'read',
      permissionCategory: 'system',
      requiresActiveDocument: false,
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '向用户展示的问题文本。' },
          mode: { type: 'string', enum: ['single', 'multiple'], description: '选择模式。' },
          options: {
            type: 'array',
            description: '可选项列表，最多 10 项。',
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
          allowOther: { type: 'boolean', description: '是否允许用户输入其他内容。', default: false },
          maxSelections: { type: 'number', description: '多选时允许选择的最大数量。' }
        },
        required: ['question', 'mode', 'options'],
        additionalProperties: false
      }
    },
    async execute(input: AskUserChoiceInput) {
      if (options.getPendingQuestion()) {
        return createToolFailureResult(ASK_USER_CHOICE_TOOL_NAME, 'EXECUTION_FAILED', '当前已有待回答问题，请等待用户先完成作答。');
      }

      const normalizedInput: AskUserChoiceInput = {
        ...input,
        allowOther: input.allowOther ?? false
      };
      const validationError = validateAskUserChoiceInput(normalizedInput);

      if (validationError) {
        return createToolFailureResult(ASK_USER_CHOICE_TOOL_NAME, 'INVALID_INPUT', validationError);
      }

      return createAwaitingUserInputResult(ASK_USER_CHOICE_TOOL_NAME, createQuestionPayload(normalizedInput, options.createQuestionId()));
    }
  };
}
