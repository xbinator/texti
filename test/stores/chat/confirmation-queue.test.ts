/**
 * @file confirmation-queue.test.ts
 * @description Renderer application-level confirmation queue 的排序、选中与单调投影测试。
 * @vitest-environment jsdom
 */
import type { ChatAgentConfirmationSnapshot } from 'types/chat-agent';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatConfirmationQueueStore } from '@/stores/chat/confirmationQueue';

/** Confirmation recovery IPC 测试边界。 */
const agentAPI = vi.hoisted(() => ({
  listConfirmations: vi.fn()
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: (): Record<string, unknown> => ({
    chatAgentListConfirmations: agentAPI.listConfirmations
  })
}));

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
 * 创建 Renderer allowlist confirmation 快照。
 * @param confirmationId - confirmation 身份
 * @param riskLevel - 风险等级
 * @param createdAt - 请求时间
 * @param patch - 可覆盖字段
 * @returns confirmation 快照
 */
function confirmation(
  confirmationId: string,
  riskLevel: 'write' | 'dangerous',
  createdAt: string,
  patch: Partial<ChatAgentConfirmationSnapshot> = {}
): ChatAgentConfirmationSnapshot {
  return {
    confirmationId,
    sessionId: 'session-1',
    turnId: 'turn-1',
    taskId: `task-${confirmationId}`,
    attemptId: `attempt-${confirmationId}`,
    agentId: `agent-${confirmationId}`,
    runtimeId: `runtime-${confirmationId}`,
    toolCallId: `tool-call-${confirmationId}`,
    changesetId: `changeset-${confirmationId}`,
    status: 'pending',
    version: 1,
    riskLevel,
    displayPaths: [`${confirmationId}.md`],
    resourceScopes: [`file:/workspace/${confirmationId}.md`],
    unifiedDiff: `--- a/${confirmationId}.md\n+++ b/${confirmationId}.md`,
    baseRevision: 'a'.repeat(64),
    diffHash: 'b'.repeat(64),
    operationSetHash: 'c'.repeat(64),
    planHash: 'd'.repeat(64),
    createdAt,
    updatedAt: createdAt,
    ...patch
  };
}

describe('chat confirmation queue store', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    agentAPI.listConfirmations.mockReset();
  });

  it('orders dangerous before write before read and keeps explicit selection as a projection', (): void => {
    const store = useChatConfirmationQueueStore();
    store.addRuntime({
      source: 'runtime',
      confirmationId: 'read-1',
      sessionId: 'session-1',
      runtimeId: 'runtime-1',
      request: {
        toolName: 'read_file',
        title: '读取',
        description: '读取文件',
        riskLevel: 'read'
      },
      createdAt: '2026-07-27T00:00:00.000Z'
    });
    store.applySnapshot([
      confirmation('write-2', 'write', '2026-07-27T00:00:02.000Z'),
      confirmation('danger-1', 'dangerous', '2026-07-27T00:00:03.000Z'),
      confirmation('write-1', 'write', '2026-07-27T00:00:01.000Z')
    ]);

    expect(store.current?.confirmationId).toBe('danger-1');
    expect(store.pending.map((item): string => item.confirmationId)).toEqual(['danger-1', 'write-1', 'write-2', 'read-1']);
    store.select('write-2');
    expect(store.current?.confirmationId).toBe('write-2');
    expect(store.pending).toHaveLength(4);
  });

  it('ignores stale Agent events and removes only a terminal authoritative version', (): void => {
    const store = useChatConfirmationQueueStore();
    const pending = confirmation('write-1', 'write', '2026-07-27T00:00:00.000Z', {
      version: 2,
      updatedAt: '2026-07-27T00:00:02.000Z'
    });
    store.applyAgent(pending);
    store.applyAgent({ ...pending, version: 1, updatedAt: '2026-07-27T00:00:03.000Z' });

    expect(store.current).toMatchObject({ confirmationId: 'write-1', snapshot: { version: 2 } });

    store.applyAgent({ ...pending, status: 'approved', version: 3, updatedAt: '2026-07-27T00:00:04.000Z' });
    expect(store.current).toBeNull();
    store.applyAgent({ ...pending, status: 'pending', version: 2, updatedAt: '2026-07-27T00:00:05.000Z' });
    expect(store.current).toBeNull();
  });

  it('stores immutable Runtime routing identity without component ownership', (): void => {
    const store = useChatConfirmationQueueStore();
    store.addRuntime({
      source: 'runtime',
      confirmationId: 'runtime-1',
      sessionId: 'session-1',
      runtimeId: 'runtime-1',
      toolCallId: 'tool-call-1',
      request: {
        toolName: 'write_file',
        title: '写入',
        description: '写入文件',
        riskLevel: 'write'
      },
      createdAt: '2026-07-27T00:00:00.000Z'
    });
    store.applySnapshot([confirmation('agent-1', 'dangerous', '2026-07-27T00:00:01.000Z')]);

    expect(store.items['runtime-1']).toMatchObject({
      sessionId: 'session-1',
      runtimeId: 'runtime-1',
      toolCallId: 'tool-call-1'
    });
    expect(store.removeRuntime('runtime-1')).toBe(true);
    expect(store.pending.map((item): string => item.confirmationId)).toEqual(['agent-1']);
  });

  it('finds only exact pending Agent identities with consistent wrapper identity', (): void => {
    const store = useChatConfirmationQueueStore();
    const exact = confirmation('agent-1', 'write', '2026-07-27T00:00:01.000Z', {
      sessionId: 'session-1',
      taskId: 'task-1',
      attemptId: 'attempt-1'
    });
    store.applyAgent(exact);
    store.applyAgent(
      confirmation('agent-2', 'write', '2026-07-27T00:00:02.000Z', {
        sessionId: 'session-1',
        taskId: 'task-1',
        attemptId: 'attempt-2'
      })
    );
    store.items['wrapper-conflict'] = {
      source: 'agent',
      confirmationId: 'wrapper-conflict',
      snapshot: { ...exact, confirmationId: 'snapshot-conflict' },
      createdAt: exact.createdAt
    };

    expect(store.findAgent('session-1', 'task-1', 'attempt-1')).toEqual([expect.objectContaining({ confirmationId: 'agent-1' })]);
  });

  it('deduplicates recovery and removes only response-missing baseline items that stayed unchanged', async (): Promise<void> => {
    const store = useChatConfirmationQueueStore();
    const stale = confirmation('stale', 'write', '2026-07-27T00:00:00.000Z');
    const updated = confirmation('updated', 'write', '2026-07-27T00:00:01.000Z');
    const runtimeId = 'runtime-local';
    store.applyAgent(stale);
    store.applyAgent(updated);
    store.addRuntime({
      source: 'runtime',
      confirmationId: runtimeId,
      sessionId: 'session-1',
      runtimeId,
      request: {
        toolName: 'write_file',
        title: '写入',
        description: '写入本地',
        riskLevel: 'write'
      },
      createdAt: '2026-07-27T00:00:02.000Z'
    });
    const response = createDeferred<{
      ok: true;
      data: ChatAgentConfirmationSnapshot[];
    }>();
    agentAPI.listConfirmations.mockReturnValue(response.promise);

    const first = store.recoverAgent();
    const second = store.recoverAgent();
    store.applyAgent({ ...updated, version: 2, updatedAt: '2026-07-27T00:00:03.000Z' });
    store.applyAgent(confirmation('new', 'dangerous', '2026-07-27T00:00:04.000Z'));
    response.resolve({ ok: true, data: [] });
    await Promise.all([first, second]);

    expect(agentAPI.listConfirmations).toHaveBeenCalledOnce();
    expect(store.items.stale).toBeUndefined();
    expect(store.items.updated).toMatchObject({ snapshot: { version: 2 } });
    expect(store.items.new).toBeDefined();
    expect(store.items[runtimeId]).toBeDefined();
  });

  it('preserves the queue and clears the shared flight after recovery failure', async (): Promise<void> => {
    const store = useChatConfirmationQueueStore();
    store.applyAgent(confirmation('kept', 'write', '2026-07-27T00:00:00.000Z'));
    agentAPI.listConfirmations.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, data: [] });

    await expect(store.recoverAgent()).rejects.toThrow();
    expect(store.items.kept).toBeDefined();
    await store.recoverAgent();

    expect(agentAPI.listConfirmations).toHaveBeenCalledTimes(2);
    expect(store.items.kept).toBeUndefined();
  });

  it('keeps a terminal fence against arbitrarily newer pending snapshots', (): void => {
    const store = useChatConfirmationQueueStore();
    const pending = confirmation('fenced', 'write', '2026-07-27T00:00:00.000Z');
    store.applyAgent(pending);
    store.applyAgent({
      ...pending,
      status: 'approved',
      version: 2,
      updatedAt: '2026-07-27T00:00:01.000Z'
    });
    store.applyAgent({
      ...pending,
      status: 'pending',
      version: 99,
      updatedAt: '2026-07-27T00:00:09.000Z'
    });

    expect(store.items.fenced).toBeUndefined();
    expect(store.agentCursors.fenced).toMatchObject({
      version: 2,
      updatedAt: '2026-07-27T00:00:01.000Z',
      terminal: true
    });

    store.applyAgent({
      ...pending,
      status: 'revoked',
      version: 3,
      updatedAt: '2026-07-27T00:00:03.000Z'
    });
    expect(store.agentCursors.fenced).toMatchObject({ version: 3, terminal: true });
  });

  it('bounds terminal Agent cursors without evicting pending cursors', (): void => {
    const store = useChatConfirmationQueueStore();
    const active = confirmation('active-pending', 'write', '2026-07-27T00:00:00.000Z');
    store.applyAgent(active);

    for (let index = 0; index < 513; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 6, 28, 0, 0, index)).toISOString();
      const pending = confirmation(`terminal-${index}`, 'write', createdAt);
      store.applyAgent(pending);
      store.applyAgent({ ...pending, status: 'approved', version: 2, updatedAt: createdAt });
    }

    const terminalCursors = Object.values(store.agentCursors).filter((cursor): boolean => cursor.terminal);
    expect(terminalCursors).toHaveLength(512);
    expect(store.agentCursors['terminal-0']).toBeUndefined();
    expect(store.agentCursors['terminal-1']).toMatchObject({ terminal: true });
    expect(store.agentCursors['active-pending']).toMatchObject({ terminal: false });
  });

  it('refreshes terminal recency before capacity eviction', (): void => {
    const store = useChatConfirmationQueueStore();
    for (let index = 0; index < 512; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 6, 28, 0, 0, index)).toISOString();
      const pending = confirmation(String(index), 'write', createdAt);
      store.applyAgent(pending);
      store.applyAgent({ ...pending, status: 'approved', version: 2, updatedAt: createdAt });
    }

    const refreshed = confirmation('0', 'write', '2026-07-28T00:00:00.000Z');
    store.applyAgent({ ...refreshed, status: 'revoked', version: 3, updatedAt: '2026-07-28T00:09:00.000Z' });
    const newest = confirmation('512', 'write', '2026-07-28T00:09:01.000Z');
    store.applyAgent(newest);
    store.applyAgent({ ...newest, status: 'approved', version: 2, updatedAt: newest.updatedAt });

    expect(store.agentCursors['0']).toMatchObject({ version: 3, terminal: true });
    expect(store.agentCursors['1']).toBeUndefined();
  });

  it('turns an unchanged recovery-missing cursor into a terminal fence', async (): Promise<void> => {
    const store = useChatConfirmationQueueStore();
    const missing = confirmation('missing-terminal', 'write', '2026-07-27T00:00:00.000Z');
    store.applyAgent(missing);
    agentAPI.listConfirmations.mockResolvedValue({ ok: true, data: [] });

    await store.recoverAgent();
    store.applyAgent({ ...missing, version: 99, updatedAt: '2026-07-27T00:01:39.000Z' });

    expect(store.items['missing-terminal']).toBeUndefined();
    expect(store.agentCursors['missing-terminal']).toMatchObject({ terminal: true });
  });

  it('does not revive a terminal event from a recovery response with a forged higher pending version', async (): Promise<void> => {
    const store = useChatConfirmationQueueStore();
    const pending = confirmation('recovery-fenced', 'write', '2026-07-27T00:00:00.000Z');
    store.applyAgent(pending);
    const response = createDeferred<{
      ok: true;
      data: ChatAgentConfirmationSnapshot[];
    }>();
    agentAPI.listConfirmations.mockReturnValue(response.promise);
    const recovery = store.recoverAgent();

    store.applyAgent({
      ...pending,
      status: 'rejected',
      version: 2,
      updatedAt: '2026-07-27T00:00:02.000Z'
    });
    response.resolve({
      ok: true,
      data: [
        {
          ...pending,
          status: 'pending',
          version: 100,
          updatedAt: '2026-07-27T00:00:10.000Z'
        }
      ]
    });
    await recovery;

    expect(store.items['recovery-fenced']).toBeUndefined();
    expect(store.agentCursors['recovery-fenced']).toMatchObject({ version: 2, terminal: true });
  });

  it.each([
    ['sessionId', 'session-forged'],
    ['taskId', 'task-forged'],
    ['attemptId', 'attempt-forged']
  ] as const)('rejects a higher version that mutates immutable %s', (field, forgedValue): void => {
    const store = useChatConfirmationQueueStore();
    const original = confirmation('identity-frozen', 'write', '2026-07-27T00:00:00.000Z');
    store.applyAgent(original);
    store.applyAgent({
      ...original,
      [field]: forgedValue,
      version: 2,
      updatedAt: '2026-07-27T00:00:02.000Z'
    });

    expect(store.items['identity-frozen']).toMatchObject({
      snapshot: {
        [field]: original[field],
        version: 1
      }
    });
    expect(store.agentCursors['identity-frozen']).toMatchObject({ version: 1 });
  });

  it('turns a synchronous recovery throw into a rejected shared flight and allows retry', async (): Promise<void> => {
    const store = useChatConfirmationQueueStore();
    store.applyAgent(confirmation('sync-kept', 'write', '2026-07-27T00:00:00.000Z'));
    agentAPI.listConfirmations
      .mockImplementationOnce((): never => {
        throw new Error('sync-offline');
      })
      .mockResolvedValueOnce({ ok: true, data: [] });

    const first = store.recoverAgent();
    const second = store.recoverAgent();
    await Promise.all([expect(first).rejects.toThrow('sync-offline'), expect(second).rejects.toThrow('sync-offline')]);
    expect(store.items['sync-kept']).toBeDefined();

    await store.recoverAgent();
    expect(agentAPI.listConfirmations).toHaveBeenCalledTimes(2);
    expect(store.items['sync-kept']).toBeUndefined();
  });

  it.each([
    ['', 'task-1', 'attempt-1'],
    ['session-1', '', 'attempt-1'],
    ['session-1', 'task-1', '']
  ] as const)('rejects blank exact lookup identities', (sessionId, taskId, attemptId): void => {
    const store = useChatConfirmationQueueStore();
    store.applyAgent(
      confirmation('blank-lookup', 'write', '2026-07-27T00:00:00.000Z', {
        sessionId,
        taskId,
        attemptId
      })
    );

    expect(store.findAgent(sessionId, taskId, attemptId)).toEqual([]);
  });
});
