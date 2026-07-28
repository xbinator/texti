/**
 * @file index.ts
 * @description MCP 设置相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 获取 MCP 设置工具名称。 */
export const GET_MCP_SETTINGS_TOOL_NAME = 'get_mcp_settings';

/** 新增 MCP server 工具名称。 */
export const ADD_MCP_SERVER_TOOL_NAME = 'add_mcp_server';

/** 更新 MCP server 工具名称。 */
export const UPDATE_MCP_SERVER_TOOL_NAME = 'update_mcp_server';

/** 删除 MCP server 工具名称。 */
export const REMOVE_MCP_SERVER_TOOL_NAME = 'remove_mcp_server';

/** 刷新 MCP discovery 工具名称。 */
export const REFRESH_MCP_DISCOVERY_TOOL_NAME = 'refresh_mcp_discovery';

/** 获取 MCP 设置工具 registry 条目。 */
export const getMcpSettingsToolRegistryEntry = {
  runtime: 'main',
  group: 'settings',
  exposure: 'conditional-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'mcp-settings',
    reversible: true
  },
  definition: {
    name: GET_MCP_SETTINGS_TOOL_NAME,
    description: '获取当前 MCP 配置，包括本地 stdio server、命令、参数、环境变量、allowlist 与超时设置。',
    source: 'builtin',
    riskLevel: 'read',
    permissionCategory: 'settings',
    safeAutoApprove: true,
    requiresActiveDocument: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  }
} satisfies ToolRegistryEntry;

/** 新增 MCP server 工具 registry 条目。 */
export const addMcpServerToolRegistryEntry = {
  runtime: 'main',
  group: 'settings',
  exposure: 'conditional-writable',
  executionClass: 'direct',
  effect: {
    effect: 'immediate_side_effect',
    resourceScopeResolver: 'mcp-server',
    reversible: false
  },
  definition: {
    name: ADD_MCP_SERVER_TOOL_NAME,
    description: '新增一个本地 stdio MCP server 配置。该工具只写入配置，不会立即执行 server。',
    source: 'builtin',
    riskLevel: 'write',
    permissionCategory: 'settings',
    safeAutoApprove: false,
    requiresActiveDocument: false,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '展示名称。' },
        enabled: { type: 'boolean', description: '是否启用，默认 true。' },
        command: { type: 'string', description: '本地启动命令，例如 npx、node、python。' },
        args: { type: 'array', items: { type: 'string' }, description: '启动参数。' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: '环境变量字典。' },
        toolAllowlist: { type: 'array', items: { type: 'string' }, description: '允许暴露的 MCP tool 名称，空数组表示不额外限制。' },
        connectTimeoutMs: { type: 'number', description: '连接与握手超时，单位毫秒。' },
        toolCallTimeoutMs: { type: 'number', description: '工具调用超时，单位毫秒。' }
      },
      required: ['command'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;

/** 更新 MCP server 工具 registry 条目。 */
export const updateMcpServerToolRegistryEntry = {
  runtime: 'main',
  group: 'settings',
  exposure: 'conditional-writable',
  executionClass: 'direct',
  effect: {
    effect: 'immediate_side_effect',
    resourceScopeResolver: 'mcp-server',
    reversible: false
  },
  definition: {
    name: UPDATE_MCP_SERVER_TOOL_NAME,
    description: '更新一个本地 stdio MCP server 配置。',
    source: 'builtin',
    riskLevel: 'write',
    permissionCategory: 'settings',
    safeAutoApprove: false,
    requiresActiveDocument: false,
    parameters: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'MCP server ID。' },
        patch: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            enabled: { type: 'boolean' },
            command: { type: 'string' },
            args: { type: 'array', items: { type: 'string' } },
            env: { type: 'object', additionalProperties: { type: 'string' } },
            toolAllowlist: { type: 'array', items: { type: 'string' } },
            connectTimeoutMs: { type: 'number' },
            toolCallTimeoutMs: { type: 'number' }
          },
          additionalProperties: false
        }
      },
      required: ['serverId', 'patch'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;

/** 删除 MCP server 工具 registry 条目。 */
export const removeMcpServerToolRegistryEntry = {
  runtime: 'main',
  group: 'settings',
  exposure: 'conditional-writable',
  executionClass: 'direct',
  effect: {
    effect: 'immediate_side_effect',
    resourceScopeResolver: 'mcp-server',
    reversible: false
  },
  definition: {
    name: REMOVE_MCP_SERVER_TOOL_NAME,
    description: '删除一个本地 MCP server 配置。',
    source: 'builtin',
    riskLevel: 'write',
    permissionCategory: 'settings',
    safeAutoApprove: false,
    requiresActiveDocument: false,
    parameters: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'MCP server ID。' }
      },
      required: ['serverId'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;

/** 刷新 MCP discovery 工具 registry 条目。 */
export const refreshMcpDiscoveryToolRegistryEntry = {
  runtime: 'main',
  group: 'settings',
  exposure: 'conditional-writable',
  executionClass: 'direct',
  effect: {
    effect: 'immediate_side_effect',
    resourceScopeResolver: 'mcp-server',
    reversible: false
  },
  definition: {
    name: REFRESH_MCP_DISCOVERY_TOOL_NAME,
    description: '刷新指定 MCP server 的工具发现缓存。该操作会在本地启动配置的 stdio MCP server 并执行 tools/list。',
    source: 'builtin',
    riskLevel: 'write',
    permissionCategory: 'settings',
    safeAutoApprove: false,
    requiresActiveDocument: false,
    parameters: {
      type: 'object',
      properties: {
        serverId: { type: 'string', description: 'MCP server ID。' }
      },
      required: ['serverId'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
