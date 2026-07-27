/**
 * @file coordinator.test.ts
 * @description 验证 Main-owned Coordinator 的幂等授权、失败汇合与 Actor 注册顺序。
 */
import type { AgentCheckpointRecord, AgentDelegationRecoverySnapshot, AgentTaskRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { AgentDelegationCreatedPayload, AgentTaskError } from 'types/chat-agent';
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
  listActive: ReturnType<typeof vi.fn>;
  cancelCheckpoint: ReturnType<typeof vi.fn>;
  abortTask: ReturnType<typeof vi.fn>;
  getActor: ReturnType<typeof vi.fn>;
} {
  const checkpoint = createCheckpoint(tasks);
  const recovery: AgentDelegationRecoverySnapshot = { checkpoint, tasks, eventSequence: 2 };
  const listActive = vi.fn((): AgentDelegationRecoverySnapshot[] => [recovery]);
  const authorizeReadTask = vi.fn((taskId: string): AgentTaskRecord => {
    const task = tasks.find((entry): boolean => entry.taskId === taskId);
    if (!task) throw new Error('task_missing');
    return {
      ...task,
      executionPlanSnapshotHash: '9'.repeat(64),
      status: 'queued',
      queuePhase: 'start'
    };
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
  const enqueueTask = vi.fn();
  const cancelCheckpoint = vi.fn();
  const abortTask = vi.fn();
  const getActor = vi.fn();

  return {
    dependencies: {
      listActive,
      authorizeReadTask,
      recordPreFailure,
      enqueueTask,
      cancelCheckpoint,
      now: (): string => '2026-07-27T00:00:00.000Z',
      registry: {
        ensureActor,
        bindRuntime: vi.fn(),
        unbindRuntime: vi.fn(),
        abortTask,
        getActor,
        getRuntime: vi.fn()
      }
    },
    authorizeReadTask,
    recordPreFailure,
    ensureActor,
    enqueueTask,
    listActive,
    cancelCheckpoint,
    abortTask,
    getActor
  };
}

describe('agent coordinator', (): void => {
  it('deduplicates concurrent realtime and recovery acceptance by checkpoint ID', async (): Promise<void> => {
    const fixture = createDependencies([createTask(1)]);
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await Promise.all([coordinator.accept(payload), coordinator.recover()]);

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
    expect(fixture.enqueueTask).toHaveBeenCalledWith(tasks[1].taskId);
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('running');
  });

  it('persists cancellation before cooperatively aborting registered Child Actors', async (): Promise<void> => {
    const task = createTask(1);
    const fixture = createDependencies([task]);
    fixture.getActor.mockReturnValue({ taskId: task.taskId });
    const coordinator = createAgentCoordinator(fixture.dependencies);

    await coordinator.cancel(payload.checkpointId, 'user_cancelled');

    expect(fixture.cancelCheckpoint).toHaveBeenCalledWith(payload.checkpointId, 'user_cancelled');
    expect(fixture.abortTask).toHaveBeenCalledWith(
      task.taskId,
      expect.objectContaining({
        code: 'cancelled',
        retryable: false,
        details: { reason: 'user_cancelled' }
      })
    );
    expect(fixture.cancelCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(fixture.abortTask.mock.invocationCallOrder[0] as number);
    expect(coordinator.getCheckpointState(payload.checkpointId)).toBe('terminal');
  });
});
