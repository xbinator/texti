/**
 * @file index.ts
 * @description 日志查询相关 ChatRuntime 工具定义。
 */
import type { ToolRegistryEntry } from '../types.js';

/** 查询日志工具名称。 */
export const QUERY_LOGS_TOOL_NAME = 'query_logs';

/** 查询日志工具 registry 条目。 */
export const queryLogsToolRegistryEntry = {
  runtime: 'main',
  group: 'read',
  exposure: 'default-readonly',
  executionClass: 'direct',
  effect: {
    effect: 'pure_read',
    resourceScopeResolver: 'application-logs',
    reversible: true
  },
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
        level: { type: 'string', enum: ['ERROR', 'WARN', 'INFO'], description: '日志级别筛选。' },
        scope: { type: 'string', enum: ['main', 'renderer', 'preload'], description: '日志来源筛选。' },
        keyword: { type: 'string', description: '按消息内容执行大小写不敏感的关键字匹配。' },
        date: { type: 'string', description: '查询日期，格式为 YYYY-MM-DD；不传时默认查询当天日志。' },
        limit: { type: 'number', description: '返回条数，默认 50，最大 100。' },
        offset: { type: 'number', description: '过滤后结果集的分页偏移量，默认 0。' }
      },
      additionalProperties: false
    }
  }
} satisfies ToolRegistryEntry;
