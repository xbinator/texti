/**
 * @file logs.ts
 * @description 内置运行日志查询工具实现。
 */
import type { AIToolExecutor } from 'types/ai';
import { logger } from '@/shared/logger';
import type { LogEntry, LogLevel, LogQueryOptions, LogScope } from '@/shared/logger/types';
import { createToolFailureResult, createToolSuccessResult } from '../results';

/** 查询日志工具名称。 */
export const QUERY_LOGS_TOOL_NAME = 'query_logs';
/** 默认返回日志条数。 */
const DEFAULT_QUERY_LOG_LIMIT = 50;
/** 单次查询允许返回的最大日志条数。 */
const MAX_QUERY_LOG_LIMIT = 100;

/**
 * 查询日志工具输入。
 */
export interface QueryLogsInput {
  /** 日志级别筛选。 */
  level?: LogLevel;
  /** 日志来源筛选。 */
  scope?: LogScope;
  /** 关键字筛选。 */
  keyword?: string;
  /** 查询日期，格式为 YYYY-MM-DD。 */
  date?: string;
  /** 返回条数。 */
  limit?: number;
  /** 分页偏移量。 */
  offset?: number;
}

/**
 * 工具返回中回显的生效筛选条件。
 */
export interface AppliedLogFilters {
  /** 生效的日志级别筛选。 */
  level?: LogLevel;
  /** 生效的日志来源筛选。 */
  scope?: LogScope;
  /** 生效的关键字筛选。 */
  keyword?: string;
  /** 生效的日期筛选。 */
  date?: string;
  /** 生效的返回条数。 */
  limit: number;
  /** 生效的分页偏移量。 */
  offset: number;
  /** 是否沿用了默认的“当天日志”语义。 */
  usedDefaultDate: boolean;
}

/**
 * 查询日志工具返回。
 */
export interface QueryLogsResult {
  /** 当前页返回的日志条目。 */
  items: LogEntry[];
  /** 当前页实际返回的日志数量。 */
  returnedCount: number;
  /** 实际生效的筛选条件。 */
  appliedFilters: AppliedLogFilters;
}

/**
 * 内置日志工具集合。
 */
export interface BuiltinLogTools {
  /** 查询运行日志工具。 */
  queryLogs: AIToolExecutor<QueryLogsInput, QueryLogsResult>;
}

/**
 * 判断日志能力在当前环境中是否可用。
 * @returns 是否存在可调用的 logger API。
 */
function hasLoggerCapability(): boolean {
  return typeof window !== 'undefined' && typeof window.electronAPI?.logger?.getLogs === 'function';
}

/**
 * 将用户输入归一化为安全、稳定的分页查询参数。
 * @param input - 原始工具输入。
 * @returns 生效的筛选条件。
 */
function normalizeQueryLogsInput(input: QueryLogsInput): AppliedLogFilters {
  const rawLimit = Number.isFinite(input.limit) ? Math.floor(input.limit as number) : DEFAULT_QUERY_LOG_LIMIT;
  const rawOffset = Number.isFinite(input.offset) ? Math.floor(input.offset as number) : 0;
  const normalizedDate = input.date?.trim() || undefined;
  const normalizedKeyword = input.keyword?.trim() || undefined;
  const usedDefaultDate = !normalizedDate;

  return {
    level: input.level,
    scope: input.scope,
    keyword: normalizedKeyword,
    date: normalizedDate,
    limit: rawLimit < 1 ? DEFAULT_QUERY_LOG_LIMIT : Math.min(rawLimit, MAX_QUERY_LOG_LIMIT),
    offset: rawOffset < 0 ? 0 : rawOffset,
    usedDefaultDate
  };
}

/**
 * 将回显筛选条件转换为底层日志查询参数。
 * @param filters - 生效的筛选条件。
 * @returns 传给 logger API 的查询参数。
 */
function toLogQueryOptions(filters: AppliedLogFilters): LogQueryOptions {
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
 * 创建内置日志工具。
 * @returns 日志工具执行器集合。
 */
export function createBuiltinLogTools(): BuiltinLogTools {
  return {
    queryLogs: {
      definition: {
        name: QUERY_LOGS_TOOL_NAME,
        description:
          '查询应用运行日志，可按级别、进程来源、关键字、日期和分页参数筛选，适合排查当天错误、查找异常上下文和定位指定关键字日志。未传日期时默认查询当天日志，不会修改任何数据。',
        source: 'builtin',
        riskLevel: 'read',
        permissionCategory: 'system',
        requiresActiveDocument: false,
        parameters: {
          type: 'object',
          properties: {
            level: {
              type: 'string',
              enum: ['ERROR', 'WARN', 'INFO'],
              description: '日志级别筛选。'
            },
            scope: {
              type: 'string',
              enum: ['main', 'renderer', 'preload'],
              description: '日志来源筛选。'
            },
            keyword: {
              type: 'string',
              description: '按消息内容执行大小写不敏感的关键字匹配。'
            },
            date: {
              type: 'string',
              description: '查询日期，格式为 YYYY-MM-DD；不传时默认查询当天日志。'
            },
            limit: {
              type: 'number',
              description: '返回条数，默认 50，最大 100。'
            },
            offset: {
              type: 'number',
              description: '过滤后结果集的分页偏移量，默认 0。'
            }
          },
          additionalProperties: false
        }
      },
      async execute(input: QueryLogsInput) {
        if (!hasLoggerCapability()) {
          return createToolFailureResult(QUERY_LOGS_TOOL_NAME, 'EXECUTION_FAILED', 'Logger API is unavailable in the current environment');
        }

        try {
          const appliedFilters = normalizeQueryLogsInput(input);
          const items = await logger.getLogs(toLogQueryOptions(appliedFilters));

          return createToolSuccessResult(QUERY_LOGS_TOOL_NAME, {
            items,
            returnedCount: items.length,
            appliedFilters
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to query logs';

          return createToolFailureResult(QUERY_LOGS_TOOL_NAME, 'EXECUTION_FAILED', message);
        }
      }
    }
  };
}
