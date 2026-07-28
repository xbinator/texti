/**
 * @file file-commit.mts
 * @description 在 durable commit journal 保护下验证、原子应用并恢复 Child 文件 changeset。
 */
import { Buffer } from 'node:buffer';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentResourceLease } from './scheduler.mjs';
import type { AgentAttemptRecord, AgentCheckpointRecord, AgentDelegationStore, AgentTaskRecord } from './types.mjs';
import type {
  AgentChangesetRecord,
  AgentCommitIntentSnapshot,
  AgentCommitJournalRecord,
  AgentConfirmationRecord,
  AgentFileOperationSnapshot,
  AgentTaskError,
  AgentTaskErrorCode,
  AgentTaskErrorPhase,
  AgentWriteResultDraft,
  ChatAgentResult
} from 'types/chat-agent';
import { writeFile as writeFileAtomically } from 'atomically';
import {
  AGENT_COMMIT_JOURNAL_SCHEMA_VERSION,
  AGENT_FILE_COMMIT_ADAPTER,
  hashAgentPayload,
  hashAgentText,
  hashCommitIntentSnapshot,
  validateChangesetSnapshot,
  validateCommitIntentSnapshot,
  validateConfirmationRequestSnapshot,
  validateExecutionPlanSnapshot
} from './contracts.mjs';
import { scopesOverlap } from './resource-scopes.mjs';

/** journal 私有目录权限。 */
const PRIVATE_DIRECTORY_MODE = 0o700;

/** journal 私有文件权限。 */
const PRIVATE_FILE_MODE = 0o600;

/** 测试和故障演练允许注入的精确崩溃点。 */
export type AgentCommitCrashPoint = 'after_journal_created' | 'after_first_operation' | 'after_all_operations' | 'after_target_validation';

/** 文件提交阶段的窄观测点。 */
export type AgentCommitPhase =
  | 'validate'
  | 'journal-created'
  | 'journal-applying'
  | 'operation-applied'
  | 'journal-applied'
  | 'targets-verified'
  | 'journal-finalized';

/** 可替换的原子文本写入边界。 */
export type AgentAtomicFileWriter = (filePath: string, content: string, options: { readonly encoding: 'utf8' }) => Promise<void>;

/** File committer 允许调用的最小 Store 能力。 */
export type AgentFileCommitStore = Pick<
  AgentDelegationStore,
  | 'createCommitJournal'
  | 'markJournalApplying'
  | 'markJournalOperation'
  | 'markJournalApplied'
  | 'cancelCommitJournal'
  | 'finalizeCommitCancellation'
  | 'finalizeCommit'
  | 'finalizeCommitFailure'
  | 'markManualRecovery'
  | 'listUnfinishedJournals'
  | 'getCommitJournal'
  | 'getChangeset'
  | 'getTask'
>;

/** 单次文件提交输入。 */
export interface AgentFileCommitInput {
  /** 当前 commit-queued Task。 */
  readonly task: AgentTaskRecord;
  /** Task 当前运行中 Attempt。 */
  readonly attempt: AgentAttemptRecord;
  /** 已批准不可变 changeset。 */
  readonly changeset: AgentChangesetRecord;
  /** 已批准 confirmation CAS 事实。 */
  readonly confirmation: AgentConfirmationRecord;
  /** journal 冻结的结果草稿。 */
  readonly resultDraft: AgentWriteResultDraft;
  /** 当前 Task 的排他提交许可。 */
  readonly lease: AgentResourceLease;
}

/** 成功完成文件提交后的权威结果。 */
export interface AgentFileCommitResult {
  /** finalized journal。 */
  readonly journal: AgentCommitJournalRecord;
  /** Store 原子汇合后的 Checkpoint。 */
  readonly checkpoint: AgentCheckpointRecord;
  /** canonical Task 结果。 */
  readonly result: ChatAgentResult;
  /** 按 targetPath 排序的最终内容 hash。 */
  readonly targetHashes: readonly string[];
}

/** FileCommitter 对 journal 安全取消请求的权威裁决。 */
export interface AgentFileCommitCancelResult {
  /** journal 已取消，或外部提交已越过不可逆边界。 */
  readonly disposition: 'journal_cancelled' | 'commit_in_progress';
  /** 裁决时的权威 journal。 */
  readonly journal: AgentCommitJournalRecord;
}

/** 单个 journal 的启动恢复结果。 */
export interface AgentJournalRecoveryResult {
  /** journal 身份。 */
  readonly journalId: string;
  /** 恢复后的稳定状态。 */
  readonly status: 'finalized' | 'cancelled' | 'manual_recovery';
  /** 所属 Task。 */
  readonly taskId: string;
  /** journal 绑定的不可变 Attempt。 */
  readonly attemptId: string;
}

/** 文件提交器可替换依赖。 */
export interface AgentFileCommitDependencies {
  /** 权威持久化 Store。 */
  readonly store: AgentFileCommitStore;
  /** Main 私有 journal 根目录。 */
  readonly journalRoot: string;
  /** @returns 当前 ISO-8601 时间。 */
  readonly now: () => string;
  /**
   * 创建稳定 journal 身份。
   * @param prefix - 身份种类
   * @returns 新身份
   */
  readonly createId: (prefix: 'journal') => string;
  /** @returns 当前仍有效的权限 scope IDs。 */
  readonly getPermissionScopeIds: () => readonly string[];
  /** 可选原子写替身。 */
  readonly writeFileAtomically?: AgentAtomicFileWriter;
  /**
   * 可选阶段观测器。
   * @param phase - 已完成阶段
   */
  readonly onPhase?: (phase: AgentCommitPhase) => void;
  /**
   * 可选崩溃注入器。
   * @param point - 精确注入点
   */
  readonly injectCrash?: (point: AgentCommitCrashPoint) => void;
}

/** File committer 对外能力。 */
export interface AgentFileCommitter {
  /**
   * 验证批准事实、创建 durable journal 并应用 changeset。
   * @param input - 当前 Task 的完整 commit boundary
   * @returns finalized journal、Checkpoint 与结果
   */
  commit(input: AgentFileCommitInput): Promise<AgentFileCommitResult>;
  /**
   * 在 journal 不可逆边界上仲裁 Task 取消。
   * @param taskId - committing Task 身份
   * @returns journal 取消或 commit 继续的权威 disposition
   */
  cancelTask(taskId: string): Promise<AgentFileCommitCancelResult>;
  /** @returns 全部未完成 journal 的确定性恢复结果。 */
  recover(): Promise<AgentJournalRecoveryResult[]>;
}

/** commit validation 或 recovery 使用的结构化错误。 */
export class AgentFileCommitError extends Error {
  /** 稳定 Agent 错误码。 */
  readonly code: AgentTaskErrorCode;

  /** 协议阶段。 */
  readonly phase: AgentTaskErrorPhase;

  /** 聚合分类。 */
  readonly category: AgentTaskError['category'];

  /** 相同冻结事实下不自动重试。 */
  readonly retryable = false;

  /** 不泄露本地路径的稳定细节。 */
  readonly details: NonNullable<AgentTaskError['details']>;

  /** 已原子收敛失败结果的 Checkpoint；前置校验失败时不存在。 */
  checkpoint?: AgentCheckpointRecord;

  /**
   * 创建结构化提交错误。
   * @param reason - 稳定机器原因
   * @param message - 展示说明
   * @param code - Agent 错误码
   * @param phase - 协议阶段
   * @param category - 聚合分类
   */
  constructor(
    reason: string,
    message: string,
    code: AgentTaskErrorCode = 'protocol_error',
    phase: AgentTaskErrorPhase = 'commit_validation',
    category: AgentTaskError['category'] = 'integrity'
  ) {
    super(message);
    this.name = 'AgentFileCommitError';
    this.code = code;
    this.phase = phase;
    this.category = category;
    this.details = { reason };
  }
}

/** 受保护引用读取结果。 */
interface ProtectedOperationContent {
  /** 原始操作。 */
  readonly operation: AgentFileOperationSnapshot;
  /** 已校验候选全文。 */
  readonly candidateContent: string;
  /** 已校验回滚全文。 */
  readonly rollbackContent: string;
}

/** 当前目标相对冻结 intent 的内容状态。 */
type TargetContentState = 'base' | 'target' | 'unknown';

/** 目标内容与 revision 校验结果。 */
interface TargetInspection {
  /** 当前内容状态。 */
  readonly state: TargetContentState;
  /** 当前内容 hash；文件缺失时为基础空内容 hash。 */
  readonly contentHash: string;
}

/**
 * 判断两个有序字符串集合是否完全一致。
 * @param left - 左集合
 * @param right - 右集合
 * @returns 长度和每项是否一致
 */
function matchStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index): boolean => value === right[index]);
}

/**
 * 判断路径是否位于指定根目录。
 * @param targetPath - 待判断路径
 * @param rootPath - canonical 根目录
 * @returns targetPath 是否未逃逸
 */
function isInside(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === '' || (relativePath !== '..' && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath));
}

/**
 * 识别文件不存在错误。
 * @param error - Node 文件系统错误
 * @returns 是否为 ENOENT
 */
function isMissingError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'ENOENT';
}

/**
 * 读取并验证 UTF-8 文本。
 * @param filePath - 目标文件
 * @param reason - 失败时稳定原因
 * @returns 完整文本
 */
async function readUtf8Text(filePath: string, reason: string): Promise<string> {
  const [readResult] = await Promise.allSettled([fs.readFile(filePath)]);
  if (readResult.status === 'rejected' || readResult.value.includes(0)) {
    throw new AgentFileCommitError(reason, 'Protected file content is missing or not supported UTF-8 text');
  }
  const content = readResult.value.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(readResult.value)) {
    throw new AgentFileCommitError(reason, 'Protected file content is not valid UTF-8 text');
  }
  return content;
}

/**
 * 验证受保护引用是绝对、非符号链接的普通文件。
 * @param reference - overlay 或 journal 引用
 * @param reason - 失败时稳定原因
 * @returns 引用文本
 */
async function readProtectedText(reference: string, reason: string): Promise<string> {
  if (!path.isAbsolute(reference) || path.resolve(reference) !== reference) {
    throw new AgentFileCommitError(reason, 'Protected reference must be an absolute normalized path');
  }
  const [statResult, realPathResult] = await Promise.allSettled([fs.lstat(reference), fs.realpath(reference)]);
  if (
    statResult.status === 'rejected' ||
    realPathResult.status === 'rejected' ||
    !statResult.value.isFile() ||
    statResult.value.isSymbolicLink() ||
    realPathResult.value !== reference
  ) {
    throw new AgentFileCommitError(reason, 'Protected reference is not a canonical regular file');
  }
  return readUtf8Text(reference, reason);
}

/**
 * 创建或复核一个私有目录。
 * @param directoryPath - 精确目录路径
 * @param rootPath - canonical journal 根
 * @returns canonical 私有目录
 */
async function ensurePrivateDirectory(directoryPath: string, rootPath: string): Promise<string> {
  const [initialResult] = await Promise.allSettled([fs.lstat(directoryPath)]);
  if (initialResult.status === 'rejected') {
    const [mkdirResult] = await Promise.allSettled([fs.mkdir(directoryPath, { mode: PRIVATE_DIRECTORY_MODE })]);
    if (mkdirResult.status === 'rejected') {
      throw new AgentFileCommitError('journal_directory_create_failed', 'Commit journal private directory could not be created');
    }
  }
  const [statResult, realPathResult, modeResult] = await Promise.allSettled([
    fs.lstat(directoryPath),
    fs.realpath(directoryPath),
    fs.chmod(directoryPath, PRIVATE_DIRECTORY_MODE)
  ]);
  if (
    statResult.status === 'rejected' ||
    realPathResult.status === 'rejected' ||
    modeResult.status === 'rejected' ||
    !statResult.value.isDirectory() ||
    statResult.value.isSymbolicLink() ||
    realPathResult.value !== directoryPath ||
    !isInside(realPathResult.value, rootPath)
  ) {
    throw new AgentFileCommitError('journal_directory_invalid', 'Commit journal private directory is unsafe');
  }
  return realPathResult.value;
}

/**
 * 使用 O_EXCL 写入不可变私有文本。
 * @param filePath - journal 内目标引用
 * @param content - 已校验文本
 */
async function writeProtectedText(filePath: string, content: string): Promise<void> {
  const noFollowFlag = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollowFlag;
  const [openResult] = await Promise.allSettled([fs.open(filePath, flags, PRIVATE_FILE_MODE)]);
  if (openResult.status === 'rejected') {
    throw new AgentFileCommitError('journal_reference_create_failed', 'Commit journal protected reference could not be created');
  }
  const handle = openResult.value;
  const [writeResult] = await Promise.allSettled([handle.writeFile(content, { encoding: 'utf8' })]);
  const [modeResult] = writeResult.status === 'fulfilled' ? await Promise.allSettled([handle.chmod(PRIVATE_FILE_MODE)]) : ([writeResult] as const);
  const [closeResult] = await Promise.allSettled([handle.close()]);
  if (writeResult.status === 'rejected' || modeResult.status === 'rejected' || closeResult.status === 'rejected') {
    throw new AgentFileCommitError('journal_reference_write_failed', 'Commit journal protected reference could not be written');
  }
}

/**
 * 投影 operationSetHash 使用的稳定字段。
 * @param operations - changeset 操作
 * @returns 版本化操作集合 hash
 */
function hashOperationSet(operations: readonly AgentFileOperationSnapshot[]): string {
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
 * 计算 changeset 聚合基础 revision。
 * @param operations - changeset 操作
 * @returns 版本化基础 hash
 */
function hashAggregateBase(operations: readonly AgentFileOperationSnapshot[]): string {
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
 * 判断目标路径是否命中 frozen scope。
 * @param targetPath - canonical 目标
 * @param resourceScope - canonical scope
 * @returns 是否授权
 */
function matchesScope(targetPath: string, resourceScope: string): boolean {
  try {
    return scopesOverlap(`file:${targetPath}`, resourceScope);
  } catch {
    throw new AgentFileCommitError(
      'commit_resource_scope_invalid',
      'Commit operation contains a malformed resource scope',
      'resource_scope_invalid',
      'resource_validation',
      'resource'
    );
  }
}

/**
 * 创建现有文件的基础 revision。
 * @param operation - 冻结操作
 * @param contentHash - 当前内容 hash
 * @param size - 当前字节数
 * @param mtimeMs - 当前修改时间
 * @param parentRealPath - canonical 父目录
 * @returns 版本化 revision
 */
function hashExistingRevision(operation: AgentFileOperationSnapshot, contentHash: string, size: number, mtimeMs: number, parentRealPath: string): string {
  return hashAgentPayload({
    schemaVersion: 1,
    targetPath: operation.targetPath,
    exists: true,
    parentRealPath,
    size,
    mtimeMs,
    contentHash
  });
}

/**
 * 创建缺失文件的基础 revision。
 * @param operation - 冻结 create 操作
 * @param parentRealPath - canonical 父目录
 * @returns 版本化 revision
 */
function hashMissingRevision(operation: AgentFileOperationSnapshot, parentRealPath: string): string {
  return hashAgentPayload({
    schemaVersion: 1,
    targetPath: operation.targetPath,
    exists: false,
    parentRealPath,
    size: 0,
    mtimeMs: 0,
    contentHash: hashAgentText('')
  });
}

/**
 * 读取当前目标并分类为 base、target 或 unknown。
 * @param operation - journal 冻结操作
 * @param requireBaseRevision - commit 前是否要求精确基础 revision
 * @returns 当前目标状态
 */
async function inspectTarget(operation: AgentFileOperationSnapshot, requireBaseRevision: boolean): Promise<TargetInspection> {
  if (!path.isAbsolute(operation.targetPath) || path.resolve(operation.targetPath) !== operation.targetPath) {
    throw new AgentFileCommitError(
      'commit_target_path_invalid',
      'Commit target path is not canonical',
      'resource_scope_invalid',
      'resource_validation',
      'resource'
    );
  }
  const [lstatResult] = await Promise.allSettled([fs.lstat(operation.targetPath)]);
  if (lstatResult.status === 'rejected') {
    if (!isMissingError(lstatResult.reason)) {
      throw new AgentFileCommitError(
        'commit_target_unreadable',
        'Commit target could not be inspected',
        'resource_scope_invalid',
        'resource_validation',
        'resource'
      );
    }
    const parentPath = path.dirname(operation.targetPath);
    const [parentStatResult, parentRealResult] = await Promise.allSettled([fs.lstat(parentPath), fs.realpath(parentPath)]);
    if (
      parentStatResult.status === 'rejected' ||
      parentRealResult.status === 'rejected' ||
      !parentStatResult.value.isDirectory() ||
      parentStatResult.value.isSymbolicLink() ||
      path.join(parentRealResult.value, path.basename(operation.targetPath)) !== operation.targetPath ||
      !matchesScope(operation.targetPath, operation.resourceScope)
    ) {
      throw new AgentFileCommitError(
        'commit_target_parent_changed',
        'Commit target parent no longer resolves to the approved path',
        'resource_scope_invalid',
        'resource_validation',
        'resource'
      );
    }
    const missingHash = hashAgentText('');
    const matchesBase =
      operation.kind === 'create' &&
      operation.baseContentHash === missingHash &&
      (!requireBaseRevision || operation.baseRevision === hashMissingRevision(operation, parentRealResult.value));
    if (requireBaseRevision && !matchesBase) {
      throw new AgentFileCommitError(
        'commit_base_revision_changed',
        'Workspace content changed after confirmation',
        'stale_context',
        'commit_validation',
        'integrity'
      );
    }
    return { state: matchesBase ? 'base' : 'unknown', contentHash: missingHash };
  }

  if (!lstatResult.value.isFile() || lstatResult.value.isSymbolicLink()) {
    throw new AgentFileCommitError(
      'commit_target_type_changed',
      'Commit target is no longer a canonical regular file',
      'resource_scope_invalid',
      'resource_validation',
      'resource'
    );
  }
  const [realPathResult, parentRealResult] = await Promise.allSettled([fs.realpath(operation.targetPath), fs.realpath(path.dirname(operation.targetPath))]);
  if (
    realPathResult.status === 'rejected' ||
    parentRealResult.status === 'rejected' ||
    realPathResult.value !== operation.targetPath ||
    !matchesScope(realPathResult.value, operation.resourceScope)
  ) {
    throw new AgentFileCommitError(
      'commit_target_realpath_changed',
      'Commit target realpath or resource scope changed after confirmation',
      'resource_scope_invalid',
      'resource_validation',
      'resource'
    );
  }
  const content = await readUtf8Text(operation.targetPath, 'commit_target_content_invalid');
  const contentHash = hashAgentText(content);
  let state: TargetContentState = 'unknown';
  if (contentHash === operation.baseContentHash) state = 'base';
  if (contentHash === operation.targetContentHash) state = 'target';
  if (requireBaseRevision) {
    const currentRevision = hashExistingRevision(operation, contentHash, lstatResult.value.size, lstatResult.value.mtimeMs, parentRealResult.value);
    if (state !== 'base' || currentRevision !== operation.baseRevision) {
      throw new AgentFileCommitError(
        'commit_base_revision_changed',
        'Workspace content changed after confirmation',
        'stale_context',
        'commit_validation',
        'integrity'
      );
    }
  }
  return { state, contentHash };
}

/**
 * 验证所有 overlay protected references 与操作 hash。
 * @param operations - changeset 操作
 * @returns 已校验候选与回滚文本
 */
async function validateProtectedReferences(operations: readonly AgentFileOperationSnapshot[]): Promise<ProtectedOperationContent[]> {
  const protectedReferences = operations.flatMap((operation): string[] => [operation.candidateReference, operation.rollbackReference]);
  const targetPaths = new Set(operations.map((operation): string => operation.targetPath));
  if (new Set(protectedReferences).size !== protectedReferences.length || protectedReferences.some((reference): boolean => targetPaths.has(reference))) {
    throw new AgentFileCommitError('commit_reference_overlap', 'Protected references overlap targets or each other');
  }
  return Promise.all(
    operations.map(async (operation): Promise<ProtectedOperationContent> => {
      const [candidateContent, rollbackContent] = await Promise.all([
        readProtectedText(operation.candidateReference, 'commit_candidate_reference_invalid'),
        readProtectedText(operation.rollbackReference, 'commit_rollback_reference_invalid')
      ]);
      if (
        hashAgentText(candidateContent) !== operation.targetContentHash ||
        hashAgentText(rollbackContent) !== operation.baseContentHash ||
        Buffer.byteLength(candidateContent, 'utf8') !== operation.byteLength
      ) {
        throw new AgentFileCommitError('commit_reference_hash_mismatch', 'Protected references do not match the approved operation hashes');
      }
      return { operation, candidateContent, rollbackContent };
    })
  );
}

/**
 * 把 overlay protected content 复制到 durable journal 私有目录。
 * @param dependencies - journal 根与依赖
 * @param taskId - Task 身份
 * @param journalId - journal 身份
 * @param contents - 已校验 overlay 内容
 * @returns 改写为 journal references 的操作
 */
async function copyJournalContent(
  dependencies: AgentFileCommitDependencies,
  taskId: string,
  journalId: string,
  contents: readonly ProtectedOperationContent[]
): Promise<AgentFileOperationSnapshot[]> {
  const [rootStatResult, rootRealResult] = await Promise.allSettled([fs.lstat(dependencies.journalRoot), fs.realpath(dependencies.journalRoot)]);
  if (
    rootStatResult.status === 'rejected' ||
    rootRealResult.status === 'rejected' ||
    !rootStatResult.value.isDirectory() ||
    rootStatResult.value.isSymbolicLink()
  ) {
    throw new AgentFileCommitError('journal_root_invalid', 'Commit journal root is not a canonical directory');
  }
  const rootPath = rootRealResult.value;
  const taskDirectory = path.join(rootPath, `task-${hashAgentText(taskId)}`);
  const journalDirectory = path.join(taskDirectory, `journal-${hashAgentText(journalId)}`);
  await ensurePrivateDirectory(taskDirectory, rootPath);
  await ensurePrivateDirectory(journalDirectory, rootPath);
  return Promise.all(
    contents.map(async (content, index): Promise<AgentFileOperationSnapshot> => {
      const referencePrefix = `${index}-${hashAgentText(content.operation.operationId)}`;
      const candidateReference = path.join(journalDirectory, `${referencePrefix}.candidate`);
      const rollbackReference = path.join(journalDirectory, `${referencePrefix}.rollback`);
      await Promise.all([writeProtectedText(candidateReference, content.candidateContent), writeProtectedText(rollbackReference, content.rollbackContent)]);
      return {
        ...content.operation,
        candidateReference,
        rollbackReference
      };
    })
  );
}

/**
 * 验证 Task、Attempt、lease、plan、changeset 与 confirmation 绑定。
 * @param input - commit boundary
 * @param dependencies - 当前权限依赖
 */
function validateCommitFacts(input: AgentFileCommitInput, dependencies: AgentFileCommitDependencies): void {
  const { task, attempt, changeset, confirmation, lease } = input;
  if (lease.taskId !== task.taskId || lease.phase !== 'commit' || lease.kind !== 'exclusive-commit' || lease.signal.aborted) {
    throw new AgentFileCommitError('commit_lease_invalid', 'Commit requires the current Task exclusive lease', 'protocol_error');
  }
  const plan = task.executionPlanSnapshot;
  const planValidation = plan ? validateExecutionPlanSnapshot(task.contractSnapshot, plan) : null;
  if (
    !plan ||
    !planValidation?.ok ||
    task.executionPlanSnapshotHash !== plan.planHash ||
    plan.commitPolicy.mode !== 'staged' ||
    plan.commitPolicy.adapter !== AGENT_FILE_COMMIT_ADAPTER
  ) {
    throw new AgentFileCommitError('commit_plan_invalid', 'Commit plan is missing, invalid, or uses another adapter', 'protocol_error');
  }
  const changesetValidation = validateChangesetSnapshot(changeset.snapshot, changeset.snapshotHash);
  const confirmationValidation = validateConfirmationRequestSnapshot(confirmation.request, confirmation.requestHash);
  if (!changesetValidation.ok || !confirmationValidation.ok) {
    throw new AgentFileCommitError('commit_snapshot_invalid', 'Changeset or confirmation snapshot integrity is invalid');
  }
  const { snapshot } = changesetValidation;
  const request = confirmationValidation.snapshot;
  if (
    task.recordState !== 'active' ||
    task.contractSnapshot.mode !== 'write' ||
    task.status !== 'queued' ||
    task.queuePhase !== 'commit' ||
    task.currentAttemptId !== attempt.attemptId ||
    attempt.taskId !== task.taskId ||
    attempt.status !== 'running' ||
    attempt.planHash !== plan.planHash ||
    changeset.status !== 'approved' ||
    changeset.recordState !== 'active' ||
    changeset.confirmationId !== confirmation.confirmationId ||
    confirmation.status !== 'approved' ||
    confirmation.decision !== 'approved' ||
    confirmation.version <= 1 ||
    confirmation.changesetId !== snapshot.changesetId ||
    snapshot.taskId !== task.taskId ||
    snapshot.attemptId !== attempt.attemptId ||
    snapshot.agentId !== task.agentId ||
    snapshot.runtimeId !== attempt.currentRuntimeId ||
    snapshot.planHash !== plan.planHash ||
    request.confirmationId !== confirmation.confirmationId ||
    request.taskId !== task.taskId ||
    request.attemptId !== attempt.attemptId ||
    request.agentId !== task.agentId ||
    request.runtimeId !== attempt.currentRuntimeId ||
    request.changesetId !== snapshot.changesetId ||
    request.planHash !== snapshot.planHash ||
    request.baseRevision !== snapshot.baseRevision ||
    request.diffHash !== snapshot.diffHash ||
    request.operationSetHash !== snapshot.operationSetHash ||
    !matchStrings(request.resourceScopes, snapshot.resourceScopes) ||
    input.resultDraft.taskId !== task.taskId ||
    input.resultDraft.agentId !== task.agentId ||
    input.resultDraft.attemptId !== attempt.attemptId ||
    input.resultDraft.criteria.length !== task.contractSnapshot.acceptanceCriteria.length ||
    input.resultDraft.criteria.some((criterion, index): boolean => criterion.criterionIndex !== index)
  ) {
    throw new AgentFileCommitError('commit_fact_binding_invalid', 'Commit facts do not bind the same approved Task aggregate');
  }
  const currentPermissions = new Set(dependencies.getPermissionScopeIds());
  if (plan.permissionSnapshot.scopeIds.length === 0 || plan.permissionSnapshot.scopeIds.some((scopeId): boolean => !currentPermissions.has(scopeId))) {
    throw new AgentFileCommitError(
      'commit_permission_revoked',
      'Frozen write permission is no longer available',
      'capability_denied',
      'commit_validation',
      'policy'
    );
  }
  const sortedOperations = [...snapshot.operations].sort((left, right): number => left.targetPath.localeCompare(right.targetPath));
  if (
    !sortedOperations.every((operation, index): boolean => operation.operationId === snapshot.operations[index]?.operationId) ||
    hashOperationSet(snapshot.operations) !== snapshot.operationSetHash ||
    hashAggregateBase(snapshot.operations) !== snapshot.baseRevision ||
    snapshot.operations.some(
      (operation): boolean =>
        !snapshot.resourceScopes.includes(operation.resourceScope) ||
        !plan.resourceScopes.includes(operation.resourceScope) ||
        !matchesScope(operation.targetPath, operation.resourceScope)
    )
  ) {
    throw new AgentFileCommitError('commit_operation_set_invalid', 'Commit operation set or base revision is invalid');
  }
}

/**
 * 验证 diff 完整性。
 * @param changeset - 已通过 snapshot 校验的 changeset
 */
async function validateDiff(changeset: AgentChangesetRecord): Promise<void> {
  const unifiedDiff = await readProtectedText(changeset.snapshot.diffReference, 'commit_diff_reference_invalid');
  const diffHash = hashAgentPayload({
    schemaVersion: 1,
    baseRevision: changeset.snapshot.baseRevision,
    operationSetHash: changeset.snapshot.operationSetHash,
    diffContentHash: hashAgentText(unifiedDiff)
  });
  if (diffHash !== changeset.snapshot.diffHash) {
    throw new AgentFileCommitError('commit_diff_hash_mismatch', 'Approved diff content no longer matches its hash');
  }
}

/**
 * 创建 journal intent。
 * @param input - commit boundary
 * @param operations - journal 私有引用操作
 * @param createdAt - intent 创建时间
 * @returns 不可变 intent
 */
function createCommitIntent(input: AgentFileCommitInput, operations: readonly AgentFileOperationSnapshot[], createdAt: string): AgentCommitIntentSnapshot {
  return {
    journalSchemaVersion: AGENT_COMMIT_JOURNAL_SCHEMA_VERSION,
    changesetSnapshotHash: input.changeset.snapshotHash,
    confirmationId: input.confirmation.confirmationId,
    confirmationVersion: input.confirmation.version,
    planHash: input.changeset.snapshot.planHash,
    resultDraft: input.resultDraft,
    operations,
    createdAt
  };
}

/**
 * 从冻结 draft、journal 与持久化 changeset 生成 canonical completed 结果。
 * @param journal - 已应用 journal
 * @param changeset - 原不可变 changeset
 * @param task - 提交时最新 Task 投影
 * @returns 最终 Task 结果
 */
function createCommitResult(journal: AgentCommitJournalRecord, changeset: AgentChangesetRecord, task: AgentTaskRecord): ChatAgentResult {
  const { resultDraft } = journal.intent;
  const verifiedCount = resultDraft.criteria.filter(
    (criterion): boolean => criterion.claim.status === 'satisfied' && criterion.verification.status === 'verified'
  ).length;
  let completionLevel: ChatAgentResult['completion']['level'] = 'partial';
  if (verifiedCount === 0) completionLevel = 'none';
  if (verifiedCount === resultDraft.criteria.length) completionLevel = 'full';
  return {
    taskId: resultDraft.taskId,
    agentId: resultDraft.agentId,
    attemptId: resultDraft.attemptId,
    executionStatus: 'completed',
    completion: {
      level: completionLevel,
      criteria: [...resultDraft.criteria]
    },
    summary: resultDraft.summary,
    ...(resultDraft.output === undefined ? {} : { output: resultDraft.output }),
    warnings: [
      ...resultDraft.warnings,
      ...(task.cancelRequestedAt
        ? [
            {
              code: 'cancel_arrived_too_late',
              message: 'Cancellation arrived after durable commit application had started; the approved changeset was finalized.'
            }
          ]
        : [])
    ],
    artifacts: [],
    changeset: {
      changesetId: changeset.snapshot.changesetId,
      baseRevision: changeset.snapshot.baseRevision,
      diffHash: changeset.snapshot.diffHash,
      operationSetHash: changeset.snapshot.operationSetHash,
      planHash: changeset.snapshot.planHash
    },
    usage: resultDraft.usage
  };
}

/**
 * 计算全部目标最终完整性 hash。
 * @param operations - 已排序操作
 * @returns 版本化 target hash
 */
function hashFinalTargets(operations: readonly AgentFileOperationSnapshot[]): string {
  return hashAgentPayload({
    schemaVersion: 1,
    targets: operations.map((operation) => ({
      operationId: operation.operationId,
      targetPath: operation.targetPath,
      targetContentHash: operation.targetContentHash
    }))
  });
}

/**
 * 创建人工恢复错误。
 * @param reason - 稳定原因
 * @param operationId - 可选问题操作
 * @returns allowlist AgentTaskError
 */
function createRecoveryError(reason: string, operationId?: string): AgentTaskError {
  return {
    code: 'manual_recovery_required',
    phase: 'recovery',
    category: 'integrity',
    retryable: false,
    details: {
      reason,
      ...(operationId ? { operationId } : {})
    }
  };
}

/**
 * 把不可逆边界后的异常收窄为确定性失败或未知外部状态。
 * @param reason - applyJournal 拒绝原因
 * @returns 可持久化的 commit 错误
 */
function normalizeCommitError(reason: unknown): AgentFileCommitError {
  if (reason instanceof AgentFileCommitError && (reason.code === 'commit_failed' || reason.code === 'manual_recovery_required')) return reason;
  return new AgentFileCommitError(
    'external_state_unknown',
    'Commit writer outcome is unknown after journal application began',
    'manual_recovery_required',
    'commit',
    'integrity'
  );
}

/**
 * 把可能已经产生外部 mutation 的提交失败收敛为人工恢复错误。
 * @param reason - 原始稳定原因
 * @returns 不自动丢弃任何 journal 证据的错误
 */
function createManualError(reason: string): AgentFileCommitError {
  return new AgentFileCommitError(
    reason,
    'Commit state requires manual recovery after journal application began',
    'manual_recovery_required',
    'commit',
    'integrity'
  );
}

/**
 * 执行可选故障注入，并把测试异常隔离为不可收敛的进程崩溃哨兵。
 * @param dependencies - commit 依赖
 * @param point - 精确故障点
 */
function injectCommitCrash(dependencies: AgentFileCommitDependencies, point: AgentCommitCrashPoint): void {
  if (!dependencies.injectCrash) return;
  try {
    dependencies.injectCrash(point);
  } catch {
    const crash = new Error(`crash:${point}`);
    crash.name = 'AgentCommitCrashError';
    throw crash;
  }
}

/**
 * 给已持久化失败错误绑定同一事务返回的 Checkpoint。
 * @param error - 已归一化提交错误
 * @param checkpoint - Store 汇合后的 Checkpoint
 * @returns 保留稳定错误字段的新错误
 */
function bindFailureCheckpoint(error: AgentFileCommitError, checkpoint: AgentCheckpointRecord): AgentFileCommitError {
  error.checkpoint = checkpoint;
  return error;
}

/**
 * 读取 journal candidate 并复核 target hash。
 * @param operation - journal 私有引用操作
 * @returns 候选全文
 */
async function readJournalCandidate(operation: AgentFileOperationSnapshot): Promise<string> {
  const candidate = await readProtectedText(operation.candidateReference, 'journal_candidate_invalid');
  const rollback = await readProtectedText(operation.rollbackReference, 'journal_rollback_invalid');
  if (
    hashAgentText(candidate) !== operation.targetContentHash ||
    hashAgentText(rollback) !== operation.baseContentHash ||
    Buffer.byteLength(candidate, 'utf8') !== operation.byteLength
  ) {
    throw new AgentFileCommitError('journal_protected_hash_mismatch', 'Journal protected content no longer matches its immutable intent');
  }
  return candidate;
}

/**
 * 最终化一个 applied journal。
 * @param dependencies - Store 与时间依赖
 * @param journal - applied journal
 * @param result - canonical completed result
 * @returns finalized 结果
 */
function finalizeJournal(dependencies: AgentFileCommitDependencies, journal: AgentCommitJournalRecord, result: ChatAgentResult): AgentFileCommitResult {
  const resultHash = hashAgentPayload(result);
  const checkpoint = dependencies.store.finalizeCommit({
    journalId: journal.journalId,
    result,
    resultHash,
    finalHash: hashFinalTargets(journal.intent.operations),
    occurredAt: dependencies.now()
  });
  const finalized = dependencies.store.getCommitJournal(journal.journalId);
  if (!finalized || finalized.status !== 'finalized') {
    throw new AgentFileCommitError('journal_finalize_projection_missing', 'Finalized journal projection is missing', 'commit_failed', 'commit', 'runtime');
  }
  dependencies.onPhase?.('journal-finalized');
  return {
    journal: finalized,
    checkpoint,
    result,
    targetHashes: finalized.intent.operations.map((operation): string => operation.targetContentHash)
  };
}

/**
 * 在 durable journal 下顺序应用操作。
 * @param dependencies - Store、writer 与观测依赖
 * @param initialJournal - created/applying/applied journal
 * @param recovery - 是否处于恢复路径
 * @returns applied journal
 */
async function applyJournal(
  dependencies: AgentFileCommitDependencies,
  initialJournal: AgentCommitJournalRecord,
  recovery: boolean
): Promise<AgentCommitJournalRecord> {
  let journal = initialJournal;
  if (journal.status === 'created') {
    journal = dependencies.store.markJournalApplying({ journalId: journal.journalId, occurredAt: dependencies.now() });
    dependencies.onPhase?.('journal-applying');
  }
  const writer: AgentAtomicFileWriter =
    dependencies.writeFileAtomically ??
    (async (filePath, content, options): Promise<void> => {
      await writeFileAtomically(filePath, content, options);
    });
  for (const [index, operation] of journal.intent.operations.entries()) {
    // Workspace operations must remain serial under the exclusive commit boundary.
    // eslint-disable-next-line no-await-in-loop
    const inspection = await inspectTarget(operation, false);
    if (inspection.state === 'unknown') {
      throw new AgentFileCommitError(
        'journal_target_state_unknown',
        'Journal target matches neither base nor target content',
        'manual_recovery_required',
        'recovery',
        'integrity'
      );
    }
    if (inspection.state === 'base') {
      // Candidate verification and replacement are one ordered journal operation.
      // eslint-disable-next-line no-await-in-loop
      const candidate = await readJournalCandidate(operation);
      // eslint-disable-next-line no-await-in-loop
      await writer(operation.targetPath, candidate, { encoding: 'utf8' });
    }
    // Persist progress only after the exact target hash is observable.
    // eslint-disable-next-line no-await-in-loop
    const verified = await inspectTarget(operation, false);
    if (verified.state !== 'target') {
      throw new AgentFileCommitError(
        'commit_target_hash_mismatch',
        'Atomic file replacement did not produce the approved target hash',
        recovery ? 'manual_recovery_required' : 'commit_failed',
        recovery ? 'recovery' : 'commit',
        'integrity'
      );
    }
    if (journal.status !== 'applied') {
      journal = dependencies.store.markJournalOperation({
        journalId: journal.journalId,
        operationId: operation.operationId,
        targetContentHash: operation.targetContentHash,
        occurredAt: dependencies.now()
      });
    }
    dependencies.onPhase?.('operation-applied');
    if (!recovery && index === 0) injectCommitCrash(dependencies, 'after_first_operation');
  }
  if (!recovery) injectCommitCrash(dependencies, 'after_all_operations');
  if (journal.status !== 'applied') {
    journal = dependencies.store.markJournalApplied({ journalId: journal.journalId, occurredAt: dependencies.now() });
    dependencies.onPhase?.('journal-applied');
  }
  const finalInspections = await Promise.all(journal.intent.operations.map((operation): Promise<TargetInspection> => inspectTarget(operation, false)));
  if (finalInspections.some((inspection): boolean => inspection.state !== 'target')) {
    throw new AgentFileCommitError(
      'commit_target_validation_failed',
      'Final target validation did not match the approved target hash',
      recovery ? 'manual_recovery_required' : 'commit_failed',
      recovery ? 'recovery' : 'commit',
      'integrity'
    );
  }
  dependencies.onPhase?.('targets-verified');
  if (!recovery) injectCommitCrash(dependencies, 'after_target_validation');
  return journal;
}

/**
 * 创建文件提交器。
 * @param dependencies - Store、journal 根、权限和确定性依赖
 * @returns commit 与 recover 边界
 */
export function createAgentFileCommitter(dependencies: AgentFileCommitDependencies): AgentFileCommitter {
  /** 每个 Task 的串行操作尾部。 */
  const taskTails = new Map<string, Promise<void>>();

  /** 当前实例已观察到的 Task journal。 */
  const taskJournals = new Map<string, AgentCommitJournalRecord>();

  /**
   * 把同一 Task 的 commit、cancel 与 recover 串行化。
   * @param taskId - Task 身份
   * @param operation - 串行执行的异步操作
   * @returns 操作结果
   */
  async function runTaskSerial<TResult>(taskId: string, operation: () => Promise<TResult>): Promise<TResult> {
    const previous = taskTails.get(taskId) ?? Promise.resolve();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve): void => {
      release = resolve;
    });
    const current = previous.then((): Promise<void> => gate);
    taskTails.set(taskId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
      if (taskTails.get(taskId) === current) taskTails.delete(taskId);
    }
  }

  /**
   * 读取本实例或 Store 中当前 Task 的 commit journal。
   * @param taskId - Task 身份
   * @returns journal；不存在时返回 null
   */
  function findTaskJournal(taskId: string): AgentCommitJournalRecord | null {
    const remembered = taskJournals.get(taskId);
    if (remembered) {
      const current = dependencies.store.getCommitJournal(remembered.journalId);
      if (current) {
        taskJournals.set(taskId, current);
        return current;
      }
    }
    const journal = dependencies.store.listUnfinishedJournals().find((candidate): boolean => candidate.taskId === taskId) ?? null;
    if (journal) taskJournals.set(taskId, journal);
    return journal;
  }

  /**
   * 把恢复异常收敛到 manual_recovery。
   * @param journal - 问题 journal
   * @returns 稳定恢复结果
   */
  function markRecoveryFailed(journal: AgentCommitJournalRecord): AgentJournalRecoveryResult {
    dependencies.store.markManualRecovery({
      journalId: journal.journalId,
      error: createRecoveryError('external_state_unknown'),
      occurredAt: dependencies.now()
    });
    return {
      journalId: journal.journalId,
      status: 'manual_recovery',
      taskId: journal.taskId,
      attemptId: journal.attemptId
    };
  }

  /**
   * 恢复单个 journal。
   * @param journal - 未完成 journal
   * @returns 稳定恢复结果
   */
  async function recoverJournal(journal: AgentCommitJournalRecord): Promise<AgentJournalRecoveryResult> {
    if (journal.status === 'cancelled') {
      return { journalId: journal.journalId, status: 'cancelled', taskId: journal.taskId, attemptId: journal.attemptId };
    }
    if (journal.status === 'manual_recovery') {
      return { journalId: journal.journalId, status: 'manual_recovery', taskId: journal.taskId, attemptId: journal.attemptId };
    }
    const validation = validateCommitIntentSnapshot(journal.intent, journal.intentHash);
    if (!validation.ok) throw new AgentFileCommitError('journal_intent_invalid', 'Persisted commit intent failed validation');
    await Promise.all(journal.intent.operations.map((operation): Promise<string> => readJournalCandidate(operation)));
    const inspections = await Promise.all(journal.intent.operations.map((operation): Promise<TargetInspection> => inspectTarget(operation, false)));
    if (inspections.some((inspection): boolean => inspection.state === 'unknown')) {
      return markRecoveryFailed(journal);
    }
    if (journal.status === 'created' && inspections.every((inspection): boolean => inspection.state === 'base')) {
      const cancelled = dependencies.store.cancelCommitJournal({ journalId: journal.journalId, occurredAt: dependencies.now() });
      taskJournals.set(cancelled.taskId, cancelled);
      return {
        journalId: cancelled.journalId,
        status: 'cancelled',
        taskId: cancelled.taskId,
        attemptId: cancelled.attemptId
      };
    }
    const applied = await applyJournal(dependencies, journal, true);
    const changeset = dependencies.store.getChangeset(journal.changesetId);
    if (!changeset || changeset.snapshotHash !== journal.intent.changesetSnapshotHash) {
      throw new AgentFileCommitError('journal_changeset_missing', 'Commit journal changeset projection is missing or changed');
    }
    const task = dependencies.store.getTask(journal.taskId);
    if (!task) throw new AgentFileCommitError('journal_task_missing', 'Commit journal Task projection is missing');
    const result = createCommitResult(applied, changeset, task);
    finalizeJournal(dependencies, applied, result);
    return { journalId: journal.journalId, status: 'finalized', taskId: journal.taskId, attemptId: journal.attemptId };
  }

  return {
    async commit(input: AgentFileCommitInput): Promise<AgentFileCommitResult> {
      const journal = await runTaskSerial(input.task.taskId, async (): Promise<AgentCommitJournalRecord> => {
        dependencies.onPhase?.('validate');
        validateCommitFacts(input, dependencies);
        await validateDiff(input.changeset);
        await Promise.all(input.changeset.snapshot.operations.map((operation): Promise<TargetInspection> => inspectTarget(operation, true)));
        const protectedContents = await validateProtectedReferences(input.changeset.snapshot.operations);
        const journalId = dependencies.createId('journal');
        if (!journalId || journalId.trim() !== journalId || journalId.length > 256 || journalId.includes('\0')) {
          throw new AgentFileCommitError('journal_identity_invalid', 'Commit journal identity is invalid');
        }
        const journalOperations = await copyJournalContent(dependencies, input.task.taskId, journalId, protectedContents);
        const occurredAt = dependencies.now();
        if (!Number.isFinite(Date.parse(occurredAt))) {
          throw new AgentFileCommitError('journal_timestamp_invalid', 'Commit journal timestamp is invalid');
        }
        const intent = createCommitIntent(input, journalOperations, occurredAt);
        const created = dependencies.store.createCommitJournal({
          journalId,
          changesetId: input.changeset.snapshot.changesetId,
          confirmationId: input.confirmation.confirmationId,
          confirmationVersion: input.confirmation.version,
          intent,
          intentHash: hashCommitIntentSnapshot(intent),
          occurredAt
        });
        taskJournals.set(created.taskId, created);
        dependencies.onPhase?.('journal-created');
        injectCommitCrash(dependencies, 'after_journal_created');
        return created;
      });
      return runTaskSerial(input.task.taskId, async (): Promise<AgentFileCommitResult> => {
        const current = dependencies.store.getCommitJournal(journal.journalId);
        if (!current) throw new AgentFileCommitError('commit_journal_missing', 'Created commit journal projection is missing');
        if (current.status === 'cancelled') {
          throw new AgentFileCommitError('journal_cancelled', 'Commit journal was cancelled before external application', 'cancelled', 'commit', 'runtime');
        }
        const [applyOutcome] = await Promise.allSettled([applyJournal(dependencies, current, false)]);
        if (applyOutcome.status === 'rejected') {
          if (applyOutcome.reason instanceof Error && applyOutcome.reason.name === 'AgentCommitCrashError') throw applyOutcome.reason;
          const normalizedError = normalizeCommitError(applyOutcome.reason);
          const refreshed = dependencies.store.getCommitJournal(current.journalId);
          if (!refreshed) throw new AgentFileCommitError('commit_journal_missing', 'Commit failure journal projection is missing');
          const inspections = await Promise.allSettled(
            refreshed.intent.operations.map((operation): Promise<TargetInspection> => inspectTarget(operation, false))
          );
          const allTargetsBase = inspections.every((inspection): boolean => inspection.status === 'fulfilled' && inspection.value.state === 'base');
          const deterministicFailure =
            normalizedError.code === 'commit_failed' && refreshed.status === 'applying' && refreshed.appliedOperationIds.length === 0 && allTargetsBase;
          const error = deterministicFailure ? normalizedError : createManualError('external_state_requires_recovery');
          const checkpoint = deterministicFailure
            ? dependencies.store.finalizeCommitFailure({
                journalId: refreshed.journalId,
                error,
                occurredAt: dependencies.now()
              })
            : dependencies.store.markManualRecovery({
                journalId: refreshed.journalId,
                error,
                occurredAt: dependencies.now()
              });
          throw bindFailureCheckpoint(error, checkpoint);
        }
        const applied = applyOutcome.value;
        const task = dependencies.store.getTask(input.task.taskId);
        if (!task) throw new AgentFileCommitError('commit_task_missing', 'Committed Task projection is missing');
        const result = createCommitResult(applied, input.changeset, task);
        const finalized = finalizeJournal(dependencies, applied, result);
        taskJournals.set(finalized.journal.taskId, finalized.journal);
        return finalized;
      });
    },

    async cancelTask(taskId: string): Promise<AgentFileCommitCancelResult> {
      const observed = findTaskJournal(taskId);
      if (!observed) {
        throw new AgentFileCommitError('commit_journal_not_found', 'Task does not own a commit journal', 'protocol_error', 'commit', 'runtime');
      }
      if (observed.status === 'cancelled') {
        return Object.freeze({ disposition: 'journal_cancelled', journal: observed });
      }
      if (observed.status !== 'created' || observed.appliedOperationIds.length > 0) {
        return Object.freeze({ disposition: 'commit_in_progress', journal: observed });
      }
      return runTaskSerial(taskId, async (): Promise<AgentFileCommitCancelResult> => {
        const journal = findTaskJournal(taskId);
        if (!journal) {
          throw new AgentFileCommitError('commit_journal_not_found', 'Task does not own a commit journal', 'protocol_error', 'commit', 'runtime');
        }
        if (journal.status === 'created' && journal.appliedOperationIds.length === 0) {
          const cancelled = dependencies.store.cancelCommitJournal({ journalId: journal.journalId, occurredAt: dependencies.now() });
          taskJournals.set(taskId, cancelled);
          return Object.freeze({ disposition: 'journal_cancelled', journal: cancelled });
        }
        if (journal.status === 'cancelled') {
          return Object.freeze({ disposition: 'journal_cancelled', journal });
        }
        return Object.freeze({ disposition: 'commit_in_progress', journal });
      });
    },

    async recover(): Promise<AgentJournalRecoveryResult[]> {
      const results: AgentJournalRecoveryResult[] = [];
      for (const journal of dependencies.store.listUnfinishedJournals()) {
        taskJournals.set(journal.taskId, journal);
        // Recovery is deliberately serial so two journals never interleave Store transitions.
        // eslint-disable-next-line no-await-in-loop
        const [recoveryResult] = await Promise.allSettled([runTaskSerial(journal.taskId, (): Promise<AgentJournalRecoveryResult> => recoverJournal(journal))]);
        results.push(recoveryResult.status === 'fulfilled' ? recoveryResult.value : markRecoveryFailed(journal));
      }
      return results;
    }
  };
}
