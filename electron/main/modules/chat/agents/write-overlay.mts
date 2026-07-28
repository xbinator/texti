/**
 * @file write-overlay.mts
 * @description 在 Attempt 私有磁盘 overlay 中生成完整性绑定的文本文件 changeset，不直接修改真实工作区。
 */
import { Buffer } from 'node:buffer';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentAttemptRecord, AgentTaskRecord } from './types.mjs';
import type {
  AgentChangesetSnapshot,
  AgentExecutionPlanSnapshot,
  AgentFileOperationSnapshot,
  AgentTaskError,
  AgentTaskErrorCode,
  AgentTaskErrorPhase
} from 'types/chat-agent';
import { asyncTo } from '../../../../../src/utils/asyncTo.js';
import {
  AGENT_CHANGESET_SCHEMA_VERSION,
  AGENT_FILE_COMMIT_ADAPTER,
  AGENT_MAX_CHANGESET_BYTES,
  AGENT_MAX_CHANGESET_OPERATIONS,
  AGENT_MAX_DIFF_BYTES,
  AGENT_MAX_STAGED_FILE_BYTES,
  hashAgentPayload,
  hashAgentText
} from './contracts.mjs';

/** 私有目录权限，仅允许当前用户访问。 */
const PRIVATE_DIRECTORY_MODE = 0o700;

/** 私有候选、回滚和 diff 文件权限。 */
const PRIVATE_FILE_MODE = 0o600;

/** Overlay 文件操作成功结果。 */
export interface AgentOverlayOperationResult {
  /** 操作稳定身份。 */
  readonly operationId: string;
  /** 面向模型和确认界面的工作区相对路径。 */
  readonly displayPath: string;
  /** 候选内容是否偏离基础内容。 */
  readonly changed: boolean;
  /** 当前候选文本 SHA-256。 */
  readonly targetContentHash: string;
}

/** Attempt 私有写入 overlay。 */
export interface AgentWriteOverlay {
  /**
   * 暂存完整文本文件。
   * @param input - 目标路径和候选全文
   * @returns 当前 overlay 操作结果
   */
  writeFile(input: { path: string; content: string }): Promise<AgentOverlayOperationResult>;
  /**
   * 在当前 overlay 候选内容中执行精确替换。
   * @param input - 目标、匹配文本、替换文本和 replaceAll 开关
   * @returns 当前 overlay 操作结果
   */
  editFile(input: { path: string; oldString: string; newString: string; replaceAll: boolean }): Promise<AgentOverlayOperationResult>;
  /**
   * 复核基础修订并生成 canonical changeset。
   * @returns 非空 changeset；全部 no-op 时返回 null
   */
  prepare(): Promise<AgentChangesetSnapshot | null>;
  /**
   * 删除当前 Attempt 的精确私有目录。
   * @returns 清理完成
   */
  dispose(): Promise<void>;
}

/** 创建 Attempt 私有 overlay 的冻结依赖。 */
export interface CreateAgentWriteOverlayInput {
  /** 当前 write Task 投影。 */
  readonly task: AgentTaskRecord;
  /** 当前 running Attempt。 */
  readonly attempt: AgentAttemptRecord;
  /** 产生 staged 调用的具体 Runtime。 */
  readonly runtimeId: string;
  /** 当前冻结 Execution Plan。 */
  readonly plan: AgentExecutionPlanSnapshot;
  /** realpath 后的工作区根。 */
  readonly workspaceRoot: string;
  /** 私有 overlay 总根。 */
  readonly overlayRoot: string;
  /** 确定性时间依赖。 */
  readonly now: () => string;
  /** changeset 和 operation ID 工厂。 */
  readonly createId: (kind: 'changeset' | 'operation') => string;
}

/** 精确删除一个 Task Attempt overlay 的输入。 */
export interface DiscardTaskOverlayInput {
  /** Main 私有 overlay 总根。 */
  readonly overlayRoot: string;
  /** 单一安全目录段 Task 身份。 */
  readonly taskId: string;
  /** 单一安全目录段 Attempt 身份。 */
  readonly attemptId: string;
}

/** 单个目标首次访问时冻结的基础事实。 */
interface AgentOverlayBase {
  /** Provider 输入解析后的词法路径，用于 prepare 时重新解析。 */
  readonly accessPath: string;
  /** Main 解析后的真实目标路径。 */
  readonly targetPath: string;
  /** 面向展示的工作区相对路径。 */
  readonly displayPath: string;
  /** 命中的冻结资源 scope。 */
  readonly resourceScope: string;
  /** 基础目标是否存在。 */
  readonly exists: boolean;
  /** 最近真实父目录。 */
  readonly parentRealPath: string;
  /** 基础文件字节数。 */
  readonly size: number;
  /** 基础文件 mtime。 */
  readonly mtimeMs: number;
  /** 基础完整文本。 */
  readonly content: string;
  /** 基础文本 SHA-256。 */
  readonly contentHash: string;
  /** 单文件基础修订 hash。 */
  readonly revision: string;
}

/** 单个目标的可变 overlay 状态。 */
interface AgentOverlayEntry {
  /** 首次访问冻结的基础事实。 */
  readonly base: AgentOverlayBase;
  /** 操作稳定身份。 */
  readonly operationId: string;
  /** 私有候选文件引用。 */
  readonly candidateReference: string;
  /** 私有回滚文件引用。 */
  readonly rollbackReference: string;
  /** 当前候选全文。 */
  content: string;
}

/** 基础目标解析成功。 */
interface AgentOverlayResolution {
  /** 成功判别。 */
  readonly ok: true;
  /** 冻结基础事实。 */
  readonly base: AgentOverlayBase;
}

/** 基础目标解析失败。 */
interface AgentOverlayResolutionFailure {
  /** 失败判别。 */
  readonly ok: false;
  /** 稳定错误。 */
  readonly error: AgentTaskError;
}

/** 目标解析结果。 */
type AgentOverlayResolutionResult = AgentOverlayResolution | AgentOverlayResolutionFailure;

/** 单文件 revision 使用的 filesystem 事实。 */
interface AgentOverlayRevisionInput {
  /** canonical 目标路径。 */
  readonly targetPath: string;
  /** 目标是否存在。 */
  readonly exists: boolean;
  /** 最近真实父目录。 */
  readonly parentRealPath: string;
  /** 文件字节数。 */
  readonly size: number;
  /** 文件 mtime。 */
  readonly mtimeMs: number;
  /** 内容 SHA-256。 */
  readonly contentHash: string;
}

/** unified diff 使用的文本行事实。 */
interface AgentDiffText {
  /** 不含分隔换行符的文本行。 */
  readonly lines: readonly string[];
  /** 原全文是否以换行符结尾。 */
  readonly hasTrailingNewline: boolean;
}

/** Overlay 稳定结构化错误。 */
export class AgentWriteOverlayError extends Error implements AgentTaskError {
  /** 机器错误码。 */
  readonly code: AgentTaskErrorCode;

  /** 协议阶段。 */
  readonly phase: AgentTaskErrorPhase;

  /** 聚合分类。 */
  readonly category: AgentTaskError['category'];

  /** 相同冻结事实下不自动重试。 */
  readonly retryable = false;

  /** 不含敏感路径的稳定机器细节。 */
  readonly details: NonNullable<AgentTaskError['details']>;

  /**
   * 创建稳定 overlay 错误。
   * @param reason - 机器失败原因
   * @param message - 展示消息
   * @param code - Agent 错误码
   * @param phase - 协议阶段
   * @param category - 聚合分类
   */
  constructor(
    reason: string,
    message: string,
    code: AgentTaskErrorCode = 'protocol_error',
    phase: AgentTaskErrorPhase = 'runtime',
    category: AgentTaskError['category'] = 'protocol'
  ) {
    super(message);
    this.name = 'AgentWriteOverlayError';
    this.code = code;
    this.phase = phase;
    this.category = category;
    this.details = { reason };
  }
}

/**
 * 创建资源校验错误。
 * @param reason - 稳定失败原因
 * @param message - 展示消息
 * @returns resource_validation 错误
 */
function resourceError(reason: string, message: string): AgentWriteOverlayError {
  return new AgentWriteOverlayError(reason, message, 'resource_scope_invalid', 'resource_validation', 'resource');
}

/**
 * 创建 commit 前陈旧上下文错误。
 * @returns commit_validation 错误
 */
function staleError(): AgentWriteOverlayError {
  return new AgentWriteOverlayError(
    'overlay_base_revision_changed',
    'Workspace content changed after the Child staged its edit',
    'stale_context',
    'commit_validation',
    'integrity'
  );
}

/**
 * 判断身份是否可安全作为私有目录段。
 * @param value - Task、Attempt 或生成 ID
 * @returns 是否为单一非特殊路径段
 */
function isSafeSegment(value: string): boolean {
  return Boolean(value) && value !== '.' && value !== '..' && path.basename(value) === value && !value.includes('\0');
}

/**
 * 判断 cleanup 身份是否为跨平台安全单目录段。
 * @param value - Task 或 Attempt 身份
 * @returns 是否禁止 absolute、分隔符与特殊目录段
 */
function isCleanupSegment(value: string): boolean {
  return isSafeSegment(value) && !path.isAbsolute(value) && !value.includes('/') && !value.includes('\\');
}

/**
 * 判断 asyncTo 归一化错误是否源自路径不存在。
 * @param error - asyncTo 返回的 Error
 * @returns cause 是否为 ENOENT
 */
function isMissingPath(error: Error): boolean {
  const { cause } = error;
  return typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === 'ENOENT';
}

/**
 * 判断路径是否位于指定根目录内。
 * @param targetPath - 待判断绝对路径
 * @param rootPath - canonical 根目录
 * @returns targetPath 是否未逃逸 rootPath
 */
function isInside(targetPath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === '' || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}

/**
 * 精确删除一个 Attempt overlay，并仅在 Task 目录为空时清除其父目录。
 * @param input - canonical root 与持久化 Task/Attempt 身份
 */
export async function discardTaskOverlay(input: DiscardTaskOverlayInput): Promise<void> {
  if (!isCleanupSegment(input.taskId) || !isCleanupSegment(input.attemptId)) {
    throw new AgentWriteOverlayError('overlay_cleanup_identity_invalid', 'Overlay cleanup identity must use safe path segments');
  }
  const [rootError, canonicalRoot] = await asyncTo(fs.realpath(input.overlayRoot));
  if (rootError) {
    throw new AgentWriteOverlayError('overlay_cleanup_root_invalid', 'Overlay cleanup root is unavailable', 'protocol_error', 'recovery', 'integrity');
  }
  const taskDirectory = path.join(canonicalRoot, input.taskId);
  const attemptDirectory = path.join(taskDirectory, input.attemptId);
  if (!isInside(taskDirectory, canonicalRoot) || !isInside(attemptDirectory, taskDirectory)) {
    throw new AgentWriteOverlayError(
      'overlay_cleanup_path_escape',
      'Overlay cleanup target escaped its canonical root',
      'protocol_error',
      'recovery',
      'integrity'
    );
  }

  const [taskStatError, taskStat] = await asyncTo(fs.lstat(taskDirectory));
  if (taskStatError) {
    if (isMissingPath(taskStatError)) return;
    throw new AgentWriteOverlayError('overlay_cleanup_inspection_failed', 'Task overlay could not be inspected', 'protocol_error', 'recovery', 'runtime');
  }
  if (taskStat.isSymbolicLink() || !taskStat.isDirectory()) {
    throw new AgentWriteOverlayError(
      'overlay_cleanup_symlink_denied',
      'Task overlay must be a real private directory',
      'protocol_error',
      'recovery',
      'integrity'
    );
  }
  const [taskRealError, taskRealPath] = await asyncTo(fs.realpath(taskDirectory));
  if (taskRealError || taskRealPath !== taskDirectory || !isInside(taskRealPath, canonicalRoot)) {
    throw new AgentWriteOverlayError('overlay_cleanup_path_escape', 'Task overlay failed canonical containment', 'protocol_error', 'recovery', 'integrity');
  }

  const [attemptStatError, attemptStat] = await asyncTo(fs.lstat(attemptDirectory));
  if (attemptStatError) {
    if (isMissingPath(attemptStatError)) return;
    throw new AgentWriteOverlayError('overlay_cleanup_inspection_failed', 'Attempt overlay could not be inspected', 'protocol_error', 'recovery', 'runtime');
  }
  if (attemptStat.isSymbolicLink() || !attemptStat.isDirectory()) {
    throw new AgentWriteOverlayError(
      'overlay_cleanup_symlink_denied',
      'Attempt overlay must be a real private directory',
      'protocol_error',
      'recovery',
      'integrity'
    );
  }
  const [attemptRealError, attemptRealPath] = await asyncTo(fs.realpath(attemptDirectory));
  if (attemptRealError || attemptRealPath !== attemptDirectory || !isInside(attemptRealPath, taskDirectory)) {
    throw new AgentWriteOverlayError('overlay_cleanup_path_escape', 'Attempt overlay failed canonical containment', 'protocol_error', 'recovery', 'integrity');
  }

  const [removeError] = await asyncTo(fs.rm(attemptRealPath, { recursive: true, force: true }));
  if (removeError) {
    throw new AgentWriteOverlayError('overlay_cleanup_failed', 'Attempt overlay could not be removed', 'protocol_error', 'recovery', 'runtime');
  }
  const [entriesError, entries] = await asyncTo(fs.readdir(taskRealPath));
  if (entriesError) {
    if (isMissingPath(entriesError)) return;
    throw new AgentWriteOverlayError(
      'overlay_cleanup_inspection_failed',
      'Task overlay could not be checked after cleanup',
      'protocol_error',
      'recovery',
      'runtime'
    );
  }
  if (entries.length === 0) {
    const [taskRemoveError] = await asyncTo(fs.rmdir(taskRealPath));
    if (taskRemoveError && !isMissingPath(taskRemoveError)) {
      throw new AgentWriteOverlayError('overlay_cleanup_failed', 'Empty Task overlay could not be removed', 'protocol_error', 'recovery', 'runtime');
    }
  }
}

/**
 * 判断 canonical 目标是否命中冻结 scope。
 * @param targetPath - canonical 目标
 * @param resourceScope - file 或 directory scope
 * @returns 是否授权
 */
function matchesScope(targetPath: string, resourceScope: string): boolean {
  if (resourceScope.startsWith('file:')) return targetPath === resourceScope.slice('file:'.length);
  if (!resourceScope.startsWith('directory:') || !resourceScope.endsWith('/**')) return false;
  return isInside(targetPath, resourceScope.slice('directory:'.length, -'/**'.length));
}

/**
 * 选择授权目标的首个 canonical scope。
 * @param targetPath - canonical 目标
 * @param resourceScopes - 排序后的冻结 scopes
 * @returns 命中 scope 或 undefined
 */
function findScope(targetPath: string, resourceScopes: readonly string[]): string | undefined {
  return resourceScopes.find((resourceScope): boolean => matchesScope(targetPath, resourceScope));
}

/**
 * 将工作区相对路径规范化为 slash 分隔的展示路径。
 * @param targetPath - canonical 目标
 * @param workspaceRoot - canonical 工作区
 * @returns 稳定展示路径
 */
function createDisplayPath(targetPath: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, targetPath).split(path.sep).join('/');
}

/**
 * 读取文件并验证为受支持的 UTF-8 文本。
 * @param targetPath - canonical 文件路径
 * @param size - stat 字节数
 * @returns 完整 UTF-8 文本
 */
async function readTextFile(targetPath: string, size: number): Promise<string> {
  if (size > AGENT_MAX_STAGED_FILE_BYTES) {
    throw new AgentWriteOverlayError('overlay_file_size_exceeded', 'Staged file exceeds the per-file byte limit');
  }
  const content = await fs.readFile(targetPath);
  if (content.includes(0)) throw resourceError('overlay_binary_file_denied', 'Binary files cannot be staged');
  const text = content.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(content)) {
    throw resourceError('overlay_binary_file_denied', 'Only valid UTF-8 text files can be staged');
  }
  return text;
}

/**
 * 计算单文件基础 revision。
 * @param input - canonical filesystem 事实
 * @returns 版本化 revision SHA-256
 */
function hashBaseRevision(input: AgentOverlayRevisionInput): string {
  return hashAgentPayload({
    schemaVersion: 1,
    targetPath: input.targetPath,
    exists: input.exists,
    parentRealPath: input.parentRealPath,
    size: input.size,
    mtimeMs: input.mtimeMs,
    contentHash: input.contentHash
  });
}

/**
 * 只做词法规范化并拒绝虚拟、空路径和工作区逃逸。
 * @param rawPath - Provider 路径
 * @param workspaceRoot - canonical 工作区
 * @returns 词法绝对路径或稳定资源错误
 */
function resolveAccessPath(rawPath: string, workspaceRoot: string): string | AgentWriteOverlayError {
  if (rawPath.startsWith('unsaved://')) {
    return resourceError('overlay_virtual_path_denied', 'Unsaved resources cannot be staged');
  }
  const normalizedPath = rawPath.trim();
  if (!normalizedPath) return resourceError('overlay_path_empty', 'A target path is required');
  const accessPath = path.isAbsolute(normalizedPath) ? path.resolve(normalizedPath) : path.resolve(workspaceRoot, normalizedPath);
  return isInside(accessPath, workspaceRoot) ? accessPath : resourceError('overlay_workspace_escape', 'The staged target is outside the workspace');
}

/**
 * 查找目标最近存在的父目录及剩余相对路径。
 * @param targetPath - 词法绝对目标
 * @returns existing 父路径和从该父路径到目标的相对路径
 */
async function findExistingParent(targetPath: string): Promise<{ parentPath: string; relativePath: string }> {
  /**
   * 逐级向上解析，不使用阻塞同步 I/O。
   * @param currentPath - 当前候选父路径
   * @param missingSegments - 从当前父路径到目标的路径段
   * @returns 最近存在父目录
   */
  async function inspectParent(currentPath: string, missingSegments: readonly string[]): Promise<{ parentPath: string; relativePath: string }> {
    const [statResult] = await Promise.allSettled([fs.lstat(currentPath)]);
    if (statResult.status === 'fulfilled') {
      if (!statResult.value.isDirectory() && !statResult.value.isSymbolicLink()) {
        throw resourceError('overlay_parent_not_directory', 'The target parent is not a directory');
      }
      return { parentPath: currentPath, relativePath: path.join(...missingSegments) };
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) throw resourceError('overlay_parent_missing', 'No existing parent directory could be resolved');
    return inspectParent(parentPath, [path.basename(currentPath), ...missingSegments]);
  }
  return inspectParent(path.dirname(targetPath), [path.basename(targetPath)]);
}

/**
 * 解析并冻结一个 existing 或 create 目标。
 * @param rawPath - Provider 路径
 * @param workspaceRoot - canonical 工作区
 * @param resourceScopes - 冻结 scopes
 * @returns 基础事实或稳定错误
 */
async function resolveBase(rawPath: string, workspaceRoot: string, resourceScopes: readonly string[]): Promise<AgentOverlayResolutionResult> {
  const accessPath = resolveAccessPath(rawPath, workspaceRoot);
  if (accessPath instanceof AgentWriteOverlayError) return { ok: false, error: accessPath };

  const [lstatResult] = await Promise.allSettled([fs.lstat(accessPath)]);
  if (lstatResult.status === 'fulfilled') {
    const isSymbolicLink = lstatResult.value.isSymbolicLink();
    const [realPathResult] = await Promise.allSettled([fs.realpath(accessPath)]);
    if (realPathResult.status === 'rejected') {
      return { ok: false, error: resourceError('overlay_target_unreadable', 'The staged target cannot be resolved') };
    }
    const targetPath = realPathResult.value;
    if (!isInside(targetPath, workspaceRoot)) {
      return {
        ok: false,
        error: resourceError(isSymbolicLink ? 'overlay_symlink_escape' : 'overlay_workspace_escape', 'The staged target resolves outside the workspace')
      };
    }
    const [statResult] = await Promise.allSettled([fs.stat(targetPath)]);
    if (statResult.status === 'rejected' || !statResult.value.isFile()) {
      return { ok: false, error: resourceError('overlay_target_not_file', 'The staged target must be a regular file') };
    }
    const resourceScope = findScope(targetPath, resourceScopes);
    if (!resourceScope) return { ok: false, error: resourceError('overlay_resource_scope_denied', 'The staged target is outside the frozen scope') };
    const content = await readTextFile(targetPath, statResult.value.size);
    const parentRealPath = await fs.realpath(path.dirname(targetPath));
    const contentHash = hashAgentText(content);
    const revisionInput: AgentOverlayRevisionInput = {
      targetPath,
      exists: true,
      parentRealPath,
      size: statResult.value.size,
      mtimeMs: statResult.value.mtimeMs,
      contentHash
    };
    return {
      ok: true,
      base: {
        accessPath,
        targetPath,
        displayPath: createDisplayPath(targetPath, workspaceRoot),
        resourceScope,
        exists: true,
        parentRealPath,
        size: revisionInput.size,
        mtimeMs: revisionInput.mtimeMs,
        content,
        contentHash,
        revision: hashBaseRevision(revisionInput)
      }
    };
  }

  const parent = await findExistingParent(accessPath);
  const [parentRealResult] = await Promise.allSettled([fs.realpath(parent.parentPath)]);
  if (parentRealResult.status === 'rejected' || !isInside(parentRealResult.value, workspaceRoot)) {
    return { ok: false, error: resourceError('overlay_symlink_escape', 'The staged target parent resolves outside the workspace') };
  }
  const targetPath = path.resolve(parentRealResult.value, parent.relativePath);
  if (!isInside(targetPath, workspaceRoot)) {
    return { ok: false, error: resourceError('overlay_symlink_escape', 'The staged target resolves outside the workspace') };
  }
  const resourceScope = findScope(targetPath, resourceScopes);
  if (!resourceScope) return { ok: false, error: resourceError('overlay_resource_scope_denied', 'The staged target is outside the frozen scope') };
  const contentHash = hashAgentText('');
  const revisionInput: AgentOverlayRevisionInput = {
    targetPath,
    exists: false,
    parentRealPath: parentRealResult.value,
    size: 0,
    mtimeMs: 0,
    contentHash
  };
  return {
    ok: true,
    base: {
      accessPath,
      targetPath,
      displayPath: createDisplayPath(targetPath, workspaceRoot),
      resourceScope,
      exists: false,
      parentRealPath: parentRealResult.value,
      size: 0,
      mtimeMs: 0,
      content: '',
      contentHash,
      revision: hashBaseRevision(revisionInput)
    }
  };
}

/**
 * 在 staged executor 前只读校验目标的 canonical 路径、文本类型和冻结 scope。
 * @param rawPath - Provider 目标路径
 * @param workspaceRoot - 冻结工作区根
 * @param resourceScopes - 冻结 canonical scopes
 * @returns 校验完成；失败时抛出稳定 overlay 错误
 */
export async function validateAgentOverlayTarget(rawPath: string, workspaceRoot: string, resourceScopes: readonly string[]): Promise<void> {
  const workspaceRealRoot = await fs.realpath(workspaceRoot);
  const resolution = await resolveBase(rawPath, workspaceRealRoot, resourceScopes);
  if (!resolution.ok) throw resolution.error;
}

/**
 * 写入私有引用并收紧权限。
 * @param filePath - Attempt 私有目录内路径
 * @param content - UTF-8 文本
 * @param allowExisting - 是否允许改写本 overlay 已创建的候选引用
 * @returns 写入完成
 */
async function writePrivateText(filePath: string, content: string, allowExisting: boolean): Promise<void> {
  const [existingResult] = await Promise.allSettled([fs.lstat(filePath)]);
  if (existingResult.status === 'fulfilled' && (!allowExisting || !existingResult.value.isFile() || existingResult.value.isSymbolicLink())) {
    throw new AgentWriteOverlayError('overlay_private_reference_invalid', 'Protected overlay reference is not a regular file');
  }
  if (allowExisting && existingResult.status === 'rejected') {
    throw new AgentWriteOverlayError('overlay_private_reference_invalid', 'Protected overlay candidate reference is missing');
  }
  const noFollowFlag = typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  const exclusiveFlag = allowExisting ? 0 : fsConstants.O_EXCL;
  const flags = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC | noFollowFlag | exclusiveFlag;
  const [openResult] = await Promise.allSettled([fs.open(filePath, flags, PRIVATE_FILE_MODE)]);
  if (openResult.status === 'rejected') {
    throw new AgentWriteOverlayError('overlay_private_reference_invalid', 'Protected overlay reference could not be opened safely');
  }
  const handle = openResult.value;
  const [writeResult] = await Promise.allSettled([handle.writeFile(content, { encoding: 'utf8' })]);
  const [modeResult] = writeResult.status === 'fulfilled' ? await Promise.allSettled([handle.chmod(PRIVATE_FILE_MODE)]) : ([writeResult] as const);
  const [closeResult] = await Promise.allSettled([handle.close()]);
  if (writeResult.status === 'rejected' || modeResult.status === 'rejected' || closeResult.status === 'rejected') {
    throw new AgentWriteOverlayError('overlay_private_reference_invalid', 'Protected overlay reference could not be written safely');
  }
}

/**
 * 创建或复核一个不跟随符号链接的私有目录。
 * @param directoryPath - canonical 父目录下的精确子目录
 * @returns 复核后的真实目录路径
 */
async function ensurePrivateDirectory(directoryPath: string): Promise<string> {
  const [initialResult] = await Promise.allSettled([fs.lstat(directoryPath)]);
  if (initialResult.status === 'rejected') {
    const [mkdirResult] = await Promise.allSettled([fs.mkdir(directoryPath, { mode: PRIVATE_DIRECTORY_MODE })]);
    if (mkdirResult.status === 'rejected') {
      throw new AgentWriteOverlayError('overlay_private_path_invalid', 'Attempt overlay directory could not be created');
    }
  }
  const [statResult, realPathResult] = await Promise.allSettled([fs.lstat(directoryPath), fs.realpath(directoryPath)]);
  if (
    statResult.status === 'rejected' ||
    realPathResult.status === 'rejected' ||
    !statResult.value.isDirectory() ||
    statResult.value.isSymbolicLink() ||
    realPathResult.value !== directoryPath
  ) {
    throw new AgentWriteOverlayError('overlay_private_path_invalid', 'Attempt overlay directory is not private');
  }
  await fs.chmod(directoryPath, PRIVATE_DIRECTORY_MODE);
  return realPathResult.value;
}

/**
 * 计算当前 changed entries 的候选总字节数。
 * @param entries - 全部触达目标
 * @param replacing - 本次更新目标
 * @param nextContent - 本次候选全文
 * @returns changed 候选总字节数
 */
function candidateTotal(entries: Iterable<AgentOverlayEntry>, replacing: AgentOverlayEntry, nextContent: string): number {
  let total = 0;
  for (const entry of entries) {
    const content = entry === replacing ? nextContent : entry.content;
    if (content !== entry.base.content) total += Buffer.byteLength(content, 'utf8');
  }
  return total;
}

/**
 * 把全文拆分为 unified diff 所需的行与尾换行事实。
 * @param content - 文件全文
 * @returns 行集合与尾换行标记
 */
function splitDiffText(content: string): AgentDiffText {
  if (!content) return { lines: [], hasTrailingNewline: false };
  const hasTrailingNewline = content.endsWith('\n');
  const lines = content.split('\n');
  if (hasTrailingNewline) lines.pop();
  return { lines, hasTrailingNewline };
}

/**
 * 把文本事实转换为 unified diff 行。
 * @param text - 已拆分文本事实
 * @param prefix - 删除或新增前缀
 * @returns 带换行及 EOF 标记的 diff body
 */
function createDiffLines(text: AgentDiffText, prefix: '-' | '+'): string {
  if (text.lines.length === 0) return '';
  const body = text.lines.map((line): string => `${prefix}${line}\n`).join('');
  return text.hasTrailingNewline ? body : `${body}\\ No newline at end of file\n`;
}

/**
 * 为按路径排序的操作生成确定性完整文件 diff。
 * @param entries - changed entries
 * @returns unified diff 文本
 */
function createUnifiedDiff(entries: readonly AgentOverlayEntry[]): string {
  return entries
    .map((entry): string => {
      const oldPath = entry.base.exists ? `a/${entry.base.displayPath}` : '/dev/null';
      const oldText = splitDiffText(entry.base.content);
      const newText = splitDiffText(entry.content);
      const oldStart = oldText.lines.length === 0 ? 0 : 1;
      const newStart = newText.lines.length === 0 ? 0 : 1;
      return [
        `--- ${oldPath}\n`,
        `+++ b/${entry.base.displayPath}\n`,
        `@@ -${oldStart},${oldText.lines.length} +${newStart},${newText.lines.length} @@\n`,
        createDiffLines(oldText, '-'),
        createDiffLines(newText, '+')
      ].join('');
    })
    .join('');
}

/**
 * 将 changed entry 投影为不可变文件操作。
 * @param entry - overlay entry
 * @returns canonical operation snapshot
 */
function createOperation(entry: AgentOverlayEntry): AgentFileOperationSnapshot {
  return {
    operationId: entry.operationId,
    kind: entry.base.exists ? 'replace' : 'create',
    displayPath: entry.base.displayPath,
    targetPath: entry.base.targetPath,
    resourceScope: entry.base.resourceScope,
    baseRevision: entry.base.revision,
    baseContentHash: entry.base.contentHash,
    targetContentHash: hashAgentText(entry.content),
    candidateReference: entry.candidateReference,
    rollbackReference: entry.rollbackReference,
    byteLength: Buffer.byteLength(entry.content, 'utf8')
  };
}

/**
 * 计算 changeset operationSetHash。
 * @param operations - canonical operations
 * @returns 版本化 SHA-256
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
 * 计算 changeset 聚合基础修订。
 * @param operations - canonical operations
 * @returns 聚合 SHA-256
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
 * 验证 Task、Attempt、Runtime 与 write Plan 的冻结身份。
 * @param input - overlay 创建输入
 */
function validateOverlayInput(input: CreateAgentWriteOverlayInput): void {
  if (
    input.task.status !== 'running' ||
    input.task.recordState !== 'active' ||
    input.task.contractSnapshot.mode !== 'write' ||
    input.task.currentAttemptId !== input.attempt.attemptId ||
    input.attempt.taskId !== input.task.taskId ||
    input.attempt.status !== 'running' ||
    input.attempt.currentRuntimeId !== input.runtimeId ||
    input.attempt.planHash !== input.plan.planHash ||
    input.task.executionPlanSnapshotHash !== input.plan.planHash ||
    input.plan.commitPolicy.mode !== 'staged' ||
    input.plan.commitPolicy.adapter !== AGENT_FILE_COMMIT_ADAPTER ||
    !input.plan.toolEffectSet.some((effect): boolean => effect.effect === 'staged_file_write')
  ) {
    throw new AgentWriteOverlayError('overlay_frozen_facts_invalid', 'Overlay identity or staged execution plan is invalid');
  }
  if (!isSafeSegment(input.task.taskId) || !isSafeSegment(input.attempt.attemptId)) {
    throw new AgentWriteOverlayError('overlay_identity_invalid', 'Overlay Task or Attempt identity is unsafe');
  }
}

/**
 * 创建 Task/Attempt 私有写入 overlay。
 * @param input - 冻结事实、目录与确定性依赖
 * @returns staged write overlay
 */
export async function createAgentWriteOverlay(input: CreateAgentWriteOverlayInput): Promise<AgentWriteOverlay> {
  validateOverlayInput(input);
  const workspaceRoot = await fs.realpath(input.workspaceRoot);
  const overlayRoot = await fs.realpath(input.overlayRoot);
  const taskDirectory = path.join(overlayRoot, input.task.taskId);
  const attemptDirectory = path.join(taskDirectory, input.attempt.attemptId);
  await ensurePrivateDirectory(taskDirectory);
  const attemptRealPath = await ensurePrivateDirectory(attemptDirectory);
  if (!isInside(attemptRealPath, overlayRoot)) {
    throw new AgentWriteOverlayError('overlay_private_path_invalid', 'Attempt overlay directory is not private');
  }

  const entries = new Map<string, AgentOverlayEntry>();
  const accessEntries = new Map<string, AgentOverlayEntry>();
  const operationIds = new Set<string>();
  let disposed = false;
  let prepared = false;
  let preparedChangeset: AgentChangesetSnapshot | null = null;

  /**
   * 拒绝清理后的继续使用。
   */
  function assertActive(): void {
    if (disposed) throw new AgentWriteOverlayError('overlay_disposed', 'Attempt overlay has already been disposed');
  }

  /**
   * 拒绝 prepared 后改写其受保护候选引用。
   */
  function assertMutable(): void {
    assertActive();
    if (prepared) throw new AgentWriteOverlayError('overlay_prepared', 'Attempt overlay has already produced its final changeset');
  }

  /**
   * 获取已有 entry 或首次冻结目标基础事实。
   * @param rawPath - Provider 目标
   * @returns overlay entry
   */
  async function getEntry(rawPath: string): Promise<AgentOverlayEntry> {
    assertActive();
    const accessPath = resolveAccessPath(rawPath, workspaceRoot);
    if (accessPath instanceof AgentWriteOverlayError) throw accessPath;
    const accessedEntry = accessEntries.get(accessPath);
    if (accessedEntry) return accessedEntry;
    const resolution = await resolveBase(rawPath, workspaceRoot, input.plan.resourceScopes);
    if (!resolution.ok) throw resolution.error;
    const existing = entries.get(resolution.base.targetPath);
    if (existing) {
      accessEntries.set(accessPath, existing);
      return existing;
    }

    const operationId = input.createId('operation');
    if (!isSafeSegment(operationId) || operationIds.has(operationId)) {
      throw new AgentWriteOverlayError('overlay_operation_id_invalid', 'Overlay operation identity is invalid or duplicated');
    }
    operationIds.add(operationId);
    const candidateReference = path.join(attemptDirectory, `${operationId}.candidate`);
    const rollbackReference = path.join(attemptDirectory, `${operationId}.rollback`);
    await writePrivateText(candidateReference, resolution.base.content, false);
    await writePrivateText(rollbackReference, resolution.base.content, false);
    const entry: AgentOverlayEntry = {
      base: resolution.base,
      operationId,
      candidateReference,
      rollbackReference,
      content: resolution.base.content
    };
    entries.set(entry.base.targetPath, entry);
    accessEntries.set(accessPath, entry);
    return entry;
  }

  /**
   * 更新候选内容并执行全部静态上限。
   * @param entry - 当前目标
   * @param content - 新候选全文
   * @returns 操作结果
   */
  async function updateEntry(entry: AgentOverlayEntry, content: string): Promise<AgentOverlayOperationResult> {
    if (content.includes('\0')) {
      throw new AgentWriteOverlayError('overlay_binary_content_denied', 'Staged candidate cannot contain NUL bytes');
    }
    const byteLength = Buffer.byteLength(content, 'utf8');
    if (byteLength > AGENT_MAX_STAGED_FILE_BYTES) {
      throw new AgentWriteOverlayError('overlay_file_size_exceeded', 'Staged file exceeds the per-file byte limit');
    }
    const currentChanged = entry.content !== entry.base.content;
    const nextChanged = content !== entry.base.content;
    const changedCount = [...entries.values()].filter((candidate): boolean => candidate.content !== candidate.base.content).length;
    if (!currentChanged && nextChanged && changedCount >= AGENT_MAX_CHANGESET_OPERATIONS) {
      throw new AgentWriteOverlayError('overlay_operation_limit_exceeded', 'Changeset exceeds the operation limit');
    }
    if (candidateTotal(entries.values(), entry, content) > AGENT_MAX_CHANGESET_BYTES) {
      throw new AgentWriteOverlayError('overlay_changeset_size_exceeded', 'Changeset exceeds the candidate byte limit');
    }
    entry.content = content;
    await writePrivateText(entry.candidateReference, content, true);
    return {
      operationId: entry.operationId,
      displayPath: entry.base.displayPath,
      changed: nextChanged,
      targetContentHash: hashAgentText(content)
    };
  }

  /**
   * 重新解析目标并比较首次冻结 revision。
   * @param entry - changed entry
   */
  async function validateBase(entry: AgentOverlayEntry): Promise<void> {
    const resolution = await resolveBase(entry.base.accessPath, workspaceRoot, input.plan.resourceScopes);
    if (!resolution.ok || resolution.base.targetPath !== entry.base.targetPath || resolution.base.revision !== entry.base.revision) {
      throw staleError();
    }
  }

  return {
    async writeFile(writeInput: { path: string; content: string }): Promise<AgentOverlayOperationResult> {
      assertMutable();
      const entry = await getEntry(writeInput.path);
      return updateEntry(entry, writeInput.content);
    },
    async editFile(editInput: { path: string; oldString: string; newString: string; replaceAll: boolean }): Promise<AgentOverlayOperationResult> {
      assertMutable();
      const entry = await getEntry(editInput.path);
      if (!editInput.oldString) throw new AgentWriteOverlayError('edit_match_empty', 'Exact edit oldString cannot be empty');
      const firstIndex = entry.content.indexOf(editInput.oldString);
      if (firstIndex < 0) throw new AgentWriteOverlayError('edit_match_missing', 'Exact edit oldString was not found');
      const secondIndex = entry.content.indexOf(editInput.oldString, firstIndex + editInput.oldString.length);
      if (!editInput.replaceAll && secondIndex >= 0) {
        throw new AgentWriteOverlayError('edit_match_ambiguous', 'Exact edit oldString matched more than once');
      }
      const content = editInput.replaceAll
        ? entry.content.split(editInput.oldString).join(editInput.newString)
        : `${entry.content.slice(0, firstIndex)}${editInput.newString}${entry.content.slice(firstIndex + editInput.oldString.length)}`;
      return updateEntry(entry, content);
    },
    async prepare(): Promise<AgentChangesetSnapshot | null> {
      assertActive();
      if (prepared) return preparedChangeset;
      const changedEntries = [...entries.values()]
        .filter((entry): boolean => entry.content !== entry.base.content)
        .sort((left, right): number => left.base.targetPath.localeCompare(right.base.targetPath));
      if (changedEntries.length === 0) {
        prepared = true;
        return null;
      }
      await Promise.all(changedEntries.map((entry): Promise<void> => validateBase(entry)));

      const operations = changedEntries.map(createOperation);
      const operationSetHash = hashOperationSet(operations);
      const baseRevision = hashAggregateBase(operations);
      const unifiedDiff = createUnifiedDiff(changedEntries);
      if (Buffer.byteLength(unifiedDiff, 'utf8') > AGENT_MAX_DIFF_BYTES) {
        throw new AgentWriteOverlayError('overlay_diff_size_exceeded', 'Changeset unified diff exceeds the byte limit');
      }
      const changesetId = input.createId('changeset');
      if (!isSafeSegment(changesetId)) {
        throw new AgentWriteOverlayError('overlay_changeset_id_invalid', 'Changeset identity is invalid');
      }
      const diffReference = path.join(attemptDirectory, `${changesetId}.diff`);
      await writePrivateText(diffReference, unifiedDiff, false);
      const diffHash = hashAgentPayload({
        schemaVersion: 1,
        baseRevision,
        operationSetHash,
        diffContentHash: hashAgentText(unifiedDiff)
      });
      const resourceScopes = Object.freeze([...new Set(operations.map((operation): string => operation.resourceScope))].sort());
      const frozenOperations = Object.freeze(operations.map((operation): AgentFileOperationSnapshot => Object.freeze(operation)));
      preparedChangeset = Object.freeze({
        changesetSchemaVersion: AGENT_CHANGESET_SCHEMA_VERSION,
        changesetId,
        taskId: input.task.taskId,
        attemptId: input.attempt.attemptId,
        agentId: input.task.agentId,
        runtimeId: input.runtimeId,
        planHash: input.plan.planHash,
        baseRevision,
        diffReference,
        diffHash,
        operationSetHash,
        resourceScopes,
        operations: frozenOperations,
        createdAt: input.now()
      });
      prepared = true;
      return preparedChangeset;
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await fs.rm(attemptDirectory, { recursive: true, force: true });
      entries.clear();
      accessEntries.clear();
    }
  };
}
