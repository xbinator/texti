/**
 * @file index.ts
 * @description Child Agent 私有 overlay 使用的暂存文件工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 暂存完整文件内容的工具名称。 */
export const STAGE_FILE_WRITE_TOOL_NAME = 'stage_file_write';

/** 暂存精确文件编辑的工具名称。 */
export const STAGE_FILE_EDIT_TOOL_NAME = 'stage_file_edit';

/** 受控写入协议固定使用的原子文件提交适配器。 */
export const AGENT_FILE_COMMIT_ADAPTER = 'atomic-file-v1';

/** 在 Task 私有 overlay 中创建或完整替换文本文件的 registry 条目。 */
export const stageFileWriteToolRegistryEntry = {
  runtime: 'main',
  group: 'file',
  exposure: 'internal',
  executionClass: 'direct',
  effect: {
    effect: 'staged_file_write',
    resourceScopeResolver: 'file-path',
    commitAdapter: AGENT_FILE_COMMIT_ADAPTER,
    reversible: true
  },
  definition: {
    name: STAGE_FILE_WRITE_TOOL_NAME,
    description: '在当前 Child Task 私有 overlay 中创建或完整替换文本文件；不会直接修改工作区。',
    source: 'builtin',
    riskLevel: 'write',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '冻结 resource scope 内的工作区相对或绝对文件路径。' },
        content: { type: 'string', description: '候选完整文本内容。' }
      },
      required: ['path', 'content'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;

/** 在 Task 私有 overlay 中执行精确文本替换的 registry 条目。 */
export const stageFileEditToolRegistryEntry = {
  runtime: 'main',
  group: 'file',
  exposure: 'internal',
  executionClass: 'direct',
  effect: {
    effect: 'staged_file_write',
    resourceScopeResolver: 'file-path',
    commitAdapter: AGENT_FILE_COMMIT_ADAPTER,
    reversible: true
  },
  definition: {
    name: STAGE_FILE_EDIT_TOOL_NAME,
    description: '在当前 Child Task 私有 overlay 中精确替换文本；不会直接修改工作区。',
    source: 'builtin',
    riskLevel: 'write',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '冻结 resource scope 内的已有文本文件路径。' },
        oldString: { type: 'string', description: '待替换的原始文本。' },
        newString: { type: 'string', description: '写入 overlay 的替换文本。' },
        replaceAll: { type: 'boolean', description: '是否替换全部匹配项，默认 false。' }
      },
      required: ['path', 'oldString', 'newString'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
