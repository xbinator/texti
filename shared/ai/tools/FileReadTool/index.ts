/**
 * @file index.ts
 * @description 文件读取相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 读取文件工具名称。 */
export const READ_FILE_TOOL_NAME = 'read_file';

/** 读取目录工具名称。 */
export const READ_DIRECTORY_TOOL_NAME = 'read_directory';

/** Glob 文件搜索工具名称。 */
export const GLOB_TOOL_NAME = 'glob';

/** Grep 内容搜索工具名称。 */
export const GREP_TOOL_NAME = 'grep';

/** 读取文件工具 registry 条目。 */
export const readFileToolRegistryEntry = {
  runtime: 'main',
  group: 'file',
  exposure: 'default-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'file-path',
    reversible: true
  },
  definition: {
    name: READ_FILE_TOOL_NAME,
    description: '读取一个本地文本文件或未保存草稿的内容，支持通过 offset 和 limit 分段读取。需要局部修改文件时，先用此工具获取 edit_file 所需的精确原文。',
    source: 'builtin',
    riskLevel: 'read',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '文件路径，支持工作区相对路径、POSIX/Windows 绝对路径或 unsaved:// 未保存草稿路径。工作区外路径可能需要用户确认。'
        },
        offset: { type: 'number', description: '起始行号，默认 1。' },
        limit: { type: 'number', description: '读取行数；不传时读取到文件末尾。' }
      },
      required: ['path'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;

/** 读取目录工具 registry 条目。 */
export const readDirectoryToolRegistryEntry = {
  runtime: 'main',
  group: 'file',
  exposure: 'conditional-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'directory-path',
    reversible: true
  },
  definition: {
    name: READ_DIRECTORY_TOOL_NAME,
    description: '列出一个本地目录的直接子项，包括文件和子目录；不递归且不读取文件内容。需要递归查找文件时使用 glob，需要读取正文时使用 read_file。',
    source: 'builtin',
    riskLevel: 'read',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径，支持工作区相对路径或 POSIX/Windows 绝对路径。工作区外路径可能需要用户确认。' }
      },
      required: ['path'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;

/** Glob 文件搜索工具 registry 条目。 */
export const globToolRegistryEntry = {
  runtime: 'main',
  group: 'file',
  exposure: 'conditional-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'glob-root',
    reversible: true
  },
  definition: {
    name: GLOB_TOOL_NAME,
    description:
      '按 glob 路径模式递归查找本地文件，仅返回文件路径，不读取文件内容。pattern 使用 glob 语义，支持 *、?、**，常见扩展写法由 picomatch 兼容处理。相对路径需要工作区根目录，工作区外绝对路径需要用户确认；部分路径不可读时会返回 incomplete 和 warnings。',
    source: 'builtin',
    riskLevel: 'read',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '文件路径 glob 模式，例如 **/*.ts 或 **/*.{ts,tsx}。' },
        path: { type: 'string', description: '搜索目录路径，支持相对工作区路径或绝对路径；不传时使用当前工作区根目录。' }
      },
      required: ['pattern'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;

/** Grep 内容搜索工具 registry 条目。 */
export const grepToolRegistryEntry = {
  runtime: 'main',
  group: 'file',
  exposure: 'conditional-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'grep-root',
    reversible: true
  },
  definition: {
    name: GREP_TOOL_NAME,
    description:
      '使用系统 grep -E 在本地文件中搜索内容，返回匹配文件、行号和文本。pattern 使用系统 grep -E 扩展正则语义，不兼容 ripgrep 专有语义；' +
      'include 是文件 glob，由 Tibis 在执行前筛选候选文件。部分文件不可读时会返回 incomplete 和 warnings。',
    source: 'builtin',
    riskLevel: 'read',
    requiresActiveDocument: false,
    permissionCategory: 'system',
    parameters: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: '传给 grep -E 的扩展正则表达式。' },
        path: { type: 'string', description: '搜索文件或目录路径，支持相对工作区路径或绝对路径；不传时使用当前工作区根目录。' },
        include: { type: 'string', description: '候选文件 glob，例如 **/*.ts 或 **/*.{ts,tsx}。' }
      },
      required: ['pattern'],
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
