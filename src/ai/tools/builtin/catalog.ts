/**
 * @file catalog.ts
 * @description 内置工具名称清单与默认暴露策略。
 */

/**
 * 默认开放的只读内置工具名称列表。
 */
export const DEFAULT_BUILTIN_READONLY_TOOL_NAMES = [
  'read_current_document',
  'get_current_time',
  'search_current_document',
  'ask_user_choice',
  'read_file'
] as const;

/**
 * 默认开放的低风险写入内置工具名称列表。
 */
export const DEFAULT_BUILTIN_WRITABLE_TOOL_NAMES = ['insert_at_cursor', 'update_settings'] as const;

/**
 * 获取默认聊天工具名称列表。
 * @returns 默认聊天工具名称数组
 */
export function getDefaultBuiltinChatToolNames(): string[] {
  return [...DEFAULT_BUILTIN_READONLY_TOOL_NAMES, ...DEFAULT_BUILTIN_WRITABLE_TOOL_NAMES];
}

/**
 * 判断工具名称是否属于默认只读工具。
 * @param toolName - 工具名称
 * @returns 是否为默认只读工具
 */
export function isDefaultBuiltinReadonlyToolName(toolName: string): boolean {
  return DEFAULT_BUILTIN_READONLY_TOOL_NAMES.includes(toolName as (typeof DEFAULT_BUILTIN_READONLY_TOOL_NAMES)[number]);
}

/**
 * 判断工具名称是否属于默认低风险写工具。
 * @param toolName - 工具名称
 * @returns 是否为默认低风险写工具
 */
export function isDefaultBuiltinWritableToolName(toolName: string): boolean {
  return DEFAULT_BUILTIN_WRITABLE_TOOL_NAMES.includes(toolName as (typeof DEFAULT_BUILTIN_WRITABLE_TOOL_NAMES)[number]);
}
