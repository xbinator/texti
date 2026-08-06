/**
 * @file index.mts
 * @description ChatRuntime 主进程只读工具。
 */
import type { ChatRuntimeMainToolExecutionInput } from '../../types.mjs';
import type { RuntimeLogFilters } from '../types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import { readLogs } from '../../../../logger/service.mjs';
import { LogLevel, type LogQueryOptions, type LogScope } from '../../../../logger/types.mjs';
import { MAX_QUERY_LOG_LIMIT, QUERY_LOGS_TOOL_NAME, READ_TOOL_NAMES, DEFAULT_QUERY_LOG_LIMIT } from '../constants.mjs';
import { createMainToolFailureResult, createMainToolSuccessResult } from '../results.mjs';

/**
 * 判断工具是否属于只读工具模块。
 * @param toolName - 工具名称
 * @returns 是否为只读工具
 */
export function isReadTool(toolName: string): boolean {
  return READ_TOOL_NAMES.has(toolName);
}

/**
 * 判断值是否为日志级别。
 * @param value - 待判断值
 * @returns 是否为日志级别
 */
function isLogLevel(value: unknown): value is LogLevel {
  return value === LogLevel.ERROR || value === LogLevel.WARN || value === LogLevel.INFO;
}

/**
 * 判断值是否为日志来源。
 * @param value - 待判断值
 * @returns 是否为日志来源
 */
function isLogScope(value: unknown): value is LogScope {
  return value === 'main' || value === 'renderer' || value === 'preload';
}

/**
 * 读取非空字符串字段。
 * @param value - 原始值
 * @returns 非空字符串或 undefined
 */
function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;

  const trimmedValue = value.trim();
  return trimmedValue || undefined;
}

/**
 * 读取非负整数分页参数。
 * @param value - 原始值
 * @param fallback - 兜底值
 * @returns 非负整数
 */
function readNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;

  const integerValue = Math.floor(value);
  return integerValue < 0 ? fallback : integerValue;
}

/**
 * 判断值是否为对象记录。
 * @param value - 待判断值
 * @returns 是否为对象记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 归一化日志查询输入。
 * @param input - 原始工具输入
 * @returns 生效筛选条件
 */
function normalizeRuntimeLogFilters(input: unknown): RuntimeLogFilters {
  const source = isRecord(input) ? input : {};
  const rawLimit = readNonNegativeInteger(source.limit, DEFAULT_QUERY_LOG_LIMIT);
  const rawOffset = readNonNegativeInteger(source.offset, 0);
  const date = readOptionalTrimmedString(source.date);

  return {
    ...(isLogLevel(source.level) ? { level: source.level } : {}),
    ...(isLogScope(source.scope) ? { scope: source.scope } : {}),
    ...(readOptionalTrimmedString(source.keyword) ? { keyword: readOptionalTrimmedString(source.keyword) } : {}),
    ...(date ? { date } : {}),
    limit: rawLimit < 1 ? DEFAULT_QUERY_LOG_LIMIT : Math.min(rawLimit, MAX_QUERY_LOG_LIMIT),
    offset: rawOffset,
    usedDefaultDate: !date
  };
}

/**
 * 将日志筛选条件转为主进程日志查询参数。
 * @param filters - 生效筛选条件
 * @returns 日志查询参数
 */
function toRuntimeLogQueryOptions(filters: RuntimeLogFilters): LogQueryOptions {
  return {
    level: filters.level,
    scope: filters.scope,
    keyword: filters.keyword,
    date: filters.date,
    limit: filters.limit,
    offset: filters.offset
  };
}

/**
 * 创建 query_logs 工具结果。
 * @param input - 原始工具输入
 * @returns 工具成功结果
 */
function createQueryLogsSuccessResult(input: unknown): AIToolExecutionResult {
  const appliedFilters = normalizeRuntimeLogFilters(input);
  const items = readLogs(toRuntimeLogQueryOptions(appliedFilters));

  return createMainToolSuccessResult(QUERY_LOGS_TOOL_NAME, {
    items,
    returnedCount: items.length,
    appliedFilters
  });
}

/**
 * 执行只读工具。
 * @param input - 工具执行输入
 * @param deps - 主进程工具依赖
 * @returns 工具执行结果
 */
export async function executeReadTool(input: ChatRuntimeMainToolExecutionInput): Promise<AIToolExecutionResult> {
  if (input.toolName === QUERY_LOGS_TOOL_NAME) {
    return createQueryLogsSuccessResult(input.input);
  }

  return createMainToolFailureResult(input.toolName, 'TOOL_NOT_FOUND', `Unsupported read tool: ${input.toolName}`);
}
