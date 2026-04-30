/**
 * @file catalog.ts
 * @description 内置工具名称清单与默认暴露策略。
 */
import { ASK_USER_CHOICE_TOOL_NAME } from './ask-user-choice';
import { GET_CURRENT_TIME_TOOL_NAME } from './environment';
import { QUERY_LOGS_TOOL_NAME } from './logs';
import { READ_CURRENT_DOCUMENT_TOOL_NAME, SEARCH_CURRENT_DOCUMENT_TOOL_NAME } from './read';
import { READ_DIRECTORY_TOOL_NAME, READ_FILE_TOOL_NAME } from './read-file';
import { GET_SETTINGS_TOOL_NAME, UPDATE_SETTINGS_TOOL_NAME } from './settings';
import { INSERT_AT_CURSOR_TOOL_NAME } from './write';

/**
 * 默认开放的只读内置工具名称列表。
 */
export const DEFAULT_BUILTIN_READONLY_TOOL_NAMES = [
  READ_CURRENT_DOCUMENT_TOOL_NAME,
  GET_CURRENT_TIME_TOOL_NAME,
  SEARCH_CURRENT_DOCUMENT_TOOL_NAME,
  ASK_USER_CHOICE_TOOL_NAME,
  READ_FILE_TOOL_NAME,
  READ_DIRECTORY_TOOL_NAME,
  GET_SETTINGS_TOOL_NAME,
  QUERY_LOGS_TOOL_NAME
] as const;

/**
 * 默认开放的低风险写入内置工具名称列表。
 */
export const DEFAULT_BUILTIN_WRITABLE_TOOL_NAMES = [INSERT_AT_CURSOR_TOOL_NAME, UPDATE_SETTINGS_TOOL_NAME] as const;

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
