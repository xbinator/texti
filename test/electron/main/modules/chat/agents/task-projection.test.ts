/**
 * @file task-projection.test.ts
 * @description 固定 Renderer Task 公开投影与窄查询命令的协议结构。
 */
import { Buffer } from 'node:buffer';
import * as path from 'node:path';
import type { AgentDelegationStore, AgentTaskListPage, AgentTaskProjectionRecord } from '../../../../../../electron/main/modules/chat/agents/types.mts';
import type {
  AgentArtifactReference,
  AgentChangesetRecord,
  AgentCommitJournalRecord,
  AgentResourceReference,
  AgentTaskResult,
  ChatAgentEvent,
  ChatAgentCancelTaskInput,
  ChatAgentCancelTaskResult,
  ChatAgentGetTaskInput,
  ChatAgentGetTaskResult,
  ChatAgentListTasksInput,
  ChatAgentListTasksResult,
  ChatAgentTaskDetailSnapshot,
  ChatAgentTaskEventSnapshot,
  ChatAgentTaskListSnapshot,
  ChatAgentTaskSnapshot,
  ChatAgentTaskSummarySnapshot,
  ChatAgentTaskTombstoneSnapshot,
  ChatAgentTaskUpdatedEvent
} from 'types/chat-agent';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_CANONICAL_PAYLOAD_MAX_BYTES } from '../../../../../../electron/main/modules/chat/agents/contracts.mts';
import { createAgentTaskProjector, createTaskProjectionPump, type AgentTaskProjector } from '../../../../../../electron/main/modules/chat/agents/service.mts';

/** 公开投影中禁止出现的常见秘密形态。 */
const PUBLIC_SECRET_PATTERN = new RegExp(
  [
    '(?:proxy-)?authorization\\s*:',
    '(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|cookie)\\s*[:=]',
    '(?:[A-Z][A-Z0-9]*_)+(?:KEY|TOKEN|SECRET|PASSWORD)\\s*=',
    '\\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\\b'
  ].join('|'),
  'i'
);

/** 固定活动 Task 的最小公开摘要。 */
const summaryFixture = {
  recordState: 'active',
  taskId: 'task-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  checkpointId: 'checkpoint-1',
  assistantMessageId: 'assistant-message-1',
  toolCallId: 'tool-call-1',
  agentId: 'child-1',
  projectionSchemaVersion: 1,
  taskSequence: 12,
  task: 'Inspect one runtime file',
  mode: 'read',
  required: true,
  priority: 'normal',
  status: 'running',
  queuePhase: 'start',
  currentAttempt: {
    attemptId: 'attempt-1',
    attemptNumber: 1,
    agentId: 'child-1',
    attemptState: 'running',
    runtimeId: 'runtime-1',
    createdAt: '2026-07-28T08:00:00.000Z',
    startedAt: '2026-07-28T08:00:01.000Z'
  },
  cancellation: {
    requestKind: 'single_task',
    requestedAt: '2026-07-28T08:00:02.000Z'
  },
  summary: 'Inspecting the requested file.',
  createdAt: '2026-07-28T08:00:00.000Z',
  updatedAt: '2026-07-28T08:00:03.000Z'
} satisfies ChatAgentTaskSummarySnapshot;

/** 固定展开 Task 的完整公开详情。 */
const detailFixture = {
  ...summaryFixture,
  acceptanceCriteria: ['Report the lock owner'],
  resources: [{ kind: 'file', displayReference: 'electron/main/runtime.mts', revision: 'revision-1' }],
  timeline: {
    entries: [
      {
        sequence: 12,
        type: 'status',
        code: 'task.running',
        summary: 'Runtime is active.',
        occurredAt: '2026-07-28T08:00:03.000Z'
      }
    ],
    firstSequence: 12,
    lastSequence: 12,
    truncated: false
  },
  completion: {
    level: 'partial',
    summary: 'Inspection is still running.',
    criteria: [
      {
        criterionIndex: 0,
        claimStatus: 'unknown',
        verificationStatus: 'unverified',
        claimSummary: 'No conclusion yet.'
      }
    ]
  },
  warnings: [{ code: 'timeline_truncated', message: 'Older entries were omitted.' }],
  error: {
    code: 'runtime_interrupted',
    phase: 'runtime',
    category: 'runtime',
    retryable: true,
    message: 'Runtime was replaced.',
    details: { reason: 'runtime_replaced' }
  },
  usage: {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    modelCalls: 1,
    toolRounds: 1,
    queueDurationMs: 4,
    executionDurationMs: 20,
    externalRequests: 0,
    monetaryCost: {
      currency: 'unknown',
      pricingVersion: 'unknown',
      estimated: 'unknown',
      actual: 'unknown'
    }
  },
  changeset: {
    changesetId: 'changeset-1',
    baseRevision: 'base-1',
    diffHash: 'a'.repeat(64),
    operationSetHash: 'b'.repeat(64),
    displayPaths: ['electron/main/runtime.mts'],
    phase: 'prepared'
  },
  artifacts: [
    {
      artifactId: 'artifact-1',
      kind: 'report',
      reference: 'agent-artifacts/report-1',
      contentHash: 'c'.repeat(64),
      owner: {
        taskId: 'task-1',
        agentId: 'child-1',
        attemptId: 'attempt-1'
      },
      visibility: 'user',
      createdAt: '2026-07-28T08:00:03.000Z'
    }
  ]
} satisfies ChatAgentTaskDetailSnapshot;

/** 固定显式 Task 查询可返回的最小 tombstone。 */
const tombstoneFixture = {
  recordState: 'tombstoned',
  taskId: 'task-2',
  sessionId: 'session-1',
  turnId: 'turn-1',
  checkpointId: 'checkpoint-1',
  assistantMessageId: 'assistant-message-1',
  toolCallId: 'tool-call-2',
  projectionSchemaVersion: 1,
  taskSequence: 20,
  updatedAt: '2026-07-28T09:00:00.000Z'
} satisfies ChatAgentTaskTombstoneSnapshot;

/** 固定 Session 列表查询输入。 */
const listInputFixture = {
  sessionId: 'session-1',
  cursor: 'cursor-1',
  limit: 50
} satisfies ChatAgentListTasksInput;

/** 固定 Task 定向查询输入。 */
const getInputFixture = {
  sessionId: 'session-1',
  taskId: 'task-1'
} satisfies ChatAgentGetTaskInput;

/** 固定单 Task 取消输入。 */
const cancelInputFixture = {
  sessionId: 'session-1',
  taskId: 'task-1'
} satisfies ChatAgentCancelTaskInput;

/** 固定列表查询结果。 */
const listResultFixture = {
  tasks: [summaryFixture],
  nextCursor: 'cursor-2'
} satisfies ChatAgentListTasksResult;

/** 固定单 Task 取消结果。 */
const cancelResultFixture = {
  disposition: 'cancel_requested',
  task: summaryFixture
} satisfies ChatAgentCancelTaskResult;

/** 创建投影 fixture 的可选持久化状态。 */
interface ProjectionOptions {
  /** Task 身份后缀。 */
  readonly suffix?: string;
  /** Task 记录状态。 */
  readonly recordState?: 'active' | 'tombstoned';
  /** Task 执行状态。 */
  readonly status?: 'running' | 'completed';
  /** Tool Call 冻结的 required。 */
  readonly required?: boolean;
  /** 可选结果摘要。 */
  readonly resultSummary?: string;
  /** 可选取消请求时间。 */
  readonly cancelRequestedAt?: string;
  /** 可选取消请求事件种类；省略时用于构造损坏的缺失 Event。 */
  readonly cancelRequestKind?: 'single_task' | 'checkpoint_cascade';
  /** 可选任务描述。 */
  readonly taskText?: string;
  /** Task 更新时间。 */
  readonly updatedAt?: string;
}

/**
 * 创建 Projector 直接消费的完整持久化事实。
 * @param options - 需要覆盖的 Task 状态
 * @returns 不依赖真实 Store 的投影记录
 */
function createProjection(options: ProjectionOptions = {}): AgentTaskProjectionRecord {
  const suffix = options.suffix ?? 'fixture';
  const taskId = `task-${suffix}`;
  const checkpointId = `checkpoint-${suffix}`;
  const toolCallId = `tool-call-${suffix}`;
  const attemptId = `attempt-${suffix}`;
  const result: AgentTaskResult | undefined = options.resultSummary
    ? {
        taskId,
        agentId: `child-${suffix}`,
        attemptId,
        executionStatus: 'completed',
        completion: {
          level: 'full',
          criteria: [
            {
              criterionIndex: 0,
              claim: { status: 'satisfied', summary: 'Done', evidence: [] },
              verification: { status: 'verified', verifier: 'tool', evidence: [] }
            }
          ]
        },
        summary: options.resultSummary,
        warnings: [],
        artifacts: [],
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          modelCalls: 1,
          toolRounds: 1,
          queueDurationMs: 1,
          executionDurationMs: 1,
          externalRequests: 0,
          monetaryCost: {
            currency: 'unknown',
            pricingVersion: 'unknown',
            estimated: 'unknown',
            actual: 'unknown'
          }
        }
      }
    : undefined;
  const task = {
    taskId,
    sessionId: 'session-projector',
    turnId: `turn-${suffix}`,
    agentId: `child-${suffix}`,
    parentAgentId: 'primary',
    rootRuntimeId: `runtime-root-${suffix}`,
    checkpointId,
    toolCallId,
    contractSnapshot: {
      contractSchemaVersion: 1,
      task: options.taskText ?? `Inspect ${suffix}`,
      acceptanceCriteria: ['Return one result'],
      mode: 'read' as const,
      resources: [{ kind: 'file' as const, reference: 'CONTEXT.md' }],
      requestedTools: ['read_file'],
      required: !(options.required ?? false)
    },
    contractSnapshotHash: 'a'.repeat(64),
    executionPlanSnapshot: {
      planSchemaVersion: 1,
      policyVersion: 'read-runtime-v1',
      capabilitySet: ['read_file'],
      modelSnapshot: { providerId: 'private-provider', modelId: 'private-model' },
      permissionSnapshot: { scopeIds: ['private-scope'] },
      resourceScopes: ['file:CONTEXT.md'],
      toolEffectSet: [{ toolName: 'read_file', effect: 'pure_read' as const }],
      commitPolicy: { mode: 'none' as const },
      budget: { tokenLimit: 100, costLimitUsd: 1, pricingVersion: 'private-pricing' },
      planHash: 'b'.repeat(64)
    },
    executionPlanSnapshotHash: 'b'.repeat(64),
    status: options.status ?? 'running',
    priority: 'normal' as const,
    currentAttemptId: attemptId,
    ...(options.cancelRequestedAt ? { cancelRequestedAt: options.cancelRequestedAt } : {}),
    ...(result ? { result, resultHash: 'c'.repeat(64) } : {}),
    recordState: options.recordState ?? 'active',
    unfinishedJournalCount: 0,
    createdAt: '2026-07-28T08:00:00.000Z',
    updatedAt: options.updatedAt ?? '2026-07-28T08:00:03.000Z'
  };

  const baseEvent: ChatAgentEvent = {
    eventId: `event-${suffix}`,
    aggregate: { kind: 'task', id: taskId },
    taskId,
    checkpointId,
    sequence: 7,
    attemptId,
    runtimeId: `runtime-current-${suffix}`,
    type: 'tool.completed',
    occurredAt: task.updatedAt,
    source: 'runtime',
    schemaVersion: 1,
    payload: {
      toolCallId: `child-tool-${suffix}`,
      toolName: 'read_file',
      resultHash: '3'.repeat(64)
    }
  };
  const cancellationEvent: ChatAgentEvent | undefined =
    options.cancelRequestedAt && options.cancelRequestKind
      ? {
          eventId: `event-${suffix}-cancel`,
          aggregate: { kind: 'task', id: taskId },
          taskId,
          checkpointId,
          sequence: 8,
          attemptId,
          runtimeId: `runtime-current-${suffix}`,
          type: 'task.cancel_requested',
          occurredAt: options.cancelRequestedAt,
          source: options.cancelRequestKind === 'single_task' ? 'user' : 'system',
          schemaVersion: 1,
          payload: { requestKind: options.cancelRequestKind }
        }
      : undefined;

  return {
    task,
    checkpoint: {
      checkpointId,
      sessionId: task.sessionId,
      turnId: task.turnId,
      primaryAgentId: task.parentAgentId,
      rootRuntimeId: task.rootRuntimeId,
      sourceRuntimeId: `runtime-source-${suffix}`,
      assistantMessageId: `assistant-${suffix}`,
      continuationSnapshot: {
        checkpointSchemaVersion: 1,
        policyVersion: 'foundation-v1',
        modelSnapshot: { providerId: 'private-provider', modelId: 'private-model' },
        continuationContextReference: `continuation-${suffix}`,
        continuationContextHash: 'd'.repeat(64),
        sourceMessageRevision: `revision-${suffix}`,
        toolSchemaSnapshotHash: 'e'.repeat(64),
        orderedToolCalls: [
          {
            toolCallId,
            taskId,
            required: options.required ?? false,
            argumentsHash: 'f'.repeat(64),
            providerMetadataHash: '1'.repeat(64)
          }
        ],
        reservedResumeBudget: { tokenLimit: 100, costLimitUsd: 1, pricingVersion: 'private-pricing' },
        absoluteTurnDeadline: '2026-07-28T09:00:00.000Z'
      },
      continuationSnapshotHash: '2'.repeat(64),
      status: 'waiting_children',
      version: 1,
      terminalResults: {},
      recordState: 'active',
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    },
    currentAttempt: {
      attemptId,
      taskId,
      attemptNumber: 2,
      parentRuntimeId: `runtime-source-${suffix}`,
      planHash: 'b'.repeat(64),
      initialRuntimeId: `runtime-initial-${suffix}`,
      currentRuntimeId: `runtime-current-${suffix}`,
      runtimeSequence: 2,
      status: options.status === 'completed' ? 'completed' : 'running',
      usageSnapshot: result?.usage ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        modelCalls: 0,
        toolRounds: 0,
        queueDurationMs: 0,
        executionDurationMs: 0,
        externalRequests: 0,
        monetaryCost: { currency: 'USD', pricingVersion: 'private-pricing', estimated: 0, actual: 'unknown' }
      },
      usageComplete: options.status === 'completed',
      usageUpdatedAt: '2026-07-28T08:00:02.000Z',
      startedAt: '2026-07-28T08:00:01.000Z',
      ...(options.status === 'completed' ? { finishedAt: '2026-07-28T08:00:02.000Z' } : {}),
      createdAt: '2026-07-28T08:00:00.500Z'
    },
    taskSequence: cancellationEvent ? 8 : 7,
    events: cancellationEvent ? [baseEvent, cancellationEvent] : [baseEvent]
  };
}

/**
 * 创建只暴露 Projector 所需方法的 Store。
 * @param projections - 按 taskId 提供的持久化投影
 * @param page - 可选 Session 列表页
 * @returns 窄 Store 与调用 spy
 */
function createProjectorStore(
  projections: readonly AgentTaskProjectionRecord[],
  page?: AgentTaskListPage
): {
  readonly store: Pick<AgentDelegationStore, 'getTaskProjection' | 'listTasksBySession'>;
  readonly getTaskProjection: ReturnType<typeof vi.fn>;
  readonly listTasksBySession: ReturnType<typeof vi.fn>;
} {
  const byId = new Map(projections.map((projection): [string, AgentTaskProjectionRecord] => [projection.task.taskId, projection]));
  const getTaskProjection = vi.fn((taskId: string): AgentTaskProjectionRecord | null => byId.get(taskId) ?? null);
  const listTasksBySession = vi.fn(
    (): AgentTaskListPage =>
      page ?? {
        active: projections,
        terminal: [],
        hasMoreTerminal: false
      }
  );

  return {
    store: { getTaskProjection, listTasksBySession },
    getTaskProjection,
    listTasksBySession
  };
}

/**
 * 编码测试专用 Task cursor。
 * @param payload - 未可信 cursor payload
 * @returns base64url JSON
 */
function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * 递归断言公开投影不含内部键、秘密或绝对路径。
 * @param value - Summary、Detail、Tombstone 或列表页
 * @param location - 当前递归位置
 */
function expectPublicSafe(value: unknown, location = '$'): void {
  if (typeof value === 'string') {
    expect(value, `${location} must not contain a secret-shaped value`).not.toMatch(PUBLIC_SECRET_PATTERN);
    expect(path.posix.isAbsolute(value), `${location} must not contain a POSIX absolute path`).toBe(false);
    expect(path.win32.isAbsolute(value), `${location} must not contain a Windows absolute path`).toBe(false);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index): void => expectPublicSafe(entry, `${location}[${index}]`));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  Object.entries(value).forEach(([key, entry]): void => {
    expect(key, `${location}.${key} must be public`).not.toMatch(
      /modelSnapshot|permissionSnapshot|executionPlanSnapshot|targetPath|overlay|journalId|rollbackReference|continuation|raw.*tool|tool.*(?:input|output)/i
    );
    expectPublicSafe(entry, `${location}.${key}`);
  });
}

describe('public Agent Task projection protocol', (): void => {
  it('coalesces committed Task updates and recovers after one publish failure', (): void => {
    const scheduled: Array<() => void> = [];
    const published: ChatAgentTaskUpdatedEvent[] = [];
    const errors: string[] = [];
    let taskSequence = 4;
    let failPublish = true;
    const pump = createTaskProjectionPump({
      projectSummary: (): ChatAgentTaskEventSnapshot => ({ ...summaryFixture, taskSequence }),
      publish: (event): void => {
        if (failPublish) throw new Error('transport unavailable');
        published.push(event);
      },
      reportError: (code): void => {
        errors.push(code);
      },
      schedule: (flush): void => {
        scheduled.push(flush);
      }
    });

    expect((): void => {
      pump.enqueue('task-1');
      pump.enqueue('task-1');
    }).not.toThrow();
    scheduled.shift()?.();
    expect(errors).toEqual(['agent_task_projection_publish_failed']);
    expect(published).toEqual([]);

    failPublish = false;
    taskSequence = 5;
    pump.enqueue('task-1');
    scheduled.shift()?.();
    expect(published).toEqual([
      {
        schemaVersion: 1,
        type: 'task.updated',
        task: expect.objectContaining({ taskId: 'task-1', taskSequence: 5 }),
        taskSequence: 5
      }
    ]);
  });

  it('keeps enqueue no-throw when scheduling and error reporting fail', (): void => {
    const scheduled: Array<() => void> = [];
    const published: ChatAgentTaskUpdatedEvent[] = [];
    let schedulingFails = true;
    const pump = createTaskProjectionPump({
      projectSummary: (): ChatAgentTaskEventSnapshot => ({ ...summaryFixture, taskSequence: 7 }),
      publish: (event): void => {
        published.push(event);
      },
      reportError: (): never => {
        throw new Error('reporter unavailable');
      },
      schedule: (flush): void => {
        if (schedulingFails) throw new Error('scheduler unavailable');
        scheduled.push(flush);
      }
    });

    expect((): void => pump.enqueue('task-1')).not.toThrow();
    schedulingFails = false;
    expect((): void => pump.enqueue('task-1')).not.toThrow();
    scheduled.shift()?.();
    expect(published).toEqual([expect.objectContaining({ taskSequence: 7 })]);
  });

  it('continues the same flush after one Task fails and recovers it on the next notification', (): void => {
    const scheduled: Array<() => void> = [];
    const published: ChatAgentTaskUpdatedEvent[] = [];
    let taskAFails = true;
    const pump = createTaskProjectionPump({
      projectSummary: (taskId): ChatAgentTaskEventSnapshot => ({
        ...summaryFixture,
        taskId,
        taskSequence: taskId === 'task-a' ? 8 : 3
      }),
      publish: (event): void => {
        if (event.task.taskId === 'task-a' && taskAFails) throw new Error('task A unavailable');
        published.push(event);
      },
      reportError: (): void => undefined,
      schedule: (flush): void => {
        scheduled.push(flush);
      }
    });

    pump.enqueue('task-a');
    pump.enqueue('task-b');
    scheduled.shift()?.();
    expect(published.map((event): string => event.task.taskId)).toEqual(['task-b']);

    taskAFails = false;
    pump.enqueue('task-a');
    scheduled.shift()?.();
    expect(published.map((event): string => event.task.taskId)).toEqual(['task-b', 'task-a']);
  });

  it('keeps Summary, Detail, and Tombstone as strict record-state branches', (): void => {
    const listSnapshot: ChatAgentTaskListSnapshot = summaryFixture;
    const eventSnapshots: readonly ChatAgentTaskEventSnapshot[] = [summaryFixture, tombstoneFixture];
    const taskSnapshots: readonly ChatAgentTaskSnapshot[] = [detailFixture, tombstoneFixture];
    const getResults: readonly ChatAgentGetTaskResult[] = [detailFixture, tombstoneFixture, null];

    expect(listSnapshot.recordState).toBe('active');
    expect(eventSnapshots.map((snapshot): string => snapshot.recordState)).toEqual(['active', 'tombstoned']);
    expect(taskSnapshots.map((snapshot): string => snapshot.recordState)).toEqual(['active', 'tombstoned']);
    expect(getResults.at(-1)).toBeNull();
    expect(Object.keys(tombstoneFixture).sort()).toEqual(
      [
        'assistantMessageId',
        'checkpointId',
        'projectionSchemaVersion',
        'recordState',
        'sessionId',
        'taskId',
        'taskSequence',
        'toolCallId',
        'turnId',
        'updatedAt'
      ].sort()
    );
  });

  it('keeps list, get, and cancel commands narrow', (): void => {
    expect(listInputFixture).toEqual({ sessionId: 'session-1', cursor: 'cursor-1', limit: 50 });
    expect(getInputFixture).toEqual({ sessionId: 'session-1', taskId: 'task-1' });
    expect(cancelInputFixture).toEqual({ sessionId: 'session-1', taskId: 'task-1' });
    expect(listResultFixture.tasks).toEqual([summaryFixture]);
    expect(cancelResultFixture).toEqual({ disposition: 'cancel_requested', task: summaryFixture });
  });

  it('keeps Detail fields out of the lightweight Summary fixture', (): void => {
    expect(summaryFixture).not.toHaveProperty('timeline');
    expect(summaryFixture).not.toHaveProperty('acceptanceCriteria');
    expect(summaryFixture).not.toHaveProperty('usage');
    expect(summaryFixture).not.toHaveProperty('changeset');
    expect(summaryFixture).not.toHaveProperty('artifacts');
    expect(detailFixture.projectionSchemaVersion).toBe(1);
  });
});

describe('Agent Task Summary projector', (): void => {
  it('builds an allowlist Summary from persisted Task, Checkpoint, and Attempt facts', (): void => {
    const projection = createProjection({
      suffix: 'summary',
      status: 'completed',
      required: false,
      resultSummary: 'Done\u0000 Authorization: Bearer summary-secret'
    });
    const fixture = createProjectorStore([projection]);
    const projector = createAgentTaskProjector({
      store: fixture.store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    const summary = projector.projectSummary(projection.task.taskId);

    expect(summary).toEqual({
      recordState: 'active',
      taskId: projection.task.taskId,
      sessionId: projection.task.sessionId,
      turnId: projection.task.turnId,
      checkpointId: projection.task.checkpointId,
      assistantMessageId: projection.checkpoint.assistantMessageId,
      toolCallId: projection.task.toolCallId,
      agentId: projection.task.agentId,
      projectionSchemaVersion: 1,
      taskSequence: projection.taskSequence,
      task: 'Inspect summary',
      mode: 'read',
      required: false,
      priority: 'normal',
      status: 'completed',
      currentAttempt: {
        attemptId: 'attempt-summary',
        attemptNumber: 2,
        agentId: 'child-summary',
        attemptState: 'completed',
        runtimeId: 'runtime-current-summary',
        createdAt: '2026-07-28T08:00:00.500Z',
        startedAt: '2026-07-28T08:00:01.000Z',
        endedAt: '2026-07-28T08:00:02.000Z'
      },
      summary: 'Done [REDACTED]',
      createdAt: projection.task.createdAt,
      updatedAt: projection.task.updatedAt
    });
    expect(JSON.stringify(summary)).not.toMatch(/modelSnapshot|permissionSnapshot|summary-secret|private-/);
  });

  it('returns only the ten-field Tombstone branch', (): void => {
    const projection = createProjection({ suffix: 'removed', recordState: 'tombstoned' });
    const fixture = createProjectorStore([projection]);
    const projector = createAgentTaskProjector({
      store: fixture.store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    const tombstone = projector.projectSummary(projection.task.taskId);

    expect(tombstone).toEqual({
      recordState: 'tombstoned',
      taskId: projection.task.taskId,
      sessionId: projection.task.sessionId,
      turnId: projection.task.turnId,
      checkpointId: projection.task.checkpointId,
      assistantMessageId: projection.checkpoint.assistantMessageId,
      toolCallId: projection.task.toolCallId,
      projectionSchemaVersion: 1,
      taskSequence: projection.taskSequence,
      updatedAt: projection.task.updatedAt
    });
    expect(Object.keys(tombstone ?? {})).toHaveLength(10);
  });

  it('projects the unique cancellation Event whose time and request kind match the Task', (): void => {
    const projection = createProjection({
      suffix: 'cancel-valid',
      cancelRequestedAt: '2026-07-28T08:00:02.000Z',
      cancelRequestKind: 'checkpoint_cascade'
    });
    const fixture = createProjectorStore([projection]);
    const projector = createAgentTaskProjector({
      store: fixture.store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    expect(projector.projectSummary(projection.task.taskId)).toMatchObject({
      taskSequence: 8,
      cancellation: {
        requestKind: 'checkpoint_cascade',
        requestedAt: '2026-07-28T08:00:02.000Z'
      }
    });
  });

  it('fails closed when a cancellation timestamp has no matching Event', (): void => {
    const projection = createProjection({
      suffix: 'cancel-requested',
      cancelRequestedAt: '2026-07-28T08:00:02.000Z'
    });
    const fixture = createProjectorStore([projection]);
    const projector = createAgentTaskProjector({
      store: fixture.store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    expect((): void => {
      projector.projectSummary(projection.task.taskId);
    }).toThrow('agent_task_cancellation_invalid');
  });

  it.each(['duplicate', 'time_mismatch', 'event_without_timestamp'] as const)('fails closed for %s cancellation history', (failureKind): void => {
    const requestedAt = '2026-07-28T08:00:02.000Z';
    const valid = createProjection({
      suffix: `cancel-${failureKind}`,
      ...(failureKind === 'event_without_timestamp' ? {} : { cancelRequestedAt: requestedAt }),
      cancelRequestKind: 'single_task'
    });
    const cancelEvent =
      valid.events.find((event): boolean => event.type === 'task.cancel_requested') ??
      ({
        ...valid.events[0],
        eventId: `event-${failureKind}-cancel`,
        sequence: 8,
        type: 'task.cancel_requested',
        occurredAt: requestedAt,
        source: 'user',
        payload: { requestKind: 'single_task' }
      } as ChatAgentEvent);
    let events: ChatAgentEvent[];
    // 分别构造重复事件、投影时间不一致、无投影时间但存在事件三种非法历史。
    if (failureKind === 'duplicate') {
      events = [...valid.events, { ...cancelEvent, eventId: `${cancelEvent.eventId}-duplicate`, sequence: cancelEvent.sequence + 1 }];
    } else if (failureKind === 'time_mismatch') {
      events = valid.events.map(
        (event): ChatAgentEvent => (event.type === 'task.cancel_requested' ? { ...event, occurredAt: '2026-07-28T08:00:03.000Z' } : event)
      );
    } else {
      events = [...valid.events, cancelEvent];
    }
    const projection: AgentTaskProjectionRecord = { ...valid, events };
    const fixture = createProjectorStore([projection]);
    const projector = createAgentTaskProjector({
      store: fixture.store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    expect((): void => {
      projector.projectSummary(projection.task.taskId);
    }).toThrow('agent_task_cancellation_invalid');
  });
});

describe('Agent Task list projector', (): void => {
  it('uses Store projection pages directly and round-trips a Session-bound cursor', (): void => {
    const active = createProjection({ suffix: 'list-active', updatedAt: '2026-07-28T10:00:00.000Z' });
    const terminalNewest = createProjection({
      suffix: 'list-terminal-newest',
      status: 'completed',
      resultSummary: 'Newest complete',
      updatedAt: '2026-07-28T09:00:00.000Z'
    });
    const terminalOlder = createProjection({
      suffix: 'list-terminal-older',
      status: 'completed',
      resultSummary: 'Older complete',
      updatedAt: '2026-07-28T08:00:00.000Z'
    });
    const listTasksBySession = vi
      .fn()
      .mockReturnValueOnce({
        active: [active],
        terminal: [terminalNewest],
        hasMoreTerminal: true
      })
      .mockReturnValueOnce({
        active: [],
        terminal: [terminalOlder],
        hasMoreTerminal: false
      });
    const getTaskProjection = vi.fn((): never => {
      throw new Error('list_must_not_reread');
    });
    const projector = createAgentTaskProjector({
      store: { getTaskProjection, listTasksBySession },
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    const first = projector.listTasks({ sessionId: 'session-projector' });
    const second = projector.listTasks({
      sessionId: 'session-projector',
      cursor: first.nextCursor
    });

    expect(first.tasks.map((task): string => task.taskId)).toEqual([active.task.taskId, terminalNewest.task.taskId]);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.tasks.map((task): string => task.taskId)).toEqual([terminalOlder.task.taskId]);
    expect(second.nextCursor).toBeUndefined();
    expect(listTasksBySession).toHaveBeenNthCalledWith(1, {
      sessionId: 'session-projector',
      includeActive: true,
      terminalLimit: 50
    });
    expect(listTasksBySession).toHaveBeenNthCalledWith(2, {
      sessionId: 'session-projector',
      includeActive: false,
      terminalBefore: {
        updatedAt: terminalNewest.task.updatedAt,
        taskId: terminalNewest.task.taskId
      },
      terminalLimit: 50
    });
    expect(getTaskProjection).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed', 'not+base64'],
    ['oversized', 'x'.repeat(4097)],
    [
      'noncanonical time',
      encodeCursor({
        cursorSchemaVersion: 1,
        sessionId: 'session-projector',
        updatedAt: '2026-07-28T08:00:00+00:00',
        taskId: 'task-cursor'
      })
    ]
  ])('rejects a %s cursor', (_name: string, cursor: string): void => {
    const fixture = createProjectorStore([]);
    const projector = createAgentTaskProjector({
      store: fixture.store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    expect((): void => {
      projector.listTasks({ sessionId: 'session-projector', cursor });
    }).toThrow('agent_task_cursor_invalid');
    expect(fixture.listTasksBySession).not.toHaveBeenCalled();
  });

  it('rejects a cursor bound to another Session', (): void => {
    const terminal = createProjection({
      suffix: 'cursor-session',
      status: 'completed',
      resultSummary: 'Complete'
    });
    const fixture = createProjectorStore([], {
      active: [],
      terminal: [terminal],
      hasMoreTerminal: true
    });
    const projector = createAgentTaskProjector({
      store: fixture.store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });
    const first = projector.listTasks({ sessionId: 'session-projector' });

    expect((): void => {
      projector.listTasks({ sessionId: 'session-other', cursor: first.nextCursor });
    }).toThrow('agent_task_cursor_invalid');
  });

  it('uses the requested terminal limit up to one hundred', (): void => {
    const fixture = createProjectorStore([]);
    const projector = createAgentTaskProjector({
      store: fixture.store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    projector.listTasks({ sessionId: 'session-projector', limit: 100 });
    expect(fixture.listTasksBySession).toHaveBeenCalledWith({
      sessionId: 'session-projector',
      includeActive: true,
      terminalLimit: 100
    });
    expect((): void => {
      projector.listTasks({ sessionId: 'session-projector', limit: 101 });
    }).toThrow('agent_task_list_input_invalid');
  });

  it('truncates terminal Summaries at the canonical page byte limit', (): void => {
    const terminal = Array.from(
      { length: 100 },
      (_value, index): AgentTaskProjectionRecord =>
        createProjection({
          suffix: `payload-${index.toString().padStart(3, '0')}`,
          status: 'completed',
          resultSummary: 'Complete',
          taskText: 'x'.repeat(4000),
          updatedAt: new Date(Date.UTC(2026, 6, 28, 8, 0, 0, 999 - index)).toISOString()
        })
    );
    const fixture = createProjectorStore([], {
      active: [],
      terminal,
      hasMoreTerminal: false
    });
    const projector = createAgentTaskProjector({
      store: fixture.store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    const result = projector.listTasks({ sessionId: 'session-projector', limit: 100 });

    expect(result.tasks.length).toBeGreaterThan(0);
    expect(result.tasks.length).toBeLessThan(terminal.length);
    expect(result.nextCursor).toEqual(expect.any(String));
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(AGENT_CANONICAL_PAYLOAD_MAX_BYTES);
    const lastTask = result.tasks.at(-1);
    const cursorPayload = JSON.parse(Buffer.from(result.nextCursor ?? '', 'base64url').toString('utf8')) as {
      taskId: string;
      updatedAt: string;
    };
    expect(cursorPayload).toMatchObject({
      taskId: lastTask?.taskId,
      updatedAt: lastTask?.updatedAt
    });
  });

  it('fails closed when one Summary exceeds the canonical payload limit', (): void => {
    const projection = createProjection({ suffix: 'oversized-summary' });
    projection.task.agentId = `child-${'x'.repeat(AGENT_CANONICAL_PAYLOAD_MAX_BYTES)}`;
    const fixture = createProjectorStore([projection]);
    const projector = createAgentTaskProjector({
      store: fixture.store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    expect((): void => {
      projector.projectSummary(projection.task.taskId);
    }).toThrow('agent_task_projection_oversized');
  });
});

/**
 * 创建 D2 Projector 依赖，并允许测试覆盖安全 resolver。
 * @param projection - Store 返回的单 Task 投影
 * @param resolveResource - 可选资源 resolver
 * @param resolveArtifact - 可选 artifact resolver
 * @returns 可执行 Detail 查询的 Projector
 */
function createDetailProjector(
  projection: AgentTaskProjectionRecord,
  resolveResource: (resource: AgentResourceReference) => { readonly displayReference: string; readonly revision?: string } | null = (): null => null,
  resolveArtifact: (artifact: AgentArtifactReference) => { readonly reference: string } | null = (): null => null
): AgentTaskProjector {
  const fixture = createProjectorStore([projection]);
  return createAgentTaskProjector({
    store: fixture.store,
    resolveResource,
    resolveArtifact
  });
}

/**
 * 创建与测试投影绑定的 changeset 和可选 journal。
 * @param projection - write Task 投影
 * @param changesetStatus - 内部 changeset 状态
 * @param journalStatus - 可选 journal 状态
 * @returns 带完整 changeset 链接的投影
 */
function withChangeset(
  projection: AgentTaskProjectionRecord,
  changesetStatus: AgentChangesetRecord['status'],
  journalStatus?: AgentCommitJournalRecord['status']
): AgentTaskProjectionRecord {
  const attempt = projection.currentAttempt;
  if (!attempt) throw new Error('Fixture Attempt is required');
  projection.task.contractSnapshot = {
    ...projection.task.contractSnapshot,
    mode: 'write'
  };
  projection.task.status = changesetStatus === 'approved' && journalStatus === undefined ? 'queued' : 'committing';
  projection.task.queuePhase = projection.task.status === 'queued' ? 'commit' : undefined;
  const operations = Array.from({ length: 34 }, (_value, index) => ({
    operationId: `operation-${index}`,
    kind: 'replace' as const,
    displayPath: index === 33 ? '/private/absolute.ts' : `src/file-${index}.ts`,
    targetPath: `/private/workspace/src/file-${index}.ts`,
    resourceScope: `file:src/file-${index}.ts`,
    baseRevision: '4'.repeat(64),
    baseContentHash: '5'.repeat(64),
    targetContentHash: '6'.repeat(64),
    candidateReference: `overlay/private-${index}`,
    rollbackReference: `rollback/private-${index}`,
    byteLength: 10
  }));
  const snapshot = {
    changesetSchemaVersion: 1,
    changesetId: `changeset-${projection.task.taskId}`,
    taskId: projection.task.taskId,
    attemptId: attempt.attemptId,
    agentId: projection.task.agentId,
    runtimeId: attempt.currentRuntimeId,
    planHash: attempt.planHash,
    baseRevision: '7'.repeat(64),
    diffReference: 'overlay/private.diff',
    diffHash: '8'.repeat(64),
    operationSetHash: '9'.repeat(64),
    resourceScopes: ['file:src'],
    operations,
    createdAt: '2026-07-28T08:01:00.000Z'
  };
  const changeset: AgentChangesetRecord = {
    snapshot,
    snapshotHash: 'a'.repeat(64),
    status: changesetStatus,
    ...(changesetStatus === 'prepared' ? {} : { confirmationId: `confirmation-${projection.task.taskId}` }),
    recordState: 'active',
    updatedAt: '2026-07-28T08:02:00.000Z'
  };
  if (!journalStatus) return { ...projection, changeset };
  const { result } = projection.task;
  if (!result || 'resultKind' in result) throw new Error('Fixture ChatAgentResult is required');
  const journal: AgentCommitJournalRecord = {
    journalId: `journal-${projection.task.taskId}`,
    taskId: projection.task.taskId,
    attemptId: attempt.attemptId,
    changesetId: snapshot.changesetId,
    confirmationId: `confirmation-${projection.task.taskId}`,
    confirmationVersion: 2,
    planHash: attempt.planHash,
    intent: {
      journalSchemaVersion: 1,
      changesetSnapshotHash: changeset.snapshotHash,
      confirmationId: `confirmation-${projection.task.taskId}`,
      confirmationVersion: 2,
      planHash: attempt.planHash,
      resultDraft: {
        taskId: result.taskId,
        agentId: result.agentId,
        attemptId: result.attemptId,
        summary: result.summary,
        criteria: result.completion.criteria,
        warnings: result.warnings,
        usage: result.usage
      },
      operations,
      createdAt: '2026-07-28T08:03:00.000Z'
    },
    intentHash: 'b'.repeat(64),
    status: journalStatus,
    appliedOperationIds: [],
    ...(journalStatus === 'manual_recovery'
      ? {
          error: {
            code: 'manual_recovery_required',
            phase: 'recovery',
            category: 'integrity',
            retryable: false
          } as const
        }
      : {}),
    createdAt: '2026-07-28T08:03:00.000Z',
    updatedAt: '2026-07-28T08:04:00.000Z',
    ...(journalStatus === 'finalized' ? { finalizedAt: '2026-07-28T08:05:00.000Z' } : {})
  };
  return { ...projection, changeset, journal };
}

describe('Agent Task Detail projector', (): void => {
  it('returns null for missing or wrong-Session Tasks and preserves a minimal tombstone', (): void => {
    const tombstoneProjection = createProjection({ suffix: 'detail-tombstone', recordState: 'tombstoned' });
    const projector = createDetailProjector(tombstoneProjection);

    expect(projector.projectDetail('session-other', tombstoneProjection.task.taskId)).toBeNull();
    expect(projector.projectDetail('session-projector', 'task-missing')).toBeNull();
    const tombstone = projector.projectDetail('session-projector', tombstoneProjection.task.taskId);
    expect(tombstone).toEqual(projector.projectSummary(tombstoneProjection.task.taskId));
    expect(Object.keys(tombstone ?? {})).toHaveLength(10);
  });

  it('rebuilds safe resources and rejects unsafe internal or resolver references', (): void => {
    const projection = createProjection({ suffix: 'detail-resources' });
    projection.task.contractSnapshot = {
      ...projection.task.contractSnapshot,
      resources: [
        { kind: 'file', reference: 'src/safe.ts', revision: 'revision-1' },
        { kind: 'directory', reference: 'src/components' },
        { kind: 'file', reference: '../escape.ts' },
        { kind: 'file', reference: '/private/absolute.ts' },
        { kind: 'file', reference: 'C:\\private\\absolute.ts' },
        { kind: 'document', reference: 'document-safe' },
        { kind: 'document', reference: 'document-secret' },
        { kind: 'resource', reference: 'resource-extra-fields' }
      ]
    };
    const projector = createDetailProjector(projection, (resource) => {
      if (resource.reference === 'document-safe') return { displayReference: 'document:public', revision: 'revision-public' };
      if (resource.reference === 'document-secret') return { displayReference: 'api_key=resolver-secret' };
      if (resource.reference === 'resource-extra-fields') {
        return {
          displayReference: 'resource:public',
          authorization: 'Bearer resolver-private'
        } as { displayReference: string };
      }
      return null;
    });

    const detail = projector.projectDetail('session-projector', projection.task.taskId);

    expect(detail).toMatchObject({
      recordState: 'active',
      resources: [
        { kind: 'file', displayReference: 'src/safe.ts', revision: 'revision-1' },
        { kind: 'directory', displayReference: 'src/components' },
        { kind: 'document', displayReference: 'document:public', revision: 'revision-public' },
        { kind: 'resource', displayReference: 'resource:public' }
      ]
    });
    expect(JSON.stringify(detail)).not.toMatch(/escape|absolute|resolver-secret|resolver-private|authorization/i);
  });

  it('maps the complete Task event set without exposing payload identities or hashes', (): void => {
    const projection = createProjection({ suffix: 'detail-timeline' });
    const eventTypes = [
      'task.created',
      'task.status_changed',
      'plan.authorized',
      'task.queued',
      'runtime.starting',
      'runtime.started',
      'runtime.replaced',
      'confirmation.requested',
      'confirmation.resolved',
      'confirmation.invalidated',
      'tool.started',
      'tool.completed',
      'changeset.prepared',
      'commit.journal_created',
      'commit.mutation_applied',
      'commit.finalized',
      'protocol.error',
      'task.completed',
      'task.failed',
      'task.cancelled',
      'task.tombstoned'
    ] as const;
    const events = Array.from({ length: 50 }, (_value, index): ChatAgentEvent => {
      const type = eventTypes[index % eventTypes.length];
      return {
        eventId: `private-event-${index}`,
        aggregate: { kind: 'task', id: projection.task.taskId },
        taskId: projection.task.taskId,
        checkpointId: projection.task.checkpointId,
        sequence: index + 11,
        type,
        occurredAt: `2026-07-28T08:00:${(index % 60).toString().padStart(2, '0')}.000Z`,
        source: 'runtime',
        schemaVersion: 1,
        payload: {
          reason: 'Authorization: Bearer timeline-private',
          targetPath: '/private/path',
          resultHash: 'private-hash',
          toolName: 'read_file'
        }
      } as unknown as ChatAgentEvent;
    });
    const projector = createDetailProjector({
      ...projection,
      events,
      taskSequence: 60
    });

    const detail = projector.projectDetail('session-projector', projection.task.taskId);

    expect(detail).toMatchObject({
      recordState: 'active',
      timeline: {
        firstSequence: 11,
        lastSequence: 60,
        truncated: true
      }
    });
    if (!detail || detail.recordState !== 'active') throw new Error('Detail fixture must be active');
    expect(detail.timeline.entries).toHaveLength(50);
    expect(new Set(detail.timeline.entries.map((entry): string => entry.code))).toEqual(new Set(eventTypes));
    expect(JSON.stringify(detail.timeline)).not.toMatch(/private-event|private-path|private-hash|timeline-private|targetPath|resultHash/);
  });

  it('fails closed for a gapped timeline or a last sequence mismatch', (): void => {
    const projection = createProjection({ suffix: 'detail-gap' });
    const projectorWithGap = createDetailProjector({
      ...projection,
      events: [
        projection.events[0],
        {
          ...projection.events[0],
          eventId: 'event-gap',
          sequence: projection.events[0].sequence + 2
        }
      ],
      taskSequence: projection.events[0].sequence + 2
    });
    const projectorWithStaleCursor = createDetailProjector({
      ...projection,
      taskSequence: projection.taskSequence + 1
    });

    expect((): void => {
      projectorWithGap.projectDetail('session-projector', projection.task.taskId);
    }).toThrow('agent_task_timeline_invalid');
    expect((): void => {
      projectorWithStaleCursor.projectDetail('session-projector', projection.task.taskId);
    }).toThrow('agent_task_timeline_invalid');
  });

  it('maps result fields deeply and filters unsafe artifacts and error details', (): void => {
    const projection = createProjection({
      suffix: 'detail-result',
      status: 'completed',
      resultSummary: 'Complete Authorization: Bearer result-secret'
    });
    const { result } = projection.task;
    if (!result || 'resultKind' in result) throw new Error('Fixture result must be an Attempt result');
    result.completion.criteria[0].claim.status = 'satisfied';
    result.completion.criteria[0].claim.summary = 'Claim api_key=claim-secret';
    result.completion.criteria[0].verification.status = 'contradicted';
    result.warnings = [{ code: 'provider_warning', message: 'Cookie: warning-secret' }];
    result.error = {
      code: 'runtime_failed',
      phase: 'runtime',
      category: 'runtime',
      retryable: false,
      message: 'password=error-secret',
      details: {
        reason: 'refresh_token=detail-secret',
        toolName: 'read_file',
        resourceReference: '/private/resource',
        taskId: 'private-task'
      }
    };
    result.output = {
      authorization: 'Bearer output-secret',
      nested: { targetPath: '/private/output-path' }
    };
    result.artifacts = [
      {
        artifactId: 'artifact-user',
        owner: { taskId: result.taskId, agentId: result.agentId, attemptId: result.attemptId },
        visibility: 'user',
        kind: 'report',
        reference: 'internal-user-reference',
        contentHash: 'a'.repeat(64),
        createdAt: '2026-07-28T08:05:00.000Z'
      },
      {
        artifactId: 'artifact-primary',
        owner: { taskId: result.taskId, agentId: result.agentId, attemptId: result.attemptId },
        visibility: 'primary',
        kind: 'report',
        reference: 'internal-primary-reference',
        createdAt: '2026-07-28T08:05:00.000Z'
      },
      {
        artifactId: 'artifact-forged',
        owner: { taskId: 'task-forged', agentId: result.agentId, attemptId: result.attemptId },
        visibility: 'user',
        kind: 'report',
        reference: 'internal-forged-reference',
        createdAt: '2026-07-28T08:05:00.000Z'
      }
    ];
    const projector = createDetailProjector(
      projection,
      (): null => null,
      (artifact) =>
        artifact.artifactId === 'artifact-user'
          ? ({
              reference: 'artifact:public',
              rollbackReference: '/private/rollback'
            } as { reference: string })
          : null
    );

    const detail = projector.projectDetail('session-projector', projection.task.taskId);

    if (!detail || detail.recordState !== 'active') throw new Error('Detail fixture must be active');
    expect(detail.completion).toEqual({
      level: 'full',
      summary: 'Complete [REDACTED]',
      criteria: [
        {
          criterionIndex: 0,
          claimStatus: 'satisfied',
          verificationStatus: 'contradicted',
          claimSummary: 'Claim [REDACTED]'
        }
      ]
    });
    expect(detail.warnings).toEqual(
      expect.arrayContaining([
        { code: 'criterion_contradicted', message: 'One or more Child claims were contradicted by verification.' },
        { code: 'provider_warning', message: '[REDACTED]' }
      ])
    );
    expect(detail.error).toEqual({
      code: 'runtime_failed',
      phase: 'runtime',
      category: 'runtime',
      retryable: false,
      message: '[REDACTED]',
      details: {
        reason: '[REDACTED]',
        toolName: 'read_file'
      }
    });
    expect(detail.usage).toEqual(result.usage);
    expect(detail.usage).not.toBe(result.usage);
    expect(detail.usage?.monetaryCost).not.toBe(result.usage.monetaryCost);
    expect(detail.artifacts).toEqual([
      {
        artifactId: 'artifact-user',
        kind: 'report',
        reference: 'artifact:public',
        contentHash: 'a'.repeat(64),
        owner: { taskId: result.taskId, agentId: result.agentId, attemptId: result.attemptId },
        visibility: 'user',
        createdAt: '2026-07-28T08:05:00.000Z'
      }
    ]);
    expect(JSON.stringify(detail)).not.toMatch(
      /resourceReference|private-task|output-secret|output-path|internal-|rollbackReference|error-secret|detail-secret|claim-secret/
    );
  });

  it.each([
    ['manual_recovery', 'recovery_required'],
    ['finalized', 'finalized'],
    ['applied', 'mutation_applied'],
    ['created', 'journal_created'],
    ['applying', 'journal_created'],
    ['cancelled', 'discarded']
  ] as const)('prioritizes journal %s as changeset phase %s', (journalStatus, publicPhase): void => {
    const base = createProjection({
      suffix: `phase-${journalStatus}`,
      status: 'completed',
      resultSummary: 'Complete'
    });
    const projection = withChangeset(base, 'approved', journalStatus);
    const detail = createDetailProjector(projection).projectDetail('session-projector', projection.task.taskId);

    expect(detail).toMatchObject({
      recordState: 'active',
      changeset: {
        phase: publicPhase,
        displayPaths: Array.from({ length: 32 }, (_value, index): string => `src/file-${index}.ts`)
      },
      warnings: expect.arrayContaining([expect.objectContaining({ code: 'changeset_paths_truncated' })])
    });
    expect(JSON.stringify(detail)).not.toMatch(/journalId|targetPath|overlay|rollbackReference|private\/absolute/);
  });

  it.each([
    ['approved', 'commit_queued', true],
    ['approved', 'approved', false],
    ['awaiting_confirmation', 'awaiting_confirmation', false],
    ['rejected', 'discarded', false],
    ['revoked', 'discarded', false],
    ['discarded', 'discarded', false],
    ['prepared', 'prepared', false]
  ] as const)('maps changeset %s without a journal to %s', (status, phase, commitQueued): void => {
    const base = createProjection({ suffix: `phase-no-journal-${status}-${commitQueued}`, status: 'completed', resultSummary: 'Done' });
    const projection = withChangeset(base, status);
    projection.task.status = commitQueued ? 'queued' : 'committing';
    projection.task.queuePhase = commitQueued ? 'commit' : undefined;

    expect(createDetailProjector(projection).projectDetail('session-projector', projection.task.taskId)).toMatchObject({
      recordState: 'active',
      changeset: { phase }
    });
  });

  it('projects a PreAttemptFailure without inventing Attempt or Artifact fields', (): void => {
    const projection = createProjection({ suffix: 'pre-attempt' });
    projection.task.currentAttemptId = undefined;
    projection.task.status = 'failed';
    projection.task.result = {
      resultKind: 'pre_attempt_failure',
      taskId: projection.task.taskId,
      agentId: projection.task.agentId,
      executionStatus: 'failed',
      completion: {
        level: 'none',
        criteria: [
          {
            criterionIndex: 0,
            claim: { status: 'unknown', summary: 'Not started', evidence: [] },
            verification: { status: 'unverified', verifier: 'policy', evidence: [] }
          }
        ]
      },
      summary: 'Policy rejected',
      warnings: [],
      artifacts: [],
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        modelCalls: 0,
        toolRounds: 0,
        queueDurationMs: 0,
        executionDurationMs: 0,
        externalRequests: 0,
        monetaryCost: { currency: 'unknown', pricingVersion: 'unknown', estimated: 'unknown', actual: 'unknown' }
      },
      error: { code: 'capability_denied', phase: 'plan_validation', category: 'policy', retryable: false }
    };
    const detail = createDetailProjector({ ...projection, currentAttempt: undefined }).projectDetail('session-projector', projection.task.taskId);

    expect(detail).toMatchObject({
      recordState: 'active',
      status: 'failed',
      completion: { level: 'none', summary: 'Policy rejected' },
      artifacts: []
    });
    expect(detail).not.toHaveProperty('currentAttempt');
  });

  it('enforces collection caps, stable truncation warnings, and resolver safety', (): void => {
    const projection = createProjection({ suffix: 'detail-limits', status: 'completed', resultSummary: 'Done' });
    projection.task.contractSnapshot = {
      ...projection.task.contractSnapshot,
      acceptanceCriteria: ['x'.repeat(4000), ...Array.from({ length: 16 }, (_value, index): string => `Criterion ${index}`)],
      resources: [
        { kind: 'file', reference: '' },
        { kind: 'file', reference: '.' },
        { kind: 'file', reference: '..' },
        ...Array.from({ length: 35 }, (_value, index) => ({ kind: 'file' as const, reference: `src/safe-${index}.ts` }))
      ]
    };
    const { result } = projection.task;
    if (!result || 'resultKind' in result) throw new Error('Fixture result must have an Attempt');
    result.completion.criteria = Array.from({ length: 17 }, (_value, index) => ({
      criterionIndex: index,
      claim: { status: 'satisfied' as const, summary: `Claim ${index}`, evidence: [] },
      verification: { status: 'verified' as const, verifier: 'tool' as const, evidence: [] }
    }));
    result.warnings = Array.from({ length: 20 }, (_value, index) => ({ code: `warning-${index}`, message: `Warning ${index}` }));
    result.artifacts = Array.from({ length: 36 }, (_value, index) => ({
      artifactId: `artifact-${index}`,
      owner: { taskId: result.taskId, agentId: result.agentId, attemptId: result.attemptId },
      visibility: 'user' as const,
      kind: 'report',
      reference: `private-${index}`,
      createdAt: '2026-07-28T08:05:00.000Z'
    }));
    const detail = createDetailProjector(
      projection,
      (): null => null,
      (artifact) => {
        if (artifact.artifactId === 'artifact-0') return { reference: '/private/absolute' };
        if (artifact.artifactId === 'artifact-1') return { reference: 'api_key=artifact-secret' };
        return { reference: `artifact:public-${artifact.artifactId}` };
      }
    ).projectDetail('session-projector', projection.task.taskId);

    if (!detail || detail.recordState !== 'active') throw new Error('Detail fixture must be active');
    expect(detail.acceptanceCriteria).toHaveLength(16);
    expect(detail.acceptanceCriteria[0]).toHaveLength(4000);
    expect(detail.resources).toHaveLength(32);
    expect(detail.completion?.criteria).toHaveLength(16);
    expect(detail.artifacts).toHaveLength(32);
    expect(detail.warnings).toHaveLength(16);
    expect(detail.warnings.map((warning): string => warning.code)).toEqual(
      expect.arrayContaining([
        'acceptance_criteria_truncated',
        'criteria_results_truncated',
        'resources_truncated',
        'artifacts_truncated',
        'warnings_truncated'
      ])
    );
    expect(JSON.stringify(detail)).not.toMatch(/artifact-secret|private\/absolute/);
  });

  it('rejects unknown timeline event types and misordered criterion indices', (): void => {
    const unknownEvent = createProjection({ suffix: 'unknown-event' });
    unknownEvent.events[0].type = 'future.event' as ChatAgentEvent['type'];
    const badCriteria = createProjection({ suffix: 'bad-criteria', status: 'completed', resultSummary: 'Done' });
    const { result } = badCriteria.task;
    if (!result) throw new Error('Fixture result is required');
    result.completion.criteria[0].criterionIndex = 2;

    expect((): void => {
      createDetailProjector(unknownEvent).projectDetail('session-projector', unknownEvent.task.taskId);
    }).toThrow('agent_task_timeline_invalid');
    expect((): void => {
      createDetailProjector(badCriteria).projectDetail('session-projector', badCriteria.task.taskId);
    }).toThrow('agent_task_projection_invalid');
  });

  it('fails closed when one Detail exceeds the canonical byte limit', (): void => {
    const projection = createProjection({ suffix: 'oversized-detail' });
    projection.task.agentId = `child-${'x'.repeat(180_000)}`;
    projection.task.contractSnapshot = {
      ...projection.task.contractSnapshot,
      acceptanceCriteria: Array.from({ length: 16 }, (): string => 'y'.repeat(4000)),
      resources: Array.from({ length: 32 }, (_value, index) => ({
        kind: 'file' as const,
        reference: `src/${index}-${'z'.repeat(980)}.ts`
      }))
    };

    expect((): void => {
      createDetailProjector(projection).projectDetail('session-projector', projection.task.taskId);
    }).toThrow('agent_task_projection_oversized');
  });

  it('rejects arbitrary authorization schemes across projector identity and display layers', (): void => {
    const projection = createProjection({ suffix: 'arbitrary-auth', status: 'completed', resultSummary: 'Authorization: Digest result-secret' });
    projection.task.contractSnapshot = {
      ...projection.task.contractSnapshot,
      resources: [{ kind: 'document', reference: 'document-auth' }]
    };
    const { result } = projection.task;
    if (!result || 'resultKind' in result) throw new Error('Fixture result must have an Attempt');
    result.artifacts = [
      {
        artifactId: 'artifact-auth',
        owner: { taskId: result.taskId, agentId: result.agentId, attemptId: result.attemptId },
        visibility: 'user',
        kind: 'report',
        reference: 'private-auth',
        createdAt: '2026-07-28T08:05:00.000Z'
      }
    ];
    const detail = createDetailProjector(
      projection,
      (): { readonly displayReference: string } => ({ displayReference: 'Authorization: Token resource-secret' }),
      (): { readonly reference: string } => ({ reference: 'Proxy-Authorization: Custom artifact-secret' })
    ).projectDetail('session-projector', projection.task.taskId);

    if (!detail || detail.recordState !== 'active') throw new Error('Detail fixture must be active');
    expect(detail.summary).toBe('[REDACTED]');
    expect(detail.resources).toEqual([]);
    expect(detail.artifacts).toEqual([]);
    expect(JSON.stringify(detail)).not.toMatch(/result-secret|resource-secret|artifact-secret|authorization/i);
  });

  it('keeps all public projection branches recursively free of internal keys and unsafe values', (): void => {
    const active = createProjection({ suffix: 'recursive-safe', status: 'completed', resultSummary: 'Done' });
    const tombstone = createProjection({ suffix: 'recursive-tombstone', recordState: 'tombstoned' });
    const projector = createDetailProjector(active);
    const listProjector = createAgentTaskProjector({
      store: createProjectorStore([active], { active: [active], terminal: [], hasMoreTerminal: false }).store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });

    expectPublicSafe(projector.projectSummary(active.task.taskId));
    expectPublicSafe(projector.projectDetail(active.task.sessionId, active.task.taskId));
    expectPublicSafe(createDetailProjector(tombstone).projectDetail(tombstone.task.sessionId, tombstone.task.taskId));
    expectPublicSafe(listProjector.listTasks({ sessionId: active.task.sessionId }));
  });

  it('fails closed for non-canonical persisted times before Summary or cursor emission', (): void => {
    const active = createProjection({ suffix: 'bad-summary-time' });
    active.task.updatedAt = '2026-07-28T08:00:03+00:00';
    expect((): void => {
      createDetailProjector(active).projectSummary(active.task.taskId);
    }).toThrow('agent_task_projection_invalid');

    const terminal = createProjection({
      suffix: 'bad-cursor-time',
      status: 'completed',
      resultSummary: 'Done',
      updatedAt: '2026-07-28T08:00:03+00:00'
    });
    const listProjector = createAgentTaskProjector({
      store: createProjectorStore([], { active: [], terminal: [terminal], hasMoreTerminal: true }).store,
      resolveResource: (): null => null,
      resolveArtifact: (): null => null
    });
    expect((): void => {
      listProjector.listTasks({ sessionId: terminal.task.sessionId });
    }).toThrow('agent_task_projection_invalid');
  });

  it('freezes the newly projected current Attempt object', (): void => {
    const projection = createProjection({ suffix: 'frozen-attempt' });
    const summary = createDetailProjector(projection).projectSummary(projection.task.taskId);

    if (!summary || summary.recordState !== 'active') throw new Error('Summary fixture must be active');
    expect(Object.isFrozen(summary.currentAttempt)).toBe(true);
  });

  it('silently filters ineligible artifacts and only warns when safe user candidates exceed capacity', (): void => {
    const filtered = createProjection({ suffix: 'artifact-filter-warning', status: 'completed', resultSummary: 'Done' });
    const filteredResult = filtered.task.result;
    if (!filteredResult || 'resultKind' in filteredResult) throw new Error('Fixture result must have an Attempt');
    filteredResult.artifacts = [
      {
        artifactId: 'artifact-internal',
        owner: { taskId: filteredResult.taskId, agentId: filteredResult.agentId, attemptId: filteredResult.attemptId },
        visibility: 'internal',
        kind: 'report',
        reference: 'private',
        createdAt: '2026-07-28T08:05:00.000Z'
      },
      {
        artifactId: 'artifact-forged',
        owner: { taskId: 'task-forged', agentId: filteredResult.agentId, attemptId: filteredResult.attemptId },
        visibility: 'user',
        kind: 'report',
        reference: 'private',
        createdAt: '2026-07-28T08:05:00.000Z'
      },
      {
        artifactId: 'artifact-unsafe',
        owner: { taskId: filteredResult.taskId, agentId: filteredResult.agentId, attemptId: filteredResult.attemptId },
        visibility: 'user',
        kind: 'report',
        reference: 'private',
        createdAt: '2026-07-28T08:05:00.000Z'
      }
    ];
    const filteredDetail = createDetailProjector(
      filtered,
      (): null => null,
      (artifact) => (artifact.artifactId === 'artifact-unsafe' ? { reference: '/private/unsafe' } : null)
    ).projectDetail(filtered.task.sessionId, filtered.task.taskId);
    if (!filteredDetail || filteredDetail.recordState !== 'active') throw new Error('Detail fixture must be active');
    expect(filteredDetail.artifacts).toEqual([]);
    expect(filteredDetail.warnings.map((warning): string => warning.code)).not.toContain('artifacts_truncated');

    const overflowing = createProjection({ suffix: 'artifact-overflow', status: 'completed', resultSummary: 'Done' });
    const overflowResult = overflowing.task.result;
    if (!overflowResult || 'resultKind' in overflowResult) throw new Error('Fixture result must have an Attempt');
    overflowResult.artifacts = Array.from({ length: 33 }, (_value, index) => ({
      artifactId: `artifact-safe-${index}`,
      owner: { taskId: overflowResult.taskId, agentId: overflowResult.agentId, attemptId: overflowResult.attemptId },
      visibility: 'user' as const,
      kind: 'report',
      reference: `private-${index}`,
      createdAt: '2026-07-28T08:05:00.000Z'
    }));
    const overflowDetail = createDetailProjector(
      overflowing,
      (): null => null,
      (artifact) => ({ reference: `artifact:public-${artifact.artifactId}` })
    ).projectDetail(overflowing.task.sessionId, overflowing.task.taskId);
    if (!overflowDetail || overflowDetail.recordState !== 'active') throw new Error('Detail fixture must be active');
    expect(overflowDetail.artifacts).toHaveLength(32);
    expect(overflowDetail.warnings.map((warning): string => warning.code)).toContain('artifacts_truncated');
  });

  it('fails closed when a timeline event names another checkpoint', (): void => {
    const projection = createProjection({ suffix: 'event-checkpoint-mismatch' });
    projection.events[0].checkpointId = 'checkpoint-forged';

    expect((): void => {
      createDetailProjector(projection).projectDetail(projection.task.sessionId, projection.task.taskId);
    }).toThrow('agent_task_timeline_invalid');
  });
});
