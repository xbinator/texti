import type { AIToolContext } from 'types/ai';
import { describe, expect, it } from 'vitest';
import { createBuiltinTools } from '@/ai/tools/builtin';
import { QUERY_LOGS_TOOL_NAME } from '@/ai/tools/builtin/logs';
import { READ_DIRECTORY_TOOL_NAME } from '@/ai/tools/builtin/read-file';
import { GET_SETTINGS_TOOL_NAME, UPDATE_SETTINGS_TOOL_NAME } from '@/ai/tools/builtin/settings';

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
    expect(getToolNames()).toEqual([
      'read_current_document',
      'get_current_time',
      'search_current_document',
      'ask_user_choice',
      'read_file',
      READ_DIRECTORY_TOOL_NAME,
      GET_SETTINGS_TOOL_NAME,
      QUERY_LOGS_TOOL_NAME
    ]);
  });

  it('only exposes low-risk write tools by default when confirmation is available', () => {
    expect(getToolNames(true)).toEqual([
      'read_current_document',
      'get_current_time',
      'search_current_document',
      'ask_user_choice',
      'read_file',
      READ_DIRECTORY_TOOL_NAME,
      GET_SETTINGS_TOOL_NAME,
      QUERY_LOGS_TOOL_NAME,
      'insert_at_cursor',
      UPDATE_SETTINGS_TOOL_NAME
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
      'read_file',
      READ_DIRECTORY_TOOL_NAME,
      GET_SETTINGS_TOOL_NAME,
      QUERY_LOGS_TOOL_NAME,
      'insert_at_cursor',
      UPDATE_SETTINGS_TOOL_NAME,
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

  it('passes workspace root provider to read_file', async () => {
    const tools = createBuiltinTools({
      getWorkspaceRoot: () => '/workspace'
    });
    const readFileTool = tools.find((tool) => tool.definition.name === 'read_file');

    const result = await readFileTool?.execute({ path: 'missing.ts' }, createToolContext());

    expect(result).toMatchObject({
      status: 'failure',
      error: { code: 'UNSUPPORTED_PROVIDER' }
    });
  });

  it('passes workspace root provider to read_directory', async () => {
    const tools = createBuiltinTools({
      getWorkspaceRoot: () => '/workspace'
    });
    const readDirectoryTool = tools.find((tool) => tool.definition.name === READ_DIRECTORY_TOOL_NAME);

    const result = await readDirectoryTool?.execute({ path: 'src' }, createToolContext());

    expect(result).toMatchObject({
      status: 'failure',
      error: { code: 'UNSUPPORTED_PROVIDER' }
    });
  });

  it('passes confirmation adapter to read_directory for absolute paths without workspace root', async () => {
    const confirm = {
      confirm: async () => true
    };
    const tools = createBuiltinTools({
      confirm
    });
    const readDirectoryTool = tools.find((tool) => tool.definition.name === READ_DIRECTORY_TOOL_NAME);

    const result = await readDirectoryTool?.execute({ path: '/Users/demo/project/docs' }, createToolContext());

    expect(result).toMatchObject({
      status: 'failure',
      error: { code: 'UNSUPPORTED_PROVIDER' }
    });
  });
});
