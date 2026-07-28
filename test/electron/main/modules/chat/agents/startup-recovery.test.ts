/**
 * @file startup-recovery.test.ts
 * @description 验证 Main Child 启动恢复顺序、预算释放、Outbox eligibility 与 Renderer 重载隔离。
 */
import { readFileSync } from 'node:fs';
import type { AgentConfirmationQueue } from '../../../../../../electron/main/modules/chat/agents/confirmation-store.mjs';
import type {
  AgentCheckpointRecord,
  AgentDelegationRecoverySnapshot,
  AgentOutboxRecord,
  AgentTaskRecord
} from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { ChatMessageRecord } from 'types/chat';
import type { AgentConfirmationDecision } from 'types/chat-agent';
import { describe, expect, it, vi } from 'vitest';
import { createChildActorRegistry } from '../../../../../../electron/main/modules/chat/agents/child-registry.mjs';
import {
  createChatAgentDelegationService,
  type ChatAgentDelegationServiceDependencies,
  type ChatAgentDelegationStore
} from '../../../../../../electron/main/modules/chat/agents/service.mjs';
import { createRuntimeLockRegistry } from '../../../../../../electron/main/modules/chat/runtime/infrastructure/locks.mjs';

/** 固定恢复时间。 */
const RECOVERY_TIME = '2026-07-27T00:00:01.000Z';

/**
 * 创建启动恢复使用的活动 Checkpoint。
 * @param status - Checkpoint 状态
 * @returns 完整持久化投影
 */
function createCheckpoint(status: AgentCheckpointRecord['status'] = 'waiting_children'): AgentCheckpointRecord {
  return {
    checkpointId: 'checkpoint-recovery',
    sessionId: 'session-recovery',
    turnId: 'turn-recovery',
    primaryAgentId: 'primary',
    rootRuntimeId: 'runtime-root',
    sourceRuntimeId: 'runtime-a',
    assistantMessageId: 'assistant-recovery',
    continuationSnapshot: {
      checkpointSchemaVersion: 1,
      policyVersion: 'foundation-v1',
      modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
      continuationContextReference: 'continuation-recovery',
      continuationContextHash: 'a'.repeat(64),
      sourceMessageRevision: 'b'.repeat(64),
      toolSchemaSnapshotHash: 'c'.repeat(64),
      orderedToolCalls: [
        {
          toolCallId: 'call-recovery',
          taskId: 'task-recovery',
          required: true,
          argumentsHash: 'd'.repeat(64),
          providerMetadataHash: 'e'.repeat(64)
        }
      ],
      reservedResumeBudget: { tokenLimit: 500, costLimitUsd: 0, pricingVersion: 'unknown' },
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
 * 创建已冻结计划的 queued Child Task。
 * @returns Registry 可恢复的 Task
 */
function createTask(): AgentTaskRecord {
  return {
    taskId: 'task-recovery',
    sessionId: 'session-recovery',
    turnId: 'turn-recovery',
    agentId: 'child-recovery',
    parentAgentId: 'primary',
    rootRuntimeId: 'runtime-root',
    checkpointId: 'checkpoint-recovery',
    toolCallId: 'call-recovery',
    contractSnapshot: {
      contractSchemaVersion: 1,
      task: 'Read the recovery file',
      acceptanceCriteria: ['Return a summary'],
      mode: 'read',
      resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
      requestedTools: ['read_file'],
      required: true
    },
    contractSnapshotHash: '1'.repeat(64),
    executionPlanSnapshot: {
      planHash: '2'.repeat(64),
      planSchemaVersion: 1,
      policyVersion: 'read-runtime-v1',
      capabilitySet: ['read_file'],
      modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
      permissionSnapshot: { scopeIds: ['workspace:read'] },
      resourceScopes: ['file:/workspace/CONTEXT.md'],
      toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' }],
      commitPolicy: { mode: 'none' },
      budget: { tokenLimit: 250, costLimitUsd: 0, pricingVersion: 'unknown' }
    },
    executionPlanSnapshotHash: '2'.repeat(64),
    status: 'queued',
    queuePhase: 'start',
    priority: 'normal',
    recordState: 'active',
    unfinishedJournalCount: 0,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z'
  };
}

/**
 * 创建已生成 changeset、等待确认且没有 journal 的 write Task。
 * @returns 启动时必须撤销并中断的 write Task
 */
function createWriteTask(): AgentTaskRecord {
  const task = createTask();
  const plan = task.executionPlanSnapshot;
  if (!plan) throw new Error('Recovery write fixture requires an execution plan');
  return {
    ...task,
    currentAttemptId: 'attempt-recovery',
    contractSnapshot: {
      ...task.contractSnapshot,
      task: 'Update the recovery file',
      mode: 'write',
      requestedTools: ['read_file', 'stage_file_edit']
    },
    executionPlanSnapshot: {
      ...plan,
      policyVersion: 'controlled-write-v1',
      capabilitySet: ['read_file', 'stage_file_edit'],
      permissionSnapshot: { scopeIds: ['workspace:write'] },
      toolEffectSet: [
        { toolName: 'read_file', effect: 'pure_read' },
        { toolName: 'stage_file_edit', effect: 'staged_file_write' }
      ],
      commitPolicy: { mode: 'staged', adapter: 'atomic-file-v1' }
    },
    status: 'waiting_confirmation',
    queuePhase: undefined
  };
}

/**
 * 创建 pending delegation.created Outbox。
 * @returns 恢复交付事实
 */
function createOutbox(): AgentOutboxRecord {
  return {
    outboxId: 'outbox-recovery',
    dedupeKey: 'delegation.created:checkpoint-recovery',
    eventType: 'delegation.created',
    payload: {
      checkpointId: 'checkpoint-recovery',
      sessionId: 'session-recovery',
      turnId: 'turn-recovery'
    },
    payloadHash: '3'.repeat(64),
    schemaVersion: 1,
    deliveryStatus: 'pending',
    attemptCount: 0,
    createdAt: '2026-07-27T00:00:00.000Z',
    updatedAt: '2026-07-27T00:00:00.000Z'
  };
}

/**
 * 创建启动恢复所需的窄 Service 依赖。
 * @param initialActive - 初始活动聚合
 * @param pendingOutbox - 待恢复 Outbox
 * @returns Service 依赖与可观察调用
 */
function createDependencies(
  initialActive: AgentDelegationRecoverySnapshot[],
  pendingOutbox: AgentOutboxRecord[] = []
): {
  dependencies: ChatAgentDelegationServiceDependencies;
  interruptActive: ReturnType<typeof vi.fn>;
  releaseCheckpoint: ReturnType<typeof vi.fn>;
  dispatchInternal: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  markOutboxDelivered: ReturnType<typeof vi.fn>;
  revokeTask: ReturnType<typeof vi.fn>;
  discardWriteOverlays: ReturnType<typeof vi.fn>;
  recoveryOrder: string[];
} {
  let active = initialActive;
  let outboxes = pendingOutbox;
  const recoveryOrder: string[] = [];
  const checkpoints = new Map(initialActive.map((entry): [string, AgentCheckpointRecord] => [entry.checkpoint.checkpointId, entry.checkpoint]));
  const interruptActive = vi.fn((): number => {
    recoveryOrder.push('interrupt-unrecoverable-write-attempts');
    const interruptedCount = active.length;
    active.forEach((entry): void => {
      checkpoints.set(entry.checkpoint.checkpointId, { ...entry.checkpoint, status: 'interrupted', version: entry.checkpoint.version + 1 });
    });
    active = [];
    return interruptedCount;
  });
  const markOutboxDelivered = vi.fn((input: { outboxId: string; deliveredAt: string }): AgentOutboxRecord => {
    const current = outboxes.find((outbox): boolean => outbox.outboxId === input.outboxId);
    if (!current) throw new Error('Outbox must exist before delivery');
    const delivered: AgentOutboxRecord = {
      ...current,
      deliveryStatus: 'delivered',
      attemptCount: current.attemptCount + 1,
      deliveredAt: input.deliveredAt,
      updatedAt: input.deliveredAt
    };
    outboxes = outboxes.map((outbox): AgentOutboxRecord => (outbox.outboxId === input.outboxId ? delivered : outbox));
    return delivered;
  });
  const store: ChatAgentDelegationStore = {
    prepareDelegation: vi.fn(),
    authorizeTask: vi.fn(),
    recordPreAttemptFailure: vi.fn(),
    recordPreAttemptCancellation: vi.fn(),
    requestTaskCancellation: vi.fn(),
    recordTaskResult: vi.fn(),
    getTask: vi.fn(),
    getCheckpoint: vi.fn((checkpointId: string): AgentCheckpointRecord | null => checkpoints.get(checkpointId) ?? null),
    getOutbox: vi.fn(),
    claimResume: vi.fn(),
    finalizeResume: vi.fn(),
    cancelCheckpoint: vi.fn(),
    finalizeCancellation: vi.fn(),
    interruptCheckpoint: vi.fn(),
    interruptActive,
    listEvents: vi.fn(() => []),
    listActive: vi.fn((): AgentDelegationRecoverySnapshot[] => active),
    listCancelledCheckpoints: vi.fn((): AgentCheckpointRecord[] => []),
    listPendingOutbox: vi.fn((): AgentOutboxRecord[] => outboxes.filter((outbox): boolean => outbox.deliveryStatus === 'pending')),
    markOutboxDelivered
  };
  const releaseCheckpoint = vi.fn();
  const dispatchInternal = vi.fn(async (): Promise<void> => undefined);
  const publish = vi.fn();
  const revokeTask = vi.fn(() => {
    recoveryOrder.push('revoke-orphan-confirmations');
    return [];
  });
  const confirmationQueue: AgentConfirmationQueue = {
    request: vi.fn(async (): Promise<AgentConfirmationDecision> => ({ decision: 'rejected', version: 1 })),
    resolve: vi.fn(() => {
      throw new Error('Confirmation resolution is not part of startup recovery');
    }),
    revokeTask,
    invalidate: vi.fn(() => {
      throw new Error('Single confirmation invalidation is not part of startup recovery');
    }),
    listPending: vi.fn(() => []),
    recover: vi.fn()
  };
  const discardWriteOverlays = vi.fn(async (): Promise<void> => {
    recoveryOrder.push('discard-unjournaled-overlays');
  });
  return {
    dependencies: {
      store,
      taskProjector: {
        projectSummary: (): null => null,
        listTasks: (): { tasks: [] } => ({ tasks: [] }),
        projectDetail: (): null => null
      },
      locks: createRuntimeLockRegistry(),
      persistAssistant: (): undefined => undefined,
      readMessages: (): ChatMessageRecord[] => [],
      publishAssistant: (): void => undefined,
      publish,
      dispatchInternal,
      publishCheckpoint: (): void => undefined,
      confirmationQueue,
      discardWriteOverlays,
      createId: (kind: string, index = 1): string => `${kind}-${index}`,
      now: (): string => RECOVERY_TIME,
      budgetLedger: {
        reserveResume: vi.fn(),
        reserveTask: vi.fn(),
        settleAttempt: vi.fn(),
        releaseTask: vi.fn(),
        releaseCheckpoint,
        remainingTurnTokens: vi.fn((): number => 1_000)
      },
      startPrimaryContinuation: vi.fn()
    },
    interruptActive,
    releaseCheckpoint,
    dispatchInternal,
    publish,
    markOutboxDelivered,
    revokeTask,
    discardWriteOverlays,
    recoveryOrder
  };
}

describe('agent startup recovery', (): void => {
  it('interrupts unrecoverable work before releasing reservations and skips its stale Outbox', async (): Promise<void> => {
    const checkpoint = createCheckpoint();
    const recovery: AgentDelegationRecoverySnapshot = {
      checkpoint,
      tasks: [createTask()],
      eventSequence: 2
    };
    const fixture = createDependencies([recovery], [createOutbox()]);
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect(service.interruptUnrecoverableCheckpoints()).toBe(1);
    await service.drainOutbox();

    expect(fixture.releaseCheckpoint).toHaveBeenCalledWith(checkpoint.checkpointId);
    expect(fixture.interruptActive.mock.invocationCallOrder[0]).toBeLessThan(fixture.releaseCheckpoint.mock.invocationCallOrder[0] as number);
    expect(fixture.dispatchInternal).not.toHaveBeenCalled();
    expect(fixture.publish).not.toHaveBeenCalled();
    expect(fixture.markOutboxDelivered).not.toHaveBeenCalled();
  });

  it('revokes orphan write confirmations and discards overlays before interruption', async (): Promise<void> => {
    const checkpoint = createCheckpoint();
    const writeTask = createWriteTask();
    const fixture = createDependencies([
      {
        checkpoint,
        tasks: [writeTask],
        eventSequence: 4
      }
    ]);
    const service = createChatAgentDelegationService(fixture.dependencies);

    await expect(service.recoverInterruptedWrites()).resolves.toBe(1);

    expect(fixture.revokeTask).toHaveBeenCalledWith(writeTask.taskId, 'process_restart');
    expect(fixture.discardWriteOverlays).toHaveBeenCalledOnce();
    expect(fixture.recoveryOrder).toEqual(['revoke-orphan-confirmations', 'discard-unjournaled-overlays', 'interrupt-unrecoverable-write-attempts']);
  });

  it('replays an eligible same-process pending Outbox exactly once', async (): Promise<void> => {
    const checkpoint = createCheckpoint();
    const fixture = createDependencies(
      [
        {
          checkpoint,
          tasks: [createTask()],
          eventSequence: 2
        }
      ],
      [createOutbox()]
    );
    const service = createChatAgentDelegationService(fixture.dependencies);

    await service.drainOutbox();
    await service.drainOutbox();

    expect(fixture.dispatchInternal).toHaveBeenCalledOnce();
    expect(fixture.publish).toHaveBeenCalledOnce();
    expect(fixture.markOutboxDelivered).toHaveBeenCalledOnce();
  });

  it('keeps Main-owned Actor and Runtime bindings independent from Renderer snapshot reads', (): void => {
    const registry = createChildActorRegistry();
    const task = createTask();
    const address = {
      sessionId: task.sessionId,
      turnId: task.turnId,
      agentId: task.agentId,
      runtimeId: 'runtime-child-recovery',
      parentAgentId: task.parentAgentId,
      parentRuntimeId: 'runtime-a',
      rootRuntimeId: task.rootRuntimeId
    };
    const actor = registry.ensureActor(task);
    registry.bindRuntime(address, task.executionPlanSnapshotHash as string);

    // Renderer 重载只会重新读取公开快照；Main Registry 的稳定 Actor 和 Runtime 绑定不参与该生命周期。
    expect(registry.ensureActor(structuredClone(task))).toBe(actor);
    expect(registry.getRuntime(address.runtimeId)).toMatchObject({ taskId: task.taskId, address });
  });

  it('keeps the startup order before IPC registration and window creation', (): void => {
    const mainSource = readFileSync('electron/main/index.mts', 'utf8');
    const serviceSource = readFileSync('electron/main/modules/chat/agents/service.mts', 'utf8');
    const databaseIndex = mainSource.indexOf('await initDatabase()');
    const recoveryIndex = mainSource.indexOf('await recoverChatAgentDelegations()');
    const drainIndex = mainSource.indexOf('await chatAgentDelegationService.drainOutbox()');
    const ipcIndex = mainSource.indexOf('registerAllIpcHandlers()');
    const windowIndex = mainSource.indexOf('createWindow()', ipcIndex);
    const journalIndex = serviceSource.indexOf('await chatAgentFileCommitter.recover()');
    const confirmationIndex = serviceSource.indexOf('chatAgentConfirmationQueue.recover()', journalIndex);
    const interruptIndex = serviceSource.indexOf('await chatAgentDelegationService.recoverInterruptedWrites()', confirmationIndex);
    const coordinatorIndex = serviceSource.indexOf('await chatAgentCoordinator.recover()', interruptIndex);

    expect(databaseIndex).toBeGreaterThan(-1);
    expect(recoveryIndex).toBeGreaterThan(databaseIndex);
    expect(drainIndex).toBeGreaterThan(recoveryIndex);
    expect(ipcIndex).toBeGreaterThan(drainIndex);
    expect(windowIndex).toBeGreaterThan(ipcIndex);
    expect(journalIndex).toBeGreaterThan(-1);
    expect(confirmationIndex).toBeGreaterThan(journalIndex);
    expect(interruptIndex).toBeGreaterThan(confirmationIndex);
    expect(coordinatorIndex).toBeGreaterThan(interruptIndex);
  });
});
