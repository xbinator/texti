/**
 * @file use-agent-delegation-events.test.ts
 * @description renderer 委派恢复、单调去重、Runtime B 预注册与不确定错误对账测试。
 * @vitest-environment jsdom
 */
import type { ChatAgentApplicationEvent, ChatAgentCheckpointSnapshot, ChatAgentHandlerResult, ChatAgentResumeResult } from 'types/chat-agent';
import { effectScope } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChatActorSystem } from '@/ai/chat/actorSystem';
import { useAgentDelegationEvents } from '@/hooks/useChat/useAgentDelegationEvents';
import { useChatTabStore } from '@/stores/chat/tab';

const agentAPI = vi.hoisted(() => ({
  listener: undefined as ((event: ChatAgentApplicationEvent) => void) | undefined,
  listActive: vi.fn(),
  resumePrimary: vi.fn(),
  cancelCheckpoint: vi.fn(),
  onEvent: vi.fn((listener: (event: ChatAgentApplicationEvent) => void): (() => void) => {
    agentAPI.listener = listener;
    return vi.fn();
  })
}));

const loggerAPI = vi.hoisted(() => ({
  error: vi.fn()
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: (): Record<string, unknown> => ({
    chatAgentListActive: agentAPI.listActive,
    chatAgentResumePrimary: agentAPI.resumePrimary,
    chatAgentCancelCheckpoint: agentAPI.cancelCheckpoint,
    chatAgentOnEvent: agentAPI.onEvent
  })
}));

vi.mock('@/shared/logger', () => ({
  logger: loggerAPI
}));

/** 创建 renderer allowlist Checkpoint 快照。 */
function createSnapshot(patch: Partial<ChatAgentCheckpointSnapshot> = {}): ChatAgentCheckpointSnapshot {
  return {
    checkpointId: 'checkpoint-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    primaryAgentId: 'primary',
    rootRuntimeId: 'runtime-a',
    sourceRuntimeId: 'runtime-a',
    status: 'ready_to_resume',
    version: 2,
    checkpointSequence: 4,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-24T00:00:01.000Z',
    ...patch
  };
}

/** 等待委派 hook 的异步恢复链。 */
async function flushDelegation(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** 创建可手动完成的 Promise。 */
function createDeferred<T>(): {
  /** 被测逻辑等待的 Promise。 */
  promise: Promise<T>;
  /** 完成 Promise。 */
  resolve: (value: T) => void;
} {
  let resolveDeferred: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve): void => {
    resolveDeferred = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      if (!resolveDeferred) throw new Error('Deferred Promise resolver was not initialized');
      resolveDeferred(value);
    }
  };
}

/**
 * 创建一个仍由 Runtime A 驱动的 Session。
 * @param system - Actor system
 */
function startSourceRuntime(system: ReturnType<typeof createChatActorSystem>): void {
  system.recoverRuntime(
    {
      runtimeId: 'runtime-a',
      sessionId: 'session-1',
      turnId: 'turn-1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-a',
      phase: 'streaming',
      createdAt: 1,
      pendingRequests: []
    },
    {
      tools: [],
      getToolContext: (): undefined => undefined,
      handleBridgeRequest: async (): Promise<unknown> => undefined
    }
  );
}

/** 创建成功的 Runtime B 启动结果。 */
function createResumeResult(runtimeId = 'runtime-b'): Extract<ChatAgentResumeResult, { status: 'started' | 'already_started' }> {
  return {
    status: runtimeId === 'runtime-b' ? 'started' : 'already_started',
    checkpoint: createSnapshot({
      status: 'resuming',
      version: 3,
      checkpointSequence: 5,
      resumeRuntimeId: runtimeId
    }),
    address: {
      sessionId: 'session-1',
      turnId: 'turn-1',
      agentId: 'primary',
      runtimeId,
      parentRuntimeId: 'runtime-a',
      rootRuntimeId: 'runtime-a',
      continuationOfRuntimeId: 'runtime-a'
    }
  };
}

/**
 * 创建 Main 已幂等观察到终态的 resume 结果。
 * @param status - Checkpoint 终态
 * @returns 不会启动 Runtime 的 settled 结果
 */
function createSettledResult(status: 'completed' | 'failed' | 'cancelled' | 'interrupted' = 'completed'): ChatAgentResumeResult {
  const checkpoint: Extract<ChatAgentResumeResult, { status: 'settled' }>['checkpoint'] = {
    ...createSnapshot({
      ...(status === 'completed' || status === 'failed' ? { resumeRuntimeId: 'runtime-b' } : {})
    }),
    status,
    version: 4,
    checkpointSequence: 6
  };
  return {
    status: 'settled',
    checkpoint,
    ...(checkpoint.resumeRuntimeId
      ? {
          address: {
            sessionId: 'session-1',
            turnId: 'turn-1',
            agentId: 'primary',
            runtimeId: checkpoint.resumeRuntimeId,
            parentRuntimeId: 'runtime-a',
            rootRuntimeId: 'runtime-a',
            continuationOfRuntimeId: 'runtime-a'
          }
        }
      : {})
  };
}

describe('useAgentDelegationEvents', (): void => {
  beforeEach((): void => {
    setActivePinia(createPinia());
    agentAPI.listener = undefined;
    agentAPI.listActive.mockReset();
    agentAPI.resumePrimary.mockReset();
    agentAPI.cancelCheckpoint.mockReset();
    agentAPI.onEvent.mockClear();
    loggerAPI.error.mockReset();
  });

  it('waits for Runtime A suspension before claim and only resumes after persisted success', async (): Promise<void> => {
    const ready = createSnapshot();
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentResumeResult>>();
    const callOrder: string[] = [];
    agentAPI.onEvent.mockImplementation((listener: (event: ChatAgentApplicationEvent) => void): (() => void) => {
      callOrder.push('subscribe');
      agentAPI.listener = listener;
      return vi.fn();
    });
    agentAPI.listActive.mockImplementation(async (): Promise<ChatAgentHandlerResult<ChatAgentCheckpointSnapshot[]>> => {
      callOrder.push('list');
      return { ok: true, data: [ready] };
    });
    agentAPI.resumePrimary.mockReturnValue(deferred.promise);
    const system = createChatActorSystem();
    system.start();
    startSourceRuntime(system);
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-b' }));

    await flushDelegation();

    expect(callOrder.slice(0, 2)).toEqual(['subscribe', 'list']);
    expect(agentAPI.resumePrimary).not.toHaveBeenCalled();
    expect(system.getSession('session-1')?.getSnapshot().matches('waitingChildren')).toBe(true);
    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-b')).toBe(true);

    system.unregisterRuntime('runtime-a');
    await flushDelegation();

    expect(agentAPI.resumePrimary).toHaveBeenCalledOnce();
    expect(agentAPI.resumePrimary).toHaveBeenCalledWith({
      checkpointId: 'checkpoint-1',
      expectedVersion: 2,
      resumeRuntimeId: 'runtime-b'
    });
    expect(system.getSession('session-1')?.getSnapshot().matches('waitingChildren')).toBe(true);

    deferred.resolve({ ok: true, data: createResumeResult() });
    await flushDelegation();

    expect(system.actor.getSnapshot().context.runtimeRoutes.get('runtime-b')).toEqual(createResumeResult().address);
    expect(system.getRuntimeCapabilities('runtime-b')?.tools).toEqual([]);
    expect(system.getSession('session-1')?.getSnapshot().matches('running')).toBe(true);
    scope.stop();
    system.stop();
  });

  it('enters running from the persisted resuming event before the IPC response settles', async (): Promise<void> => {
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentResumeResult>>();
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [createSnapshot()] });
    agentAPI.resumePrimary.mockReturnValue(deferred.promise);
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-b' }));
    await flushDelegation();

    expect(system.getSession('session-1')?.getSnapshot().matches('waitingChildren')).toBe(true);
    agentAPI.listener?.({
      schemaVersion: 1,
      type: 'checkpoint.updated',
      checkpoint: createResumeResult().checkpoint,
      checkpointSequence: 5
    });
    await flushDelegation();

    expect(system.getSession('session-1')?.getSnapshot().matches('running')).toBe(true);
    deferred.resolve({ ok: true, data: createResumeResult() });
    await flushDelegation();
    expect(system.getSession('session-1')?.getSnapshot().matches('running')).toBe(true);
    scope.stop();
    system.stop();
  });

  it('retries the same Runtime tuple after a pre-CAS transport failure remains ready', async (): Promise<void> => {
    const ready = createSnapshot();
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [ready] });
    agentAPI.resumePrimary.mockRejectedValueOnce(new Error('transport closed before dispatch')).mockResolvedValueOnce({
      ok: true,
      data: createResumeResult()
    });
    const createRuntimeId = vi.fn((): string => 'runtime-b');
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId }));

    await flushDelegation();
    await flushDelegation();

    expect(agentAPI.resumePrimary).toHaveBeenCalledTimes(2);
    expect(agentAPI.resumePrimary.mock.calls[0]).toEqual(agentAPI.resumePrimary.mock.calls[1]);
    expect(createRuntimeId).toHaveBeenCalledOnce();
    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-b')).toBe(true);
    expect(system.getSession('session-1')?.getSnapshot().matches('running')).toBe(true);
    scope.stop();
    system.stop();
  });

  it('rolls back an INVALID_INPUT proposal without entering a fake running state', async (): Promise<void> => {
    const ready = createSnapshot();
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [ready] });
    agentAPI.resumePrimary.mockResolvedValue({ ok: false, code: 'INVALID_INPUT', error: 'invalid tuple' });
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-b' }));

    await flushDelegation();

    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-b')).toBe(false);
    expect(system.getSession('session-1')?.getSnapshot().matches('waitingChildren')).toBe(true);
    scope.stop();
    system.stop();
  });

  it('replaces a losing proposal with the authoritative winner Runtime', async (): Promise<void> => {
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [createSnapshot()] });
    agentAPI.resumePrimary.mockResolvedValue({ ok: true, data: createResumeResult('runtime-winner') });
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-proposed' }));

    await flushDelegation();

    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-proposed')).toBe(false);
    expect(system.actor.getSnapshot().context.runtimeRoutes.get('runtime-winner')).toEqual(createResumeResult('runtime-winner').address);
    expect(system.getSession('session-1')?.getSnapshot().context.turnRef?.getSnapshot().context.primaryAgentRef?.getSnapshot().context.runtimeId).toBe(
      'runtime-winner'
    );
    scope.stop();
    system.stop();
  });

  it('reconciles an unknown transport result to a different persisted winner Runtime', async (): Promise<void> => {
    const winner = createResumeResult('runtime-winner').checkpoint;
    agentAPI.listActive.mockResolvedValueOnce({ ok: true, data: [createSnapshot()] }).mockResolvedValueOnce({ ok: true, data: [winner] });
    agentAPI.resumePrimary.mockRejectedValueOnce(new Error('transport closed after dispatch'));
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-proposed' }));

    await flushDelegation();
    await flushDelegation();

    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-proposed')).toBe(false);
    expect(system.actor.getSnapshot().context.runtimeRoutes.get('runtime-winner')).toEqual(createResumeResult('runtime-winner').address);
    expect(system.getSession('session-1')?.getSnapshot().matches('running')).toBe(true);
    scope.stop();
    system.stop();
  });

  it('retries an absent active snapshot with the same tuple and projects a fast settled completion', async (): Promise<void> => {
    agentAPI.listActive.mockResolvedValueOnce({ ok: true, data: [createSnapshot()] }).mockResolvedValue({ ok: true, data: [] });
    agentAPI.resumePrimary.mockRejectedValueOnce(new Error('first response lost')).mockResolvedValueOnce({
      ok: true,
      data: createSettledResult()
    });
    const createRuntimeId = vi.fn((): string => 'runtime-b');
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId }));

    await flushDelegation();
    await flushDelegation();

    expect(agentAPI.resumePrimary).toHaveBeenCalledTimes(2);
    expect(agentAPI.resumePrimary.mock.calls[0]).toEqual(agentAPI.resumePrimary.mock.calls[1]);
    expect(createRuntimeId).toHaveBeenCalledOnce();
    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-b')).toBe(false);
    expect(system.getRuntimeCapabilities('runtime-b')).toBeUndefined();
    expect(system.getSession('session-1')?.getSnapshot().matches('idle')).toBe(true);
    scope.stop();
    system.stop();
  });

  it('clears an exhausted ResumeFlight ghost while keeping the Session fail-closed busy', async (): Promise<void> => {
    agentAPI.listActive.mockResolvedValueOnce({ ok: true, data: [createSnapshot()] }).mockResolvedValue({ ok: true, data: [] });
    agentAPI.resumePrimary.mockRejectedValue(new Error('transport unavailable'));
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-b' }));

    await flushDelegation();
    await flushDelegation();

    expect(agentAPI.resumePrimary).toHaveBeenCalledTimes(2);
    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-b')).toBe(false);
    expect(system.getRuntimeCapabilities('runtime-b')).toBeUndefined();
    expect(system.getSession('session-1')?.getSnapshot().matches('waitingChildren')).toBe(true);
    expect(loggerAPI.error).toHaveBeenCalledWith('[chat-agent-resume-exhausted] checkpointId=checkpoint-1');
    scope.stop();
    system.stop();
  });

  it('allows a newer authoritative ready version to establish a new ResumeFlight after exhaustion', async (): Promise<void> => {
    const newerReady = createSnapshot({ version: 3, checkpointSequence: 5 });
    const resumedBase = createResumeResult('runtime-c');
    const resumed: typeof resumedBase = {
      ...resumedBase,
      checkpoint: {
        ...resumedBase.checkpoint,
        version: 4,
        checkpointSequence: 6
      }
    };
    agentAPI.listActive.mockResolvedValueOnce({ ok: true, data: [createSnapshot()] }).mockResolvedValue({ ok: true, data: [] });
    agentAPI.resumePrimary
      .mockRejectedValueOnce(new Error('first transport failure'))
      .mockRejectedValueOnce(new Error('second transport failure'))
      .mockResolvedValueOnce({
        ok: true,
        data: resumed
      });
    const createRuntimeId = vi.fn().mockReturnValueOnce('runtime-b').mockReturnValueOnce('runtime-c');
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId }));

    await flushDelegation();
    await flushDelegation();
    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-b')).toBe(false);

    agentAPI.listener?.({
      schemaVersion: 1,
      type: 'checkpoint.updated',
      checkpoint: newerReady,
      checkpointSequence: newerReady.checkpointSequence
    });
    await flushDelegation();

    expect(agentAPI.resumePrimary).toHaveBeenCalledTimes(3);
    expect(agentAPI.resumePrimary).toHaveBeenLastCalledWith({
      checkpointId: 'checkpoint-1',
      expectedVersion: 3,
      resumeRuntimeId: 'runtime-c'
    });
    expect(createRuntimeId).toHaveBeenCalledTimes(2);
    expect(system.actor.getSnapshot().context.runtimeRoutes.get('runtime-c')).toEqual(resumed.address);
    expect(system.getSession('session-1')?.getSnapshot().matches('running')).toBe(true);
    scope.stop();
    system.stop();
  });

  it('fails closed when Main returns a conflicting address for the proposed Runtime ID', async (): Promise<void> => {
    const result = createResumeResult();
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [createSnapshot()] });
    agentAPI.resumePrimary.mockResolvedValue({
      ok: true,
      data: { ...result, address: { ...result.address, rootRuntimeId: 'runtime-other' } }
    });
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-b' }));

    await flushDelegation();

    expect(system.actor.getSnapshot().context.routeConflicts.has('runtime-b')).toBe(false);
    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-b')).toBe(false);
    expect(system.getRuntimeCapabilities('runtime-b')).toBeUndefined();
    expect(system.getSession('session-1')?.getSnapshot().matches('waitingChildren')).toBe(true);
    system.send({ type: 'runtime.event', runtimeId: 'runtime-b', event: { type: 'runtime.started', runtimeId: 'runtime-b' } });
    expect(system.getSession('session-1')?.getSnapshot().matches('waitingChildren')).toBe(true);
    scope.stop();
    system.stop();
  });

  it('does not resurrect a terminal Checkpoint when a stale resume response arrives late', async (): Promise<void> => {
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentResumeResult>>();
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [createSnapshot()] });
    agentAPI.resumePrimary.mockReturnValue(deferred.promise);
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-b' }));
    await flushDelegation();

    agentAPI.listener?.({
      schemaVersion: 1,
      type: 'checkpoint.updated',
      checkpoint: createSnapshot({ status: 'interrupted', version: 4, checkpointSequence: 6 }),
      checkpointSequence: 6
    });
    await flushDelegation();
    deferred.resolve({ ok: true, data: createResumeResult() });
    await flushDelegation();

    expect(system.getSession('session-1')?.getSnapshot().matches('idle')).toBe(true);
    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-b')).toBe(false);
    scope.stop();
    system.stop();
  });

  it('does not recreate a route when a settled response arrives after a newer terminal event', async (): Promise<void> => {
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentResumeResult>>();
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [createSnapshot()] });
    agentAPI.resumePrimary.mockReturnValue(deferred.promise);
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-b' }));
    await flushDelegation();

    agentAPI.listener?.({
      schemaVersion: 1,
      type: 'checkpoint.updated',
      checkpoint: createSnapshot({ status: 'interrupted', version: 5, checkpointSequence: 7 }),
      checkpointSequence: 7
    });
    await flushDelegation();
    deferred.resolve({ ok: true, data: createSettledResult() });
    await flushDelegation();

    expect(system.getSession('session-1')?.getSnapshot().matches('idle')).toBe(true);
    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-b')).toBe(false);
    expect(system.getRuntimeCapabilities('runtime-b')).toBeUndefined();
    scope.stop();
    system.stop();
  });

  it('ignores a resume response that settles after the hook scope is disposed', async (): Promise<void> => {
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentResumeResult>>();
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [createSnapshot()] });
    agentAPI.resumePrimary.mockReturnValue(deferred.promise);
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-b' }));
    await flushDelegation();
    expect(agentAPI.resumePrimary).toHaveBeenCalledOnce();

    scope.stop();
    deferred.resolve({ ok: true, data: createResumeResult() });
    await flushDelegation();

    expect(system.actor.getSnapshot().context.runtimeRoutes.has('runtime-b')).toBe(false);
    expect(system.getRuntimeCapabilities('runtime-b')).toBeUndefined();
    expect(system.getSession('session-1')?.getSnapshot().matches('waitingChildren')).toBe(true);
    system.stop();
  });

  it('projects the persisted cancel response when event publication is lost', async (): Promise<void> => {
    const waiting = createSnapshot({ status: 'waiting_children', version: 1, checkpointSequence: 3 });
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [waiting] });
    agentAPI.cancelCheckpoint.mockResolvedValue({
      ok: true,
      data: createSnapshot({ status: 'cancelled', version: 3, checkpointSequence: 5 })
    });
    const system = createChatActorSystem();
    system.start();
    useChatTabStore().ensureTab('chat:session-1', 'session-1');
    useChatTabStore().setStatus('chat:session-1', 'waiting');
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { createRuntimeId: (): string => 'runtime-b' }));
    await flushDelegation();

    system.sendToSession('session-1', { type: 'session.cancelRequested' });
    await flushDelegation();
    expect(agentAPI.cancelCheckpoint).toHaveBeenCalledOnce();
    expect(system.getSession('session-1')?.getSnapshot().matches('idle')).toBe(true);
    expect(useChatTabStore().getStatus('chat:session-1')).toBe('idle');
    scope.stop();
    system.stop();
  });

  it('observes cancel intent that happened before the watcher was registered', async (): Promise<void> => {
    const waiting = createSnapshot({ status: 'waiting_children', version: 1, checkpointSequence: 3 });
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [waiting] });
    agentAPI.cancelCheckpoint.mockResolvedValue({
      ok: true,
      data: createSnapshot({ status: 'cancelled', version: 3, checkpointSequence: 5 })
    });
    const system = createChatActorSystem();
    system.start();
    system.recoverDelegation(waiting);
    system.sendToSession('session-1', { type: 'session.cancelRequested' });
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system));

    await flushDelegation();

    expect(agentAPI.cancelCheckpoint).toHaveBeenCalledOnce();
    expect(system.getSession('session-1')?.getSnapshot().matches('idle')).toBe(true);
    scope.stop();
    system.stop();
  });

  it('uses a bounded watchdog to reconcile cancellation without declaring local success', async (): Promise<void> => {
    vi.useFakeTimers();
    const waiting = createSnapshot({ status: 'waiting_children', version: 1, checkpointSequence: 3 });
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [waiting] });
    agentAPI.cancelCheckpoint.mockResolvedValue({ ok: false, error: 'transport unavailable', code: 'UNKNOWN' });
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { reconcileDelayMs: 50 }));
    await flushDelegation();

    system.sendToSession('session-1', { type: 'session.cancelRequested' });
    await flushDelegation();
    const callsBeforeWatchdog = agentAPI.cancelCheckpoint.mock.calls.length;
    expect(system.getSession('session-1')?.getSnapshot().matches('cancellingChildren')).toBe(true);

    await vi.advanceTimersByTimeAsync(49);
    expect(agentAPI.cancelCheckpoint).toHaveBeenCalledTimes(callsBeforeWatchdog);
    await vi.advanceTimersByTimeAsync(1);
    await flushDelegation();
    expect(agentAPI.listActive.mock.calls.length).toBeGreaterThan(1);
    expect(agentAPI.cancelCheckpoint.mock.calls.length).toBeGreaterThan(callsBeforeWatchdog);
    expect(system.getSession('session-1')?.getSnapshot().matches('cancellingChildren')).toBe(true);

    const callsBeforeDispose = agentAPI.cancelCheckpoint.mock.calls.length;
    scope.stop();
    await vi.advanceTimersByTimeAsync(200);
    expect(agentAPI.cancelCheckpoint).toHaveBeenCalledTimes(callsBeforeDispose);
    system.stop();
    vi.useRealTimers();
  });

  it('keeps the same CancelFlight across listActive absence and obtains the terminal retry result', async (): Promise<void> => {
    vi.useFakeTimers();
    const waiting = createSnapshot({ status: 'waiting_children', version: 1, checkpointSequence: 3 });
    agentAPI.listActive.mockResolvedValueOnce({ ok: true, data: [waiting] }).mockResolvedValue({ ok: true, data: [] });
    agentAPI.cancelCheckpoint.mockRejectedValueOnce(new Error('first cancel response lost')).mockResolvedValueOnce({
      ok: true,
      data: createSnapshot({ status: 'cancelled', version: 3, checkpointSequence: 5 })
    });
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { reconcileDelayMs: 50 }));
    await flushDelegation();

    system.sendToSession('session-1', { type: 'session.cancelRequested' });
    await flushDelegation();
    expect(agentAPI.cancelCheckpoint).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(50);
    await flushDelegation();

    expect(agentAPI.cancelCheckpoint).toHaveBeenCalledTimes(2);
    expect(system.getSession('session-1')?.getSnapshot().matches('idle')).toBe(true);
    scope.stop();
    system.stop();
    vi.useRealTimers();
  });

  it('caps cooperative cancellation at three attempts while the checkpoint stays absent', async (): Promise<void> => {
    vi.useFakeTimers();
    const waiting = createSnapshot({ status: 'waiting_children', version: 1, checkpointSequence: 3 });
    agentAPI.listActive.mockResolvedValueOnce({ ok: true, data: [waiting] }).mockResolvedValue({ ok: true, data: [] });
    agentAPI.cancelCheckpoint.mockRejectedValue(new Error('cancel transport unavailable'));
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { reconcileDelayMs: 50 }));
    await flushDelegation();

    system.sendToSession('session-1', { type: 'session.cancelRequested' });
    await flushDelegation();
    await vi.advanceTimersByTimeAsync(100);
    await flushDelegation();
    expect(agentAPI.cancelCheckpoint).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(500);
    await flushDelegation();
    expect(agentAPI.cancelCheckpoint).toHaveBeenCalledTimes(3);
    expect(system.getSession('session-1')?.getSnapshot().matches('cancellingChildren')).toBe(true);
    scope.stop();
    system.stop();
    vi.useRealTimers();
  });

  it('clears cancellation requesting in finally when terminal projection fails', async (): Promise<void> => {
    vi.useFakeTimers();
    const waiting = createSnapshot({ status: 'waiting_children', version: 1, checkpointSequence: 3 });
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [waiting] });
    agentAPI.cancelCheckpoint
      .mockResolvedValueOnce({
        ok: true,
        data: createSnapshot({ turnId: 'turn-conflict', status: 'cancelled', version: 3, checkpointSequence: 5 })
      })
      .mockResolvedValueOnce({
        ok: true,
        data: createSnapshot({ status: 'cancelled', version: 4, checkpointSequence: 6 })
      });
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system, { reconcileDelayMs: 50 }));
    await flushDelegation();

    system.sendToSession('session-1', { type: 'session.cancelRequested' });
    await flushDelegation();
    expect(agentAPI.cancelCheckpoint).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(50);
    await flushDelegation();

    expect(agentAPI.cancelCheckpoint).toHaveBeenCalledTimes(2);
    expect(system.getSession('session-1')?.getSnapshot().matches('idle')).toBe(true);
    scope.stop();
    system.stop();
    vi.useRealTimers();
  });

  it('ignores a cancellation response that settles after the hook scope is disposed', async (): Promise<void> => {
    const deferred = createDeferred<ChatAgentHandlerResult<ChatAgentCheckpointSnapshot>>();
    const waiting = createSnapshot({ status: 'waiting_children', version: 1, checkpointSequence: 3 });
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [waiting] });
    agentAPI.cancelCheckpoint.mockReturnValue(deferred.promise);
    const system = createChatActorSystem();
    system.start();
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system));
    await flushDelegation();
    system.sendToSession('session-1', { type: 'session.cancelRequested' });
    await flushDelegation();

    scope.stop();
    deferred.resolve({
      ok: true,
      data: createSnapshot({ status: 'cancelled', version: 3, checkpointSequence: 5 })
    });
    await flushDelegation();

    expect(system.getSession('session-1')?.getSnapshot().matches('cancellingChildren')).toBe(true);
    system.stop();
  });

  it('marks an owned tab as error for a persisted interruption without creating a new owner', async (): Promise<void> => {
    const waiting = createSnapshot({ status: 'waiting_children', version: 1, checkpointSequence: 3 });
    agentAPI.listActive.mockResolvedValue({ ok: true, data: [waiting] });
    const system = createChatActorSystem();
    system.start();
    useChatTabStore().ensureTab('chat:session-1', 'session-1');
    const scope = effectScope();
    scope.run((): void => useAgentDelegationEvents(system));
    await flushDelegation();

    agentAPI.listener?.({
      schemaVersion: 1,
      type: 'checkpoint.updated',
      checkpoint: createSnapshot({ status: 'interrupted', version: 3, checkpointSequence: 5 }),
      checkpointSequence: 5
    });
    await flushDelegation();

    expect(useChatTabStore().getStatus('chat:session-1')).toBe('error');
    expect(useChatTabStore().findOwner('session-missing')).toBeUndefined();
    scope.stop();
    system.stop();
  });
});
