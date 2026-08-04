/**
 * @file renderer-tool.test.ts
 * @description Renderer 工具开始确认、活动接收与结果收敛测试。
 */
import type { ActiveChatRuntime } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeRendererToolRequests } from '../../../../../../electron/main/modules/chat/runtime/controllers/renderer-tool.mjs';

/** Renderer controller 测试 Runtime。 */
const runtime: ActiveChatRuntime = {
  runtimeId: 'runtime-renderer',
  sessionId: 'session-renderer',
  turnId: 'turn-renderer',
  clientId: 'client-renderer',
  agentId: 'primary',
  rootRuntimeId: 'runtime-renderer',
  status: 'running',
  phase: 'streaming',
  abortController: new AbortController(),
  createdAt: 0
};

afterEach((): void => {
  vi.useRealTimers();
});

describe('renderer tool request controller', (): void => {
  it('uses the timeout only for the started acknowledgement', async (): Promise<void> => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const requests = createRuntimeRendererToolRequests({ emit, getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({ runtime, toolCallId: 'tool-1', toolName: 'renderer_tool', input: {} });

    expect(
      requests.acceptActivity({
        runtimeId: runtime.runtimeId,
        toolCallId: 'tool-1',
        sequence: 1,
        occurredAt: 1,
        activity: { kind: 'started' }
      })
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(requests.listPending(runtime.runtimeId)).toHaveLength(1);

    requests.submit({
      runtimeId: runtime.runtimeId,
      toolCallId: 'tool-1',
      result: { toolName: 'renderer_tool', status: 'success', data: { ok: true } }
    });
    await expect(result).resolves.toMatchObject({ status: 'success' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails and emits cancellation when started is never acknowledged', async (): Promise<void> => {
    vi.useFakeTimers();
    const emit = vi.fn();
    const requests = createRuntimeRendererToolRequests({ emit, getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({ runtime, toolCallId: 'tool-1', toolName: 'renderer_tool', input: {} });

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(result).resolves.toMatchObject({ status: 'failure', error: { code: 'TOOL_TIMEOUT' } });
    expect(emit).toHaveBeenCalledWith('chat:runtime:tool-cancelled', expect.objectContaining({ toolCallId: 'tool-1' }));
    expect(requests.listPending(runtime.runtimeId)).toEqual([]);
  });

  it('preserves the structured Watchdog reason when execution is aborted', async (): Promise<void> => {
    const controller = new AbortController();
    const requests = createRuntimeRendererToolRequests({ emit: vi.fn(), getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({
      runtime,
      toolCallId: 'tool-watchdog-abort',
      toolName: 'renderer_tool',
      input: {},
      signal: controller.signal
    });

    controller.abort({ code: 'TOOL_UNRESPONSIVE', message: '工具执行器长时间没有活动' });

    await expect(result).resolves.toMatchObject({ status: 'failure', error: { code: 'TOOL_UNRESPONSIVE' } });
  });

  it('maps an unstructured abort to user cancellation', async (): Promise<void> => {
    const controller = new AbortController();
    const requests = createRuntimeRendererToolRequests({ emit: vi.fn(), getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({
      runtime,
      toolCallId: 'tool-user-abort',
      toolName: 'renderer_tool',
      input: {},
      signal: controller.signal
    });

    controller.abort();

    await expect(result).resolves.toMatchObject({ status: 'cancelled', error: { code: 'USER_CANCELLED' } });
  });

  it('rejects activity before started, duplicate started, and late activity', async (): Promise<void> => {
    vi.useFakeTimers();
    const requests = createRuntimeRendererToolRequests({ emit: vi.fn(), getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({ runtime, toolCallId: 'tool-1', toolName: 'renderer_tool', input: {} });
    const base = { runtimeId: runtime.runtimeId, toolCallId: 'tool-1', sequence: 1, occurredAt: 1 };

    expect(requests.acceptActivity({ ...base, activity: { kind: 'heartbeat' } })).toBe(false);
    expect(requests.acceptActivity({ ...base, activity: { kind: 'started' } })).toBe(true);
    expect(requests.acceptActivity({ ...base, sequence: 2, activity: { kind: 'started' } })).toBe(false);
    expect(requests.acceptActivity({ ...base, sequence: 3, activity: { kind: 'heartbeat' } })).toBe(true);
    requests.submit({
      runtimeId: runtime.runtimeId,
      toolCallId: 'tool-1',
      result: { toolName: 'renderer_tool', status: 'success', data: null }
    });
    await result;
    expect(requests.acceptActivity({ ...base, sequence: 4, activity: { kind: 'heartbeat' } })).toBe(false);
  });

  it('rejects non-finite started sequences without consuming the acknowledgement', async (): Promise<void> => {
    const requests = createRuntimeRendererToolRequests({ emit: vi.fn(), getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({ runtime, toolCallId: 'tool-finite-sequence', toolName: 'renderer_tool', input: {} });
    const malformed = {
      runtimeId: runtime.runtimeId,
      toolCallId: 'tool-finite-sequence',
      sequence: Number.NaN,
      occurredAt: 1,
      activity: { kind: 'started' }
    } as const;

    expect(requests.acceptActivity(malformed)).toBe(false);
    expect(requests.acceptActivity({ ...malformed, sequence: 1 })).toBe(true);
    requests.submit({
      runtimeId: runtime.runtimeId,
      toolCallId: 'tool-finite-sequence',
      result: { toolName: 'renderer_tool', status: 'success', data: null }
    });
    await expect(result).resolves.toMatchObject({ status: 'success' });
  });

  it('converts malformed or identity-mismatched renderer results to a stable failure', async (): Promise<void> => {
    const requests = createRuntimeRendererToolRequests({ emit: vi.fn(), getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({ runtime, toolCallId: 'tool-invalid-result', toolName: 'renderer_tool', input: {} });

    requests.submit({
      runtimeId: runtime.runtimeId,
      toolCallId: 'tool-invalid-result',
      result: { toolName: 'different_tool', status: 'unknown' } as unknown as Parameters<typeof requests.submit>[0]['result']
    });

    await expect(result).resolves.toMatchObject({
      toolName: 'renderer_tool',
      status: 'failure',
      error: { code: 'INVALID_INPUT' }
    });
  });
});
