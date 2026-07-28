/**
 * @file tools.test.ts
 * @description ChatRuntime 工具超时中止传播与续跑策略测试。
 */
import type { ActiveChatRuntime, ChatRuntimeRendererToolExecutor } from '../../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AIToolExecutionResult } from 'types/ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executeRendererToolSafely,
  shouldContinueAfterToolResult,
  shouldStopStreamAfterToolResult
} from '../../../../../../../electron/main/modules/chat/runtime/stream/tools.mjs';

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
  it('aborts the execution signal when the renderer tool times out', async (): Promise<void> => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const executeTool: ChatRuntimeRendererToolExecutor = async (input) => {
      receivedSignal = input.signal;
      return new Promise((): void => {
        // 保持工具挂起，让超时分支成为测试里唯一的完成路径。
      });
    };

    const resultPromise = executeRendererToolSafely(executeTool, { runtime, toolCallId: 'tool-call-timeout', toolName: 'slow_tool', input: {} }, 100);
    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result).toMatchObject({ status: 'failure', error: { code: 'TOOL_TIMEOUT' } });
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
