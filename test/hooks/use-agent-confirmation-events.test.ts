/**
 * @file use-agent-confirmation-events.test.ts
 * @description Renderer confirmation application event 的先订阅后恢复与单调收敛测试。
 * @vitest-environment jsdom
 */
import type { ChatAgentApplicationEvent, ChatAgentConfirmationSnapshot, ChatAgentHandlerResult } from 'types/chat-agent';
import { effectScope } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentConfirmationEvents } from '@/hooks/useChat/useAgentConfirmationEvents';
import { useChatConfirmationQueueStore } from '@/stores/chat/confirmationQueue';

const agentAPI = vi.hoisted(() => ({
  listener: undefined as ((event: ChatAgentApplicationEvent) => void) | undefined,
  listConfirmations: vi.fn(),
  dispose: vi.fn(),
  onEvent: vi.fn((listener: (event: ChatAgentApplicationEvent) => void): (() => void) => {
    agentAPI.listener = listener;
    return agentAPI.dispose;
  })
}));

const loggerAPI = vi.hoisted(() => ({
  error: vi.fn()
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: (): Record<string, unknown> => ({
    chatAgentListConfirmations: agentAPI.listConfirmations,
    chatAgentOnEvent: agentAPI.onEvent
  })
}));

vi.mock('@/shared/logger', () => ({
  logger: loggerAPI
}));

/**
 * 创建公开 confirmation 快照。
 * @param patch - 可覆盖字段
 * @returns confirmation 快照
 */
function createSnapshot(patch: Partial<ChatAgentConfirmationSnapshot> = {}): ChatAgentConfirmationSnapshot {
  return {
    confirmationId: 'confirmation-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    agentId: 'child-1',
    runtimeId: 'runtime-1',
    toolCallId: 'tool-call-1',
    changesetId: 'changeset-1',
    status: 'pending',
    version: 1,
    riskLevel: 'write',
    displayPaths: ['notes.md'],
    resourceScopes: ['file:/workspace/notes.md'],
    unifiedDiff: '--- a/notes.md\n+++ b/notes.md',
    baseRevision: 'a'.repeat(64),
    diffHash: 'b'.repeat(64),
    operationSetHash: 'c'.repeat(64),
    planHash: 'd'.repeat(64),
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z',
    ...patch
  };
}

/** 可手动完成的测试 Promise。 */
interface Deferred<T> {
  /** 未决 Promise。 */
  promise: Promise<T>;
  /** 完成 Promise。 */
  resolve: (value: T) => void;
}

/**
 * 创建可手动完成的 Promise。
 * @returns Deferred 控制器
 */
function createDeferred<T>(): Deferred<T> {
  let resolvePromise: (value: T) => void = (): void => undefined;
  const promise = new Promise<T>((resolve): void => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

/**
 * 等待 hook 的异步 list 恢复完成。
 */
async function flushConfirmationEvents(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('useAgentConfirmationEvents', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    agentAPI.listener = undefined;
    agentAPI.listConfirmations.mockReset();
    agentAPI.onEvent.mockClear();
    agentAPI.dispose.mockReset();
    loggerAPI.error.mockReset();
  });

  it('subscribes before listing and converges an event newer than the recovery snapshot', async (): Promise<void> => {
    let resolveList: ((result: ChatAgentHandlerResult<ChatAgentConfirmationSnapshot[]>) => void) | undefined;
    agentAPI.listConfirmations.mockReturnValue(
      new Promise<ChatAgentHandlerResult<ChatAgentConfirmationSnapshot[]>>((resolve): void => {
        resolveList = resolve;
      })
    );
    const scope = effectScope();
    scope.run((): void => useAgentConfirmationEvents());
    await Promise.resolve();

    expect(agentAPI.onEvent).toHaveBeenCalledBefore(agentAPI.listConfirmations);
    agentAPI.listener?.({
      schemaVersion: 1,
      type: 'confirmation.updated',
      confirmation: createSnapshot({
        version: 2,
        updatedAt: '2026-07-27T00:00:02.000Z'
      })
    });
    resolveList?.({ ok: true, data: [createSnapshot()] });
    await flushConfirmationEvents();

    expect(useChatConfirmationQueueStore().current).toMatchObject({
      confirmationId: 'confirmation-1',
      snapshot: { version: 2 }
    });
    scope.stop();
    expect(agentAPI.dispose).toHaveBeenCalledOnce();
  });

  it('ignores checkpoint events and removes a resolved confirmation event', async (): Promise<void> => {
    agentAPI.listConfirmations.mockResolvedValue({ ok: true, data: [createSnapshot()] });
    const scope = effectScope();
    scope.run((): void => useAgentConfirmationEvents());
    await flushConfirmationEvents();

    agentAPI.listener?.({
      schemaVersion: 1,
      type: 'checkpoint.updated',
      checkpoint: {
        checkpointId: 'checkpoint-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        primaryAgentId: 'primary',
        rootRuntimeId: 'runtime-a',
        sourceRuntimeId: 'runtime-a',
        status: 'waiting_children',
        version: 1,
        checkpointSequence: 1,
        createdAt: '2026-07-27T00:00:00.000Z',
        updatedAt: '2026-07-27T00:00:00.000Z'
      },
      checkpointSequence: 1
    });
    expect(useChatConfirmationQueueStore().current?.confirmationId).toBe('confirmation-1');

    agentAPI.listener?.({
      schemaVersion: 1,
      type: 'confirmation.updated',
      confirmation: createSnapshot({
        status: 'approved',
        version: 2,
        updatedAt: '2026-07-27T00:00:02.000Z'
      })
    });
    expect(useChatConfirmationQueueStore().current).toBeNull();
    scope.stop();
  });

  it('shares one Store recovery flight across concurrent hook subscribers', async (): Promise<void> => {
    const recovery = createDeferred<ChatAgentHandlerResult<ChatAgentConfirmationSnapshot[]>>();
    agentAPI.listConfirmations.mockReturnValue(recovery.promise);
    const firstScope = effectScope();
    const secondScope = effectScope();

    firstScope.run((): void => useAgentConfirmationEvents());
    secondScope.run((): void => useAgentConfirmationEvents());
    expect(agentAPI.onEvent).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(agentAPI.listConfirmations).toHaveBeenCalledOnce();

    recovery.resolve({ ok: true, data: [createSnapshot()] });
    await flushConfirmationEvents();
    expect(useChatConfirmationQueueStore().current?.confirmationId).toBe('confirmation-1');
    firstScope.stop();
    secondScope.stop();
  });
});
