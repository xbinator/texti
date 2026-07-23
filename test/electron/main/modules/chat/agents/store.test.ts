/**
 * @file store.test.ts
 * @description 使用真实内存 SQLite 验证 Agent 委派事实的原子性、不可变性与审计历史。
 */
import type { AgentDelegationContinuationSnapshot, AgentExecutionPlanSnapshot, ChatAgentResult, DelegateTaskInput } from 'types/chat-agent';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashAgentPayload, hashExecutionPlanSnapshot, validateFoundationContract } from '../../../../../../electron/main/modules/chat/agents/contracts.mts';
import {
  createAgentDelegationStore,
  type AgentDelegationStore,
  type AgentStoreDatabase,
  type PrepareDelegationInput
} from '../../../../../../electron/main/modules/chat/agents/store.mts';
import { createAgentTables } from '../../../../../../electron/main/modules/database/service.mts';

/** 仅在 ABI 与 better-sqlite3 一致的 Electron Node 进程中执行真实数据库测试。 */
const describeWithSqlite = 'electron' in process.versions ? describe : describe.skip;

/** 固定测试时间，避免持久化断言依赖真实时钟。 */
const occurredAt = '2026-07-23T08:00:00.000Z';

/** 可被基础阶段接受的只读契约。 */
const validContract: DelegateTaskInput = {
  task: 'Inspect CONTEXT.md',
  acceptanceCriteria: ['Return the project name'],
  mode: 'read',
  resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
  requestedTools: ['read_file'],
  required: true,
  priority: 'normal'
};

/**
 * 把 better-sqlite3 实例适配为 Store 的窄数据库边界。
 * @param database - 真实内存 SQLite 实例
 * @returns Store 可使用的同步数据库接口
 */
function createDatabaseAdapter(database: InstanceType<typeof Database>): AgentStoreDatabase {
  return {
    execute: (sql: string, params: readonly unknown[] = []): { changes: number; lastInsertRowid: number | bigint } => database.prepare(sql).run(...params),
    select: <T>(sql: string, params: readonly unknown[] = []): T[] => database.prepare(sql).all(...params) as T[],
    transaction: <T>(operation: () => T): T => database.transaction(operation)()
  };
}

/**
 * 创建含不可变快照和有效 hash 的委派输入。
 * @param suffix - 用于隔离测试记录的标识后缀
 * @returns 可直接原子写入的委派事实
 */
function createPreparedInput(suffix = '1'): PrepareDelegationInput {
  const validation = validateFoundationContract(validContract);
  if (!validation.ok) throw new Error('Fixture contract must be valid');

  const continuationSnapshot: AgentDelegationContinuationSnapshot = {
    checkpointSchemaVersion: 1,
    policyVersion: 'foundation-v1',
    modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
    continuationContextReference: `continuation-${suffix}`,
    continuationContextHash: 'b'.repeat(64),
    sourceMessageRevision: `revision-${suffix}`,
    toolSchemaSnapshotHash: 'c'.repeat(64),
    orderedToolCalls: [
      {
        toolCallId: `tool-call-${suffix}`,
        taskId: `task-${suffix}`,
        required: true,
        argumentsHash: 'd'.repeat(64),
        providerMetadataHash: 'e'.repeat(64)
      }
    ],
    reservedResumeBudget: { tokenLimit: 500, costLimitUsd: 0.05, pricingVersion: 'test-v1' },
    absoluteTurnDeadline: '2026-07-23T09:00:00.000Z'
  };
  const outboxPayload = {
    checkpointId: `checkpoint-${suffix}`,
    sessionId: `session-${suffix}`,
    turnId: `turn-${suffix}`
  };

  return {
    tasks: [
      {
        taskId: `task-${suffix}`,
        sessionId: `session-${suffix}`,
        turnId: `turn-${suffix}`,
        agentId: `child-${suffix}`,
        parentAgentId: 'primary',
        rootRuntimeId: `runtime-root-${suffix}`,
        checkpointId: `checkpoint-${suffix}`,
        toolCallId: `tool-call-${suffix}`,
        contractSnapshot: validation.contractSnapshot,
        contractSnapshotHash: validation.contractSnapshotHash,
        priority: validation.contract.priority,
        deadlineAt: validation.contract.deadlineAt
      }
    ],
    checkpoint: {
      checkpointId: `checkpoint-${suffix}`,
      sessionId: `session-${suffix}`,
      turnId: `turn-${suffix}`,
      primaryAgentId: 'primary',
      rootRuntimeId: `runtime-root-${suffix}`,
      sourceRuntimeId: `runtime-a-${suffix}`,
      assistantMessageId: `assistant-${suffix}`,
      continuationSnapshot,
      continuationSnapshotHash: hashAgentPayload({
        schemaVersion: continuationSnapshot.checkpointSchemaVersion,
        continuation: continuationSnapshot
      })
    },
    outbox: {
      outboxId: `outbox-${suffix}`,
      dedupeKey: `delegation.created:checkpoint-${suffix}`,
      eventType: 'delegation.created',
      payload: outboxPayload,
      payloadHash: hashAgentPayload(outboxPayload),
      schemaVersion: 1
    },
    occurredAt
  };
}

/**
 * 创建含两个有序 Task 的委派输入。
 * @param suffix - 测试身份后缀
 * @returns 两个 Task 与对应 Continuation 链接
 */
function createTwoTaskInput(suffix: string): PrepareDelegationInput {
  const input = createPreparedInput(suffix);
  const firstTask = input.tasks[0];
  const secondTask = {
    ...firstTask,
    taskId: `task-${suffix}-2`,
    agentId: `child-${suffix}-2`,
    toolCallId: `tool-call-${suffix}-2`
  };
  const continuationSnapshot: AgentDelegationContinuationSnapshot = {
    ...input.checkpoint.continuationSnapshot,
    orderedToolCalls: [
      ...input.checkpoint.continuationSnapshot.orderedToolCalls,
      {
        ...input.checkpoint.continuationSnapshot.orderedToolCalls[0],
        taskId: secondTask.taskId,
        toolCallId: secondTask.toolCallId
      }
    ]
  };
  return {
    ...input,
    tasks: [firstTask, secondTask],
    checkpoint: {
      ...input.checkpoint,
      continuationSnapshot,
      continuationSnapshotHash: hashAgentPayload({
        schemaVersion: continuationSnapshot.checkpointSchemaVersion,
        continuation: continuationSnapshot
      })
    }
  };
}

/**
 * 断言四类委派事实均未落库。
 * @param databaseAdapter - 测试 SQLite 边界
 */
function expectNoDelegationFacts(databaseAdapter: AgentStoreDatabase): void {
  ['chat_agent_tasks', 'chat_agent_delegation_checkpoints', 'chat_agent_events', 'chat_agent_outbox'].forEach((tableName): void => {
    const row = databaseAdapter.select<{ fact_count: number }>(`SELECT COUNT(*) AS fact_count FROM ${tableName}`)[0];
    expect(row.fact_count).toBe(0);
  });
}

/**
 * 测试专用：关闭 Event 不可变触发器以模拟损坏的持久化历史。
 * @param databaseAdapter - 测试数据库边界
 */
function allowEventCorruption(databaseAdapter: AgentStoreDatabase): void {
  databaseAdapter.execute('DROP TRIGGER trg_chat_agent_events_append_only');
  databaseAdapter.execute('DROP TRIGGER trg_chat_agent_events_no_delete');
}

/**
 * 测试专用：关闭 Task 身份触发器以模拟旧库中的聚合损坏。
 * @param databaseAdapter - 测试数据库边界
 */
function allowTaskCorruption(databaseAdapter: AgentStoreDatabase): void {
  databaseAdapter.execute('DROP TRIGGER trg_chat_agent_tasks_immutable');
}

/**
 * 测试专用：关闭 Task result 单写触发器以模拟旧库跨字段损坏。
 * @param databaseAdapter - 测试数据库边界
 */
function allowResultCorruption(databaseAdapter: AgentStoreDatabase): void {
  databaseAdapter.execute('DROP TRIGGER trg_chat_agent_tasks_result_once');
}

/**
 * 创建与 Task 契约绑定的不可变执行计划。
 * @param input - 原子委派输入
 * @returns hash 已校验的执行计划快照
 */
function createExecutionPlan(input: PrepareDelegationInput): AgentExecutionPlanSnapshot {
  const planWithoutHash = {
    planSchemaVersion: 1,
    policyVersion: 'foundation-v1',
    capabilitySet: ['read_file'],
    modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
    permissionSnapshot: { scopeIds: ['workspace-read'] },
    resourceScopes: ['file:CONTEXT.md'],
    toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' as const }],
    commitPolicy: { mode: 'none' as const },
    budget: { tokenLimit: 1000, costLimitUsd: 0.1, pricingVersion: 'test-v1' }
  };

  return {
    ...planWithoutHash,
    planHash: hashExecutionPlanSnapshot(input.tasks[0].contractSnapshot, planWithoutHash)
  };
}

/**
 * 创建可写入终态的结构化 Child 结果。
 * @param taskId - 结果所属 Task
 * @returns 完整结果信封
 */
function createTaskResult(taskId: string): ChatAgentResult {
  return {
    taskId,
    agentId: taskId.replace('task-', 'child-'),
    attemptId: `attempt-${taskId}`,
    executionStatus: 'completed',
    completion: {
      level: 'full',
      criteria: [
        {
          criterionIndex: 0,
          claim: {
            status: 'satisfied',
            summary: 'Tibis',
            evidence: [{ kind: 'resource_snapshot', referenceId: 'CONTEXT.md' }]
          },
          verification: {
            status: 'verified',
            verifier: 'tool',
            evidence: [{ kind: 'tool_event', referenceId: 'read-file-event' }]
          }
        }
      ]
    },
    summary: 'The project is Tibis.',
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
        currency: 'USD',
        pricingVersion: 'test-v1',
        estimated: 0.001,
        actual: 'unknown'
      }
    }
  };
}

/**
 * 创建带结构化运行时错误的失败结果。
 * @param taskId - 结果所属 Task
 * @returns 可通过共享结果校验器的失败结果信封
 */
function createFailedResult(taskId: string): ChatAgentResult {
  return {
    ...createTaskResult(taskId),
    executionStatus: 'failed',
    summary: 'Child runtime failed.',
    error: {
      code: 'runtime_failed',
      phase: 'runtime',
      category: 'runtime',
      retryable: false,
      details: { reason: 'test_runtime_failure' }
    }
  };
}

/**
 * 把基础只读 Task 推进到 running。
 * @param store - 待操作 Store
 * @param input - Task 初始委派事实
 * @param databaseAdapter - 用于建立显式 Attempt 身份的数据库边界
 */
function startTask(store: AgentDelegationStore, input: PrepareDelegationInput, databaseAdapter: AgentStoreDatabase): void {
  const { taskId } = input.tasks[0];
  const plan = createExecutionPlan(input);
  store.transitionTask({ taskId, toStatus: 'planning', occurredAt, source: 'coordinator' });
  store.transitionTask({
    taskId,
    toStatus: 'authorized',
    executionPlanSnapshot: plan,
    executionPlanSnapshotHash: plan.planHash,
    occurredAt,
    source: 'coordinator'
  });
  store.transitionTask({ taskId, toStatus: 'queued', queuePhase: 'start', occurredAt, source: 'coordinator' });
  const attemptId = `attempt-${taskId}`;
  databaseAdapter.execute(
    `INSERT INTO chat_agent_attempts (
      attempt_id, task_id, attempt_number, parent_runtime_id, plan_hash, initial_runtime_id,
      current_runtime_id, runtime_sequence, status, started_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attemptId,
      taskId,
      1,
      input.checkpoint.sourceRuntimeId,
      plan.planHash,
      `runtime-${attemptId}`,
      `runtime-${attemptId}`,
      1,
      'running',
      occurredAt,
      occurredAt
    ]
  );
  databaseAdapter.execute('UPDATE chat_agent_tasks SET current_attempt_id = ? WHERE task_id = ?', [attemptId, taskId]);
  store.transitionTask({ taskId, toStatus: 'starting', occurredAt, source: 'coordinator' });
  store.transitionTask({ taskId, toStatus: 'running', occurredAt, source: 'runtime' });
}

describeWithSqlite('agent delegation store', (): void => {
  let database: InstanceType<typeof Database>;
  let adapter: AgentStoreDatabase;
  let store: AgentDelegationStore;

  beforeEach((): void => {
    database = new Database(':memory:');
    createAgentTables(database);
    adapter = createDatabaseAdapter(database);
    store = createAgentDelegationStore(adapter);
  });

  afterEach((): void => {
    database.close();
  });

  it('atomically persists immutable facts, ordered events, and one outbox record', (): void => {
    const input = createPreparedInput();
    let persistedAssistantCount = 0;

    store.prepareDelegation(input, (): undefined => {
      persistedAssistantCount += 1;
      return undefined;
    });

    expect(persistedAssistantCount).toBe(1);
    expect(store.getTask('task-1')?.contractSnapshot).toEqual(input.tasks[0].contractSnapshot);
    expect(store.getCheckpoint('checkpoint-1')).toMatchObject({
      status: 'waiting_children',
      version: 1,
      recordState: 'active'
    });
    expect(
      store.listEvents('checkpoint', 'checkpoint-1').map((event): { eventId: string; sequence: number; type: string } => ({
        eventId: event.eventId,
        sequence: event.sequence,
        type: event.type
      }))
    ).toEqual([
      {
        eventId: 'checkpoint:checkpoint-1:1:delegation.checkpoint_created',
        sequence: 1,
        type: 'delegation.checkpoint_created'
      },
      {
        eventId: 'checkpoint:checkpoint-1:2:primary.suspended',
        sequence: 2,
        type: 'primary.suspended'
      }
    ]);
    expect(store.listEvents('task', 'task-1')).toMatchObject([
      {
        eventId: 'task:task-1:1:task.created',
        sequence: 1,
        type: 'task.created',
        payload: { checkpointId: 'checkpoint-1', toolCallId: 'tool-call-1' }
      }
    ]);
    expect(store.listPendingOutbox()).toHaveLength(1);
  });

  it('rolls back every delegation fact when assistant persistence fails', (): void => {
    const input = createPreparedInput('rollback');

    expect((): void =>
      store.prepareDelegation(input, (): undefined => {
        throw new Error('assistant write failed');
      })
    ).toThrowError('assistant write failed');

    expect(store.getTask('task-rollback')).toBeNull();
    expect(store.getCheckpoint('checkpoint-rollback')).toBeNull();
    expect(store.listPendingOutbox()).toEqual([]);
  });

  it('rejects Task and Checkpoint event histories whose sequence does not start at one', (): void => {
    const input = createPreparedInput('event-start');
    store.prepareDelegation(input, (): undefined => undefined);
    allowEventCorruption(adapter);
    adapter.execute('DELETE FROM chat_agent_events WHERE aggregate_kind = ? AND aggregate_id = ? AND sequence = ?', ['task', input.tasks[0].taskId, 1]);
    adapter.execute('DELETE FROM chat_agent_events WHERE aggregate_kind = ? AND aggregate_id = ? AND sequence = ?', [
      'checkpoint',
      input.checkpoint.checkpointId,
      1
    ]);

    expect((): void => {
      store.listEvents('task', input.tasks[0].taskId);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect((): void => {
      store.listEvents('checkpoint', input.checkpoint.checkpointId);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects a Task event sequence gap and a broken status from-link', (): void => {
    const gapInput = createPreparedInput('event-gap');
    const gapPlan = createExecutionPlan(gapInput);
    store.prepareDelegation(gapInput, (): undefined => undefined);
    store.transitionTask({
      taskId: gapInput.tasks[0].taskId,
      toStatus: 'planning',
      occurredAt,
      source: 'coordinator'
    });
    store.transitionTask({
      taskId: gapInput.tasks[0].taskId,
      toStatus: 'authorized',
      occurredAt,
      source: 'coordinator',
      executionPlanSnapshot: gapPlan,
      executionPlanSnapshotHash: gapPlan.planHash
    });
    allowEventCorruption(adapter);
    adapter.execute('DELETE FROM chat_agent_events WHERE aggregate_kind = ? AND aggregate_id = ? AND sequence = ?', ['task', gapInput.tasks[0].taskId, 2]);
    expect((): void => {
      store.listEvents('task', gapInput.tasks[0].taskId);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));

    const linkInput = createPreparedInput('event-link');
    store.prepareDelegation(linkInput, (): undefined => undefined);
    store.transitionTask({
      taskId: linkInput.tasks[0].taskId,
      toStatus: 'planning',
      occurredAt,
      source: 'coordinator'
    });
    adapter.execute('UPDATE chat_agent_events SET payload_json = ? WHERE aggregate_kind = ? AND aggregate_id = ? AND sequence = ?', [
      JSON.stringify({ from: 'authorized', to: 'planning' }),
      'task',
      linkInput.tasks[0].taskId,
      2
    ]);
    expect((): void => {
      store.listEvents('task', linkInput.tasks[0].taskId);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects Task history when its projected status differs from the Task row', (): void => {
    const input = createPreparedInput('event-projection');
    store.prepareDelegation(input, (): undefined => undefined);
    adapter.execute('UPDATE chat_agent_tasks SET status = ? WHERE task_id = ?', ['planning', input.tasks[0].taskId]);

    expect((): void => {
      store.listEvents('task', input.tasks[0].taskId);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects active recovery when a Task creation Event no longer matches its identity', (): void => {
    const input = createPreparedInput('event-task-aggregate');
    store.prepareDelegation(input, (): undefined => undefined);
    allowEventCorruption(adapter);
    adapter.execute('UPDATE chat_agent_events SET payload_json = ? WHERE aggregate_kind = ? AND aggregate_id = ? AND sequence = ?', [
      JSON.stringify({ checkpointId: input.checkpoint.checkpointId, toolCallId: 'tool-call-forged' }),
      'task',
      input.tasks[0].taskId,
      1
    ]);

    expect((): void => {
      store.listActive();
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it.each(['invalid first Event', 'invalid suspended Event'] as const)('rejects active recovery with %s in Checkpoint history', (caseName): void => {
    const suffix = caseName === 'invalid first Event' ? 'event-checkpoint-first' : 'event-checkpoint-suspended';
    const input = createPreparedInput(suffix);
    store.prepareDelegation(input, (): undefined => undefined);
    allowEventCorruption(adapter);
    if (caseName === 'invalid first Event') {
      adapter.execute(
        'UPDATE chat_agent_events SET event_type = ?, source = ?, payload_json = ? WHERE aggregate_kind = ? AND aggregate_id = ? AND sequence = ?',
        ['primary.suspended', 'primary', JSON.stringify({ sourceRuntimeId: input.checkpoint.sourceRuntimeId }), 'checkpoint', input.checkpoint.checkpointId, 1]
      );
    } else {
      adapter.execute(
        'UPDATE chat_agent_events SET event_type = ?, source = ?, payload_json = ? WHERE aggregate_kind = ? AND aggregate_id = ? AND sequence = ?',
        [
          'child.result_recorded',
          'child',
          JSON.stringify({ toolCallId: input.tasks[0].toolCallId, resultHash: 'a'.repeat(64) }),
          'checkpoint',
          input.checkpoint.checkpointId,
          2
        ]
      );
    }

    expect((): void => {
      store.listActive();
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects a resume claim when Checkpoint history never reached ready', (): void => {
    const input = createPreparedInput('event-ready-missing');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    const ready = store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    allowEventCorruption(adapter);
    adapter.execute('DELETE FROM chat_agent_events WHERE aggregate_kind = ? AND aggregate_id = ? AND event_type = ?', [
      'checkpoint',
      input.checkpoint.checkpointId,
      'delegation.ready'
    ]);

    expect((): void => {
      store.claimResume({
        checkpointId: input.checkpoint.checkpointId,
        expectedVersion: ready.version,
        resumeRuntimeId: 'runtime-event-ready-missing',
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(store.getCheckpoint(input.checkpoint.checkpointId)?.status).toBe('ready_to_resume');
  });

  it('rejects active recovery when Checkpoint Event projection is ahead of its row', (): void => {
    const input = createPreparedInput('event-checkpoint-projection');
    store.prepareDelegation(input, (): undefined => undefined);
    adapter.execute(
      `INSERT INTO chat_agent_events (
        event_id, aggregate_kind, aggregate_id, checkpoint_id, sequence,
        event_type, occurred_at, source, schema_version, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `checkpoint:${input.checkpoint.checkpointId}:3:delegation.cancel_requested`,
        'checkpoint',
        input.checkpoint.checkpointId,
        input.checkpoint.checkpointId,
        3,
        'delegation.cancel_requested',
        occurredAt,
        'user',
        1,
        JSON.stringify({ reason: 'legacy_projection_mismatch' })
      ]
    );

    expect((): void => {
      store.listActive();
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it.each([
    ['async callback', (): Promise<void> => Promise.resolve()],
    ['thenable callback', (): { then: () => undefined } => ({ then: (): undefined => undefined })]
  ])('rejects %s and rolls back every delegation fact', (name: string, callback: () => unknown): void => {
    const suffix = name.startsWith('async') ? 'async-assistant' : 'thenable-assistant';
    const input = createPreparedInput(suffix);

    expect((): void => {
      store.prepareDelegation(input, callback as () => undefined);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));

    expectNoDelegationFacts(adapter);
  });

  it.each([
    [
      'padded Task ID',
      (): PrepareDelegationInput => {
        const input = createPreparedInput('padded-task');
        input.tasks[0] = { ...input.tasks[0], taskId: ` ${input.tasks[0].taskId}` };
        input.checkpoint.continuationSnapshot = {
          ...input.checkpoint.continuationSnapshot,
          orderedToolCalls: input.checkpoint.continuationSnapshot.orderedToolCalls.map((toolCall): typeof toolCall => ({
            ...toolCall,
            taskId: input.tasks[0].taskId
          }))
        };
        input.checkpoint.continuationSnapshotHash = hashAgentPayload({
          schemaVersion: input.checkpoint.continuationSnapshot.checkpointSchemaVersion,
          continuation: input.checkpoint.continuationSnapshot
        });
        return input;
      }
    ],
    [
      'oversized Outbox ID',
      (): PrepareDelegationInput => {
        const input = createPreparedInput('oversized-outbox');
        input.outbox = { ...input.outbox, outboxId: 'o'.repeat(257) };
        return input;
      }
    ],
    [
      'parent Agent mismatch',
      (): PrepareDelegationInput => {
        const input = createPreparedInput('parent-mismatch');
        input.tasks[0] = { ...input.tasks[0], parentAgentId: 'other-primary' };
        return input;
      }
    ],
    [
      'Outbox dedupe mismatch',
      (): PrepareDelegationInput => {
        const input = createPreparedInput('dedupe-mismatch');
        input.outbox = { ...input.outbox, dedupeKey: 'delegation.created:other-checkpoint' };
        return input;
      }
    ],
    [
      'duplicate Task IDs',
      (): PrepareDelegationInput => {
        const input = createTwoTaskInput('duplicate-task');
        input.tasks[1] = { ...input.tasks[1], taskId: input.tasks[0].taskId };
        input.checkpoint.continuationSnapshot = {
          ...input.checkpoint.continuationSnapshot,
          orderedToolCalls: input.checkpoint.continuationSnapshot.orderedToolCalls.map((toolCall, index): typeof toolCall =>
            index === 1 ? { ...toolCall, taskId: input.tasks[0].taskId } : toolCall
          )
        };
        input.checkpoint.continuationSnapshotHash = hashAgentPayload({
          schemaVersion: input.checkpoint.continuationSnapshot.checkpointSchemaVersion,
          continuation: input.checkpoint.continuationSnapshot
        });
        return input;
      }
    ],
    [
      'duplicate Agent IDs',
      (): PrepareDelegationInput => {
        const input = createTwoTaskInput('duplicate-agent');
        input.tasks[1] = { ...input.tasks[1], agentId: input.tasks[0].agentId };
        return input;
      }
    ],
    [
      'duplicate tool-call IDs',
      (): PrepareDelegationInput => {
        const input = createTwoTaskInput('duplicate-tool-call');
        input.tasks[1] = { ...input.tasks[1], toolCallId: input.tasks[0].toolCallId };
        input.checkpoint.continuationSnapshot = {
          ...input.checkpoint.continuationSnapshot,
          orderedToolCalls: input.checkpoint.continuationSnapshot.orderedToolCalls.map((toolCall, index): typeof toolCall =>
            index === 1 ? { ...toolCall, toolCallId: input.tasks[0].toolCallId } : toolCall
          )
        };
        input.checkpoint.continuationSnapshotHash = hashAgentPayload({
          schemaVersion: input.checkpoint.continuationSnapshot.checkpointSchemaVersion,
          continuation: input.checkpoint.continuationSnapshot
        });
        return input;
      }
    ],
    [
      'secret-shaped assistant message ID',
      (): PrepareDelegationInput => {
        const input = createPreparedInput('secret-assistant');
        input.checkpoint = {
          ...input.checkpoint,
          assistantMessageId: 'Authorization: Bearer stable-identity-secret'
        };
        return input;
      }
    ]
  ])('rejects invalid prepare identity: %s', (_name: string, createInput: () => PrepareDelegationInput): void => {
    expect((): void => {
      store.prepareDelegation(createInput(), (): undefined => undefined);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expectNoDelegationFacts(adapter);
  });

  it('rejects identity reuse with a different immutable contract hash', (): void => {
    const input = createPreparedInput('immutable');
    store.prepareDelegation(input, (): undefined => undefined);
    const conflictingInput = createPreparedInput('immutable');
    conflictingInput.tasks[0] = {
      ...conflictingInput.tasks[0],
      contractSnapshotHash: 'f'.repeat(64)
    };

    expect((): void => store.prepareDelegation(conflictingInput, (): undefined => undefined)).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(store.getTask('task-immutable')?.contractSnapshotHash).toBe(input.tasks[0].contractSnapshotHash);
  });

  it('writes an execution plan once at authorization and never replaces it', (): void => {
    const input = createPreparedInput('plan');
    store.prepareDelegation(input, (): undefined => undefined);
    const plan = createExecutionPlan(input);

    store.transitionTask({ taskId: 'task-plan', toStatus: 'planning', occurredAt, source: 'coordinator' });
    const authorized = store.transitionTask({
      taskId: 'task-plan',
      toStatus: 'authorized',
      executionPlanSnapshot: plan,
      executionPlanSnapshotHash: plan.planHash,
      occurredAt,
      source: 'coordinator'
    });

    expect(authorized.executionPlanSnapshot).toEqual(plan);
    expect((): void => {
      store.transitionTask({
        taskId: 'task-plan',
        toStatus: 'queued',
        queuePhase: 'start',
        executionPlanSnapshot: { ...plan, policyVersion: 'expanded-v2' },
        executionPlanSnapshotHash: 'f'.repeat(64),
        occurredAt,
        source: 'coordinator'
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(store.getTask('task-plan')?.executionPlanSnapshotHash).toBe(plan.planHash);
  });

  it.each(['completed', 'failed', 'cancelled', 'deadline_exceeded', 'commit_failed'] as const)(
    'rejects generic transitionTask terminalization to %s',
    (terminalStatus): void => {
      const input = createPreparedInput(`terminal-${terminalStatus}`);
      const { taskId } = input.tasks[0];
      store.prepareDelegation(input, (): undefined => undefined);
      startTask(store, input, adapter);
      const eventCount = store.listEvents('task', taskId).length;

      expect((): void => {
        store.transitionTask({
          taskId,
          toStatus: terminalStatus,
          occurredAt,
          source: 'coordinator'
        });
      }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));

      expect(store.getTask(taskId)?.status).toBe('running');
      expect(store.getCheckpoint(input.checkpoint.checkpointId)?.status).toBe('waiting_children');
      expect(store.listEvents('task', taskId)).toHaveLength(eventCount);
    }
  );

  it('records an identical terminal result once and rejects conflicting replay', (): void => {
    const input = createPreparedInput('result');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult('task-result');
    const resultHash = hashAgentPayload(result);

    const checkpoint = store.recordTaskResult({
      taskId: 'task-result',
      checkpointId: 'checkpoint-result',
      toolCallId: 'tool-call-result',
      result,
      resultHash,
      occurredAt
    });
    const replay = store.recordTaskResult({
      taskId: 'task-result',
      checkpointId: 'checkpoint-result',
      toolCallId: 'tool-call-result',
      result,
      resultHash,
      occurredAt
    });

    expect(checkpoint).toMatchObject({ status: 'ready_to_resume' });
    expect(replay).toEqual(checkpoint);
    expect((): void => {
      store.recordTaskResult({
        taskId: 'task-result',
        checkpointId: 'checkpoint-result',
        toolCallId: 'tool-call-result',
        result: { ...result, summary: 'Conflicting replay' },
        resultHash: hashAgentPayload({ ...result, summary: 'Conflicting replay' }),
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects result replay when the matching Checkpoint terminal envelope is missing', (): void => {
    const input = createPreparedInput('result-replay-envelope');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    const resultHash = hashAgentPayload(result);
    store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash,
      occurredAt
    });
    adapter.execute('UPDATE chat_agent_delegation_checkpoints SET status = ?, terminal_results_json = ? WHERE checkpoint_id = ?', [
      'waiting_children',
      '{}',
      input.checkpoint.checkpointId
    ]);
    const eventCount = adapter.select<{ event_count: number }>('SELECT COUNT(*) AS event_count FROM chat_agent_events WHERE checkpoint_id = ?', [
      input.checkpoint.checkpointId
    ])[0]?.event_count;

    expect((): void => {
      store.recordTaskResult({
        taskId: input.tasks[0].taskId,
        checkpointId: input.checkpoint.checkpointId,
        toolCallId: input.tasks[0].toolCallId,
        result,
        resultHash,
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(store.getCheckpoint(input.checkpoint.checkpointId)).toMatchObject({
      status: 'waiting_children',
      terminalResults: {}
    });
    expect(
      adapter.select<{ event_count: number }>('SELECT COUNT(*) AS event_count FROM chat_agent_events WHERE checkpoint_id = ?', [
        input.checkpoint.checkpointId
      ])[0]?.event_count
    ).toBe(eventCount);
  });

  it.each(['missing current attempt', 'forged attempt plan'] as const)('rejects a result with %s without partial projection', (caseName): void => {
    const suffix = caseName.startsWith('missing') ? 'missing-attempt' : 'forged-attempt';
    const input = createPreparedInput(suffix);
    const { taskId } = input.tasks[0];
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const taskEventCount = store.listEvents('task', taskId).length;
    if (caseName.startsWith('missing')) {
      adapter.execute('UPDATE chat_agent_tasks SET current_attempt_id = NULL WHERE task_id = ?', [taskId]);
    } else {
      // 模拟触发器上线前遗留的损坏数据库，继续验证 Store 恢复边界 fail-closed。
      adapter.execute('DROP TRIGGER trg_chat_agent_attempts_immutable');
      adapter.execute('UPDATE chat_agent_attempts SET plan_hash = ? WHERE task_id = ?', ['f'.repeat(64), taskId]);
    }
    const result = createTaskResult(taskId);

    expect((): void => {
      store.recordTaskResult({
        taskId,
        checkpointId: input.checkpoint.checkpointId,
        toolCallId: input.tasks[0].toolCallId,
        result,
        resultHash: hashAgentPayload(result),
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));

    expect(adapter.select<{ status: string }>('SELECT status FROM chat_agent_tasks WHERE task_id = ?', [taskId])[0]?.status).toBe('running');
    expect(store.getCheckpoint(input.checkpoint.checkpointId)).toMatchObject({
      status: 'waiting_children',
      terminalResults: {}
    });
    expect(adapter.select<{ event_count: number }>('SELECT COUNT(*) AS event_count FROM chat_agent_events WHERE task_id = ?', [taskId])[0]?.event_count).toBe(
      taskEventCount
    );
  });

  it('rejects a running Task without a current Attempt identity', (): void => {
    const input = createPreparedInput('running-missing-attempt');
    const { taskId } = input.tasks[0];
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    adapter.execute('UPDATE chat_agent_tasks SET current_attempt_id = NULL WHERE task_id = ?', [taskId]);

    expect((): void => {
      store.getTask(taskId);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects an unknown persisted Attempt status before recording a result', (): void => {
    const input = createPreparedInput('attempt-status');
    const { taskId } = input.tasks[0];
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    adapter.execute('UPDATE chat_agent_attempts SET status = ? WHERE task_id = ?', ['legacy-unknown', taskId]);
    const result = createTaskResult(taskId);

    expect((): void => {
      store.recordTaskResult({
        taskId,
        checkpointId: input.checkpoint.checkpointId,
        toolCallId: input.tasks[0].toolCallId,
        result,
        resultHash: hashAgentPayload(result),
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(store.getTask(taskId)?.status).toBe('running');
    expect(store.getCheckpoint(input.checkpoint.checkpointId)?.terminalResults).toEqual({});
    expect(adapter.select<{ status: string }>('SELECT status FROM chat_agent_attempts WHERE task_id = ?', [taskId])[0]?.status).toBe('legacy-unknown');
  });

  it.each(['terminal without finished time', 'nonterminal with finished time', 'completed with error', 'failed without error'] as const)(
    'rejects persisted Attempt lifecycle contradiction: %s',
    (caseName): void => {
      const suffix = caseName.replaceAll(' ', '-');
      const input = createPreparedInput(`attempt-lifecycle-${suffix}`);
      const { taskId } = input.tasks[0];
      store.prepareDelegation(input, (): undefined => undefined);
      startTask(store, input, adapter);

      if (caseName === 'nonterminal with finished time') {
        adapter.execute('UPDATE chat_agent_attempts SET finished_at = ? WHERE task_id = ?', [occurredAt, taskId]);
      } else {
        const result = caseName === 'failed without error' ? createFailedResult(taskId) : createTaskResult(taskId);
        store.recordTaskResult({
          taskId,
          checkpointId: input.checkpoint.checkpointId,
          toolCallId: input.tasks[0].toolCallId,
          result,
          resultHash: hashAgentPayload(result),
          occurredAt
        });
        if (caseName === 'terminal without finished time') {
          adapter.execute('UPDATE chat_agent_attempts SET finished_at = NULL WHERE task_id = ?', [taskId]);
        } else if (caseName === 'completed with error') {
          adapter.execute('UPDATE chat_agent_attempts SET error_json = ? WHERE task_id = ?', [
            JSON.stringify({
              code: 'runtime_failed',
              phase: 'runtime',
              category: 'runtime',
              retryable: false,
              details: { reason: 'legacy_completed_error' }
            }),
            taskId
          ]);
        } else {
          adapter.execute('UPDATE chat_agent_attempts SET error_json = NULL WHERE task_id = ?', [taskId]);
        }
      }

      expect((): void => {
        store.listActive();
      }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    }
  );

  it.each(['missing criterion', 'extra criterion'] as const)('rejects a result with %s without partial projection', (caseName): void => {
    const suffix = caseName.startsWith('missing') ? 'missing-criterion' : 'extra-criterion';
    const input = createPreparedInput(suffix);
    const { taskId } = input.tasks[0];
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const baseResult = createTaskResult(taskId);
    const result: ChatAgentResult = {
      ...baseResult,
      completion:
        caseName === 'missing criterion'
          ? { level: 'none', criteria: [] }
          : {
              level: 'partial',
              criteria: [
                ...baseResult.completion.criteria,
                {
                  criterionIndex: 1,
                  claim: {
                    status: 'unsatisfied',
                    summary: 'No second criterion exists.',
                    evidence: []
                  },
                  verification: {
                    status: 'unverified',
                    verifier: 'coordinator',
                    evidence: []
                  }
                }
              ]
            }
    };

    expect((): void => {
      store.recordTaskResult({
        taskId,
        checkpointId: input.checkpoint.checkpointId,
        toolCallId: input.tasks[0].toolCallId,
        result,
        resultHash: hashAgentPayload(result),
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(store.getTask(taskId)?.status).toBe('running');
    expect(store.getCheckpoint(input.checkpoint.checkpointId)?.terminalResults).toEqual({});
  });

  it('rejects a persisted Task result whose identity does not match its row', (): void => {
    const input = createPreparedInput('corrupt-task-result');
    const { taskId } = input.tasks[0];
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(taskId);
    store.recordTaskResult({
      taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    const corruptedResult = { ...result, agentId: 'forged-child' };
    // 模拟触发器上线前遗留的损坏数据库，继续验证读取 validator 不信任旧数据。
    adapter.execute('DROP TRIGGER trg_chat_agent_tasks_result_once');
    adapter.execute('UPDATE chat_agent_tasks SET result_json = ?, result_hash = ? WHERE task_id = ?', [
      JSON.stringify(corruptedResult),
      hashAgentPayload(corruptedResult),
      taskId
    ]);

    expect((): void => {
      store.getTask(taskId);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it.each([
    'queued without queue phase',
    'queue phase outside queued',
    'terminal status without result',
    'result status mismatch',
    'result on nonterminal status',
    'error mismatch'
  ] as const)('rejects persisted Task cross-field corruption: %s', (caseName): void => {
    const suffix = caseName.replaceAll(' ', '-');
    const input = createPreparedInput(`task-cross-${suffix}`);
    const { taskId } = input.tasks[0];
    store.prepareDelegation(input, (): undefined => undefined);
    const needsResult = ['result status mismatch', 'result on nonterminal status', 'error mismatch'].includes(caseName);
    if (needsResult) {
      startTask(store, input, adapter);
      const result = createTaskResult(taskId);
      store.recordTaskResult({
        taskId,
        checkpointId: input.checkpoint.checkpointId,
        toolCallId: input.tasks[0].toolCallId,
        result,
        resultHash: hashAgentPayload(result),
        occurredAt
      });
    }
    allowResultCorruption(adapter);
    if (caseName === 'queued without queue phase') {
      adapter.execute('UPDATE chat_agent_tasks SET status = ?, queue_phase = NULL WHERE task_id = ?', ['queued', taskId]);
    } else if (caseName === 'queue phase outside queued') {
      adapter.execute('UPDATE chat_agent_tasks SET queue_phase = ? WHERE task_id = ?', ['start', taskId]);
    } else if (caseName === 'terminal status without result') {
      adapter.execute('UPDATE chat_agent_tasks SET status = ? WHERE task_id = ?', ['completed', taskId]);
    } else if (caseName === 'result status mismatch') {
      adapter.execute('UPDATE chat_agent_tasks SET status = ? WHERE task_id = ?', ['failed', taskId]);
    } else if (caseName === 'result on nonterminal status') {
      adapter.execute('UPDATE chat_agent_tasks SET status = ? WHERE task_id = ?', ['running', taskId]);
    } else {
      adapter.execute('UPDATE chat_agent_tasks SET error_json = ? WHERE task_id = ?', [
        JSON.stringify({
          code: 'runtime_failed',
          phase: 'runtime',
          category: 'runtime',
          retryable: false,
          details: { reason: 'legacy_error_mismatch' }
        }),
        taskId
      ]);
    }

    expect((): void => {
      store.getTask(taskId);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects a terminal result key outside the frozen ordered tool calls', (): void => {
    const input = createPreparedInput('corrupt-terminal-key');
    const { taskId } = input.tasks[0];
    store.prepareDelegation(input, (): undefined => undefined);
    const result = createTaskResult(taskId);
    const resultHash = hashAgentPayload(result);
    adapter.execute('UPDATE chat_agent_delegation_checkpoints SET terminal_results_json = ? WHERE checkpoint_id = ?', [
      JSON.stringify({
        'forged-tool-call': { result, resultHash }
      }),
      input.checkpoint.checkpointId
    ]);

    expect((): void => {
      store.getCheckpoint(input.checkpoint.checkpointId);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it.each(['missing criterion', 'extra criterion'] as const)('rejects persisted terminal results with %s', (caseName): void => {
    const suffix = caseName.startsWith('missing') ? 'persisted-missing-criterion' : 'persisted-extra-criterion';
    const input = createPreparedInput(suffix);
    const { taskId } = input.tasks[0];
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const baseResult = createTaskResult(taskId);
    const result: ChatAgentResult = {
      ...baseResult,
      completion:
        caseName === 'missing criterion'
          ? { level: 'none', criteria: [] }
          : {
              level: 'partial',
              criteria: [
                ...baseResult.completion.criteria,
                {
                  criterionIndex: 1,
                  claim: {
                    status: 'unsatisfied',
                    summary: 'No second criterion exists.',
                    evidence: []
                  },
                  verification: {
                    status: 'unverified',
                    verifier: 'coordinator',
                    evidence: []
                  }
                }
              ]
            }
    };
    const resultHash = hashAgentPayload(result);
    adapter.execute('UPDATE chat_agent_tasks SET status = ?, result_json = ?, result_hash = ? WHERE task_id = ?', [
      result.executionStatus,
      JSON.stringify(result),
      resultHash,
      taskId
    ]);
    adapter.execute('UPDATE chat_agent_delegation_checkpoints SET terminal_results_json = ? WHERE checkpoint_id = ?', [
      JSON.stringify({
        [input.tasks[0].toolCallId]: { result, resultHash }
      }),
      input.checkpoint.checkpointId
    ]);

    expect((): void => {
      store.getCheckpoint(input.checkpoint.checkpointId);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('uses checkpoint version CAS so resume can be claimed only once', (): void => {
    const input = createPreparedInput('resume');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult('task-resume');
    const ready = store.recordTaskResult({
      taskId: 'task-resume',
      checkpointId: 'checkpoint-resume',
      toolCallId: 'tool-call-resume',
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });

    const claimed = store.claimResume({
      checkpointId: 'checkpoint-resume',
      expectedVersion: ready.version,
      resumeRuntimeId: 'runtime-b',
      occurredAt
    });
    const duplicate = store.claimResume({
      checkpointId: 'checkpoint-resume',
      expectedVersion: ready.version,
      resumeRuntimeId: 'runtime-b-duplicate',
      occurredAt
    });

    expect(claimed).toMatchObject({ status: 'resuming', resumeRuntimeId: 'runtime-b' });
    expect(duplicate).toBeNull();
  });

  it.each(['claim', 'listActive', 'finalize'] as const)(
    'rejects %s when terminal results have no exact child.result_recorded Event set',
    (entryPoint): void => {
      const input = createPreparedInput(`result-event-${entryPoint}`);
      store.prepareDelegation(input, (): undefined => undefined);
      startTask(store, input, adapter);
      const result = createTaskResult(input.tasks[0].taskId);
      const ready = store.recordTaskResult({
        taskId: input.tasks[0].taskId,
        checkpointId: input.checkpoint.checkpointId,
        toolCallId: input.tasks[0].toolCallId,
        result,
        resultHash: hashAgentPayload(result),
        occurredAt
      });
      const resumeRuntimeId = `runtime-result-event-${entryPoint}`;
      const claimed =
        entryPoint === 'finalize'
          ? store.claimResume({
              checkpointId: input.checkpoint.checkpointId,
              expectedVersion: ready.version,
              resumeRuntimeId,
              occurredAt
            })
          : null;
      if (entryPoint === 'finalize' && !claimed) throw new Error('Checkpoint must be claimable');

      // 模拟旧库删除结果审计 Event 后重排连续 sequence，避免序列缺口提前暴露损坏。
      allowEventCorruption(adapter);
      adapter.execute("DELETE FROM chat_agent_events WHERE checkpoint_id = ? AND event_type = 'child.result_recorded'", [input.checkpoint.checkpointId]);
      adapter.execute("UPDATE chat_agent_events SET sequence = ? WHERE checkpoint_id = ? AND event_type = 'delegation.ready'", [
        3,
        input.checkpoint.checkpointId
      ]);
      if (entryPoint === 'finalize') {
        adapter.execute("UPDATE chat_agent_events SET sequence = ? WHERE checkpoint_id = ? AND event_type = 'primary.resume_started'", [
          4,
          input.checkpoint.checkpointId
        ]);
      }

      expect((): void => {
        if (entryPoint === 'claim') {
          store.claimResume({
            checkpointId: input.checkpoint.checkpointId,
            expectedVersion: ready.version,
            resumeRuntimeId,
            occurredAt
          });
        } else if (entryPoint === 'listActive') {
          store.listActive();
        } else {
          store.finalizeResume({
            checkpointId: input.checkpoint.checkpointId,
            expectedVersion: claimed?.version ?? 0,
            resumeRuntimeId,
            outcome: 'completed',
            occurredAt
          });
        }
      }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    }
  );

  it('rejects a resume claim when ready results are incomplete', (): void => {
    const input = createPreparedInput('resume-incomplete');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    const ready = store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    adapter.execute('UPDATE chat_agent_delegation_checkpoints SET terminal_results_json = ? WHERE checkpoint_id = ?', ['{}', input.checkpoint.checkpointId]);

    expect((): void => {
      store.claimResume({
        checkpointId: input.checkpoint.checkpointId,
        expectedVersion: ready.version,
        resumeRuntimeId: 'runtime-resume-incomplete',
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects a resume claim when Task identity no longer matches its Checkpoint', (): void => {
    const input = createPreparedInput('resume-identity');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    const ready = store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    allowTaskCorruption(adapter);
    adapter.execute('UPDATE chat_agent_tasks SET root_runtime_id = ? WHERE task_id = ?', ['runtime-root-forged', input.tasks[0].taskId]);

    expect((): void => {
      store.claimResume({
        checkpointId: input.checkpoint.checkpointId,
        expectedVersion: ready.version,
        resumeRuntimeId: 'runtime-resume-identity',
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects a resume claim when its completed Task has no persisted Attempt', (): void => {
    const input = createPreparedInput('resume-attempt-missing');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    const ready = store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    adapter.execute('DROP TRIGGER trg_chat_agent_attempts_no_delete');
    adapter.execute('DELETE FROM chat_agent_attempts WHERE task_id = ?', [input.tasks[0].taskId]);

    expect((): void => {
      store.claimResume({
        checkpointId: input.checkpoint.checkpointId,
        expectedVersion: ready.version,
        resumeRuntimeId: 'runtime-resume-attempt-missing',
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it.each(['forged plan', 'mismatched terminal status'] as const)('rejects active recovery with an Attempt whose %s is invalid', (caseName): void => {
    const suffix = caseName === 'forged plan' ? 'active-attempt-plan' : 'active-attempt-status';
    const input = createPreparedInput(suffix);
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    if (caseName === 'forged plan') {
      adapter.execute('DROP TRIGGER trg_chat_agent_attempts_immutable');
      adapter.execute('UPDATE chat_agent_attempts SET plan_hash = ? WHERE task_id = ?', ['f'.repeat(64), input.tasks[0].taskId]);
    } else {
      adapter.execute('UPDATE chat_agent_attempts SET status = ? WHERE task_id = ?', ['failed', input.tasks[0].taskId]);
    }

    expect((): void => {
      store.listActive();
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('finalizes a resume idempotently for the same Runtime and outcome', (): void => {
    const input = createPreparedInput('finalize-replay');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    const ready = store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    const claimed = store.claimResume({
      checkpointId: input.checkpoint.checkpointId,
      expectedVersion: ready.version,
      resumeRuntimeId: 'runtime-finalize-replay',
      occurredAt
    });
    if (!claimed) throw new Error('Checkpoint must be claimable');
    const finalizeInput = {
      checkpointId: input.checkpoint.checkpointId,
      expectedVersion: claimed.version,
      resumeRuntimeId: 'runtime-finalize-replay',
      outcome: 'completed' as const,
      occurredAt
    };
    const finalized = store.finalizeResume(finalizeInput);
    const eventCount = store.listEvents('checkpoint', input.checkpoint.checkpointId).length;

    const replay = store.finalizeResume(finalizeInput);

    expect(replay).toEqual(finalized);
    expect(store.listEvents('checkpoint', input.checkpoint.checkpointId)).toHaveLength(eventCount);
  });

  it('rejects finalized resume conflicts from another Runtime or outcome', (): void => {
    const input = createPreparedInput('finalize-conflict');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    const ready = store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    const claimed = store.claimResume({
      checkpointId: input.checkpoint.checkpointId,
      expectedVersion: ready.version,
      resumeRuntimeId: 'runtime-finalize-owner',
      occurredAt
    });
    if (!claimed) throw new Error('Checkpoint must be claimable');
    store.finalizeResume({
      checkpointId: input.checkpoint.checkpointId,
      expectedVersion: claimed.version,
      resumeRuntimeId: 'runtime-finalize-owner',
      outcome: 'completed',
      occurredAt
    });

    expect((): void => {
      store.finalizeResume({
        checkpointId: input.checkpoint.checkpointId,
        expectedVersion: claimed.version,
        resumeRuntimeId: 'runtime-finalize-other',
        outcome: 'completed',
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect((): void => {
      store.finalizeResume({
        checkpointId: input.checkpoint.checkpointId,
        expectedVersion: claimed.version,
        resumeRuntimeId: 'runtime-finalize-owner',
        outcome: 'failed',
        error: {
          code: 'runtime_failed',
          phase: 'recovery',
          category: 'runtime',
          retryable: false,
          details: { reason: 'conflicting_outcome' }
        },
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects resume finalization after the Checkpoint leaves the active record scope', (): void => {
    const input = createPreparedInput('finalize-tombstoned');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    const ready = store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    const claimed = store.claimResume({
      checkpointId: input.checkpoint.checkpointId,
      expectedVersion: ready.version,
      resumeRuntimeId: 'runtime-finalize-tombstoned',
      occurredAt
    });
    if (!claimed) throw new Error('Checkpoint must be claimable');
    adapter.execute('UPDATE chat_agent_delegation_checkpoints SET record_state = ? WHERE checkpoint_id = ?', ['tombstoned', input.checkpoint.checkpointId]);
    const eventCount = store.listEvents('checkpoint', input.checkpoint.checkpointId).length;

    expect((): void => {
      store.finalizeResume({
        checkpointId: input.checkpoint.checkpointId,
        expectedVersion: claimed.version,
        resumeRuntimeId: 'runtime-finalize-tombstoned',
        outcome: 'completed',
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(store.getCheckpoint(input.checkpoint.checkpointId)).toMatchObject({
      status: 'resuming',
      recordState: 'tombstoned'
    });
    expect(store.listEvents('checkpoint', input.checkpoint.checkpointId)).toHaveLength(eventCount);
  });

  it.each(['missing terminal results', 'missing Attempt'] as const)('rejects resume finalization with %s after claim', (caseName): void => {
    const suffix = caseName === 'missing terminal results' ? 'finalize-results-missing' : 'finalize-attempt-missing';
    const input = createPreparedInput(suffix);
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    const ready = store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    const claimed = store.claimResume({
      checkpointId: input.checkpoint.checkpointId,
      expectedVersion: ready.version,
      resumeRuntimeId: `runtime-${suffix}`,
      occurredAt
    });
    if (!claimed) throw new Error('Checkpoint must be claimable');
    if (caseName === 'missing terminal results') {
      adapter.execute('UPDATE chat_agent_delegation_checkpoints SET terminal_results_json = ? WHERE checkpoint_id = ?', ['{}', input.checkpoint.checkpointId]);
    } else {
      adapter.execute('DROP TRIGGER trg_chat_agent_attempts_no_delete');
      adapter.execute('DELETE FROM chat_agent_attempts WHERE task_id = ?', [input.tasks[0].taskId]);
    }

    expect((): void => {
      store.finalizeResume({
        checkpointId: input.checkpoint.checkpointId,
        expectedVersion: claimed.version,
        resumeRuntimeId: `runtime-${suffix}`,
        outcome: 'completed',
        occurredAt
      });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(
      adapter.select<{ status: string }>('SELECT status FROM chat_agent_delegation_checkpoints WHERE checkpoint_id = ?', [input.checkpoint.checkpointId])[0]
        ?.status
    ).toBe('resuming');
    expect(
      adapter.select<{ event_count: number }>('SELECT COUNT(*) AS event_count FROM chat_agent_events WHERE checkpoint_id = ? AND event_type = ?', [
        input.checkpoint.checkpointId,
        'delegation.completed'
      ])[0]?.event_count
    ).toBe(0);
  });

  it('tombstones only terminal unreferenced tasks and preserves immutable history', (): void => {
    const input = createPreparedInput('tombstone');
    store.prepareDelegation(input, (): undefined => undefined);

    expect((): void => {
      store.tombstoneTask({ taskId: 'task-tombstone', reason: 'user_removed', occurredAt, source: 'user' });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));

    startTask(store, input, adapter);
    const result = createTaskResult('task-tombstone');
    const ready = store.recordTaskResult({
      taskId: 'task-tombstone',
      checkpointId: 'checkpoint-tombstone',
      toolCallId: 'tool-call-tombstone',
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });

    expect((): void => {
      store.tombstoneTask({ taskId: 'task-tombstone', reason: 'user_removed', occurredAt, source: 'user' });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));

    const claimed = store.claimResume({
      checkpointId: 'checkpoint-tombstone',
      expectedVersion: ready.version,
      resumeRuntimeId: 'runtime-b-tombstone',
      occurredAt
    });
    if (!claimed) throw new Error('Checkpoint must be claimable');
    store.finalizeResume({
      checkpointId: 'checkpoint-tombstone',
      expectedVersion: claimed.version,
      resumeRuntimeId: 'runtime-b-tombstone',
      outcome: 'completed',
      occurredAt
    });
    adapter.execute('UPDATE chat_agent_tasks SET unfinished_journal_count = 1 WHERE task_id = ?', ['task-tombstone']);

    expect((): void => {
      store.tombstoneTask({ taskId: 'task-tombstone', reason: 'user_removed', occurredAt, source: 'user' });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));

    adapter.execute('UPDATE chat_agent_tasks SET unfinished_journal_count = 0 WHERE task_id = ?', ['task-tombstone']);
    adapter.execute(
      `INSERT INTO chat_agent_attempts (
        attempt_id, task_id, attempt_number, parent_runtime_id, plan_hash, initial_runtime_id,
        current_runtime_id, runtime_sequence, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'attempt-live',
        'task-tombstone',
        2,
        'runtime-a-tombstone',
        createExecutionPlan(input).planHash,
        'runtime-child',
        'runtime-child',
        1,
        'running',
        occurredAt
      ]
    );

    expect((): void => {
      store.tombstoneTask({ taskId: 'task-tombstone', reason: 'user_removed', occurredAt, source: 'user' });
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));

    adapter.execute("UPDATE chat_agent_attempts SET status = 'completed', finished_at = ? WHERE attempt_id = ?", [occurredAt, 'attempt-live']);
    const before = store.getTask('task-tombstone');
    const tombstoned = store.tombstoneTask({
      taskId: 'task-tombstone',
      reason: 'user_removed',
      occurredAt,
      source: 'user'
    });

    expect(tombstoned.recordState).toBe('tombstoned');
    expect(tombstoned.contractSnapshot).toEqual(before?.contractSnapshot);
    expect(tombstoned.result).toEqual(before?.result);
    expect(store.listEvents('task', 'task-tombstone').at(-1)?.type).toBe('task.tombstoned');
  });

  it('persists cooperative cancellation before terminalizing a safe checkpoint', (): void => {
    const input = createPreparedInput('cancel');
    store.prepareDelegation(input, (): undefined => undefined);
    adapter.execute(
      `INSERT INTO chat_agent_attempts (
        attempt_id, task_id, attempt_number, parent_runtime_id, plan_hash, initial_runtime_id,
        current_runtime_id, runtime_sequence, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['attempt-cancel', 'task-cancel', 1, 'runtime-a-cancel', 'a'.repeat(64), 'runtime-child-cancel', 'runtime-child-cancel', 1, 'running', occurredAt]
    );

    const cancelling = store.cancelCheckpoint({
      checkpointId: 'checkpoint-cancel',
      reason: 'user_requested',
      occurredAt
    });

    expect(cancelling.status).toBe('cancelling');
    expect(store.getTask('task-cancel')).toMatchObject({
      status: 'cancelling',
      cancelRequestedAt: occurredAt
    });
    expect(store.listEvents('task', 'task-cancel').at(-1)?.type).toBe('task.status_changed');
    expect(store.listEvents('checkpoint', 'checkpoint-cancel').at(-1)?.type).toBe('delegation.cancel_requested');

    adapter.execute("UPDATE chat_agent_attempts SET status = 'completed', finished_at = ? WHERE attempt_id = ?", [occurredAt, 'attempt-cancel']);
    const cancelled = store.cancelCheckpoint({
      checkpointId: 'checkpoint-cancel',
      reason: 'user_requested',
      occurredAt
    });

    expect(cancelled.status).toBe('cancelled');
    expect(store.getTask('task-cancel')).toMatchObject({
      status: 'cancelled',
      cancelRequestedAt: occurredAt
    });
    expect(store.listEvents('task', 'task-cancel').at(-1)?.type).toBe('task.cancelled');
    expect(store.listEvents('checkpoint', 'checkpoint-cancel').at(-1)?.type).toBe('delegation.completed');
  });

  it('interrupts every nonterminal checkpoint while preserving persisted results', (): void => {
    const input = createPreparedInput('interrupt');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const reason = {
      code: 'runtime_interrupted' as const,
      phase: 'recovery' as const,
      category: 'runtime' as const,
      retryable: false,
      details: { reason: 'process_restart' }
    };

    expect(store.interruptActive(reason)).toBe(1);
    expect(store.getCheckpoint('checkpoint-interrupt')).toMatchObject({
      status: 'interrupted',
      terminalResults: {}
    });
    expect(store.getTask('task-interrupt')).toMatchObject({
      status: 'cancelled',
      cancelRequestedAt: expect.any(String)
    });
    expect(adapter.select<{ status: string }>('SELECT status FROM chat_agent_attempts WHERE attempt_id = ?', ['attempt-task-interrupt'])[0]?.status).toBe(
      'interrupted'
    );
    expect(
      store
        .listEvents('task', 'task-interrupt')
        .slice(-2)
        .map((event): string => event.type)
    ).toEqual(['task.status_changed', 'task.cancelled']);
    expect(store.listEvents('checkpoint', 'checkpoint-interrupt').at(-1)?.type).toBe('delegation.interrupted');
  });

  it('leaves a journal-blocked recovery aggregate completely unchanged', (): void => {
    const input = createPreparedInput('interrupt-journal');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    adapter.execute('UPDATE chat_agent_tasks SET unfinished_journal_count = ? WHERE task_id = ?', [1, input.tasks[0].taskId]);
    const reason = {
      code: 'runtime_interrupted' as const,
      phase: 'recovery' as const,
      category: 'runtime' as const,
      retryable: false,
      details: { reason: 'process_restart' }
    };
    const checkpointBefore = store.getCheckpoint(input.checkpoint.checkpointId);
    const taskBefore = store.getTask(input.tasks[0].taskId);
    const attemptBefore = adapter.select<{ status: string; finished_at: string | null; error_json: string | null }>(
      'SELECT status, finished_at, error_json FROM chat_agent_attempts WHERE attempt_id = ?',
      [`attempt-${input.tasks[0].taskId}`]
    )[0];
    const eventsBefore = store.listEvents('checkpoint', input.checkpoint.checkpointId);

    expect(store.interruptActive(reason)).toBe(0);
    expect(store.getCheckpoint(input.checkpoint.checkpointId)).toEqual(checkpointBefore);
    expect(store.getTask(input.tasks[0].taskId)).toEqual(taskBefore);
    expect(
      adapter.select<{ status: string; finished_at: string | null; error_json: string | null }>(
        'SELECT status, finished_at, error_json FROM chat_agent_attempts WHERE attempt_id = ?',
        [`attempt-${input.tasks[0].taskId}`]
      )[0]
    ).toEqual(attemptBefore);
    expect(store.listEvents('checkpoint', input.checkpoint.checkpointId)).toEqual(eventsBefore);
    expect(eventsBefore.some((event): boolean => event.type === 'delegation.interrupted')).toBe(false);
  });

  it('interrupts safe recovery aggregates while preserving a journal-blocked neighbor', (): void => {
    const blockedInput = createPreparedInput('interrupt-mixed-blocked');
    store.prepareDelegation(blockedInput, (): undefined => undefined);
    startTask(store, blockedInput, adapter);
    adapter.execute('UPDATE chat_agent_tasks SET unfinished_journal_count = ? WHERE task_id = ?', [1, blockedInput.tasks[0].taskId]);
    const safeInput = createPreparedInput('interrupt-mixed-safe');
    store.prepareDelegation(safeInput, (): undefined => undefined);
    startTask(store, safeInput, adapter);
    const reason = {
      code: 'runtime_interrupted' as const,
      phase: 'recovery' as const,
      category: 'runtime' as const,
      retryable: false,
      details: { reason: 'process_restart' }
    };

    expect(store.interruptActive(reason)).toBe(1);
    expect(store.getCheckpoint(blockedInput.checkpoint.checkpointId)?.status).toBe('waiting_children');
    expect(store.getTask(blockedInput.tasks[0].taskId)).toMatchObject({
      status: 'running',
      unfinishedJournalCount: 1
    });
    expect(
      adapter.select<{ status: string }>('SELECT status FROM chat_agent_attempts WHERE attempt_id = ?', [`attempt-${blockedInput.tasks[0].taskId}`])[0]?.status
    ).toBe('running');
    expect(store.listEvents('checkpoint', blockedInput.checkpoint.checkpointId).some((event): boolean => event.type === 'delegation.interrupted')).toBe(false);
    expect(store.getCheckpoint(safeInput.checkpoint.checkpointId)?.status).toBe('interrupted');
    expect(store.getTask(safeInput.tasks[0].taskId)?.status).toBe('cancelled');
    expect(
      adapter.select<{ status: string }>('SELECT status FROM chat_agent_attempts WHERE attempt_id = ?', [`attempt-${safeInput.tasks[0].taskId}`])[0]?.status
    ).toBe('interrupted');
    expect(store.listEvents('checkpoint', safeInput.checkpoint.checkpointId).at(-1)?.type).toBe('delegation.interrupted');
  });

  it.each(['missing Task', 'mismatched continuation', 'broken Event', 'forged Attempt'] as const)(
    'fails closed without mutating an earlier recovery aggregate when a candidate has %s',
    (caseName): void => {
      const safeInput = createPreparedInput('interrupt-aggregate-a-safe');
      store.prepareDelegation(safeInput, (): undefined => undefined);
      startTask(store, safeInput, adapter);
      const corruptSuffix = `interrupt-aggregate-z-${caseName.replaceAll(' ', '-')}`;
      const corruptInput = createPreparedInput(corruptSuffix);
      store.prepareDelegation(corruptInput, (): undefined => undefined);
      startTask(store, corruptInput, adapter);

      if (caseName === 'missing Task') {
        adapter.execute('DROP TRIGGER trg_chat_agent_tasks_no_delete');
        adapter.execute('DELETE FROM chat_agent_tasks WHERE task_id = ?', [corruptInput.tasks[0].taskId]);
      } else if (caseName === 'mismatched continuation') {
        const continuation = {
          ...corruptInput.checkpoint.continuationSnapshot,
          orderedToolCalls: corruptInput.checkpoint.continuationSnapshot.orderedToolCalls.map((toolCall) => ({
            ...toolCall,
            taskId: `task-detached-${corruptSuffix}`
          }))
        };
        const continuationHash = hashAgentPayload({
          schemaVersion: continuation.checkpointSchemaVersion,
          continuation
        });
        adapter.execute('DROP TRIGGER trg_chat_agent_checkpoints_immutable');
        adapter.execute(
          `UPDATE chat_agent_delegation_checkpoints
           SET continuation_snapshot_json = ?, continuation_snapshot_hash = ?
           WHERE checkpoint_id = ?`,
          [JSON.stringify(continuation), continuationHash, corruptInput.checkpoint.checkpointId]
        );
      } else if (caseName === 'broken Event') {
        allowEventCorruption(adapter);
        adapter.execute('DELETE FROM chat_agent_events WHERE checkpoint_id = ? AND sequence = ?', [corruptInput.checkpoint.checkpointId, 2]);
      } else {
        adapter.execute('DROP TRIGGER trg_chat_agent_attempts_immutable');
        adapter.execute('UPDATE chat_agent_attempts SET plan_hash = ? WHERE task_id = ?', ['f'.repeat(64), corruptInput.tasks[0].taskId]);
      }

      const reason = {
        code: 'runtime_interrupted' as const,
        phase: 'recovery' as const,
        category: 'runtime' as const,
        retryable: false,
        details: { reason: 'process_restart' }
      };
      const safeCheckpointBefore = adapter.select<{ status: string; version: number; error_json: string | null }>(
        'SELECT status, version, error_json FROM chat_agent_delegation_checkpoints WHERE checkpoint_id = ?',
        [safeInput.checkpoint.checkpointId]
      )[0];
      const safeTaskBefore = adapter.select<{ status: string; cancel_requested_at: string | null }>(
        'SELECT status, cancel_requested_at FROM chat_agent_tasks WHERE task_id = ?',
        [safeInput.tasks[0].taskId]
      )[0];
      const safeAttemptBefore = adapter.select<{ status: string; finished_at: string | null; error_json: string | null }>(
        'SELECT status, finished_at, error_json FROM chat_agent_attempts WHERE task_id = ?',
        [safeInput.tasks[0].taskId]
      )[0];
      const safeEventCount = adapter.select<{ event_count: number }>(
        'SELECT COUNT(*) AS event_count FROM chat_agent_events WHERE checkpoint_id = ? OR task_id = ?',
        [safeInput.checkpoint.checkpointId, safeInput.tasks[0].taskId]
      )[0]?.event_count;

      expect((): void => {
        store.interruptActive(reason);
      }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));

      expect(
        adapter.select<{ status: string; version: number; error_json: string | null }>(
          'SELECT status, version, error_json FROM chat_agent_delegation_checkpoints WHERE checkpoint_id = ?',
          [safeInput.checkpoint.checkpointId]
        )[0]
      ).toEqual(safeCheckpointBefore);
      expect(
        adapter.select<{ status: string; cancel_requested_at: string | null }>('SELECT status, cancel_requested_at FROM chat_agent_tasks WHERE task_id = ?', [
          safeInput.tasks[0].taskId
        ])[0]
      ).toEqual(safeTaskBefore);
      expect(
        adapter.select<{ status: string; finished_at: string | null; error_json: string | null }>(
          'SELECT status, finished_at, error_json FROM chat_agent_attempts WHERE task_id = ?',
          [safeInput.tasks[0].taskId]
        )[0]
      ).toEqual(safeAttemptBefore);
      expect(
        adapter.select<{ event_count: number }>('SELECT COUNT(*) AS event_count FROM chat_agent_events WHERE checkpoint_id = ? OR task_id = ?', [
          safeInput.checkpoint.checkpointId,
          safeInput.tasks[0].taskId
        ])[0]?.event_count
      ).toBe(safeEventCount);
    }
  );

  it('fails closed when recovery encounters a preparing checkpoint', (): void => {
    const input = createPreparedInput('preparing');
    store.prepareDelegation(input, (): undefined => undefined);
    adapter.execute('UPDATE chat_agent_delegation_checkpoints SET status = ?, version = ? WHERE checkpoint_id = ?', [
      'preparing',
      0,
      input.checkpoint.checkpointId
    ]);
    const reason = {
      code: 'runtime_interrupted' as const,
      phase: 'recovery' as const,
      category: 'runtime' as const,
      retryable: false,
      details: { reason: 'process_restart' }
    };

    expect((): void => {
      store.interruptActive(reason);
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
    expect(store.getCheckpoint(input.checkpoint.checkpointId)?.status).toBe('preparing');
    expect(store.getTask(input.tasks[0].taskId)?.status).toBe('created');
  });

  it('lists validated active recovery snapshots with the latest event cursor', (): void => {
    const input = createPreparedInput('active');
    store.prepareDelegation(input, (): undefined => undefined);

    const snapshots = store.listActive();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      checkpoint: { checkpointId: 'checkpoint-active', status: 'waiting_children' },
      tasks: [{ taskId: 'task-active', recordState: 'active' }],
      eventSequence: 2
    });
    expect(Object.isFrozen(snapshots[0].checkpoint.continuationSnapshot)).toBe(true);
    expect(Object.isFrozen(snapshots[0].tasks[0].contractSnapshot)).toBe(true);
  });

  it.each(['missing Task', 'mismatched tool call'] as const)('rejects active aggregate recovery with %s', (caseName): void => {
    const input = createTwoTaskInput(caseName.startsWith('missing') ? 'active-missing' : 'active-mismatch');
    store.prepareDelegation(input, (): undefined => undefined);
    allowTaskCorruption(adapter);
    if (caseName === 'missing Task') {
      adapter.execute('UPDATE chat_agent_tasks SET checkpoint_id = ? WHERE task_id = ?', ['checkpoint-detached', input.tasks[1].taskId]);
    } else {
      adapter.execute('UPDATE chat_agent_tasks SET tool_call_id = ? WHERE task_id = ?', ['tool-call-forged', input.tasks[0].taskId]);
    }

    expect((): void => {
      store.listActive();
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('rejects active recovery when ready results are incomplete', (): void => {
    const input = createPreparedInput('active-incomplete');
    store.prepareDelegation(input, (): undefined => undefined);
    startTask(store, input, adapter);
    const result = createTaskResult(input.tasks[0].taskId);
    store.recordTaskResult({
      taskId: input.tasks[0].taskId,
      checkpointId: input.checkpoint.checkpointId,
      toolCallId: input.tasks[0].toolCallId,
      result,
      resultHash: hashAgentPayload(result),
      occurredAt
    });
    adapter.execute('UPDATE chat_agent_delegation_checkpoints SET terminal_results_json = ? WHERE checkpoint_id = ?', ['{}', input.checkpoint.checkpointId]);

    expect((): void => {
      store.listActive();
    }).toThrowError(expect.objectContaining({ code: 'protocol_error' }));
  });

  it('marks outbox delivery without mutating its immutable payload', (): void => {
    const input = createPreparedInput('outbox');
    store.prepareDelegation(input, (): undefined => undefined);
    const pending = store.listPendingOutbox()[0];
    const delivered = store.markOutboxDelivered({
      outboxId: pending.outboxId,
      deliveredAt: occurredAt
    });

    expect(delivered).toMatchObject({
      payload: pending.payload,
      payloadHash: pending.payloadHash,
      deliveryStatus: 'delivered',
      attemptCount: 1
    });
    expect(store.listPendingOutbox()).toEqual([]);
  });
});
