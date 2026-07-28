/**
 * @file write-overlay.test.ts
 * @description 验证 Child write Attempt 私有 overlay 的隔离、完整性、资源限制与清理边界。
 */
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AgentExecutionPlanBody } from '../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import type { AgentAttemptRecord, AgentTaskRecord } from '../../../../../../electron/main/modules/chat/agents/types.mjs';
import type { AgentExecutionPlanSnapshot } from 'types/chat-agent';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENT_MAX_CHANGESET_BYTES,
  AGENT_MAX_CHANGESET_OPERATIONS,
  AGENT_MAX_DIFF_BYTES,
  AGENT_MAX_STAGED_FILE_BYTES,
  hashAgentPayload,
  hashAgentText,
  hashExecutionPlanSnapshot,
  validateExecutionPlanSnapshot,
  validateFoundationContract
} from '../../../../../../electron/main/modules/chat/agents/contracts.mjs';
import { createAgentWriteOverlay, discardTaskOverlay, type AgentWriteOverlay } from '../../../../../../electron/main/modules/chat/agents/write-overlay.mjs';

/** 测试创建并负责清理的临时根目录。 */
const temporaryRoots: string[] = [];

/** 固定测试时间。 */
const occurredAt = '2026-07-27T00:00:00.000Z';

/** 单次测试使用的隔离目录。 */
interface OverlayTestRoots {
  /** 临时总根。 */
  root: string;
  /** 真实工作区。 */
  workspaceRoot: string;
  /** 私有 overlay 根。 */
  overlayRoot: string;
}

/** write overlay 所需的持久化事实 fixture。 */
interface OverlayFacts {
  /** running write Task。 */
  task: AgentTaskRecord;
  /** 当前 running Attempt。 */
  attempt: AgentAttemptRecord;
  /** 冻结 staged-write 计划。 */
  plan: AgentExecutionPlanSnapshot;
}

/**
 * 创建隔离工作区与 overlay 根。
 * @returns 临时目录集合
 */
async function createRoots(): Promise<OverlayTestRoots> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tibis-agent-overlay-'));
  const workspaceRoot = path.join(root, 'workspace');
  const overlayRoot = path.join(root, 'overlays');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.mkdir(overlayRoot, { recursive: true });
  temporaryRoots.push(root);
  return { root, workspaceRoot: await fs.realpath(workspaceRoot), overlayRoot: await fs.realpath(overlayRoot) };
}

/**
 * 创建与真实 scope 绑定的 write Task、Attempt 和 Execution Plan。
 * @param resourceScopes - canonical 文件资源范围
 * @returns 可创建 overlay 的事实
 */
function createFacts(resourceScopes: readonly string[]): OverlayFacts {
  const contractValidation = validateFoundationContract({
    task: 'Stage controlled file changes',
    acceptanceCriteria: ['Return one integrity-bound changeset'],
    mode: 'write',
    resources: [{ kind: 'directory', reference: '.' }],
    requestedTools: ['stage_file_edit', 'stage_file_write'],
    required: true,
    priority: 'normal'
  });
  if (!contractValidation.ok) throw new Error('Write contract fixture must be valid');
  const body: AgentExecutionPlanBody = {
    planSchemaVersion: 1,
    policyVersion: 'controlled-write-v1',
    capabilitySet: ['stage_file_edit', 'stage_file_write'],
    modelSnapshot: { providerId: 'openai', modelId: 'gpt-5' },
    permissionSnapshot: { scopeIds: ['workspace-write'] },
    resourceScopes,
    toolEffectSet: [
      { toolName: 'stage_file_edit', effect: 'staged_file_write' },
      { toolName: 'stage_file_write', effect: 'staged_file_write' }
    ],
    commitPolicy: { mode: 'staged', adapter: 'atomic-file-v1' },
    budget: { tokenLimit: 1000, costLimitUsd: 1, pricingVersion: 'test-v1' }
  };
  const candidate: AgentExecutionPlanSnapshot = {
    ...body,
    planHash: hashExecutionPlanSnapshot(contractValidation.contractSnapshot, body)
  };
  const planValidation = validateExecutionPlanSnapshot(contractValidation.contractSnapshot, candidate);
  if (!planValidation.ok) throw new Error('Write plan fixture must be valid');
  const { plan } = planValidation;
  const task: AgentTaskRecord = {
    taskId: 'task-write',
    sessionId: 'session-write',
    turnId: 'turn-write',
    agentId: 'child-write',
    parentAgentId: 'primary',
    rootRuntimeId: 'runtime-root',
    checkpointId: 'checkpoint-write',
    toolCallId: 'tool-call-write',
    contractSnapshot: contractValidation.contractSnapshot,
    contractSnapshotHash: contractValidation.contractSnapshotHash,
    executionPlanSnapshot: plan,
    executionPlanSnapshotHash: plan.planHash,
    status: 'running',
    priority: 'normal',
    currentAttemptId: 'attempt-write',
    recordState: 'active',
    unfinishedJournalCount: 0,
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
  const attempt: AgentAttemptRecord = {
    attemptId: 'attempt-write',
    taskId: task.taskId,
    attemptNumber: 1,
    parentRuntimeId: 'runtime-parent',
    planHash: plan.planHash,
    initialRuntimeId: 'runtime-write',
    currentRuntimeId: 'runtime-write',
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
    usageUpdatedAt: occurredAt,
    startedAt: occurredAt,
    createdAt: occurredAt
  };
  return { task, attempt, plan };
}

/**
 * 创建确定性 ID 工厂。
 * @returns 按 kind 单调递增的 ID
 */
function createIdFactory(): (kind: 'changeset' | 'operation') => string {
  const counters = new Map<'changeset' | 'operation', number>();
  return (kind: 'changeset' | 'operation'): string => {
    const next = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, next);
    return `${kind}-${next}`;
  };
}

/**
 * 顺序暂存指定数量的新文件，确保每次调用都观察到前一次的总量。
 * @param overlay - 当前 Attempt overlay
 * @param count - 待暂存文件数
 * @param prefix - 文件名前缀
 * @param content - 每个文件的候选内容
 * @param indexContent - 是否使用当前索引作为候选内容
 * @param index - 当前递归索引
 * @returns 全部文件暂存完成
 */
async function stageCreateFiles(overlay: AgentWriteOverlay, count: number, prefix: string, content: string, indexContent: boolean, index = 0): Promise<void> {
  if (index >= count) return;
  await overlay.writeFile({ path: `${prefix}-${index}.md`, content: indexContent ? `${index}` : content });
  await stageCreateFiles(overlay, count, prefix, content, indexContent, index + 1);
}

afterEach(async (): Promise<void> => {
  const roots = temporaryRoots.splice(0);
  await Promise.allSettled(roots.map((root): Promise<void> => fs.rm(root, { recursive: true, force: true })));
});

describe('agent write overlay', (): void => {
  it('discards only one exact Attempt overlay and preserves siblings byte-for-byte', async (): Promise<void> => {
    const roots = await createRoots();
    const targetAttempt = path.join(roots.overlayRoot, 'task-target', 'attempt-target');
    const siblingAttempt = path.join(roots.overlayRoot, 'task-target', 'attempt-sibling');
    const neighborAttempt = path.join(roots.overlayRoot, 'task-neighbor', 'attempt-neighbor');
    await Promise.all([
      fs.mkdir(targetAttempt, { recursive: true }),
      fs.mkdir(siblingAttempt, { recursive: true }),
      fs.mkdir(neighborAttempt, { recursive: true })
    ]);
    await Promise.all([
      fs.writeFile(path.join(targetAttempt, 'candidate'), 'delete-me', 'utf8'),
      fs.writeFile(path.join(siblingAttempt, 'candidate'), 'keep-sibling', 'utf8'),
      fs.writeFile(path.join(neighborAttempt, 'candidate'), 'keep-neighbor', 'utf8')
    ]);

    await discardTaskOverlay({
      overlayRoot: roots.overlayRoot,
      taskId: 'task-target',
      attemptId: 'attempt-target'
    });

    await expect(fs.access(targetAttempt)).rejects.toThrow();
    await expect(fs.readFile(path.join(siblingAttempt, 'candidate'), 'utf8')).resolves.toBe('keep-sibling');
    await expect(fs.readFile(path.join(neighborAttempt, 'candidate'), 'utf8')).resolves.toBe('keep-neighbor');
  });

  it.each([
    { taskId: '../task', attemptId: 'attempt' },
    { taskId: 'task/nested', attemptId: 'attempt' },
    { taskId: '/absolute-task', attemptId: 'attempt' },
    { taskId: 'task', attemptId: '../attempt' },
    { taskId: 'task', attemptId: 'attempt/nested' },
    { taskId: 'task', attemptId: '/absolute-attempt' }
  ])('rejects unsafe cleanup identity segments %#', async ({ taskId, attemptId }): Promise<void> => {
    const roots = await createRoots();

    await expect(
      discardTaskOverlay({
        overlayRoot: roots.overlayRoot,
        taskId,
        attemptId
      })
    ).rejects.toMatchObject({
      details: { reason: 'overlay_cleanup_identity_invalid' }
    });
  });

  it('rejects task and Attempt symlinks without deleting their external targets', async (): Promise<void> => {
    const roots = await createRoots();
    const externalTask = path.join(roots.root, 'external-task');
    const externalAttempt = path.join(roots.root, 'external-attempt');
    await Promise.all([fs.mkdir(externalTask), fs.mkdir(externalAttempt)]);
    await Promise.all([
      fs.writeFile(path.join(externalTask, 'keep'), 'task-target', 'utf8'),
      fs.writeFile(path.join(externalAttempt, 'keep'), 'attempt-target', 'utf8')
    ]);
    await fs.symlink(externalTask, path.join(roots.overlayRoot, 'task-link'));
    await expect(
      discardTaskOverlay({
        overlayRoot: roots.overlayRoot,
        taskId: 'task-link',
        attemptId: 'attempt'
      })
    ).rejects.toMatchObject({
      details: { reason: 'overlay_cleanup_symlink_denied' }
    });

    const realTask = path.join(roots.overlayRoot, 'task-real');
    await fs.mkdir(realTask);
    await fs.symlink(externalAttempt, path.join(realTask, 'attempt-link'));
    await expect(
      discardTaskOverlay({
        overlayRoot: roots.overlayRoot,
        taskId: 'task-real',
        attemptId: 'attempt-link'
      })
    ).rejects.toMatchObject({
      details: { reason: 'overlay_cleanup_symlink_denied' }
    });
    await expect(fs.readFile(path.join(externalTask, 'keep'), 'utf8')).resolves.toBe('task-target');
    await expect(fs.readFile(path.join(externalAttempt, 'keep'), 'utf8')).resolves.toBe('attempt-target');
  });

  it('keeps the real workspace unchanged and prepares canonical replace integrity facts', async (): Promise<void> => {
    const roots = await createRoots();
    const targetPath = path.join(roots.workspaceRoot, 'notes.md');
    await fs.writeFile(targetPath, 'old content', 'utf8');
    const facts = createFacts([`file:${await fs.realpath(targetPath)}`]);
    const overlay = await createAgentWriteOverlay({
      ...facts,
      runtimeId: facts.attempt.currentRuntimeId,
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });

    const operation = await overlay.writeFile({ path: 'notes.md', content: 'new content' });

    expect(operation).toMatchObject({
      operationId: 'operation-1',
      displayPath: 'notes.md',
      changed: true,
      targetContentHash: hashAgentText('new content')
    });
    expect(await fs.readFile(targetPath, 'utf8')).toBe('old content');
    const changeset = await overlay.prepare();
    expect(changeset).toMatchObject({
      changesetId: 'changeset-1',
      taskId: facts.task.taskId,
      attemptId: facts.attempt.attemptId,
      runtimeId: facts.attempt.currentRuntimeId,
      planHash: facts.plan.planHash,
      operations: [
        {
          operationId: 'operation-1',
          kind: 'replace',
          displayPath: 'notes.md',
          baseContentHash: hashAgentText('old content'),
          targetContentHash: hashAgentText('new content')
        }
      ]
    });
    expect(changeset?.baseRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(changeset?.diffHash).toMatch(/^[a-f0-9]{64}$/);
    expect(changeset?.operationSetHash).toMatch(/^[a-f0-9]{64}$/);
    if (!changeset) throw new Error('Expected prepared changeset');
    const [preparedOperation] = changeset.operations;
    const unifiedDiff = await fs.readFile(changeset.diffReference, 'utf8');
    const expectedOperationSetHash = hashAgentPayload({
      schemaVersion: 1,
      operations: [
        {
          operationId: preparedOperation.operationId,
          kind: preparedOperation.kind,
          targetPath: preparedOperation.targetPath,
          resourceScope: preparedOperation.resourceScope,
          baseRevision: preparedOperation.baseRevision,
          baseContentHash: preparedOperation.baseContentHash,
          targetContentHash: preparedOperation.targetContentHash,
          byteLength: preparedOperation.byteLength
        }
      ]
    });
    const expectedBaseRevision = hashAgentPayload({
      schemaVersion: 1,
      bases: [
        {
          targetPath: preparedOperation.targetPath,
          baseRevision: preparedOperation.baseRevision,
          baseContentHash: preparedOperation.baseContentHash
        }
      ]
    });
    expect(changeset.operationSetHash).toBe(expectedOperationSetHash);
    expect(changeset.baseRevision).toBe(expectedBaseRevision);
    expect(changeset.diffHash).toBe(
      hashAgentPayload({
        schemaVersion: 1,
        baseRevision: expectedBaseRevision,
        operationSetHash: expectedOperationSetHash,
        diffContentHash: hashAgentText(unifiedDiff)
      })
    );
    expect(await fs.readFile(preparedOperation.candidateReference, 'utf8')).toBe('new content');
    expect(await fs.readFile(preparedOperation.rollbackReference, 'utf8')).toBe('old content');
    expect(unifiedDiff).toContain('-old content');
    expect((await fs.stat(path.dirname(changeset.diffReference))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(preparedOperation.candidateReference)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(preparedOperation.rollbackReference)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(changeset.diffReference)).mode & 0o777).toBe(0o600);
    expect(Object.isFrozen(changeset.operations)).toBe(true);
    expect(Object.isFrozen(changeset.resourceScopes)).toBe(true);
    expect(await overlay.prepare()).toBe(changeset);
    await expect(overlay.writeFile({ path: 'notes.md', content: 'later content' })).rejects.toMatchObject({
      details: { reason: 'overlay_prepared' }
    });
    expect(await fs.readFile(targetPath, 'utf8')).toBe('old content');
  });

  it('continues edits from the overlay, distinguishes create from replace, and omits no-op operations', async (): Promise<void> => {
    const roots = await createRoots();
    await fs.writeFile(path.join(roots.workspaceRoot, 'notes.md'), 'alpha beta', 'utf8');
    const facts = createFacts([`directory:${roots.workspaceRoot}/**`]);
    const overlay = await createAgentWriteOverlay({
      ...facts,
      runtimeId: facts.attempt.currentRuntimeId,
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });

    await overlay.editFile({ path: 'notes.md', oldString: 'alpha', newString: 'first', replaceAll: false });
    // 第二次编辑只命中 Overlay 候选内容，证明连续调用不会重新读取工作区。
    await overlay.editFile({ path: 'notes.md', oldString: 'first', newString: 'second', replaceAll: false });
    await overlay.writeFile({ path: 'new.md', content: 'created' });
    const noOp = await overlay.writeFile({ path: 'no-op.md', content: '' });

    expect(noOp.changed).toBe(false);
    const changeset = await overlay.prepare();
    expect(changeset?.operations).toMatchObject([
      { kind: 'create', displayPath: 'new.md' },
      { kind: 'replace', displayPath: 'notes.md' }
    ]);
    const notesOperation = changeset?.operations.find((operation): boolean => operation.displayPath === 'notes.md');
    expect(notesOperation).toBeDefined();
    if (!notesOperation) throw new Error('Expected notes operation');
    expect(await fs.readFile(notesOperation.candidateReference, 'utf8')).toBe('second beta');

    const emptyOverlay = await createAgentWriteOverlay({
      ...facts,
      task: { ...facts.task, taskId: 'task-empty', currentAttemptId: 'attempt-empty' },
      attempt: {
        ...facts.attempt,
        attemptId: 'attempt-empty',
        taskId: 'task-empty',
        initialRuntimeId: 'runtime-empty',
        currentRuntimeId: 'runtime-empty'
      },
      runtimeId: 'runtime-empty',
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });
    await emptyOverlay.writeFile({ path: 'no-op.md', content: '' });
    expect(await emptyOverlay.prepare()).toBeNull();
  });

  it('rejects ambiguous edit matches with stable reasons', async (): Promise<void> => {
    const roots = await createRoots();
    await fs.writeFile(path.join(roots.workspaceRoot, 'notes.md'), 'same same', 'utf8');
    const facts = createFacts([`directory:${roots.workspaceRoot}/**`]);
    const overlay = await createAgentWriteOverlay({
      ...facts,
      runtimeId: facts.attempt.currentRuntimeId,
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });

    await expect(overlay.editFile({ path: 'notes.md', oldString: 'missing', newString: 'next', replaceAll: false })).rejects.toMatchObject({
      details: { reason: 'edit_match_missing' }
    });
    await expect(overlay.editFile({ path: 'notes.md', oldString: 'same', newString: 'next', replaceAll: false })).rejects.toMatchObject({
      details: { reason: 'edit_match_ambiguous' }
    });
    await expect(overlay.editFile({ path: 'notes.md', oldString: '', newString: 'next', replaceAll: true })).rejects.toMatchObject({
      details: { reason: 'edit_match_empty' }
    });
  });

  it('rejects virtual, directory, binary, escaped and symlink-escaped targets', async (): Promise<void> => {
    const roots = await createRoots();
    const directoryPath = path.join(roots.workspaceRoot, 'folder');
    const binaryPath = path.join(roots.workspaceRoot, 'binary.bin');
    const outsidePath = path.join(roots.root, 'outside.md');
    const linkPath = path.join(roots.workspaceRoot, 'escape.md');
    await fs.mkdir(directoryPath);
    await fs.writeFile(binaryPath, Buffer.from([65, 0, 66]));
    await fs.writeFile(outsidePath, 'outside', 'utf8');
    await fs.symlink(outsidePath, linkPath);
    const facts = createFacts([`directory:${roots.workspaceRoot}/**`]);
    const overlay = await createAgentWriteOverlay({
      ...facts,
      runtimeId: facts.attempt.currentRuntimeId,
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });

    await expect(overlay.writeFile({ path: 'unsaved://draft', content: 'next' })).rejects.toMatchObject({
      details: { reason: 'overlay_virtual_path_denied' }
    });
    await expect(overlay.writeFile({ path: 'folder', content: 'next' })).rejects.toMatchObject({
      details: { reason: 'overlay_target_not_file' }
    });
    await expect(overlay.writeFile({ path: 'binary.bin', content: 'next' })).rejects.toMatchObject({
      details: { reason: 'overlay_binary_file_denied' }
    });
    await expect(overlay.writeFile({ path: 'binary-candidate.md', content: 'next\0content' })).rejects.toMatchObject({
      details: { reason: 'overlay_binary_content_denied' }
    });
    await expect(overlay.writeFile({ path: '../outside.md', content: 'next' })).rejects.toMatchObject({
      details: { reason: 'overlay_workspace_escape' }
    });
    await expect(overlay.writeFile({ path: 'escape.md', content: 'next' })).rejects.toMatchObject({
      details: { reason: 'overlay_symlink_escape' }
    });
  });

  it('detects a changed base revision before producing a changeset', async (): Promise<void> => {
    const roots = await createRoots();
    const targetPath = path.join(roots.workspaceRoot, 'notes.md');
    await fs.writeFile(targetPath, 'base', 'utf8');
    const facts = createFacts([`file:${await fs.realpath(targetPath)}`]);
    const overlay = await createAgentWriteOverlay({
      ...facts,
      runtimeId: facts.attempt.currentRuntimeId,
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });
    await overlay.writeFile({ path: 'notes.md', content: 'candidate' });
    await fs.writeFile(targetPath, 'stale', 'utf8');

    await expect(overlay.prepare()).rejects.toMatchObject({
      code: 'stale_context',
      phase: 'commit_validation',
      details: { reason: 'overlay_base_revision_changed' }
    });
  });

  it('enforces operation, file, aggregate and diff size limits before confirmation', async (): Promise<void> => {
    const roots = await createRoots();
    const facts = createFacts([`directory:${roots.workspaceRoot}/**`]);
    const createOverlay = async (suffix: string) => {
      const taskId = `task-${suffix}`;
      const attemptId = `attempt-${suffix}`;
      const runtimeId = `runtime-${suffix}`;
      return createAgentWriteOverlay({
        ...facts,
        task: { ...facts.task, taskId, currentAttemptId: attemptId },
        attempt: { ...facts.attempt, attemptId, taskId, initialRuntimeId: runtimeId, currentRuntimeId: runtimeId },
        runtimeId,
        workspaceRoot: roots.workspaceRoot,
        overlayRoot: roots.overlayRoot,
        now: (): string => occurredAt,
        createId: createIdFactory()
      });
    };

    const operationOverlay = await createOverlay('operation-limit');
    await stageCreateFiles(operationOverlay, AGENT_MAX_CHANGESET_OPERATIONS, 'operation', '', true);
    await expect(operationOverlay.writeFile({ path: 'operation-overflow.md', content: 'overflow' })).rejects.toMatchObject({
      details: { reason: 'overlay_operation_limit_exceeded' }
    });

    const fileOverlay = await createOverlay('file-limit');
    await expect(fileOverlay.writeFile({ path: 'large.md', content: 'x'.repeat(AGENT_MAX_STAGED_FILE_BYTES + 1) })).rejects.toMatchObject({
      details: { reason: 'overlay_file_size_exceeded' }
    });

    const aggregateOverlay = await createOverlay('aggregate-limit');
    const fullFile = 'x'.repeat(AGENT_MAX_STAGED_FILE_BYTES);
    await stageCreateFiles(aggregateOverlay, AGENT_MAX_CHANGESET_BYTES / AGENT_MAX_STAGED_FILE_BYTES, 'aggregate', fullFile, false);
    await expect(aggregateOverlay.writeFile({ path: 'aggregate-overflow.md', content: 'x' })).rejects.toMatchObject({
      details: { reason: 'overlay_changeset_size_exceeded' }
    });

    const diffOverlay = await createOverlay('diff-limit');
    await diffOverlay.writeFile({ path: 'diff.md', content: 'x'.repeat(AGENT_MAX_DIFF_BYTES + 1) });
    await expect(diffOverlay.prepare()).rejects.toMatchObject({
      details: { reason: 'overlay_diff_size_exceeded' }
    });
  }, 20_000);

  it('disposes only the exact Attempt overlay directory', async (): Promise<void> => {
    const roots = await createRoots();
    const facts = createFacts([`directory:${roots.workspaceRoot}/**`]);
    const siblingDir = path.join(roots.overlayRoot, facts.task.taskId, 'attempt-sibling');
    await fs.mkdir(siblingDir, { recursive: true });
    await fs.writeFile(path.join(siblingDir, 'keep.txt'), 'keep', 'utf8');
    const overlay = await createAgentWriteOverlay({
      ...facts,
      runtimeId: facts.attempt.currentRuntimeId,
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });
    await overlay.writeFile({ path: 'new.md', content: 'candidate' });
    const attemptDir = path.join(roots.overlayRoot, facts.task.taskId, facts.attempt.attemptId);

    await overlay.dispose();

    await expect(fs.stat(attemptDir)).rejects.toBeDefined();
    expect(await fs.readFile(path.join(siblingDir, 'keep.txt'), 'utf8')).toBe('keep');
    await expect(overlay.writeFile({ path: 'later.md', content: 'denied' })).rejects.toMatchObject({
      details: { reason: 'overlay_disposed' }
    });
  });

  it('rejects a pre-existing Task overlay symlink before creating an Attempt directory', async (): Promise<void> => {
    const roots = await createRoots();
    const facts = createFacts([`directory:${roots.workspaceRoot}/**`]);
    const externalOverlayTarget = path.join(roots.root, 'external-overlay-target');
    await fs.mkdir(externalOverlayTarget);
    await fs.symlink(externalOverlayTarget, path.join(roots.overlayRoot, facts.task.taskId));

    await expect(
      createAgentWriteOverlay({
        ...facts,
        runtimeId: facts.attempt.currentRuntimeId,
        workspaceRoot: roots.workspaceRoot,
        overlayRoot: roots.overlayRoot,
        now: (): string => occurredAt,
        createId: createIdFactory()
      })
    ).rejects.toMatchObject({
      details: { reason: 'overlay_private_path_invalid' }
    });
    await expect(fs.stat(path.join(externalOverlayTarget, facts.attempt.attemptId))).rejects.toBeDefined();
  });

  it('rejects a pre-existing protected reference symlink without overwriting its target', async (): Promise<void> => {
    const roots = await createRoots();
    const facts = createFacts([`directory:${roots.workspaceRoot}/**`]);
    const attemptDirectory = path.join(roots.overlayRoot, facts.task.taskId, facts.attempt.attemptId);
    const externalFile = path.join(roots.root, 'external-candidate.md');
    await fs.mkdir(attemptDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(externalFile, 'keep', 'utf8');
    await fs.symlink(externalFile, path.join(attemptDirectory, 'operation-1.candidate'));
    const overlay = await createAgentWriteOverlay({
      ...facts,
      runtimeId: facts.attempt.currentRuntimeId,
      workspaceRoot: roots.workspaceRoot,
      overlayRoot: roots.overlayRoot,
      now: (): string => occurredAt,
      createId: createIdFactory()
    });

    await expect(overlay.writeFile({ path: 'notes.md', content: 'candidate' })).rejects.toMatchObject({
      details: { reason: 'overlay_private_reference_invalid' }
    });
    expect(await fs.readFile(externalFile, 'utf8')).toBe('keep');
  });
});
