/**
 * @file recovery-requests.test.ts
 * @description ChatRuntime 待处理 renderer 请求恢复投影测试。
 */
import type { ActiveChatRuntime } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { ChatMessageRecord } from 'types/chat';
import type { ChatRuntimeEventMap } from 'types/chat-runtime';
import { describe, expect, it, vi } from 'vitest';
import { createRuntimeBridgeRequests } from '../../../../../../electron/main/modules/chat/runtime/controllers/bridge.mjs';
import { createRuntimeConfirmationRequests } from '../../../../../../electron/main/modules/chat/runtime/controllers/confirmation.mjs';
import { createRuntimeRendererToolRequests } from '../../../../../../electron/main/modules/chat/runtime/controllers/renderer-tool.mjs';
import { createChatRuntimeService } from '../../../../../../electron/main/modules/chat/runtime/service.mjs';

/** 创建活跃 Runtime 测试夹具。 */
function createRuntime(): ActiveChatRuntime {
  return {
    runtimeId: 'runtime-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-1',
    status: 'running',
    phase: 'streaming',
    abortController: new AbortController(),
    createdAt: 1
  };
}

describe('chat runtime recovery request projections', (): void => {
  it('preserves the structured cancellation reason while aborting a pending confirmation', async (): Promise<void> => {
    const runtime = createRuntime();
    const controller = new AbortController();
    const requests = createRuntimeConfirmationRequests({ emit: vi.fn(), getRuntime: () => runtime });
    const result = requests.request({
      runtimeId: runtime.runtimeId,
      confirmationId: 'confirmation-cancelled',
      request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write' },
      signal: controller.signal
    });
    const rejection = expect(result).rejects.toMatchObject({ code: 'USER_CANCELLED', message: '用户停止了工具调用' });

    controller.abort({ code: 'USER_CANCELLED', message: '用户停止了工具调用' });

    await rejection;
    expect(requests.listPending(runtime.runtimeId)).toEqual([]);
  });

  it('preserves the structured cancellation reason while aborting a pending bridge', async (): Promise<void> => {
    const runtime = createRuntime();
    const controller = new AbortController();
    const requests = createRuntimeBridgeRequests({ emit: vi.fn(), getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({
      runtimeId: runtime.runtimeId,
      requestId: 'bridge-cancelled',
      kind: 'document-snapshot',
      signal: controller.signal
    });

    controller.abort({ code: 'USER_CANCELLED', message: '用户停止了工具调用' });

    await expect(result).resolves.toMatchObject({ status: 'failure', error: { code: 'USER_CANCELLED', message: '用户停止了工具调用' } });
    expect(requests.listPending(runtime.runtimeId)).toEqual([]);
  });

  it('marks persisted non-terminal tool parts interrupted without reviving execution', async (): Promise<void> => {
    const messages: ChatMessageRecord[] = [
      {
        id: 'assistant-interrupted-tool',
        sessionId: 'session-tool',
        role: 'assistant',
        content: '',
        parts: [
          {
            id: 'tool-part-1',
            type: 'tool',
            toolCallId: 'tool-call-1',
            toolName: 'grep',
            status: 'executing',
            input: { pattern: 'needle' },
            activity: {
              state: 'running_idle',
              sequence: 7,
              lastProgressAt: 1_000,
              progress: { phase: 'scanning', completed: 64, updatedAt: 1_000 }
            }
          }
        ],
        createdAt: '2026-07-16T00:00:00.000Z',
        loading: true,
        finished: false
      }
    ];
    const updateMessage = vi.fn(async (message: ChatMessageRecord): Promise<void> => {
      messages[0] = structuredClone(message);
    });
    const streamExecutor = vi.fn();
    const service = createChatRuntimeService({
      emit: vi.fn(),
      streamExecutor,
      messageReader: { getMessages: (): ChatMessageRecord[] => [] },
      messageWriter: { addMessage: vi.fn(), updateMessage },
      listPendingRuntimeMessages: (): ChatMessageRecord[] => structuredClone(messages)
    });

    await service.recoverInterruptedCompactions();

    expect(updateMessage).toHaveBeenCalledOnce();
    expect(streamExecutor).not.toHaveBeenCalled();
    expect(messages[0]).toMatchObject({ loading: false, finished: true });
    expect(messages[0].parts[0]).toMatchObject({
      status: 'done',
      activity: {
        state: 'interrupted',
        sequence: 7,
        lastProgressAt: 1_000,
        progress: { phase: 'scanning', completed: 64, updatedAt: 1_000 }
      },
      result: {
        toolName: 'grep',
        status: 'failure',
        error: { code: 'RUNTIME_INTERRUPTED' }
      }
    });
  });

  it('does not recover a non-terminal message that still belongs to an active runtime', async (): Promise<void> => {
    let finishStream: (() => void) | undefined;
    const streamOutcome = new Promise<void>((resolve): void => {
      finishStream = resolve;
    });
    const pendingMessage: ChatMessageRecord = {
      id: 'assistant-active-tool',
      sessionId: 'session-active-tool',
      role: 'assistant',
      content: '',
      parts: [
        {
          id: 'part-active-tool',
          type: 'tool',
          toolCallId: 'tool-active',
          toolName: 'grep',
          status: 'executing',
          input: { pattern: 'needle' }
        }
      ],
      runtimeId: 'runtime-active-tool',
      createdAt: '2026-08-04T00:00:00.000Z',
      loading: false,
      finished: false
    };
    const updateMessage = vi.fn();
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageReader: { getMessages: (): ChatMessageRecord[] => [] },
      messageWriter: { addMessage: vi.fn(), updateMessage },
      listPendingRuntimeMessages: (): ChatMessageRecord[] => [structuredClone(pendingMessage)],
      streamExecutor: async (): Promise<{}> => {
        await streamOutcome;
        return {};
      }
    });

    await service.send({
      runtimeId: 'runtime-active-tool',
      sessionId: 'session-active-tool',
      turnId: 'turn-active-tool',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-active-tool',
      content: 'keep running'
    });
    await service.recoverInterruptedCompactions();

    expect(updateMessage).not.toHaveBeenCalledWith(expect.objectContaining({ id: pendingMessage.id, finished: true }));
    finishStream?.();
  });

  it('marks interrupted pending compactions failed while preserving successful checkpoints', async (): Promise<void> => {
    const messages: ChatMessageRecord[] = [
      {
        id: 'assistant-interrupted-compaction',
        sessionId: 'session-1',
        role: 'assistant',
        content: '',
        parts: [
          { id: 'checkpoint-pending', type: 'compaction', status: 'pending', trigger: 'automatic', createdAt: 1 },
          {
            id: 'checkpoint-success',
            type: 'compaction',
            status: 'success',
            trigger: 'automatic',
            boundaryPartId: 'source-1',
            sourceFingerprint: 'sha256:success',
            modelSnapshot: { providerType: 'openai', providerId: 'provider-1', modelId: 'model-1', contextWindow: 20_000 },
            budgetSnapshot: {
              outputReserve: 2_000,
              safetyReserve: 1_000,
              usableInputTokens: 17_000,
              triggerTokens: 13_600,
              targetTokens: 9_350,
              summaryMaxTokens: 2_000,
              rawTailMaxTokens: 4_000
            },
            summary: {
              schemaVersion: 1,
              objectives: [],
              facts: [],
              artifacts: [],
              completedActions: [],
              pendingActions: [],
              openQuestions: [],
              failures: []
            },
            createdAt: 1,
            completedAt: 2
          }
        ],
        createdAt: '2026-07-16T00:00:00.000Z',
        loading: true,
        finished: false
      }
    ];
    const updateMessage = vi.fn(async (message: ChatMessageRecord): Promise<void> => {
      messages[0] = structuredClone(message);
    });
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageReader: { getMessages: (): ChatMessageRecord[] => [] },
      messageWriter: { addMessage: vi.fn(), updateMessage },
      listPendingCompactionMessages: (): ChatMessageRecord[] => structuredClone(messages),
      now: () => '2026-07-16T00:00:03.000Z'
    });

    await service.recoverInterruptedCompactions();

    expect(updateMessage).toHaveBeenCalledOnce();
    expect(messages[0]).toMatchObject({ loading: false, finished: true });
    expect(messages[0].parts[0]).toMatchObject({ status: 'failed', errorCode: 'INTERRUPTED', completedAt: Date.parse('2026-07-16T00:00:03.000Z') });
    expect(messages[0].parts[1]).toMatchObject({ status: 'success', sourceFingerprint: 'sha256:success' });
  });

  it('retries interrupted compaction recovery after a persistence failure', async (): Promise<void> => {
    const pendingMessage: ChatMessageRecord = {
      id: 'assistant-retry-compaction',
      sessionId: 'session-retry',
      role: 'assistant',
      content: '',
      parts: [{ id: 'checkpoint-retry', type: 'compaction', status: 'pending', trigger: 'automatic', createdAt: 1 }],
      createdAt: '2026-07-16T00:00:00.000Z',
      loading: true,
      finished: false
    };
    let writeAttempt = 0;
    const recoveredWrites: ChatMessageRecord[] = [];
    const updateMessage = vi.fn(async (message: ChatMessageRecord): Promise<void> => {
      writeAttempt += 1;
      if (writeAttempt === 1) throw new Error('temporary persistence failure');
      recoveredWrites.push(structuredClone(message));
    });
    const service = createChatRuntimeService({
      emit: vi.fn(),
      messageReader: { getMessages: (): ChatMessageRecord[] => [] },
      messageWriter: { addMessage: vi.fn(), updateMessage },
      listPendingCompactionMessages: (): ChatMessageRecord[] => [structuredClone(pendingMessage)]
    });

    await service.recoverInterruptedCompactions();
    await service.recoverInterruptedCompactions();

    expect(updateMessage).toHaveBeenCalledTimes(2);
    expect(recoveredWrites[0].parts[0]).toMatchObject({ status: 'failed', errorCode: 'INTERRUPTED' });
  });

  it('lists and removes pending confirmation events', async (): Promise<void> => {
    const runtime = createRuntime();
    const requests = createRuntimeConfirmationRequests({ emit: vi.fn(), getRuntime: () => runtime });
    const decision = requests.request({
      runtimeId: runtime.runtimeId,
      confirmationId: 'confirmation-1',
      request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write' }
    });

    expect(requests.listPending(runtime.runtimeId)).toEqual([
      expect.objectContaining({ type: 'confirmation', event: expect.objectContaining({ confirmationId: 'confirmation-1' }) })
    ]);
    requests.submit({ runtimeId: runtime.runtimeId, confirmationId: 'confirmation-1', decision: { approved: false } });
    await decision;
    expect(requests.listPending(runtime.runtimeId)).toEqual([]);
  });

  it('lists and removes pending renderer tool events', async (): Promise<void> => {
    const runtime = createRuntime();
    const requests = createRuntimeRendererToolRequests({ emit: vi.fn(), getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({ runtime, toolCallId: 'tool-call-1', toolName: 'inspect_registered_page', input: {} });

    expect(requests.listPending(runtime.runtimeId)).toEqual([
      expect.objectContaining({ type: 'tool', event: expect.objectContaining({ toolCallId: 'tool-call-1' }) })
    ]);
    requests.submit({
      runtimeId: runtime.runtimeId,
      toolCallId: 'tool-call-1',
      result: { toolName: 'inspect_registered_page', status: 'success', data: { content: 'hello' } }
    });
    await result;
    expect(requests.listPending(runtime.runtimeId)).toEqual([]);
  });

  it('settles a renderer tool request when its cancellation notification throws', async (): Promise<void> => {
    const runtime = createRuntime();
    const emit = vi.fn(<TName extends keyof ChatRuntimeEventMap>(name: TName, payload: ChatRuntimeEventMap[TName]): void => {
      if (name !== 'chat:runtime:tool-cancelled') return;
      expect(payload).toMatchObject({ runtimeId: runtime.runtimeId, toolCallId: 'tool-call-failed-cancel' });
      throw new Error('cancel notification failed');
    });
    const requests = createRuntimeRendererToolRequests({ emit, getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({ runtime, toolCallId: 'tool-call-failed-cancel', toolName: 'inspect_registered_page', input: {} });

    expect((): void => requests.rejectRuntime(runtime.runtimeId, 'Runtime failed')).not.toThrow();
    const pendingAfterReject = requests.listPending(runtime.runtimeId);
    if (pendingAfterReject.length > 0) {
      requests.submit({
        runtimeId: runtime.runtimeId,
        toolCallId: 'tool-call-failed-cancel',
        result: { toolName: 'inspect_registered_page', status: 'failure', error: { code: 'TOOL_TIMEOUT', message: 'test cleanup' } }
      });
    }

    expect(pendingAfterReject).toEqual([]);
    await expect(result).rejects.toMatchObject({ code: 'TOOL_REQUEST_CANCELLED' });
  });

  it('rolls back a renderer tool request when its initial notification throws', async (): Promise<void> => {
    const runtime = createRuntime();
    const requests = createRuntimeRendererToolRequests({
      emit: (): never => {
        throw new Error('tool request notification failed');
      },
      getRuntime: () => runtime,
      timeoutMs: 30_000
    });

    const result = requests.request({ runtime, toolCallId: 'tool-call-notify-failed', toolName: 'inspect_registered_page', input: {} });

    await expect(result).rejects.toThrow('tool request notification failed');
    expect(requests.listPending(runtime.runtimeId)).toEqual([]);
  });

  it('rolls back a confirmation request when its initial notification throws', async (): Promise<void> => {
    const runtime = createRuntime();
    const requests = createRuntimeConfirmationRequests({
      emit: (): never => {
        throw new Error('confirmation notification failed');
      },
      getRuntime: () => runtime
    });

    const result = requests.request({
      runtimeId: runtime.runtimeId,
      confirmationId: 'confirmation-notify-failed',
      request: { toolName: 'write_file', title: '写入文件', description: '是否写入？', riskLevel: 'write' }
    });

    await expect(result).rejects.toThrow('confirmation notification failed');
    expect(requests.listPending(runtime.runtimeId)).toEqual([]);
  });

  it('rolls back a bridge request when its initial notification throws', async (): Promise<void> => {
    const runtime = createRuntime();
    const requests = createRuntimeBridgeRequests({
      emit: (): never => {
        throw new Error('bridge notification failed');
      },
      getRuntime: () => runtime,
      timeoutMs: 30_000
    });

    const result = requests.request({ runtimeId: runtime.runtimeId, requestId: 'bridge-notify-failed', kind: 'document-snapshot' });

    await expect(result).rejects.toThrow('bridge notification failed');
    expect(requests.listPending(runtime.runtimeId)).toEqual([]);
  });

  it('lists and removes pending bridge events', async (): Promise<void> => {
    const runtime = createRuntime();
    const requests = createRuntimeBridgeRequests({ emit: vi.fn(), getRuntime: () => runtime, timeoutMs: 30_000 });
    const result = requests.request({ runtimeId: runtime.runtimeId, requestId: 'bridge-1', kind: 'document-snapshot' });

    expect(requests.listPending(runtime.runtimeId)).toEqual([
      expect.objectContaining({ type: 'bridge', event: expect.objectContaining({ requestId: 'bridge-1' }) })
    ]);
    requests.submit({ runtimeId: runtime.runtimeId, requestId: 'bridge-1', result: { status: 'success', data: { content: 'hello' } } });
    await result;
    expect(requests.listPending(runtime.runtimeId)).toEqual([]);
  });
});
