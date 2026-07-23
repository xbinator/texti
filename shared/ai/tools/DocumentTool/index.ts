/**
 * @file index.ts
 * @description 文档相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 读取当前文档工具名称。 */
export const READ_CURRENT_DOCUMENT_TOOL_NAME = 'read_current_document';

/** 创建文档工具名称。 */
export const CREATE_DOCUMENT_TOOL_NAME = 'create_document';

/** 读取当前文档工具 registry 条目。 */
export const readCurrentDocumentToolRegistryEntry = {
  runtime: 'main',
  group: 'read',
  exposure: 'default-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'active-document',
    reversible: true
  },
  definition: {
    name: READ_CURRENT_DOCUMENT_TOOL_NAME,
    description: '读取当前编辑器文档的标题、路径、Markdown 内容和用户选中的内容。',
    source: 'builtin',
    riskLevel: 'read',
    parameters: { type: 'object', properties: {}, additionalProperties: false }
  }
} satisfies ToolRegistryEntry;

/** 创建文档工具 registry 条目。 */
export const createDocumentToolRegistryEntry = {
  runtime: 'main',
  group: 'file',
  exposure: 'default-writable',
  executionClass: 'direct',
  effect: {
    effect: 'immediate_side_effect',
    resourceScopeResolver: 'document-session',
    reversible: false
  },
  definition: {
    name: CREATE_DOCUMENT_TOOL_NAME,
    description: '创建新的编辑器文档（未保存草稿）。提供标题和初始内容，将在编辑器中打开新标签页供用户编辑。',
    source: 'builtin',
    riskLevel: 'write',
    requiresActiveDocument: false,
    permissionCategory: 'document',
    safeAutoApprove: true,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '文档标题/文件名，如 "README"。' },
        content: { type: 'string', description: '文档的初始内容。' },
        ext: { type: 'string', description: '文件扩展名，默认为 "md"。支持 md、txt、json 等。' }
      },
      required: ['title', 'content'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
