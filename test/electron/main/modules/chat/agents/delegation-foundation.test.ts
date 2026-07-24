/**
 * @file delegation-foundation.test.ts
 * @description 使用真实 SQLite 与生产 Runtime/Agent 服务验证默认关闭的委派基础闭环。
 */
import type { RuntimeStreamText } from '../../../../../../electron/main/modules/chat/runtime/stream/types.mjs';
import type { ActiveChatRuntime } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AIStreamResult, AITransportTool } from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import type { AgentExecutionPlanSnapshot, ChatAgentResult, DelegateTaskInput } from 'types/chat-agent';
import type { ChatRuntimeEventMap } from 'types/chat-runtime';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashExecutionPlanSnapshot, validateFoundationContract } from '../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import { createChatAgentDelegationService, type ChatAgentDelegationIdKind } from '../../../../../../electron/main/modules/chat/agents/service.mjs';
import { createAgentDelegationStore, type AgentDelegationStore, type AgentStoreDatabase } from '../../../../../../electron/main/modules/chat/agents/store.mjs';
import { createRuntimeLockRegistry } from '../../../../../../electron/main/modules/chat/runtime/infrastructure/locks.mjs';
import { createChatRuntimeService } from '../../../../../../electron/main/modules/chat/runtime/service.mjs';
import { createAgentTables } from '../../../../../../electron/main/modules/database/service.mjs';

/** 仅在 Electron Node ABI 下运行真实 better-sqlite3 测试。 */
const describeWithSqlite = 'electron' in process.versions ? describe : describe.skip;

/** 固定基础时间。 */
const occurredAt = '2026-07-23T08:00:00.000Z';

/** 内部委派工具快照。 */
const delegateTool: AITransportTool = {
  name: 'delegate_task',
  description: 'Delegate one bounded read task.',
  parameters: { type: 'object', properties: {} }
};

/** 基础只读任务契约。 */
const contract: DelegateTaskInput = {
  task: 'Inspect CONTEXT.md',
  acceptanceCriteria: ['Return the project name'],
  mode: 'read',
  resources: [{ kind: 'file', reference: 'CONTEXT.md' }],
  requestedTools: ['read_file'],
  required: true,
  priority: 'normal'
};

/**
 * 将 better-sqlite3 适配为生产 Store 的窄接口。
 * @param database - 内存 SQLite
 * @returns Store 数据库接口
 */
function createDatabaseAdapter(database: InstanceType<typeof Database>): AgentStoreDatabase {
  return {
    execute: (sql: string, params: readonly unknown[] = []): { changes: number; lastInsertRowid: number | bigint } => database.prepare(sql).run(...params),
    select: <T>(sql: string, params: readonly unknown[] = []): T[] => database.prepare(sql).all(...params) as T[],
    transaction: <T>(operation: () => T): T => database.transaction(operation)()
  };
}

/**
 * 创建确定性 ID 生成器。
 * @returns 各身份域独立递增的 ID 函数
 */
function createIdFactory(): (kind: ChatAgentDelegationIdKind, index?: number) => string {
  const counters = new Map<ChatAgentDelegationIdKind, number>();
  return (kind: ChatAgentDelegationIdKind, index?: number): string => {
    const next = index ?? (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}

/**
 * 创建 Runtime A。
 * @returns 已冻结模型和内部工具的 Primary Runtime
 */
function createRuntimeA(): ActiveChatRuntime {
  return {
    runtimeId: 'runtime-a',
    sessionId: 'session-1',
    turnId: 'turn-1',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-a',
    tools: [delegateTool],
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
    createdAt: Date.parse(occurredAt)
  };
}

/**
 * 创建测试消息集合。
 * @returns Runtime A 的用户消息和 assistant 草稿
 */
function createMessages(): { user: ChatMessageRecord; assistant: ChatMessageRecord } {
  return {
    user: {
      id: 'user-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'Delegate context inspection',
      parts: [{ id: 'part-user-1', type: 'text', text: 'Delegate context inspection' }],
      createdAt: occurredAt,
      loading: false,
      finished: true
    },
    assistant: {
      id: 'assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: '',
      parts: [],
      createdAt: occurredAt,
      loading: true,
      finished: false
    }
  };
}

/**
 * 创建只产生一次 delegate_task 的确定性 Provider 流。
 * @returns RuntimeStreamText double
 */
function createDelegateStreamText(): RuntimeStreamText {
  return async () => {
    /**
     * 生成完整的委派工具调用。
     * @returns Provider chunks
     */
    async function* stream(): AsyncGenerator<unknown> {
      yield { type: 'tool-input-start', id: 'call-1', toolName: 'delegate_task' };
      yield { type: 'tool-input-delta', id: 'call-1', delta: JSON.stringify(contract) };
      yield { type: 'tool-input-end', id: 'call-1' };
      yield { type: 'tool-call', toolCallId: 'call-1', toolName: 'delegate_task', input: contract };
      yield { type: 'finish', finishReason: 'tool-calls', totalUsage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 } };
    }

    return [undefined, { stream: stream() as unknown as AIStreamResult['stream'] }];
  };
}

/**
 * 创建覆盖 Runtime A 委派与 Runtime B 最终回答的确定性 Provider。
 * @param runtimeBBarrier - Runtime B 最终回答门闩
 * @param onRuntimeBStart - Runtime B 模型调用观察器
 * @returns 共用真实 Runtime stream executor 的底层 Provider double
 */
function createFoundationStream(runtimeBBarrier: Promise<void>, onRuntimeBStart: () => void): RuntimeStreamText {
  const delegateStreamText = createDelegateStreamText();
  return async (createOptions, request, callOptions) => {
    if (!callOptions.forceFinal) {
      return delegateStreamText(createOptions, request, callOptions);
    }

    onRuntimeBStart();
    await runtimeBBarrier;

    /**
     * 生成 Runtime B 的最终回答。
     * @returns Provider chunks
     */
    async function* stream(): AsyncGenerator<unknown> {
      yield { type: 'text-delta', text: 'Tibis' };
      yield { type: 'finish', finishReason: 'stop', totalUsage: { inputTokens: 8, outputTokens: 1, totalTokens: 9 } };
    }

    return [undefined, { stream: stream() as unknown as AIStreamResult['stream'] }];
  };
}

/**
 * 创建与 Task 契约绑定的冻结只读计划。
 * @param store - 生产 Agent Store
 * @returns 可授权的执行计划
 */
function createExecutionPlan(store: AgentDelegationStore): AgentExecutionPlanSnapshot {
  const task = store.getTask('task-1');
  if (!task) throw new Error('Expected prepared task');
  const planWithoutHash = {
    planSchemaVersion: 1,
    policyVersion: 'foundation-v1',
    capabilitySet: ['read_file'],
    modelSnapshot: { providerId: 'provider-1', modelId: 'model-1' },
    permissionSnapshot: { scopeIds: ['workspace-read'] },
    resourceScopes: ['file:CONTEXT.md'],
    toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' as const }],
    commitPolicy: { mode: 'none' as const },
    budget: { tokenLimit: 1000, costLimitUsd: 0, pricingVersion: 'unknown' }
  };
  return {
    ...planWithoutHash,
    planHash: hashExecutionPlanSnapshot(task.contractSnapshot, planWithoutHash)
  };
}

/**
 * 将准备完成的 Task 推进至 running 并建立真实 Attempt。
 * @param store - 生产 Agent Store
 */
function startTask(store: AgentDelegationStore): void {
  const plan = createExecutionPlan(store);
  store.transitionTask({ taskId: 'task-1', toStatus: 'planning', occurredAt, source: 'coordinator' });
  store.transitionTask({
    taskId: 'task-1',
    toStatus: 'authorized',
    executionPlanSnapshot: plan,
    executionPlanSnapshotHash: plan.planHash,
    occurredAt,
    source: 'coordinator'
  });
  store.transitionTask({ taskId: 'task-1', toStatus: 'queued', queuePhase: 'start', occurredAt, source: 'coordinator' });
  store.beginAttempt({
    taskId: 'task-1',
    attemptId: 'attempt-1',
    parentRuntimeId: 'runtime-a',
    runtimeId: 'runtime-child-1',
    occurredAt
  });
  store.markAttemptRunning({
    taskId: 'task-1',
    attemptId: 'attempt-1',
    runtimeId: 'runtime-child-1',
    occurredAt
  });
}

/**
 * 创建可验证的 Child 终态结果。
 * @returns 与 task-1/attempt-1 绑定的结构化结果
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
            summary: 'The project is Tibis.',
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
      inputTokens: 8,
      outputTokens: 4,
      totalTokens: 12,
      modelCalls: 1,
      toolRounds: 1,
      queueDurationMs: 1,
      executionDurationMs: 5,
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

describeWithSqlite('delegation foundation end to end', (): void => {
  const databases: Array<InstanceType<typeof Database>> = [];

  afterEach((): void => {
    databases.splice(0).forEach((database): void => {
      database.close();
    });
  });

  it('suspends Runtime A and resumes the same Primary exactly once', async (): Promise<void> => {
    const database = new Database(':memory:');
    databases.push(database);
    createAgentTables(database);
    const adapter = createDatabaseAdapter(database);
    const store = createAgentDelegationStore(adapter);
    const locks = createRuntimeLockRegistry();
    const messageRecords = new Map<string, ChatMessageRecord>();
    const runtimeEvents: Array<keyof ChatRuntimeEventMap> = [];
    const completionEvents: ChatRuntimeEventMap['chat:runtime:complete'][] = [];
    let releaseRuntimeB: () => void = (): void => undefined;
    const runtimeBBarrier = new Promise<void>((resolve): void => {
      releaseRuntimeB = resolve;
    });
    let runtimeBStarts = 0;
    let runtimeService: ReturnType<typeof createChatRuntimeService>;

    const agentService = createChatAgentDelegationService({
      store,
      locks,
      persistAssistant(message: ChatMessageRecord): undefined {
        messageRecords.set(message.id, structuredClone(message));
        return undefined;
      },
      readMessages: (): ChatMessageRecord[] => [...messageRecords.values()].map((message): ChatMessageRecord => structuredClone(message)),
      publishAssistant(message: ChatMessageRecord): void {
        messageRecords.set(message.id, structuredClone(message));
      },
      publish: (): void => undefined,
      publishCheckpoint: (): void => undefined,
      createId: createIdFactory(),
      now: (): string => occurredAt,
      startPrimaryContinuation: async (input) => runtimeService.resumePrimary(input)
    });
    runtimeService = createChatRuntimeService({
      locks,
      emit: (name, payload): void => {
        runtimeEvents.push(name);
        if (name === 'chat:runtime:complete') {
          completionEvents.push(payload as ChatRuntimeEventMap['chat:runtime:complete']);
        }
      },
      messageReader: {
        getMessages: (): ChatMessageRecord[] => [...messageRecords.values()].map((message): ChatMessageRecord => structuredClone(message))
      },
      messageWriter: {
        addMessage(message: ChatMessageRecord): void {
          messageRecords.set(message.id, structuredClone(message));
        },
        updateMessage(message: ChatMessageRecord): void {
          messageRecords.set(message.id, structuredClone(message));
        }
      },
      createMessageId: (kind): string => `${kind}-1`,
      now: (): string => occurredAt,
      resolveModel: async () => createRuntimeA().resolvedModel ?? null,
      streamText: createFoundationStream(runtimeBBarrier, (): void => {
        runtimeBStarts += 1;
      }),
      prepareDelegation: (input) => agentService.prepareDelegation(input)
    });

    const startResult = await runtimeService.startTrustedPrimary({
      runtimeId: 'runtime-a',
      sessionId: 'session-1',
      turnId: 'turn-1',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-a',
      content: 'Delegate context inspection',
      tools: [delegateTool]
    });
    expect(startResult).toEqual({ runtimeId: 'runtime-a', sessionId: 'session-1' });
    await vi.waitFor((): void => {
      expect(completionEvents).toContainEqual(
        expect.objectContaining({
          runtimeId: 'runtime-a',
          reason: 'waiting_children'
        })
      );
    });
    const waitingCompletion = completionEvents.find((event): boolean => event.runtimeId === 'runtime-a' && event.reason === 'waiting_children');
    if (!waitingCompletion || waitingCompletion.reason !== 'waiting_children') {
      throw new Error('Expected Runtime A waiting_children completion');
    }
    const { checkpointId } = waitingCompletion;

    expect(runtimeService.getActiveRuntime('runtime-a')).toBeUndefined();
    expect(store.getCheckpoint(checkpointId)?.status).toBe('waiting_children');
    expect(locks.getWritingOwner('session-1')).toBeUndefined();
    expect(locks.getContinuationFence('session:session-1/history')?.checkpointId).toBe(checkpointId);
    expect(runtimeEvents).not.toContain('chat:runtime:tool-request');

    startTask(store);
    agentService.recordTaskResult({
      taskId: 'task-1',
      checkpointId,
      toolCallId: 'call-1',
      result: createTaskResult()
    });
    const ready = store.getCheckpoint(checkpointId);
    if (!ready) throw new Error('Expected ready checkpoint');
    const firstResume = await agentService.resumePrimary({
      checkpointId,
      expectedVersion: ready.version,
      resumeRuntimeId: 'runtime-b'
    });
    const duplicateResume = await agentService.resumePrimary({
      checkpointId,
      expectedVersion: ready.version,
      resumeRuntimeId: 'runtime-ignored'
    });

    expect(firstResume.status).toBe('started');
    expect(duplicateResume.status).toBe('already_started');
    expect(firstResume.address).toMatchObject({
      parentRuntimeId: 'runtime-a',
      rootRuntimeId: 'runtime-a',
      continuationOfRuntimeId: 'runtime-a'
    });
    await vi.waitFor((): void => {
      expect(runtimeBStarts).toBe(1);
    });
    expect(runtimeService.getActiveRuntime('runtime-b')).toMatchObject({
      runtimeId: 'runtime-b',
      parentRuntimeId: 'runtime-a',
      rootRuntimeId: 'runtime-a',
      continuationOfRuntimeId: 'runtime-a',
      tools: []
    });
    expect(messageRecords.get('assistant-1')?.parts).toEqual([
      expect.objectContaining({
        toolCallId: 'call-1',
        status: 'done',
        result: expect.objectContaining({ data: expect.objectContaining({ taskId: 'task-1' }) })
      })
    ]);
    expect(runtimeBStarts).toBe(1);
    releaseRuntimeB();
    await vi.waitFor((): void => {
      expect(store.getCheckpoint(checkpointId)?.status).toBe('completed');
    });

    expect(messageRecords.get('assistant-1')).toMatchObject({ content: 'Tibis', loading: false, finished: true });
    expect(locks.getContinuationFence('session:session-1/history')).toBeUndefined();
    expect(runtimeEvents).not.toContain('chat:runtime:tool-request');
  });

  it('rolls back assistant and delegation facts when the atomic prepare transaction fails', (): void => {
    const database = new Database(':memory:');
    databases.push(database);
    createAgentTables(database);
    database.exec('CREATE TABLE test_assistant (message_id TEXT PRIMARY KEY)');
    const baseAdapter = createDatabaseAdapter(database);
    const failingAdapter: AgentStoreDatabase = {
      ...baseAdapter,
      execute(sql: string, params: readonly unknown[] = []): { changes: number; lastInsertRowid: number | bigint } {
        if (sql.includes('INSERT INTO chat_agent_outbox')) throw new Error('outbox failure');
        return baseAdapter.execute(sql, params);
      }
    };
    const store = createAgentDelegationStore(failingAdapter);
    const locks = createRuntimeLockRegistry();
    const agentService = createChatAgentDelegationService({
      store,
      locks,
      persistAssistant(message: ChatMessageRecord): undefined {
        failingAdapter.execute('INSERT INTO test_assistant (message_id) VALUES (?)', [message.id]);
        return undefined;
      },
      readMessages: (): ChatMessageRecord[] => [],
      publishAssistant: (): void => undefined,
      publish: (): void => undefined,
      publishCheckpoint: (): void => undefined,
      createId: createIdFactory(),
      now: (): string => occurredAt,
      startPrimaryContinuation: async () => ({ outcome: 'completed' })
    });
    const messages = createMessages();
    const runtime = createRuntimeA();
    const validation = validateFoundationContract(contract);
    if (!validation.ok) throw new Error('Expected valid contract');

    expect(() =>
      agentService.prepareDelegation({
        checkpointId: 'checkpoint-1',
        runtime,
        assistantMessage: {
          ...messages.assistant,
          parts: [
            {
              id: 'part-call-1',
              type: 'tool',
              toolCallId: 'call-1',
              toolName: 'delegate_task',
              status: 'executing',
              input: validation.contract
            }
          ]
        },
        suspension: {
          toolCalls: [
            {
              toolCallId: 'call-1',
              toolName: 'delegate_task',
              input: validation.contract,
              argumentsHash: 'a'.repeat(64)
            }
          ]
        }
      })
    ).toThrow('outbox failure');

    ['test_assistant', 'chat_agent_tasks', 'chat_agent_delegation_checkpoints', 'chat_agent_events', 'chat_agent_outbox'].forEach((tableName): void => {
      const row = baseAdapter.select<{ count: number }>(`SELECT COUNT(*) AS count FROM ${tableName}`)[0];
      expect(row.count).toBe(0);
    });
    expect(locks.getContinuationFence('session:session-1/history')).toBeUndefined();
  });

  it('recovers lost publication from persisted facts and interrupts a post-CAS pre-start crash without a second model start', async (): Promise<void> => {
    const database = new Database(':memory:');
    databases.push(database);
    createAgentTables(database);
    const adapter = createDatabaseAdapter(database);
    const store = createAgentDelegationStore(adapter);
    const locks = createRuntimeLockRegistry();
    const messages = createMessages();
    messages.assistant.parts = [
      {
        id: 'part-call-1',
        type: 'tool',
        toolCallId: 'call-1',
        toolName: 'delegate_task',
        status: 'executing',
        input: contract
      }
    ];
    let startCount = 0;
    const service = createChatAgentDelegationService({
      store,
      locks,
      persistAssistant: (): undefined => undefined,
      readMessages: (): ChatMessageRecord[] => [structuredClone(messages.user), structuredClone(messages.assistant)],
      publishAssistant: (): void => undefined,
      publish(eventType): void {
        if (eventType === 'delegation.created') throw new Error('renderer unavailable');
      },
      publishCheckpoint: (): void => undefined,
      createId: createIdFactory(),
      now: (): string => occurredAt,
      startPrimaryContinuation: async () => {
        startCount += 1;
        throw new Error('crashed before Runtime B start');
      }
    });

    service.prepareDelegation({
      checkpointId: 'checkpoint-1',
      runtime: createRuntimeA(),
      assistantMessage: messages.assistant,
      suspension: {
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'delegate_task',
            input: contract,
            argumentsHash: 'a'.repeat(64)
          }
        ]
      }
    });

    expect(store.getOutbox('delegation.created:checkpoint-1')).toMatchObject({ deliveryStatus: 'pending' });
    expect(service.listActive()).toEqual([expect.objectContaining({ checkpointId: 'checkpoint-1', status: 'waiting_children' })]);

    startTask(store);
    service.recordTaskResult({
      taskId: 'task-1',
      checkpointId: 'checkpoint-1',
      toolCallId: 'call-1',
      result: createTaskResult()
    });
    const ready = store.getCheckpoint('checkpoint-1');
    if (!ready) throw new Error('Expected ready checkpoint');
    await expect(
      service.resumePrimary({
        checkpointId: 'checkpoint-1',
        expectedVersion: ready.version,
        resumeRuntimeId: 'runtime-b'
      })
    ).resolves.toMatchObject({ status: 'started' });
    await Promise.resolve();

    expect(startCount).toBe(1);
    expect(store.getCheckpoint('checkpoint-1')?.status).toBe('resuming');

    const restartedStart = vi.fn(async () => ({ outcome: 'completed' as const }));
    const restartedService = createChatAgentDelegationService({
      store,
      locks: createRuntimeLockRegistry(),
      persistAssistant: (): undefined => undefined,
      readMessages: (): ChatMessageRecord[] => [structuredClone(messages.user), structuredClone(messages.assistant)],
      publishAssistant: (): void => undefined,
      publish: (): void => undefined,
      publishCheckpoint: (): void => undefined,
      createId: createIdFactory(),
      now: (): string => occurredAt,
      startPrimaryContinuation: restartedStart
    });

    expect(restartedService.interruptUnrecoverableCheckpoints()).toBe(1);
    expect(store.getCheckpoint('checkpoint-1')).toMatchObject({
      status: 'interrupted',
      resumeRuntimeId: 'runtime-b'
    });
    await expect(
      restartedService.resumePrimary({
        checkpointId: 'checkpoint-1',
        expectedVersion: ready.version,
        resumeRuntimeId: 'runtime-retry'
      })
    ).resolves.toMatchObject({
      status: 'settled',
      address: {
        runtimeId: 'runtime-b',
        parentRuntimeId: 'runtime-a',
        continuationOfRuntimeId: 'runtime-a'
      }
    });
    expect(restartedStart).not.toHaveBeenCalled();
  });
});
