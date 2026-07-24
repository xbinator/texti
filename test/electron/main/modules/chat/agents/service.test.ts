/**
 * @file service.test.ts
 * @description Child Agent 委派 prepare 边界、逻辑栅栏和恢复测试。
 */
import type { AgentCheckpointRecord, AgentTaskRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { ActiveChatRuntime, ChatRuntimeDelegationPrepareInput } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { ChatMessageRecord } from 'types/chat';
import type { AgentTaskError, ChatAgentApplicationEvent, ChatAgentResult } from 'types/chat-agent';
import { describe, expect, it, vi } from 'vitest';
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
          requestedTools: ['read_file'],
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
  interruptCheckpoint: ReturnType<typeof vi.fn>;
  interruptActive: ReturnType<typeof vi.fn>;
  markOutboxDelivered: ReturnType<typeof vi.fn>;
  listActive: ReturnType<typeof vi.fn>;
  getTask: ReturnType<typeof vi.fn>;
  getCheckpoint: ReturnType<typeof vi.fn>;
  getOutbox: ReturnType<typeof vi.fn>;
  recordTaskResult: ReturnType<typeof vi.fn>;
  claimResume: ReturnType<typeof vi.fn>;
  finalizeResume: ReturnType<typeof vi.fn>;
  cancelCheckpoint: ReturnType<typeof vi.fn>;
  listEvents: ReturnType<typeof vi.fn>;
  listPendingOutbox: ReturnType<typeof vi.fn>;
  startPrimaryContinuation: ReturnType<typeof vi.fn>;
  persistAssistant: ReturnType<typeof vi.fn>;
  readMessages: ReturnType<typeof vi.fn>;
  publishAssistant: ReturnType<typeof vi.fn>;
  publishCheckpoint: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
} {
  const prepareDelegation = vi.fn((_input, persistAssistant: () => undefined): void => {
    persistAssistant();
  });
  const interruptCheckpoint = vi.fn();
  const interruptActive = vi.fn((): number => 0);
  const markOutboxDelivered = vi.fn();
  const listActive = vi.fn(() => []);
  const getTask = vi.fn();
  const getCheckpoint = vi.fn();
  const getOutbox = vi.fn();
  const recordTaskResult = vi.fn();
  const claimResume = vi.fn();
  const finalizeResume = vi.fn();
  const cancelCheckpoint = vi.fn();
  const listEvents = vi.fn(() => []);
  const listPendingOutbox = vi.fn(() => []);
  const startPrimaryContinuation = vi.fn();
  const persistAssistant = vi.fn((): undefined => undefined);
  const readMessages = vi.fn(() => [] as ChatMessageRecord[]);
  const publishAssistant = vi.fn();
  const publishCheckpoint = vi.fn();
  const publish = vi.fn();
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
  return {
    dependencies: {
      store: {
        prepareDelegation,
        interruptCheckpoint,
        interruptActive,
        markOutboxDelivered,
        listActive,
        getTask,
        getCheckpoint,
        getOutbox,
        recordTaskResult,
        claimResume,
        finalizeResume,
        cancelCheckpoint,
        listEvents,
        listPendingOutbox
      },
      locks: createRuntimeLockRegistry(),
      persistAssistant,
      readMessages,
      publishAssistant,
      publish,
      publishCheckpoint,
      createId: (kind, index): string => `${kind}-${index ?? 1}`,
      now: (): string => '2026-07-23T00:00:01.000Z',
      startPrimaryContinuation
    },
    prepareDelegation,
    interruptCheckpoint,
    interruptActive,
    markOutboxDelivered,
    listActive,
    getTask,
    getCheckpoint,
    getOutbox,
    recordTaskResult,
    claimResume,
    finalizeResume,
    cancelCheckpoint,
    listEvents,
    listPendingOutbox,
    startPrimaryContinuation,
    persistAssistant,
    readMessages,
    publishAssistant,
    publishCheckpoint,
    publish
  };
}

describe('chat agent delegation service', (): void => {
  it('commits immutable facts before acquiring the fence and publishing the outbox', (): void => {
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

  it('normalizes a Child result, computes its canonical hash, and publishes the persisted ready outbox', (): void => {
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
        policyVersion: 'foundation-v1',
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
    expect(fixture.publish).toHaveBeenCalledWith('delegation.ready', expect.objectContaining({ checkpointId: 'checkpoint-1', resultCount: 1 }));
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
    const resumingPublishIndex = fixture.publishCheckpoint.mock.calls.findIndex(
      ([event]): boolean => (event as ChatAgentApplicationEvent).checkpoint.status === 'resuming'
    );
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
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
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

  it('terminalizes and broadcasts the source assistant before releasing the cancellation fence', (): void => {
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
    fixture.readMessages.mockReturnValue([createAssistant()]);

    const snapshot = service.cancelCheckpoint({ checkpointId: 'checkpoint-1' });

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
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
  });

  it('keeps the cancellation fence when source assistant persistence fails and finishes on retry', (): void => {
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
    fixture.readMessages.mockReturnValue([createAssistant()]);
    fixture.persistAssistant.mockImplementationOnce((): never => {
      throw new Error('assistant write failed');
    });

    expect((): void => {
      service.cancelCheckpoint({ checkpointId: 'checkpoint-1' });
    }).toThrow('assistant write failed');
    expect(service.getContinuationContext('checkpoint-1')).toBeDefined();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toMatchObject({ checkpointId: 'checkpoint-1' });
    expect(fixture.publishAssistant).not.toHaveBeenCalled();

    expect(service.cancelCheckpoint({ checkpointId: 'checkpoint-1' }).status).toBe('cancelled');
    expect(fixture.cancelCheckpoint).toHaveBeenCalledTimes(2);
    expect(service.getContinuationContext('checkpoint-1')).toBeUndefined();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
  });

  it('rejects write mode with capability_denied before creating a checkpoint', (): void => {
    const fixture = createDependencies();
    const service = createChatAgentDelegationService(fixture.dependencies);

    expect((): void => {
      service.prepareDelegation(createInput('write'));
    }).toThrowError(
      expect.objectContaining({
        code: 'capability_denied',
        phase: 'contract_validation'
      })
    );
    expect(fixture.prepareDelegation).not.toHaveBeenCalled();
    expect(fixture.dependencies.locks.getContinuationFence('session:session-1/history')).toBeUndefined();
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
