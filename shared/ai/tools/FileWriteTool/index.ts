/**
 * @file index.ts
 * @description 文件写入相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 写入文件工具名称。 */
export const WRITE_FILE_TOOL_NAME = 'write_file';

/** 写入文件工具 registry 条目。 */
export const writeFileToolRegistryEntry = {
  runtime: 'main',
  group: 'file',
  exposure: 'default-writable',
  executionClass: 'direct',
  effect: {
    effect: 'immediate_side_effect',
    resourceScopeResolver: 'file-path',
    reversible: false
  },
  definition: {
    name: WRITE_FILE_TOOL_NAME,
    description:
      '将完整内容写入目标，用于创建新文件或有意完整覆盖已有文件；局部修改请使用 edit_file。真实文件会直接持久化到磁盘，并在创建新文件时创建缺失的父目录；unsaved:// 只更新草稿。',
    source: 'builtin',
    riskLevel: 'write',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径，支持工作区相对路径、POSIX/Windows 绝对路径或 unsaved:// 未保存草稿路径。' },
        content: { type: 'string', description: '新的完整文件内容。' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
