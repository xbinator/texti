# Query Logs Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Tibis 新增一个内置 AI 只读工具 `query_logs`，让模型可以按筛选条件结构化查询当天运行日志。

**Architecture:** 在 `src/ai/tools/builtin/` 新增日志工具文件，工具执行时直接调用现有渲染侧 `logger.getLogs(...)`。工具层负责能力可用性检查、参数归一化、返回量限制和统一结果封装，再通过 `builtin/index.ts` 与 `catalog.ts` 接入默认只读工具集。

**Tech Stack:** Vue 3 + TypeScript、现有 `src/ai/tools` 内置工具框架、Electron 日志 IPC、Vitest

---

### Task 1: 新增日志工具测试并先跑红

**Files:**
- Create: `test/ai/tools/builtin-logs.test.ts`

- [ ] **Step 1: 编写失败测试，覆盖工具定义、参数归一化、能力缺失与成功返回结构**

```ts
/**
 * @file builtin-logs.test.ts
 * @description 验证内置日志查询工具的定义、参数归一化和返回结构。
 */
/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '@/shared/logger/types';

const getLogsMock = vi.fn();

vi.mock('@/shared/logger', () => ({
  logger: {
    getLogs: getLogsMock
  }
}));

describe('createBuiltinLogTools', () => {
  beforeEach(() => {
    getLogsMock.mockReset();
  });

  it('exposes query_logs as a global readonly tool', async () => {
    const { createBuiltinLogTools, QUERY_LOGS_TOOL_NAME } = await import('@/ai/tools/builtin/logs');
    const tools = createBuiltinLogTools();

    expect(tools.queryLogs.definition.name).toBe(QUERY_LOGS_TOOL_NAME);
    expect(tools.queryLogs.definition.riskLevel).toBe('read');
    expect(tools.queryLogs.definition.requiresActiveDocument).toBe(false);
  });

  it('normalizes input and returns structured results', async () => {
    const items: LogEntry[] = [
      {
        timestamp: '2026-04-30 10:00:00.000',
        level: 'ERROR',
        scope: 'renderer',
        message: 'Provider save failed'
      }
    ];
    getLogsMock.mockResolvedValue(items);

    const { createBuiltinLogTools, QUERY_LOGS_TOOL_NAME } = await import('@/ai/tools/builtin/logs');
    const result = await createBuiltinLogTools().queryLogs.execute({
      keyword: '',
      level: 'ERROR',
      limit: 999.8,
      offset: -5.2
    });

    expect(getLogsMock).toHaveBeenCalledWith({
      level: 'ERROR',
      limit: 100,
      offset: 0
    });
    expect(result.ok).toBe(true);
    expect(result.tool).toBe(QUERY_LOGS_TOOL_NAME);
    expect(result.data).toEqual({
      items,
      returnedCount: 1,
      appliedFilters: {
        level: 'ERROR',
        limit: 100,
        offset: 0,
        usedDefaultDate: true
      }
    });
  });

  it('returns failure when logger capability is unavailable', async () => {
    vi.stubGlobal('window', { electronAPI: undefined });

    const { createBuiltinLogTools, QUERY_LOGS_TOOL_NAME } = await import('@/ai/tools/builtin/logs');
    const result = await createBuiltinLogTools().queryLogs.execute({});

    expect(result.ok).toBe(false);
    expect(result.tool).toBe(QUERY_LOGS_TOOL_NAME);
    expect(result.error?.code).toBe('EXECUTION_FAILED');
  });
});
```

- [ ] **Step 2: 运行测试并确认它因缺少工具实现而失败**

Run: `pnpm test test/ai/tools/builtin-logs.test.ts`
Expected: FAIL，报错找不到 `@/ai/tools/builtin/logs` 或缺少对应导出

- [ ] **Step 3: Commit**

```bash
git add test/ai/tools/builtin-logs.test.ts
git commit -m "test(ai-tools): add query logs tool tests"
```

---

### Task 2: 实现 `query_logs` 工具

**Files:**
- Create: `src/ai/tools/builtin/logs.ts`

- [ ] **Step 1: 新增日志工具实现文件**

```ts
/**
 * @file logs.ts
 * @description 内置运行日志查询工具实现。
 */
import type { AIToolExecutor } from 'types/ai';
import { logger } from '@/shared/logger';
import type { LogEntry, LogLevel, LogScope } from '@/shared/logger/types';
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
  /** 日志级别筛选 */
  level?: LogLevel;
  /** 日志来源筛选 */
  scope?: LogScope;
  /** 关键字筛选 */
  keyword?: string;
  /** 查询日期 */
  date?: string;
  /** 返回条数 */
  limit?: number;
  /** 分页偏移 */
  offset?: number;
}

/**
 * 查询日志工具返回。
 */
export interface QueryLogsResult {
  /** 命中的日志条目 */
  items: LogEntry[];
  /** 当前页实际返回的日志数量 */
  returnedCount: number;
  /** 实际生效的筛选条件 */
  appliedFilters: {
    level?: LogLevel;
    scope?: LogScope;
    keyword?: string;
    date?: string;
    limit: number;
    offset: number;
    usedDefaultDate: boolean;
  };
}

/**
 * 内置日志工具集合。
 */
export interface BuiltinLogTools {
  /** 查询运行日志 */
  queryLogs: AIToolExecutor<QueryLogsInput, QueryLogsResult>;
}

/**
 * 归一化日志查询参数。
 * @param input - 原始工具输入。
 * @returns 可直接传给 logger 的查询参数和元信息。
 */
function normalizeQueryLogsInput(input: QueryLogsInput): QueryLogsResult['appliedFilters'] {
  const rawLimit = Number.isFinite(input.limit) ? Math.floor(input.limit as number) : DEFAULT_QUERY_LOG_LIMIT;
  const rawOffset = Number.isFinite(input.offset) ? Math.floor(input.offset as number) : 0;
  const normalizedLimit = rawLimit < 1 ? DEFAULT_QUERY_LOG_LIMIT : Math.min(rawLimit, MAX_QUERY_LOG_LIMIT);
  const normalizedOffset = rawOffset < 0 ? 0 : rawOffset;
  const normalizedKeyword = input.keyword?.trim() || undefined;
  const usedDefaultDate = !input.date;

  return {
    level: input.level,
    scope: input.scope,
    keyword: normalizedKeyword,
    date: input.date,
    limit: normalizedLimit,
    offset: normalizedOffset,
    usedDefaultDate
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
        description: '查询应用运行日志，可按级别、进程来源、关键字、日期和分页参数筛选，适合排查最近错误、查找异常上下文和定位指定关键字日志。',
        source: 'builtin',
        riskLevel: 'read',
        permissionCategory: 'system',
        requiresActiveDocument: false,
        parameters: {
          type: 'object',
          properties: {
            level: { type: 'string', enum: ['ERROR', 'WARN', 'INFO'] },
            scope: { type: 'string', enum: ['main', 'renderer', 'preload'] },
            keyword: { type: 'string' },
            date: { type: 'string' },
            limit: { type: 'number' },
            offset: { type: 'number' }
          },
          additionalProperties: false
        }
      },
      async execute(input) {
        try {
          if (!window.electronAPI?.logger?.getLogs) {
            return createToolFailureResult(QUERY_LOGS_TOOL_NAME, 'EXECUTION_FAILED', 'Logger API is unavailable in the current environment');
          }

          const appliedFilters = normalizeQueryLogsInput(input);
          const { usedDefaultDate, ...queryOptions } = appliedFilters;
          const items = await logger.getLogs(queryOptions);

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
```

- [ ] **Step 2: 运行新增测试并确认转绿**

Run: `pnpm test test/ai/tools/builtin-logs.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/ai/tools/builtin/logs.ts test/ai/tools/builtin-logs.test.ts
git commit -m "feat(ai-tools): add query logs builtin tool"
```

---

### Task 3: 接入默认内置工具清单

**Files:**
- Modify: `src/ai/tools/builtin/index.ts`
- Modify: `src/ai/tools/builtin/catalog.ts`

- [ ] **Step 1: 在 `catalog.ts` 中注册工具名并加入默认只读工具列表**

```ts
import { QUERY_LOGS_TOOL_NAME } from './logs';

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
```

- [ ] **Step 2: 在 `index.ts` 中创建日志工具并加入只读工具集合**

```ts
import { createBuiltinLogTools } from './logs';

const logTools = createBuiltinLogTools();

const allReadonlyTools: AIToolExecutor[] = [
  readTools.readCurrentDocument,
  environmentTools.getCurrentTime,
  readTools.searchCurrentDocument,
  createAskUserChoiceTool({
    getPendingQuestion: options.getPendingQuestion ?? (() => null),
    createQuestionId: options.createQuestionId ?? (() => nanoid())
  }),
  createBuiltinReadFileTool({
    confirm: options.confirm,
    getWorkspaceRoot: options.getWorkspaceRoot
  }),
  createBuiltinReadDirectoryTool({
    confirm: options.confirm,
    getWorkspaceRoot: options.getWorkspaceRoot
  }),
  createBuiltinSettingsTools(options.confirm ?? { confirm: async () => false }).getSettings,
  logTools.queryLogs
];
```

- [ ] **Step 3: 运行目标测试，确认工具工厂仍可正常工作**

Run: `pnpm test test/ai/tools/builtin-logs.test.ts test/ai/tools/builtin-index.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/ai/tools/builtin/index.ts src/ai/tools/builtin/catalog.ts
git commit -m "feat(ai-tools): expose query logs in builtin catalog"
```

---

### Task 4: 补充回归测试与变更记录

**Files:**
- Modify: `test/ai/tools/builtin-index.test.ts`
- Modify: `changelog/2026-04-30.md`

- [ ] **Step 1: 为内置工具工厂补一个包含 `query_logs` 的断言**

```ts
it('includes query_logs in readonly builtin tools', () => {
  const tools = createBuiltinTools();
  const names = tools.map((tool) => tool.definition.name);

  expect(names).toContain('query_logs');
});
```

- [ ] **Step 2: 在 changelog 中记录本次 AI 工具接入**

```md
- 新增 `query_logs` AI 内置工具，支持按级别、来源、关键字、日期和分页参数结构化查询运行日志。
```

- [ ] **Step 3: 运行最终验证**

Run: `pnpm exec eslint <project>/src/ai/tools/builtin/logs.ts <project>/src/ai/tools/builtin/index.ts <project>/src/ai/tools/builtin/catalog.ts <project>/test/ai/tools/builtin-logs.test.ts <project>/test/ai/tools/builtin-index.test.ts`
Expected: PASS

Run: `pnpm test test/ai/tools/builtin-logs.test.ts test/ai/tools/builtin-index.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add test/ai/tools/builtin-index.test.ts changelog/2026-04-30.md docs/superpowers/specs/2026-04-30-query-logs-tool-design.md docs/superpowers/plans/2026-04-30-query-logs-tool.md
git commit -m "docs(ai-tools): document query logs tool rollout"
```
