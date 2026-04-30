/**
 * @file builtin-logs.test.ts
 * @description 验证内置运行日志查询工具的定义、参数归一化与结果边界。
 */
/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '@/shared/logger/types';

/** 模拟日志查询方法。 */
const getLogsMock = vi.fn();

vi.mock('@/shared/logger', () => ({
  logger: {
    getLogs: getLogsMock
  }
}));

/**
 * 安装测试用 logger API 能力。
 */
function installLoggerCapability(): void {
  vi.stubGlobal('window', {
    electronAPI: {
      logger: {
        getLogs: getLogsMock
      }
    }
  });
}

describe('createBuiltinLogTools', () => {
  beforeEach(() => {
    vi.resetModules();
    getLogsMock.mockReset();
    installLoggerCapability();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
      keyword: '   ',
      level: 'ERROR',
      limit: 999.8,
      offset: -5.2
    });

    expect(getLogsMock).toHaveBeenCalledWith({
      level: 'ERROR',
      scope: undefined,
      keyword: undefined,
      date: undefined,
      limit: 100,
      offset: 0
    });
    expect(result).toEqual({
      toolName: QUERY_LOGS_TOOL_NAME,
      status: 'success',
      data: {
        items,
        returnedCount: 1,
        appliedFilters: {
          level: 'ERROR',
          scope: undefined,
          keyword: undefined,
          date: undefined,
          limit: 100,
          offset: 0,
          usedDefaultDate: true
        }
      }
    });
  });

  it('treats blank date as omitted and falls back to the default daily query', async () => {
    getLogsMock.mockResolvedValue([]);

    const { createBuiltinLogTools } = await import('@/ai/tools/builtin/logs');
    await createBuiltinLogTools().queryLogs.execute({
      date: '   '
    });

    expect(getLogsMock).toHaveBeenCalledWith({
      level: undefined,
      scope: undefined,
      keyword: undefined,
      date: undefined,
      limit: 50,
      offset: 0
    });
  });

  it('returns failure when logger capability is unavailable', async () => {
    vi.stubGlobal('window', {
      electronAPI: undefined
    });

    const { createBuiltinLogTools, QUERY_LOGS_TOOL_NAME } = await import('@/ai/tools/builtin/logs');
    const result = await createBuiltinLogTools().queryLogs.execute({});

    expect(result).toEqual({
      toolName: QUERY_LOGS_TOOL_NAME,
      status: 'failure',
      error: {
        code: 'EXECUTION_FAILED',
        message: 'Logger API is unavailable in the current environment'
      }
    });
  });
});
