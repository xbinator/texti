/**
 * @file read-runtime.test.ts
 * @description 使用真实 SQLite、ChatRuntime、Coordinator 与只读 Child Executor 验证三任务乱序委派闭环。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentCoordinator } from '../../../../../../electron/main/modules/chat/agents/coordinator.mjs';
import type { ChatAgentDelegationIdKind, ChatAgentDelegationService } from '../../../../../../electron/main/modules/chat/agents/service.mjs';
import type { AgentStoreDatabase } from '../../../../../../electron/main/modules/chat/agents/store.mjs';
import type { AgentTaskRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { ChatModelResolution, ChatModelResolver } from '../../../../../../electron/main/modules/chat/runtime/model/resolver.mjs';
import type { RuntimeStreamText } from '../../../../../../electron/main/modules/chat/runtime/stream/index.mjs';
import type { AIStreamResult, AITransportTool } from 'types/ai';
import type { ChatMessagePart, ChatMessageRecord, ChatMessageToolPart } from 'types/chat';
import type {
  AgentBudgetSnapshot,
  AgentDelegationCreatedPayload,
  AgentDelegationReadyPayload,
  AgentTaskError,
  AgentUsageAccounting,
  ChatAgentResumeResult,
  DelegateTaskInput
} from 'types/chat-agent';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentBudgetLedger } from '../../../../../../electron/main/modules/chat/agents/budget.mjs';
import { createChildActorRegistry } from '../../../../../../electron/main/modules/chat/agents/child-registry.mjs';
import { createAgentCoordinator } from '../../../../../../electron/main/modules/chat/agents/coordinator.mjs';
import { createChildRuntimeExecutor } from '../../../../../../electron/main/modules/chat/agents/executor.mjs';
import { createAgentReadScheduler } from '../../../../../../electron/main/modules/chat/agents/scheduler.mjs';
import { createChatAgentDelegationService } from '../../../../../../electron/main/modules/chat/agents/service.mjs';
import { createAgentDelegationStore } from '../../../../../../electron/main/modules/chat/agents/store.mjs';
import { createRuntimeLockRegistry } from '../../../../../../electron/main/modules/chat/runtime/infrastructure/locks.mjs';
import { createChatRuntimeService } from '../../../../../../electron/main/modules/chat/runtime/service.mjs';
import { createAgentTables } from '../../../../../../electron/main/modules/database/service.mjs';
import { getToolRegistryEntry } from '../../../../../../shared/ai/tools/index.js';

/** 仅在 Electron Node ABI 下运行真实 better-sqlite3 测试。 */
const describeWithSqlite = 'electron' in process.versions ? describe : describe.skip;

/** 测试冻结模型。 */
const MODEL_SNAPSHOT = Object.freeze({ providerId: 'provider-read-e2e', modelId: 'model-read-e2e' });

/** 测试创建并在 afterEach 清理的隔离工作区。 */
const temporaryRoots: string[] = [];

/** 测试打开并在 afterEach 关闭的数据库。 */
const databases: Array<InstanceType<typeof Database>> = [];

/** SQLite 消息行。 */
interface MessageRow {
  /** 消息 ID。 */
  id: string;
  /** Session ID。 */
  session_id: string;
  /** 消息角色。 */
  role: string;
  /** 文本内容。 */
  content: string;
  /** 消息 part JSON。 */
  parts_json: string | null;
  /** 思考文本。 */
  thinking: string | null;
  /** 附件 JSON。 */
  files_json: string | null;
  /** 用量 JSON。 */
  usage_json: string | null;
  /** 创建时间。 */
  created_at: string;
  /** loading SQLite 布尔值。 */
  loading: number | null;
  /** finished SQLite 布尔值。 */
  finished: number | null;
  /** Agent ID。 */
  agent_id: string | null;
  /** Runtime ID。 */
  runtime_id: string | null;
  /** 父 Runtime ID。 */
  parent_runtime_id: string | null;
}

/** SQLite Attempt 终态投影。 */
interface AttemptRow {
  /** Attempt ID。 */
  attempt_id: string;
  /** Task ID。 */
  task_id: string;
  /** 当前 Runtime ID。 */
  current_runtime_id: string;
  /** Attempt 状态。 */
  status: string;
}

/** 可控异步门闩。 */
interface DeferredGate {
  /** 等待释放的 Promise。 */
  readonly promise: Promise<void>;
  /** 幂等释放门闩。 */
  resolve(): void;
}

/**
 * 创建一次性异步门闩。
 * @returns 可等待和释放的门闩
 */
function createGate(): DeferredGate {
  let release: () => void = (): void => undefined;
  const promise = new Promise<void>((resolve): void => {
    release = resolve;
  });
  let released = false;
  return {
    promise,
    resolve(): void {
      if (released) return;
      released = true;
      release();
    }
  };
}

/**
 * 将测试 chunk 包装成 AI SDK stream tuple。
 * @param chunks - Provider chunk 序列
 * @returns Runtime stream 返回值
 */
function createStreamResult(chunks: readonly unknown[]): [undefined, AIStreamResult] {
  /**
   * 按原顺序生成 Provider chunk。
   * @returns 异步 chunk 流
   */
  async function* streamChunks(): AsyncGenerator<unknown> {
    for (const chunk of chunks) yield chunk;
  }
  return [undefined, { stream: streamChunks() as unknown as AIStreamResult['stream'] }];
}

/**
 * 解析可选 JSON 列。
 * @param value - SQLite JSON 文本
 * @returns 解析值或 undefined
 */
function parseJson<T>(value: string | null): T | undefined {
  return value === null ? undefined : (JSON.parse(value) as T);
}

/**
 * 将可选值序列化为 SQLite JSON 列。
 * @param value - 待持久化值
 * @returns JSON 文本或 null
 */
function stringifyJson(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/**
 * 把可选布尔值映射为 SQLite 整型。
 * @param value - 可选布尔值
 * @returns 0、1 或 null
 */
function toSqliteBoolean(value: boolean | undefined): number | null {
  return value === undefined ? null : Number(value);
}

/**
 * 校验测试数据库中的消息角色。
 * @param role - SQLite 字符串
 * @returns Chat 消息角色
 */
function parseRole(role: string): ChatMessageRecord['role'] {
  if (role === 'user' || role === 'system' || role === 'assistant' || role === 'error' || role === 'interrupt') return role;
  throw new Error(`Unexpected chat role: ${role}`);
}

/**
 * 创建聊天消息表和 Agent 事实表。
 * @returns 已初始化的真实内存 SQLite
 */
function createDatabase(): InstanceType<typeof Database> {
  const database = new Database(':memory:');
  database.exec(`
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      parts_json TEXT,
      thinking TEXT,
      files_json TEXT,
      usage_json TEXT,
      created_at TEXT NOT NULL,
      loading INTEGER,
      finished INTEGER,
      agent_id TEXT,
      runtime_id TEXT,
      parent_runtime_id TEXT
    );
  `);
  createAgentTables(database);
  databases.push(database);
  return database;
}

/**
 * 将 better-sqlite3 适配为生产 Store 边界。
 * @param database - 内存 SQLite
 * @returns 同步 Store 数据库
 */
function createDatabaseAdapter(database: InstanceType<typeof Database>): AgentStoreDatabase {
  return {
    execute: (sql: string, params: readonly unknown[] = []): { changes: number; lastInsertRowid: number | bigint } => database.prepare(sql).run(...params),
    select: <T>(sql: string, params: readonly unknown[] = []): T[] => database.prepare(sql).all(...params) as T[],
    transaction: <T>(operation: () => T): T => database.transaction(operation)()
  };
}

/**
 * 在真实 SQLite 中新增或覆盖一条正常聊天消息。
 * @param database - 内存 SQLite
 * @param message - Primary 消息
 */
function writeMessage(database: InstanceType<typeof Database>, message: ChatMessageRecord): void {
  database
    .prepare(
      `INSERT OR REPLACE INTO chat_messages (
        id, session_id, role, content, parts_json, thinking, files_json, usage_json,
        created_at, loading, finished, agent_id, runtime_id, parent_runtime_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.id,
      message.sessionId,
      message.role,
      message.content,
      stringifyJson(message.parts),
      message.thinking ?? null,
      stringifyJson(message.files),
      stringifyJson(message.usage),
      message.createdAt,
      toSqliteBoolean(message.loading),
      toSqliteBoolean(message.finished),
      message.agentId ?? null,
      message.runtimeId ?? null,
      message.parentRuntimeId ?? null
    );
}

/**
 * 从真实 SQLite 恢复完整聊天消息。
 * @param database - 内存 SQLite
 * @param sessionId - Session ID
 * @returns 按用户可见顺序排列的消息
 */
function readMessages(database: InstanceType<typeof Database>, sessionId: string): ChatMessageRecord[] {
  const rows = database
    .prepare(
      `SELECT id, session_id, role, content, parts_json, thinking, files_json, usage_json,
              created_at, loading, finished, agent_id, runtime_id, parent_runtime_id
       FROM chat_messages
       WHERE session_id = ?
       ORDER BY created_at ASC,
         CASE role WHEN 'system' THEN 0 WHEN 'user' THEN 1 WHEN 'assistant' THEN 2 WHEN 'interrupt' THEN 3 ELSE 4 END ASC,
         id ASC`
    )
    .all(sessionId) as MessageRow[];
  return rows.map(
    (row): ChatMessageRecord => ({
      id: row.id,
      sessionId: row.session_id,
      role: parseRole(row.role),
      content: row.content,
      parts: parseJson<ChatMessagePart[]>(row.parts_json) ?? [],
      thinking: row.thinking ?? undefined,
      files: parseJson<ChatMessageRecord['files']>(row.files_json),
      usage: parseJson<ChatMessageRecord['usage']>(row.usage_json),
      createdAt: row.created_at,
      loading: row.loading === null ? undefined : row.loading === 1,
      finished: row.finished === null ? undefined : row.finished === 1,
      agentId: row.agent_id ?? undefined,
      runtimeId: row.runtime_id ?? undefined,
      parentRuntimeId: row.parent_runtime_id ?? undefined
    })
  );
}

/**
 * 创建三个显式文件 scope 的委派契约。
 * @returns Provider 按序提交的任务契约
 */
function createContracts(): DelegateTaskInput[] {
  return [1, 2, 3].map(
    (index): DelegateTaskInput => ({
      task: `Inspect child file ${index}`,
      acceptanceCriteria: [`Return value-${index}`],
      mode: 'read',
      resources: [{ kind: 'file', reference: `scope-${index}.txt` }],
      requestedTools: ['read_file'],
      required: true,
      priority: 'normal'
    })
  );
}

/**
 * 从共享工具表克隆 Main 可执行传输定义。
 * @param toolName - 工具名称
 * @returns 不共享引用的传输 Schema
 */
function createTransportTool(toolName: string): AITransportTool {
  const definition = getToolRegistryEntry(toolName)?.definition;
  if (!definition || typeof definition.description !== 'string') {
    throw new Error(`Expected trusted ${toolName} registry definition`);
  }
  return structuredClone({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters as AITransportTool['parameters']
  });
}

/**
 * 创建各身份域独立且确定的 ID。
 * @returns 委派 Service ID 生成器
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
 * 从 Child 最小任务包识别任务序号。
 * @param messages - Provider 请求消息
 * @returns 1-based Child 序号
 */
function readChildIndex(messages: unknown): number {
  const match = JSON.stringify(messages).match(/Inspect child file ([1-3])/);
  if (!match?.[1]) throw new Error('Child request lost its minimal task package');
  return Number(match[1]);
}

/**
 * 创建三个真实文件的隔离工作区。
 * @returns 工作区真实路径
 */
async function createWorkspace(): Promise<string> {
  const createdRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-read-runtime-'));
  const workspaceRoot = await fs.realpath(createdRoot);
  await Promise.all([1, 2, 3].map((index): Promise<void> => fs.writeFile(path.join(workspaceRoot, `scope-${index}.txt`), `value-${index}`, 'utf8')));
  temporaryRoots.push(workspaceRoot);
  return workspaceRoot;
}

/**
 * 创建固定 Primary/Child 模型解析结果。
 * @returns 不包含可持久化凭据的模型配置
 */
function createModelResolution(): ChatModelResolution {
  return {
    createOptions: {
      providerId: MODEL_SNAPSHOT.providerId,
      providerName: 'Read E2E Provider',
      providerType: 'openai'
    },
    modelId: MODEL_SNAPSHOT.modelId
  };
}

/**
 * 等待指定 Task 进入终态。
 * @param getTask - Store Task 查询
 * @param taskId - Task ID
 * @param status - 期望终态
 */
async function waitForTask(getTask: (taskId: string) => AgentTaskRecord | null, taskId: string, status: AgentTaskRecord['status']): Promise<void> {
  await vi.waitFor((): void => {
    expect(getTask(taskId)?.status).toBe(status);
  });
}

afterEach(async (): Promise<void> => {
  databases.splice(0).forEach((database): void => {
    database.close();
  });
  const roots = temporaryRoots.splice(0);
  await Promise.allSettled(roots.map((root): Promise<void> => fs.rm(root, { recursive: true, force: true })));
});

describeWithSqlite('real read child delegation runtime', (): void => {
  it('runs three inherited-model file reads out of order and resumes one ordered Primary answer', async (): Promise<void> => {
    const workspaceRoot = await createWorkspace();
    const database = createDatabase();
    const adapter = createDatabaseAdapter(database);
    const store = createAgentDelegationStore(adapter);
    const locks = createRuntimeLockRegistry();
    const registry = createChildActorRegistry();
    const scheduler = createAgentReadScheduler();
    const budgetLedger = createAgentBudgetLedger({
      database: adapter,
      resolveTurnBudget: (): AgentBudgetSnapshot => ({
        tokenLimit: 10_000,
        costLimitUsd: 0,
        pricingVersion: 'unknown'
      }),
      now: (): string => new Date().toISOString()
    });
    const modelResolution = createModelResolution();
    const childResolve = vi.fn<ChatModelResolver['resolve']>(async (): Promise<ChatModelResolution> => modelResolution);
    const childResolver: ChatModelResolver = { resolve: childResolve };
    const childCalls = new Map<number, number>();
    const childGates = new Map<number, DeferredGate>([
      [1, createGate()],
      [2, createGate()],
      [3, createGate()]
    ]);
    const childReady = new Set<number>();
    const childCompletionOrder: number[] = [];
    const childEvidence = new Map<number, string>();
    const childModels = new Map<number, string>();
    const childTools = new Map<number, string[]>();
    const childStream: RuntimeStreamText = async (_createOptions, request) => {
      const index = readChildIndex(request.messages);
      const callNumber = (childCalls.get(index) ?? 0) + 1;
      childCalls.set(index, callNumber);
      childModels.set(index, request.modelId);
      childTools.set(index, request.tools?.map((tool): string => tool.name) ?? []);
      if (callNumber === 1) {
        return createStreamResult([
          {
            type: 'tool-call',
            toolCallId: `read-call-${index}`,
            toolName: 'read_file',
            input: { path: `scope-${index}.txt` }
          },
          {
            type: 'finish',
            finishReason: 'tool-calls',
            totalUsage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 }
          }
        ]);
      }
      if (callNumber !== 2) throw new Error(`Unexpected Child model call ${callNumber}`);
      childEvidence.set(index, JSON.stringify(request.messages));
      childReady.add(index);
      const gate = childGates.get(index);
      if (!gate) throw new Error(`Missing completion gate for Child ${index}`);
      await gate.promise;
      childCompletionOrder.push(index);
      return createStreamResult([
        { type: 'text-delta', text: `Child ${index} confirmed value-${index}.` },
        {
          type: 'finish',
          finishReason: 'stop',
          totalUsage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 }
        }
      ]);
    };
    const childExecutor = createChildRuntimeExecutor({
      resolver: childResolver,
      streamText: childStream,
      resolveWorkspaceRoot: (): string => workspaceRoot,
      calculateCost: (): AgentUsageAccounting['monetaryCost'] => ({
        currency: 'unknown',
        pricingVersion: 'unknown',
        estimated: 'unknown',
        actual: 'unknown'
      }),
      now: (): number => Date.now()
    });
    const contracts = createContracts();
    let primaryBStarts = 0;
    const primaryStream: RuntimeStreamText = async (_createOptions, _request, callOptions) => {
      if (callOptions.forceFinal) {
        primaryBStarts += 1;
        return createStreamResult([
          { type: 'text-delta', text: 'Primary combined value-1, value-2, and value-3.' },
          {
            type: 'finish',
            finishReason: 'stop',
            totalUsage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 }
          }
        ]);
      }
      const chunks: unknown[] = [];
      contracts.forEach((contract, index): void => {
        const toolCallId = `delegate-call-${index + 1}`;
        chunks.push(
          { type: 'tool-input-start', id: toolCallId, toolName: 'delegate_task' },
          { type: 'tool-input-delta', id: toolCallId, delta: JSON.stringify(contract) },
          { type: 'tool-input-end', id: toolCallId },
          { type: 'tool-call', toolCallId, toolName: 'delegate_task', input: contract }
        );
      });
      chunks.push({
        type: 'finish',
        finishReason: 'tool-calls',
        totalUsage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 }
      });
      return createStreamResult(chunks);
    };
    let runtimeService: ReturnType<typeof createChatRuntimeService>;
    let coordinator: AgentCoordinator | null = null;
    let resumeRequests: Promise<ChatAgentResumeResult[]> | undefined;
    const agentService: ChatAgentDelegationService = createChatAgentDelegationService({
      store,
      locks,
      persistAssistant(message: ChatMessageRecord): undefined {
        writeMessage(database, message);
        return undefined;
      },
      readMessages: (sessionId: string): ChatMessageRecord[] => readMessages(database, sessionId),
      publishAssistant: (message: ChatMessageRecord): void => {
        writeMessage(database, message);
      },
      publish(eventType: 'delegation.created' | 'delegation.ready', payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload): void {
        if (eventType !== 'delegation.ready' || resumeRequests) return;
        const checkpoint = store.getCheckpoint(payload.checkpointId);
        if (!checkpoint || checkpoint.status !== 'ready_to_resume') throw new Error('Expected ready checkpoint before Renderer resume proposal');
        const resumeInput = {
          checkpointId: checkpoint.checkpointId,
          expectedVersion: checkpoint.version,
          resumeRuntimeId: 'runtime-primary-b'
        };
        // Renderer 对同一 tuple 的传输重试必须由 Main CAS 收敛为同一个 Runtime B。
        resumeRequests = Promise.all([agentService.resumePrimary(resumeInput), agentService.resumePrimary(resumeInput)]);
      },
      async dispatchInternal(
        eventType: 'delegation.created' | 'delegation.ready',
        payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload
      ): Promise<void> {
        if (eventType !== 'delegation.created') return;
        if (!coordinator) throw new Error('Coordinator must exist before delegation dispatch');
        await coordinator.accept(payload as AgentDelegationCreatedPayload);
      },
      publishCheckpoint: (): void => undefined,
      createId: createIdFactory(),
      now: (): string => new Date().toISOString(),
      resolveReadLimits: (): { availableToolNames: string[]; permissionScopeIds: string[]; budget: AgentBudgetSnapshot } => ({
        availableToolNames: ['read_file'],
        permissionScopeIds: ['workspace:read'],
        budget: {
          tokenLimit: 100,
          costLimitUsd: 0,
          pricingVersion: 'unknown'
        }
      }),
      budgetLedger,
      startPrimaryContinuation: async (input) => runtimeService.resumePrimary(input)
    });
    const generatedRuntimeIds: string[] = [];
    coordinator = createAgentCoordinator({
      listActive: () => store.listActive(),
      authorizeReadTask: (taskId: string): AgentTaskRecord => agentService.authorizeReadTask(taskId),
      recordPreFailure: (task: AgentTaskRecord, error: AgentTaskError) => agentService.recordPreFailure(task, error),
      reserveResume: (checkpointId: string, budget: AgentBudgetSnapshot): void => budgetLedger.reserveResume(checkpointId, budget),
      scheduler,
      beginAttempt: (input) => store.beginAttempt(input),
      markAttemptRunning: (input) => store.markAttemptRunning(input),
      recordTaskResult: (task: AgentTaskRecord, result) =>
        agentService.recordTaskResult({
          taskId: task.taskId,
          checkpointId: task.checkpointId,
          toolCallId: task.toolCallId,
          result
        }),
      settleTask: (taskId: string, usage: AgentUsageAccounting): void => budgetLedger.settleAttempt(taskId, usage),
      releaseBudget: (taskId: string): void => budgetLedger.releaseTask(taskId),
      executor: childExecutor,
      createRuntimeId(task: AgentTaskRecord): string {
        const runtimeId = `runtime-${task.taskId}`;
        generatedRuntimeIds.push(runtimeId);
        return runtimeId;
      },
      cancelCheckpoint: (checkpointId: string, reason: string) => agentService.cancelInternal(checkpointId, reason),
      now: (): string => new Date().toISOString(),
      registry
    });
    runtimeService = createChatRuntimeService(
      {
        locks,
        emit: (): void => undefined,
        messageReader: { getMessages: (sessionId: string): ChatMessageRecord[] => readMessages(database, sessionId) },
        messageWriter: {
          addMessage(message: ChatMessageRecord): void {
            writeMessage(database, message);
          },
          updateMessage(message: ChatMessageRecord): void {
            writeMessage(database, message);
          }
        },
        createMessageId: (kind): string => `${kind}-primary`,
        resolveModel: async (): Promise<ChatModelResolution> => modelResolution,
        streamText: primaryStream,
        prepareDelegation: (input) => agentService.prepareDelegation(input)
      },
      {
        enabled: true,
        pureReadChildEnabled: true,
        maxParallelReadChildren: 3
      }
    );

    await runtimeService.send({
      runtimeId: 'runtime-primary-a',
      sessionId: 'session-read-e2e',
      turnId: 'turn-read-e2e',
      clientId: 'bchat',
      agentId: 'primary',
      rootRuntimeId: 'runtime-primary-a',
      model: MODEL_SNAPSHOT,
      content: 'Inspect the three bounded files in parallel.',
      workspaceRoot,
      tools: [createTransportTool('read_file')]
    });

    await vi.waitFor((): void => {
      expect(childReady.size).toBe(3);
      expect(scheduler.activeCount()).toBe(3);
      expect(scheduler.queuedCount()).toBe(0);
    });
    const activeRecovery = store.listActive()[0];
    if (!activeRecovery) throw new Error('Expected one waiting delegation checkpoint');
    const { checkpointId } = activeRecovery.checkpoint;
    expect(activeRecovery.tasks.map((task): string => task.taskId)).toEqual(['task-1', 'task-2', 'task-3']);

    childGates.get(2)?.resolve();
    await waitForTask((taskId: string): AgentTaskRecord | null => store.getTask(taskId), 'task-2', 'completed');
    childGates.get(3)?.resolve();
    await waitForTask((taskId: string): AgentTaskRecord | null => store.getTask(taskId), 'task-3', 'completed');
    childGates.get(1)?.resolve();
    await waitForTask((taskId: string): AgentTaskRecord | null => store.getTask(taskId), 'task-1', 'completed');

    await vi.waitFor((): void => {
      expect(store.getCheckpoint(checkpointId)?.status).toBe('completed');
      expect(primaryBStarts).toBe(1);
    });
    const resumeResults = await resumeRequests;
    expect(resumeResults?.map((result): string => result.status).sort()).toEqual(['already_started', 'started']);
    expect(childCompletionOrder).toEqual([2, 3, 1]);
    expect([...childModels.entries()].sort()).toEqual([
      [1, MODEL_SNAPSHOT.modelId],
      [2, MODEL_SNAPSHOT.modelId],
      [3, MODEL_SNAPSHOT.modelId]
    ]);
    expect([...childTools.entries()].sort()).toEqual([
      [1, ['read_file']],
      [2, ['read_file']],
      [3, ['read_file']]
    ]);
    [1, 2, 3].forEach((index): void => {
      expect(childEvidence.get(index)).toContain(`value-${index}`);
    });
    expect(childResolve.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(
      childResolve.mock.calls.every(([model]): boolean => model?.providerId === MODEL_SNAPSHOT.providerId && model.modelId === MODEL_SNAPSHOT.modelId)
    ).toBe(true);

    const messages = readMessages(database, 'session-read-e2e');
    expect(messages.map((message): ChatMessageRecord['role'] => message.role)).toEqual(['user', 'assistant']);
    const assistant = messages.find((message): boolean => message.role === 'assistant');
    const toolParts = assistant?.parts.filter((part): part is ChatMessageToolPart => part.type === 'tool') ?? [];
    expect(toolParts.map((part): string => part.toolCallId)).toEqual(['delegate-call-1', 'delegate-call-2', 'delegate-call-3']);
    expect(toolParts.every((part): boolean => part.status === 'done' && part.result?.status === 'success')).toBe(true);
    expect(assistant).toMatchObject({
      content: 'Primary combined value-1, value-2, and value-3.',
      runtimeId: 'runtime-primary-b',
      loading: false,
      finished: true
    });

    const attempts = database
      .prepare('SELECT attempt_id, task_id, current_runtime_id, status FROM chat_agent_attempts ORDER BY task_id ASC')
      .all() as AttemptRow[];
    expect(attempts).toEqual([
      expect.objectContaining({ task_id: 'task-1', current_runtime_id: 'runtime-task-1', status: 'completed' }),
      expect.objectContaining({ task_id: 'task-2', current_runtime_id: 'runtime-task-2', status: 'completed' }),
      expect.objectContaining({ task_id: 'task-3', current_runtime_id: 'runtime-task-3', status: 'completed' })
    ]);
    expect(scheduler.activeCount()).toBe(0);
    expect(scheduler.queuedCount()).toBe(0);
    expect(runtimeService.getActiveRuntime('runtime-primary-a')).toBeUndefined();
    expect(runtimeService.getActiveRuntime('runtime-primary-b')).toBeUndefined();
    generatedRuntimeIds.forEach((runtimeId): void => {
      expect(registry.getRuntime(runtimeId)).toBeUndefined();
    });
    expect(locks.getWritingOwner('session-read-e2e')).toBeUndefined();
    expect(locks.getContinuationFence('session:session-read-e2e/history')).toBeUndefined();
  }, 10_000);
});
