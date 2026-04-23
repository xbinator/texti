/**
 * @file builtin-ask-user-choice.test.ts
 * @description Tests for the built-in ask_user_choice tool executor.
 */
import type { AIToolContext } from 'types/ai';
import { describe, expect, it } from 'vitest';
import { createAskUserChoiceTool } from '@/ai/tools/builtin/ask-user-choice';

/**
 * Creates a stable tool execution context for ask_user_choice tests.
 * @returns Tool execution context.
 */
function createContext(): AIToolContext {
  return {
    document: {
      id: 'doc-1',
      title: 'My Note',
      path: null,
      getContent: () => '# Note'
    },
    editor: {
      getSelection: () => null,
      insertAtCursor: async () => undefined,
      replaceSelection: async () => undefined,
      replaceDocument: async () => undefined
    }
  };
}

describe('createAskUserChoiceTool', () => {
  it('does not require an active editor document', () => {
    const tool = createAskUserChoiceTool({
      getPendingQuestion: () => null,
      createQuestionId: () => 'question-global'
    });

    expect(tool.definition.requiresActiveDocument).toBe(false);
  });

  it('returns awaiting user input for a valid single-choice question', async () => {
    const tool = createAskUserChoiceTool({
      getPendingQuestion: () => null,
      createQuestionId: () => 'question-1'
    });

    const result = await tool.execute(
      {
        question: 'Choose a channel type',
        mode: 'single',
        options: [
          { label: 'Official', value: 'official' },
          { label: 'Video', value: 'video' }
        ]
      },
      createContext()
    );

    expect(result).toEqual({
      toolName: 'ask_user_choice',
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-1',
        toolCallId: '',
        question: 'Choose a channel type',
        mode: 'single',
        options: [
          { label: 'Official', value: 'official' },
          { label: 'Video', value: 'video' }
        ],
        allowOther: false
      }
    });
  });

  it('keeps allowOther and maxSelections for valid multiple-choice questions', async () => {
    const tool = createAskUserChoiceTool({
      getPendingQuestion: () => null,
      createQuestionId: () => 'question-2'
    });

    const result = await tool.execute(
      {
        question: 'Choose the release channels',
        mode: 'multiple',
        options: [
          { label: 'Stable', value: 'stable' },
          { label: 'Beta', value: 'beta' },
          { label: 'Nightly', value: 'nightly' }
        ],
        allowOther: true,
        maxSelections: 2
      },
      createContext()
    );

    expect(result.status).toBe('awaiting_user_input');
    expect(result.data).toEqual({
      questionId: 'question-2',
      toolCallId: '',
      question: 'Choose the release channels',
      mode: 'multiple',
      options: [
        { label: 'Stable', value: 'stable' },
        { label: 'Beta', value: 'beta' },
        { label: 'Nightly', value: 'nightly' }
      ],
      allowOther: true,
      maxSelections: 2
    });
  });

  it('rejects a second pending question before creating a new one', async () => {
    const tool = createAskUserChoiceTool({
      getPendingQuestion: () => ({
        questionId: 'pending-1',
        toolCallId: 'tool-call-1'
      }),
      createQuestionId: () => 'question-3'
    });

    const result = await tool.execute(
      {
        question: 'Choose a channel type',
        mode: 'single',
        options: [{ label: 'Official', value: 'official' }]
      },
      createContext()
    );

    expect(result).toEqual({
      toolName: 'ask_user_choice',
      status: 'failure',
      error: {
        code: 'EXECUTION_FAILED',
        message: '当前已有待回答问题，请等待用户先完成作答。'
      }
    });
  });

  it('rejects maxSelections for single-choice questions', async () => {
    const tool = createAskUserChoiceTool({
      getPendingQuestion: () => null,
      createQuestionId: () => 'question-4'
    });

    const result = await tool.execute(
      {
        question: 'Choose one channel type',
        mode: 'single',
        options: [
          { label: 'Official', value: 'official' },
          { label: 'Community', value: 'community' }
        ],
        maxSelections: 2
      },
      createContext()
    );

    expect(result).toEqual({
      toolName: 'ask_user_choice',
      status: 'failure',
      error: {
        code: 'INVALID_INPUT',
        message: '单选问题不能设置 maxSelections。'
      }
    });
  });

  it('rejects invalid maxSelections for multiple-choice questions', async () => {
    const tool = createAskUserChoiceTool({
      getPendingQuestion: () => null,
      createQuestionId: () => 'question-5'
    });

    const result = await tool.execute(
      {
        question: 'Choose release channels',
        mode: 'multiple',
        options: [
          { label: 'Stable', value: 'stable' },
          { label: 'Beta', value: 'beta' }
        ],
        maxSelections: 3
      },
      createContext()
    );

    expect(result).toEqual({
      toolName: 'ask_user_choice',
      status: 'failure',
      error: {
        code: 'INVALID_INPUT',
        message: '多选问题的 maxSelections 不能超过可选项数量。'
      }
    });
  });

  it('rejects invalid runtime mode values', async () => {
    const tool = createAskUserChoiceTool({
      getPendingQuestion: () => null,
      createQuestionId: () => 'question-6'
    });

    const result = await tool.execute(
      {
        question: 'Choose a channel type',
        mode: 'invalid' as 'single' | 'multiple',
        options: [
          { label: 'Official', value: 'official' },
          { label: 'Video', value: 'video' }
        ]
      },
      createContext()
    );

    expect(result).toEqual({
      toolName: 'ask_user_choice',
      status: 'failure',
      error: {
        code: 'INVALID_INPUT',
        message: 'mode 只能是 single 或 multiple。'
      }
    });
  });

  it('rejects inputs whose options exceed the executor limit', async () => {
    const tool = createAskUserChoiceTool({
      getPendingQuestion: () => null,
      createQuestionId: () => 'question-7'
    });

    const result = await tool.execute(
      {
        question: 'Choose a channel type',
        mode: 'single',
        options: Array.from({ length: 11 }, (_value, index) => ({
          label: `Option ${index + 1}`,
          value: `option-${index + 1}`
        }))
      },
      createContext()
    );

    expect(result).toEqual({
      toolName: 'ask_user_choice',
      status: 'failure',
      error: {
        code: 'INVALID_INPUT',
        message: '可选项数量不能超过 10 个。'
      }
    });
  });

  it('rejects invalid options before returning an awaiting result', async () => {
    const tool = createAskUserChoiceTool({
      getPendingQuestion: () => null,
      createQuestionId: () => 'question-8'
    });

    const result = await tool.execute(
      {
        question: 'Choose a channel type',
        mode: 'single',
        options: [{ label: 'Official', value: 'official' }, { label: '  ', value: 'video' }]
      },
      createContext()
    );

    expect(result).toEqual({
      toolName: 'ask_user_choice',
      status: 'failure',
      error: {
        code: 'INVALID_INPUT',
        message: '每个选项都必须提供非空的 label 和 value。'
      }
    });
  });
});
