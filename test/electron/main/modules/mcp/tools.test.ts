/**
 * @file tools.test.ts
 * @description MCP AI SDK 工具的兼容超时、进度升级和 Watchdog 中止测试。
 */
import type { ToolWatchdogLease } from '../../../../../electron/main/modules/chat/runtime/controllers/tool-watchdog.mjs';
import type { ToolSet } from 'ai';
import type { AIToolExecutionResult, MCPDiscoveredToolSnapshot } from 'types/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpSdkTools, toMcpSdkToolName, type MCPToolExecutor, type MCPToolExecutorOptions } from '../../../../../electron/main/modules/mcp/tools.mjs';

/** AI SDK 工具执行函数的测试窄接口。 */
interface ExecutableToolLike {
  /** 执行工具。 */
  execute: (input: unknown, options: { toolCallId: string; abortSignal?: AbortSignal }) => Promise<unknown>;
}

/**
 * 创建 MCP discovery 工具。
 * @returns 工具快照
 */
function createDiscoveredTool(): MCPDiscoveredToolSnapshot {
  return {
    serverId: 'server-1',
    toolName: 'long-tool',
    description: 'Long tool',
    inputSchema: { type: 'object', properties: {} }
  };
}

/**
 * 读取创建后的可执行 AI SDK 工具。
 * @param tools - AI SDK 工具集
 * @returns 可执行工具
 */
function getExecutableTool(tools: ToolSet): ExecutableToolLike {
  const sdkName = toMcpSdkToolName('server-1', 'long-tool');
  return tools[sdkName] as unknown as ExecutableToolLike;
}

describe('MCP SDK tool activity', (): void => {
  afterEach((): void => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('forwards the configured static timeout only for direct calls', async (): Promise<void> => {
    let callOptions: MCPToolExecutorOptions | undefined;
    const executor: MCPToolExecutor = vi.fn(async (_request, options): Promise<unknown> => {
      callOptions = options;
      return { content: [] };
    });
    const tool = getExecutableTool(createMcpSdkTools([createDiscoveredTool()], executor, { staticTimeouts: new Map([['server-1', 30_000]]) }));

    await expect(tool.execute({}, { toolCallId: 'tool-call-direct' })).resolves.toEqual({ content: [] });

    expect(callOptions).toEqual({ abortSignal: undefined, timeoutMs: 30_000 });
  });

  it('forwards the AI SDK toolCallId and upgrades first progress to one Watchdog lease', async (): Promise<void> => {
    vi.useFakeTimers();
    let callOptions: MCPToolExecutorOptions | undefined;
    let resolveCall: ((value: unknown) => void) | undefined;
    const executor: MCPToolExecutor = vi.fn(
      async (_request, options): Promise<unknown> =>
        new Promise((resolve): void => {
          callOptions = options;
          resolveCall = resolve;
        })
    );
    const lease = {
      signal: new AbortController().signal,
      settled: new Promise<AIToolExecutionResult>(() => {
        // Watchdog 在本用例中保持未收敛，实际结果来自 MCP executor。
      }),
      report: vi.fn((): boolean => true),
      finish: vi.fn()
    } satisfies ToolWatchdogLease;
    const start = vi.fn((): ToolWatchdogLease => lease);
    const tool = getExecutableTool(createMcpSdkTools([createDiscoveredTool()], executor, { toolActivity: { start } }));
    const result = tool.execute({ value: 1 }, { toolCallId: 'tool-call-1' });
    await vi.advanceTimersByTimeAsync(0);

    expect(callOptions).not.toHaveProperty('timeoutMs');

    callOptions?.onProgress?.({ progress: 2, total: 10, message: 'step 2' });
    callOptions?.onProgress?.({ progress: 2, total: 10, message: 'step 2' });

    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith('tool-call-1', toMcpSdkToolName('server-1', 'long-tool'));
    expect(lease.report).toHaveBeenNthCalledWith(1, { kind: 'started' });
    expect(lease.report).toHaveBeenNthCalledWith(2, {
      kind: 'progress',
      progress: { phase: 'mcp_progress', completed: 2, total: 10, message: 'step 2' }
    });
    expect(lease.report).toHaveBeenNthCalledWith(3, { kind: 'heartbeat' });

    await vi.advanceTimersByTimeAsync(120_000);
    resolveCall?.({ content: [{ type: 'text', text: 'done' }] });
    await expect(result).resolves.toEqual({ content: [{ type: 'text', text: 'done' }] });
    expect(lease.finish).toHaveBeenCalledOnce();
  });

  it('returns TOOL_TIMEOUT and aborts a legacy MCP request without progress', async (): Promise<void> => {
    vi.useFakeTimers();
    let callSignal: AbortSignal | undefined;
    const executor: MCPToolExecutor = vi.fn(
      async (_request, options): Promise<unknown> =>
        new Promise((): void => {
          callSignal = options?.abortSignal;
        })
    );
    const start = vi.fn();
    const tool = getExecutableTool(createMcpSdkTools([createDiscoveredTool()], executor, { toolActivity: { start } }));
    const result = tool.execute({}, { toolCallId: 'tool-call-legacy' });
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(result).resolves.toMatchObject({
      status: 'failure',
      error: { code: 'TOOL_TIMEOUT' }
    });
    expect(callSignal?.aborted).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it('ignores progress that arrives after the legacy outcome already settled', async (): Promise<void> => {
    vi.useFakeTimers();
    let callOptions: MCPToolExecutorOptions | undefined;
    const executor: MCPToolExecutor = vi.fn(
      async (_request, options): Promise<unknown> =>
        new Promise((): void => {
          callOptions = options;
        })
    );
    const start = vi.fn();
    const tool = getExecutableTool(createMcpSdkTools([createDiscoveredTool()], executor, { toolActivity: { start }, legacyTimeoutMs: 100 }));
    const result = tool.execute({}, { toolCallId: 'tool-call-late-progress' });

    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toMatchObject({ status: 'failure', error: { code: 'TOOL_TIMEOUT' } });
    callOptions?.onProgress?.({ progress: 1, total: 10, message: 'too late' });

    expect(start).not.toHaveBeenCalled();
  });

  it('ignores progress that arrives after a successful executor outcome', async (): Promise<void> => {
    let callOptions: MCPToolExecutorOptions | undefined;
    const executor: MCPToolExecutor = vi.fn(async (_request, options): Promise<unknown> => {
      callOptions = options;
      return { content: [] };
    });
    const start = vi.fn();
    const tool = getExecutableTool(createMcpSdkTools([createDiscoveredTool()], executor, { toolActivity: { start } }));

    await expect(tool.execute({}, { toolCallId: 'tool-call-success-late-progress' })).resolves.toEqual({ content: [] });
    callOptions?.onProgress?.({ progress: 1, total: 1, message: 'too late' });

    expect(start).not.toHaveBeenCalled();
  });

  it('upgrades the legacy boundary only after the first valid progress notification', async (): Promise<void> => {
    vi.useFakeTimers();
    let callOptions: MCPToolExecutorOptions | undefined;
    let resolveCall: ((value: unknown) => void) | undefined;
    const executor: MCPToolExecutor = vi.fn(
      async (_request, options): Promise<unknown> =>
        new Promise((resolve): void => {
          callOptions = options;
          resolveCall = resolve;
        })
    );
    const lease = {
      signal: new AbortController().signal,
      settled: new Promise<AIToolExecutionResult>(() => {
        // Watchdog 在本用例中保持未收敛，实际结果来自 MCP executor。
      }),
      report: vi.fn((): boolean => true),
      finish: vi.fn()
    } satisfies ToolWatchdogLease;
    const start = vi.fn((): ToolWatchdogLease => lease);
    const tool = getExecutableTool(createMcpSdkTools([createDiscoveredTool()], executor, { toolActivity: { start }, legacyTimeoutMs: 1_000 }));
    const result = tool.execute({}, { toolCallId: 'tool-call-valid-progress' });
    await vi.advanceTimersByTimeAsync(0);

    callOptions?.onProgress?.({ progress: Number.NaN, total: 10, message: 'invalid' });
    expect(start).not.toHaveBeenCalled();
    callOptions?.onProgress?.({ progress: 1, total: 10, message: 'valid' });
    expect(start).toHaveBeenCalledOnce();

    resolveCall?.({ content: [] });
    await expect(result).resolves.toEqual({ content: [] });
  });

  it('propagates Watchdog abort to the MCP request and preserves its structured result', async (): Promise<void> => {
    vi.useFakeTimers();
    let callOptions: MCPToolExecutorOptions | undefined;
    const watchdogController = new AbortController();
    let settleWatchdog: ((result: AIToolExecutionResult) => void) | undefined;
    const settled = new Promise<AIToolExecutionResult>((resolve): void => {
      settleWatchdog = resolve;
    });
    const executor: MCPToolExecutor = vi.fn(
      async (_request, options): Promise<unknown> =>
        new Promise((_resolve, reject): void => {
          callOptions = options;
          options?.abortSignal?.addEventListener('abort', (): void => reject(new Error('mcp aborted')), { once: true });
        })
    );
    const lease = {
      signal: watchdogController.signal,
      settled,
      report: vi.fn((): boolean => true),
      finish: vi.fn()
    } satisfies ToolWatchdogLease;
    const tool = getExecutableTool(createMcpSdkTools([createDiscoveredTool()], executor, { toolActivity: { start: (): ToolWatchdogLease => lease } }));
    const result = tool.execute({}, { toolCallId: 'tool-call-watchdog' });
    await vi.advanceTimersByTimeAsync(0);
    callOptions?.onProgress?.({ progress: 1, message: 'started' });
    const watchdogResult: AIToolExecutionResult = {
      toolName: toMcpSdkToolName('server-1', 'long-tool'),
      status: 'failure',
      error: { code: 'TOOL_UNRESPONSIVE', message: 'no activity' }
    };
    watchdogController.abort();
    settleWatchdog?.(watchdogResult);

    await expect(result).resolves.toEqual(watchdogResult);
    expect(callOptions?.abortSignal?.aborted).toBe(true);
  });
});
