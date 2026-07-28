/**
 * @file index.ts
 * @description 文件编辑相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 编辑文件工具名称。 */
export const EDIT_FILE_TOOL_NAME = 'edit_file';

/** 编辑文件工具 registry 条目。 */
export const editFileToolRegistryEntry = {
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
    name: EDIT_FILE_TOOL_NAME,
    description:
      '在已有文本文件或未保存草稿中执行精确字符串替换，并保留其他内容。通常先用 read_file 获取准确的 oldString；文件不存在、原文未命中或存在未授权的多处匹配时会失败。真实文件会直接持久化到磁盘。',
    source: 'builtin',
    riskLevel: 'write',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '已有文件路径，支持工作区相对路径、POSIX/Windows 绝对路径或 unsaved:// 未保存草稿路径。' },
        oldString: { type: 'string', description: '待替换的原始文本。' },
        newString: { type: 'string', description: '替换后的文本。' },
        replaceAll: { type: 'boolean', description: '是否替换全部匹配项，默认 false。' }
      },
      required: ['path', 'oldString', 'newString'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
