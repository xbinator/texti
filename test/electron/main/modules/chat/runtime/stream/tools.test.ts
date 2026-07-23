/**
 * @file tools.test.ts
 * @description ChatRuntime 工具超时中止传播测试。
 */
import type { ActiveChatRuntime, ChatRuntimeRendererToolExecutor } from '../../../../../../../electron/main/modules/chat/runtime/types.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRendererToolSafely } from '../../../../../../../electron/main/modules/chat/runtime/stream/tools.mjs';

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
        // 本测试保留未完成任务，直到超时控制器中止执行。
      });
    };

    const resultPromise = executeRendererToolSafely(executeTool, { runtime, toolCallId: 'tool-call-timeout', toolName: 'slow_tool', input: {} }, 100);
    await vi.advanceTimersByTimeAsync(100);
    const result = await resultPromise;

    expect(result).toMatchObject({ status: 'failure', error: { code: 'TOOL_TIMEOUT' } });
    expect(receivedSignal?.aborted).toBe(true);
  });
});
