import type { AIToolContext } from 'types/ai';
import { describe, expect, it } from 'vitest';
import { createBuiltinTools } from '@/ai/tools/builtin';

/**
 * 创建工具执行上下文。
 * @returns 测试用工具上下文
 */
function createToolContext(): AIToolContext {
  return {
    document: {
      id: 'doc-1',
      title: 'Doc',
      path: null,
      getContent: () => ''
    },
    editor: {
      getSelection: () => null,
      insertAtCursor: async () => undefined,
      replaceSelection: async () => undefined,
      replaceDocument: async () => undefined
    }
  };
}

/**
 * 提取工具名称列表。
 * @param includeWriteTools - 是否包含写工具
 * @returns 工具名称列表
 */
function getToolNames(includeWriteTools = false): string[] {
  return createBuiltinTools(
    includeWriteTools
      ? {
          confirm: {
            confirm: async () => true
          }
        }
      : undefined
  ).map((tool) => tool.definition.name);
}

describe('createBuiltinTools', () => {
  it('returns read tools by default', () => {
    expect(getToolNames()).toEqual(['read_current_document', 'get_current_time', 'search_current_document', 'ask_user_choice']);
  });

  it('only exposes low-risk write tools by default when confirmation is available', () => {
    expect(getToolNames(true)).toEqual([
      'read_current_document',
      'get_current_time',
      'search_current_document',
      'ask_user_choice',
      'insert_at_cursor',
      'update_settings'
    ]);
  });

  it('can opt into selection replacement and dangerous document replacement explicitly', () => {
    const tools = createBuiltinTools({
      confirm: {
        confirm: async () => true
      },
      includeSelectionReplace: true,
      includeDangerous: true
    });

    expect(tools.map((tool) => tool.definition.name)).toEqual([
      'read_current_document',
      'get_current_time',
      'search_current_document',
      'ask_user_choice',
      'insert_at_cursor',
      'update_settings',
      'replace_selection',
      'replace_document'
    ]);
  });

  it('passes pending question and question id providers to ask_user_choice', async () => {
    const tools = createBuiltinTools({
      getPendingQuestion: () => null,
      createQuestionId: () => 'question-from-host'
    });
    const askUserChoiceTool = tools.find((tool) => tool.definition.name === 'ask_user_choice');

    const result = await askUserChoiceTool?.execute(
      {
        question: '请选择渠道类型',
        mode: 'single',
        options: [{ label: '官网', value: 'official' }]
      },
      createToolContext()
    );

    expect(result).toMatchObject({
      status: 'awaiting_user_input',
      data: {
        questionId: 'question-from-host'
      }
    });
  });

  it('uses host pending question state to reject concurrent ask_user_choice calls', async () => {
    const tools = createBuiltinTools({
      getPendingQuestion: () => ({ questionId: 'pending-1', toolCallId: 'tool-call-1' }),
      createQuestionId: () => 'question-2'
    });
    const askUserChoiceTool = tools.find((tool) => tool.definition.name === 'ask_user_choice');

    const result = await askUserChoiceTool?.execute(
      {
        question: '请选择渠道类型',
        mode: 'single',
        options: [{ label: '官网', value: 'official' }]
      },
      createToolContext()
    );

    expect(result).toMatchObject({
      status: 'failure',
      error: { code: 'EXECUTION_FAILED' }
    });
  });
});
