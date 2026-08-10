/**
 * @file file-commit.test.ts
 * @description 验证 Child 文件 changeset 的 commit boundary、崩溃注入与 journal 恢复。
 */
import { writeFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentResourceLease } from '../../../../../../electron/main/modules/chat/agents/scheduler.mjs';
import type { AgentAttemptRecord, AgentCheckpointRecord, AgentTaskRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type {
  AgentChangesetRecord,
  AgentCommitJournalRecord,
  AgentCommitJournalStatus,
  AgentConfirmationRecord,
  AgentFileOperationSnapshot,
  AgentWriteResultDraft,
  ChatAgentResult
} from 'types/chat-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  hashAgentPayload,
  hashAgentText,
  hashChangesetSnapshot,
  hashConfirmationRequestSnapshot,
  hashExecutionPlanSnapshot
} from '../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import {
  AGENT_COMMIT_JOURNAL_CACHE_LIMIT,
  createAgentFileCommitter,
  type AgentAtomicFileWriter,
  type AgentCommitCrashPoint,
  type AgentFileCommitDependencies,
  type AgentFileCommitInput,
  type AgentFileCommitStore
} from '../../../../../../electron/main/modules/chat/agents/file-commit.mjs';

/** 测试中统一使用的冻结时间。 */
const NOW = '2026-07-27T08:00:00.000Z';

/** 每个用例创建的临时目录，结束时统一清理。 */
const temporaryRoots: string[] = [];

/** 文件提交 fixture。 */
interface CommitFixture {
  /** 临时工作区。 */
  readonly workspaceRoot: string;
  /** journal 私有根。 */
  readonly journalRoot: string;
  /** 真实目标路径。 */
  readonly targetPaths: readonly string[];
  /** 持久化 Task。 */
  readonly task: AgentTaskRecord;
  /** 当前 Attempt。 */
  readonly attempt: AgentAttemptRecord;
  /** 已批准 changeset。 */
  readonly changeset: AgentChangesetRecord;
  /** 已批准 confirmation。 */
  readonly confirmation: AgentConfirmationRecord;
  /** commit 后的结果草稿。 */
  readonly resultDraft: AgentWriteResultDraft;
  /** 排他提交 lease。 */
  readonly lease: AgentResourceLease;
}

/** 内存 journal Store 可观察状态。 */
interface MemoryCommitStore extends AgentFileCommitStore {
  /** 最后一次 finalized 结果。 */
  finalizedResult?: ChatAgentResult;
  /** manual recovery 后的 Task 状态。 */
  taskStatus: AgentTaskRecord['status'];
  /** cancelled 收敛次数。 */
  cancelCount: number;
  /** changeset 当前持久化状态。 */
  changesetStatus: AgentChangesetRecord['status'];
  /** 模拟提交期间到达的取消时间。 */
  cancelRequestedAt?: string;
}

/**
 * 计算文件基础 revision。
 * @param targetPath - canonical 目标
 * @param content - 当前基础内容
 * @returns 与 overlay 相同的版本化 revision
 */
async function createBaseRevision(targetPath: string, content: string): Promise<string> {
  const stat = await fs.stat(targetPath);
  return hashAgentPayload({
    schemaVersion: 1,
    targetPath,
    exists: true,
    parentRealPath: await fs.realpath(path.dirname(targetPath)),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    contentHash: hashAgentText(content)
  });
}

/**
 * 计算 operationSetHash。
 * @param operations - 规范化操作
 * @returns 操作集合 hash
 */
function createOperationHash(operations: readonly AgentFileOperationSnapshot[]): string {
  return hashAgentPayload({
    schemaVersion: 1,
    operations: operations.map((operation) => ({
      operationId: operation.operationId,
      kind: operation.kind,
      targetPath: operation.targetPath,
      resourceScope: operation.resourceScope,
      baseRevision: operation.baseRevision,
      baseContentHash: operation.baseContentHash,
      targetContentHash: operation.targetContentHash,
      byteLength: operation.byteLength
    }))
  });
}

/**
 * 计算聚合基础 revision。
 * @param operations - 规范化操作
 * @returns 聚合基础 hash
 */
function createAggregateBase(operations: readonly AgentFileOperationSnapshot[]): string {
  return hashAgentPayload({
    schemaVersion: 1,
    bases: operations.map((operation) => ({
      targetPath: operation.targetPath,
      baseRevision: operation.baseRevision,
      baseContentHash: operation.baseContentHash
    }))
  });
}

/**
 * 创建可独立运行的文件提交 fixture。
 * @param fileCount - changeset 文件数
 * @returns 完整 commit 输入
 */
async function createFixture(fileCount = 1): Promise<CommitFixture> {
  const workspaceRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-agent-commit-workspace-')));
  const journalRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-agent-commit-journal-')));
  temporaryRoots.push(workspaceRoot, journalRoot);
  const taskId = `task-commit-${fileCount}`;
  const attemptId = `attempt-commit-${fileCount}`;
  const agentId = `agent-commit-${fileCount}`;
  const runtimeId = `runtime-commit-${fileCount}`;
  const operationFixtures = await Promise.all(
    Array.from({ length: fileCount }, async (_value, index): Promise<{ targetPath: string; operation: AgentFileOperationSnapshot }> => {
      const targetPath = path.join(workspaceRoot, `target-${index}.md`);
      const candidateReference = path.join(workspaceRoot, `.candidate-${index}`);
      const rollbackReference = path.join(workspaceRoot, `.rollback-${index}`);
      const baseContent = `old content ${index}`;
      const targetContent = `new content ${index}`;
      await Promise.all([
        fs.writeFile(targetPath, baseContent, 'utf8'),
        fs.writeFile(candidateReference, targetContent, { encoding: 'utf8', mode: 0o600 }),
        fs.writeFile(rollbackReference, baseContent, { encoding: 'utf8', mode: 0o600 })
      ]);
      const canonicalTarget = await fs.realpath(targetPath);
      return {
        targetPath: canonicalTarget,
        operation: {
          operationId: `operation-${index}`,
          kind: 'replace',
          displayPath: `target-${index}.md`,
          targetPath: canonicalTarget,
          resourceScope: `file:${canonicalTarget}`,
          baseRevision: await createBaseRevision(canonicalTarget, baseContent),
          baseContentHash: hashAgentText(baseContent),
          targetContentHash: hashAgentText(targetContent),
          candidateReference,
          rollbackReference,
          byteLength: Buffer.byteLength(targetContent, 'utf8')
        }
      };
    })
  );
  const targetPaths = operationFixtures.map((fixture): string => fixture.targetPath);
  const operations = operationFixtures.map((fixture): AgentFileOperationSnapshot => fixture.operation);

  const contractSnapshot = {
    contractSchemaVersion: 1,
    task: 'Apply approved files',
    acceptanceCriteria: ['Persist the approved content'],
    mode: 'write' as const,
    resources: targetPaths.map((targetPath) => ({ kind: 'file' as const, reference: path.basename(targetPath) })),
    requestedTools: ['stage_file_write'],
    required: true
  };
  const planBody = {
    planSchemaVersion: 1,
    policyVersion: 'controlled-write-v1',
    capabilitySet: ['stage_file_write'],
    modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
    permissionSnapshot: { scopeIds: ['workspace:write'] },
    resourceScopes: operations.map((operation): string => operation.resourceScope),
    toolEffectSet: [{ toolName: 'stage_file_write', effect: 'staged_file_write' as const }],
    commitPolicy: { mode: 'staged' as const, adapter: 'atomic-file-v1' },
    budget: { tokenLimit: 1000, costLimitUsd: 1, pricingVersion: 'test-v1' }
  };
  const plan = {
    ...planBody,
    planHash: hashExecutionPlanSnapshot(contractSnapshot, planBody)
  };
  const task: AgentTaskRecord = {
    taskId,
    sessionId: 'session-commit',
    turnId: 'turn-commit',
    agentId,
    parentAgentId: 'primary-agent',
    rootRuntimeId: 'primary-runtime',
    checkpointId: 'checkpoint-commit',
    toolCallId: 'tool-call-commit',
    contractSnapshot,
    contractSnapshotHash: hashAgentPayload({ schemaVersion: 1, contract: contractSnapshot }),
    executionPlanSnapshot: plan,
    executionPlanSnapshotHash: plan.planHash,
    status: 'queued',
    queuePhase: 'commit',
    priority: 'normal',
    currentAttemptId: attemptId,
    recordState: 'active',
    unfinishedJournalCount: 0,
    createdAt: NOW,
    updatedAt: NOW
  };
  const attempt: AgentAttemptRecord = {
    attemptId,
    taskId,
    attemptNumber: 1,
    parentRuntimeId: task.rootRuntimeId,
    planHash: plan.planHash,
    initialRuntimeId: runtimeId,
    currentRuntimeId: runtimeId,
    runtimeSequence: 1,
    status: 'running',
    usageSnapshot: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      modelCalls: 0,
      toolRounds: 0,
      queueDurationMs: 0,
      executionDurationMs: 0,
      externalRequests: 0,
      monetaryCost: { currency: 'USD', pricingVersion: 'test-v1', estimated: 0, actual: 'unknown' }
    },
    usageComplete: false,
    usageUpdatedAt: NOW,
    startedAt: NOW,
    createdAt: NOW
  };
  const baseRevision = createAggregateBase(operations);
  const operationSetHash = createOperationHash(operations);
  const unifiedDiff = 'approved diff';
  const diffReference = path.join(workspaceRoot, '.approved.diff');
  await fs.writeFile(diffReference, unifiedDiff, { encoding: 'utf8', mode: 0o600 });
  const diffHash = hashAgentPayload({
    schemaVersion: 1,
    baseRevision,
    operationSetHash,
    diffContentHash: hashAgentText(unifiedDiff)
  });
  const changesetSnapshot = {
    changesetSchemaVersion: 1,
    changesetId: 'changeset-commit',
    taskId,
    attemptId,
    agentId,
    runtimeId,
    planHash: plan.planHash,
    baseRevision,
    diffReference,
    diffHash,
    operationSetHash,
    resourceScopes: operations.map((operation): string => operation.resourceScope),
    operations,
    createdAt: NOW
  };
  const changeset: AgentChangesetRecord = {
    snapshot: changesetSnapshot,
    snapshotHash: hashChangesetSnapshot(changesetSnapshot),
    status: 'approved',
    confirmationId: 'confirmation-commit',
    recordState: 'active',
    updatedAt: NOW
  };
  const confirmationRequest = {
    confirmationSchemaVersion: 1,
    confirmationId: 'confirmation-commit',
    sessionId: task.sessionId,
    turnId: task.turnId,
    taskId,
    attemptId,
    agentId,
    runtimeId,
    toolCallId: task.toolCallId,
    changesetId: changeset.snapshot.changesetId,
    planHash: plan.planHash,
    baseRevision,
    diffHash,
    operationSetHash,
    resourceScopes: changesetSnapshot.resourceScopes,
    displayPaths: operations.map((operation): string => operation.displayPath),
    unifiedDiffReference: diffReference,
    riskLevel: 'write' as const,
    createdAt: NOW
  };
  const confirmation: AgentConfirmationRecord = {
    confirmationId: confirmationRequest.confirmationId,
    changesetId: changeset.snapshot.changesetId,
    request: confirmationRequest,
    requestHash: hashConfirmationRequestSnapshot(confirmationRequest),
    status: 'approved',
    version: 2,
    decision: 'approved',
    createdAt: NOW,
    updatedAt: NOW
  };
  const resultDraft: AgentWriteResultDraft = {
    taskId,
    agentId,
    attemptId,
    summary: 'Applied approved files.',
    criteria: [
      {
        criterionIndex: 0,
        claim: {
          status: 'satisfied',
          summary: 'The approved content was prepared.',
          evidence: []
        },
        verification: {
          status: 'verified',
          verifier: 'coordinator',
          evidence: []
        }
      }
    ],
    warnings: [],
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15,
      modelCalls: 1,
      toolRounds: 1,
      queueDurationMs: 1,
      executionDurationMs: 2,
      externalRequests: 0,
      monetaryCost: {
        currency: 'USD',
        pricingVersion: 'test-v1',
        estimated: 0.01,
        actual: 0.01
      }
    }
  };
  const lease: AgentResourceLease = {
    taskId,
    phase: 'commit',
    kind: 'exclusive-commit',
    signal: new AbortController().signal,
    release: (): void => undefined
  };
  return { workspaceRoot, journalRoot, targetPaths, task, attempt, changeset, confirmation, resultDraft, lease };
}

/**
 * 创建最小内存 Store，保留 journal 状态转换供恢复测试复用。
 * @param changeset - Store 可按 journal 绑定读取的 changeset
 * @returns 可观察 Store
 */
function createMemoryStore(changeset: AgentChangesetRecord): MemoryCommitStore {
  let journal: AgentCommitJournalRecord | undefined;

  /**
   * 更新当前 journal。
   * @param status - 新状态
   * @param operationId - 可选已应用操作
   * @returns 更新后的 journal
   */
  function updateJournal(status: AgentCommitJournalStatus, operationId?: string): AgentCommitJournalRecord {
    if (!journal) throw new Error('journal_missing');
    journal = {
      ...journal,
      status,
      appliedOperationIds: operationId ? [...journal.appliedOperationIds, operationId] : journal.appliedOperationIds,
      updatedAt: NOW,
      ...(['finalized', 'cancelled', 'failed'].includes(status) ? { finalizedAt: NOW } : {})
    };
    return journal;
  }

  const store: MemoryCommitStore = {
    taskStatus: 'queued',
    cancelCount: 0,
    changesetStatus: 'approved',
    createCommitJournal(input): AgentCommitJournalRecord {
      if (journal) return journal;
      journal = {
        journalId: input.journalId,
        taskId: input.intent.resultDraft.taskId,
        attemptId: input.intent.resultDraft.attemptId,
        changesetId: input.changesetId,
        confirmationId: input.confirmationId,
        confirmationVersion: input.confirmationVersion,
        planHash: input.intent.planHash,
        intent: input.intent,
        intentHash: input.intentHash,
        status: 'created',
        appliedOperationIds: [],
        createdAt: input.occurredAt,
        updatedAt: input.occurredAt
      };
      store.taskStatus = 'committing';
      store.changesetStatus = 'committing';
      return journal;
    },
    markJournalApplying(): AgentCommitJournalRecord {
      return updateJournal('applying');
    },
    markJournalOperation(input): AgentCommitJournalRecord {
      if (journal?.appliedOperationIds.includes(input.operationId)) return journal;
      return updateJournal('applying', input.operationId);
    },
    markJournalApplied(): AgentCommitJournalRecord {
      return updateJournal('applied');
    },
    finalizeCommit(input): AgentCheckpointRecord {
      store.finalizedResult = input.result;
      store.taskStatus = 'completed';
      store.changesetStatus = 'committed';
      updateJournal('finalized');
      return {} as AgentCheckpointRecord;
    },
    cancelCommitJournal(): AgentCommitJournalRecord {
      store.cancelCount += 1;
      store.changesetStatus = 'discarded';
      return updateJournal('cancelled');
    },
    finalizeCommitCancellation(): AgentCheckpointRecord {
      store.taskStatus = 'cancelled';
      return {} as AgentCheckpointRecord;
    },
    finalizeCommitFailure(input): AgentCheckpointRecord {
      if (!journal) throw new Error('journal_missing');
      journal = {
        ...journal,
        status: 'failed',
        error: input.error,
        finalizedAt: input.occurredAt,
        updatedAt: input.occurredAt
      };
      store.taskStatus = 'commit_failed';
      store.changesetStatus = 'discarded';
      return {} as AgentCheckpointRecord;
    },
    markManualRecovery(input): AgentCheckpointRecord {
      if (!journal) throw new Error('journal_missing');
      journal = { ...journal, status: 'manual_recovery', error: input.error, updatedAt: input.occurredAt };
      store.taskStatus = 'commit_failed';
      return {} as AgentCheckpointRecord;
    },
    listUnfinishedJournals(): AgentCommitJournalRecord[] {
      return journal && journal.status !== 'finalized' && journal.status !== 'failed' && (journal.status !== 'cancelled' || store.taskStatus === 'committing')
        ? [journal]
        : [];
    },
    getCommitJournal(): AgentCommitJournalRecord | null {
      return journal ?? null;
    },
    getChangeset(changesetId: string): AgentChangesetRecord | null {
      return changesetId === changeset.snapshot.changesetId ? { ...changeset, status: store.changesetStatus } : null;
    },
    getTask(taskId: string): AgentTaskRecord | null {
      if (taskId !== changeset.snapshot.taskId) return null;
      return {
        taskId,
        cancelRequestedAt: store.cancelRequestedAt
      } as AgentTaskRecord;
    }
  };
  return store;
}

/**
 * 创建 commit 输入。
 * @param fixture - 文件提交 fixture
 * @param overrides - 校验失败用局部覆盖
 * @returns committer 输入
 */
function createCommitInput(fixture: CommitFixture, overrides: Partial<AgentFileCommitInput> = {}): AgentFileCommitInput {
  return {
    task: fixture.task,
    attempt: fixture.attempt,
    changeset: fixture.changeset,
    confirmation: fixture.confirmation,
    resultDraft: fixture.resultDraft,
    lease: fixture.lease,
    ...overrides
  };
}

/**
 * 创建带测试观测点的 committer。
 * @param fixture - 文件提交 fixture
 * @param store - 内存 journal Store
 * @param options - crash 与 phase 观测器
 * @returns 文件提交器
 */
function createCommitter(
  fixture: CommitFixture,
  store: MemoryCommitStore,
  options: {
    readonly crashAt?: AgentCommitCrashPoint;
    readonly phases?: string[];
    readonly onPhase?: AgentFileCommitDependencies['onPhase'];
    readonly writeFileAtomically?: AgentFileCommitDependencies['writeFileAtomically'];
  } = {}
) {
  return createAgentFileCommitter({
    store,
    journalRoot: fixture.journalRoot,
    now: (): string => NOW,
    createId: (): string => 'journal-commit',
    getPermissionScopeIds: (): readonly string[] => ['workspace:write'],
    onPhase: (phase): void => {
      options.phases?.push(phase);
      options.onPhase?.(phase);
    },
    injectCrash: (point): void => {
      if (point === options.crashAt) throw new Error(`crash:${point}`);
    },
    ...(options.writeFileAtomically ? { writeFileAtomically: options.writeFileAtomically } : {})
  });
}

afterEach(async (): Promise<void> => {
  vi.restoreAllMocks();
  await Promise.all(temporaryRoots.splice(0).map((root): Promise<void> => fs.rm(root, { recursive: true, force: true })));
});

describe('agent file committer', (): void => {
  it('bounds retained Task journal lookup entries during recovery', async (): Promise<void> => {
    const journals = Array.from(
      { length: AGENT_COMMIT_JOURNAL_CACHE_LIMIT + 1 },
      (_value, index): AgentCommitJournalRecord => ({
        journalId: `journal-${index}`,
        taskId: `task-${index}`,
        attemptId: `attempt-${index}`,
        changesetId: `changeset-${index}`,
        confirmationId: `confirmation-${index}`,
        confirmationVersion: 1,
        planHash: 'a'.repeat(64),
        intent: {} as AgentCommitJournalRecord['intent'],
        intentHash: 'b'.repeat(64),
        status: 'cancelled',
        appliedOperationIds: [],
        createdAt: NOW,
        updatedAt: NOW,
        finalizedAt: NOW
      })
    );
    const store = {
      listUnfinishedJournals: (): AgentCommitJournalRecord[] => journals
    } as unknown as AgentFileCommitStore;
    const committer = createAgentFileCommitter({
      store,
      journalRoot: '/private/journals',
      now: (): string => NOW,
      createId: (): string => 'unused-journal',
      getPermissionScopeIds: (): readonly string[] => []
    });

    await committer.recover();

    expect(committer.getRetainedJournalCount()).toBe(AGENT_COMMIT_JOURNAL_CACHE_LIMIT);
  });

  it('creates a durable journal before atomically applying and finalizing approved content', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    const phases: string[] = [];
    const committer = createCommitter(fixture, store, { phases });

    const result = await committer.commit(createCommitInput(fixture));

    expect(result).toMatchObject({
      journal: { status: 'finalized' },
      targetHashes: [fixture.changeset.snapshot.operations[0]?.targetContentHash]
    });
    expect(await fs.readFile(fixture.targetPaths[0] as string, 'utf8')).toBe('new content 0');
    expect(result.journal.intent.operations[0]?.candidateReference).toContain(fixture.journalRoot);
    expect(result.result.changeset).toMatchObject({ changesetId: fixture.changeset.snapshot.changesetId });
    expect(phases).toEqual([
      'validate',
      'journal-created',
      'journal-applying',
      'operation-applied',
      'journal-applied',
      'targets-verified',
      'journal-finalized'
    ]);
  });

  it('keeps a finalized commit completed when cancellation arrives after durable application starts', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    store.cancelRequestedAt = '2026-07-27T00:00:01.000Z';
    const committer = createCommitter(fixture, store);

    const result = await committer.commit(createCommitInput(fixture));

    expect(result.result).toMatchObject({
      executionStatus: 'completed',
      warnings: [{ code: 'cancel_arrived_too_late', message: expect.any(String) }]
    });
    expect(store.taskStatus).toBe('completed');
  });

  it('arbitrates cancellation against the durable journal boundary', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    const crashingCommitter = createCommitter(fixture, store, { crashAt: 'after_journal_created' });
    await expect(crashingCommitter.commit(createCommitInput(fixture))).rejects.toThrow('crash:after_journal_created');
    const committer = createCommitter(fixture, store);

    const cancelled = await committer.cancelTask(fixture.task.taskId);

    expect(cancelled).toMatchObject({
      disposition: 'journal_cancelled',
      journal: {
        taskId: fixture.task.taskId,
        status: 'cancelled',
        appliedOperationIds: []
      }
    });
    expect(store.cancelCount).toBe(1);
    expect(store.taskStatus).toBe('committing');
    expect(await committer.cancelTask(fixture.task.taskId)).toEqual(cancelled);
  });

  it('keeps applying journal ownership after the irreversible line', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    const crashingCommitter = createCommitter(fixture, store, { crashAt: 'after_journal_created' });
    await expect(crashingCommitter.commit(createCommitInput(fixture))).rejects.toThrow('crash:after_journal_created');
    store.markJournalApplying({
      journalId: 'journal-commit',
      occurredAt: NOW
    });
    const committer = createCommitter(fixture, store);

    const disposition = await committer.cancelTask(fixture.task.taskId);

    expect(disposition).toMatchObject({
      disposition: 'commit_in_progress',
      journal: {
        status: 'applying'
      }
    });
    expect(store.cancelCount).toBe(0);
    expect(store.taskStatus).toBe('committing');
  });

  it('serializes a live cancellation before journal applying begins', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    let cancellation: ReturnType<ReturnType<typeof createCommitter>['cancelTask']> | undefined;
    let requestCancel: ReturnType<typeof createCommitter>['cancelTask'] | undefined;
    const committer = createCommitter(fixture, store, {
      onPhase: (phase): void => {
        if (phase === 'journal-created') cancellation = requestCancel?.(fixture.task.taskId);
      }
    });
    requestCancel = committer.cancelTask.bind(committer);

    await expect(committer.commit(createCommitInput(fixture))).rejects.toMatchObject({
      code: 'cancelled',
      phase: 'commit'
    });
    if (!cancellation) throw new Error('cancellation_not_requested');
    await expect(cancellation).resolves.toMatchObject({
      disposition: 'journal_cancelled',
      journal: {
        status: 'cancelled'
      }
    });
    expect(store.cancelCount).toBe(1);
    expect(await fs.readFile(fixture.targetPaths[0] as string, 'utf8')).toBe('old content 0');
  });

  it('fails closed before journal creation and external mutation when the lease is not the current exclusive commit', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    const writeFileAtomically = vi.fn<AgentAtomicFileWriter>();
    const committer = createCommitter(fixture, store, { writeFileAtomically });
    const invalidLease = { ...fixture.lease, kind: 'write-intent' as const, phase: 'start' as const };

    await expect(committer.commit(createCommitInput(fixture, { lease: invalidLease }))).rejects.toMatchObject({
      code: 'protocol_error',
      phase: 'commit_validation'
    });
    expect(writeFileAtomically).not.toHaveBeenCalled();
    expect(store.listUnfinishedJournals()).toEqual([]);
  });

  it('rejects stale confirmation hashes, changed base content and post-confirmation symlinks', async (): Promise<void> => {
    const staleConfirmationFixture = await createFixture();
    const staleConfirmationStore = createMemoryStore(staleConfirmationFixture.changeset);
    const staleConfirmationCommitter = createCommitter(staleConfirmationFixture, staleConfirmationStore);
    const staleConfirmation = {
      ...staleConfirmationFixture.confirmation,
      request: {
        ...staleConfirmationFixture.confirmation.request,
        diffHash: 'f'.repeat(64)
      }
    };
    await expect(staleConfirmationCommitter.commit(createCommitInput(staleConfirmationFixture, { confirmation: staleConfirmation }))).rejects.toMatchObject({
      phase: 'commit_validation'
    });
    expect(staleConfirmationStore.listUnfinishedJournals()).toEqual([]);

    const staleBaseFixture = await createFixture();
    await fs.writeFile(staleBaseFixture.targetPaths[0] as string, 'concurrent content', 'utf8');
    await expect(
      createCommitter(staleBaseFixture, createMemoryStore(staleBaseFixture.changeset)).commit(createCommitInput(staleBaseFixture))
    ).rejects.toMatchObject({
      code: 'stale_context',
      phase: 'commit_validation'
    });

    const symlinkFixture = await createFixture();
    const targetPath = symlinkFixture.targetPaths[0] as string;
    const movedPath = `${targetPath}.moved`;
    await fs.rename(targetPath, movedPath);
    await fs.symlink(movedPath, targetPath);
    await expect(createCommitter(symlinkFixture, createMemoryStore(symlinkFixture.changeset)).commit(createCommitInput(symlinkFixture))).rejects.toMatchObject({
      phase: 'resource_validation'
    });
  });

  it('cancels a created journal whose targets remain at the frozen base', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    const crashingCommitter = createCommitter(fixture, store, { crashAt: 'after_journal_created' });
    await expect(crashingCommitter.commit(createCommitInput(fixture))).rejects.toThrow('crash:after_journal_created');

    const recovery = await createCommitter(fixture, store).recover();

    expect(recovery).toEqual([
      {
        journalId: 'journal-commit',
        status: 'cancelled',
        taskId: fixture.task.taskId,
        attemptId: fixture.attempt.attemptId
      }
    ]);
    expect(await fs.readFile(fixture.targetPaths[0] as string, 'utf8')).toBe('old content 0');
    expect(store.taskStatus).toBe('committing');
    expect(store.cancelCount).toBe(1);
    expect(await createCommitter(fixture, store).recover()).toEqual(recovery);
    store.finalizeCommitCancellation({
      journalId: 'journal-commit',
      occurredAt: NOW,
      startupRecovery: true
    });
    expect(await createCommitter(fixture, store).recover()).toEqual([]);
  });

  it('converges a deterministic post-boundary failure to commit_failed without reporting cancellation', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    const writeFileAtomically = vi.fn(async (): Promise<void> => undefined);

    await expect(createCommitter(fixture, store, { writeFileAtomically }).commit(createCommitInput(fixture))).rejects.toMatchObject({
      code: 'commit_failed',
      phase: 'commit'
    });

    expect(store.taskStatus).toBe('commit_failed');
    expect(store.getCommitJournal('journal-commit')).toMatchObject({
      status: 'failed',
      error: {
        code: 'commit_failed',
        phase: 'commit'
      }
    });
    expect(store.getCommitJournal('journal-commit')).not.toMatchObject({ status: 'cancelled' });
  });

  it('preserves partial workspace mutation and journal evidence when a later operation deterministically mismatches', async (): Promise<void> => {
    const fixture = await createFixture(2);
    const store = createMemoryStore(fixture.changeset);
    let writeCount = 0;
    const writeFileAtomically = vi.fn<AgentAtomicFileWriter>(async (filePath, content, options): Promise<void> => {
      writeCount += 1;
      if (writeCount === 1) await fs.writeFile(filePath, content, options);
    });

    await expect(createCommitter(fixture, store, { writeFileAtomically }).commit(createCommitInput(fixture))).rejects.toMatchObject({
      code: 'manual_recovery_required'
    });

    expect(store.taskStatus).toBe('commit_failed');
    expect(store.getCommitJournal('journal-commit')).toMatchObject({
      status: 'manual_recovery',
      appliedOperationIds: ['operation-0'],
      error: {
        code: 'manual_recovery_required'
      }
    });
    expect(store.getChangeset(fixture.changeset.snapshot.changesetId)).toMatchObject({ status: 'committing' });
    expect(await fs.readFile(fixture.targetPaths[0] as string, 'utf8')).toBe('new content 0');
    expect(await fs.readFile(fixture.targetPaths[1] as string, 'utf8')).toBe('old content 1');
    await expect(fs.access(fixture.changeset.snapshot.operations[0]?.candidateReference as string)).resolves.toBeUndefined();
    await expect(fs.access(fixture.changeset.snapshot.operations[0]?.rollbackReference as string)).resolves.toBeUndefined();
  });

  it('enters manual recovery when final validation drifts after the journal is applied', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    const committer = createCommitter(fixture, store, {
      onPhase: (phase): void => {
        if (phase === 'journal-applied') writeFileSync(fixture.targetPaths[0] as string, 'external drift', 'utf8');
      }
    });

    await expect(committer.commit(createCommitInput(fixture))).rejects.toMatchObject({
      code: 'manual_recovery_required'
    });

    expect(store.taskStatus).toBe('commit_failed');
    expect(store.getCommitJournal('journal-commit')).toMatchObject({
      status: 'manual_recovery',
      appliedOperationIds: ['operation-0'],
      error: {
        code: 'manual_recovery_required'
      }
    });
    expect(await fs.readFile(fixture.targetPaths[0] as string, 'utf8')).toBe('external drift');
  });

  it('converges an unknown writer failure to manual recovery and preserves its journal', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    const writeFileAtomically = vi.fn(async (): Promise<void> => {
      throw new Error('unknown writer outcome');
    });

    await expect(createCommitter(fixture, store, { writeFileAtomically }).commit(createCommitInput(fixture))).rejects.toMatchObject({
      code: 'manual_recovery_required',
      phase: 'commit'
    });

    expect(store.taskStatus).toBe('commit_failed');
    expect(store.getCommitJournal('journal-commit')).toMatchObject({
      status: 'manual_recovery',
      error: {
        code: 'manual_recovery_required'
      }
    });
  });

  it.each<AgentCommitCrashPoint>(['after_first_operation', 'after_all_operations', 'after_target_validation'])(
    'rolls forward and finalizes idempotently after %s',
    async (crashAt): Promise<void> => {
      const fixture = await createFixture(2);
      const store = createMemoryStore(fixture.changeset);
      const writeCalls: string[] = [];
      const writeFileAtomically: AgentFileCommitDependencies['writeFileAtomically'] = async (filePath, content, options): Promise<void> => {
        writeCalls.push(filePath);
        await fs.writeFile(filePath, content, options);
      };
      const crashingCommitter = createCommitter(fixture, store, { crashAt, writeFileAtomically });
      await expect(crashingCommitter.commit(createCommitInput(fixture))).rejects.toThrow(`crash:${crashAt}`);
      const callsBeforeRecovery = [...writeCalls];

      const recovery = await createCommitter(fixture, store, { writeFileAtomically }).recover();

      expect(recovery).toEqual([
        {
          journalId: 'journal-commit',
          status: 'finalized',
          taskId: fixture.task.taskId,
          attemptId: fixture.attempt.attemptId
        }
      ]);
      expect(await Promise.all(fixture.targetPaths.map((targetPath): Promise<string> => fs.readFile(targetPath, 'utf8')))).toEqual([
        'new content 0',
        'new content 1'
      ]);
      expect(new Set(writeCalls).size).toBe(writeCalls.length);
      if (crashAt !== 'after_first_operation') expect(writeCalls).toEqual(callsBeforeRecovery);
      expect(await createCommitter(fixture, store, { writeFileAtomically }).recover()).toEqual([]);
    }
  );

  it('enters manual recovery when an unfinished journal observes neither base nor target content', async (): Promise<void> => {
    const fixture = await createFixture();
    const store = createMemoryStore(fixture.changeset);
    await expect(createCommitter(fixture, store, { crashAt: 'after_journal_created' }).commit(createCommitInput(fixture))).rejects.toThrow();
    await fs.writeFile(fixture.targetPaths[0] as string, 'unknown external content', 'utf8');

    const recovery = await createCommitter(fixture, store).recover();

    expect(recovery).toEqual([
      {
        journalId: 'journal-commit',
        status: 'manual_recovery',
        taskId: fixture.task.taskId,
        attemptId: fixture.attempt.attemptId
      }
    ]);
    expect(store.taskStatus).toBe('commit_failed');
    expect(store.listUnfinishedJournals()).toMatchObject([
      {
        status: 'manual_recovery',
        error: {
          code: 'manual_recovery_required',
          phase: 'recovery'
        }
      }
    ]);
  });
});
