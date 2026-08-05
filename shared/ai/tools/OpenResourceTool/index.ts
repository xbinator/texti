/**
 * @file index.ts
 * @description 资源打开相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 打开资源工具名称。 */
export const OPEN_RESOURCE_TOOL_NAME = 'open_resource';

/** 打开资源工具 registry 条目。 */
export const openResourceToolRegistryEntry = {
  runtime: 'main',
  group: 'resource',
  exposure: 'default-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'immediate_side_effect',
    resourceScopeResolver: 'resource-reference',
    reversible: false
  },
  definition: {
    name: OPEN_RESOURCE_TOOL_NAME,
    description:
      '根据用户指令打开文件、内置网页或外部链接。文件路径支持相对工作区路径或绝对路径（外部路径需用户确认）；http/https 可打开内置网页，mailto/ftp 链接使用系统默认程序打开。',
    source: 'builtin',
    riskLevel: 'read',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    safeAutoApprove: true,
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（支持相对工作区路径或绝对路径）或网址（http/https/mailto/ftp）。' }
      },
      required: ['path'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
