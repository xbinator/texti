/**
 * @file scheduler.test.ts
 * @description 验证只读 Child Task 的并行上限、确定性排队、截止时间和取消语义。
 */
import type { AgentTaskPriority } from 'types/chat-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AgentSchedulerError,
  createAgentReadScheduler,
  type AgentReadLease,
  type AgentScheduleRequest
} from '../../../../../../electron/main/modules/chat/agents/scheduler.mjs';

/** 测试时固定的调度器当前时间。 */
const NOW = '2026-07-27T00:00:00.000Z';

/**
 * 创建规范的只读调度请求。
 * @param taskId - Task 身份
 * @param options - 排序和截止时间覆盖
 * @returns 可入队的只读请求
 */
function createReadRequest(
  taskId: string,
  options: {
    priority?: AgentTaskPriority;
    createdAt?: string;
    deadlineAt?: string;
    resourceScopes?: readonly string[];
  } = {}
): AgentScheduleRequest {
  return {
    taskId,
    priority: options.priority ?? 'normal',
    createdAt: options.createdAt ?? '2026-07-27T00:00:00.000Z',
    deadlineAt: options.deadlineAt ?? '2026-07-27T01:00:00.000Z',
    resourceScopes: options.resourceScopes ?? [`file:/workspace/${taskId}.md`],
    mode: 'read'
  };
}

/**
 * 释放所有已取得的测试 lease。
 * @param leases - 待释放 lease
 */
function releaseLeases(leases: readonly AgentReadLease[]): void {
  leases.forEach((lease): void => {
    lease.release();
  });
}

afterEach((): void => {
  vi.useRealTimers();
});

describe('agent read scheduler', (): void => {
  it('grants three shared read leases and queues a fourth even when scopes overlap', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentReadScheduler();
    const leases = await Promise.all([
      scheduler.enqueue(createReadRequest('task-1', { resourceScopes: [' file:/workspace/shared.md '] })),
      scheduler.enqueue(createReadRequest('task-2', { resourceScopes: ['file:/workspace/shared.md'] })),
      scheduler.enqueue(createReadRequest('task-3', { resourceScopes: ['file:/workspace/shared.md'] }))
    ]);
    const fourthLease = scheduler.enqueue(createReadRequest('task-4'));

    expect(scheduler.activeCount()).toBe(3);
    expect(scheduler.queuedCount()).toBe(1);

    leases[1]?.release();
    const fourth = await fourthLease;

    expect(fourth.taskId).toBe('task-4');
    expect(scheduler.activeCount()).toBe(3);
    expect(scheduler.queuedCount()).toBe(0);
    releaseLeases([...leases, fourth]);
  });

  it('schedules queued tasks by priority, creation time and task ID without using deadline as a sort key', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentReadScheduler();
    const active = await Promise.all([
      scheduler.enqueue(createReadRequest('active-1')),
      scheduler.enqueue(createReadRequest('active-2')),
      scheduler.enqueue(createReadRequest('active-3'))
    ]);
    const started: string[] = [];
    const queued = [
      scheduler
        .enqueue(
          createReadRequest('task-z', {
            createdAt: '2026-07-27T00:00:01.000Z',
            deadlineAt: '2026-07-27T00:05:00.000Z'
          })
        )
        .then((lease): AgentReadLease => {
          started.push(lease.taskId);
          return lease;
        }),
      scheduler
        .enqueue(
          createReadRequest('task-b', {
            createdAt: '2026-07-27T00:00:02.000Z',
            deadlineAt: '2026-07-27T00:01:00.000Z',
            priority: 'high'
          })
        )
        .then((lease): AgentReadLease => {
          started.push(lease.taskId);
          return lease;
        }),
      scheduler
        .enqueue(
          createReadRequest('task-a', {
            createdAt: '2026-07-27T00:00:01.000Z',
            deadlineAt: '2026-07-27T00:30:00.000Z'
          })
        )
        .then((lease): AgentReadLease => {
          started.push(lease.taskId);
          return lease;
        })
    ];

    active[2]?.release();
    const high = await queued[1];
    high?.release();
    const firstNormal = await queued[2];
    firstNormal?.release();
    const secondNormal = await queued[0];

    expect(started).toEqual(['task-b', 'task-a', 'task-z']);
    releaseLeases([...active, secondNormal as AgentReadLease]);
  });

  it('returns the same pending lease promise for a duplicate enqueue', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentReadScheduler();
    const active = await Promise.all([
      scheduler.enqueue(createReadRequest('active-1')),
      scheduler.enqueue(createReadRequest('active-2')),
      scheduler.enqueue(createReadRequest('active-3'))
    ]);
    const request = createReadRequest('queued-task');
    const first = scheduler.enqueue(request);
    const replay = scheduler.enqueue({
      ...request,
      resourceScopes: [...request.resourceScopes].reverse()
    });

    expect(replay).toBe(first);
    expect(scheduler.queuedCount()).toBe(1);

    active[0]?.release();
    const lease = await first;
    releaseLeases([...active, lease]);
  });

  it('expires a queued task without ever granting a lease', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentReadScheduler();
    const active = await Promise.all([
      scheduler.enqueue(createReadRequest('active-1')),
      scheduler.enqueue(createReadRequest('active-2')),
      scheduler.enqueue(createReadRequest('active-3'))
    ]);
    const expired = scheduler.enqueue(
      createReadRequest('expiring-task', {
        deadlineAt: '2026-07-27T00:00:00.050Z'
      })
    );
    const expiredAssertion = expect(expired).rejects.toMatchObject({
      code: 'deadline_exceeded',
      phase: 'queue'
    });

    await vi.advanceTimersByTimeAsync(50);

    await expiredAssertion;
    expect(scheduler.activeCount()).toBe(3);
    expect(scheduler.queuedCount()).toBe(0);
    releaseLeases(active);
  });

  it('cancels a queued task and never starts it after capacity is released', async (): Promise<void> => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const scheduler = createAgentReadScheduler();
    const active = await Promise.all([
      scheduler.enqueue(createReadRequest('active-1')),
      scheduler.enqueue(createReadRequest('active-2')),
      scheduler.enqueue(createReadRequest('active-3'))
    ]);
    const cancelled = scheduler.enqueue(createReadRequest('cancelled-task'));
    const cancelledAssertion = expect(cancelled).rejects.toEqual(
      expect.objectContaining<Partial<AgentSchedulerError>>({
        code: 'cancelled',
        phase: 'queue'
      })
    );

    expect(scheduler.cancel('cancelled-task', 'user_cancelled')).toBe(true);
    await cancelledAssertion;

    active[0]?.release();
    expect(scheduler.activeCount()).toBe(2);
    expect(scheduler.queuedCount()).toBe(0);
    expect(scheduler.cancel('cancelled-task', 'duplicate_cancel')).toBe(false);
    releaseLeases(active);
  });
});
