/**
 * @file index.ts
 * @description ChatRuntime 跨进程工具 registry 聚合出口。
 */
import type { SharedToolDefinition, ToolExposureQuery, ToolRegistryEntry, ToolRuntimeGroup, ToolRuntimeOwner } from './types.js';
import { stageFileEditToolRegistryEntry, stageFileWriteToolRegistryEntry } from './AgentStagedFileTool/index.js';
import { delegateTaskToolRegistryEntry } from './DelegateTaskTool/index.js';
import { createDocumentToolRegistryEntry } from './DocumentTool/index.js';
import { editFileToolRegistryEntry } from './FileEditTool/index.js';
import { globToolRegistryEntry, grepToolRegistryEntry, readDirectoryToolRegistryEntry, readFileToolRegistryEntry } from './FileReadTool/index.js';
import { writeFileToolRegistryEntry } from './FileWriteTool/index.js';
import { queryLogsToolRegistryEntry } from './LogsTool/index.js';
import {
  addMcpServerToolRegistryEntry,
  getMcpSettingsToolRegistryEntry,
  refreshMcpDiscoveryToolRegistryEntry,
  removeMcpServerToolRegistryEntry,
  updateMcpServerToolRegistryEntry
} from './MCPSettingsTool/index.js';
import { openResourceToolRegistryEntry } from './OpenResourceTool/index.js';
import { getSettingsToolRegistryEntry, updateSettingsToolRegistryEntry } from './SettingsTool/index.js';

export type {
  AgentToolEffectMetadata,
  SharedToolDefinition,
  SharedToolParameterSchema,
  SharedToolRiskLevel,
  SharedToolSource,
  ToolExposure,
  ToolExposureQuery,
  ToolExecutionClass,
  ToolJsonSchema,
  ToolRegistryEntry,
  ToolRuntimeGroup,
  ToolRuntimeOwner
} from './types.js';
export { AGENT_FILE_COMMIT_ADAPTER, STAGE_FILE_EDIT_TOOL_NAME, STAGE_FILE_WRITE_TOOL_NAME } from './AgentStagedFileTool/index.js';
export { DELEGATE_TASK_TOOL_NAME } from './DelegateTaskTool/index.js';
export { CREATE_DOCUMENT_TOOL_NAME } from './DocumentTool/index.js';
export { EDIT_FILE_TOOL_NAME } from './FileEditTool/index.js';
export { GLOB_TOOL_NAME, GREP_TOOL_NAME, READ_DIRECTORY_TOOL_NAME, READ_FILE_TOOL_NAME } from './FileReadTool/index.js';
export { WRITE_FILE_TOOL_NAME } from './FileWriteTool/index.js';
export { QUERY_LOGS_TOOL_NAME } from './LogsTool/index.js';
export {
  ADD_MCP_SERVER_TOOL_NAME,
  GET_MCP_SETTINGS_TOOL_NAME,
  REFRESH_MCP_DISCOVERY_TOOL_NAME,
  REMOVE_MCP_SERVER_TOOL_NAME,
  UPDATE_MCP_SERVER_TOOL_NAME
} from './MCPSettingsTool/index.js';
export { OPEN_RESOURCE_TOOL_NAME } from './OpenResourceTool/index.js';
export { GET_SETTINGS_TOOL_NAME, UPDATE_SETTINGS_TOOL_NAME } from './SettingsTool/index.js';

/** 已迁移到主进程的工具 registry。 */
export const TOOL_REGISTRY = [
  createDocumentToolRegistryEntry,
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
  delegateTaskToolRegistryEntry
] as const satisfies ToolRegistryEntry[];

/**
 * 按名称读取完整工具 registry 条目。
 * @param toolName - 工具名称
 * @returns registry 条目
 */
export function getToolRegistryEntry(toolName: string): ToolRegistryEntry | undefined {
  return TOOL_REGISTRY.find((entry) => entry.definition.name === toolName);
}

/**
 * 按名称读取工具定义。
 * @param toolName - 工具名称
 * @returns 工具定义
 */
export function getToolDefinitionByName(toolName: string): SharedToolDefinition | undefined {
  return getToolRegistryEntry(toolName)?.definition;
}

/**
 * 按 runtime 和 group 派生工具名称。
 * @param runtime - 工具运行时归属
 * @param group - 工具分组
 * @returns 工具名称列表
 */
export function getToolNamesByRuntimeGroup(runtime: ToolRuntimeOwner, group: ToolRuntimeGroup): string[] {
  return TOOL_REGISTRY.filter((entry) => entry.runtime === runtime && entry.group === group).map((entry) => entry.definition.name);
}

/**
 * 按 renderer 暴露策略派生工具名称。
 * @param exposure - 工具暴露策略
 * @returns 工具名称列表
 */
export function getToolNamesByExposure(exposure: ToolExposureQuery): string[] {
  if (exposure === 'chat-default') {
    return TOOL_REGISTRY.filter((entry) => entry.exposure === 'default-readonly' || entry.exposure === 'default-writable').map(
      (entry) => entry.definition.name
    );
  }
  return TOOL_REGISTRY.filter((entry) => entry.exposure === exposure).map((entry) => entry.definition.name);
}
