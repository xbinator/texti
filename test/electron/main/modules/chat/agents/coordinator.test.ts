/**
 * @file coordinator.test.ts
 * @description 验证 Main-owned Coordinator 的幂等授权、失败汇合与 Actor 注册顺序。
 */
import type { ChildRuntimeInput } from '../../../../../../electron/main/modules/chat/agents/executor.mjs';
import type { AgentResourceLease, AgentResourceScheduler, AgentScheduleRequest } from '../../../../../../electron/main/modules/chat/agents/scheduler.mjs';
import type {
  AgentAttemptProjection,
  BeginAgentAttemptInput,
  AgentCheckpointRecord,
  AgentDelegationRecoverySnapshot,
  AgentTaskRecord
} from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { AgentDelegationCreatedPayload, AgentTaskError, ChatAgentResult } from 'types/chat-agent';
import { describe, expect, it, vi } from 'vitest';
import { createAgentCoordinator, type AgentCoordinatorDependencies } from '../../../../../../electron/main/modules/chat/agents/coordinator.mjs';

/** 固定 Coordinator Outbox payload。 */
const payload: AgentDelegationCreatedPayload = {
  checkpointId: 'checkpoint-1',
  sessionId: 'session-1',
  turnId: 'turn-1'
};

/**
 * 创建一个 created Task。
 * @param index - Task 顺序
 * @param required - 是否为 required Task
 * @returns created Task 投影
 */
function createTask(index: number, required = true): AgentTaskRecord {
  return {
    taskId: `task-${index}`,
    sessionId: payload.sessionId,
    turnId: payload.turnId,
    agentId: `child-${index}`,
    parentAgentId: 'primary',
    rootRuntimeId: 'runtime-root',
    checkpointId: payload.checkpointId,
    toolCallId: `tool-call-${index}`,
    contractSnapshot: {
      contractSchemaVersion: 1,
      task: `Inspect resource ${index}`,
      acceptanceCriteria: ['Return a summary'],
      mode: 'read',
      resources: [{ kind: 'file', reference: `resource-${index}.md` }],
      requestedTools: ['read_file'],
      required
    },
    contractSnapshotHash: 'a'.repeat(64),
    status: 'created',
    priority: 'normal',
    recordState: 'active',
    unfinishedJournalCount: 0,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z'
  };
}

/**
 * 给已授权 Task 附加冻结只读计划。
 * @param task - created Task
 * @returns queued(start) Task
 */
function authorizeTask(task: AgentTaskRecord): AgentTaskRecord {
  const planHash = '9'.repeat(64);
  return {
    ...task,
    executionPlanSnapshot: {
      planHash,
      planSchemaVersion: 1,
      policyVersion: 'read-runtime-v1',
      capabilitySet: ['read_file'],
      modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
      permissionSnapshot: { scopeIds: ['workspace-read'] },
      resourceScopes: [`file:/workspace/resource-${task.taskId}.md`],
      toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' }],
      commitPolicy: { mode: 'none' },
      budget: { tokenLimit: 100, costLimitUsd: 0.01, pricingVersion: 'test-v1' }
    },
    executionPlanSnapshotHash: planHash,
    status: 'queued',
    queuePhase: 'start'
  };
}

/**
 * 创建 executor 返回的完整 Child 终态结果。
 * @param task - 结果所属已授权 Task
 * @param attemptId - 当前 Attempt 身份
 * @param executionStatus - 可选执行终态
 * @returns 可交给结果边界的结构化结果
 */
function createResult(task: AgentTaskRecord, attemptId: string, executionStatus: ChatAgentResult['executionStatus'] = 'completed'): ChatAgentResult {
  const completed = executionStatus === 'completed';
  return {
    taskId: task.taskId,
    agentId: task.agentId,
    attemptId,
    executionStatus,
    completion: {
      level: 'none',
      criteria: [
        {
          criterionIndex: 0,
          claim: {
            status: completed ? 'satisfied' : 'unknown',
            summary: completed ? 'Inspected the resource.' : 'Task did not finish.',
            evidence: []
          },
          verification: {
            status: 'unverified',
            verifier: 'policy',
            evidence: []
          }
        }
      ]
    },
    summary: completed ? 'Inspected the resource.' : 'Child execution stopped.',
    warnings: [],
    artifacts: [],
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      modelCalls: 1,
      toolRounds: 1,
      queueDurationMs: 0,
      executionDurationMs: 10,
      externalRequests: 0,
      monetaryCost: {
        currency: 'USD',
        pricingVersion: 'test-v1',
        estimated: 0.001,
        actual: 'unknown'
      }
    },
    ...(completed
      ? {}
      : {
          error: {
            code: executionStatus === 'deadline_exceeded' ? ('deadline_exceeded' as const) : ('cancelled' as const),
            phase: 'runtime' as const,
            category: executionStatus === 'deadline_exceeded' ? ('policy' as const) : ('user' as const),
            retryable: false,
            details: { reason: executionStatus }
          }
        })
  };
}

/**
 * 创建一个 waiting_children Checkpoint。
 * @param tasks - Checkpoint 有序 Tasks
 * @param status - 可选状态覆盖
 * @returns Checkpoint 投影
 */
function createCheckpoint(tasks: readonly AgentTaskRecord[], status: AgentCheckpointRecord['status'] = 'waiting_children'): AgentCheckpointRecord {
  return {
    checkpointId: payload.checkpointId,
    sessionId: payload.sessionId,
    turnId: payload.turnId,
    primaryAgentId: 'primary',
    rootRuntimeId: 'runtime-root',
    sourceRuntimeId: 'runtime-a',
    assistantMessageId: 'assistant-1',
    continuationSnapshot: {
      checkpointSchemaVersion: 1,
      policyVersion: 'foundation-v1',
      modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
      continuationContextReference: 'continuation-1',
      continuationContextHash: 'b'.repeat(64),
      sourceMessageRevision: 'revision-1',
      toolSchemaSnapshotHash: 'c'.repeat(64),
      orderedToolCalls: tasks.map((task): AgentCheckpointRecord['continuationSnapshot']['orderedToolCalls'][number] => ({
        taskId: task.taskId,
        toolCallId: task.toolCallId,
        required: task.contractSnapshot.required,
        argumentsHash: 'd'.repeat(64),
        providerMetadataHash: 'e'.repeat(64)
      })),
      reservedResumeBudget: { tokenLimit: 500, costLimitUsd: 0.05, pricingVersion: 'test-v1' },
      absoluteTurnDeadline: '2026-07-27T01:00:00.000Z'
    },
    continuationSnapshotHash: 'f'.repeat(64),
    status,
    version: 1,
    terminalResults: {},
    recordState: 'active',
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z'
  };
}

/**
 * 创建 Coordinator 依赖与可观察 mock。
 * @param tasks - 活动 Checkpoint Tasks
 * @returns Coordinator 依赖和关键调用 mock
 */
function createDependencies(tasks: AgentTaskRecord[]): {
  dependencies: AgentCoordinatorDependencies;
  authorizeReadTask: ReturnType<typeof vi.fn>;
  recordPreFailure: ReturnType<typeof vi.fn>;
  ensureActor: ReturnType<typeof vi.fn>;
  enqueueTask: ReturnType<typeof vi.fn>;
  cancelTask: ReturnType<typeof vi.fn>;
  reserveResume: ReturnType<typeof vi.fn>;
  beginAttempt: ReturnType<typeof vi.fn>;
  markAttemptRunning: ReturnType<typeof vi.fn>;
  executeTask: ReturnType<typeof vi.fn>;
  recordTaskResult: ReturnType<typeof vi.fn>;
  settleTask: ReturnType<typeof vi.fn>;
  releaseBudget: ReturnType<typeof vi.fn>;
  releaseTask: ReturnType<typeof vi.fn>;
  listActive: ReturnType<typeof vi.fn>;
  cancelCheckpoint: ReturnType<typeof vi.fn>;
  abortTask: ReturnType<typeof vi.fn>;
  getActor: ReturnType<typeof vi.fn>;
  bindRuntime: ReturnType<typeof vi.fn>;
  unbindRuntime: ReturnType<typeof vi.fn>;
  abortRuntime: ReturnType<typeof vi.fn>;
} {
  const checkpoint = createCheckpoint(tasks);
  const recovery: AgentDelegationRecoverySnapshot = { checkpoint, tasks, eventSequence: 2 };
  const listActive = vi.fn((): AgentDelegationRecoverySnapshot[] => [recovery]);
  const authorizeReadTask = vi.fn((taskId: string): AgentTaskRecord => {
    const task = tasks.find((entry): boolean => entry.taskId === taskId);
    if (!task) throw new Error('task_missing');
    return authorizeTask(task);
  });
  const recordPreFailure = vi.fn((): AgentCheckpointRecord => {
    return {
      ...checkpoint,
      status: recordPreFailure.mock.calls.length >= tasks.length ? 'ready_to_resume' : 'waiting_children'
    };
  });
  const ensureActor = vi.fn((task: AgentTaskRecord) => ({
    taskId: task.taskId,
    agentId: task.agentId,
    sessionId: task.sessionId,
    turnId: task.turnId,
    parentAgentId: task.parentAgentId,
    rootRuntimeId: task.rootRuntimeId,
    planHash: task.executionPlanSnapshotHash as string
  }));
  const releaseTask = vi.fn();
  const enqueueTask = vi.fn(async (request: AgentScheduleRequest): Promise<AgentResourceLease> => {
    return {
      taskId: request.taskId,
      phase: request.phase,
      kind: request.kind,
      signal: new AbortController().signal,
      release: releaseTask
    };
  });
  const cancelTask = vi.fn((): boolean => true);
  const scheduler: AgentResourceScheduler = {
    enqueue: enqueueTask,
    cancel: cancelTask,
    activeCount: (): number => 0,
    queuedCount: (): number => 0
  };
  const reserveResume = vi.fn();
  const beginAttempt = vi.fn((input: BeginAgentAttemptInput): AgentAttemptProjection => {
    const source = authorizeTask(tasks.find((task): boolean => task.taskId === input.taskId) ?? (tasks[0] as AgentTaskRecord));
    return {
      task: { ...source, status: 'starting', currentAttemptId: input.attemptId },
      attempt: {
        attemptId: input.attemptId,
        taskId: input.taskId,
        attemptNumber: 1,
        parentRuntimeId: input.parentRuntimeId,
        planHash: source.executionPlanSnapshotHash as string,
        initialRuntimeId: input.runtimeId,
        currentRuntimeId: input.runtimeId,
        runtimeSequence: 1,
        status: 'starting',
        createdAt: '2026-07-27T00:00:00.000Z'
      }
    };
  });
  const markAttemptRunning = vi.fn((): AgentAttemptProjection => {
    const projection = beginAttempt.mock.results.at(-1)?.value as AgentAttemptProjection;
    return {
      task: { ...projection.task, status: 'running' },
      attempt: { ...projection.attempt, status: 'running', startedAt: '2026-07-27T00:00:00.000Z' }
    };
  });
  const executeTask = vi.fn(async (input: ChildRuntimeInput): Promise<ChatAgentResult> => createResult(input.task, input.attempt.attemptId));
  const recordTaskResult = vi.fn((): AgentCheckpointRecord => ({ ...checkpoint, status: 'ready_to_resume', version: 2 }));
  const settleTask = vi.fn();
  const releaseBudget = vi.fn();
  const cancelCheckpoint = vi.fn((): AgentCheckpointRecord => ({ ...checkpoint, status: 'cancelled', version: 2 }));
  const abortTask = vi.fn();
  const getActor = vi.fn();
  const bindRuntime = vi.fn();
  const unbindRuntime = vi.fn();
  const abortRuntime = vi.fn();

  return {
    dependencies: {
      listActive,
      authorizeReadTask,
      recordPreFailure,
      reserveResume,
      scheduler,
      beginAttempt,
      markAttemptRunning,
      recordTaskResult,
      settleTask,
      releaseBudget,
      executor: {
        execute: executeTask,
        abort: abortRuntime
      },
      createRuntimeId: (task: AgentTaskRecord): string => `runtime-${task.taskId}`,
      cancelCheckpoint,
      now: (): string => '2026-07-27T00:00:00.000Z',
      systemChildTimeoutMs: 30 * 60 * 1_000,
      cancellationGraceMs: 100,
      registry: {
        ensureActor,
        bindRuntime,
        unbindRuntime,
        abortTask,
        getActor,
        getRuntime: vi.fn()
      }
    },
    authorizeReadTask,
    recordPreFailure,
    ensureActor,
    enqueueTask,
    cancelTask,
    reserveResume,
    beginAttempt,
    markAttemptRunning,
    executeTask,
    recordTaskResult,
    settleTask,
    releaseBudget,
    releaseTask,
    listActive,
    cancelCheckpoint,
    abortTask,
    getActor,
    bindRuntime,
    unbindRuntime,
    abortRuntime
  };
}

describe('agent coordinator', (): void => {
  it('deduplicates concurrent realtime and recovery acceptance by checkpoint ID', async (): Promise<void> => {
    const fixture = createDependencies([createTask(1)]);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await Promise.all([coordinator.accept(payload), coordinator.recover()]);

    expect(fixture.reserveResume).toHaveBeenCalledWith(payload.checkpointId, expect.objectContaining({ tokenLimit: 500 }));
    expect(fixture.authorizeReadTask).toHaveBeenCalledTimes(1);
    expect(fixture.ensureActor).toHaveBeenCalledTimes(1);
    expect(fixture.ensureActor.mock.invocationCallOrder[0]).toBeLessThan(fixture.enqueueTask.mock.invocationCallOrder[0] as number);
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('running');
  });

  it('treats a missing terminal or tombstoned Checkpoint as a no-op', async (): Promise<void> => {
    const fixture = createDependencies([createTask(1)]);
    fixture.listActive.mockReturnValue([]);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    expect(fixture.authorizeReadTask).not.toHaveBeenCalled();
    expect(fixture.enqueueTask).not.toHaveBeenCalled();
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
  });

  it('terminalizes every Task when the checkpoint exceeds the six-Task bound', async (): Promise<void> => {
    const tasks = Array.from({ length: 7 }, (_value, index): AgentTaskRecord => createTask(index + 1));
    const fixture = createDependencies(tasks);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    expect(fixture.authorizeReadTask).not.toHaveBeenCalled();
    expect(fixture.recordPreFailure).toHaveBeenCalledTimes(7);
    expect(fixture.recordPreFailure).toHaveBeenNthCalledWith(
      1,
      tasks[0],
      expect.objectContaining({
        code: 'capability_denied',
        phase: 'plan_validation',
        details: expect.objectContaining({ reason: 'checkpoint_task_limit_exceeded', limit: 6, observed: 7 })
      })
    );
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
  });

  it('turns a required authorization failure into one outcome per sibling without enqueueing', async (): Promise<void> => {
    const tasks = [createTask(1, true), createTask(2, false)];
    const fixture = createDependencies(tasks);
    const error: AgentTaskError = {
      code: 'capability_denied',
      phase: 'plan_validation',
      category: 'policy',
      retryable: false,
      details: { reason: 'plan_permission_empty' }
    };
    fixture.authorizeReadTask.mockImplementationOnce((): never => {
      throw error;
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    expect(fixture.authorizeReadTask).toHaveBeenCalledTimes(1);
    expect(fixture.recordPreFailure).toHaveBeenCalledTimes(2);
    expect(fixture.recordPreFailure).toHaveBeenNthCalledWith(1, tasks[0], error);
    expect(fixture.recordPreFailure).toHaveBeenNthCalledWith(
      2,
      tasks[1],
      expect.objectContaining({ details: expect.objectContaining({ reason: 'required_sibling_authorization_failed', taskId: tasks[0].taskId }) })
    );
    expect(fixture.enqueueTask).not.toHaveBeenCalled();
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
  });

  it('records an optional authorization failure and enqueues the authorized sibling', async (): Promise<void> => {
    const tasks = [createTask(1, false), createTask(2, true)];
    const fixture = createDependencies(tasks);
    const error: AgentTaskError = {
      code: 'resource_scope_invalid',
      phase: 'resource_validation',
      category: 'resource',
      retryable: false,
      details: { reason: 'resource_reference_missing' }
    };
    fixture.authorizeReadTask.mockImplementationOnce((): never => {
      throw error;
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    expect(fixture.recordPreFailure).toHaveBeenCalledTimes(1);
    expect(fixture.ensureActor).toHaveBeenCalledTimes(1);
    expect(fixture.enqueueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: tasks[1]?.taskId,
        priority: tasks[1]?.priority,
        phase: 'start',
        kind: 'shared-read'
      })
    );
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('running');
  });

  it('waits for a lease before creating an Attempt and passing its AbortSignal to the executor', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    const controller = new AbortController();
    const release = vi.fn();
    let grantLease: (lease: AgentResourceLease) => void = (): void => undefined;
    fixture.enqueueTask.mockImplementationOnce(
      (): Promise<AgentResourceLease> =>
        new Promise<AgentResourceLease>((resolve): void => {
          grantLease = resolve;
        })
    );
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    expect(fixture.beginAttempt).not.toHaveBeenCalled();
    expect(fixture.executeTask).not.toHaveBeenCalled();
    grantLease({ taskId: task.taskId, phase: 'start', kind: 'shared-read', signal: controller.signal, release });
    await vi.waitFor((): void => {
      expect(fixture.beginAttempt).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.taskId,
          parentRuntimeId: 'runtime-a',
          runtimeId: `runtime-${task.taskId}`
        })
      );
      expect(fixture.executeTask).toHaveBeenCalledWith(
        expect.objectContaining({
          task: expect.objectContaining({ taskId: task.taskId, status: 'running' }),
          attempt: expect.objectContaining({ status: 'running' }),
          signal: controller.signal
        })
      );
      expect(fixture.beginAttempt.mock.invocationCallOrder[0]).toBeLessThan(fixture.bindRuntime.mock.invocationCallOrder[0] as number);
      expect(fixture.bindRuntime.mock.invocationCallOrder[0]).toBeLessThan(fixture.markAttemptRunning.mock.invocationCallOrder[0] as number);
      expect(fixture.markAttemptRunning.mock.invocationCallOrder[0]).toBeLessThan(fixture.executeTask.mock.invocationCallOrder[0] as number);
      expect(fixture.executeTask.mock.invocationCallOrder[0]).toBeLessThan(fixture.recordTaskResult.mock.invocationCallOrder[0] as number);
      expect(fixture.recordTaskResult.mock.invocationCallOrder[0]).toBeLessThan(fixture.settleTask.mock.invocationCallOrder[0] as number);
      expect(fixture.settleTask.mock.invocationCallOrder[0]).toBeLessThan(fixture.unbindRuntime.mock.invocationCallOrder[0] as number);
      expect(release).toHaveBeenCalledTimes(1);
    });
  });

  it('turns an executor rejection into one failed result and releases every execution resource', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    fixture.executeTask.mockRejectedValueOnce(new Error('child_executor_rejected'));
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    await vi.waitFor((): void => {
      expect(fixture.recordTaskResult).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: task.taskId }),
        expect.objectContaining({
          taskId: task.taskId,
          executionStatus: 'failed',
          error: expect.objectContaining({ code: 'runtime_failed' })
        })
      );
      expect(fixture.settleTask).toHaveBeenCalledWith(task.taskId, expect.objectContaining({ totalTokens: 0 }));
      expect(fixture.unbindRuntime).toHaveBeenCalledWith(`runtime-${task.taskId}`);
      expect(fixture.releaseTask).toHaveBeenCalledTimes(1);
      expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
    });
  });

  it('keeps a persisted terminal checkpoint terminal when budget settlement needs recovery', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    fixture.settleTask.mockImplementationOnce((): never => {
      throw new Error('budget_settlement_recovery_required');
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    await vi.waitFor((): void => {
      expect(fixture.recordTaskResult).toHaveBeenCalledOnce();
      expect(fixture.settleTask).toHaveBeenCalledOnce();
      expect(fixture.unbindRuntime).toHaveBeenCalledOnce();
      expect(fixture.releaseTask).toHaveBeenCalledOnce();
      expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
    });
  });

  it('uses the minimum Task, Turn, and system Child deadline', async (): Promise<void> => {
    const task = {
      ...createTask(1),
      deadlineAt: '2026-07-27T00:40:00.000Z'
    };
    const fixture = createDependencies([task]);
    fixture.dependencies.systemChildTimeoutMs = 10 * 60 * 1_000;
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    expect(fixture.enqueueTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: task.taskId,
        deadlineAt: '2026-07-27T00:10:00.000Z'
      })
    );
  });

  it('terminalizes a queued Task when its scheduling deadline expires before an Attempt exists', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    fixture.enqueueTask.mockRejectedValueOnce({
      code: 'deadline_exceeded',
      reason: 'schedule_deadline_exceeded'
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    await vi.waitFor((): void => {
      expect(fixture.cancelCheckpoint).toHaveBeenCalledWith(payload.checkpointId, 'schedule_deadline_exceeded');
      expect(fixture.releaseBudget).toHaveBeenCalledWith(task.taskId);
      expect(fixture.beginAttempt).not.toHaveBeenCalled();
      expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
    });
  });

  it('terminalizes a Task when creating its first Attempt is rejected', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    fixture.beginAttempt.mockImplementationOnce((): never => {
      throw new Error('attempt_start_rejected');
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    await vi.waitFor((): void => {
      expect(fixture.cancelCheckpoint).toHaveBeenCalledWith(payload.checkpointId, 'attempt_start_rejected');
      expect(fixture.releaseBudget).toHaveBeenCalledWith(task.taskId);
      expect(fixture.executeTask).not.toHaveBeenCalled();
      expect(fixture.releaseTask).toHaveBeenCalledOnce();
      expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
    });
  });

  it('persists cancellation before cooperatively aborting a queued Child without creating an Attempt', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    let rejectLease: (error: unknown) => void = (): void => undefined;
    fixture.enqueueTask.mockImplementationOnce(
      (): Promise<AgentResourceLease> =>
        new Promise<AgentResourceLease>((_resolve, reject): void => {
          rejectLease = reject;
        })
    );
    fixture.cancelTask.mockImplementationOnce((_taskId: string, reason: string): boolean => {
      rejectLease({ code: 'cancelled', reason });
      return true;
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);

    await coordinator.cancel(payload.checkpointId, 'user_cancelled');

    expect(fixture.cancelCheckpoint).toHaveBeenCalledWith(payload.checkpointId, 'user_cancelled');
    expect(fixture.cancelCheckpoint).toHaveBeenCalledOnce();
    expect(fixture.cancelTask).toHaveBeenCalledWith(task.taskId, 'user_cancelled');
    expect(fixture.cancelCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(fixture.cancelTask.mock.invocationCallOrder[0] as number);
    expect(fixture.beginAttempt).not.toHaveBeenCalled();
    expect(fixture.executeTask).not.toHaveBeenCalled();
    expect(fixture.releaseBudget).toHaveBeenCalledOnce();
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
  });

  it('persists running cancellation before the signal and hard-aborts only after the grace period', async (): Promise<void> => {
    vi.useFakeTimers();
    const task = createTask(1);
    const fixture = createDependencies([task]);
    const controller = new AbortController();
    const release = vi.fn();
    fixture.enqueueTask.mockResolvedValueOnce({
      taskId: task.taskId,
      phase: 'start',
      kind: 'shared-read',
      signal: controller.signal,
      release
    });
    fixture.cancelTask.mockImplementationOnce((): boolean => {
      controller.abort('user_cancelled');
      return true;
    });
    let finishExecution: (result: ChatAgentResult) => void = (): void => undefined;
    fixture.executeTask.mockImplementationOnce(
      (input: ChildRuntimeInput): Promise<ChatAgentResult> =>
        new Promise<ChatAgentResult>((resolve): void => {
          finishExecution = resolve;
          input.signal.addEventListener(
            'abort',
            (): void => {
              // 保持 Promise 未结束，用于验证宽限期后才调用 executor.abort。
            },
            { once: true }
          );
        })
    );
    fixture.getActor.mockReturnValue({ taskId: task.taskId });
    fixture.cancelCheckpoint
      .mockReturnValueOnce({ ...createCheckpoint([task]), status: 'cancelling', version: 2 })
      .mockReturnValueOnce({ ...createCheckpoint([task]), status: 'cancelled', version: 4 });
    fixture.recordTaskResult.mockReturnValue({ ...createCheckpoint([task]), status: 'cancelling', version: 3 });
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);
    await vi.waitFor((): void => {
      expect(fixture.executeTask).toHaveBeenCalledOnce();
    });

    const cancellation = coordinator.cancel(payload.checkpointId, 'user_cancelled');

    expect(fixture.cancelCheckpoint).toHaveBeenCalledWith(payload.checkpointId, 'user_cancelled');
    expect(fixture.cancelCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(fixture.cancelTask.mock.invocationCallOrder[0] as number);
    expect(controller.signal.aborted).toBe(true);
    expect(fixture.abortRuntime).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(99);
    expect(fixture.abortRuntime).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.abortRuntime).toHaveBeenCalledWith(`runtime-${task.taskId}`, 'user_cancelled');

    const runningTask = authorizeTask(task);
    finishExecution(createResult(runningTask, `attempt-${task.taskId}`, 'cancelled'));
    await cancellation;
    await vi.runAllTimersAsync();

    expect(fixture.recordTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.taskId }),
      expect.objectContaining({ executionStatus: 'cancelled' })
    );
    expect(fixture.settleTask).toHaveBeenCalledWith(task.taskId, expect.objectContaining({ totalTokens: 15 }));
    expect(fixture.cancelCheckpoint).toHaveBeenCalledTimes(2);
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
    expect(release).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it('bounds Primary cancellation waiting when a hard-aborted executor does not settle', async (): Promise<void> => {
    vi.useFakeTimers();
    const task = createTask(1);
    const fixture = createDependencies([task]);
    const controller = new AbortController();
    fixture.enqueueTask.mockResolvedValueOnce({
      taskId: task.taskId,
      phase: 'start',
      kind: 'shared-read',
      signal: controller.signal,
      release: vi.fn()
    });
    fixture.cancelTask.mockImplementationOnce((): boolean => {
      controller.abort('user_cancelled');
      return true;
    });
    fixture.executeTask.mockImplementationOnce(
      (): Promise<ChatAgentResult> =>
        new Promise<ChatAgentResult>(() => {
          // 故意保持 pending，以验证 Primary cancel 的等待上界。
        })
    );
    fixture.getActor.mockReturnValue({ taskId: task.taskId });
    fixture.cancelCheckpoint.mockReturnValue({ ...createCheckpoint([task]), status: 'cancelling', version: 2 });
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);
    await vi.waitFor((): void => {
      expect(fixture.executeTask).toHaveBeenCalledOnce();
    });

    const cancellation = coordinator.cancel(payload.checkpointId, 'user_cancelled');
    await vi.advanceTimersByTimeAsync(200);
    await cancellation;

    expect(fixture.abortRuntime).toHaveBeenCalledWith(`runtime-${task.taskId}`, 'user_cancelled');
    expect(fixture.cancelCheckpoint).toHaveBeenCalledTimes(2);
    expect(fixture.recordTaskResult).not.toHaveBeenCalled();
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('running');
    vi.useRealTimers();
  });
});
