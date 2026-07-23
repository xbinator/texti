/**
 * @file index.ts
 * @description 环境信息相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 获取当前时间工具名称。 */
export const GET_CURRENT_TIME_TOOL_NAME = 'get_current_time';

/** 获取当前时间工具 registry 条目。 */
export const getCurrentTimeToolRegistryEntry = {
  runtime: 'main',
  group: 'read',
  exposure: 'default-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'system-clock',
    reversible: true
  },
  definition: {
    name: GET_CURRENT_TIME_TOOL_NAME,
    description: '获取当前系统时间，返回 ISO、时间戳和本地格式化字符串。',
    source: 'builtin',
    riskLevel: 'read',
    permissionCategory: 'system',
    requiresActiveDocument: false,
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  }
} satisfies ToolRegistryEntry;
