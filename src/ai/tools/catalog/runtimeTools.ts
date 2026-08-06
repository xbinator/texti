/**
 * @file runtimeTools.ts
 * @description 已迁移到 ChatRuntime 主进程执行的工具 schema-only 工厂。
 */
import type { AIToolDefinition, AIToolExecutor } from 'types/ai';
import {
  ADD_MCP_SERVER_TOOL_NAME,
  CREATE_DOCUMENT_TOOL_NAME,
  DELEGATE_TASK_TOOL_NAME,
  EDIT_FILE_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  GET_MCP_SETTINGS_TOOL_NAME,
  GET_SETTINGS_TOOL_NAME,
  OPEN_RESOURCE_TOOL_NAME,
  QUERY_LOGS_TOOL_NAME,
  READ_DIRECTORY_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  REFRESH_MCP_DISCOVERY_TOOL_NAME,
  REMOVE_MCP_SERVER_TOOL_NAME,
  TOOL_REGISTRY,
  UPDATE_MCP_SERVER_TOOL_NAME,
  UPDATE_SETTINGS_TOOL_NAME,
  WRITE_FILE_TOOL_NAME,
  getToolDefinitionByName
} from '@@/shared/ai/tools/index.ts';
import { createToolFailureResult } from '../results';

export {
  ADD_MCP_SERVER_TOOL_NAME,
  CREATE_DOCUMENT_TOOL_NAME,
  DELEGATE_TASK_TOOL_NAME,
  EDIT_FILE_TOOL_NAME,
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
  GET_MCP_SETTINGS_TOOL_NAME,
  GET_SETTINGS_TOOL_NAME,
  OPEN_RESOURCE_TOOL_NAME,
  QUERY_LOGS_TOOL_NAME,
  READ_DIRECTORY_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  REFRESH_MCP_DISCOVERY_TOOL_NAME,
  REMOVE_MCP_SERVER_TOOL_NAME,
  UPDATE_MCP_SERVER_TOOL_NAME,
  UPDATE_SETTINGS_TOOL_NAME,
  WRITE_FILE_TOOL_NAME
} from '@@/shared/ai/tools/index.ts';

/**
 * 创建主进程工具的 renderer 侧 schema-only 执行器。
 * @param definition - 工具定义
 * @returns schema-only 工具执行器
 */
export function createMainProcessBuiltinTool(definition: AIToolDefinition): AIToolExecutor {
  return {
    definition,
    async execute() {
      return createToolFailureResult(definition.name, 'EXECUTION_FAILED', `工具 ${definition.name} 已迁移到 ChatRuntime 主进程执行`);
    }
  };
}

/**
 * 读取 registry 中的工具定义。
 * @param toolName - 工具名称
 * @returns 工具定义
 */
function requireRuntimeToolDefinition(toolName: string): AIToolDefinition {
  const definition = getToolDefinitionByName(toolName);
  if (!definition) {
    throw new Error(`Missing runtime tool definition: ${toolName}`);
  }

  return definition;
}

/**
 * 根据 registry 工具名称创建 schema-only 工具。
 * @param toolName - 工具名称
 * @returns 工具执行器
 */
function createRuntimeToolByName(toolName: string): AIToolExecutor {
  return createMainProcessBuiltinTool(requireRuntimeToolDefinition(toolName));
}

/**
 * 创建指定工具的 schema-only 工厂。
 * @param toolName - 工具名称
 * @returns 工具工厂
 */
function createRuntimeToolFactory(toolName: string): () => AIToolExecutor {
  return () => createRuntimeToolByName(toolName);
}

/**
 * 按工具名称索引的 schema-only 工厂映射。
 */
export const RUNTIME_TOOL_FACTORIES: Readonly<Record<string, () => AIToolExecutor>> = Object.freeze(
  Object.fromEntries(TOOL_REGISTRY.map((entry) => [entry.definition.name, createRuntimeToolFactory(entry.definition.name)]))
);

/**
 * 读取指定工具的 schema-only 工厂。
 * @param toolName - 工具名称
 * @returns 工具工厂
 */
function getRuntimeToolFactory(toolName: string): () => AIToolExecutor {
  const factory = RUNTIME_TOOL_FACTORIES[toolName];
  if (!factory) {
    throw new Error(`Missing runtime tool factory: ${toolName}`);
  }

  return factory;
}

/**
 * 创建 create_document schema-only 工具。
 */
export const createCreateDocumentTool = getRuntimeToolFactory(CREATE_DOCUMENT_TOOL_NAME);

/**
 * 创建 read_file schema-only 工具。
 */
export const createReadFileTool = getRuntimeToolFactory(READ_FILE_TOOL_NAME);

/**
 * 创建 read_directory schema-only 工具。
 */
export const createReadDirectoryTool = getRuntimeToolFactory(READ_DIRECTORY_TOOL_NAME);

/**
 * 创建 glob schema-only 工具。
 */
export const createGlobTool = getRuntimeToolFactory(GLOB_TOOL_NAME);

/**
 * 创建 grep schema-only 工具。
 */
export const createGrepTool = getRuntimeToolFactory(GREP_TOOL_NAME);

/**
 * 创建 write_file schema-only 工具。
 */
export const createWriteFileTool = getRuntimeToolFactory(WRITE_FILE_TOOL_NAME);

/**
 * 创建 edit_file schema-only 工具。
 */
export const createEditFileTool = getRuntimeToolFactory(EDIT_FILE_TOOL_NAME);

/**
 * 创建 query_logs schema-only 工具。
 */
export const createQueryLogsTool = getRuntimeToolFactory(QUERY_LOGS_TOOL_NAME);

/**
 * 创建 get_settings schema-only 工具。
 */
export const createGetSettingsTool = getRuntimeToolFactory(GET_SETTINGS_TOOL_NAME);

/**
 * 创建 update_settings schema-only 工具。
 */
export const createUpdateSettingsTool = getRuntimeToolFactory(UPDATE_SETTINGS_TOOL_NAME);

/**
 * 创建 get_mcp_settings schema-only 工具。
 */
export const createGetMcpSettingsTool = getRuntimeToolFactory(GET_MCP_SETTINGS_TOOL_NAME);

/**
 * 创建 add_mcp_server schema-only 工具。
 */
export const createAddMcpServerTool = getRuntimeToolFactory(ADD_MCP_SERVER_TOOL_NAME);

/**
 * 创建 update_mcp_server schema-only 工具。
 */
export const createUpdateMcpServerTool = getRuntimeToolFactory(UPDATE_MCP_SERVER_TOOL_NAME);

/**
 * 创建 remove_mcp_server schema-only 工具。
 */
export const createRemoveMcpServerTool = getRuntimeToolFactory(REMOVE_MCP_SERVER_TOOL_NAME);

/** 创建 refresh_mcp_discovery schema-only 工具。 */
export const createRefreshMcpDiscoveryTool = getRuntimeToolFactory(REFRESH_MCP_DISCOVERY_TOOL_NAME);

/** 创建 open_resource schema-only 工具。 */
export const createOpenResourceTool = getRuntimeToolFactory(OPEN_RESOURCE_TOOL_NAME);

/** 创建内部 delegate_task schema-only 工具。 */
export const createDelegateTaskTool = getRuntimeToolFactory(DELEGATE_TASK_TOOL_NAME);
