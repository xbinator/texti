/**
 * @file recovery-requests.test.ts
 * @description ChatRuntime 待处理 renderer 请求恢复投影测试。
 */
import type { ActiveChatRuntime } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { ChatMessageRecord } from 'types/chat';
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
    const result = requests.request({ runtime, toolCallId: 'tool-call-1', toolName: 'read_current_document', input: {} });

    expect(requests.listPending(runtime.runtimeId)).toEqual([
      expect.objectContaining({ type: 'tool', event: expect.objectContaining({ toolCallId: 'tool-call-1' }) })
    ]);
    requests.submit({
      runtimeId: runtime.runtimeId,
      toolCallId: 'tool-call-1',
      result: { toolName: 'read_current_document', status: 'success', data: { content: 'hello' } }
    });
    await result;
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
