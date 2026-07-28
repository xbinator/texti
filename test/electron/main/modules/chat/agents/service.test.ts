/**
 * @file service.test.ts
 * @description Child Agent 委派 prepare 边界、逻辑栅栏和恢复测试。
 */
import type { AgentCheckpointRecord, AgentTaskRecord, PrepareDelegationInput } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { ActiveChatRuntime, ChatRuntimeDelegationPrepareInput } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { ChatMessageRecord } from 'types/chat';
import type { AgentExecutionPlanSnapshot, AgentTaskError, ChatAgentApplicationEvent, ChatAgentResult, ChatAgentTaskSummarySnapshot } from 'types/chat-agent';
import { describe, expect, it, vi } from 'vitest';
import { hashExecutionPlanSnapshot } from '../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import { createChatAgentDelegationService, type ChatAgentDelegationServiceDependencies } from '../../../../../../electron/main/modules/chat/agents/service.mjs';
import { createRuntimeLockRegistry } from '../../../../../../electron/main/modules/chat/runtime/infrastructure/locks.mjs';

/**
 * 创建合法 Primary Runtime A。
 * @returns 委派测试 Runtime
 */
function createRuntime(): ActiveChatRuntime {
  return {
    sessionId: 'session-1',
    turnId: 'turn-1',
    agentId: 'primary',
    runtimeId: 'runtime-a',
    rootRuntimeId: 'runtime-a',
    clientId: 'bchat',
    contextWindow: 128_000,
    system: '只保存允许的续接上下文',
    workspaceRoot: '/workspace',
    tools: [{ name: 'delegate_task', description: 'delegate', parameters: { type: 'object' } }],
    runtimeContext: {
      skill: {
        targetMessageId: 'user-1',
        snapshots: [{ name: 'skill-a', content: 'approved skill prompt', contentHash: 'hash-a', filePath: '.agents/skills/skill-a/SKILL.md' }]
      }
    },
    resolvedModel: {
      createOptions: {
        providerId: 'provider-1',
        providerName: 'Provider',
        providerType: 'openai',
        apiKey: 'must-not-persist',
        baseUrl: 'https://example.com'
      },
      modelId: 'model-1'
    },
    status: 'running',
    phase: 'streaming',
    abortController: new AbortController(),
    createdAt: Date.parse('2026-07-23T00:00:00.000Z'),
    taskPausedDurationMs: 20_000
  };
}

/**
 * 创建含完整原始委派调用的 assistant。
 * @param mode - Task 模式
 * @returns assistant 快照
 */
function createAssistant(mode: 'read' | 'write' = 'read'): ChatMessageRecord {
  return {
    id: 'assistant-1',
    sessionId: 'session-1',
    role: 'assistant',
    content: '',
    parts: [
      {
        id: 'part-1',
        type: 'tool',
        toolCallId: 'call-1',
        toolName: 'delegate_task',
        status: 'executing',
        input: {
          task: '读取方案',
          acceptanceCriteria: ['返回摘要'],
          mode,
          resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
          requestedTools: mode === 'write' ? ['read_file', 'stage_file_edit'] : ['read_file'],
          required: true,
          priority: 'normal'
        }
      }
    ],
    loading: true,
    finished: false,
    parentRuntimeId: undefined,
    createdAt: '2026-07-23T00:00:00.000Z'
  };
}

/**
 * 创建 Runtime 交给 Coordinator 的 prepare 输入。
 * @param mode - Task 模式
 * @returns prepare 输入
 */
function createInput(mode: 'read' | 'write' = 'read'): ChatRuntimeDelegationPrepareInput {
  const assistantMessage = createAssistant(mode);
  return {
    checkpointId: 'checkpoint-1',
    runtime: createRuntime(),
    assistantMessage,
    suspension: {
      toolCalls: [
        {
          toolCallId: 'call-1',
          toolName: 'delegate_task',
          input: assistantMessage.parts[0]?.type === 'tool' ? assistantMessage.parts[0].input : null,
          argumentsHash: 'a'.repeat(64)
        }
      ]
    }
  };
}

/**
 * 创建可由主进程重新推导 completion 的 Child 结果。
 * @returns 含不可信 completion level 的结果
 */
function createTaskResult(): ChatAgentResult {
  return {
    taskId: 'task-1',
    agentId: 'child-1',
    attemptId: 'attempt-1',
    executionStatus: 'completed',
    completion: {
      level: 'full',
      criteria: [
        {
          criterionIndex: 0,
          claim: {
            status: 'satisfied',
            summary: 'Found a partial answer.',
            evidence: [{ kind: 'resource_snapshot', referenceId: 'CONTEXT.md' }]
          },
          verification: {
            status: 'contradicted',
            verifier: 'coordinator',
            evidence: [{ kind: 'task_result', referenceId: 'task-1' }]
          }
        }
      ]
    },
    summary: 'Inspected the context.',
    warnings: [],
    artifacts: [],
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      modelCalls: 1,
      toolRounds: 1,
      queueDurationMs: 2,
      executionDurationMs: 10,
      externalRequests: 0,
      monetaryCost: {
        currency: 'unknown',
        pricingVersion: 'unknown',
        estimated: 'unknown',
        actual: 'unknown'
      }
    }
  };
}

/**
 * 创建窄 Store 测试替身。
 * @returns Store mock 与依赖
 */
function createDependencies(): {
  dependencies: ChatAgentDelegationServiceDependencies;
  prepareDelegation: ReturnType<typeof vi.fn>;
  authorizeTask: ReturnType<typeof vi.fn>;
  interruptCheckpoint: ReturnType<typeof vi.fn>;
  interruptActive: ReturnType<typeof vi.fn>;
  markOutboxDelivered: ReturnType<typeof vi.fn>;
  listActive: ReturnType<typeof vi.fn>;
  getTask: ReturnType<typeof vi.fn>;
  getCheckpoint: ReturnType<typeof vi.fn>;
  getOutbox: ReturnType<typeof vi.fn>;
  recordPreAttemptFailure: ReturnType<typeof vi.fn>;
  recordPreAttemptCancellation: ReturnType<typeof vi.fn>;
  requestTaskCancellation: ReturnType<typeof vi.fn>;
  recordTaskResult: ReturnType<typeof vi.fn>;
  claimResume: ReturnType<typeof vi.fn>;
  finalizeResume: ReturnType<typeof vi.fn>;
  cancelCheckpoint: ReturnType<typeof vi.fn>;
  finalizeCancellation: ReturnType<typeof vi.fn>;
  listCancelledCheckpoints: ReturnType<typeof vi.fn>;
  listConfirmations: ReturnType<typeof vi.fn>;
  resolveConfirmation: ReturnType<typeof vi.fn>;
  revokeTaskConfirmations: ReturnType<typeof vi.fn>;
  listEvents: ReturnType<typeof vi.fn>;
  listPendingOutbox: ReturnType<typeof vi.fn>;
  startPrimaryContinuation: ReturnType<typeof vi.fn>;
  persistAssistant: ReturnType<typeof vi.fn>;
  readMessages: ReturnType<typeof vi.fn>;
  publishAssistant: ReturnType<typeof vi.fn>;
  publishCheckpoint: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  resolveReadLimits: ReturnType<typeof vi.fn>;
  compileReadPlan: ReturnType<typeof vi.fn>;
  reserveTask: ReturnType<typeof vi.fn>;
  releaseBudget: ReturnType<typeof vi.fn>;
  releaseCheckpoint: ReturnType<typeof vi.fn>;
  projectTasks: ReturnType<typeof vi.fn>;
  projectDetail: ReturnType<typeof vi.fn>;
  projectSummary: ReturnType<typeof vi.fn>;
  cancelTaskExecution: ReturnType<typeof vi.fn>;
  cancelCheckpointExecution: ReturnType<typeof vi.fn>;
} {
  const prepareDelegation = vi.fn((_input, persistAssistant: () => undefined): void => {
    persistAssistant();
  });
  const interruptCheckpoint = vi.fn();
  const authorizeTask = vi.fn();
  const interruptActive = vi.fn((): number => 0);
  const markOutboxDelivered = vi.fn();
  const listActive = vi.fn(() => []);
  const getTask = vi.fn();
  const getCheckpoint = vi.fn();
  const getOutbox = vi.fn();
  const recordPreAttemptFailure = vi.fn();
  const recordPreAttemptCancellation = vi.fn();
  const requestTaskCancellation = vi.fn();
  const recordTaskResult = vi.fn();
  const claimResume = vi.fn();
  const finalizeResume = vi.fn();
  const cancelCheckpoint = vi.fn();
  const finalizeCancellation = vi.fn((input: { checkpointId: string; finalizedAt: string }): AgentCheckpointRecord => {
    const checkpoint = getCheckpoint(input.checkpointId);
    if (!checkpoint) throw new Error('Cancellation checkpoint must exist');
    const finalized = { ...checkpoint, status: 'cancelled' as const, cancellationFinalizedAt: input.finalizedAt };
    getCheckpoint.mockReturnValue(finalized);
    cancelCheckpoint.mockReturnValue(finalized);
    return finalized;
  });
  const listCancelledCheckpoints = vi.fn((): AgentCheckpointRecord[] => []);
  const listConfirmations = vi.fn(() => []);
  const resolveConfirmation = vi.fn();
  const revokeTaskConfirmations = vi.fn(() => []);
  const listEvents = vi.fn(() => []);
  const listPendingOutbox = vi.fn(() => []);
  const startPrimaryContinuation = vi.fn();
  const persistAssistant = vi.fn((): undefined => undefined);
  const readMessages = vi.fn(() => [] as ChatMessageRecord[]);
  const publishAssistant = vi.fn();
  const publishCheckpoint = vi.fn();
  const publish = vi.fn();
  const resolveReadLimits = vi.fn(() => ({
    availableToolNames: ['read_file'],
    permissionScopeIds: ['workspace:read'],
    budget: { tokenLimit: 800, costLimitUsd: 0.08, pricingVersion: 'test-v1' }
  }));
  const compileReadPlan = vi.fn();
  const reserveTask = vi.fn();
  const releaseBudget = vi.fn();
  const releaseCheckpoint = vi.fn();
  const projectTasks = vi.fn(() => ({ tasks: [] }));
  const projectDetail = vi.fn(() => null);
  const projectSummary = vi.fn(() => null);
  const cancelTaskExecution = vi.fn(async (): Promise<'cancel_requested'> => 'cancel_requested');
  const cancelCheckpointExecution = vi.fn(async (): Promise<void> => undefined);
  getCheckpoint.mockImplementation((checkpointId: string): AgentCheckpointRecord | null => {
    const preparedInput = prepareDelegation.mock.calls.at(-1)?.[0];
    if (!preparedInput || preparedInput.checkpoint.checkpointId !== checkpointId) return null;
    return {
      ...preparedInput.checkpoint,
      status: 'waiting_children',
      version: 1,
      terminalResults: {},
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: preparedInput.occurredAt
    };
  });
  getOutbox.mockImplementation((dedupeKey: string) => {
    const preparedInput = prepareDelegation.mock.calls.at(-1)?.[0] as PrepareDelegationInput | undefined;
    if (!preparedInput || preparedInput.outbox.dedupeKey !== dedupeKey) return null;
    return {
      ...preparedInput.outbox,
      deliveryStatus: 'pending' as const,
      attemptCount: 0,
      createdAt: preparedInput.occurredAt,
      updatedAt: preparedInput.occurredAt
    };
  });
  return {
    dependencies: {
      store: {
        prepareDelegation,
        authorizeTask,
        interruptCheckpoint,
        interruptActive,
        markOutboxDelivered,
        listActive,
        getTask,
        getCheckpoint,
        getOutbox,
        recordPreAttemptFailure,
        recordPreAttemptCancellation,
        requestTaskCancellation,
        recordTaskResult,
        claimResume,
        finalizeResume,
        cancelCheckpoint,
        finalizeCancellation,
        listCancelledCheckpoints,
        listEvents,
        listPendingOutbox
      },
      taskProjector: {
        projectSummary,
        listTasks: projectTasks,
        projectDetail
      },
      locks: createRuntimeLockRegistry(),
      persistAssistant,
      readMessages,
      publishAssistant,
      publish,
      publishCheckpoint,
      confirmationQueue: {
        request: vi.fn(),
        resolve: resolveConfirmation,
        revokeTask: revokeTaskConfirmations,
        invalidate: vi.fn(),
        listPending: listConfirmations,
        recover: vi.fn()
      },
      featureConfig: {
        enabled: true,
        pureReadChildEnabled: true,
        controlledWriteChildEnabled: true,
        maxParallelReadChildren: 3
      },
      createId: (kind, index): string => `${kind}-${index ?? 1}`,
      now: (): string => '2026-07-23T00:00:01.000Z',
      resolveReadLimits,
      compileReadPlan,
      budgetLedger: {
        reserveResume: vi.fn(),
        reserveTask,
        settleAttempt: vi.fn(),
        releaseTask: releaseBudget,
        releaseCheckpoint,
        remainingTurnTokens: vi.fn((): number => 10_000)
      },
      startPrimaryContinuation,
      cancelTaskExecution,
      cancelCheckpointExecution
    },
    prepareDelegation,
    authorizeTask,
    interruptCheckpoint,
    interruptActive,
    markOutboxDelivered,
    listActive,
    getTask,
    getCheckpoint,
    getOutbox,
    recordPreAttemptFailure,
    recordPreAttemptCancellation,
    requestTaskCancellation,
    recordTaskResult,
    claimResume,
    finalizeResume,
    cancelCheckpoint,
    finalizeCancellation,
    listCancelledCheckpoints,
    listConfirmations,
    resolveConfirmation,
    revokeTaskConfirmations,
    listEvents,
    listPendingOutbox,
    startPrimaryContinuation,
    persistAssistant,
    readMessages,
    publishAssistant,
    publishCheckpoint,
    publish,
    resolveReadLimits,
    compileReadPlan,
    reserveTask,
    releaseBudget,
    releaseCheckpoint,
    projectTasks,
    projectDetail,
    projectSummary,
    cancelTaskExecution,
    cancelCheckpointExecution
  };
}

/**
 * 从 prepare 调用构造 Store 当前 Task 投影。
 * @param input - 已提交委派事实
 * @returns created Task
 */
function createPreparedTask(input: PrepareDelegationInput): AgentTaskRecord {
  const task = input.tasks[0];
  if (!task) throw new Error('Prepared fixture must contain one Task');
  return {
    ...task,
    status: 'created',
    recordState: 'active',
    unfinishedJournalCount: 0,
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt
  };
}

/**
 * 创建 Service 取消命令使用的公开 Task Summary。
 * @param patch - 可覆盖的状态、序列或取消事实
 * @returns 完整公开 Summary
 */
function createTaskSummary(patch: Partial<ChatAgentTaskSummarySnapshot> = {}): ChatAgentTaskSummarySnapshot {
  return {
    recordState: 'active',
    taskId: 'task-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    checkpointId: 'checkpoint-1',
    assistantMessageId: 'assistant-1',
    toolCallId: 'call-1',
    agentId: 'child-1',
    projectionSchemaVersion: 1,
    taskSequence: 4,
    task: '读取方案',
    mode: 'read',
    required: true,
    priority: 'normal',
    status: 'running',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:01.000Z',
    ...patch
  };
}

/**
 * 创建与 prepared Task 绑定的已 hash 只读计划。
 * @param task - created Task
 * @param checkpoint - 冻结模型来源
 * @returns 可交给 Store 的计划
 */
function createReadPlan(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord): AgentExecutionPlanSnapshot {
  const planBody = {
    planSchemaVersion: 1,
    policyVersion: 'read-runtime-v1',
    capabilitySet: ['read_file'],
    modelSnapshot: { ...checkpoint.continuationSnapshot.modelSnapshot },
    permissionSnapshot: { scopeIds: ['workspace:read'] },
    resourceScopes: ['file:/workspace/CONTEXT.md'],
    toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' as const }],
    commitPolicy: { mode: 'none' as const },
    budget: { tokenLimit: 800, costLimitUsd: 0.08, pricingVersion: 'test-v1' }
  };
  return {
    ...planBody,
    planHash: hashExecutionPlanSnapshot(task.contractSnapshot, planBody)
  };
}

/**
 * 创建与 prepared write Task 绑定的暂存计划。
 * @param task - created write Task
 * @param checkpoint - 冻结模型来源
 * @returns 可交给 Store 的暂存计划
 */
function createWritePlan(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord): AgentExecutionPlanSnapshot {
  const planBody = {
    planSchemaVersion: 1,
    policyVersion: 'controlled-write-v1',
    capabilitySet: ['read_file', 'stage_file_edit'],
    modelSnapshot: { ...checkpoint.continuationSnapshot.modelSnapshot },
    permissionSnapshot: { scopeIds: ['workspace:write'] },
    resourceScopes: ['file:/workspace/CONTEXT.md'],
    toolEffectSet: [
      { toolName: 'read_file', effect: 'pure_read' as const },
      { toolName: 'stage_file_edit', effect: 'staged_file_write' as const }
    ],
    commitPolicy: { mode: 'staged' as const, adapter: 'atomic-file-v1' },
    budget: { tokenLimit: 800, costLimitUsd: 0.08, pricingVersion: 'test-v1' }
  };
  return {
    ...planBody,
    planHash: hashExecutionPlanSnapshot(task.contractSnapshot, planBody)
  };
}

describe('chat agent delegation service', (): void => {
  it('forwards Task list and Session-bound detail queries through the required projector', (): void => {
    const fixture = createDependencies();
    const tombstone = {
      recordState: 'tombstoned' as const,
      taskId: 'task-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      checkpointId: 'checkpoint-1',
      assistantMessageId: 'assistant-1',
      toolCallId: 'tool-call-1',
      projectionSchemaVersion: 1 as const,
      taskSequence: 9,
      updatedAt: '2026-07-28T00:00:00.000Z'
    };
    fixture.projectTasks.mockReturnValue({ tasks: [], nextCursor: 'cursor-2' });
    fixture.projectDetail.mockImplementation((sessionId: string): typeof tombstone | null => (sessionId === 'session-1' ? tombstone : null));
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect(service.listTasks({ sessionId: 'session-1', cursor: 'cursor-1', limit: 25 })).toEqual({ tasks: [], nextCursor: 'cursor-2' });
    expect(fixture.projectTasks).toHaveBeenCalledWith({ sessionId: 'session-1', cursor: 'cursor-1', limit: 25 });
    expect(service.getTask({ sessionId: 'session-1', taskId: 'task-1' })).toEqual(tombstone);
    expect(service.getTask({ sessionId: 'session-wrong', taskId: 'task-1' })).toBeNull();
    expect(fixture.projectDetail).toHaveBeenNthCalledWith(1, 'session-1', 'task-1');
    expect(fixture.projectDetail).toHaveBeenNthCalledWith(2, 'session-wrong', 'task-1');
  });

  it('returns only the authoritative reprojected Summary after Session-bound Task cancellation', async (): Promise<void> => {
    const fixture = createDependencies();
    const baseline = createTaskSummary();
    const cancelled = createTaskSummary({
      taskSequence: 7,
      status: 'cancelled',
      cancellation: {
        requestKind: 'single_task',
        requestedAt: '2026-07-23T00:00:02.000Z'
      },
      updatedAt: '2026-07-23T00:00:03.000Z'
    });
    fixture.projectSummary.mockReturnValueOnce(baseline).mockReturnValueOnce(cancelled);
    fixture.cancelTaskExecution.mockResolvedValue('cancel_requested');
    const service = createChatAgentDelegationService(fixture.dependencies);

    await expect(service.cancelTask({ sessionId: 'session-1', taskId: 'task-1' })).resolves.toEqual({
      disposition: 'cancel_requested',
      task: cancelled
    });
    expect(fixture.cancelTaskExecution).toHaveBeenCalledWith('task-1');
    expect(fixture.projectDetail).not.toHaveBeenCalled();
  });

  it('hides missing and wrong-Session Tasks behind the same not-found error without calling Coordinator', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    fixture.projectSummary.mockReturnValueOnce(null).mockReturnValueOnce(createTaskSummary());

    const missing = service.cancelTask({ sessionId: 'session-1', taskId: 'task-missing' });
    const wrongSession = service.cancelTask({ sessionId: 'session-wrong', taskId: 'task-1' });

    await expect(missing).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'agent_task_not_found' });
    await expect(wrongSession).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'agent_task_not_found' });
    expect(fixture.cancelTaskExecution).not.toHaveBeenCalled();
  });

  it('commits immutable facts before acquiring the fence and publishing the outbox', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect(service.prepareDelegation(createInput())).toEqual({ prepared: true });

    expect(fixture.prepareDelegation).toHaveBeenCalledOnce();
    expect(fixture.persistAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [expect.objectContaining({ toolCallId: 'call-1' })]
      })
    );
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    expect(preparedInput).toMatchObject({
      tasks: [
        {
          taskId: 'task-1',
          agentId: 'child-1',
          checkpointId: 'checkpoint-1',
          toolCallId: 'call-1',
          contractSnapshot: { mode: 'read' }
        }
      ],
      checkpoint: {
        checkpointId: 'checkpoint-1',
        continuationSnapshot: {
          modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
          orderedToolCalls: [
            {
              toolCallId: 'call-1',
              taskId: 'task-1',
              providerMetadataHash: expect.stringMatching(/^[a-f0-9]{64}$/)
            }
          ],
          reservedResumeBudget: {
            tokenLimit: expect.any(Number),
            costLimitUsd: 0,
            pricingVersion: 'unknown'
          },
          absoluteTurnDeadline: '2026-07-23T00:05:20.000Z'
        }
      },
      outbox: {
        outboxId: 'outbox-1',
        eventType: 'delegation.created'
      }
    });
    await vi.waitFor((): void => {
      expect(fixture.publish).toHaveBeenCalledOnce();
      expect(fixture.markOutboxDelivered).toHaveBeenCalledOnce();
    });
    expect(fixture.prepareDelegation.mock.invocationCallOrder[0]).toBeLessThan(fixture.publish.mock.invocationCallOrder[0]);
    expect(fixture.publish).toHaveBeenCalledWith(
      'delegation.created',
      expect.objectContaining({ checkpointId: 'checkpoint-1', sessionId: 'session-1', turnId: 'turn-1' })
    );
    expect(fixture.markOutboxDelivered).toHaveBeenCalledWith({
      outboxId: 'outbox-1',
      deliveredAt: '2026-07-23T00:00:01.000Z'
    });
    expect(service.getContinuationContext('checkpoint-1')).toEqual(
      expect.not.objectContaining({
        apiKey: expect.anything(),
        tavily: expect.anything(),
        mcp: expect.anything()
      })
    );
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toEqual({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-1'
    });
  });

  it('delivers the mandatory Main consumer before Renderer projection and Outbox acknowledgement', async (): Promise<void> => {
    const fixture = createDependencies();
    const dispatchInternal = vi.fn(async (): Promise<void> => undefined);
    fixture.dependencies.dispatchInternal = dispatchInternal;
    const service = createChatAgentDelegationService(fixture.dependencies);

    service.prepareDelegation(createInput());

    await vi.waitFor((): void => {
      expect(fixture.markOutboxDelivered).toHaveBeenCalledOnce();
    });
    expect(dispatchInternal).toHaveBeenCalledWith('delegation.created', expect.objectContaining({ checkpointId: 'checkpoint-1' }));
    expect(dispatchInternal.mock.invocationCallOrder[0]).toBeLessThan(fixture.publish.mock.invocationCallOrder[0] as number);
    expect(fixture.publish.mock.invocationCallOrder[0]).toBeLessThan(fixture.markOutboxDelivered.mock.invocationCallOrder[0] as number);
  });

  it('keeps Outbox pending when the mandatory Main consumer rejects delivery', async (): Promise<void> => {
    const fixture = createDependencies();
    const dispatchInternal = vi.fn(async (): Promise<void> => {
      throw new Error('coordinator_rejected');
    });
    fixture.dependencies.dispatchInternal = dispatchInternal;
    const service = createChatAgentDelegationService(fixture.dependencies);

    service.prepareDelegation(createInput());

    await vi.waitFor((): void => {
      expect(dispatchInternal).toHaveBeenCalledOnce();
    });
    await Promise.resolve();
    expect(fixture.publish).not.toHaveBeenCalled();
    expect(fixture.markOutboxDelivered).not.toHaveBeenCalled();
  });

  it('rechecks created Outbox eligibility after the async Main consumer returns', async (): Promise<void> => {
    const fixture = createDependencies();
    let releaseDispatch: () => void = (): void => undefined;
    const dispatchInternal = vi.fn(
      (): Promise<void> =>
        new Promise<void>((resolve): void => {
          releaseDispatch = resolve;
        })
    );
    fixture.dependencies.dispatchInternal = dispatchInternal;
    const service = createChatAgentDelegationService(fixture.dependencies);

    service.prepareDelegation(createInput());
    await vi.waitFor((): void => {
      expect(dispatchInternal).toHaveBeenCalledOnce();
    });
    const prepared = fixture.prepareDelegation.mock.calls[0]?.[0] as PrepareDelegationInput | undefined;
    if (!prepared) throw new Error('Created Outbox race requires prepared facts');
    fixture.getCheckpoint.mockReturnValue({
      ...prepared.checkpoint,
      status: 'interrupted',
      version: 2,
      terminalResults: {},
      recordState: 'active',
      createdAt: prepared.occurredAt,
      updatedAt: prepared.occurredAt
    });

    releaseDispatch();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.publish).not.toHaveBeenCalled();
    expect(fixture.markOutboxDelivered).not.toHaveBeenCalled();
  });

  it('compiles trusted read limits and atomically authorizes one prepared Task', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    const input = createInput();
    input.runtime.tools = [...(input.runtime.tools ?? []), { name: 'read_file', description: 'read a file', parameters: { type: 'object' } }];
    service.prepareDelegation(input);
    const prepared = fixture.prepareDelegation.mock.calls[0]?.[0] as PrepareDelegationInput | undefined;
    if (!prepared) throw new Error('Prepare facts must be captured');
    const task = createPreparedTask(prepared);
    const checkpoint: AgentCheckpointRecord = {
      ...prepared.checkpoint,
      status: 'waiting_children',
      version: 1,
      terminalResults: {},
      recordState: 'active',
      createdAt: prepared.occurredAt,
      updatedAt: prepared.occurredAt
    };
    const plan = createReadPlan(task, checkpoint);
    const queuedTask: AgentTaskRecord = {
      ...task,
      executionPlanSnapshot: plan,
      executionPlanSnapshotHash: plan.planHash,
      status: 'queued',
      queuePhase: 'start'
    };
    fixture.getTask.mockReturnValue(task);
    fixture.compileReadPlan.mockReturnValue({ ok: true, plan });
    fixture.authorizeTask.mockReturnValue(queuedTask);

    const result = service.authorizeTask(task.taskId);

    expect(fixture.resolveReadLimits).toHaveBeenCalledWith(task, checkpoint, expect.objectContaining({ workspaceRoot: '/workspace' }));
    expect(fixture.compileReadPlan).toHaveBeenCalledWith({
      task,
      checkpoint,
      parentToolNames: ['delegate_task', 'read_file'],
      availableToolNames: ['read_file'],
      permissionScopeIds: ['workspace:read'],
      workspaceRoot: '/workspace',
      budget: { tokenLimit: 800, costLimitUsd: 0.08, pricingVersion: 'test-v1' }
    });
    expect(fixture.authorizeTask).toHaveBeenCalledWith({
      taskId: task.taskId,
      executionPlanSnapshot: plan,
      executionPlanSnapshotHash: plan.planHash,
      occurredAt: '2026-07-23T00:00:01.000Z',
      source: 'coordinator'
    });
    expect(fixture.reserveTask).toHaveBeenCalledWith(task.taskId, plan.budget);
    expect(fixture.reserveTask.mock.invocationCallOrder[0]).toBeLessThan(fixture.authorizeTask.mock.invocationCallOrder[0] as number);
    expect(fixture.releaseBudget).not.toHaveBeenCalled();
    expect(result).toBe(queuedTask);
  });

  it('authorizes a prepared write Task only when the Main-owned controlled-write gate is enabled', (): void => {
    const fixture = createDependencies();
    fixture.resolveReadLimits.mockReturnValue({
      availableToolNames: ['read_file', 'stage_file_edit'],
      permissionScopeIds: ['workspace:write'],
      budget: { tokenLimit: 800, costLimitUsd: 0.08, pricingVersion: 'test-v1' }
    });
    const service = createChatAgentDelegationService(fixture.dependencies);
    const input = createInput('write');
    input.runtime.tools = [
      ...(input.runtime.tools ?? []),
      { name: 'read_file', description: 'read a file', parameters: { type: 'object' } },
      { name: 'stage_file_edit', description: 'stage an edit', parameters: { type: 'object' } }
    ];
    service.prepareDelegation(input);
    const prepared = fixture.prepareDelegation.mock.calls[0]?.[0] as PrepareDelegationInput | undefined;
    if (!prepared) throw new Error('Prepare facts must be captured');
    const task = createPreparedTask(prepared);
    const checkpoint: AgentCheckpointRecord = {
      ...prepared.checkpoint,
      status: 'waiting_children',
      version: 1,
      terminalResults: {},
      recordState: 'active',
      createdAt: prepared.occurredAt,
      updatedAt: prepared.occurredAt
    };
    const plan = createWritePlan(task, checkpoint);
    const queuedTask: AgentTaskRecord = {
      ...task,
      executionPlanSnapshot: plan,
      executionPlanSnapshotHash: plan.planHash,
      status: 'queued',
      queuePhase: 'start'
    };
    fixture.getTask.mockReturnValue(task);
    fixture.compileReadPlan.mockReturnValue({ ok: true, plan });
    fixture.authorizeTask.mockReturnValue(queuedTask);

    expect(service.authorizeTask(task.taskId)).toBe(queuedTask);
  });

  it('rejects a write Task before plan compilation when the controlled-write gate is disabled', (): void => {
    const fixture = createDependencies();
    fixture.dependencies.featureConfig = {
      enabled: true,
      pureReadChildEnabled: true,
      controlledWriteChildEnabled: false,
      maxParallelReadChildren: 3
    };
    const service = createChatAgentDelegationService(fixture.dependencies);
    const input = createInput('write');
    service.prepareDelegation(input);
    const prepared = fixture.prepareDelegation.mock.calls[0]?.[0] as PrepareDelegationInput | undefined;
    if (!prepared) throw new Error('Prepare facts must be captured');
    const task = createPreparedTask(prepared);
    fixture.getTask.mockReturnValue(task);

    expect((): void => {
      service.authorizeTask(task.taskId);
    }).toThrowError(
      expect.objectContaining({
        code: 'capability_denied',
        phase: 'plan_validation',
        details: expect.objectContaining({ reason: 'controlled_write_child_disabled' })
      })
    );
    expect(fixture.compileReadPlan).not.toHaveBeenCalled();
    expect(fixture.authorizeTask).not.toHaveBeenCalled();
  });

  it('releases a Task reservation when the Store cannot freeze the authorized projection', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    const input = createInput();
    input.runtime.tools = [...(input.runtime.tools ?? []), { name: 'read_file', description: 'read a file', parameters: { type: 'object' } }];
    service.prepareDelegation(input);
    const prepared = fixture.prepareDelegation.mock.calls[0]?.[0] as PrepareDelegationInput | undefined;
    if (!prepared) throw new Error('Prepare facts must be captured');
    const task = createPreparedTask(prepared);
    const checkpoint: AgentCheckpointRecord = {
      ...prepared.checkpoint,
      status: 'waiting_children',
      version: 1,
      terminalResults: {},
      recordState: 'active',
      createdAt: prepared.occurredAt,
      updatedAt: prepared.occurredAt
    };
    const plan = createReadPlan(task, checkpoint);
    fixture.getTask.mockReturnValue(task);
    fixture.compileReadPlan.mockReturnValue({ ok: true, plan });
    fixture.authorizeTask.mockImplementationOnce((): never => {
      throw new Error('authorization_write_failed');
    });

    expect((): void => {
      service.authorizeTask(task.taskId);
    }).toThrowError('authorization_write_failed');

    expect(fixture.reserveTask).toHaveBeenCalledWith(task.taskId, plan.budget);
    expect(fixture.releaseBudget).toHaveBeenCalledWith(task.taskId);
  });

  it('leaves a Task created when plan compilation fails before the Store boundary', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    const input = createInput();
    input.runtime.tools = [...(input.runtime.tools ?? []), { name: 'read_file', description: 'read a file', parameters: { type: 'object' } }];
    service.prepareDelegation(input);
    const prepared = fixture.prepareDelegation.mock.calls[0]?.[0] as PrepareDelegationInput | undefined;
    if (!prepared) throw new Error('Prepare facts must be captured');
    const task = createPreparedTask(prepared);
    fixture.getTask.mockReturnValue(task);
    fixture.compileReadPlan.mockReturnValue({
      ok: false,
      error: {
        code: 'capability_denied',
        phase: 'plan_validation',
        category: 'policy',
        retryable: false,
        details: { reason: 'plan_capability_empty' }
      }
    });

    expect((): void => {
      service.authorizeTask(task.taskId);
    }).toThrowError(expect.objectContaining({ code: 'capability_denied', phase: 'plan_validation' }));
    expect(fixture.authorizeTask).not.toHaveBeenCalled();
    expect(task.status).toBe('created');
  });

  it('keeps an unconfigured service fail-closed until trusted budget and permission limits are injected', (): void => {
    const fixture = createDependencies();
    delete fixture.dependencies.resolveReadLimits;
    const service = createChatAgentDelegationService(fixture.dependencies);
    const input = createInput();
    input.runtime.tools = [...(input.runtime.tools ?? []), { name: 'read_file', description: 'read a file', parameters: { type: 'object' } }];
    service.prepareDelegation(input);
    const prepared = fixture.prepareDelegation.mock.calls[0]?.[0] as PrepareDelegationInput | undefined;
    if (!prepared) throw new Error('Prepare facts must be captured');
    const task = createPreparedTask(prepared);
    fixture.getTask.mockReturnValue(task);

    expect((): void => {
      service.authorizeTask(task.taskId);
    }).toThrowError(
      expect.objectContaining({
        code: 'capability_denied',
        details: expect.objectContaining({ reason: 'plan_budget_allocator_unavailable' })
      })
    );
    expect(fixture.compileReadPlan).not.toHaveBeenCalled();
    expect(fixture.authorizeTask).not.toHaveBeenCalled();
  });

  it('normalizes a Child result, computes its canonical hash, and publishes the persisted ready outbox', async (): Promise<void> => {
    const fixture = createDependencies();
    const prepared = createInput();
    const contractValidation = prepared.suspension.toolCalls[0];
    if (!contractValidation) throw new Error('Task fixture must contain one deferred call');
    const task: AgentTaskRecord = {
      taskId: 'task-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      agentId: 'child-1',
      parentAgentId: 'primary',
      rootRuntimeId: 'runtime-a',
      checkpointId: 'checkpoint-1',
      toolCallId: 'call-1',
      contractSnapshot: {
        contractSchemaVersion: 1,
        task: '读取方案',
        acceptanceCriteria: ['返回摘要'],
        mode: 'read',
        resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
        requestedTools: ['read_file'],
        required: true
      },
      contractSnapshotHash: 'a'.repeat(64),
      executionPlanSnapshot: {
        planHash: 'b'.repeat(64),
        planSchemaVersion: 1,
        policyVersion: 'read-runtime-v1',
        capabilitySet: ['read_file'],
        modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
        permissionSnapshot: { scopeIds: ['workspace-read'] },
        resourceScopes: ['file:CONTEXT.md'],
        toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' }],
        commitPolicy: { mode: 'none' },
        budget: { tokenLimit: 100, costLimitUsd: 0, pricingVersion: 'unknown' }
      },
      executionPlanSnapshotHash: 'b'.repeat(64),
      status: 'running',
      priority: 'normal',
      currentAttemptId: 'attempt-1',
      recordState: 'active',
      unfinishedJournalCount: 0,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:00.000Z'
    };
    const checkpoint = {
      checkpointId: 'checkpoint-1',
      status: 'ready_to_resume',
      version: 2
    } as AgentCheckpointRecord;
    fixture.getTask.mockReturnValue(task);
    fixture.getCheckpoint.mockReturnValue({ ...checkpoint, recordState: 'active' });
    fixture.recordTaskResult.mockReturnValue(checkpoint);
    const readyOutbox = {
      outboxId: 'outbox-ready-checkpoint-1',
      dedupeKey: 'delegation.ready:checkpoint-1',
      eventType: 'delegation.ready' as const,
      payload: {
        checkpointId: 'checkpoint-1',
        sessionId: 'session-1',
        turnId: 'turn-1',
        resultCount: 1
      },
      payloadHash: 'c'.repeat(64),
      schemaVersion: 1,
      deliveryStatus: 'pending' as const,
      attemptCount: 0,
      createdAt: '2026-07-23T00:00:01.000Z',
      updatedAt: '2026-07-23T00:00:01.000Z'
    };
    fixture.getOutbox.mockReturnValue(readyOutbox);
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect(
      service.recordTaskResult({
        taskId: 'task-1',
        checkpointId: 'checkpoint-1',
        toolCallId: 'call-1',
        result: createTaskResult()
      })
    ).toBe(checkpoint);

    expect(fixture.recordTaskResult).toHaveBeenCalledWith({
      taskId: 'task-1',
      checkpointId: 'checkpoint-1',
      toolCallId: 'call-1',
      result: expect.objectContaining({
        completion: { level: 'none', criteria: expect.any(Array) },
        warnings: [{ code: 'completion_level_corrected', message: expect.any(String) }]
      }),
      resultHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      occurredAt: '2026-07-23T00:00:01.000Z'
    });
    await vi.waitFor((): void => {
      expect(fixture.publish).toHaveBeenCalledWith('delegation.ready', expect.objectContaining({ checkpointId: 'checkpoint-1', resultCount: 1 }));
      expect(fixture.markOutboxDelivered).toHaveBeenCalledOnce();
    });
    expect(fixture.markOutboxDelivered).toHaveBeenCalledWith({
      outboxId: 'outbox-ready-checkpoint-1',
      deliveredAt: '2026-07-23T00:00:01.000Z'
    });

    fixture.publish.mockClear();
    fixture.markOutboxDelivered.mockClear();
    fixture.getOutbox.mockReturnValue({
      ...readyOutbox,
      deliveryStatus: 'delivered',
      attemptCount: 1,
      deliveredAt: '2026-07-23T00:00:01.000Z'
    });

    expect(
      service.recordTaskResult({
        taskId: 'task-1',
        checkpointId: 'checkpoint-1',
        toolCallId: 'call-1',
        result: createTaskResult()
      })
    ).toBe(checkpoint);
    expect(fixture.publish).not.toHaveBeenCalled();
    expect(fixture.markOutboxDelivered).not.toHaveBeenCalled();
  });

  it('rechecks ready Outbox eligibility after the async Main consumer returns', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    await vi.waitFor((): void => {
      expect(fixture.markOutboxDelivered).toHaveBeenCalledOnce();
    });
    const prepared = fixture.prepareDelegation.mock.calls[0]?.[0] as PrepareDelegationInput | undefined;
    if (!prepared) throw new Error('Ready Outbox race requires prepared facts');
    fixture.publish.mockClear();
    fixture.markOutboxDelivered.mockClear();
    const task: AgentTaskRecord = {
      ...createPreparedTask(prepared),
      executionPlanSnapshot: {
        planHash: 'b'.repeat(64),
        planSchemaVersion: 1,
        policyVersion: 'read-runtime-v1',
        capabilitySet: ['read_file'],
        modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
        permissionSnapshot: { scopeIds: ['workspace-read'] },
        resourceScopes: ['file:CONTEXT.md'],
        toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' }],
        commitPolicy: { mode: 'none' },
        budget: { tokenLimit: 100, costLimitUsd: 0, pricingVersion: 'unknown' }
      },
      executionPlanSnapshotHash: 'b'.repeat(64),
      status: 'running',
      currentAttemptId: 'attempt-1'
    };
    const ready = {
      ...prepared.checkpoint,
      status: 'ready_to_resume' as const,
      version: 2,
      terminalResults: {},
      recordState: 'active' as const,
      createdAt: prepared.occurredAt,
      updatedAt: prepared.occurredAt
    };
    const cancelled = { ...ready, status: 'cancelled' as const, version: ready.version + 1 };
    const readyOutbox = {
      outboxId: 'outbox-ready-race',
      dedupeKey: `delegation.ready:${task.checkpointId}`,
      eventType: 'delegation.ready' as const,
      payload: {
        checkpointId: task.checkpointId,
        sessionId: task.sessionId,
        turnId: task.turnId,
        resultCount: 1
      },
      payloadHash: 'c'.repeat(64),
      schemaVersion: 1,
      deliveryStatus: 'pending' as const,
      attemptCount: 0,
      createdAt: '2026-07-23T00:00:01.000Z',
      updatedAt: '2026-07-23T00:00:01.000Z'
    };
    let releaseDispatch: () => void = (): void => undefined;
    const dispatchInternal = vi.fn(
      (): Promise<void> =>
        new Promise<void>((resolve): void => {
          releaseDispatch = resolve;
        })
    );
    fixture.dependencies.dispatchInternal = dispatchInternal;
    fixture.getTask.mockReturnValue(task);
    fixture.getCheckpoint.mockReturnValue(ready);
    fixture.recordTaskResult.mockReturnValue(ready);
    fixture.getOutbox.mockReturnValue(readyOutbox);

    service.recordTaskResult({
      taskId: task.taskId,
      checkpointId: task.checkpointId,
      toolCallId: task.toolCallId,
      result: createTaskResult()
    });
    await vi.waitFor((): void => {
      expect(dispatchInternal).toHaveBeenCalledOnce();
    });

    fixture.getCheckpoint.mockReturnValue(cancelled);
    releaseDispatch();
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.publish).not.toHaveBeenCalled();
    expect(fixture.markOutboxDelivered).not.toHaveBeenCalled();
  });

  it('records a cancelling Child result without releasing Coordinator-owned cancellation resources', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const prepared = fixture.prepareDelegation.mock.calls[0]?.[0] as PrepareDelegationInput | undefined;
    if (!prepared) throw new Error('Prepare facts must be captured');
    await vi.waitFor((): void => {
      expect(fixture.markOutboxDelivered).toHaveBeenCalledOnce();
    });
    const baseTask = createPreparedTask(prepared);
    const plan = createReadPlan(baseTask, {
      ...prepared.checkpoint,
      status: 'waiting_children',
      version: 1,
      terminalResults: {},
      recordState: 'active',
      createdAt: prepared.occurredAt,
      updatedAt: prepared.occurredAt
    });
    const task: AgentTaskRecord = {
      ...baseTask,
      executionPlanSnapshot: plan,
      executionPlanSnapshotHash: plan.planHash,
      status: 'cancelling',
      currentAttemptId: 'attempt-1'
    };
    const cancelled: AgentCheckpointRecord = {
      ...prepared.checkpoint,
      status: 'cancelled',
      version: 3,
      terminalResults: {},
      recordState: 'active',
      createdAt: prepared.occurredAt,
      updatedAt: '2026-07-23T00:00:02.000Z'
    };
    const result: ChatAgentResult = {
      ...createTaskResult(),
      executionStatus: 'cancelled',
      summary: 'Child acknowledged cancellation.',
      usage: {
        ...createTaskResult().usage,
        monetaryCost: {
          currency: 'USD',
          pricingVersion: 'test-v1',
          estimated: 0.001,
          actual: 'unknown'
        }
      },
      error: {
        code: 'cancelled',
        phase: 'runtime',
        category: 'user',
        retryable: false,
        details: { reason: 'user_cancelled' }
      }
    };
    fixture.getTask.mockReturnValue(task);
    fixture.recordTaskResult.mockReturnValue(cancelled);
    fixture.readMessages.mockReturnValue([createAssistant()]);
    fixture.publish.mockClear();
    fixture.markOutboxDelivered.mockClear();
    fixture.persistAssistant.mockClear();
    fixture.publishAssistant.mockClear();

    expect(
      service.recordTaskResult({
        taskId: task.taskId,
        checkpointId: task.checkpointId,
        toolCallId: task.toolCallId,
        result
      })
    ).toBe(cancelled);

    expect(fixture.releaseCheckpoint).not.toHaveBeenCalled();
    expect(fixture.persistAssistant).not.toHaveBeenCalled();
    expect(fixture.publish).not.toHaveBeenCalledWith('delegation.ready', expect.anything());
    expect(fixture.getOutbox).not.toHaveBeenCalledWith(`delegation.ready:${task.checkpointId}`);
    expect(service.getContinuationContext(task.checkpointId)).toBeDefined();
  });

  it('claims and runs one internal Primary continuation with the claimed version as finalize boundary', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    const ready: AgentCheckpointRecord = {
      ...preparedInput.checkpoint,
      status: 'ready_to_resume',
      version: 2,
      terminalResults: {
        'call-1': {
          result: createTaskResult(),
          resultHash: 'd'.repeat(64)
        }
      },
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: preparedInput.occurredAt
    };
    const claimed: AgentCheckpointRecord = {
      ...ready,
      status: 'resuming',
      version: 3,
      resumeRuntimeId: 'runtime-1'
    };
    fixture.getCheckpoint.mockReturnValueOnce(ready).mockReturnValue(claimed);
    fixture.claimResume.mockReturnValueOnce(claimed);
    fixture.startPrimaryContinuation.mockResolvedValue({ outcome: 'completed' });
    fixture.finalizeResume.mockReturnValue({
      ...claimed,
      status: 'completed',
      version: 4
    });

    const resumeInput = { checkpointId: 'checkpoint-1', expectedVersion: 2, resumeRuntimeId: 'runtime-1' };
    const [first, duplicate] = await Promise.all([service.resumePrimary(resumeInput), service.resumePrimary(resumeInput)]);

    expect([first.status, duplicate.status].sort()).toEqual(['already_started', 'started']);
    expect(fixture.claimResume).toHaveBeenCalledWith({
      checkpointId: 'checkpoint-1',
      expectedVersion: 2,
      resumeRuntimeId: 'runtime-1',
      occurredAt: '2026-07-23T00:00:01.000Z'
    });
    expect(fixture.startPrimaryContinuation).toHaveBeenCalledOnce();
    expect(fixture.startPrimaryContinuation).toHaveBeenCalledWith({
      checkpoint: claimed,
      runtimeId: 'runtime-1',
      context: expect.objectContaining({
        clientId: 'bchat',
        modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
        toolSchemaSnapshot: [expect.objectContaining({ name: 'delegate_task' })]
      })
    });
    expect(fixture.startPrimaryContinuation.mock.calls[0]?.[0]).not.toEqual(
      expect.objectContaining({
        model: expect.anything(),
        messages: expect.anything(),
        tools: expect.anything()
      })
    );
    const resumingPublishIndex = fixture.publishCheckpoint.mock.calls.findIndex(([event]): boolean => {
      const applicationEvent = event as ChatAgentApplicationEvent;
      return applicationEvent.type === 'checkpoint.updated' && applicationEvent.checkpoint.status === 'resuming';
    });
    expect(fixture.publishCheckpoint.mock.invocationCallOrder[resumingPublishIndex]).toBeLessThan(
      fixture.startPrimaryContinuation.mock.invocationCallOrder[0] ?? 0
    );
    await vi.waitFor((): void => {
      expect(fixture.finalizeResume).toHaveBeenCalledWith({
        checkpointId: 'checkpoint-1',
        expectedVersion: 3,
        resumeRuntimeId: 'runtime-1',
        outcome: 'completed',
        occurredAt: '2026-07-23T00:00:01.000Z'
      });
    });
    expect(fixture.releaseCheckpoint).toHaveBeenCalledWith('checkpoint-1');
    expect(fixture.finalizeResume.mock.invocationCallOrder[0]).toBeLessThan(fixture.releaseCheckpoint.mock.invocationCallOrder[0] as number);
    await vi.waitFor((): void => {
      expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
    });
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
  });

  it('returns an idempotent settled result after a claimed Runtime completes before retry', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    const ready: AgentCheckpointRecord = {
      ...preparedInput.checkpoint,
      status: 'ready_to_resume',
      version: 2,
      terminalResults: {},
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: preparedInput.occurredAt
    };
    const claimed: AgentCheckpointRecord = {
      ...ready,
      status: 'resuming',
      version: 3,
      resumeRuntimeId: 'runtime-1'
    };
    const completed: AgentCheckpointRecord = {
      ...claimed,
      status: 'completed',
      version: 4
    };
    fixture.getCheckpoint.mockReturnValueOnce(ready).mockReturnValue(completed);
    fixture.claimResume.mockReturnValue(claimed);
    fixture.startPrimaryContinuation.mockResolvedValue({ outcome: 'completed' });
    fixture.finalizeResume.mockReturnValue(completed);
    const input = { checkpointId: 'checkpoint-1', expectedVersion: 2, resumeRuntimeId: 'runtime-1' };

    await expect(service.resumePrimary(input)).resolves.toMatchObject({ status: 'started' });
    await vi.waitFor((): void => {
      expect(fixture.finalizeResume).toHaveBeenCalledOnce();
    });
    await expect(service.resumePrimary(input)).resolves.toEqual({
      status: 'settled',
      checkpoint: expect.objectContaining({
        checkpointId: 'checkpoint-1',
        status: 'completed',
        version: 4,
        resumeRuntimeId: 'runtime-1'
      }),
      address: {
        sessionId: 'session-1',
        turnId: 'turn-1',
        agentId: 'primary',
        runtimeId: 'runtime-1',
        parentRuntimeId: 'runtime-a',
        rootRuntimeId: 'runtime-a',
        continuationOfRuntimeId: 'runtime-a'
      }
    });
    expect(fixture.startPrimaryContinuation).toHaveBeenCalledOnce();
  });

  it('returns a settled cancellation without inventing a Runtime address', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    fixture.getCheckpoint.mockReturnValue({
      ...preparedInput.checkpoint,
      status: 'cancelled',
      version: 3,
      terminalResults: {},
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: preparedInput.occurredAt
    });

    await expect(
      service.resumePrimary({
        checkpointId: 'checkpoint-1',
        expectedVersion: 1,
        resumeRuntimeId: 'runtime-proposed'
      })
    ).resolves.toEqual({
      status: 'settled',
      checkpoint: expect.objectContaining({ checkpointId: 'checkpoint-1', status: 'cancelled', version: 3 })
    });
    expect(fixture.claimResume).not.toHaveBeenCalled();
    expect(fixture.startPrimaryContinuation).not.toHaveBeenCalled();
  });

  it('finalizes only a safely persisted continuation failure before releasing volatile state', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    const ready = {
      ...preparedInput.checkpoint,
      status: 'ready_to_resume',
      version: 4,
      terminalResults: {},
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: preparedInput.occurredAt
    } as AgentCheckpointRecord;
    const claimed = {
      ...ready,
      status: 'resuming',
      version: 5,
      resumeRuntimeId: 'runtime-1'
    } as AgentCheckpointRecord;
    fixture.getCheckpoint.mockReturnValue(ready);
    fixture.claimResume.mockReturnValue(claimed);
    const safeFailure: AgentTaskError = {
      code: 'runtime_start_failed',
      phase: 'starting',
      category: 'runtime',
      retryable: false,
      message: 'start failed',
      details: { reason: 'primary_continuation_start_failed', checkpointId: 'checkpoint-1', runtimeId: 'runtime-1' }
    };
    fixture.startPrimaryContinuation.mockResolvedValue({ outcome: 'failed', phase: 'starting', error: safeFailure });
    fixture.finalizeResume.mockReturnValue({ ...claimed, status: 'failed', version: 6 });

    await expect(service.resumePrimary({ checkpointId: 'checkpoint-1', expectedVersion: 4, resumeRuntimeId: 'runtime-1' })).resolves.toMatchObject({
      status: 'started'
    });

    await vi.waitFor((): void => {
      expect(fixture.finalizeResume).toHaveBeenCalledWith(
        expect.objectContaining({
          checkpointId: 'checkpoint-1',
          expectedVersion: 5,
          resumeRuntimeId: 'runtime-1',
          outcome: 'failed',
          error: safeFailure
        })
      );
    });
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
  });

  it('retains resuming state and fence when continuation cannot prove safe failure persistence', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    const ready = {
      ...preparedInput.checkpoint,
      status: 'ready_to_resume',
      version: 4,
      terminalResults: {},
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: preparedInput.occurredAt
    } as AgentCheckpointRecord;
    fixture.getCheckpoint.mockReturnValue(ready);
    fixture.claimResume.mockReturnValue({ ...ready, status: 'resuming', version: 5, resumeRuntimeId: 'runtime-1' });
    fixture.startPrimaryContinuation.mockRejectedValue(new Error('unsafe persistence failure'));
    const errorLog = vi.spyOn(console, 'error').mockImplementation((): void => undefined);

    await expect(service.resumePrimary({ checkpointId: 'checkpoint-1', expectedVersion: 4, resumeRuntimeId: 'runtime-1' })).resolves.toMatchObject({
      status: 'started'
    });
    await Promise.resolve();

    expect(fixture.finalizeResume).not.toHaveBeenCalled();
    expect(service.getContinuationContext('checkpoint-1')).toBeDefined();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toEqual({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-1'
    });
    expect(errorLog).toHaveBeenCalledWith('[chat-agent-resume-finalize] checkpointId=checkpoint-1');
    expect(errorLog).not.toHaveBeenCalledWith(expect.stringContaining('unsafe persistence failure'));
    errorLog.mockRestore();
  });

  it('rejects invalid continuation context before the resume CAS claim', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    fixture.getCheckpoint.mockReturnValue({
      ...preparedInput.checkpoint,
      continuationSnapshot: {
        ...preparedInput.checkpoint.continuationSnapshot,
        continuationContextHash: '0'.repeat(64)
      },
      status: 'ready_to_resume',
      version: 2,
      terminalResults: {},
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: preparedInput.occurredAt
    });

    await expect(service.resumePrimary({ checkpointId: 'checkpoint-1', expectedVersion: 2, resumeRuntimeId: 'runtime-1' })).rejects.toMatchObject({
      code: 'protocol_error',
      phase: 'recovery'
    });
    expect(fixture.claimResume).not.toHaveBeenCalled();
    expect(fixture.startPrimaryContinuation).not.toHaveBeenCalled();
    expect(fixture.finalizeResume).not.toHaveBeenCalled();
  });

  it('returns an allowlisted recovery snapshot without continuation or Child result details', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    fixture.listActive.mockReturnValue([
      {
        checkpoint: {
          ...preparedInput.checkpoint,
          status: 'ready_to_resume',
          version: 2,
          terminalResults: {
            'call-1': {
              result: createTaskResult(),
              resultHash: 'f'.repeat(64)
            }
          },
          recordState: 'active',
          createdAt: preparedInput.occurredAt,
          updatedAt: preparedInput.occurredAt
        },
        tasks: [],
        eventSequence: 4
      }
    ]);

    const snapshots = service.listActive();
    const serialized = JSON.stringify(snapshots);

    expect(snapshots).toEqual([
      expect.objectContaining({
        checkpointId: 'checkpoint-1',
        status: 'ready_to_resume',
        version: 2,
        checkpointSequence: 4
      })
    ]);
    expect(serialized).not.toContain('continuationSnapshot');
    expect(serialized).not.toContain('terminalResults');
    expect(serialized).not.toContain('Found a partial answer');
    expect(serialized).not.toContain('must-not-persist');
  });

  it('lists and resolves confirmation snapshots only through the Main queue', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    const pending = {
      confirmationId: 'confirmation-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      agentId: 'child-1',
      runtimeId: 'runtime-1',
      toolCallId: 'tool-call-1',
      changesetId: 'changeset-1',
      status: 'pending' as const,
      version: 1,
      riskLevel: 'write' as const,
      displayPaths: ['notes.md'],
      resourceScopes: ['file:/workspace/notes.md'],
      unifiedDiff: '--- a/notes.md\n+++ b/notes.md',
      baseRevision: 'a'.repeat(64),
      diffHash: 'b'.repeat(64),
      operationSetHash: 'c'.repeat(64),
      planHash: 'd'.repeat(64),
      createdAt: '2026-07-27T00:00:00.000Z',
      updatedAt: '2026-07-27T00:00:00.000Z'
    };
    const approved = { ...pending, status: 'approved' as const, version: 2, updatedAt: '2026-07-27T00:00:01.000Z' };
    fixture.listConfirmations.mockReturnValue([pending]);
    fixture.resolveConfirmation.mockReturnValue(approved);

    expect(service.listConfirmations()).toEqual([pending]);
    expect(
      service.resolveConfirmation({
        confirmationId: 'confirmation-1',
        expectedVersion: 1,
        decision: 'approved'
      })
    ).toEqual(approved);
    expect(fixture.resolveConfirmation).toHaveBeenCalledWith({
      confirmationId: 'confirmation-1',
      expectedVersion: 1,
      decision: 'approved'
    });
  });

  it('persists checkpoint cancellation before revoking its Task confirmations', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput('write'));
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    const checkpoint: AgentCheckpointRecord = {
      ...preparedInput.checkpoint,
      status: 'waiting_children',
      version: 1,
      terminalResults: {},
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: preparedInput.occurredAt
    };
    fixture.listActive.mockReturnValue([
      {
        checkpoint,
        tasks: [createPreparedTask(preparedInput)],
        eventSequence: 2
      }
    ]);
    const cancelling = { ...checkpoint, status: 'cancelling' as const, version: 2 };
    fixture.cancelCheckpoint.mockReturnValue(cancelling);
    fixture.getCheckpoint.mockReturnValue(cancelling);
    fixture.cancelCheckpointExecution.mockImplementation(async (checkpointId: string, reason: string): Promise<void> => {
      service.cancelInternal(checkpointId, reason);
    });

    await expect(service.cancelCheckpoint({ checkpointId: checkpoint.checkpointId })).resolves.toMatchObject({ status: 'cancelling' });
    expect(fixture.revokeTaskConfirmations).toHaveBeenCalledWith(preparedInput.tasks[0]?.taskId, 'user_cancelled');
    expect(fixture.revokeTaskConfirmations.mock.invocationCallOrder[0]).toBeGreaterThan(fixture.cancelCheckpoint.mock.invocationCallOrder[0] ?? 0);
  });

  it('terminalizes and broadcasts the source assistant before releasing the cancellation fence', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    const cancelled: AgentCheckpointRecord = {
      ...preparedInput.checkpoint,
      status: 'cancelled',
      version: 3,
      terminalResults: {},
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: '2026-07-23T00:00:02.000Z'
    };
    fixture.cancelCheckpoint.mockReturnValue(cancelled);
    fixture.getCheckpoint.mockReturnValue(cancelled);
    fixture.readMessages.mockReturnValue([createAssistant()]);
    fixture.cancelCheckpointExecution.mockImplementation(async (checkpointId: string, reason: string): Promise<void> => {
      service.cancelInternal(checkpointId, reason);
    });
    fixture.persistAssistant.mockClear();

    const snapshot = await service.cancelCheckpoint({ checkpointId: 'checkpoint-1' });

    expect(snapshot.status).toBe('cancelled');
    expect(fixture.cancelCheckpoint).toHaveBeenCalledWith({
      checkpointId: 'checkpoint-1',
      reason: 'user_cancelled',
      occurredAt: '2026-07-23T00:00:01.000Z'
    });
    expect(fixture.persistAssistant).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'assistant-1',
        loading: false,
        finished: true,
        parts: [expect.objectContaining({ type: 'tool', status: 'done', result: expect.objectContaining({ status: 'cancelled' }) })]
      }),
      'checkpoint-1'
    );
    expect(fixture.publishAssistant.mock.invocationCallOrder[0]).toBeGreaterThan(fixture.persistAssistant.mock.invocationCallOrder.at(-1) ?? 0);
    expect(fixture.publishCheckpoint.mock.invocationCallOrder.at(-1)).toBeGreaterThan(fixture.publishAssistant.mock.invocationCallOrder[0] ?? 0);
    expect(fixture.releaseCheckpoint).toHaveBeenCalledWith('checkpoint-1');
    expect(fixture.finalizeCancellation).toHaveBeenCalledWith({
      checkpointId: 'checkpoint-1',
      finalizedAt: '2026-07-23T00:00:01.000Z'
    });
    expect(fixture.releaseCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(fixture.finalizeCancellation.mock.invocationCallOrder[0] as number);
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();

    service.cancelInternal('checkpoint-1', 'user_cancelled');

    expect(fixture.cancelCheckpoint).toHaveBeenCalledTimes(2);
    expect(fixture.persistAssistant).toHaveBeenCalledOnce();
    expect(fixture.publishAssistant).toHaveBeenCalledOnce();
    expect(fixture.releaseCheckpoint).toHaveBeenCalledOnce();
    expect(fixture.finalizeCancellation).toHaveBeenCalledOnce();
  });

  it('persists a Coordinator cancellation with its stable machine reason', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    fixture.cancelCheckpoint.mockReturnValue({
      ...preparedInput.checkpoint,
      status: 'cancelled',
      version: 3,
      terminalResults: {},
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: '2026-07-23T00:00:02.000Z'
    });
    fixture.readMessages.mockReturnValue([createAssistant()]);

    service.cancelInternal('checkpoint-1', 'schedule_deadline_exceeded');

    expect(fixture.cancelCheckpoint).toHaveBeenCalledWith({
      checkpointId: 'checkpoint-1',
      reason: 'schedule_deadline_exceeded',
      occurredAt: '2026-07-23T00:00:01.000Z'
    });
  });

  it('keeps the cancellation fence when source assistant persistence fails and finishes on retry', async (): Promise<void> => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    const cancelled: AgentCheckpointRecord = {
      ...preparedInput.checkpoint,
      status: 'cancelled',
      version: 3,
      terminalResults: {},
      recordState: 'active',
      createdAt: preparedInput.occurredAt,
      updatedAt: '2026-07-23T00:00:02.000Z'
    };
    fixture.cancelCheckpoint.mockReturnValue(cancelled);
    fixture.getCheckpoint.mockReturnValue(cancelled);
    fixture.readMessages.mockReturnValue([createAssistant()]);
    fixture.cancelCheckpointExecution.mockImplementation(async (checkpointId: string, reason: string): Promise<void> => {
      service.cancelInternal(checkpointId, reason);
    });
    fixture.persistAssistant.mockImplementationOnce((): never => {
      throw new Error('assistant write failed');
    });

    await expect(service.cancelCheckpoint({ checkpointId: 'checkpoint-1' })).rejects.toThrow('assistant write failed');
    expect(service.getContinuationContext('checkpoint-1')).toBeDefined();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toMatchObject({ checkpointId: 'checkpoint-1' });
    expect(fixture.publishAssistant).not.toHaveBeenCalled();
    expect(fixture.finalizeCancellation).not.toHaveBeenCalled();

    await expect(service.cancelCheckpoint({ checkpointId: 'checkpoint-1' })).resolves.toMatchObject({ status: 'cancelled' });
    expect(fixture.cancelCheckpoint).toHaveBeenCalledTimes(2);
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
    expect(fixture.finalizeCancellation).toHaveBeenCalledOnce();
  });

  it('replays unfinished cancellation cleanup after restart and persists the durable marker last', (): void => {
    const fixture = createDependencies();
    const cancelled: AgentCheckpointRecord = {
      checkpointId: 'checkpoint-restart-cancel',
      sessionId: 'session-1',
      turnId: 'turn-1',
      primaryAgentId: 'primary',
      rootRuntimeId: 'runtime-root',
      sourceRuntimeId: 'runtime-a',
      assistantMessageId: 'assistant-1',
      continuationSnapshot: {
        checkpointSchemaVersion: 1,
        policyVersion: 'foundation-v1',
        modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
        continuationContextReference: 'continuation-restart',
        continuationContextHash: 'a'.repeat(64),
        sourceMessageRevision: 'revision-restart',
        toolSchemaSnapshotHash: 'b'.repeat(64),
        orderedToolCalls: [],
        reservedResumeBudget: { tokenLimit: 100, costLimitUsd: 0, pricingVersion: 'unknown' },
        absoluteTurnDeadline: '2026-07-23T01:00:00.000Z'
      },
      continuationSnapshotHash: 'c'.repeat(64),
      status: 'cancelled',
      version: 3,
      terminalResults: {},
      recordState: 'active',
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:02.000Z'
    };
    fixture.listCancelledCheckpoints.mockReturnValue([cancelled]);
    fixture.getCheckpoint.mockReturnValue(cancelled);
    fixture.readMessages.mockReturnValue([createAssistant()]);
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect(service.recoverCancellations()).toBe(1);

    expect(fixture.persistAssistant).toHaveBeenCalledOnce();
    expect(fixture.publishAssistant).toHaveBeenCalledOnce();
    expect(fixture.releaseCheckpoint).toHaveBeenCalledOnce();
    expect(fixture.finalizeCancellation).toHaveBeenCalledOnce();
    expect(fixture.publishAssistant.mock.invocationCallOrder[0]).toBeLessThan(fixture.finalizeCancellation.mock.invocationCallOrder[0] as number);
    expect(fixture.releaseCheckpoint.mock.invocationCallOrder[0]).toBeLessThan(fixture.finalizeCancellation.mock.invocationCallOrder[0] as number);
  });

  it('does not scan finalized cancellation history during startup recovery', (): void => {
    const fixture = createDependencies();
    const finalized = {
      checkpointId: 'checkpoint-finalized-cancel',
      sessionId: 'session-1',
      turnId: 'turn-1',
      primaryAgentId: 'primary',
      rootRuntimeId: 'runtime-root',
      sourceRuntimeId: 'runtime-a',
      assistantMessageId: 'assistant-1',
      continuationSnapshot: {
        checkpointSchemaVersion: 1,
        policyVersion: 'foundation-v1',
        modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
        continuationContextReference: 'continuation-finalized',
        continuationContextHash: 'a'.repeat(64),
        sourceMessageRevision: 'revision-finalized',
        toolSchemaSnapshotHash: 'b'.repeat(64),
        orderedToolCalls: [],
        reservedResumeBudget: { tokenLimit: 100, costLimitUsd: 0, pricingVersion: 'unknown' },
        absoluteTurnDeadline: '2026-07-23T01:00:00.000Z'
      },
      continuationSnapshotHash: 'c'.repeat(64),
      status: 'cancelled' as const,
      version: 4,
      terminalResults: {},
      cancellationFinalizedAt: '2026-07-23T00:00:03.000Z',
      recordState: 'active' as const,
      createdAt: '2026-07-23T00:00:00.000Z',
      updatedAt: '2026-07-23T00:00:03.000Z'
    };
    fixture.listCancelledCheckpoints.mockReturnValue([]);
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect(service.recoverCancellations()).toBe(0);

    expect(fixture.readMessages).not.toHaveBeenCalled();
    expect(fixture.persistAssistant).not.toHaveBeenCalled();
    expect(fixture.publishAssistant).not.toHaveBeenCalled();
    expect(fixture.finalizeCancellation).not.toHaveBeenCalled();
    expect(fixture.releaseCheckpoint).not.toHaveBeenCalled();
    expect(finalized.cancellationFinalizedAt).toBeDefined();
  });

  it('prepares write mode as an immutable Task contract', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect(service.prepareDelegation(createInput('write'))).toEqual({ prepared: true });
    expect(fixture.prepareDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [expect.objectContaining({ contractSnapshot: expect.objectContaining({ mode: 'write' }) })]
      }),
      expect.any(Function)
    );
  });

  it('rejects a reserved scope conflict before creating any persistent facts', (): void => {
    const fixture = createDependencies();
    fixture.dependencies.locks.acquireContinuationFence({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-existing'
    });
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect((): void => {
      service.prepareDelegation(createInput());
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(fixture.prepareDelegation).not.toHaveBeenCalled();
    expect(fixture.interruptCheckpoint).not.toHaveBeenCalled();
    expect(fixture.interruptActive).not.toHaveBeenCalled();
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
    expect(fixture.publish).not.toHaveBeenCalled();
  });

  it('releases an inactive reservation when Store prepare fails', (): void => {
    const fixture = createDependencies();
    fixture.prepareDelegation.mockImplementationOnce((): never => {
      throw new Error('store prepare failed');
    });
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect((): void => {
      service.prepareDelegation(createInput());
    }).toThrowError('store prepare failed');

    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
    expect(
      fixture.dependencies.locks.reserveContinuationFence({
        scope: 'session:session-1/history',
        checkpointId: 'checkpoint-retry'
      })
    ).not.toBeNull();
  });

  it('interrupts startup checkpoints and clears volatile contexts and fences', (): void => {
    const fixture = createDependencies();
    fixture.interruptActive.mockReturnValue(1);
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());

    expect(service.interruptUnrecoverableCheckpoints()).toBe(1);

    expect(fixture.interruptActive).toHaveBeenCalledWith(
      expect.objectContaining<AgentTaskError>({
        code: 'runtime_interrupted',
        phase: 'recovery',
        category: 'runtime',
        retryable: false
      })
    );
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
  });

  it('keeps or rebuilds fences for journal-blocked startup survivors without restoring volatile context', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);
    service.prepareDelegation(createInput());
    const preparedInput = fixture.prepareDelegation.mock.calls[0]?.[0];
    if (!preparedInput) throw new Error('Prepare input must be captured');
    const { checkpoint } = preparedInput;
    fixture.interruptActive.mockReturnValue(0);
    fixture.listActive.mockReturnValue([
      {
        checkpoint: {
          ...checkpoint,
          status: 'waiting_children',
          version: 1,
          terminalResults: {},
          recordState: 'active',
          createdAt: preparedInput.occurredAt,
          updatedAt: preparedInput.occurredAt
        },
        tasks: [],
        eventSequence: 2
      }
    ]);

    expect(service.interruptUnrecoverableCheckpoints()).toBe(0);

    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toEqual({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-1'
    });
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
  });

  it('fails startup recovery when a survivor cannot own its session history fence', (): void => {
    const fixture = createDependencies();
    fixture.dependencies.locks.acquireContinuationFence({
      scope: 'session:session-1/history',
      checkpointId: 'checkpoint-conflict'
    });
    fixture.listActive.mockReturnValue([
      {
        checkpoint: {
          checkpointId: 'checkpoint-1',
          sessionId: 'session-1',
          turnId: 'turn-1',
          primaryAgentId: 'primary',
          rootRuntimeId: 'runtime-a',
          sourceRuntimeId: 'runtime-a',
          assistantMessageId: 'assistant-1',
          continuationSnapshot: {
            checkpointSchemaVersion: 1,
            policyVersion: 'foundation-v1',
            modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
            continuationContextReference: 'continuation-1',
            continuationContextHash: 'a'.repeat(64),
            sourceMessageRevision: 'b'.repeat(64),
            toolSchemaSnapshotHash: 'c'.repeat(64),
            orderedToolCalls: [
              {
                toolCallId: 'call-1',
                taskId: 'task-1',
                required: true,
                argumentsHash: 'd'.repeat(64),
                providerMetadataHash: 'e'.repeat(64)
              }
            ],
            reservedResumeBudget: { tokenLimit: 4096, costLimitUsd: 0, pricingVersion: 'unknown' },
            absoluteTurnDeadline: '2026-07-23T00:05:00.000Z'
          },
          continuationSnapshotHash: 'f'.repeat(64),
          status: 'waiting_children',
          version: 1,
          terminalResults: {},
          recordState: 'active',
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z'
        },
        tasks: [],
        eventSequence: 2
      }
    ]);
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect((): void => {
      service.interruptUnrecoverableCheckpoints();
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });
});
