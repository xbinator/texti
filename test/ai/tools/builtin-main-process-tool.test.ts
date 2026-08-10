/**
 * @file builtin-main-process-tool.test.ts
 * @description 验证已主进程化内置工具在 renderer 侧只保留 schema。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EDIT_MEMORY_TOOL_NAME,
  QUESTION_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  RUN_SHELL_COMMAND_TOOL_NAME,
  SKILL_TOOL_NAME,
  TODO_WRITE_TOOL_NAME,
  WRITE_FILE_TOOL_NAME,
  createBuiltinTools
} from '@/ai/tools/builtin';
import { createReadFileTool as createCatalogReadFileTool } from '@/ai/tools/catalog/runtimeTools';
import {
  FILE_TOOL_NAMES,
  MAIN_PROCESS_TOOL_NAMES,
  READ_TOOL_NAMES,
  RESOURCE_TOOL_NAMES,
  SETTINGS_TOOL_NAMES
} from '../../../electron/main/modules/chat/runtime/tools/constants.mjs';
import { getToolNamesByRuntimeGroup } from '../../../shared/ai/tools/index.js';

/** Electron 主进程工具常量源码。 */
const mainToolConstantsSource = readFileSync(new URL('../../../electron/main/modules/chat/runtime/tools/constants.mts', import.meta.url), 'utf8');

describe('builtin main-process tools', (): void => {
  it('exposes migrated tool schemas from the catalog namespace', (): void => {
    const readFileTool = createCatalogReadFileTool();

    expect(readFileTool.definition.name).toBe(READ_FILE_TOOL_NAME);
  });

  it('keeps migrated tools as transport schemas', (): void => {
    const tools = createBuiltinTools({
      confirm: { confirm: async () => ({ approved: true }) },
      getWorkspaceRoot: () => '/workspace'
    });
    const toolNames = tools.map((tool) => tool.definition.name);

    expect(toolNames).toContain(READ_FILE_TOOL_NAME);
    expect(toolNames).toContain(WRITE_FILE_TOOL_NAME);
  });

  it('keeps every registered runtime schema backed by a main-process executor name', (): void => {
    const localRendererToolNames = new Set([QUESTION_TOOL_NAME, TODO_WRITE_TOOL_NAME, EDIT_MEMORY_TOOL_NAME, RUN_SHELL_COMMAND_TOOL_NAME, SKILL_TOOL_NAME]);
    const tools = createBuiltinTools({
      confirm: { confirm: async () => ({ approved: true }) },
      getWorkspaceRoot: () => '/workspace',
      mcpStore: { hasEnabledMcpServers: true }
    });
    const runtimeSchemaNames = tools.map((tool) => tool.definition.name).filter((toolName) => !localRendererToolNames.has(toolName));

    expect(runtimeSchemaNames).not.toEqual([]);
    expect(runtimeSchemaNames.filter((toolName) => !MAIN_PROCESS_TOOL_NAMES.has(toolName))).toEqual([]);
  });

  it('keeps main-process group sets aligned with the shared tool registry', (): void => {
    expect([...READ_TOOL_NAMES].sort()).toEqual(getToolNamesByRuntimeGroup('main', 'read').sort());
    expect([...FILE_TOOL_NAMES].sort()).toEqual(getToolNamesByRuntimeGroup('main', 'file').sort());
    expect([...SETTINGS_TOOL_NAMES].sort()).toEqual(getToolNamesByRuntimeGroup('main', 'settings').sort());
    expect([...RESOURCE_TOOL_NAMES].sort()).toEqual(getToolNamesByRuntimeGroup('main', 'resource').sort());
  });

  it('does not relay supported setting keys through main-process constants', (): void => {
    expect(mainToolConstantsSource).not.toContain('SUPPORTED_SETTING_KEYS');
  });

  it('fails clearly if a migrated tool is accidentally executed in renderer', async (): Promise<void> => {
    const tools = createBuiltinTools({
      getWorkspaceRoot: () => '/workspace'
    });
    const readFileTool = tools.find((tool) => tool.definition.name === READ_FILE_TOOL_NAME);

    expect(readFileTool).toBeDefined();
    const result = await readFileTool?.execute({ path: 'README.md' });

    expect(result).toMatchObject({
      toolName: READ_FILE_TOOL_NAME,
      status: 'failure',
      error: {
        code: 'EXECUTION_FAILED',
        message: expect.stringContaining('已迁移到 ChatRuntime 主进程执行')
      }
    });
  });
});
