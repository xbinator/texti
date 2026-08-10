/**
 * @file coordinator.test.ts
 * @description 验证 Main-owned Coordinator 的幂等授权、失败汇合与 Actor 注册顺序。
 */
import type { ChildExecutionOutcome, ChildRuntimeInput } from '../../../../../../electron/main/modules/chat/agents/executor.mjs';
import type { AgentFileCommitResult } from '../../../../../../electron/main/modules/chat/agents/file-commit.mjs';
import type { AgentResourceLease, AgentResourceScheduler, AgentScheduleRequest } from '../../../../../../electron/main/modules/chat/agents/scheduler.mjs';
import type {
  AgentAttemptRecord,
  AgentAttemptProjection,
  BeginAgentAttemptInput,
  AgentCheckpointRecord,
  AgentDelegationRecoverySnapshot,
  RecordAttemptUsageInput,
  AgentTaskRecord
} from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type {
  AgentChangesetRecord,
  AgentCommitJournalRecord,
  AgentConfirmationRecord,
  AgentDelegationCreatedPayload,
  AgentTaskError,
  AgentUsageAccounting,
  AgentWriteResultDraft,
  ChatAgentResult
} from 'types/chat-agent';
import { describe, expect, it, vi } from 'vitest';
import {
  COORDINATOR_TERMINAL_STATE_LIMIT,
  createAgentCoordinator,
  type AgentCoordinatorDependencies
} from '../../../../../../electron/main/modules/chat/agents/coordinator.mjs';

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
 * 创建受控写入 Task。
 * @returns created write Task
 */
function createWriteTask(): AgentTaskRecord {
  const task = createTask(1);
  return {
    ...task,
    contractSnapshot: {
      ...task.contractSnapshot,
      task: 'Update the bounded resource',
      mode: 'write',
      requestedTools: ['read_file', 'stage_file_edit']
    }
  };
}

/**
 * 给 write Task 附加 staged execution plan。
 * @param task - created write Task
 * @returns queued(start) write Task
 */
function authorizeWriteTask(task: AgentTaskRecord): AgentTaskRecord {
  const planHash = '8'.repeat(64);
  return {
    ...task,
    executionPlanSnapshot: {
      planHash,
      planSchemaVersion: 1,
      policyVersion: 'controlled-write-v1',
      capabilitySet: ['read_file', 'stage_file_edit'],
      modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
      permissionSnapshot: { scopeIds: ['workspace-write'] },
      resourceScopes: ['file:/workspace/resource-1.md'],
      toolEffectSet: [
        { toolName: 'read_file', effect: 'pure_read' },
        { toolName: 'stage_file_edit', effect: 'staged_file_write' }
      ],
      commitPolicy: { mode: 'staged', adapter: 'atomic-file-v1' },
      budget: { tokenLimit: 100, costLimitUsd: 0.01, pricingVersion: 'test-v1' }
    },
    executionPlanSnapshotHash: planHash,
    status: 'queued',
    queuePhase: 'start'
  };
}

/**
 * 创建 Coordinator write lifecycle 使用的 changeset。
 * @param task - running write Task
 * @param attemptId - 当前 Attempt
 * @param runtimeId - changeset Runtime
 * @returns prepared changeset record
 */
function createChangeset(task: AgentTaskRecord, attemptId: string, runtimeId: string): AgentChangesetRecord {
  const snapshot = {
    changesetSchemaVersion: 1,
    changesetId: 'changeset-1',
    taskId: task.taskId,
    attemptId,
    agentId: task.agentId,
    runtimeId,
    planHash: task.executionPlanSnapshotHash as string,
    baseRevision: '1'.repeat(64),
    diffReference: '/private/changeset.diff',
    diffHash: '2'.repeat(64),
    operationSetHash: '3'.repeat(64),
    resourceScopes: ['file:/workspace/resource-1.md'],
    operations: [
      {
        operationId: 'operation-1',
        kind: 'replace' as const,
        displayPath: 'resource-1.md',
        targetPath: '/workspace/resource-1.md',
        resourceScope: 'file:/workspace/resource-1.md',
        baseRevision: '4'.repeat(64),
        baseContentHash: '5'.repeat(64),
        targetContentHash: '6'.repeat(64),
        candidateReference: '/private/candidate.txt',
        rollbackReference: '/private/rollback.txt',
        byteLength: 12
      }
    ],
    createdAt: '2026-07-27T00:00:00.000Z'
  };
  return {
    snapshot,
    snapshotHash: '7'.repeat(64),
    status: 'prepared',
    recordState: 'active',
    updatedAt: snapshot.createdAt
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
 * 创建 Attempt 尚未调用 Provider 时的零 usage。
 * @param task - 用于取得冻结定价身份的 Task
 * @returns 与测试计划定价一致的零累计快照
 */
function createAttemptUsage(task: AgentTaskRecord): AgentUsageAccounting {
  const { monetaryCost } = createResult(task, 'attempt-usage-fixture').usage;
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    modelCalls: 0,
    toolRounds: 0,
    queueDurationMs: 0,
    executionDurationMs: 0,
    externalRequests: 0,
    monetaryCost: {
      ...monetaryCost,
      estimated: monetaryCost.estimated === 'unknown' ? 'unknown' : 0
    }
  };
}

/**
 * 创建 write result draft。
 * @param task - running write Task
 * @param attemptId - 当前 Attempt
 * @returns commit draft
 */
function createWriteDraft(task: AgentTaskRecord, attemptId: string): AgentWriteResultDraft {
  const result = createResult(task, attemptId);
  return {
    taskId: task.taskId,
    agentId: task.agentId,
    attemptId,
    summary: result.summary,
    criteria: result.completion.criteria,
    warnings: [],
    usage: result.usage
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
  authorizeTask: ReturnType<typeof vi.fn>;
  recordPreFailure: ReturnType<typeof vi.fn>;
  ensureActor: ReturnType<typeof vi.fn>;
  enqueueTask: ReturnType<typeof vi.fn>;
  cancelTask: ReturnType<typeof vi.fn>;
  requestTaskCancellation: ReturnType<typeof vi.fn>;
  recordPreCancellation: ReturnType<typeof vi.fn>;
  reserveResume: ReturnType<typeof vi.fn>;
  beginAttempt: ReturnType<typeof vi.fn>;
  markAttemptRunning: ReturnType<typeof vi.fn>;
  executeTask: ReturnType<typeof vi.fn>;
  recordAttemptUsage: ReturnType<typeof vi.fn>;
  recordTaskResult: ReturnType<typeof vi.fn>;
  settleTask: ReturnType<typeof vi.fn>;
  releaseBudget: ReturnType<typeof vi.fn>;
  releaseTask: ReturnType<typeof vi.fn>;
  releaseActor: ReturnType<typeof vi.fn>;
  getTask: ReturnType<typeof vi.fn>;
  getAttempt: ReturnType<typeof vi.fn>;
  listActive: ReturnType<typeof vi.fn>;
  cancelCheckpoint: ReturnType<typeof vi.fn>;
  abortTask: ReturnType<typeof vi.fn>;
  getActor: ReturnType<typeof vi.fn>;
  bindRuntime: ReturnType<typeof vi.fn>;
  unbindRuntime: ReturnType<typeof vi.fn>;
  abortRuntime: ReturnType<typeof vi.fn>;
  discardRuntime: ReturnType<typeof vi.fn>;
} {
  const checkpoint = createCheckpoint(tasks);
  const recovery: AgentDelegationRecoverySnapshot = { checkpoint, tasks, eventSequence: 2 };
  const currentTasks = new Map(tasks.map((task): [string, AgentTaskRecord] => [task.taskId, task]));
  const listActive = vi.fn((): AgentDelegationRecoverySnapshot[] => [recovery]);
  const authorizeTaskMock = vi.fn((taskId: string): AgentTaskRecord => {
    const task = currentTasks.get(taskId);
    if (!task) throw new Error('task_missing');
    const authorized = authorizeTask(task);
    currentTasks.set(taskId, authorized);
    return authorized;
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
  const cancelTask = vi.fn(() => 'active_signalled' as const);
  const scheduler: AgentResourceScheduler = {
    enqueue: enqueueTask,
    cancel: cancelTask,
    activeCount: (): number => 0,
    queuedCount: (): number => 0
  };
  const reserveResume = vi.fn();
  const beginAttempt = vi.fn((input: BeginAgentAttemptInput): AgentAttemptProjection => {
    const latestAuthorization = authorizeTaskMock.mock.results.at(-1)?.value as AgentTaskRecord | undefined;
    const source =
      latestAuthorization?.taskId === input.taskId ? latestAuthorization : currentTasks.get(input.taskId) ?? authorizeTask(tasks[0] as AgentTaskRecord);
    const startingTask = { ...source, status: 'starting' as const, queuePhase: undefined, currentAttemptId: input.attemptId };
    currentTasks.set(input.taskId, startingTask);
    return {
      task: startingTask,
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
        usageSnapshot: createAttemptUsage(source),
        usageComplete: true,
        usageUpdatedAt: '2026-07-27T00:00:00.000Z',
        createdAt: '2026-07-27T00:00:00.000Z'
      }
    };
  });
  const markAttemptRunning = vi.fn((): AgentAttemptProjection => {
    const projection = beginAttempt.mock.results.at(-1)?.value as AgentAttemptProjection;
    const runningProjection = {
      task: { ...projection.task, status: 'running' },
      attempt: {
        ...projection.attempt,
        status: 'running',
        usageComplete: false,
        startedAt: '2026-07-27T00:00:00.000Z'
      }
    } as AgentAttemptProjection;
    currentTasks.set(runningProjection.task.taskId, runningProjection.task);
    return runningProjection;
  });
  const getAttempt = vi.fn((attemptId: string): AgentAttemptRecord | null => {
    const running = markAttemptRunning.mock.results.at(-1)?.value as AgentAttemptProjection | undefined;
    if (running?.attempt.attemptId === attemptId) return running.attempt;
    const starting = beginAttempt.mock.results.at(-1)?.value as AgentAttemptProjection | undefined;
    return starting?.attempt.attemptId === attemptId ? starting.attempt : null;
  });
  const executeTask = vi.fn(
    async (input: ChildRuntimeInput): Promise<ChildExecutionOutcome> => ({
      kind: 'terminal',
      result: createResult(input.task, input.attempt.attemptId)
    })
  );
  const recordAttemptUsage = vi.fn((input: RecordAttemptUsageInput): AgentAttemptRecord => {
    const projection = markAttemptRunning.mock.results.at(-1)?.value as AgentAttemptProjection;
    return {
      ...projection.attempt,
      usageSnapshot: input.usage,
      usageComplete: input.complete,
      usageUpdatedAt: input.occurredAt
    };
  });
  const recordTaskResult = vi.fn((task: AgentTaskRecord, result: ChatAgentResult): AgentCheckpointRecord => {
    currentTasks.set(task.taskId, { ...task, status: result.executionStatus, queuePhase: undefined, result });
    return { ...checkpoint, status: 'ready_to_resume', version: 2 };
  });
  const settleTask = vi.fn();
  const releaseBudget = vi.fn();
  const cancelCheckpoint = vi.fn((): AgentCheckpointRecord => ({ ...checkpoint, status: 'cancelled', version: 2 }));
  const getTask = vi.fn((taskId: string): AgentTaskRecord | null => {
    return currentTasks.get(taskId) ?? null;
  });
  const requestTaskCancellation = vi.fn((taskId: string) => {
    const task = currentTasks.get(taskId) ?? (tasks[0] as AgentTaskRecord);
    if (['completed', 'failed', 'cancelled', 'deadline_exceeded', 'commit_failed'].includes(task.status)) {
      return { previousStatus: task.status, task, disposition: 'already_settled' as const };
    }
    const cancelling = { ...task, status: 'cancelling' as const, queuePhase: undefined, cancelRequestedAt: '2026-07-27T00:00:00.000Z' };
    currentTasks.set(taskId, cancelling);
    return {
      previousStatus: task.status,
      task: cancelling,
      disposition: task.status === 'committing' ? ('commit_in_progress' as const) : ('cancel_requested' as const)
    };
  });
  const recordPreCancellation = vi.fn((task: AgentTaskRecord): AgentCheckpointRecord => {
    currentTasks.set(task.taskId, { ...task, status: 'cancelled', queuePhase: undefined, cancelRequestedAt: '2026-07-27T00:00:00.000Z' });
    return { ...checkpoint, status: 'cancelled', version: 2 };
  });
  const abortTask = vi.fn();
  const getActor = vi.fn();
  const bindRuntime = vi.fn();
  const unbindRuntime = vi.fn();
  const abortRuntime = vi.fn();
  const discardRuntime = vi.fn(async (): Promise<void> => undefined);
  const releaseActor = vi.fn();

  return {
    dependencies: {
      listActive,
      authorizeTask: authorizeTaskMock,
      recordPreFailure,
      reserveResume,
      scheduler,
      beginAttempt,
      markAttemptRunning,
      getAttempt,
      recordAttemptUsage,
      recordTaskResult,
      settleTask,
      releaseBudget,
      requestTaskCancellation,
      recordPreCancellation,
      getTask,
      executor: {
        execute: executeTask,
        abort: abortRuntime,
        discard: discardRuntime
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
        releaseTask: releaseActor,
        getActor,
        getRuntime: vi.fn()
      }
    },
    authorizeTask: authorizeTaskMock,
    recordPreFailure,
    ensureActor,
    enqueueTask,
    cancelTask,
    requestTaskCancellation,
    recordPreCancellation,
    reserveResume,
    beginAttempt,
    markAttemptRunning,
    executeTask,
    recordAttemptUsage,
    recordTaskResult,
    settleTask,
    releaseBudget,
    releaseTask,
    releaseActor,
    getTask,
    getAttempt,
    listActive,
    cancelCheckpoint,
    abortTask,
    getActor,
    bindRuntime,
    unbindRuntime,
    abortRuntime,
    discardRuntime
  };
}

describe('agent coordinator', (): void => {
  it('bounds retained terminal Checkpoint states while preserving recent entries', async (): Promise<void> => {
    const fixture = createDependencies([]);
    fixture.listActive.mockReturnValue([]);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    for (let index = 0; index <= COORDINATOR_TERMINAL_STATE_LIMIT; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- 每轮需先到达 terminal 状态才能确定验证 LRU 次序。
      await coordinator.accept({
        checkpointId: `checkpoint-${index}`,
        sessionId: 'session-bounded',
        turnId: `turn-${index}`
      });
    }

    expect(coordinator.getCheckpointState('checkpoint-0')).toBe('idle');
    expect(coordinator.getCheckpointState(`checkpoint-${COORDINATOR_TERMINAL_STATE_LIMIT}`)).toBe('terminal');
  });

  it('reuses one cancelTask flight and terminalizes queued start without creating Runtime', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    let rejectLease: (error: unknown) => void = (): void => undefined;
    fixture.enqueueTask.mockImplementationOnce(
      (): Promise<AgentResourceLease> =>
        new Promise<AgentResourceLease>((_resolve, reject): void => {
          rejectLease = reject;
        })
    );
    fixture.cancelTask.mockImplementationOnce((_taskId: string, reason: string) => {
      rejectLease({ code: 'cancelled', reason });
      return 'queued_cancelled';
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);

    const first = coordinator.cancelTask(task.taskId);
    const replay = coordinator.cancelTask(task.taskId);

    expect(replay).toBe(first);
    await expect(first).resolves.toBe('cancel_requested');
    expect(fixture.cancelTask).toHaveBeenCalledOnce();
    expect(fixture.cancelTask).toHaveBeenCalledWith(task.taskId, 'user_cancelled');
    expect(fixture.recordPreCancellation).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.taskId }), 'single_task');
    expect(fixture.cancelTask.mock.invocationCallOrder[0]).toBeLessThan(fixture.recordPreCancellation.mock.invocationCallOrder[0] as number);
    expect(fixture.beginAttempt).not.toHaveBeenCalled();
    expect(fixture.bindRuntime).not.toHaveBeenCalled();
    expect(fixture.executeTask).not.toHaveBeenCalled();
    expect(fixture.releaseBudget).toHaveBeenCalledWith(task.taskId);
    expect(fixture.cancelCheckpoint).not.toHaveBeenCalled();
  });

  it('lets cancellation win after the start lease is active but before beginAttempt', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    const controller = new AbortController();
    const release = vi.fn();
    let resolveLease: (lease: AgentResourceLease) => void = (): void => undefined;
    fixture.enqueueTask.mockImplementationOnce(
      (): Promise<AgentResourceLease> =>
        new Promise<AgentResourceLease>((resolve): void => {
          resolveLease = resolve;
        })
    );
    fixture.cancelTask.mockImplementationOnce((_taskId: string, reason: string) => {
      controller.abort(reason);
      return 'active_signalled';
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);
    await vi.waitFor((): void => {
      expect(fixture.enqueueTask).toHaveBeenCalledOnce();
    });

    resolveLease({
      taskId: task.taskId,
      phase: 'start',
      kind: 'shared-read',
      signal: controller.signal,
      release
    });
    const cancellation = coordinator.cancelTask(task.taskId);

    await expect(cancellation).resolves.toBe('cancel_requested');
    expect(fixture.recordPreCancellation).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.taskId }), 'single_task');
    expect(fixture.beginAttempt).not.toHaveBeenCalled();
    expect(fixture.executeTask).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it('deduplicates concurrent realtime and recovery acceptance by checkpoint ID', async (): Promise<void> => {
    const fixture = createDependencies([createTask(1)]);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await Promise.all([coordinator.accept(payload), coordinator.recover()]);

    expect(fixture.reserveResume).toHaveBeenCalledWith(payload.checkpointId, expect.objectContaining({ tokenLimit: 500 }));
    expect(fixture.authorizeTask).toHaveBeenCalledTimes(1);
    expect(fixture.ensureActor).toHaveBeenCalledTimes(1);
    expect(fixture.ensureActor.mock.invocationCallOrder[0]).toBeLessThan(fixture.enqueueTask.mock.invocationCallOrder[0] as number);
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('running');
  });

  it('treats a missing terminal or tombstoned Checkpoint as a no-op', async (): Promise<void> => {
    const fixture = createDependencies([createTask(1)]);
    fixture.listActive.mockReturnValue([]);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    expect(fixture.authorizeTask).not.toHaveBeenCalled();
    expect(fixture.enqueueTask).not.toHaveBeenCalled();
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
  });

  it('terminalizes every Task when the checkpoint exceeds the six-Task bound', async (): Promise<void> => {
    const tasks = Array.from({ length: 7 }, (_value, index): AgentTaskRecord => createTask(index + 1));
    const fixture = createDependencies(tasks);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    expect(fixture.authorizeTask).not.toHaveBeenCalled();
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
    fixture.authorizeTask.mockImplementationOnce((): never => {
      throw error;
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    expect(fixture.authorizeTask).toHaveBeenCalledTimes(1);
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
    fixture.authorizeTask.mockImplementationOnce((): never => {
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
      expect(fixture.recordAttemptUsage).toHaveBeenCalledWith({
        taskId: task.taskId,
        attemptId: `attempt-runtime-${task.taskId}`,
        usage: expect.objectContaining({ totalTokens: 15 }),
        complete: true,
        occurredAt: '2026-07-27T00:00:00.000Z'
      });
      expect(fixture.executeTask.mock.invocationCallOrder[0]).toBeLessThan(fixture.recordAttemptUsage.mock.invocationCallOrder[0] as number);
      expect(fixture.recordAttemptUsage.mock.invocationCallOrder[0]).toBeLessThan(fixture.recordTaskResult.mock.invocationCallOrder[0] as number);
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

  it('uses persisted Attempt usage when an injected executor rejects after a usage boundary', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    const partialUsage: AgentUsageAccounting = {
      ...createAttemptUsage(task),
      inputTokens: 9,
      outputTokens: 3,
      totalTokens: 12,
      modelCalls: 1,
      monetaryCost: {
        ...createAttemptUsage(task).monetaryCost,
        estimated: 0.001
      }
    };
    let persistedAttempt: AgentAttemptRecord | null = null;
    fixture.recordAttemptUsage.mockImplementation((input: RecordAttemptUsageInput): AgentAttemptRecord => {
      const projection = fixture.markAttemptRunning.mock.results.at(-1)?.value as AgentAttemptProjection | undefined;
      if (!projection) throw new Error('running_attempt_missing');
      const current = persistedAttempt ?? projection.attempt;
      if (input.usage.totalTokens < current.usageSnapshot.totalTokens) {
        throw new Error('attempt_usage_regression');
      }
      persistedAttempt = {
        ...current,
        usageSnapshot: input.usage,
        usageComplete: input.complete,
        usageUpdatedAt: input.occurredAt
      };
      return persistedAttempt;
    });
    fixture.getAttempt.mockImplementation((): AgentAttemptRecord | null => persistedAttempt);
    fixture.executeTask.mockImplementationOnce(async (input: ChildRuntimeInput): Promise<ChildExecutionOutcome> => {
      fixture.dependencies.recordAttemptUsage({
        taskId: input.task.taskId,
        attemptId: input.attempt.attemptId,
        usage: partialUsage,
        complete: false,
        occurredAt: '2026-07-27T00:00:00.000Z'
      });
      throw new Error('injected_executor_rejected');
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    await vi.waitFor((): void => {
      expect(fixture.recordTaskResult).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: task.taskId }),
        expect.objectContaining({
          executionStatus: 'failed',
          usage: partialUsage,
          error: expect.objectContaining({ code: 'runtime_failed' })
        })
      );
      expect(fixture.recordAttemptUsage).toHaveBeenLastCalledWith(
        expect.objectContaining({
          usage: partialUsage,
          complete: true
        })
      );
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
    fixture.cancelTask.mockImplementationOnce((_taskId: string, reason: string) => {
      rejectLease({ code: 'cancelled', reason });
      return 'queued_cancelled';
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);

    await coordinator.cancel(payload.checkpointId, 'user_cancelled');

    expect(fixture.cancelCheckpoint).toHaveBeenCalledWith(payload.checkpointId, 'user_cancelled');
    expect(fixture.cancelCheckpoint).toHaveBeenCalledTimes(2);
    expect(fixture.cancelTask).toHaveBeenCalledWith(task.taskId, 'user_cancelled');
    expect(fixture.cancelCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(fixture.cancelTask.mock.invocationCallOrder[0] as number);
    expect(fixture.beginAttempt).not.toHaveBeenCalled();
    expect(fixture.executeTask).not.toHaveBeenCalled();
    expect(fixture.releaseBudget).toHaveBeenCalledOnce();
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
  });

  it('cancels only the targeted running Task and normalizes a late success with its actual usage', async (): Promise<void> => {
    const tasks = [createTask(1), createTask(2)];
    const fixture = createDependencies(tasks);
    const controllers = new Map<string, AbortController>();
    const runtimeInputs = new Map<string, ChildRuntimeInput>();
    const finishers = new Map<string, (outcome: ChildExecutionOutcome) => void>();
    const attempts = new Map<string, AgentAttemptProjection>();
    const taskStates = new Map(tasks.map((task): [string, AgentTaskRecord] => [task.taskId, task]));
    fixture.authorizeTask.mockImplementation((taskId: string): AgentTaskRecord => {
      const source = taskStates.get(taskId);
      if (!source) throw new Error('Parallel Task fixture is missing');
      const authorized = authorizeTask(source);
      taskStates.set(taskId, authorized);
      return authorized;
    });
    fixture.getTask.mockImplementation((taskId: string): AgentTaskRecord | null => taskStates.get(taskId) ?? null);
    fixture.requestTaskCancellation.mockImplementation((taskId: string) => {
      const source = taskStates.get(taskId);
      if (!source) throw new Error('Parallel cancellation fixture is missing');
      const cancelling = {
        ...source,
        status: 'cancelling' as const,
        queuePhase: undefined,
        cancelRequestedAt: '2026-07-27T00:00:00.000Z'
      };
      taskStates.set(taskId, cancelling);
      return {
        previousStatus: source.status,
        task: cancelling,
        disposition: 'cancel_requested' as const
      };
    });
    fixture.beginAttempt.mockImplementation((input: BeginAgentAttemptInput): AgentAttemptProjection => {
      const source = tasks.find((task): boolean => task.taskId === input.taskId);
      if (!source) throw new Error('Parallel Task fixture is missing');
      const authorized = taskStates.get(input.taskId);
      if (!authorized?.executionPlanSnapshotHash) throw new Error('Parallel Task was not authorized');
      const projection: AgentAttemptProjection = {
        task: { ...authorized, status: 'starting', queuePhase: undefined, currentAttemptId: input.attemptId },
        attempt: {
          attemptId: input.attemptId,
          taskId: input.taskId,
          attemptNumber: 1,
          parentRuntimeId: input.parentRuntimeId,
          planHash: authorized.executionPlanSnapshotHash as string,
          initialRuntimeId: input.runtimeId,
          currentRuntimeId: input.runtimeId,
          runtimeSequence: 1,
          status: 'starting',
          usageSnapshot: createAttemptUsage(authorized),
          usageComplete: true,
          usageUpdatedAt: '2026-07-27T00:00:00.000Z',
          createdAt: '2026-07-27T00:00:00.000Z'
        }
      };
      attempts.set(input.attemptId, projection);
      taskStates.set(input.taskId, projection.task);
      return projection;
    });
    fixture.markAttemptRunning.mockImplementation((input): AgentAttemptProjection => {
      const projection = attempts.get(input.attemptId);
      if (!projection) throw new Error('Parallel Attempt fixture is missing');
      const running: AgentAttemptProjection = {
        task: { ...projection.task, status: 'running' },
        attempt: { ...projection.attempt, status: 'running', startedAt: '2026-07-27T00:00:00.000Z' }
      };
      taskStates.set(input.taskId, running.task);
      return running;
    });
    fixture.enqueueTask.mockImplementation(async (request: AgentScheduleRequest): Promise<AgentResourceLease> => {
      const controller = new AbortController();
      controllers.set(request.taskId, controller);
      return {
        taskId: request.taskId,
        phase: request.phase,
        kind: request.kind,
        signal: controller.signal,
        release: vi.fn()
      };
    });
    fixture.executeTask.mockImplementation(
      (input: ChildRuntimeInput): Promise<ChildExecutionOutcome> =>
        new Promise<ChildExecutionOutcome>((resolve): void => {
          runtimeInputs.set(input.task.taskId, input);
          finishers.set(input.task.taskId, resolve);
        })
    );
    fixture.cancelTask.mockImplementation((taskId: string, reason: string) => {
      controllers.get(taskId)?.abort(reason);
      return 'active_signalled';
    });
    fixture.getActor.mockImplementation((taskId: string) => ({ taskId }));
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);
    await vi.waitFor((): void => {
      expect(fixture.executeTask).toHaveBeenCalledTimes(2);
    });

    const cancellation = coordinator.cancelTask(tasks[0]!.taskId);
    const targetInput = runtimeInputs.get(tasks[0]!.taskId);
    if (!targetInput) throw new Error('Target Runtime input must be captured');
    finishers.get(tasks[0]!.taskId)?.({
      kind: 'terminal',
      result: createResult(targetInput.task, targetInput.attempt.attemptId, 'completed')
    });
    await expect(cancellation).resolves.toBe('cancel_requested');

    const siblingInput = runtimeInputs.get(tasks[1]!.taskId);
    if (!siblingInput) throw new Error('Sibling Runtime input must be captured');
    finishers.get(tasks[1]!.taskId)?.({
      kind: 'terminal',
      result: createResult(siblingInput.task, siblingInput.attempt.attemptId, 'completed')
    });
    await vi.waitFor((): void => {
      expect(fixture.recordTaskResult).toHaveBeenCalledTimes(2);
    });

    expect(fixture.requestTaskCancellation).toHaveBeenCalledWith(tasks[0]!.taskId, 'single_task');
    expect(fixture.requestTaskCancellation).not.toHaveBeenCalledWith(tasks[1]!.taskId, expect.anything());
    expect(fixture.cancelTask).toHaveBeenCalledOnce();
    expect(fixture.cancelTask).toHaveBeenCalledWith(tasks[0]!.taskId, 'user_cancelled');
    expect(fixture.abortTask).toHaveBeenCalledWith(tasks[0]!.taskId, expect.objectContaining({ code: 'cancelled', details: { reason: 'user_cancelled' } }));
    expect(fixture.recordTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: tasks[0]!.taskId }),
      expect.objectContaining({
        executionStatus: 'cancelled',
        usage: expect.objectContaining({ totalTokens: 15 })
      })
    );
    expect(fixture.recordTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: tasks[1]!.taskId }),
      expect.objectContaining({ executionStatus: 'completed' })
    );
    expect(fixture.releaseBudget).not.toHaveBeenCalledWith(tasks[1]!.taskId);
    expect(fixture.releaseActor).toHaveBeenCalledWith(tasks[0]!.taskId);
    expect(fixture.releaseActor).toHaveBeenCalledWith(tasks[1]!.taskId);
  });

  it('revokes a pending confirmation and records a cancelled write Result only after cleanup', async (): Promise<void> => {
    const task = createWriteTask();
    const fixture = createDependencies([task]);
    const authorized = authorizeWriteTask(task);
    const runtimeId = `runtime-${task.taskId}`;
    const attemptId = `attempt-${runtimeId}`;
    const runningTask: AgentTaskRecord = {
      ...authorized,
      status: 'running',
      queuePhase: undefined,
      currentAttemptId: attemptId
    };
    const changeset = createChangeset(runningTask, attemptId, runtimeId);
    const draft = createWriteDraft(runningTask, attemptId);
    let currentTask = task;
    let confirmationStatus: AgentConfirmationRecord['status'] = 'pending';
    let finishConfirmation: (decision: { decision: 'rejected'; version: number }) => void = (): void => undefined;
    const confirmation: AgentConfirmationRecord = {
      confirmationId: 'confirmation-1',
      changesetId: changeset.snapshot.changesetId,
      request: {} as AgentConfirmationRecord['request'],
      requestHash: '9'.repeat(64),
      status: 'pending',
      version: 1,
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z'
    };
    fixture.authorizeTask.mockImplementation((): AgentTaskRecord => {
      currentTask = authorized;
      return authorized;
    });
    fixture.getTask.mockImplementation((): AgentTaskRecord => currentTask);
    fixture.requestTaskCancellation.mockImplementation(() => {
      const previousStatus = currentTask.status;
      currentTask = {
        ...currentTask,
        status: 'cancelling',
        queuePhase: undefined,
        cancelRequestedAt: '2026-07-27T00:00:00.000Z'
      };
      return { previousStatus, task: currentTask, disposition: 'cancel_requested' as const };
    });
    fixture.executeTask.mockResolvedValue({
      kind: 'changeset_prepared',
      changeset: changeset.snapshot,
      draft
    });
    fixture.dependencies.prepareChangeset = vi.fn((): AgentChangesetRecord => {
      currentTask = { ...runningTask, status: 'waiting_confirmation' };
      return changeset;
    });
    const revokeTask = vi.fn((): [] => {
      confirmationStatus = 'revoked';
      finishConfirmation({ decision: 'rejected', version: 2 });
      return [];
    });
    fixture.dependencies.confirmationQueue = {
      request: vi.fn(
        (): Promise<{ decision: 'rejected'; version: number }> =>
          new Promise((resolve): void => {
            finishConfirmation = resolve;
          })
      ),
      revokeTask,
      invalidate: vi.fn()
    };
    fixture.dependencies.getConfirmation = vi.fn(
      (): AgentConfirmationRecord => ({
        ...confirmation,
        status: confirmationStatus,
        version: confirmationStatus === 'revoked' ? 2 : 1,
        updatedAt: confirmationStatus === 'revoked' ? '2026-07-27T00:00:01.000Z' : confirmation.updatedAt
      })
    );
    fixture.dependencies.getChangeset = vi.fn((): AgentChangesetRecord => changeset);
    fixture.dependencies.queueCommit = vi.fn();
    fixture.dependencies.createConfirmationId = (): string => confirmation.confirmationId;
    fixture.dependencies.fileCommitter = { commit: vi.fn(), cancelTask: vi.fn(), recover: vi.fn() };
    let finishDiscard: () => void = (): void => undefined;
    const discardGate = new Promise<void>((resolve): void => {
      finishDiscard = resolve;
    });
    fixture.discardRuntime.mockReturnValue(discardGate);
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);
    await vi.waitFor((): void => {
      expect(fixture.dependencies.confirmationQueue?.request).toHaveBeenCalledOnce();
      expect(currentTask.status).toBe('waiting_confirmation');
    });

    const cancellation = coordinator.cancelTask(task.taskId);
    await vi.waitFor((): void => {
      expect(fixture.discardRuntime).toHaveBeenCalledWith(runtimeId);
    });
    expect(fixture.recordTaskResult).not.toHaveBeenCalled();
    finishDiscard();
    await expect(cancellation).resolves.toBe('cancel_requested');

    expect(revokeTask).toHaveBeenCalledWith(task.taskId, 'user_cancelled');
    expect(fixture.cancelTask).not.toHaveBeenCalled();
    expect(fixture.discardRuntime).toHaveBeenCalledWith(runtimeId);
    expect(fixture.recordTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.taskId }),
      expect.objectContaining({
        executionStatus: 'cancelled',
        usage: expect.objectContaining({ totalTokens: 15 }),
        error: expect.objectContaining({
          code: 'cancelled',
          details: { reason: 'confirmation_revoked' }
        })
      })
    );
    expect(fixture.dependencies.queueCommit).not.toHaveBeenCalled();
    expect(fixture.dependencies.fileCommitter?.commit).not.toHaveBeenCalled();
  });

  it('records a recovery failure instead of false cancellation when write cleanup fails', async (): Promise<void> => {
    const task = createWriteTask();
    const fixture = createDependencies([task]);
    const controller = new AbortController();
    const authorized = authorizeWriteTask(task);
    const runtimeId = `runtime-${task.taskId}`;
    const attemptId = `attempt-${runtimeId}`;
    const runningTask: AgentTaskRecord = {
      ...authorized,
      status: 'running',
      queuePhase: undefined,
      currentAttemptId: attemptId
    };
    const changeset = createChangeset(runningTask, attemptId, runtimeId);
    fixture.authorizeTask.mockReturnValue(authorized);
    fixture.getTask.mockReturnValue(authorized);
    fixture.enqueueTask.mockResolvedValue({
      taskId: task.taskId,
      phase: 'start',
      kind: 'write-intent',
      signal: controller.signal,
      release: vi.fn()
    });
    fixture.executeTask.mockImplementation(async (): Promise<ChildExecutionOutcome> => {
      controller.abort('user_cancelled');
      return {
        kind: 'changeset_prepared',
        changeset: changeset.snapshot,
        draft: createWriteDraft(runningTask, attemptId)
      };
    });
    fixture.discardRuntime.mockRejectedValue(new Error('overlay_cleanup_failed'));
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);
    await vi.waitFor((): void => {
      expect(fixture.recordTaskResult).toHaveBeenCalledOnce();
    });

    expect(fixture.recordTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.taskId }),
      expect.objectContaining({
        executionStatus: 'failed',
        error: {
          code: 'runtime_interrupted',
          phase: 'recovery',
          category: 'runtime',
          retryable: true,
          details: {
            reason: 'write_overlay_cleanup_failed',
            runtimeId
          }
        }
      })
    );
    expect(fixture.recordTaskResult).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ executionStatus: 'cancelled' }));
  });

  it('lets cancellation win after the commit lease is active but before external mutation', async (): Promise<void> => {
    const task = createWriteTask();
    const fixture = createDependencies([task]);
    const authorized = authorizeWriteTask(task);
    const runtimeId = `runtime-${task.taskId}`;
    const attemptId = `attempt-${runtimeId}`;
    const runningTask: AgentTaskRecord = {
      ...authorized,
      status: 'running',
      queuePhase: undefined,
      currentAttemptId: attemptId
    };
    const changeset = createChangeset(runningTask, attemptId, runtimeId);
    const approvedChangeset: AgentChangesetRecord = {
      ...changeset,
      status: 'approved',
      confirmationId: 'confirmation-1'
    };
    const draft = createWriteDraft(runningTask, attemptId);
    const confirmation: AgentConfirmationRecord = {
      confirmationId: 'confirmation-1',
      changesetId: changeset.snapshot.changesetId,
      request: {} as AgentConfirmationRecord['request'],
      requestHash: '9'.repeat(64),
      status: 'approved',
      version: 2,
      decision: 'approved',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:01.000Z'
    };
    let currentTask = task;
    const commitController = new AbortController();
    const releaseCommit = vi.fn();
    let resolveCommitLease: (lease: AgentResourceLease) => void = (): void => undefined;
    fixture.authorizeTask.mockImplementation((): AgentTaskRecord => {
      currentTask = authorized;
      return authorized;
    });
    fixture.getTask.mockImplementation((): AgentTaskRecord => currentTask);
    fixture.requestTaskCancellation.mockImplementation(() => {
      const previousStatus = currentTask.status;
      currentTask = {
        ...currentTask,
        status: 'cancelling',
        queuePhase: undefined,
        cancelRequestedAt: '2026-07-27T00:00:00.000Z'
      };
      return { previousStatus, task: currentTask, disposition: 'cancel_requested' as const };
    });
    fixture.executeTask.mockResolvedValue({
      kind: 'changeset_prepared',
      changeset: changeset.snapshot,
      draft
    });
    fixture.dependencies.prepareChangeset = vi.fn((): AgentChangesetRecord => changeset);
    const revokeTask = vi.fn();
    fixture.dependencies.confirmationQueue = {
      request: vi.fn(async (): Promise<{ decision: 'approved'; version: number }> => ({ decision: 'approved', version: 2 })),
      revokeTask,
      invalidate: vi.fn()
    };
    fixture.dependencies.getConfirmation = vi.fn((): AgentConfirmationRecord => confirmation);
    fixture.dependencies.getChangeset = vi.fn((): AgentChangesetRecord => approvedChangeset);
    fixture.dependencies.queueCommit = vi.fn((): AgentTaskRecord => {
      currentTask = { ...runningTask, status: 'queued', queuePhase: 'commit' };
      return currentTask;
    });
    fixture.dependencies.createConfirmationId = (): string => confirmation.confirmationId;
    fixture.dependencies.fileCommitter = { commit: vi.fn(), cancelTask: vi.fn(), recover: vi.fn() };
    let finishDiscard: () => void = (): void => undefined;
    const discardGate = new Promise<void>((resolve): void => {
      finishDiscard = resolve;
    });
    fixture.discardRuntime.mockReturnValue(discardGate);
    fixture.enqueueTask.mockImplementation((request: AgentScheduleRequest): Promise<AgentResourceLease> => {
      if (request.phase === 'commit') {
        return new Promise<AgentResourceLease>((resolve): void => {
          resolveCommitLease = resolve;
        });
      }
      return Promise.resolve({
        taskId: request.taskId,
        phase: request.phase,
        kind: request.kind,
        signal: new AbortController().signal,
        release: vi.fn()
      });
    });
    fixture.cancelTask.mockImplementation((_taskId: string, reason: string) => {
      commitController.abort(reason);
      return 'active_signalled';
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);
    await vi.waitFor((): void => {
      expect(currentTask).toMatchObject({ status: 'queued', queuePhase: 'commit' });
      expect(fixture.enqueueTask).toHaveBeenCalledWith(expect.objectContaining({ taskId: task.taskId, phase: 'commit' }));
    });

    resolveCommitLease({
      taskId: task.taskId,
      phase: 'commit',
      kind: 'exclusive-commit',
      signal: commitController.signal,
      release: releaseCommit
    });
    const cancellation = coordinator.cancelTask(task.taskId);

    await vi.waitFor((): void => {
      expect(fixture.discardRuntime).toHaveBeenCalledWith(runtimeId);
    });
    expect(fixture.recordTaskResult).not.toHaveBeenCalled();
    finishDiscard();
    await expect(cancellation).resolves.toBe('cancel_requested');

    expect(fixture.cancelTask).toHaveBeenCalledWith(task.taskId, 'user_cancelled');
    expect(fixture.requestTaskCancellation.mock.invocationCallOrder[0]).toBeLessThan(fixture.cancelTask.mock.invocationCallOrder[0] as number);
    expect(revokeTask).not.toHaveBeenCalled();
    expect(fixture.dependencies.getConfirmation).toHaveReturnedWith(expect.objectContaining({ status: 'approved', version: 2 }));
    expect(fixture.dependencies.fileCommitter?.commit).not.toHaveBeenCalled();
    expect(fixture.recordTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.taskId }),
      expect.objectContaining({
        executionStatus: 'cancelled',
        usage: expect.objectContaining({ totalTokens: 15 }),
        error: expect.objectContaining({ phase: 'commit' })
      })
    );
    expect(fixture.discardRuntime).toHaveBeenCalledWith(runtimeId);
    expect(releaseCommit).toHaveBeenCalledOnce();
  });

  it('cleans one created journal overlay before finalizing cancellation', async (): Promise<void> => {
    const source = createWriteTask();
    let currentTask: AgentTaskRecord = {
      ...source,
      status: 'committing',
      currentAttemptId: 'attempt-commit-cancel',
      unfinishedJournalCount: 1
    };
    const fixture = createDependencies([currentTask]);
    const order: string[] = [];
    fixture.getTask.mockImplementation((): AgentTaskRecord => currentTask);
    fixture.requestTaskCancellation.mockImplementation(() => {
      order.push('request-persisted');
      currentTask = { ...currentTask, cancelRequestedAt: '2026-07-27T00:00:00.000Z' };
      return { previousStatus: 'committing', task: currentTask, disposition: 'commit_in_progress' as const };
    });
    const journal = {
      journalId: 'journal-created-cancel',
      taskId: currentTask.taskId,
      attemptId: currentTask.currentAttemptId,
      status: 'cancelled',
      appliedOperationIds: []
    } as unknown as AgentCommitJournalRecord;
    const cancelCommit = vi.fn(async () => {
      order.push('journal-cancelled');
      currentTask = { ...currentTask, unfinishedJournalCount: 0 };
      return { disposition: 'journal_cancelled' as const, journal };
    });
    fixture.dependencies.fileCommitter = {
      commit: vi.fn(),
      cancelTask: cancelCommit,
      recover: vi.fn()
    };
    const discardOverlay = vi.fn(async (): Promise<void> => {
      order.push('overlay-discarded');
    });
    const finalizeCancellation = vi.fn((): AgentCheckpointRecord => {
      order.push('cancellation-finalized');
      currentTask = {
        ...currentTask,
        status: 'cancelled',
        result: createResult(currentTask, currentTask.currentAttemptId as string)
      };
      return { ...createCheckpoint([currentTask]), status: 'ready_to_resume' };
    });
    Reflect.set(fixture.dependencies, 'discardTaskOverlay', discardOverlay);
    Reflect.set(fixture.dependencies, 'finalizeCommitCancellation', finalizeCancellation);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await expect(coordinator.cancelTask(currentTask.taskId)).resolves.toBe('cancel_requested');

    expect(order).toEqual(['request-persisted', 'journal-cancelled', 'overlay-discarded', 'cancellation-finalized']);
    expect(discardOverlay).toHaveBeenCalledWith({
      taskId: currentTask.taskId,
      attemptId: 'attempt-commit-cancel'
    });
    expect(finalizeCancellation).toHaveBeenCalledWith({
      journalId: journal.journalId,
      occurredAt: '2026-07-27T00:00:00.000Z'
    });
    expect(fixture.cancelTask).not.toHaveBeenCalled();
    expect(fixture.abortTask).not.toHaveBeenCalled();
    expect(fixture.discardRuntime).not.toHaveBeenCalled();
    expect(fixture.recordTaskResult).not.toHaveBeenCalled();
    expect(fixture.settleTask).toHaveBeenCalledWith(currentTask.taskId, expect.objectContaining({ totalTokens: expect.any(Number) }));
  });

  it('arbitrates a stale queued commit through the journal when commit wins the cancellation CAS', async (): Promise<void> => {
    const source = createWriteTask();
    const queuedTask: AgentTaskRecord = {
      ...source,
      status: 'queued',
      queuePhase: 'commit',
      currentAttemptId: 'attempt-journal-race'
    };
    let currentTask = queuedTask;
    const fixture = createDependencies([queuedTask]);
    fixture.getTask.mockImplementation((): AgentTaskRecord => currentTask);
    fixture.requestTaskCancellation.mockImplementation(() => {
      currentTask = {
        ...currentTask,
        status: 'committing',
        queuePhase: undefined,
        unfinishedJournalCount: 1,
        cancelRequestedAt: '2026-07-27T00:00:00.000Z'
      };
      return { previousStatus: 'committing', task: currentTask, disposition: 'commit_in_progress' as const };
    });
    const journal = {
      journalId: 'journal-race-winner',
      taskId: currentTask.taskId,
      attemptId: currentTask.currentAttemptId,
      status: 'cancelled',
      appliedOperationIds: []
    } as unknown as AgentCommitJournalRecord;
    fixture.dependencies.fileCommitter = {
      commit: vi.fn(),
      cancelTask: vi.fn(async () => {
        currentTask = { ...currentTask, unfinishedJournalCount: 0 };
        return { disposition: 'journal_cancelled' as const, journal };
      }),
      recover: vi.fn()
    };
    Reflect.set(
      fixture.dependencies,
      'discardTaskOverlay',
      vi.fn(async (): Promise<void> => undefined)
    );
    Reflect.set(
      fixture.dependencies,
      'finalizeCommitCancellation',
      vi.fn((): AgentCheckpointRecord => {
        currentTask = {
          ...currentTask,
          status: 'cancelled',
          result: createResult(currentTask, currentTask.currentAttemptId as string)
        };
        return { ...createCheckpoint([currentTask]), status: 'ready_to_resume' };
      })
    );
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await expect(coordinator.cancelTask(currentTask.taskId)).resolves.toBe('cancel_requested');

    const { fileCommitter } = fixture.dependencies;
    if (!fileCommitter) throw new Error('file committer should exist in this fixture');
    expect(fileCommitter.cancelTask).toHaveBeenCalledWith(currentTask.taskId);
    expect(fixture.cancelTask).not.toHaveBeenCalled();
    expect(fixture.settleTask).toHaveBeenCalledWith(currentTask.taskId, currentTask.result?.usage);
  });

  it('keeps a cancelled journal nonterminal when precise overlay cleanup fails', async (): Promise<void> => {
    const source = createWriteTask();
    let currentTask: AgentTaskRecord = {
      ...source,
      status: 'committing',
      currentAttemptId: 'attempt-cleanup-failure',
      unfinishedJournalCount: 1
    };
    const fixture = createDependencies([currentTask]);
    fixture.getTask.mockImplementation((): AgentTaskRecord => currentTask);
    fixture.requestTaskCancellation.mockImplementation(() => {
      currentTask = { ...currentTask, cancelRequestedAt: '2026-07-27T00:00:00.000Z' };
      return { previousStatus: 'committing', task: currentTask, disposition: 'commit_in_progress' as const };
    });
    const journal = {
      journalId: 'journal-cleanup-failure',
      taskId: currentTask.taskId,
      attemptId: currentTask.currentAttemptId,
      status: 'cancelled',
      appliedOperationIds: []
    } as unknown as AgentCommitJournalRecord;
    fixture.dependencies.fileCommitter = {
      commit: vi.fn(),
      cancelTask: vi.fn(async () => {
        currentTask = { ...currentTask, unfinishedJournalCount: 0 };
        return { disposition: 'journal_cancelled' as const, journal };
      }),
      recover: vi.fn()
    };
    const discardOverlay = vi.fn(async (): Promise<void> => {
      throw new Error('overlay_cleanup_failed');
    });
    const finalizeCancellation = vi.fn();
    Reflect.set(fixture.dependencies, 'discardTaskOverlay', discardOverlay);
    Reflect.set(fixture.dependencies, 'finalizeCommitCancellation', finalizeCancellation);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await expect(coordinator.cancelTask(currentTask.taskId)).rejects.toThrow('overlay_cleanup_failed');

    expect(currentTask).toMatchObject({
      status: 'committing',
      unfinishedJournalCount: 0,
      cancelRequestedAt: '2026-07-27T00:00:00.000Z'
    });
    expect(finalizeCancellation).not.toHaveBeenCalled();
    expect(fixture.recordTaskResult).not.toHaveBeenCalled();
    expect(fixture.discardRuntime).not.toHaveBeenCalled();
  });

  it('returns commit_in_progress without aborting or discarding after journal applying', async (): Promise<void> => {
    const source = createWriteTask();
    let currentTask: AgentTaskRecord = {
      ...source,
      status: 'committing',
      currentAttemptId: 'attempt-applying-cancel',
      unfinishedJournalCount: 1
    };
    const fixture = createDependencies([currentTask]);
    fixture.getTask.mockImplementation((): AgentTaskRecord => currentTask);
    fixture.requestTaskCancellation.mockImplementation(() => {
      currentTask = { ...currentTask, cancelRequestedAt: '2026-07-27T00:00:00.000Z' };
      return { previousStatus: 'committing', task: currentTask, disposition: 'commit_in_progress' as const };
    });
    const cancelCommit = vi.fn(
      async () =>
        ({
          disposition: 'commit_in_progress',
          journal: {
            journalId: 'journal-applying-cancel',
            taskId: currentTask.taskId,
            attemptId: currentTask.currentAttemptId,
            status: 'applying',
            appliedOperationIds: []
          } as unknown as AgentCommitJournalRecord
        } as const)
    );
    fixture.dependencies.fileCommitter = {
      commit: vi.fn(),
      cancelTask: cancelCommit,
      recover: vi.fn()
    };
    const discardOverlay = vi.fn();
    const finalizeCancellation = vi.fn();
    Reflect.set(fixture.dependencies, 'discardTaskOverlay', discardOverlay);
    Reflect.set(fixture.dependencies, 'finalizeCommitCancellation', finalizeCancellation);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await expect(coordinator.cancelTask(currentTask.taskId)).resolves.toBe('commit_in_progress');

    expect(currentTask.cancelRequestedAt).toBe('2026-07-27T00:00:00.000Z');
    expect(cancelCommit).toHaveBeenCalledWith(currentTask.taskId);
    expect(fixture.cancelTask).not.toHaveBeenCalled();
    expect(fixture.abortTask).not.toHaveBeenCalled();
    expect(fixture.abortRuntime).not.toHaveBeenCalled();
    expect(fixture.discardRuntime).not.toHaveBeenCalled();
    expect(discardOverlay).not.toHaveBeenCalled();
    expect(finalizeCancellation).not.toHaveBeenCalled();
  });

  it('propagates target cleanup failure after independently releasing the lease and Runtime route', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    const controller = new AbortController();
    const release = vi.fn();
    let runtimeInput: ChildRuntimeInput | undefined;
    let finishExecution: (outcome: ChildExecutionOutcome) => void = (): void => undefined;
    fixture.enqueueTask.mockResolvedValue({
      taskId: task.taskId,
      phase: 'start',
      kind: 'shared-read',
      signal: controller.signal,
      release
    });
    fixture.executeTask.mockImplementation(
      (input: ChildRuntimeInput): Promise<ChildExecutionOutcome> =>
        new Promise<ChildExecutionOutcome>((resolve): void => {
          runtimeInput = input;
          finishExecution = resolve;
        })
    );
    fixture.cancelTask.mockImplementation((_taskId: string, reason: string) => {
      controller.abort(reason);
      return 'active_signalled';
    });
    fixture.getActor.mockReturnValue({ taskId: task.taskId });
    fixture.releaseActor.mockImplementation((): never => {
      throw new Error('registry_cleanup_failed');
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);
    await vi.waitFor((): void => {
      expect(runtimeInput).toBeDefined();
    });
    const cancellation = coordinator.cancelTask(task.taskId);
    const cancellationFailure = expect(cancellation).rejects.toThrowError('registry_cleanup_failed');
    if (!runtimeInput) throw new Error('Cleanup Runtime input must be captured');
    finishExecution({
      kind: 'terminal',
      result: createResult(runtimeInput.task, runtimeInput.attempt.attemptId, 'completed')
    });

    await cancellationFailure;

    expect(fixture.recordTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.taskId }),
      expect.objectContaining({ executionStatus: 'cancelled' })
    );
    expect(fixture.unbindRuntime).toHaveBeenCalledWith(`runtime-${task.taskId}`);
    expect(release).toHaveBeenCalledOnce();
    expect(fixture.releaseActor).toHaveBeenCalledTimes(3);
    fixture.releaseActor.mockImplementation((): void => undefined);
    await expect(coordinator.cancelTask(task.taskId)).resolves.toBe('already_settled');
    expect(fixture.releaseActor).toHaveBeenCalledTimes(4);
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
    fixture.cancelTask.mockImplementationOnce(() => {
      controller.abort('user_cancelled');
      return 'active_signalled';
    });
    let finishExecution: (result: ChildExecutionOutcome) => void = (): void => undefined;
    fixture.executeTask.mockImplementationOnce(
      (input: ChildRuntimeInput): Promise<ChildExecutionOutcome> =>
        new Promise<ChildExecutionOutcome>((resolve): void => {
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
    finishExecution({ kind: 'terminal', result: createResult(runningTask, `attempt-${task.taskId}`, 'cancelled') });
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
    let runtimeInput: ChildRuntimeInput | undefined;
    let finishExecution: (result: ChildExecutionOutcome) => void = (): void => undefined;
    fixture.enqueueTask.mockResolvedValueOnce({
      taskId: task.taskId,
      phase: 'start',
      kind: 'shared-read',
      signal: controller.signal,
      release: vi.fn()
    });
    fixture.cancelTask.mockImplementationOnce(() => {
      controller.abort('user_cancelled');
      return 'active_signalled';
    });
    fixture.executeTask.mockImplementationOnce(
      (input: ChildRuntimeInput): Promise<ChildExecutionOutcome> =>
        new Promise<ChildExecutionOutcome>((resolve): void => {
          runtimeInput = input;
          finishExecution = resolve;
        })
    );
    fixture.getActor.mockReturnValue({ taskId: task.taskId });
    fixture.cancelCheckpoint.mockReturnValue({ ...createCheckpoint([task]), status: 'cancelling', version: 2 });
    fixture.recordTaskResult.mockReturnValue({ ...createCheckpoint([task]), status: 'cancelled', version: 3 });
    const coordinator = createAgentCoordinator(fixture.dependencies);
    await coordinator.accept(payload);
    await vi.waitFor((): void => {
      expect(runtimeInput).toBeDefined();
    });

    const cancellation = coordinator.cancel(payload.checkpointId, 'user_cancelled');
    const cancellationFailure = expect(cancellation).rejects.toThrowError('coordinator_cancel_cleanup_timeout');
    await vi.advanceTimersByTimeAsync(200);
    await cancellationFailure;

    expect(fixture.abortRuntime).toHaveBeenCalledWith(`runtime-${task.taskId}`, 'user_cancelled');
    // 即使有界等待超时，也要执行一次当下可完成的幂等汇合；此时仍为 cancelling。
    expect(fixture.cancelCheckpoint).toHaveBeenCalledTimes(2);
    expect(fixture.recordTaskResult).not.toHaveBeenCalled();
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('running');

    if (!runtimeInput) throw new Error('Late Runtime input must be captured');
    finishExecution({
      kind: 'terminal',
      result: createResult(runtimeInput.task, runtimeInput.attempt.attemptId, 'completed')
    });
    await vi.runAllTimersAsync();

    expect(fixture.recordTaskResult).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: task.taskId }),
      expect.objectContaining({ executionStatus: 'cancelled' })
    );
    // 调用方超时只结束有界等待；迟到 Result 仍必须重新驱动 cancelled Checkpoint 的收尾边界。
    expect(fixture.cancelCheckpoint).toHaveBeenCalledTimes(3);
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
    vi.useRealTimers();
  });

  it('releases write intent before confirmation and reacquires an exclusive commit lease', async (): Promise<void> => {
    const task = createWriteTask();
    const fixture = createDependencies([task]);
    const order: string[] = [];
    const authorized = authorizeWriteTask(task);
    const attemptId = `attempt-runtime-${task.taskId}`;
    const runtimeId = `runtime-${task.taskId}`;
    const runningProjection: AgentAttemptProjection = {
      task: { ...authorized, status: 'running', currentAttemptId: attemptId },
      attempt: {
        attemptId,
        taskId: task.taskId,
        attemptNumber: 1,
        parentRuntimeId: 'runtime-a',
        planHash: authorized.executionPlanSnapshotHash as string,
        initialRuntimeId: runtimeId,
        currentRuntimeId: runtimeId,
        runtimeSequence: 1,
        status: 'running',
        usageSnapshot: createAttemptUsage(authorized),
        usageComplete: false,
        usageUpdatedAt: '2026-07-27T00:00:00.000Z',
        createdAt: '2026-07-27T00:00:00.000Z',
        startedAt: '2026-07-27T00:00:00.000Z'
      }
    };
    const changeset = createChangeset(runningProjection.task, attemptId, runtimeId);
    const draft = createWriteDraft(runningProjection.task, attemptId);
    let currentTask = authorized;
    const confirmation: AgentConfirmationRecord = {
      confirmationId: 'confirmation-1',
      changesetId: changeset.snapshot.changesetId,
      request: {
        confirmationSchemaVersion: 1,
        confirmationId: 'confirmation-1',
        sessionId: task.sessionId,
        turnId: task.turnId,
        taskId: task.taskId,
        attemptId,
        agentId: task.agentId,
        runtimeId,
        toolCallId: task.toolCallId,
        changesetId: changeset.snapshot.changesetId,
        planHash: changeset.snapshot.planHash,
        baseRevision: changeset.snapshot.baseRevision,
        diffHash: changeset.snapshot.diffHash,
        operationSetHash: changeset.snapshot.operationSetHash,
        resourceScopes: changeset.snapshot.resourceScopes,
        displayPaths: ['resource-1.md'],
        unifiedDiffReference: changeset.snapshot.diffReference,
        riskLevel: 'write',
        createdAt: '2026-07-27T00:00:00.000Z'
      },
      requestHash: '9'.repeat(64),
      status: 'approved',
      version: 2,
      decision: 'approved',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:01.000Z'
    };
    const completed = {
      ...createResult(runningProjection.task, attemptId),
      changeset: {
        changesetId: changeset.snapshot.changesetId,
        baseRevision: changeset.snapshot.baseRevision,
        diffHash: changeset.snapshot.diffHash,
        operationSetHash: changeset.snapshot.operationSetHash,
        planHash: changeset.snapshot.planHash
      }
    };
    fixture.authorizeTask.mockImplementation((): AgentTaskRecord => {
      currentTask = authorized;
      return authorized;
    });
    fixture.getTask.mockImplementation((): AgentTaskRecord => currentTask);
    fixture.beginAttempt.mockImplementation((): AgentAttemptProjection => {
      order.push('attempt-started');
      const projection = {
        task: { ...runningProjection.task, status: 'starting' as const },
        attempt: { ...runningProjection.attempt, status: 'starting' as const }
      };
      currentTask = projection.task;
      return projection;
    });
    fixture.markAttemptRunning.mockImplementation((): AgentAttemptProjection => {
      order.push('runtime-started');
      currentTask = runningProjection.task;
      return runningProjection;
    });
    fixture.executeTask.mockImplementation(
      async (): Promise<ChildExecutionOutcome> => ({
        kind: 'changeset_prepared',
        changeset: changeset.snapshot,
        draft
      })
    );
    fixture.enqueueTask.mockImplementation(async (request: AgentScheduleRequest): Promise<AgentResourceLease> => {
      order.push(request.phase === 'start' ? 'write-intent-acquired' : 'exclusive-commit-acquired');
      return {
        taskId: request.taskId,
        phase: request.phase,
        kind: request.kind,
        signal: new AbortController().signal,
        release: (): void => {
          order.push(request.phase === 'start' ? 'write-intent-released' : 'exclusive-commit-released');
        }
      };
    });
    fixture.dependencies.prepareChangeset = vi.fn((): AgentChangesetRecord => {
      order.push('changeset-prepared');
      return changeset;
    });
    fixture.dependencies.confirmationQueue = {
      request: vi.fn(async (): Promise<{ decision: 'approved'; version: number }> => {
        order.push('confirmation-created');
        order.push('confirmation-approved');
        return { decision: 'approved', version: 2 };
      }),
      revokeTask: vi.fn(),
      invalidate: vi.fn()
    };
    fixture.dependencies.getConfirmation = vi.fn((): AgentConfirmationRecord => confirmation);
    fixture.dependencies.getChangeset = vi.fn(
      (): AgentChangesetRecord => ({
        ...changeset,
        status: 'approved',
        confirmationId: confirmation.confirmationId
      })
    );
    fixture.dependencies.queueCommit = vi.fn((): AgentTaskRecord => {
      order.push('commit-queued');
      currentTask = { ...runningProjection.task, status: 'queued', queuePhase: 'commit' };
      return currentTask;
    });
    fixture.dependencies.createConfirmationId = (): string => 'confirmation-1';
    fixture.dependencies.fileCommitter = {
      commit: vi.fn(async () => {
        order.push('commit-validated');
        order.push('journal-created');
        order.push('journal-finalized');
        return {
          journal: { journalId: 'journal-1' },
          checkpoint: { ...createCheckpoint([task]), status: 'ready_to_resume' },
          result: completed,
          targetHashes: [changeset.snapshot.operations[0]?.targetContentHash as string]
        } as unknown as AgentFileCommitResult;
      }),
      cancelTask: vi.fn(),
      recover: vi.fn()
    };
    fixture.recordTaskResult.mockImplementation((): AgentCheckpointRecord => {
      order.push('result-recorded');
      return { ...createCheckpoint([task]), status: 'ready_to_resume' };
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    await vi.waitFor((): void => {
      expect(order).toEqual([
        'write-intent-acquired',
        'attempt-started',
        'runtime-started',
        'changeset-prepared',
        'write-intent-released',
        'confirmation-created',
        'confirmation-approved',
        'commit-queued',
        'exclusive-commit-acquired',
        'commit-validated',
        'journal-created',
        'journal-finalized',
        'result-recorded',
        'exclusive-commit-released'
      ]);
    });
    expect(fixture.settleTask).toHaveBeenCalledOnce();
    expect(fixture.discardRuntime).toHaveBeenCalledWith(runtimeId);
  });

  it('keeps write Tasks queued until controlled-write startup recovery completes', async (): Promise<void> => {
    const task = createWriteTask();
    const fixture = createDependencies([task]);
    let controlledWriteReady = false;
    fixture.authorizeTask.mockReturnValue(authorizeWriteTask(task));
    fixture.dependencies.isControlledWriteReady = (): boolean => controlledWriteReady;
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    expect(fixture.authorizeTask).toHaveBeenCalledWith(task.taskId);
    expect(fixture.enqueueTask).not.toHaveBeenCalled();
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('idle');

    controlledWriteReady = true;
    await coordinator.recover();

    await vi.waitFor((): void => {
      expect(fixture.enqueueTask).toHaveBeenCalledOnce();
    });
  });

  it('preserves a deadline rejection while acquiring the exclusive commit lease', async (): Promise<void> => {
    const task = createWriteTask();
    const fixture = createDependencies([task]);
    const authorized = authorizeWriteTask(task);
    let currentTask = authorized;
    const confirmation: AgentConfirmationRecord = {
      confirmationId: 'confirmation-1',
      changesetId: 'changeset-1',
      request: {},
      requestHash: '9'.repeat(64),
      status: 'approved',
      version: 2,
      decision: 'approved',
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:01.000Z'
    } as AgentConfirmationRecord;
    fixture.authorizeTask.mockImplementation((): AgentTaskRecord => {
      currentTask = authorized;
      return authorized;
    });
    fixture.getTask.mockImplementation((): AgentTaskRecord => currentTask);
    fixture.beginAttempt.mockImplementation((input: BeginAgentAttemptInput): AgentAttemptProjection => {
      const projection: AgentAttemptProjection = {
        task: { ...authorized, status: 'starting', queuePhase: undefined, currentAttemptId: input.attemptId },
        attempt: {
          attemptId: input.attemptId,
          taskId: input.taskId,
          attemptNumber: 1,
          parentRuntimeId: input.parentRuntimeId,
          planHash: authorized.executionPlanSnapshotHash as string,
          initialRuntimeId: input.runtimeId,
          currentRuntimeId: input.runtimeId,
          runtimeSequence: 1,
          status: 'starting',
          usageSnapshot: createAttemptUsage(authorized),
          usageComplete: true,
          usageUpdatedAt: '2026-07-27T00:00:00.000Z',
          createdAt: '2026-07-27T00:00:00.000Z'
        }
      };
      currentTask = projection.task;
      return projection;
    });
    fixture.markAttemptRunning.mockImplementation((): AgentAttemptProjection => {
      const projection = fixture.beginAttempt.mock.results.at(-1)?.value as AgentAttemptProjection;
      const running = { task: { ...projection.task, status: 'running' as const }, attempt: { ...projection.attempt, status: 'running' as const } };
      currentTask = running.task;
      return running;
    });
    fixture.executeTask.mockImplementation(async (input: ChildRuntimeInput): Promise<ChildExecutionOutcome> => {
      const changeset = createChangeset(input.task, input.attempt.attemptId, input.attempt.currentRuntimeId);
      return {
        kind: 'changeset_prepared',
        changeset: changeset.snapshot,
        draft: createWriteDraft(input.task, input.attempt.attemptId)
      };
    });
    fixture.dependencies.prepareChangeset = vi.fn(
      (input): AgentChangesetRecord => ({
        snapshot: input.snapshot,
        snapshotHash: '7'.repeat(64),
        status: 'prepared',
        recordState: 'active',
        updatedAt: input.occurredAt
      })
    );
    fixture.dependencies.confirmationQueue = {
      request: vi.fn(async (): Promise<{ decision: 'approved'; version: number }> => ({ decision: 'approved', version: 2 })),
      revokeTask: vi.fn(),
      invalidate: vi.fn()
    };
    fixture.dependencies.getConfirmation = vi.fn((): AgentConfirmationRecord => confirmation);
    fixture.dependencies.getChangeset = vi.fn(
      (): AgentChangesetRecord => ({
        ...createChangeset(authorized, 'attempt-runtime-task-1', 'runtime-task-1'),
        status: 'approved',
        confirmationId: confirmation.confirmationId
      })
    );
    fixture.dependencies.queueCommit = vi.fn((): AgentTaskRecord => {
      currentTask = { ...currentTask, status: 'queued', queuePhase: 'commit' };
      return currentTask;
    });
    fixture.dependencies.createConfirmationId = (): string => 'confirmation-1';
    fixture.dependencies.fileCommitter = {
      commit: vi.fn(),
      cancelTask: vi.fn(),
      recover: vi.fn()
    };
    fixture.enqueueTask.mockImplementation(async (request: AgentScheduleRequest): Promise<AgentResourceLease> => {
      if (request.phase === 'commit') {
        throw Object.assign(new Error('schedule_deadline_exceeded'), {
          code: 'deadline_exceeded',
          reason: 'schedule_deadline_exceeded'
        });
      }
      return {
        taskId: request.taskId,
        phase: request.phase,
        kind: request.kind,
        signal: new AbortController().signal,
        release: vi.fn()
      };
    });
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    await vi.waitFor((): void => {
      expect(fixture.recordTaskResult).toHaveBeenCalledWith(
        expect.objectContaining({ queuePhase: 'commit', taskId: task.taskId }),
        expect.objectContaining({
          executionStatus: 'deadline_exceeded',
          error: expect.objectContaining({ code: 'deadline_exceeded', phase: 'commit' })
        })
      );
      expect(fixture.dependencies.fileCommitter?.commit).not.toHaveBeenCalled();
      expect(fixture.discardRuntime).toHaveBeenCalledWith(`runtime-${task.taskId}`);
    });
  });

  it('discards a rejected changeset without requesting an exclusive commit lease', async (): Promise<void> => {
    const task = createWriteTask();
    const fixture = createDependencies([task]);
    const authorized = authorizeWriteTask(task);
    let currentTask = authorized;
    fixture.authorizeTask.mockImplementation((): AgentTaskRecord => {
      currentTask = authorized;
      return authorized;
    });
    fixture.getTask.mockImplementation((): AgentTaskRecord => currentTask);
    fixture.beginAttempt.mockImplementation((input: BeginAgentAttemptInput): AgentAttemptProjection => {
      const projection: AgentAttemptProjection = {
        task: { ...authorized, status: 'starting', queuePhase: undefined, currentAttemptId: input.attemptId },
        attempt: {
          attemptId: input.attemptId,
          taskId: input.taskId,
          attemptNumber: 1,
          parentRuntimeId: input.parentRuntimeId,
          planHash: authorized.executionPlanSnapshotHash as string,
          initialRuntimeId: input.runtimeId,
          currentRuntimeId: input.runtimeId,
          runtimeSequence: 1,
          status: 'starting',
          usageSnapshot: createAttemptUsage(authorized),
          usageComplete: true,
          usageUpdatedAt: '2026-07-27T00:00:00.000Z',
          createdAt: '2026-07-27T00:00:00.000Z'
        }
      };
      currentTask = projection.task;
      return projection;
    });
    fixture.markAttemptRunning.mockImplementation((): AgentAttemptProjection => {
      const projection = fixture.beginAttempt.mock.results.at(-1)?.value as AgentAttemptProjection;
      const running = { task: { ...projection.task, status: 'running' as const }, attempt: { ...projection.attempt, status: 'running' as const } };
      currentTask = running.task;
      return running;
    });
    fixture.executeTask.mockImplementation(async (input: ChildRuntimeInput): Promise<ChildExecutionOutcome> => {
      const changeset = createChangeset(input.task, input.attempt.attemptId, input.attempt.currentRuntimeId);
      return {
        kind: 'changeset_prepared',
        changeset: changeset.snapshot,
        draft: createWriteDraft(input.task, input.attempt.attemptId)
      };
    });
    fixture.dependencies.prepareChangeset = vi.fn(
      (input): AgentChangesetRecord => ({
        snapshot: input.snapshot,
        snapshotHash: '7'.repeat(64),
        status: 'prepared',
        recordState: 'active',
        updatedAt: input.occurredAt
      })
    );
    fixture.dependencies.confirmationQueue = {
      request: vi.fn(async (): Promise<{ decision: 'rejected'; version: number }> => ({ decision: 'rejected', version: 2 })),
      revokeTask: vi.fn(),
      invalidate: vi.fn()
    };
    fixture.dependencies.getConfirmation = vi.fn(
      (): AgentConfirmationRecord =>
        ({
          confirmationId: 'confirmation-1',
          changesetId: 'changeset-1',
          request: {},
          requestHash: '9'.repeat(64),
          status: 'rejected',
          version: 2,
          decision: 'rejected',
          createdAt: '2026-07-27T00:00:00.000Z',
          updatedAt: '2026-07-27T00:00:01.000Z'
        } as AgentConfirmationRecord)
    );
    fixture.dependencies.getChangeset = vi.fn((): AgentChangesetRecord | null => null);
    fixture.dependencies.queueCommit = vi.fn();
    fixture.dependencies.createConfirmationId = (): string => 'confirmation-1';
    fixture.dependencies.fileCommitter = {
      commit: vi.fn(),
      cancelTask: vi.fn(),
      recover: vi.fn()
    };
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.accept(payload);

    await vi.waitFor((): void => {
      expect(fixture.recordTaskResult).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: task.taskId }),
        expect.objectContaining({
          executionStatus: 'failed',
          error: expect.objectContaining({ code: 'confirmation_denied', phase: 'confirmation' })
        })
      );
      expect(fixture.enqueueTask).toHaveBeenCalledTimes(1);
      expect(fixture.dependencies.fileCommitter?.commit).not.toHaveBeenCalled();
      expect(fixture.discardRuntime).toHaveBeenCalledWith(`runtime-${task.taskId}`);
    });
  });
});
