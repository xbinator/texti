/**
 * @file tools.test.ts
 * @description ChatRuntime 工具超时中止传播与续跑策略测试。
 */
import type { ActiveChatRuntime, ChatRuntimeRendererToolExecutor } from '../../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createToolWatchdogs } from '../../../../../../../electron/main/modules/chat/runtime/controllers/tool-watchdog.mjs';
import {
  createToolFailureResultFromError,
  executeRendererToolSafely,
  isRendererManagedTool,
  shouldContinueAfterToolResult,
  shouldStopStreamAfterToolResult
} from '../../../../../../../electron/main/modules/chat/runtime/stream/tools.mjs';
import { createBridgeFailureResult } from '../../../../../../../electron/main/modules/chat/runtime/tools/results.mjs';

/** 测试用 Runtime。 */
const runtime: ActiveChatRuntime = {
  runtimeId: 'runtime-timeout',
  sessionId: 'session-timeout',
  turnId: 'turn-timeout',
  clientId: 'client-timeout',
  agentId: 'agent-timeout',
  rootRuntimeId: 'runtime-timeout',
  status: 'running',
  phase: 'streaming',
  abortController: new AbortController(),
  createdAt: 0
};

afterEach((): void => {
  vi.useRealTimers();
});

describe('runtime tool timeout', (): void => {
  it('preserves every stable tool error code exposed by an executor', (): void => {
    const error = Object.assign(new Error('子进程未确认退出'), { code: 'PROCESS_CLEANUP_FAILED' as const });

    expect(createToolFailureResultFromError('grep', error)).toMatchObject({
      status: 'failure',
      error: { code: 'PROCESS_CLEANUP_FAILED', message: '子进程未确认退出' }
    });
  });

  it('keeps an executor abort as a terminal cancellation instead of a continuable failure', (): void => {
    const error = Object.assign(new Error('用户停止了工具调用'), { code: 'USER_CANCELLED' as const });

    expect(createToolFailureResultFromError('write_file', error)).toMatchObject({
      status: 'cancelled',
      error: { code: 'USER_CANCELLED', message: '用户停止了工具调用' }
    });
  });

  it('converts a cancelled bridge wait to a terminal tool cancellation', (): void => {
    expect(createBridgeFailureResult('write_file', { code: 'USER_CANCELLED', message: '用户停止了工具调用' })).toMatchObject({
      status: 'cancelled',
      error: { code: 'USER_CANCELLED', message: '用户停止了工具调用' }
    });
  });

  it('aborts the execution signal when the renderer tool loses liveness', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    let receivedSignal: AbortSignal | undefined;
    const executeTool: ChatRuntimeRendererToolExecutor = async (input) => {
      receivedSignal = input.signal;
      return new Promise((): void => {
        // 保持工具挂起，让超时分支成为测试里唯一的完成路径。
      });
    };

    const watchdogs = createToolWatchdogs({ livenessMs: 100, idleMs: 1_000 });
    const lease = watchdogs.start({ runtimeId: runtime.runtimeId, toolCallId: 'tool-call-timeout', toolName: 'slow_tool' });
    const resultPromise = executeRendererToolSafely(executeTool, { runtime, toolCallId: 'tool-call-timeout', toolName: 'slow_tool', input: {} }, lease);
    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result).toMatchObject({ status: 'failure', error: { code: 'TOOL_UNRESPONSIVE' } });
    expect(receivedSignal?.aborted).toBe(true);
  });
});

describe('runtime tool continuation policy', (): void => {
  it('continues after user-denied permission failures but stops after real cancellations', (): void => {
    const deniedResult: AIToolExecutionResult = {
      toolName: 'write_file',
      status: 'failure',
      error: { code: 'USER_CANCELLED', message: '用户取消了工具授权' }
    };
    const cancelledResult: AIToolExecutionResult = {
      toolName: 'write_file',
      status: 'cancelled',
      error: { code: 'USER_CANCELLED', message: '用户取消了工具调用' }
    };

    expect(shouldContinueAfterToolResult(deniedResult)).toBe(true);
    expect(shouldStopStreamAfterToolResult(deniedResult)).toBe(false);
    expect(shouldContinueAfterToolResult(cancelledResult)).toBe(false);
    expect(shouldStopStreamAfterToolResult(cancelledResult)).toBe(true);
  });
});

describe('renderer tool routing', (): void => {
  it('routes only non-main tools frozen in the runtime tool schema list', (): void => {
    const runtimeWithTools: ActiveChatRuntime = {
      ...runtime,
      tools: [
        {
          name: 'inspect_future_page',
          description: 'Inspect an arbitrary future page',
          parameters: { type: 'object', properties: {} }
        }
      ]
    };

    expect(isRendererManagedTool(runtimeWithTools, 'inspect_future_page')).toBe(true);
    expect(isRendererManagedTool(runtimeWithTools, 'unregistered_page_tool')).toBe(false);
    expect(isRendererManagedTool(runtimeWithTools, 'read_file')).toBe(false);
  });
});
