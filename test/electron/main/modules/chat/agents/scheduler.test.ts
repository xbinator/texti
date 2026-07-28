/**
 * @file scheduler.test.ts
 * @description 验证 resource-scoped Child lease 的兼容性、公平性、重放、截止时间和取消语义。
 */
import type { AgentTaskPriority } from 'types/chat-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentSchedulerError,
  createAgentResourceScheduler,
  type AgentResourceLease,
  type AgentResourceLeaseKind,
  type AgentResourceScheduler,
  type AgentScheduleRequest
} from '../../../../../../electron/main/modules/chat/agents/scheduler.mjs';

/** 测试时固定的调度器当前时间。 */
const NOW = '2026-07-27T00:00:00.000Z';

/** 测试使用的默认冲突资源。 */
const SHARED_SCOPE = 'file:/workspace/shared.md';

/**
 * 创建规范的资源 lease 请求。
 * @param taskId - Task 身份
 * @param kind - lease 种类
 * @param options - phase、排序、截止时间和 scope 覆盖
 * @returns 可入队请求
 */
function createRequest(
  taskId: string,
  kind: AgentResourceLeaseKind = 'shared-read',
  options: {
    phase?: AgentScheduleRequest['phase'];
    priority?: AgentTaskPriority;
    createdAt?: string;
    deadlineAt?: string;
    resourceScopes?: readonly string[];
  } = {}
): AgentScheduleRequest {
  return {
    taskId,
    phase: options.phase ?? 'start',
    kind,
    priority: options.priority ?? 'normal',
    createdAt: options.createdAt ?? NOW,
    deadlineAt: options.deadlineAt ?? '2026-07-27T01:00:00.000Z',
    resourceScopes: options.resourceScopes ?? [SHARED_SCOPE]
  };
}

/**
 * 幂等释放测试 leases。
 * @param leases - 待释放 leases
 */
function releaseLeases(leases: readonly AgentResourceLease[]): void {
  leases.forEach((lease): void => {
    lease.release();
  });
}

/**
 * 为指定 kind 创建足以阻塞同 scope 请求的活动 leases。
 * @param scheduler - 当前隔离调度器
 * @param kind - 待阻塞请求种类
 * @returns 需要在断言后释放的 blockers
 */
async function createBlockers(scheduler: AgentResourceScheduler, kind: AgentResourceLeaseKind): Promise<AgentResourceLease[]> {
  if (kind !== 'shared-read') return [await scheduler.enqueue(createRequest(`block-${kind}`))];
  return Promise.all([
    scheduler.enqueue(createRequest('block-read-1')),
    scheduler.enqueue(createRequest('block-read-2')),
    scheduler.enqueue(createRequest('block-read-3'))
  ]);
}

afterEach((): void => {
  vi.useRealTimers();
});

describe('agent resource scheduler', (): void => {
  it('allows overlapping shared reads up to the global three-slot limit', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();
    const leases = await Promise.all([
      scheduler.enqueue(createRequest('read-1')),
      scheduler.enqueue(createRequest('read-2')),
      scheduler.enqueue(createRequest('read-3'))
    ]);
    const fourthPromise = scheduler.enqueue(createRequest('read-4'));

    expect(leases.map((lease): AgentResourceLeaseKind => lease.kind)).toEqual(['shared-read', 'shared-read', 'shared-read']);
    expect(scheduler.activeCount()).toBe(3);
    expect(scheduler.queuedCount()).toBe(1);

    leases[0]?.release();
    const fourth = await fourthPromise;
    expect(fourth).toMatchObject({ taskId: 'read-4', phase: 'start', kind: 'shared-read' });
    releaseLeases([...leases, fourth]);
  });

  it('serializes a conflicting write-intent behind all active readers', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();
    const readA = await scheduler.enqueue(createRequest('read-a'));
    const readB = await scheduler.enqueue(createRequest('read-b'));
    const writerPromise = scheduler.enqueue(createRequest('write-a', 'write-intent'));

    expect(scheduler.activeCount()).toBe(2);
    expect(scheduler.queuedCount()).toBe(1);
    readA.release();
    expect(scheduler.queuedCount()).toBe(1);
    readB.release();

    const writer = await writerPromise;
    expect(writer).toMatchObject({ taskId: 'write-a', phase: 'start', kind: 'write-intent' });
    writer.release();
  });

  it('allows non-overlapping write-intents to run concurrently', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();
    const leases = await Promise.all([
      scheduler.enqueue(createRequest('write-a', 'write-intent', { resourceScopes: ['file:/workspace/a.md'] })),
      scheduler.enqueue(createRequest('write-b', 'write-intent', { resourceScopes: ['file:/workspace/b.md'] }))
    ]);

    expect(scheduler.activeCount()).toBe(2);
    expect(leases.map((lease): AgentResourceLeaseKind => lease.kind)).toEqual(['write-intent', 'write-intent']);
    releaseLeases(leases);
  });

  it.each<AgentResourceLeaseKind>(['shared-read', 'write-intent', 'exclusive-commit'])(
    'makes exclusive-commit conflict with active %s on the same scope',
    async (activeKind): Promise<void> => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const scheduler = createAgentResourceScheduler();
      const activePhase = activeKind === 'exclusive-commit' ? 'commit' : 'start';
      const active = await scheduler.enqueue(createRequest(`active-${activeKind}`, activeKind, { phase: activePhase }));
      const commitPromise = scheduler.enqueue(createRequest(`commit-after-${activeKind}`, 'exclusive-commit', { phase: 'commit' }));

      expect(scheduler.queuedCount()).toBe(1);
      active.release();
      const commit = await commitPromise;
      expect(commit.kind).toBe('exclusive-commit');
      commit.release();
    }
  );

  it('prevents a later equal-priority reader from bypassing a queued writer', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();
    const active = await scheduler.enqueue(createRequest('active-reader', 'shared-read', { createdAt: '2026-07-27T00:00:00.000Z' }));
    const started: string[] = [];
    const writerPromise = scheduler
      .enqueue(createRequest('queued-writer', 'write-intent', { createdAt: '2026-07-27T00:00:01.000Z' }))
      .then((lease): AgentResourceLease => {
        started.push(lease.taskId);
        return lease;
      });
    const readerPromise = scheduler
      .enqueue(createRequest('later-reader', 'shared-read', { createdAt: '2026-07-27T00:00:02.000Z' }))
      .then((lease): AgentResourceLease => {
        started.push(lease.taskId);
        return lease;
      });

    expect(scheduler.activeCount()).toBe(1);
    expect(scheduler.queuedCount()).toBe(2);
    active.release();
    const writer = await writerPromise;
    expect(started).toEqual(['queued-writer']);
    expect(scheduler.queuedCount()).toBe(1);
    writer.release();
    const reader = await readerPromise;
    expect(started).toEqual(['queued-writer', 'later-reader']);
    reader.release();
  });

  it('lets a higher-priority reader bypass a normal writer without preempting active work', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();
    const active = await scheduler.enqueue(createRequest('active-reader'));
    const writerPromise = scheduler.enqueue(createRequest('normal-writer', 'write-intent'));
    const highReader = await scheduler.enqueue(createRequest('high-reader', 'shared-read', { priority: 'high' }));

    expect(active.signal.aborted).toBe(false);
    expect(highReader.kind).toBe('shared-read');
    expect(scheduler.activeCount()).toBe(2);
    highReader.release();
    active.release();
    const writer = await writerPromise;
    writer.release();
  });

  it('returns the same phase promise for exact replay and rejects a changed claim', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();
    const activeWriter = await scheduler.enqueue(createRequest('blocker', 'write-intent'));
    const request = createRequest('replayed-task');
    const first = scheduler.enqueue(request);
    const replay = scheduler.enqueue({ ...request, resourceScopes: [...request.resourceScopes].reverse() });
    const conflict = scheduler.enqueue({ ...request, kind: 'write-intent' });

    expect(replay).toBe(first);
    await expect(conflict).rejects.toMatchObject({
      code: 'protocol_error',
      reason: 'schedule_replay_conflict'
    });
    activeWriter.release();
    const startLease = await first;
    startLease.release();

    const commitLease = await scheduler.enqueue(createRequest('replayed-task', 'exclusive-commit', { phase: 'commit' }));
    expect(commitLease).toMatchObject({ taskId: 'replayed-task', phase: 'commit', kind: 'exclusive-commit' });
    commitLease.release();
  });

  it('fails closed instead of trimming a non-canonical resource scope', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();

    await expect(
      scheduler.enqueue(
        createRequest('invalid-scope', 'shared-read', {
          resourceScopes: [' file:/workspace/shared.md']
        })
      )
    ).rejects.toMatchObject({
      code: 'protocol_error',
      reason: 'schedule_resource_scope_invalid'
    });
    expect(scheduler.activeCount()).toBe(0);
    expect(scheduler.queuedCount()).toBe(0);
  });

  it.each<AgentResourceLeaseKind>(['shared-read', 'write-intent', 'exclusive-commit'])('propagates active deadline for %s', async (kind): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();
    const phase = kind === 'exclusive-commit' ? 'commit' : 'start';
    const lease = await scheduler.enqueue(
      createRequest(`deadline-${kind}`, kind, {
        phase,
        deadlineAt: '2026-07-27T00:00:00.050Z'
      })
    );

    await vi.advanceTimersByTimeAsync(50);
    expect(lease.signal).toMatchObject({
      aborted: true,
      reason: expect.objectContaining<Partial<AgentSchedulerError>>({
        code: 'deadline_exceeded',
        phase: 'queue'
      })
    });
    lease.release();
  });

  it.each<AgentResourceLeaseKind>(['shared-read', 'write-intent', 'exclusive-commit'])('propagates active cancellation for %s', async (kind): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();
    const phase = kind === 'exclusive-commit' ? 'commit' : 'start';
    const lease = await scheduler.enqueue(createRequest(`cancel-${kind}`, kind, { phase }));

    expect(scheduler.cancel(lease.taskId, 'user_cancelled')).toBe('active_signalled');
    expect(lease.signal.aborted).toBe(true);
    expect(lease.signal.reason).toMatchObject({ code: 'cancelled', reason: 'user_cancelled' });
    lease.release();
  });

  it.each<AgentResourceLeaseKind>(['shared-read', 'write-intent', 'exclusive-commit'])(
    'expires queued %s without granting a lease',
    async (kind): Promise<void> => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const scheduler = createAgentResourceScheduler();
      const blockers = await createBlockers(scheduler, kind);
      const phase = kind === 'exclusive-commit' ? 'commit' : 'start';
      const pending = scheduler.enqueue(
        createRequest(`queued-deadline-${kind}`, kind, {
          phase,
          deadlineAt: '2026-07-27T00:00:00.050Z'
        })
      );
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'deadline_exceeded',
        reason: 'schedule_deadline_exceeded'
      });

      await vi.advanceTimersByTimeAsync(50);
      await assertion;
      expect(scheduler.queuedCount()).toBe(0);
      releaseLeases(blockers);
    }
  );

  it.each<AgentResourceLeaseKind>(['shared-read', 'write-intent', 'exclusive-commit'])(
    'cancels queued %s without granting a lease',
    async (kind): Promise<void> => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const scheduler = createAgentResourceScheduler();
      const blockers = await createBlockers(scheduler, kind);
      const phase = kind === 'exclusive-commit' ? 'commit' : 'start';
      const taskId = `queued-cancel-${kind}`;
      const pending = scheduler.enqueue(createRequest(taskId, kind, { phase }));
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'cancelled',
        reason: 'user_cancelled'
      });

      expect(scheduler.cancel(taskId, 'user_cancelled')).toBe('queued_cancelled');
      await assertion;
      expect(scheduler.queuedCount()).toBe(0);
      releaseLeases(blockers);
    }
  );

  it('returns not_found without affecting sibling queue or leases', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();
    const active = await scheduler.enqueue(createRequest('active-sibling'));
    const queued = scheduler.enqueue(createRequest('queued-sibling', 'write-intent'));

    expect(scheduler.cancel('missing-task', 'user_cancelled')).toBe('not_found');
    expect(active.signal.aborted).toBe(false);
    expect(scheduler.activeCount()).toBe(1);
    expect(scheduler.queuedCount()).toBe(1);

    active.release();
    const queuedLease = await queued;
    queuedLease.release();
  });

  it('keeps deterministic priority, creation-time and task-id ordering', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentResourceScheduler();
    const blocker = await scheduler.enqueue(createRequest('blocker', 'exclusive-commit', { phase: 'commit' }));
    const started: string[] = [];
    const queued = [
      scheduler.enqueue(createRequest('normal-z', 'shared-read', { createdAt: '2026-07-27T00:00:02.000Z' })).then((lease): AgentResourceLease => {
        started.push(lease.taskId);
        return lease;
      }),
      scheduler
        .enqueue(createRequest('high-b', 'shared-read', { priority: 'high', createdAt: '2026-07-27T00:00:02.000Z' }))
        .then((lease): AgentResourceLease => {
          started.push(lease.taskId);
          return lease;
        }),
      scheduler.enqueue(createRequest('normal-a', 'shared-read', { createdAt: '2026-07-27T00:00:01.000Z' })).then((lease): AgentResourceLease => {
        started.push(lease.taskId);
        return lease;
      })
    ];

    blocker.release();
    const leases = await Promise.all(queued);
    expect(started).toEqual(['high-b', 'normal-a', 'normal-z']);
    releaseLeases(leases);
  });
});
