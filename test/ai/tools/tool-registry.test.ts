/**
 * @file tool-registry.test.ts
 * @description 工具定义单一 registry 测试。
 */
import { readFileSync } from 'node:fs';
import type { AIToolExecutor } from 'types/ai';
import { describe, expect, it } from 'vitest';
import * as runtimeTools from '@/ai/tools/catalog/runtimeTools';
import { GLOB_TOOL_NAME, GREP_TOOL_NAME, READ_FILE_TOOL_NAME, createGlobTool, createGrepTool, createReadFileTool } from '@/ai/tools/catalog/runtimeTools';
import { stageFileEditToolRegistryEntry, stageFileWriteToolRegistryEntry } from '../../../shared/ai/tools/AgentStagedFileTool/index.js';
import { createDocumentToolRegistryEntry } from '../../../shared/ai/tools/DocumentTool/index.js';
import { getCurrentTimeToolRegistryEntry } from '../../../shared/ai/tools/EnvironmentTool/index.js';
import { editFileToolRegistryEntry } from '../../../shared/ai/tools/FileEditTool/index.js';
import {
  globToolRegistryEntry,
  grepToolRegistryEntry,
  readDirectoryToolRegistryEntry,
  readFileToolRegistryEntry
} from '../../../shared/ai/tools/FileReadTool/index.js';
import { writeFileToolRegistryEntry } from '../../../shared/ai/tools/FileWriteTool/index.js';
import {
  DELEGATE_TASK_TOOL_NAME,
  EDIT_FILE_TOOL_NAME,
  READ_DIRECTORY_TOOL_NAME,
  TOOL_REGISTRY,
  WRITE_FILE_TOOL_NAME,
  getToolDefinitionByName,
  getToolRegistryEntry,
  getToolNamesByExposure,
  getToolNamesByRuntimeGroup
} from '../../../shared/ai/tools/index.js';
import { queryLogsToolRegistryEntry } from '../../../shared/ai/tools/LogsTool/index.js';
import {
  addMcpServerToolRegistryEntry,
  getMcpSettingsToolRegistryEntry,
  refreshMcpDiscoveryToolRegistryEntry,
  removeMcpServerToolRegistryEntry,
  updateMcpServerToolRegistryEntry
} from '../../../shared/ai/tools/MCPSettingsTool/index.js';
import { openResourceToolRegistryEntry } from '../../../shared/ai/tools/OpenResourceTool/index.js';
import { getSettingsToolRegistryEntry, updateSettingsToolRegistryEntry } from '../../../shared/ai/tools/SettingsTool/index.js';

/** SettingsTool 源码，用于约束说明片段复用结构。 */
const settingsToolSource = readFileSync(new URL('../../../shared/ai/tools/SettingsTool/index.ts', import.meta.url), 'utf8');

/** runtimeTools 模块带工厂映射的测试视图。 */
type RuntimeToolsWithFactoryMap = typeof runtimeTools & {
  /** 按工具名称索引的 schema-only 工厂映射。 */
  RUNTIME_TOOL_FACTORIES?: Readonly<Record<string, () => AIToolExecutor>>;
};

describe('toolRegistry', (): void => {
  it('exposes the shared registry as the single source', (): void => {
    expect(TOOL_REGISTRY.length).toBeGreaterThan(0);
  });

  it('assembles registry entries from one Tool directory per tool domain', (): void => {
    expect(TOOL_REGISTRY).toEqual([
      createDocumentToolRegistryEntry,
      getCurrentTimeToolRegistryEntry,
      readFileToolRegistryEntry,
      readDirectoryToolRegistryEntry,
      globToolRegistryEntry,
      grepToolRegistryEntry,
      stageFileWriteToolRegistryEntry,
      stageFileEditToolRegistryEntry,
      writeFileToolRegistryEntry,
      editFileToolRegistryEntry,
      queryLogsToolRegistryEntry,
      getSettingsToolRegistryEntry,
      updateSettingsToolRegistryEntry,
      getMcpSettingsToolRegistryEntry,
      addMcpServerToolRegistryEntry,
      updateMcpServerToolRegistryEntry,
      removeMcpServerToolRegistryEntry,
      refreshMcpDiscoveryToolRegistryEntry,
      openResourceToolRegistryEntry,
      getToolRegistryEntry(DELEGATE_TASK_TOOL_NAME)
    ]);
  });

  it('is the source of schema definitions used by runtimeTools factories', (): void => {
    const registryDefinition = getToolDefinitionByName(READ_FILE_TOOL_NAME);
    const runtimeTool = createReadFileTool();

    expect(registryDefinition).toBeDefined();
    expect(runtimeTool.definition).toEqual(registryDefinition);
  });

  it('exposes glob and grep schema-only factories from the shared registry', (): void => {
    expect(createGlobTool().definition).toEqual(getToolDefinitionByName(GLOB_TOOL_NAME));
    expect(createGrepTool().definition).toEqual(getToolDefinitionByName(GREP_TOOL_NAME));
  });

  it('derives runtimeTools factory map from every shared registry definition', (): void => {
    const factoryMap = (runtimeTools as RuntimeToolsWithFactoryMap).RUNTIME_TOOL_FACTORIES;
    const registryToolNames = TOOL_REGISTRY.map((entry) => entry.definition.name).sort();

    expect(factoryMap).toBeDefined();
    expect(Object.keys(factoryMap ?? {}).sort()).toEqual(registryToolNames);
    for (const entry of TOOL_REGISTRY) {
      expect(factoryMap?.[entry.definition.name]?.().definition).toEqual(entry.definition);
    }
  });

  it('can derive main-process tool names by runtime group', (): void => {
    const fileToolNames = getToolNamesByRuntimeGroup('main', 'file');

    expect(fileToolNames).toEqual(expect.arrayContaining(['read_file', 'read_directory', 'glob', 'grep', 'create_document', 'write_file', 'edit_file']));
  });

  it('keeps every page-scoped tool out of the shared main-process registry', (): void => {
    expect(getToolRegistryEntry('read_current_document')).toBeUndefined();
    expect(getToolRegistryEntry('read_current_widget')).toBeUndefined();
    expect(getToolRegistryEntry('read_current_webpage')).toBeUndefined();
    expect(getToolRegistryEntry('operate_webpage')).toBeUndefined();
  });

  it('can derive tool names by renderer exposure policy', (): void => {
    expect(getToolNamesByExposure('default-readonly')).toEqual(
      expect.arrayContaining(['get_current_time', 'read_file', 'get_settings', 'query_logs', 'open_resource'])
    );
    expect(getToolNamesByExposure('default-readonly')).not.toContain('read_current_document');
    expect(getToolNamesByExposure('default-writable')).toEqual(expect.arrayContaining(['create_document', 'edit_file', 'write_file', 'update_settings']));
    expect(getToolNamesByExposure('conditional-readonly')).toEqual(expect.arrayContaining(['read_directory', 'glob', 'grep', 'get_mcp_settings']));
    expect(getToolNamesByExposure('conditional-readonly')).not.toContain('read_current_widget');
    expect(getToolNamesByExposure('conditional-writable')).toEqual(
      expect.arrayContaining(['add_mcp_server', 'update_mcp_server', 'remove_mcp_server', 'refresh_mcp_discovery'])
    );
    expect(getToolNamesByExposure('chat-default').sort()).toEqual(
      [...getToolNamesByExposure('default-readonly'), ...getToolNamesByExposure('default-writable')].sort()
    );
    expect(getToolNamesByExposure('chat-default')).not.toEqual(expect.arrayContaining(getToolNamesByExposure('conditional-readonly')));
    expect(getToolNamesByExposure('chat-default')).not.toEqual(expect.arrayContaining(getToolNamesByExposure('conditional-writable')));
    expect(getToolNamesByExposure('chat-default')).not.toContain(DELEGATE_TASK_TOOL_NAME);
  });

  it('registers delegate_task as internal deferred coordination', (): void => {
    expect(getToolRegistryEntry(DELEGATE_TASK_TOOL_NAME)).toMatchObject({
      runtime: 'coordinator',
      group: 'agent',
      exposure: 'internal',
      executionClass: 'deferred-coordination',
      effect: {
        effect: 'pure_read',
        resourceScopeResolver: 'delegate-contract',
        reversible: true
      }
    });
    expect(TOOL_REGISTRY.every((entry) => Boolean(entry.executionClass) && Boolean(entry.effect))).toBe(true);
  });

  it('registers staged file mutations as internal reversible capabilities', (): void => {
    expect(getToolRegistryEntry('stage_file_write')).toMatchObject({
      runtime: 'main',
      group: 'file',
      exposure: 'internal',
      executionClass: 'direct',
      effect: {
        effect: 'staged_file_write',
        resourceScopeResolver: 'file-path',
        commitAdapter: 'atomic-file-v1',
        reversible: true
      }
    });
    expect(getToolRegistryEntry('stage_file_edit')).toMatchObject({
      runtime: 'main',
      group: 'file',
      exposure: 'internal',
      executionClass: 'direct',
      effect: {
        effect: 'staged_file_write',
        resourceScopeResolver: 'file-path',
        commitAdapter: 'atomic-file-v1',
        reversible: true
      }
    });
    expect(getToolNamesByExposure('chat-default')).not.toEqual(expect.arrayContaining(['stage_file_write', 'stage_file_edit']));
  });

  it('classifies direct file mutations as immediate side effects until an overlay exists', (): void => {
    expect(writeFileToolRegistryEntry.effect).toMatchObject({
      effect: 'immediate_side_effect',
      resourceScopeResolver: 'file-path',
      reversible: false
    });
    expect(editFileToolRegistryEntry.effect).toMatchObject({
      effect: 'immediate_side_effect',
      resourceScopeResolver: 'file-path',
      reversible: false
    });
  });

  it('publishes the bounded delegate task contract schema', (): void => {
    const definition = getToolDefinitionByName(DELEGATE_TASK_TOOL_NAME);

    expect(definition?.parameters).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['task', 'acceptanceCriteria', 'mode', 'resources', 'requestedTools', 'required', 'priority']
    });
    expect(definition?.parameters.properties).toMatchObject({
      task: { type: 'string', minLength: 1 },
      acceptanceCriteria: { type: 'array', minItems: 1 },
      mode: { type: 'string', enum: ['read', 'write'] },
      resources: { type: 'array', minItems: 1 },
      requestedTools: { type: 'array', uniqueItems: true },
      required: { type: 'boolean' },
      priority: { type: 'string', enum: ['low', 'normal', 'high'] },
      deadlineAt: { type: 'string', format: 'date-time' }
    });
  });

  it('describes theme presets as complete color moods instead of a bland theme color', (): void => {
    const getDescription = String(getSettingsToolRegistryEntry.definition.description);
    const updateDescription = String(updateSettingsToolRegistryEntry.definition.description);
    const valueDescription = String(updateSettingsToolRegistryEntry.definition.parameters.properties.value.description);
    const settingsDescriptions = `${getDescription}\n${updateDescription}`;

    expect(settingsDescriptions).not.toContain('主题色');
    expect(settingsDescriptions).not.toContain('等');
    expect(getDescription).toContain('主题预设');
    expect(updateDescription).toContain('色彩氛围');
    expect(valueDescription).toContain('整套界面色彩预设');
    expect(valueDescription).toContain('default=白/浅灰/黑灰');
    expect(valueDescription).toContain('classic=暖米白/棕色');
    expect(valueDescription).not.toContain('graphite=');
    expect(valueDescription).toContain('dark=深色');
    expect(valueDescription).toContain('light=浅色');
    expect(valueDescription).toContain('system=跟随系统');
    expect(valueDescription).toContain('sourceMode');
    expect(valueDescription).toContain('true=源码模式');
    expect(valueDescription).toContain('false=富文本模式');
    expect(valueDescription).toContain('editorPageWidth');
    expect(valueDescription).toContain('default=默认宽度');
    expect(valueDescription).toContain('wide=宽屏');
    expect(valueDescription).toContain('full=全宽');
    expect(valueDescription).not.toContain('布尔设置');
  });

  it('composes settings descriptions from shared setting detail fragments', (): void => {
    expect(settingsToolSource).toContain('SETTING_DETAIL_DESCRIPTIONS');
    expect(settingsToolSource).toContain('SETTING_SUMMARY_DESCRIPTION');
    expect(settingsToolSource).toContain('SETTING_VALUE_DESCRIPTION');
    expect(settingsToolSource).toContain('SUPPORTED_SETTING_KEYS.map');
  });

  it('requires paths for direct file and directory reads', (): void => {
    const readFileDefinition = getToolDefinitionByName(READ_FILE_TOOL_NAME);
    const readDirectoryDefinition = getToolDefinitionByName(READ_DIRECTORY_TOOL_NAME);

    expect(readFileDefinition?.parameters.required).toContain('path');
    expect(readDirectoryDefinition?.parameters.required).toContain('path');
  });

  it('describes the selection boundary between file tools', (): void => {
    const readFileDescription = String(getToolDefinitionByName(READ_FILE_TOOL_NAME)?.description);
    const readDirectoryDescription = String(getToolDefinitionByName(READ_DIRECTORY_TOOL_NAME)?.description);
    const writeFileDescription = String(getToolDefinitionByName(WRITE_FILE_TOOL_NAME)?.description);
    const editFileDescription = String(getToolDefinitionByName(EDIT_FILE_TOOL_NAME)?.description);

    expect(readFileDescription).toContain('edit_file');
    expect(readDirectoryDescription).toContain('glob');
    expect(readDirectoryDescription).toContain('read_file');
    expect(writeFileDescription).toContain('完整');
    expect(writeFileDescription).toContain('父目录');
    expect(writeFileDescription).toContain('磁盘');
    expect(writeFileDescription).toContain('edit_file');
    expect(editFileDescription).toContain('精确');
    expect(editFileDescription).toContain('read_file');
    expect(editFileDescription).toContain('磁盘');
  });
});
