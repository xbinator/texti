/**
 * @file write-runtime.test.ts
 * @description 使用真实 SQLite、Coordinator、overlay、confirmation 与 commit journal 验证 Child 受控写入闭环。
 */
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentCoordinator } from '../../../../../../electron/main/modules/chat/agents/coordinator.mjs';
import type { ChatAgentDelegationIdKind, ChatAgentDelegationService } from '../../../../../../electron/main/modules/chat/agents/service.mjs';
import type { AgentStoreDatabase } from '../../../../../../electron/main/modules/chat/agents/store.mjs';
import type { AgentTaskRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { ChatModelResolution, ChatModelResolver } from '../../../../../../electron/main/modules/chat/runtime/model/resolver.mjs';
import type { RuntimeStreamText } from '../../../../../../electron/main/modules/chat/runtime/stream/index.mjs';
import type { ActiveChatRuntime, ChatRuntimeDelegationPrepareInput } from '../../../../../../electron/main/modules/chat/runtime/types.mjs';
import type { AIStreamResult, AITransportTool } from 'types/ai';
import type { ChatMessageRecord } from 'types/chat';
import type {
  AgentBudgetSnapshot,
  AgentDelegationCreatedPayload,
  AgentDelegationReadyPayload,
  AgentTaskError,
  AgentUsageAccounting,
  ChatAgentApplicationEvent,
  DelegateTaskInput
} from 'types/chat-agent';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentBudgetLedger } from '../../../../../../electron/main/modules/chat/agents/budget.mjs';
import { createChildActorRegistry } from '../../../../../../electron/main/modules/chat/agents/child-registry.mjs';
import { createAgentConfirmationQueue } from '../../../../../../electron/main/modules/chat/agents/confirmation-store.mjs';
import { createAgentCoordinator } from '../../../../../../electron/main/modules/chat/agents/coordinator.mjs';
import { createChildRuntimeExecutor } from '../../../../../../electron/main/modules/chat/agents/executor.mjs';
import { createAgentFileCommitter } from '../../../../../../electron/main/modules/chat/agents/file-commit.mjs';
import { createAgentResourceScheduler } from '../../../../../../electron/main/modules/chat/agents/scheduler.mjs';
import { createChatAgentDelegationService } from '../../../../../../electron/main/modules/chat/agents/service.mjs';
import { createAgentDelegationStore } from '../../../../../../electron/main/modules/chat/agents/store.mjs';
import { createRuntimeLockRegistry } from '../../../../../../electron/main/modules/chat/runtime/infrastructure/locks.mjs';
import { createAgentTables } from '../../../../../../electron/main/modules/database/service.mjs';
import { getToolRegistryEntry } from '../../../../../../shared/ai/tools/index.js';

/** 仅在 Electron Node ABI 下运行真实 better-sqlite3 测试。 */
const describeWithSqlite = 'electron' in process.versions ? describe : describe.skip;

/** 测试冻结时间。 */
const BASE_TIME = '2030-07-27T10:00:00.000Z';

/** 测试冻结模型。 */
const MODEL_SNAPSHOT = Object.freeze({ providerId: 'provider-write-e2e', modelId: 'model-write-e2e' });

/** 每个用例创建并清理的临时根目录。 */
const temporaryRoots: string[] = [];

/** 每个用例打开并关闭的 SQLite。 */
const databases: Array<InstanceType<typeof Database>> = [];

/** write runtime fixture。 */
interface WriteRuntimeFixture {
  /** 真实目标文件。 */
  readonly targetPath: string;
  /** 真实 Store。 */
  readonly store: ReturnType<typeof createAgentDelegationStore>;
  /** 委派服务。 */
  readonly service: ChatAgentDelegationService;
  /** Coordinator。 */
  readonly coordinator: AgentCoordinator;
  /** SQLite 连接。 */
  readonly database: InstanceType<typeof Database>;
  /** Child 每轮看到的工具名。 */
  readonly childTools: string[][];
  /** confirmation application events。 */
  readonly confirmationEvents: ChatAgentApplicationEvent[];
}

/**
 * 将测试 chunk 包装为 AI SDK stream 结果。
 * @param chunks - Provider chunk 序列
 * @returns Runtime stream tuple
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
 * 创建聊天消息表与 Agent 事实表。
 * @returns 已初始化的内存 SQLite
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
 * 将 better-sqlite3 适配为生产 Store。
 * @param database - 内存 SQLite
 * @returns 同步数据库边界
 */
function createDatabaseAdapter(database: InstanceType<typeof Database>): AgentStoreDatabase {
  return {
    execute: (sql: string, params: readonly unknown[] = []): { changes: number; lastInsertRowid: number | bigint } => database.prepare(sql).run(...params),
    select: <T>(sql: string, params: readonly unknown[] = []): T[] => database.prepare(sql).all(...params) as T[],
    transaction: <T>(operation: () => T): T => database.transaction(operation)()
  };
}

/**
 * 在真实 SQLite 中保存 Primary assistant。
 * @param database - 目标数据库
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
      JSON.stringify(message.parts),
      message.thinking ?? null,
      message.files === undefined ? null : JSON.stringify(message.files),
      message.usage === undefined ? null : JSON.stringify(message.usage),
      message.createdAt,
      message.loading === undefined ? null : Number(message.loading),
      message.finished === undefined ? null : Number(message.finished),
      message.agentId ?? null,
      message.runtimeId ?? null,
      message.parentRuntimeId ?? null
    );
}

/**
 * 从共享 registry 克隆工具传输定义。
 * @param toolName - 工具名称
 * @returns 完整工具 Schema
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
 * 创建各身份域独立递增的确定性 ID。
 * @returns Service ID 工厂
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
 * 创建严格单调的测试时钟。
 * @returns 每次前进一毫秒的 ISO 时间
 */
function createClock(): () => string {
  let offset = 0;
  return (): string => {
    const current = new Date(Date.parse(BASE_TIME) + offset).toISOString();
    offset += 1;
    return current;
  };
}

/**
 * 创建 write 委派契约。
 * @returns 只允许读与 staged edit 的最小任务包
 */
function createContract(): DelegateTaskInput {
  return {
    task: 'Replace the bounded note content',
    acceptanceCriteria: ['Persist after only after explicit approval'],
    mode: 'write',
    resources: [{ kind: 'file', reference: 'note.txt' }],
    requestedTools: ['read_file', 'stage_file_edit'],
    required: true,
    priority: 'normal'
  };
}

/**
 * 创建 Primary Runtime A 交给委派服务的冻结输入。
 * @param contract - write Contract
 * @param workspaceRoot - 隔离工作区
 * @returns 完整 prepare 输入
 */
function createPrepareInput(contract: DelegateTaskInput, workspaceRoot: string): ChatRuntimeDelegationPrepareInput {
  const runtime: ActiveChatRuntime = {
    runtimeId: 'runtime-primary-a',
    sessionId: 'session-write-e2e',
    turnId: 'turn-write-e2e',
    clientId: 'bchat',
    agentId: 'primary',
    rootRuntimeId: 'runtime-primary-a',
    workspaceRoot,
    tools: [createTransportTool('delegate_task'), createTransportTool('read_file'), createTransportTool('stage_file_edit')],
    resolvedModel: {
      createOptions: {
        providerId: MODEL_SNAPSHOT.providerId,
        providerName: 'Write E2E Provider',
        providerType: 'openai',
        apiKey: 'must-not-persist'
      },
      modelId: MODEL_SNAPSHOT.modelId
    },
    status: 'running',
    phase: 'streaming',
    abortController: new AbortController(),
    createdAt: Date.parse(BASE_TIME)
  };
  const assistantMessage: ChatMessageRecord = {
    id: 'assistant-write-e2e',
    sessionId: runtime.sessionId,
    role: 'assistant',
    content: '',
    parts: [
      {
        id: 'part-write-e2e',
        type: 'tool',
        toolCallId: 'delegate-write-1',
        toolName: 'delegate_task',
        status: 'executing',
        input: contract
      }
    ],
    createdAt: BASE_TIME,
    loading: true,
    finished: false,
    agentId: 'primary',
    runtimeId: runtime.runtimeId
  };
  return {
    checkpointId: 'checkpoint-write-e2e',
    runtime,
    assistantMessage,
    suspension: {
      toolCalls: [
        {
          toolCallId: 'delegate-write-1',
          toolName: 'delegate_task',
          input: contract,
          argumentsHash: 'a'.repeat(64)
        }
      ]
    }
  };
}

/**
 * 创建受控写入完整 fixture。
 * @param controlledWriteEnabled - Main-owned write feature gate
 * @returns 可驱动确认与提交的真实聚合
 */
async function createFixture(controlledWriteEnabled = true): Promise<WriteRuntimeFixture> {
  const privateRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-write-runtime-')));
  temporaryRoots.push(privateRoot);
  const workspaceRoot = path.join(privateRoot, 'workspace');
  const overlayRoot = path.join(privateRoot, 'overlays');
  const journalRoot = path.join(privateRoot, 'journals');
  await Promise.all([
    fs.mkdir(workspaceRoot, { recursive: true }),
    fs.mkdir(overlayRoot, { recursive: true, mode: 0o700 }),
    fs.mkdir(journalRoot, { recursive: true, mode: 0o700 })
  ]);
  const targetPath = path.join(workspaceRoot, 'note.txt');
  await fs.writeFile(targetPath, 'before', 'utf8');

  const database = createDatabase();
  const adapter = createDatabaseAdapter(database);
  const store = createAgentDelegationStore(adapter);
  const locks = createRuntimeLockRegistry();
  const registry = createChildActorRegistry();
  const scheduler = createAgentResourceScheduler();
  const now = createClock();
  const budgetLedger = createAgentBudgetLedger({
    database: adapter,
    resolveTurnBudget: (): AgentBudgetSnapshot => ({
      tokenLimit: 10_000,
      costLimitUsd: 0,
      pricingVersion: 'unknown'
    }),
    now
  });
  const confirmationEvents: ChatAgentApplicationEvent[] = [];
  const confirmationQueue = createAgentConfirmationQueue({
    store,
    readUnifiedDiff: (reference: string): string => readFileSync(reference, 'utf8'),
    publish: (event: ChatAgentApplicationEvent): void => {
      confirmationEvents.push(event);
    },
    now
  });
  const modelResolution: ChatModelResolution = {
    createOptions: {
      providerId: MODEL_SNAPSHOT.providerId,
      providerName: 'Write E2E Provider',
      providerType: 'openai'
    },
    modelId: MODEL_SNAPSHOT.modelId
  };
  const resolver: ChatModelResolver = {
    resolve: async (): Promise<ChatModelResolution> => modelResolution
  };
  let childCall = 0;
  const childTools: string[][] = [];
  const childStream: RuntimeStreamText = async (_createOptions, request) => {
    childCall += 1;
    childTools.push(request.tools?.map((tool): string => tool.name).sort() ?? []);
    if (childCall === 1) {
      return createStreamResult([
        {
          type: 'tool-call',
          toolCallId: 'stage-edit-1',
          toolName: 'stage_file_edit',
          input: { path: 'note.txt', oldString: 'before', newString: 'after', replaceAll: false }
        },
        {
          type: 'finish',
          finishReason: 'tool-calls',
          totalUsage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 }
        }
      ]);
    }
    if (childCall !== 2) throw new Error(`Unexpected write Child model call ${childCall}`);
    return createStreamResult([
      { type: 'text-delta', text: 'Prepared the bounded note update.' },
      {
        type: 'finish',
        finishReason: 'stop',
        totalUsage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 }
      }
    ]);
  };
  const executor = createChildRuntimeExecutor({
    resolver,
    streamText: childStream,
    resolveWorkspaceRoot: (): string => workspaceRoot,
    resolveOverlayRoot: (): string => overlayRoot,
    createOverlayId: (kind): string => `${kind}-write-e2e`,
    calculateCost: (): AgentUsageAccounting['monetaryCost'] => ({
      currency: 'USD',
      pricingVersion: 'test-v1',
      estimated: 0.001,
      actual: 'unknown'
    }),
    now: (): number => Date.now()
  });
  const fileCommitter = createAgentFileCommitter({
    store,
    journalRoot,
    now,
    createId: (): string => 'journal-write-1',
    getPermissionScopeIds: (): readonly string[] => ['workspace:write']
  });

  let coordinator: AgentCoordinator | null = null;
  const service = createChatAgentDelegationService({
    store,
    locks,
    persistAssistant(message: ChatMessageRecord): undefined {
      writeMessage(database, message);
      return undefined;
    },
    readMessages: (): ChatMessageRecord[] => [],
    publishAssistant: (): void => undefined,
    publish: (): void => undefined,
    async dispatchInternal(
      eventType: 'delegation.created' | 'delegation.ready',
      payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload
    ): Promise<void> {
      if (eventType !== 'delegation.created') return;
      if (!coordinator) throw new Error('Coordinator must exist before write dispatch');
      await coordinator.accept(payload as AgentDelegationCreatedPayload);
    },
    publishCheckpoint: (): void => undefined,
    confirmationQueue,
    featureConfig: {
      enabled: true,
      pureReadChildEnabled: true,
      controlledWriteChildEnabled: controlledWriteEnabled,
      maxParallelReadChildren: 3
    },
    createId: createIdFactory(),
    now,
    resolveReadLimits: (): { availableToolNames: string[]; permissionScopeIds: string[]; budget: AgentBudgetSnapshot } => ({
      availableToolNames: ['read_file', 'stage_file_edit'],
      permissionScopeIds: ['workspace:write'],
      budget: {
        tokenLimit: 1_000,
        costLimitUsd: 0,
        pricingVersion: 'unknown'
      }
    }),
    budgetLedger,
    startPrimaryContinuation: async () => ({ outcome: 'completed' })
  });
  coordinator = createAgentCoordinator({
    listActive: () => store.listActive(),
    authorizeTask: (taskId: string): AgentTaskRecord => service.authorizeTask(taskId),
    recordPreFailure: (task: AgentTaskRecord, error: AgentTaskError) => service.recordPreFailure(task, error),
    reserveResume: (checkpointId: string, budget: AgentBudgetSnapshot): void => budgetLedger.reserveResume(checkpointId, budget),
    scheduler,
    beginAttempt: (input) => store.beginAttempt(input),
    markAttemptRunning: (input) => store.markAttemptRunning(input),
    recordTaskResult: (task: AgentTaskRecord, result) =>
      service.recordTaskResult({
        taskId: task.taskId,
        checkpointId: task.checkpointId,
        toolCallId: task.toolCallId,
        result
      }),
    settleTask: (taskId: string, usage: AgentUsageAccounting): void => budgetLedger.settleAttempt(taskId, usage),
    releaseBudget: (taskId: string): void => budgetLedger.releaseTask(taskId),
    executor,
    prepareChangeset: (input) => store.prepareChangeset(input),
    confirmationQueue,
    isControlledWriteReady: (): boolean => true,
    getConfirmation: (confirmationId: string) => store.getConfirmation(confirmationId),
    getChangeset: (changesetId: string) => store.getChangeset(changesetId),
    queueCommit: (input) => store.queueCommit(input),
    fileCommitter,
    createConfirmationId: (): string => 'confirmation-write-1',
    getTask: (taskId: string): AgentTaskRecord | null => store.getTask(taskId),
    createRuntimeId: (): string => 'runtime-write-child-1',
    cancelCheckpoint: (checkpointId: string, reason: string) => service.cancelInternal(checkpointId, reason),
    now,
    registry
  });

  service.prepareDelegation(createPrepareInput(createContract(), workspaceRoot));
  await service.drainOutbox();
  return {
    targetPath,
    store,
    service,
    coordinator,
    database,
    childTools,
    confirmationEvents
  };
}

/**
 * 等待 Task 进入期望状态。
 * @param fixture - write runtime fixture
 * @param status - 期望状态
 */
async function waitForTask(fixture: WriteRuntimeFixture, status: AgentTaskRecord['status']): Promise<void> {
  await vi.waitFor((): void => {
    expect(
      fixture.store.getTask('task-1')?.status,
      JSON.stringify({
        task: fixture.store.getTask('task-1'),
        events: fixture.store.listEvents('task', 'task-1'),
        journals: fixture.database.prepare('SELECT journal_id, status FROM chat_agent_commit_journals').all()
      })
    ).toBe(status);
  });
}

afterEach(async (): Promise<void> => {
  databases.splice(0).forEach((database): void => {
    database.close();
  });
  const roots = temporaryRoots.splice(0);
  await Promise.allSettled(roots.map((root): Promise<void> => fs.rm(root, { recursive: true, force: true })));
});

describeWithSqlite('real controlled write child runtime', (): void => {
  it('keeps the workspace unchanged until approval and finalizes one journaled mutation', async (): Promise<void> => {
    const fixture = await createFixture();

    await vi.waitFor((): void => {
      expect(fixture.service.listConfirmations()).toHaveLength(1);
    });
    expect(await fs.readFile(fixture.targetPath, 'utf8')).toBe('before');
    expect(fixture.store.getTask('task-1')?.status).toBe('waiting_confirmation');

    const pending = fixture.service.listConfirmations()[0];
    if (!pending) throw new Error('Expected a pending write confirmation');
    fixture.service.resolveConfirmation({
      confirmationId: pending.confirmationId,
      expectedVersion: pending.version,
      decision: 'approved'
    });
    await waitForTask(fixture, 'completed');

    expect(await fs.readFile(fixture.targetPath, 'utf8')).toBe('after');
    expect(fixture.store.getCheckpoint('checkpoint-write-e2e')?.status).toBe('ready_to_resume');
    expect(fixture.childTools).toEqual([
      ['read_file', 'stage_file_edit'],
      ['read_file', 'stage_file_edit']
    ]);
    expect(fixture.childTools.flat()).not.toContain('delegate_task');
    expect(fixture.childTools.flat()).not.toContain('write_file');
    expect(
      fixture.confirmationEvents
        .filter((event): boolean => event.type === 'confirmation.updated')
        .map((event): string => (event.type === 'confirmation.updated' ? event.confirmation.status : ''))
    ).toEqual(['pending', 'approved']);
    expect(fixture.database.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE agent_id != 'primary'").get()).toEqual({ count: 0 });
    expect(fixture.database.prepare('SELECT status FROM chat_agent_commit_journals').get()).toEqual({ status: 'finalized' });
  });

  it('invalidates approval when the base changes before the commit lease', async (): Promise<void> => {
    const fixture = await createFixture();
    await vi.waitFor((): void => {
      expect(fixture.service.listConfirmations()).toHaveLength(1);
    });
    const pending = fixture.service.listConfirmations()[0];
    if (!pending) throw new Error('Expected a pending write confirmation');
    await fs.writeFile(fixture.targetPath, 'external-change', 'utf8');

    fixture.service.resolveConfirmation({
      confirmationId: pending.confirmationId,
      expectedVersion: pending.version,
      decision: 'approved'
    });
    await waitForTask(fixture, 'failed');

    expect(await fs.readFile(fixture.targetPath, 'utf8')).toBe('external-change');
    expect(fixture.store.getConfirmation(pending.confirmationId)?.status).toBe('revoked');
    expect(fixture.store.getTask('task-1')?.error).toMatchObject({ code: 'stale_context', phase: 'commit_validation' });
    expect(fixture.database.prepare('SELECT COUNT(*) AS count FROM chat_agent_commit_journals').get()).toEqual({ count: 0 });
  });

  it('fails before creating an Attempt while the write feature gate is disabled', async (): Promise<void> => {
    const fixture = await createFixture(false);
    await waitForTask(fixture, 'failed');

    expect(await fs.readFile(fixture.targetPath, 'utf8')).toBe('before');
    expect(fixture.service.listConfirmations()).toEqual([]);
    expect(fixture.database.prepare('SELECT COUNT(*) AS count FROM chat_agent_attempts').get()).toEqual({ count: 0 });
    expect(fixture.store.getTask('task-1')?.error).toMatchObject({
      code: 'capability_denied',
      phase: 'plan_validation',
      details: { reason: 'controlled_write_child_disabled' }
    });
  });
});
