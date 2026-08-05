/**
 * @file builtin-index.test.ts
 * @description 验证内置工具工厂的默认工具暴露。
 */
import { describe, expect, it } from 'vitest';
import {
  CONDITIONAL_BUILTIN_READONLY_TOOL_NAMES,
  CONDITIONAL_BUILTIN_WRITABLE_TOOL_NAMES,
  createBuiltinTools,
  DEFAULT_BUILTIN_READONLY_TOOL_NAMES,
  DEFAULT_BUILTIN_WRITABLE_TOOL_NAMES,
  OPERATE_WEBPAGE_TOOL_NAME,
  READ_CURRENT_DOCUMENT_TOOL_NAME,
  READ_CURRENT_WEBPAGE_TOOL_NAME,
  READ_CURRENT_WIDGET_TOOL_NAME
} from '@/ai/tools/builtin';
import { DELEGATE_TASK_TOOL_NAME, GLOB_TOOL_NAME, GREP_TOOL_NAME } from '@/ai/tools/catalog/runtimeTools';
import { getToolNamesByExposure } from '../../../shared/ai/tools/index.js';

describe('builtin tools index', (): void => {
  it('derives migrated tool exposure lists from the shared tool registry', (): void => {
    expect(DEFAULT_BUILTIN_READONLY_TOOL_NAMES).toEqual(expect.arrayContaining(getToolNamesByExposure('default-readonly')));
    expect(DEFAULT_BUILTIN_WRITABLE_TOOL_NAMES).toEqual(expect.arrayContaining(getToolNamesByExposure('default-writable')));
    expect(CONDITIONAL_BUILTIN_READONLY_TOOL_NAMES).toEqual(expect.arrayContaining(getToolNamesByExposure('conditional-readonly')));
    expect(CONDITIONAL_BUILTIN_WRITABLE_TOOL_NAMES).toEqual(getToolNamesByExposure('conditional-writable'));
  });

  it('keeps delegate_task out of every production chat tool-name list', (): void => {
    expect(DEFAULT_BUILTIN_READONLY_TOOL_NAMES).not.toContain(DELEGATE_TASK_TOOL_NAME);
    expect(DEFAULT_BUILTIN_WRITABLE_TOOL_NAMES).not.toContain(DELEGATE_TASK_TOOL_NAME);
    expect(CONDITIONAL_BUILTIN_READONLY_TOOL_NAMES).not.toContain(DELEGATE_TASK_TOOL_NAME);
    expect(CONDITIONAL_BUILTIN_WRITABLE_TOOL_NAMES).not.toContain(DELEGATE_TASK_TOOL_NAME);
  });

  it('keeps page-scoped schemas out of the core builtin factory', (): void => {
    const toolNames = createBuiltinTools().map((tool) => tool.definition.name);

    expect(toolNames).not.toEqual(
      expect.arrayContaining([READ_CURRENT_DOCUMENT_TOOL_NAME, READ_CURRENT_WEBPAGE_TOOL_NAME, READ_CURRENT_WIDGET_TOOL_NAME, OPERATE_WEBPAGE_TOOL_NAME])
    );
  });

  it('keeps workspace file search tools available when a workspace exists', (): void => {
    const toolNames = createBuiltinTools({ getWorkspaceRoot: () => '/workspace' }).map((tool) => tool.definition.name);

    expect(toolNames).toEqual(expect.arrayContaining([GLOB_TOOL_NAME, GREP_TOOL_NAME]));
  });
});
