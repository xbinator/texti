/**
 * @file service.mts
 * @description Child Agent 委派契约校验、原子 prepare、continuation fence 与启动恢复服务。
 */
/* eslint-disable max-classes-per-file -- Task Projector 与委派服务共享同一公开工厂模块。 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  AgentAttemptProjection,
  AgentCheckpointRecord,
  AgentDelegationStore,
  AgentOutboxRecord,
  AgentStoreDatabase,
  AgentTaskCancellationProjection,
  AgentTaskProjectionRecord,
  AgentTaskRecord,
  BeginAgentAttemptInput,
  FinalizeAgentCommitCancellationInput,
  MarkAgentAttemptInput,
  PrepareAgentTaskInput,
  PrepareDelegationInput
} from './types.mjs';
import type { ChatRuntimeDelegationPrepareAck, ChatRuntimeDelegationPrepareInput, ChatRuntimePrimaryContinuationContext } from '../runtime/types.mjs';
import type { ChatMessageRecord } from 'types/chat';
import type {
  AgentBudgetSnapshot,
  AgentArtifactReference,
  AgentPreAttemptCancellationResult,
  AgentResourceReference,
  AgentDelegationContinuationSnapshot,
  AgentDelegationCreatedPayload,
  AgentDelegationReadyPayload,
  ChatAgentApplicationEvent,
  ChatAgentCancelCheckpointInput,
  ChatAgentCancelTaskInput,
  ChatAgentCancelTaskResult,
  ChatAgentCheckpointSnapshot,
  ChatAgentConfirmationSnapshot,
  ChatAgentGetTaskInput,
  ChatAgentListTasksInput,
  ChatAgentListTasksResult,
  ChatAgentGetTaskResult,
  ChatAgentResolveConfirmationInput,
  ChatAgentTaskEventSnapshot,
  ChatAgentTaskDetailSnapshot,
  ChatAgentTaskTimelineEntry,
  ChatAgentTaskTimelineSnapshot,
  ChatAgentTaskSummarySnapshot,
  ChatAgentTaskTombstoneSnapshot,
  ChatAgentTaskUpdatedEvent,
  AgentModelSnapshot,
  AgentOrderedToolCallSnapshot,
  PrimaryDelegationFeatureConfig,
  AgentTaskError,
  AgentUsageAccounting,
  ChatAgentTaskEventType,
  ChatAgentResult,
  ChatAgentResumePrimaryInput,
  ChatAgentResumeResult,
  DelegateTaskInput
} from 'types/chat-agent';
import type { ChatRuntimeAddress } from 'types/chat-runtime';
import { app, BrowserWindow } from 'electron';
import { nanoid } from 'nanoid';
import { getToolRegistryEntry } from '../../../../../shared/ai/tools/index.js';
import { aiService } from '../../ai/service.mjs';
import { dbExecute, dbSelect, transaction } from '../../database/service.mjs';
import { chatRuntimeLocks, getSessionHistoryScope, type RuntimeContinuationFenceHandle, type RuntimeLockRegistry } from '../runtime/infrastructure/locks.mjs';
import { finishAssistantMessageInterrupted } from '../runtime/messages/finalizer.mjs';
import { createDefaultChatModelResolver } from '../runtime/model/resolver.mjs';
import { chatSessionManager } from '../service.mjs';
import { createAgentBudgetLedger, type AgentBudgetLedger } from './budget.mjs';
import { createChildActorRegistry } from './child-registry.mjs';
import { createAgentConfirmationQueue, type AgentConfirmationQueue } from './confirmation-store.mjs';
import {
  AGENT_CHECKPOINT_SCHEMA_VERSION,
  AGENT_CANONICAL_PAYLOAD_MAX_BYTES,
  AGENT_FOUNDATION_POLICY_VERSION,
  hashAgentPayload,
  hashContinuationSnapshot,
  normalizeAgentIdentity,
  sanitizeAgentDisplayText,
  validateAgentTaskError,
  validateContinuationSnapshot,
  validateFoundationContract
} from './contracts.mjs';
import { createAgentCoordinator, type AgentCoordinator } from './coordinator.mjs';
import { createChildRuntimeExecutor } from './executor.mjs';
import {
  createAgentFileCommitter,
  type AgentFileCommitInput,
  type AgentFileCommitResult,
  type AgentFileCommitter,
  type AgentJournalRecoveryResult
} from './file-commit.mjs';
import { compileAgentPlan, type AgentPlanCompileInput, type AgentPlanCompileResult } from './plan-compiler.mjs';
import { resolveAgentScopes } from './resource-scopes.mjs';
import { validateAgentResult } from './result.mjs';
import { createAgentResourceScheduler } from './scheduler.mjs';
import { createAgentDelegationStore } from './store.mjs';
import { discardTaskOverlay as discardAgentTaskOverlay } from './write-overlay.mjs';

/** Runtime B 续接允许保留的非敏感内存上下文。 */
export type ContinuationRuntimeContext = ChatRuntimePrimaryContinuationContext;

/** Runtime B 续接使用的独立最长执行窗口。 */
const CONTINUATION_DEADLINE_MS = 30 * 60 * 1_000;

/** 委派服务仅使用的 Store 最小能力。 */
export type ChatAgentDelegationStore = Pick<
  AgentDelegationStore,
  | 'prepareDelegation'
  | 'authorizeTask'
  | 'recordPreAttemptFailure'
  | 'recordPreAttemptCancellation'
  | 'requestTaskCancellation'
  | 'recordTaskResult'
  | 'getTask'
  | 'getCheckpoint'
  | 'getOutbox'
  | 'claimResume'
  | 'finalizeResume'
  | 'cancelCheckpoint'
  | 'finalizeCancellation'
  | 'finalizeCommitCancellation'
  | 'interruptCheckpoint'
  | 'interruptActive'
  | 'listEvents'
  | 'listActive'
  | 'listCancelledCheckpoints'
  | 'listPendingOutbox'
  | 'markOutboxDelivered'
>;

/** Task Projector 只读取同事务 Store 投影页和定向投影。 */
export type AgentTaskProjectorStore = Pick<AgentDelegationStore, 'getTaskProjection' | 'listTasksBySession'>;

/** 资源 resolver 只能返回安全展示引用，不能构造完整公开资源对象。 */
export interface AgentTaskResourceResolution {
  /** 已验证可展示的相对路径或稳定资源域标识。 */
  readonly displayReference: string;
  /** 可选安全修订标识。 */
  readonly revision?: string;
}

/** Artifact resolver 只能返回用户可打开的安全引用。 */
export interface AgentTaskArtifactResolution {
  /** 经 Main 校验的公开引用候选。 */
  readonly reference: string;
}

/** Task Projector 的窄依赖。 */
export interface AgentTaskProjectorDependencies {
  /** Main-owned 持久化事实 Store。 */
  readonly store: AgentTaskProjectorStore;
  /**
   * 把内部资源解析为安全展示引用。
   * @param resource - 内部不可变资源引用
   * @returns 安全展示引用，不可安全展示时返回 null
   */
  readonly resolveResource: (resource: AgentResourceReference) => AgentTaskResourceResolution | null;
  /**
   * 把内部 Artifact 解析为用户可打开的安全引用。
   * @param artifact - 内部 Artifact 事实
   * @returns 安全公开引用，不可展示时返回 null
   */
  readonly resolveArtifact: (artifact: AgentArtifactReference) => AgentTaskArtifactResolution | null;
}

/** Task Projector 的公开能力。 */
export interface AgentTaskProjector {
  /**
   * 构建轻量 Summary 或最小 Tombstone。
   * @param taskId - Task 身份
   * @returns 当前公开投影，不存在时返回 null
   */
  projectSummary(taskId: string): ChatAgentTaskEventSnapshot | null;
  /**
   * 按 Session 构建一页轻量 Task Summary。
   * @param input - Session、cursor 和可选终态页大小
   * @returns 受 payload 上限约束的公开列表
   */
  listTasks(input: ChatAgentListTasksInput): ChatAgentListTasksResult;
  /**
   * 构建指定 Session 下的完整 Task 详情。
   * @param sessionId - Task 必须归属的 Session
   * @param taskId - Task 身份
   * @returns 完整详情、最小 Tombstone 或 null
   */
  projectDetail(sessionId: string, taskId: string): ChatAgentGetTaskResult;
}

/** Main 生成的 Task 历史 cursor payload。 */
interface AgentTaskCursorPayload {
  /** Cursor Schema 版本。 */
  readonly cursorSchemaVersion: 1;
  /** Cursor 绑定的 Session。 */
  readonly sessionId: string;
  /** 最后实际返回终态 Task 的更新时间。 */
  readonly updatedAt: string;
  /** 同更新时间下的 Task tie-break 身份。 */
  readonly taskId: string;
}

/** Cursor 允许的最大编码长度。 */
const AGENT_TASK_CURSOR_MAX_LENGTH = 4096;

/** 列表默认终态历史数量。 */
const AGENT_TASK_LIST_DEFAULT_LIMIT = 50;

/** 列表最大终态历史数量。 */
const AGENT_TASK_LIST_MAX_LIMIT = 100;

/** Detail 中资源、Artifact 和 changeset 路径的集合上限。 */
const AGENT_TASK_DETAIL_COLLECTION_LIMIT = 32;

/** Detail 中时间线的最近窗口上限。 */
const AGENT_TASK_TIMELINE_LIMIT = 50;

/** 公开引用的最大长度。 */
const AGENT_TASK_REFERENCE_MAX_LENGTH = 1024;

/** 用户可见验收标准上限。 */
const AGENT_TASK_CRITERIA_LIMIT = 16;

/** 用户可见警告上限。 */
const AGENT_TASK_WARNING_LIMIT = 16;

/**
 * 创建稳定 Projector 错误。
 * @param reason - 机器可判断的错误原因
 * @returns 不包含内部事实的错误
 */
function createProjectorError(reason: string): Error & { readonly code: 'PROTOCOL_ERROR' } {
  return Object.assign(new Error(reason), { code: 'PROTOCOL_ERROR' as const });
}

/**
 * 创建不泄露 Task 存在性的稳定命令错误。
 * @returns IPC 可识别的 not-found 错误
 */
function createTaskNotFound(): Error & { readonly code: 'NOT_FOUND' } {
  return Object.assign(new Error('agent_task_not_found'), { code: 'NOT_FOUND' as const });
}

/**
 * 判断未知值是否为普通记录。
 * @param value - 待判断 cursor JSON
 * @returns 是否可按字符串键读取
 */
function isCursorRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 判断时间是否为规范 UTC ISO-8601 表示。
 * @param value - 未可信时间文本
 * @returns 是否可无损往返 ISO 字符串
 */
function isCanonicalTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/**
 * 编码 Main-owned 版本化历史 cursor。
 * @param payload - 已校验排序键
 * @returns base64url JSON cursor
 */
function encodeTaskCursor(payload: AgentTaskCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * 解码并校验 Session-bound 历史 cursor。
 * @param cursor - Renderer 返回的 opaque cursor
 * @param sessionId - 当前查询 Session
 * @returns Store 使用的稳定排序键
 */
function decodeTaskCursor(cursor: string, sessionId: string): { readonly updatedAt: string; readonly taskId: string } {
  if (cursor.length === 0 || cursor.length > AGENT_TASK_CURSOR_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw createProjectorError('agent_task_cursor_invalid');
  }

  let parsed: unknown;
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw createProjectorError('agent_task_cursor_invalid');
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw createProjectorError('agent_task_cursor_invalid');
  }
  if (
    !isCursorRecord(parsed) ||
    Object.keys(parsed).length !== 4 ||
    parsed.cursorSchemaVersion !== 1 ||
    parsed.sessionId !== sessionId ||
    typeof parsed.taskId !== 'string' ||
    normalizeAgentIdentity(parsed.sessionId) !== parsed.sessionId ||
    normalizeAgentIdentity(parsed.taskId) !== parsed.taskId ||
    !isCanonicalTime(parsed.updatedAt)
  ) {
    throw createProjectorError('agent_task_cursor_invalid');
  }

  return {
    updatedAt: parsed.updatedAt,
    taskId: parsed.taskId
  };
}

/**
 * 计算公开 payload 的 UTF-8 序列化字节数。
 * @param value - 待发送公开对象
 * @returns JSON UTF-8 字节数
 */
function getPayloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

/**
 * 确保单个公开投影不超过 canonical payload 上限。
 * @param snapshot - Summary 或 Tombstone
 */
function enforceSnapshotSize(snapshot: ChatAgentTaskEventSnapshot): void {
  if (getPayloadBytes(snapshot) > AGENT_CANONICAL_PAYLOAD_MAX_BYTES) {
    throw createProjectorError('agent_task_projection_oversized');
  }
}

/**
 * 校验公开引用没有秘密、控制字符、绝对路径或遍历片段。
 * @param value - resolver 或持久化事实提供的引用
 * @returns 是否可安全展示
 */
function isSafeReference(value: string): boolean {
  if (value.length === 0 || value.length > AGENT_TASK_REFERENCE_MAX_LENGTH || sanitizeAgentDisplayText(value, AGENT_TASK_REFERENCE_MAX_LENGTH) !== value) {
    return false;
  }
  const hasControl = [...value].some((character): boolean => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
  if (hasControl || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const segments = value.replaceAll('\\', '/').split('/');
  return !segments.some((segment): boolean => segment === '' || segment === '.' || segment === '..');
}

/**
 * 校验文件资源为规范仓库相对路径。
 * @param value - 文件或目录引用
 * @returns 是否为安全路径
 */
function isSafeRepoPath(value: string): boolean {
  return isSafeReference(value) && !value.includes('\\') && path.posix.normalize(value) === value;
}

/**
 * 把内部 Task Event 类型映射为稳定公开类别。
 * @param type - 当前完整 Task Event union
 * @returns 公开时间线类别
 */
function mapEventCategory(type: ChatAgentTaskEventType): ChatAgentTaskTimelineEntry['type'] {
  switch (type) {
    case 'task.created':
    case 'task.cancel_requested':
    case 'task.status_changed':
    case 'plan.authorized':
    case 'task.queued':
    case 'task.completed':
    case 'task.failed':
    case 'task.cancelled':
    case 'task.tombstoned':
      return 'status';
    case 'runtime.starting':
    case 'runtime.started':
    case 'runtime.replaced':
      return 'runtime';
    case 'confirmation.requested':
    case 'confirmation.resolved':
    case 'confirmation.invalidated':
      return 'confirmation';
    case 'tool.started':
    case 'tool.completed':
      return 'tool';
    case 'changeset.prepared':
    case 'commit.journal_created':
    case 'commit.journal_cancelled':
    case 'commit.mutation_applied':
    case 'commit.finalized':
      return 'commit';
    case 'protocol.error':
      return 'warning';
    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

/**
 * 判断运行时 Event type 是否属于当前 Task union。
 * @param value - 持久化 Event type
 * @returns 是否为已知 Task Event type
 */
function isTaskEventType(value: string): value is ChatAgentTaskEventType {
  return [
    'task.created',
    'task.cancel_requested',
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
    'commit.journal_cancelled',
    'commit.mutation_applied',
    'commit.finalized',
    'protocol.error',
    'task.completed',
    'task.failed',
    'task.cancelled',
    'task.tombstoned'
  ].includes(value);
}

/** Task Projector 的显式 allowlist 实现。 */
class DefaultAgentTaskProjector implements AgentTaskProjector {
  /** Main-owned 持久化 Store。 */
  private readonly store: AgentTaskProjectorStore;

  /** 内部资源到安全公开引用的解析器。 */
  private readonly resolveResource: AgentTaskProjectorDependencies['resolveResource'];

  /** 内部 Artifact 到安全公开引用的解析器。 */
  private readonly resolveArtifact: AgentTaskProjectorDependencies['resolveArtifact'];

  /**
   * 创建阶段一 Task Projector。
   * @param dependencies - Store 与窄资源 resolver
   */
  constructor(dependencies: AgentTaskProjectorDependencies) {
    this.store = dependencies.store;
    this.resolveResource = dependencies.resolveResource;
    this.resolveArtifact = dependencies.resolveArtifact;
  }

  /** @inheritdoc */
  projectSummary(taskId: string): ChatAgentTaskEventSnapshot | null {
    const projection = this.store.getTaskProjection(taskId);
    return projection ? this.projectRecord(projection) : null;
  }

  /** @inheritdoc */
  projectDetail(sessionId: string, taskId: string): ChatAgentGetTaskResult {
    const projection = this.store.getTaskProjection(taskId);
    if (!projection || projection.task.sessionId !== sessionId) return null;
    const summary = this.projectRecord(projection);
    if (summary.recordState === 'tombstoned') return summary;

    const warningCodes: string[] = [];
    const { result } = projection.task;
    const completion = result ? this.projectCompletion(projection, result, warningCodes) : undefined;
    const sourceError = result?.error ?? projection.task.error;
    const error = sourceError ? this.projectError(sourceError) : undefined;
    const usage = result ? this.projectUsage(result.usage) : undefined;
    const changeset = this.projectChangeset(projection, warningCodes);
    const artifacts = this.projectArtifacts(projection, warningCodes);
    const detail: ChatAgentTaskDetailSnapshot = {
      ...summary,
      acceptanceCriteria: Object.freeze(this.projectCriteria(projection, warningCodes)),
      resources: Object.freeze(this.projectResources(projection, warningCodes)),
      timeline: this.projectTimeline(projection),
      ...(completion ? { completion } : {}),
      warnings: Object.freeze(this.projectWarnings(result, warningCodes)),
      ...(error ? { error } : {}),
      ...(usage ? { usage } : {}),
      ...(changeset ? { changeset } : {}),
      artifacts: Object.freeze(artifacts)
    };
    if (getPayloadBytes(detail) > AGENT_CANONICAL_PAYLOAD_MAX_BYTES) {
      throw createProjectorError('agent_task_projection_oversized');
    }
    return Object.freeze(detail);
  }

  /** @inheritdoc */
  listTasks(input: ChatAgentListTasksInput): ChatAgentListTasksResult {
    if (
      normalizeAgentIdentity(input.sessionId) !== input.sessionId ||
      (input.limit !== undefined && (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > AGENT_TASK_LIST_MAX_LIMIT))
    ) {
      throw createProjectorError('agent_task_list_input_invalid');
    }
    const terminalBefore = input.cursor ? decodeTaskCursor(input.cursor, input.sessionId) : undefined;
    const page = this.store.listTasksBySession({
      sessionId: input.sessionId,
      includeActive: terminalBefore === undefined,
      ...(terminalBefore ? { terminalBefore } : {}),
      terminalLimit: input.limit ?? AGENT_TASK_LIST_DEFAULT_LIMIT
    });
    const active = page.active.map((projection): ChatAgentTaskSummarySnapshot => this.projectListRecord(projection, input.sessionId));
    const terminal: ChatAgentTaskSummarySnapshot[] = [];
    if (getPayloadBytes({ tasks: active }) > AGENT_CANONICAL_PAYLOAD_MAX_BYTES) {
      throw createProjectorError('agent_task_projection_oversized');
    }

    let byteTruncated = false;
    for (const projection of page.terminal) {
      const summary = this.projectListRecord(projection, input.sessionId);
      const candidate = { tasks: [...active, ...terminal, summary] };
      if (getPayloadBytes(candidate) > AGENT_CANONICAL_PAYLOAD_MAX_BYTES) {
        byteTruncated = true;
        break;
      }
      terminal.push(summary);
    }

    const needsCursor = page.hasMoreTerminal || byteTruncated;
    if (!needsCursor) {
      return Object.freeze({
        tasks: Object.freeze([...active, ...terminal])
      });
    }
    if (terminal.length === 0) {
      throw createProjectorError('agent_task_projection_oversized');
    }

    let nextCursor = this.createCursor(input.sessionId, terminal.at(-1)!);
    while (terminal.length > 0 && getPayloadBytes({ tasks: [...active, ...terminal], nextCursor }) > AGENT_CANONICAL_PAYLOAD_MAX_BYTES) {
      terminal.pop();
      if (terminal.length > 0) nextCursor = this.createCursor(input.sessionId, terminal.at(-1)!);
    }
    if (terminal.length === 0) {
      throw createProjectorError('agent_task_projection_oversized');
    }

    return Object.freeze({
      tasks: Object.freeze([...active, ...terminal]),
      nextCursor
    });
  }

  /**
   * 构建与最后实际返回终态 Summary 绑定的 cursor。
   * @param sessionId - 当前 Session
   * @param summary - 最后实际返回的终态 Summary
   * @returns Main-owned opaque cursor
   */
  private createCursor(sessionId: string, summary: ChatAgentTaskSummarySnapshot): string {
    return encodeTaskCursor({
      cursorSchemaVersion: 1,
      sessionId,
      updatedAt: summary.updatedAt,
      taskId: summary.taskId
    });
  }

  /**
   * 裁剪用户可见验收标准。
   * @param projection - Store 投影事实
   * @returns 最多十六条安全文本
   */
  private projectCriteria(projection: AgentTaskProjectionRecord, warningCodes: string[]): string[] {
    if (projection.task.contractSnapshot.acceptanceCriteria.length > AGENT_TASK_CRITERIA_LIMIT) {
      warningCodes.push('acceptance_criteria_truncated');
    }
    return projection.task.contractSnapshot.acceptanceCriteria
      .slice(0, AGENT_TASK_CRITERIA_LIMIT)
      .map((criterion): string => sanitizeAgentDisplayText(criterion, 4000) || '[REDACTED]');
  }

  /**
   * 从 Contract 重建公开资源，不透传内部字段。
   * @param projection - Store 投影事实
   * @returns 最多三十二个安全资源
   */
  private projectResources(projection: AgentTaskProjectionRecord, warningCodes: string[]): ChatAgentTaskDetailSnapshot['resources'][number][] {
    const resources: ChatAgentTaskDetailSnapshot['resources'][number][] = [];
    let omitted = false;
    for (const resource of projection.task.contractSnapshot.resources) {
      if (resources.length >= AGENT_TASK_DETAIL_COLLECTION_LIMIT) {
        omitted = true;
        break;
      }
      let resolved: AgentTaskResourceResolution | null;
      if (resource.kind === 'file' || resource.kind === 'directory') {
        resolved = isSafeRepoPath(resource.reference)
          ? { displayReference: resource.reference, ...(resource.revision ? { revision: resource.revision } : {}) }
          : null;
      } else {
        resolved = this.resolveResource(resource);
      }
      if (!resolved || !isSafeReference(resolved.displayReference) || (resolved.revision !== undefined && !isSafeReference(resolved.revision))) {
        omitted = true;
        continue;
      }
      resources.push(
        Object.freeze({
          kind: resource.kind,
          displayReference: resolved.displayReference,
          ...(resolved.revision ? { revision: resolved.revision } : {})
        })
      );
    }
    if (omitted) warningCodes.push('resources_truncated');
    return resources;
  }

  /**
   * 构建结果完成度并检测验证矛盾。
   * @param result - Attempt 或授权前失败结果
   * @param warningCodes - 系统警告收集器
   * @returns 用户可见完成度
   */
  private projectCompletion(
    projection: AgentTaskProjectionRecord,
    result: NonNullable<AgentTaskRecord['result']>,
    warningCodes: string[]
  ): NonNullable<ChatAgentTaskDetailSnapshot['completion']> {
    if (
      result.completion.criteria.length !== projection.task.contractSnapshot.acceptanceCriteria.length ||
      result.completion.criteria.some((criterion, index): boolean => criterion.criterionIndex !== index)
    ) {
      throw createProjectorError('agent_task_projection_invalid');
    }
    if (result.completion.criteria.length > AGENT_TASK_CRITERIA_LIMIT) {
      warningCodes.push('criteria_results_truncated');
    }
    const criteria = result.completion.criteria.slice(0, AGENT_TASK_CRITERIA_LIMIT).map((criterion) => {
      if (criterion.verification.status === 'contradicted') warningCodes.push('criterion_contradicted');
      return Object.freeze({
        criterionIndex: criterion.criterionIndex,
        claimStatus: criterion.claim.status,
        verificationStatus: criterion.verification.status,
        claimSummary: sanitizeAgentDisplayText(criterion.claim.summary, 1000) || '[REDACTED]'
      });
    });
    return Object.freeze({
      level: result.completion.level,
      summary: sanitizeAgentDisplayText(result.summary, 1000) || '[REDACTED]',
      criteria: Object.freeze(criteria)
    });
  }

  /**
   * 深复制公开 usage，避免暴露 Store 对象引用。
   * @param usage - 持久化成本事实
   * @returns 深只读公开成本
   */
  private projectUsage(usage: AgentUsageAccounting): NonNullable<ChatAgentTaskDetailSnapshot['usage']> {
    return Object.freeze({
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      modelCalls: usage.modelCalls,
      toolRounds: usage.toolRounds,
      queueDurationMs: usage.queueDurationMs,
      executionDurationMs: usage.executionDurationMs,
      externalRequests: usage.externalRequests,
      monetaryCost: Object.freeze({
        currency: usage.monetaryCost.currency,
        pricingVersion: usage.monetaryCost.pricingVersion,
        estimated: usage.monetaryCost.estimated,
        actual: usage.monetaryCost.actual
      })
    });
  }

  /**
   * 仅复制公开错误字段与细节键。
   * @param error - 持久化结构化错误
   * @returns 二次裁剪后的错误
   */
  private projectError(error: AgentTaskError): NonNullable<ChatAgentTaskDetailSnapshot['error']> {
    const allowedKeys = [
      'reason',
      'toolName',
      'expectedHash',
      'actualHash',
      'expectedVersion',
      'actualVersion',
      'status',
      'limit',
      'observed',
      'deadlineAt'
    ] as const;
    const details: Partial<Record<(typeof allowedKeys)[number], string | number | boolean | null>> = {};
    for (const key of allowedKeys) {
      const value = error.details?.[key];
      if (value === undefined) continue;
      details[key] = typeof value === 'string' ? sanitizeAgentDisplayText(value, 1000) || '[REDACTED]' : value;
    }
    const message = error.message === undefined ? null : sanitizeAgentDisplayText(error.message, 1000);
    return Object.freeze({
      code: error.code,
      phase: error.phase,
      category: error.category,
      retryable: error.retryable,
      ...(message ? { message } : {}),
      ...(Object.keys(details).length > 0 ? { details: Object.freeze(details) } : {})
    });
  }

  /**
   * 合并系统警告与结果警告并稳定截断。
   * @param result - 可选终态结果
   * @param warningCodes - 已发现的系统警告
   * @returns 最多十六条公开警告
   */
  private projectWarnings(result: AgentTaskRecord['result'], warningCodes: string[]): ChatAgentTaskDetailSnapshot['warnings'][number][] {
    const messages: Readonly<Record<string, string>> = {
      acceptance_criteria_truncated: 'Additional acceptance criteria were omitted.',
      criteria_results_truncated: 'Additional criterion results were omitted.',
      criterion_contradicted: 'One or more Child claims were contradicted by verification.',
      resources_truncated: 'Some resources were omitted from the public projection.',
      artifacts_truncated: 'Some artifacts were omitted from the public projection.',
      changeset_paths_truncated: 'Some changeset paths were omitted from the public projection.',
      warnings_truncated: 'Additional warnings were omitted.'
    };
    const uniqueCodes = [...new Set(warningCodes)];
    const warnings = uniqueCodes.map((code) => Object.freeze({ code, message: messages[code] ?? 'Projection data was omitted.' }));
    for (const warning of result?.warnings ?? []) {
      if (warnings.length >= AGENT_TASK_WARNING_LIMIT) break;
      const code = sanitizeAgentDisplayText(warning.code, 100) || 'warning';
      const message = sanitizeAgentDisplayText(warning.message, 1000) || '[REDACTED]';
      warnings.push(Object.freeze({ code, message }));
    }
    if ((result?.warnings.length ?? 0) + uniqueCodes.length > AGENT_TASK_WARNING_LIMIT) {
      warnings.splice(
        AGENT_TASK_WARNING_LIMIT - 1,
        1,
        Object.freeze({
          code: 'warnings_truncated',
          message: messages.warnings_truncated
        })
      );
    }
    return warnings;
  }

  /**
   * 仅投影当前 Attempt 拥有的 user Artifact。
   * @param projection - Store 投影事实
   * @param warningCodes - 系统警告收集器
   * @returns 最多三十二个公开 Artifact
   */
  private projectArtifacts(projection: AgentTaskProjectionRecord, warningCodes: string[]): ChatAgentTaskDetailSnapshot['artifacts'][number][] {
    const { result } = projection.task;
    const attempt = projection.currentAttempt;
    if (!result || !attempt || 'resultKind' in result) return [];
    const artifacts: ChatAgentTaskDetailSnapshot['artifacts'][number][] = [];
    let candidateCount = 0;
    for (const artifact of result.artifacts) {
      if (
        artifact.visibility !== 'user' ||
        artifact.owner.taskId !== projection.task.taskId ||
        artifact.owner.agentId !== projection.task.agentId ||
        artifact.owner.attemptId !== attempt.attemptId
      ) {
        continue;
      }
      const resolved = this.resolveArtifact(artifact);
      if (!resolved || !isSafeReference(resolved.reference) || !isSafeReference(artifact.artifactId) || !isSafeReference(artifact.kind)) {
        continue;
      }
      candidateCount += 1;
      if (artifacts.length >= AGENT_TASK_DETAIL_COLLECTION_LIMIT) continue;
      artifacts.push(
        Object.freeze({
          artifactId: artifact.artifactId,
          kind: artifact.kind,
          reference: resolved.reference,
          ...(artifact.contentHash ? { contentHash: artifact.contentHash } : {}),
          owner: Object.freeze({
            taskId: artifact.owner.taskId,
            agentId: artifact.owner.agentId,
            attemptId: artifact.owner.attemptId
          }),
          visibility: 'user',
          createdAt: artifact.createdAt
        })
      );
    }
    if (candidateCount > AGENT_TASK_DETAIL_COLLECTION_LIMIT) warningCodes.push('artifacts_truncated');
    return artifacts;
  }

  /**
   * 从 changeset 和 journal 事实计算公开摘要。
   * @param projection - Store 投影事实
   * @param warningCodes - 系统警告收集器
   * @returns 可选公开 changeset
   */
  private projectChangeset(projection: AgentTaskProjectionRecord, warningCodes: string[]): ChatAgentTaskDetailSnapshot['changeset'] {
    const { changeset } = projection;
    if (!changeset) return undefined;
    const displayPaths: string[] = [];
    let omitted = false;
    for (const operation of changeset.snapshot.operations) {
      if (displayPaths.length >= AGENT_TASK_DETAIL_COLLECTION_LIMIT) {
        omitted = true;
        break;
      }
      if (!isSafeRepoPath(operation.displayPath)) {
        omitted = true;
        continue;
      }
      displayPaths.push(operation.displayPath);
    }
    if (omitted) warningCodes.push('changeset_paths_truncated');
    return Object.freeze({
      changesetId: changeset.snapshot.changesetId,
      baseRevision: changeset.snapshot.baseRevision,
      diffHash: changeset.snapshot.diffHash,
      operationSetHash: changeset.snapshot.operationSetHash,
      displayPaths: Object.freeze(displayPaths),
      phase: this.projectPhase(projection)
    });
  }

  /**
   * 按 journal 优先级计算公开 changeset 阶段。
   * @param projection - Store 投影事实
   * @returns 稳定公开阶段
   */
  private projectPhase(projection: AgentTaskProjectionRecord): NonNullable<ChatAgentTaskDetailSnapshot['changeset']>['phase'] {
    const journalStatus = projection.journal?.status;
    switch (journalStatus) {
      case 'manual_recovery':
      case 'failed':
        return 'recovery_required';
      case 'finalized':
        return 'finalized';
      case 'applied':
        return 'mutation_applied';
      case 'created':
      case 'applying':
        return 'journal_created';
      case 'cancelled':
        return 'discarded';
      case undefined:
        break;
      default: {
        const exhaustive: never = journalStatus;
        return exhaustive;
      }
    }
    if (projection.task.status === 'queued' && projection.task.queuePhase === 'commit' && projection.changeset?.status === 'approved') {
      return 'commit_queued';
    }
    switch (projection.changeset?.status) {
      case 'approved':
        return 'approved';
      case 'awaiting_confirmation':
        return 'awaiting_confirmation';
      case 'rejected':
      case 'revoked':
      case 'discarded':
        return 'discarded';
      default:
        return 'prepared';
    }
  }

  /**
   * 校验连续性并映射最近 Task 时间线。
   * @param projection - Store 投影事实
   * @returns 不含 Event payload 的公开时间线
   */
  private projectTimeline(projection: AgentTaskProjectionRecord): ChatAgentTaskTimelineSnapshot {
    const events = projection.events.slice(-AGENT_TASK_TIMELINE_LIMIT);
    if (
      (events.length === 0 && projection.taskSequence !== 0) ||
      (events.length > 0 && events.at(-1)?.sequence !== projection.taskSequence) ||
      events.some(
        (event, index): boolean =>
          event.aggregate.kind !== 'task' ||
          event.aggregate.id !== projection.task.taskId ||
          event.taskId !== projection.task.taskId ||
          (event.checkpointId !== undefined && event.checkpointId !== projection.task.checkpointId) ||
          !isTaskEventType(event.type) ||
          !Number.isInteger(event.sequence) ||
          event.sequence < 1 ||
          !isCanonicalTime(event.occurredAt) ||
          (index > 0 && event.sequence !== events[index - 1].sequence + 1)
      )
    ) {
      throw createProjectorError('agent_task_timeline_invalid');
    }
    const entries = events.map((event): ChatAgentTaskTimelineEntry => {
      if (!isTaskEventType(event.type)) throw createProjectorError('agent_task_timeline_invalid');
      return Object.freeze({
        sequence: event.sequence,
        type: mapEventCategory(event.type),
        code: event.type === 'commit.journal_cancelled' ? 'journal_cancelled' : event.type,
        occurredAt: event.occurredAt
      });
    });
    const firstSequence = entries[0]?.sequence;
    const lastSequence = entries.at(-1)?.sequence;
    return Object.freeze({
      entries: Object.freeze(entries),
      ...(firstSequence === undefined ? {} : { firstSequence }),
      ...(lastSequence === undefined ? {} : { lastSequence }),
      truncated: firstSequence !== undefined && firstSequence > 1
    });
  }

  /**
   * 构建列表要求的活动 Summary，并拒绝 tombstone 或跨 Session 记录。
   * @param projection - Store 同事务返回的完整事实
   * @param sessionId - 当前列表 Session
   * @returns 轻量活动 Summary
   */
  private projectListRecord(projection: AgentTaskProjectionRecord, sessionId: string): ChatAgentTaskSummarySnapshot {
    const snapshot = this.projectRecord(projection);
    if (snapshot.recordState !== 'active' || snapshot.sessionId !== sessionId) {
      throw createProjectorError('agent_task_list_record_invalid');
    }
    return snapshot;
  }

  /**
   * 从同事务持久化事实构建 Summary 或 Tombstone。
   * @param projection - Store 投影记录
   * @returns 显式 allowlist 公开对象
   */
  private projectRecord(projection: AgentTaskProjectionRecord): ChatAgentTaskEventSnapshot {
    const { task, checkpoint, currentAttempt } = projection;
    const toolCalls = checkpoint.continuationSnapshot.orderedToolCalls.filter((entry): boolean => entry.taskId === task.taskId);
    const toolCall = toolCalls[0];
    if (
      checkpoint.checkpointId !== task.checkpointId ||
      checkpoint.sessionId !== task.sessionId ||
      checkpoint.turnId !== task.turnId ||
      checkpoint.rootRuntimeId !== task.rootRuntimeId ||
      checkpoint.primaryAgentId !== task.parentAgentId ||
      toolCalls.length !== 1 ||
      toolCall.toolCallId !== task.toolCallId ||
      (task.currentAttemptId === undefined) !== (currentAttempt === undefined) ||
      (currentAttempt !== undefined &&
        (currentAttempt.attemptId !== task.currentAttemptId ||
          currentAttempt.taskId !== task.taskId ||
          currentAttempt.planHash !== task.executionPlanSnapshotHash)) ||
      !isCanonicalTime(task.createdAt) ||
      !isCanonicalTime(task.updatedAt) ||
      (task.deadlineAt !== undefined && !isCanonicalTime(task.deadlineAt)) ||
      (currentAttempt !== undefined &&
        (!isCanonicalTime(currentAttempt.createdAt) ||
          (currentAttempt.startedAt !== undefined && !isCanonicalTime(currentAttempt.startedAt)) ||
          (currentAttempt.finishedAt !== undefined && !isCanonicalTime(currentAttempt.finishedAt))))
    ) {
      throw createProjectorError('agent_task_projection_invalid');
    }
    if (task.recordState === 'tombstoned') {
      const tombstone: ChatAgentTaskTombstoneSnapshot = {
        recordState: 'tombstoned',
        taskId: task.taskId,
        sessionId: task.sessionId,
        turnId: task.turnId,
        checkpointId: task.checkpointId,
        assistantMessageId: checkpoint.assistantMessageId,
        toolCallId: task.toolCallId,
        projectionSchemaVersion: 1,
        taskSequence: projection.taskSequence,
        updatedAt: task.updatedAt
      };
      enforceSnapshotSize(tombstone);
      return Object.freeze(tombstone);
    }
    const cancelEvents = projection.events.filter((event): boolean => event.type === 'task.cancel_requested');
    let cancellation: ChatAgentTaskSummarySnapshot['cancellation'];
    if (task.cancelRequestedAt !== undefined) {
      const event = cancelEvents[0];
      const payload = event?.payload;
      if (
        cancelEvents.length !== 1 ||
        !event ||
        event.occurredAt !== task.cancelRequestedAt ||
        typeof payload !== 'object' ||
        payload === null ||
        !('requestKind' in payload) ||
        (payload.requestKind !== 'single_task' && payload.requestKind !== 'checkpoint_cascade')
      ) {
        throw createProjectorError('agent_task_cancellation_invalid');
      }
      cancellation = Object.freeze({
        requestKind: payload.requestKind,
        requestedAt: task.cancelRequestedAt
      });
    } else if (cancelEvents.length !== 0) {
      throw createProjectorError('agent_task_cancellation_invalid');
    }

    const taskText = sanitizeAgentDisplayText(task.contractSnapshot.task, 4000);
    if (!taskText) throw createProjectorError('agent_task_projection_invalid');
    const resultSummary = task.result?.summary === undefined ? null : sanitizeAgentDisplayText(task.result.summary, 1000);
    const summary: ChatAgentTaskSummarySnapshot = {
      recordState: 'active',
      taskId: task.taskId,
      sessionId: task.sessionId,
      turnId: task.turnId,
      checkpointId: task.checkpointId,
      assistantMessageId: checkpoint.assistantMessageId,
      toolCallId: task.toolCallId,
      agentId: task.agentId,
      projectionSchemaVersion: 1,
      taskSequence: projection.taskSequence,
      task: taskText,
      mode: task.contractSnapshot.mode,
      required: toolCall.required,
      priority: task.priority,
      ...(task.deadlineAt ? { deadlineAt: task.deadlineAt } : {}),
      status: task.status,
      ...(task.queuePhase ? { queuePhase: task.queuePhase } : {}),
      ...(currentAttempt
        ? {
            currentAttempt: Object.freeze({
              attemptId: currentAttempt.attemptId,
              attemptNumber: currentAttempt.attemptNumber,
              agentId: task.agentId,
              attemptState: currentAttempt.status,
              runtimeId: currentAttempt.currentRuntimeId,
              createdAt: currentAttempt.createdAt,
              ...(currentAttempt.startedAt ? { startedAt: currentAttempt.startedAt } : {}),
              ...(currentAttempt.finishedAt ? { endedAt: currentAttempt.finishedAt } : {})
            }),
            duration: Object.freeze({
              queueDurationMs: currentAttempt.usageSnapshot.queueDurationMs,
              executionDurationMs: currentAttempt.usageSnapshot.executionDurationMs,
              complete: currentAttempt.usageComplete
            })
          }
        : {}),
      ...(cancellation ? { cancellation } : {}),
      ...(resultSummary ? { summary: resultSummary } : {}),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    };
    enforceSnapshotSize(summary);
    return Object.freeze(summary);
  }
}

/**
 * 创建 Main-owned Task allowlist Projector。
 * @param dependencies - 窄 Store 与资源 resolver
 * @returns Summary/Tombstone/List Projector
 */
export function createAgentTaskProjector(dependencies: AgentTaskProjectorDependencies): AgentTaskProjector {
  return new DefaultAgentTaskProjector(dependencies);
}

/** 已提交 Task 投影的异步合并发布边界。 */
export interface AgentTaskProjectionPump {
  /**
   * 排队一个待重新投影的 Task。
   * @param taskId - 已提交 Task 身份
   */
  enqueue(taskId: string): void;
}

/** Task 投影 Pump 最多保留的已发布序列数。 */
export const AGENT_TASK_PROJECTION_CACHE_LIMIT = 512;

/**
 * 创建不影响持久化返回值的 Task 投影 Pump。
 * @param input - 投影、发布、报告和调度依赖
 * @returns no-throw 排队边界
 */
export function createTaskProjectionPump(input: {
  /** 按身份重读 committed Summary/Tombstone。 */
  readonly projectSummary: (taskId: string) => ChatAgentTaskEventSnapshot | null;
  /** 发布到既有 Agent application channel。 */
  readonly publish: (event: ChatAgentTaskUpdatedEvent) => void;
  /** 上报稳定错误码。 */
  readonly reportError: (code: string) => void;
  /** 可替换的 event-loop 调度器。 */
  readonly schedule?: (flush: () => void) => void;
}): AgentTaskProjectionPump {
  const pending = new Set<string>();
  const lastPublished = new Map<string, number>();
  const schedule = input.schedule ?? queueMicrotask;
  let scheduled = false;

  /**
   * 记录最近发布序列，并淘汰最旧 Task 去重状态。
   * @param taskId - Task 身份
   * @param taskSequence - 已发布序列
   */
  function rememberPublishedTask(taskId: string, taskSequence: number): void {
    lastPublished.delete(taskId);
    lastPublished.set(taskId, taskSequence);
    while (lastPublished.size > AGENT_TASK_PROJECTION_CACHE_LIMIT) {
      const oldestTaskId = lastPublished.keys().next().value;
      if (typeof oldestTaskId !== 'string') break;
      lastPublished.delete(oldestTaskId);
    }
  }

  /**
   * 吞掉错误报告器自身异常。
   * @param code - 稳定机器码
   */
  function report(code: string): void {
    try {
      input.reportError(code);
    } catch {
      // 报告器不能反向破坏 post-commit 边界。
    }
  }

  /** 重读并发布本轮去重后的 Task。 */
  function flush(): void {
    scheduled = false;
    const taskIds = [...pending];
    pending.clear();
    taskIds.forEach((taskId): void => {
      try {
        const task = input.projectSummary(taskId);
        if (!task || task.taskSequence <= (lastPublished.get(taskId) ?? 0)) return;
        input.publish({
          schemaVersion: 1,
          type: 'task.updated',
          task,
          taskSequence: task.taskSequence
        });
        rememberPublishedTask(taskId, task.taskSequence);
      } catch {
        pending.add(taskId);
        report('agent_task_projection_publish_failed');
      }
    });
  }

  /** 安排一次合并 flush；调度失败保留 pending 供后续通知恢复。 */
  function requestFlush(): void {
    if (scheduled) return;
    scheduled = true;
    try {
      schedule(flush);
    } catch {
      scheduled = false;
      report('agent_task_projection_schedule_failed');
    }
  }

  return Object.freeze({
    enqueue(taskId: string): void {
      try {
        if (normalizeAgentIdentity(taskId) !== taskId) {
          report('agent_task_projection_identity_invalid');
          return;
        }
        pending.add(taskId);
        requestFlush();
      } catch {
        report('agent_task_projection_enqueue_failed');
      }
    }
  });
}

/** 主进程授权器为一个只读 Task 分配的当前上限。 */
export interface ChatAgentReadPlanLimits {
  /** 主进程此刻实际可用的工具名称。 */
  readonly availableToolNames: readonly string[];
  /** 权限系统批准的 scope IDs。 */
  readonly permissionScopeIds: readonly string[];
  /** Task 独立预算上限。 */
  readonly budget: AgentBudgetSnapshot;
}

/** 委派服务稳定 ID 域。 */
export type ChatAgentDelegationIdKind = 'task' | 'child' | 'outbox' | 'continuation' | 'runtime';

/** Runtime service 内部 Primary 续接启动输入。 */
export interface ChatAgentPrimaryContinuationInput {
  /** 已 CAS claim 的 Checkpoint。 */
  readonly checkpoint: AgentCheckpointRecord;
  /** Checkpoint 绑定的新 Runtime B。 */
  readonly runtimeId: string;
  /** 已完成完整性校验的易失上下文。 */
  readonly context: ContinuationRuntimeContext;
}

/** Runtime service 内部 Primary 续接执行结果。 */
export type ChatAgentPrimaryContinuationResult =
  | {
      /** Runtime B 已安全完成模型执行。 */
      readonly outcome: 'completed';
    }
  | {
      /** Runtime B 已把失败安全写入 owner assistant。 */
      readonly outcome: 'failed';
      /** 失败发生在启动还是模型执行阶段。 */
      readonly phase: 'starting' | 'runtime';
      /** 已校验且可直接持久化的机器错误。 */
      readonly error: AgentTaskError;
    };

/** 委派服务依赖。 */
export interface ChatAgentDelegationServiceDependencies {
  /** 同步持久化事实 Store。 */
  store: ChatAgentDelegationStore;
  /** Renderer Task 查询使用的只读公开投影器。 */
  taskProjector: AgentTaskProjector;
  /** Chat 与 Runtime 共享锁注册表。 */
  locks: RuntimeLockRegistry;
  /**
   * 同一 SQLite 事务中的 assistant 写入回调。
   * @param message - 含完整 deferred tool-call 的 assistant
   * @returns 必须同步完成
   */
  persistAssistant: (message: ChatMessageRecord, ownerCheckpointId?: string) => undefined;
  /**
   * 读取会话完整消息，用于 Checkpoint 终态化 source assistant。
   * @param sessionId - 会话 ID
   * @returns 按持久化顺序排列的消息
   */
  readMessages: (sessionId: string) => ChatMessageRecord[];
  /**
   * 广播已由 fence owner 持久化的 source assistant 更新。
   * @param message - 已终态化 assistant
   * @param checkpoint - 消息所属 Checkpoint
   */
  publishAssistant: (message: ChatMessageRecord, checkpoint: AgentCheckpointRecord) => void;
  /**
   * 发布已持久化 Outbox 事件。
   * @param eventType - 事件类型
   * @param payload - allowlist payload
   */
  publish: (eventType: 'delegation.created' | 'delegation.ready', payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload) => void;
  /**
   * 在 Renderer 投影之前交付强制 Main 内部消费者。
   * @param eventType - 持久化 Outbox 事件类型
   * @param payload - allowlist payload
   */
  dispatchInternal?: (
    eventType: 'delegation.created' | 'delegation.ready',
    payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload
  ) => Promise<void>;
  /**
   * 发布已持久化的公开 Checkpoint 或 confirmation 投影。
   * @param event - 判别式 application event
   */
  publishCheckpoint: (event: ChatAgentApplicationEvent) => void;
  /** Main-owned 持久化 confirmation queue；隔离测试可省略以保持旧只读 fixture。 */
  confirmationQueue?: AgentConfirmationQueue;
  /**
   * 删除 Main 私有目录中尚未进入 durable journal 的 write overlay。
   * 启动恢复专用；缺省表示隔离实例没有磁盘 overlay。
   */
  discardTaskOverlay?: (input: { readonly taskId: string; readonly attemptId: string }) => Promise<void>;
  /** Main-owned 委派灰度配置；缺省时受控写入保持关闭。 */
  featureConfig?: Readonly<PrimaryDelegationFeatureConfig>;
  /**
   * 创建稳定身份。
   * @param kind - 身份域
   * @param index - 同一 prepare 内从一开始的序号
   * @returns 新身份
   */
  createId: (kind: ChatAgentDelegationIdKind, index?: number) => string;
  /** @returns 当前 ISO-8601 时间。 */
  now: () => string;
  /**
   * 从主进程权限、可用性和预算事实解析当前 Task 上限。
   * @param task - 不可变 Task
   * @param checkpoint - Task 所属 Checkpoint
   * @param context - 已通过 hash 校验的冻结上下文
   * @returns 不接受 Renderer 覆盖的当前上限
   */
  resolveReadLimits?: (task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, context: ContinuationRuntimeContext) => ChatAgentReadPlanLimits;
  /** Main-owned 持久化 Turn/Task 预算账本；生产授权必须注入。 */
  budgetLedger?: AgentBudgetLedger;
  /**
   * 使用主进程 registry 与 policy 编译计划。
   * @param input - 持久化事实和可信授权上限
   * @returns 已冻结计划或结构化失败
   */
  compileReadPlan?: (input: AgentPlanCompileInput) => AgentPlanCompileResult;
  /**
   * 启动只接受内部冻结输入的 Primary Runtime B。
   * @param input - claimed Checkpoint、Runtime ID 与易失上下文
   * @returns 安全完成或已持久化失败
   */
  startPrimaryContinuation: (input: ChatAgentPrimaryContinuationInput) => Promise<ChatAgentPrimaryContinuationResult>;
  /**
   * 等待 Main Coordinator 完成单 Task 取消仲裁。
   * @param taskId - 目标 Task
   * @returns 权威 disposition
   */
  cancelTaskExecution?: (taskId: string) => Promise<AgentTaskCancellationProjection['disposition']>;
  /**
   * 等待 Main Coordinator 完成 Checkpoint 级联与清理。
   * @param checkpointId - 目标 Checkpoint
   * @param reason - 稳定机器原因
   */
  cancelCheckpointExecution?: (checkpointId: string, reason: string) => Promise<void>;
}

/** 服务边界接收的未可信 Child 终态结果。 */
export interface ChatAgentRecordTaskResultInput {
  /** 结果所属 Task。 */
  taskId: string;
  /** 汇合结果的 Checkpoint。 */
  checkpointId: string;
  /** 原始 Provider tool-call ID。 */
  toolCallId: string;
  /** Child 提交的未可信结果；不接受其自报 hash。 */
  result: unknown;
}

/** 委派服务公开能力。 */
export interface ChatAgentDelegationService {
  /**
   * 同步校验并原子提交委派事实。
   * @param input - Runtime A 的完整 prepare 输入
   * @returns 精确同步 ACK
   */
  prepareDelegation(input: ChatRuntimeDelegationPrepareInput): ChatRuntimeDelegationPrepareAck;
  /**
   * 从持久化事实和主进程可信依赖编译并原子授权一个 Task。
   * @param taskId - created 状态的 Task
   * @returns queued(start) 状态的 Task
   */
  authorizeTask(taskId: string): AgentTaskRecord;
  /**
   * 规范化并原子记录一个 Child 终态结果。
   * @param input - 不含 Child hash 的 Task 结果
   * @returns 最新 Checkpoint 投影
   */
  recordTaskResult(input: ChatAgentRecordTaskResultInput): ReturnType<AgentDelegationStore['recordTaskResult']>;
  /**
   * 原子记录一个不伪造 Attempt 的授权前失败。
   * @param task - 失败所属持久化 Task
   * @param error - 不可重试的计划或资源错误
   * @returns 最新 Checkpoint 投影
   */
  recordPreFailure(task: AgentTaskRecord, error: AgentTaskError): ReturnType<AgentDelegationStore['recordPreAttemptFailure']>;
  /**
   * 原子记录无 Attempt cooperative cancellation。
   * @param task - 目标 Task
   * @param requestKind - 单 Task 或 Checkpoint 级联
   * @returns 最新 Checkpoint
   */
  recordPreCancellation(
    task: AgentTaskRecord,
    requestKind: 'single_task' | 'checkpoint_cascade'
  ): ReturnType<AgentDelegationStore['recordPreAttemptCancellation']>;
  /**
   * 持久化已有 Attempt Task 的 cooperative cancellation 请求。
   * @param taskId - 目标 Task
   * @param requestKind - 单 Task 或 Checkpoint 级联
   * @returns 权威 Task 投影
   */
  requestTaskCancellation(taskId: string, requestKind: 'single_task' | 'checkpoint_cascade'): AgentTaskCancellationProjection;
  /**
   * 使用当前 ready 版本 CAS claim 唯一 Runtime B。
   * @param checkpointId - ready Checkpoint
   * @returns claim 成功后的 Checkpoint，竞争失败为 null
   */
  claimPrimaryResume(checkpointId: string): AgentCheckpointRecord | null;
  /**
   * CAS claim 并启动唯一 Primary Runtime B。
   * @param input - Renderer 只能提议身份与观察版本
   * @returns 启动确认与 Main 派生地址，不等待模型完成
   */
  resumePrimary(input: ChatAgentResumePrimaryInput): Promise<ChatAgentResumeResult>;
  /** @returns 所有公开非终态 Checkpoint 投影。 */
  listActive(): ChatAgentCheckpointSnapshot[];
  /**
   * 按 Session 查询 Task 轻量投影。
   * @param input - Session、游标和页大小
   * @returns 活动与终态 Task 页
   */
  listTasks(input: ChatAgentListTasksInput): ChatAgentListTasksResult;
  /**
   * 定向查询单 Task 详情。
   * @param input - Session 与 Task 身份
   * @returns Detail/Tombstone 或 null
   */
  getTask(input: ChatAgentGetTaskInput): ChatAgentGetTaskResult;
  /** @returns 所有公开 pending confirmation 投影。 */
  listConfirmations(): ChatAgentConfirmationSnapshot[];
  /**
   * 使用 Renderer 观察版本决议 confirmation。
   * @param input - 最小 CAS 输入
   * @returns 权威 confirmation 投影
   */
  resolveConfirmation(input: ChatAgentResolveConfirmationInput): ChatAgentConfirmationSnapshot;
  /**
   * 持久化 cooperative cancellation 并安全终态化 source assistant。
   * @param input - 最小取消输入
   * @returns 当前公开 Checkpoint 投影
   */
  cancelCheckpoint(input: ChatAgentCancelCheckpointInput): Promise<ChatAgentCheckpointSnapshot>;
  /**
   * 取消当前 Session 内一个 Task。
   * @param input - Session 与 Task 身份
   * @returns Coordinator 清理后的权威 Summary
   */
  cancelTask(input: ChatAgentCancelTaskInput): Promise<ChatAgentCancelTaskResult>;
  /**
   * 由可信 Main 协调器使用稳定机器原因持久化 cooperative cancellation。
   * @param checkpointId - 目标 Checkpoint
   * @param reason - 不依赖展示文本的机器原因
   * @returns 当前公开 Checkpoint 投影
   */
  cancelInternal(checkpointId: string, reason: string): ChatAgentCheckpointSnapshot;
  /**
   * 读取进程内 allowlist continuation context。
   * @param checkpointId - Checkpoint ID
   * @returns 不可变上下文 clone
   */
  getContinuationContext(checkpointId: string): ContinuationRuntimeContext | undefined;
  /**
   * 启动时撤销无 journal write confirmation、清理 overlay 并中断不可恢复聚合。
   * @returns 被中断的 Checkpoint 数
   */
  recoverInterruptedWrites(recoveryResults: readonly AgentJournalRecoveryResult[]): Promise<number>;
  /**
   * 启动时中断无法跨进程恢复的 Checkpoint。
   * @returns 被中断的 Checkpoint 数
   */
  interruptUnrecoverableCheckpoints(): number;
  /**
   * 启动时补偿已持久化 cancelled Checkpoint 的 assistant、预算与 fence 收尾。
   * @returns 本进程确认完成收尾的 Checkpoint 数
   */
  recoverCancellations(): number;
  /**
   * 在服务边界内终态化安全取消 journal，并发布同一持久化 Checkpoint。
   * @param input - journal 身份与终态时间
   * @returns 已持久化 Checkpoint
   */
  finalizeCommitCancellation(input: FinalizeAgentCommitCancellationInput): AgentCheckpointRecord;
  /**
   * 发布 FileCommitter 已原子收敛的失败 Checkpoint，并排队其 ready Outbox。
   * @param checkpoint - 已持久化 Checkpoint
   */
  publishCommitCheckpoint(checkpoint: AgentCheckpointRecord): void;
  /** 重放全部待交付 Outbox，并等待强制内部消费者接受。 */
  drainOutbox(): Promise<void>;
}

/** 可直接抛给 Runtime 的结构化委派错误。 */
class ChatAgentDelegationError extends Error implements AgentTaskError {
  /** 稳定机器错误码。 */
  readonly code: AgentTaskError['code'];

  /** 错误阶段。 */
  readonly phase: AgentTaskError['phase'];

  /** 错误分类。 */
  readonly category: AgentTaskError['category'];

  /** 是否允许重试。 */
  readonly retryable: boolean;

  /** allowlist 机器详情。 */
  readonly details?: AgentTaskError['details'];

  /**
   * 创建结构化委派错误。
   * @param error - 已校验 Agent 错误
   */
  constructor(error: AgentTaskError) {
    super(error.message ?? error.code);
    this.name = 'ChatAgentDelegationError';
    this.code = error.code;
    this.phase = error.phase;
    this.category = error.category;
    this.retryable = error.retryable;
    this.details = error.details;
  }
}

/**
 * 创建恢复阶段协议错误。
 * @param checkpointId - Checkpoint ID
 * @param reason - 稳定机器原因
 * @returns 可抛出的错误
 */
function createFenceError(checkpointId: string, reason: string): ChatAgentDelegationError {
  return new ChatAgentDelegationError({
    code: 'protocol_error',
    phase: 'recovery',
    category: 'protocol',
    retryable: false,
    message: '无法为已提交委派取得 continuation fence',
    details: { checkpointId, reason }
  });
}

/**
 * 从 resolved model 构造无凭据模型快照。
 * @param input - prepare 输入
 * @returns 模型快照
 */
function createModelSnapshot(input: ChatRuntimeDelegationPrepareInput): AgentModelSnapshot {
  const resolution = input.runtime.resolvedModel;
  const providerId = resolution?.createOptions.providerId?.trim();
  const modelId = resolution?.modelId.trim();
  if (!providerId || !modelId) {
    throw new ChatAgentDelegationError({
      code: 'protocol_error',
      phase: 'recovery',
      category: 'protocol',
      retryable: false,
      message: '委派挂起前必须冻结实际模型',
      details: { reason: 'resolved_model_missing', runtimeId: input.runtime.runtimeId }
    });
  }
  return { providerId, modelId };
}

/**
 * 按 allowlist 构造进程内 continuation context。
 * @param input - prepare 输入
 * @param modelSnapshot - 已冻结模型身份
 * @returns 不含 Provider 凭据的上下文
 */
function createRuntimeContext(input: ChatRuntimeDelegationPrepareInput, modelSnapshot: AgentModelSnapshot): ContinuationRuntimeContext {
  const { runtime } = input;
  return structuredClone({
    clientId: runtime.clientId,
    modelSnapshot,
    toolSchemaSnapshot: structuredClone(runtime.tools ?? []),
    ...(runtime.contextWindow ? { contextWindow: runtime.contextWindow } : {}),
    ...(runtime.system ? { system: runtime.system } : {}),
    ...(runtime.workspaceRoot ? { workspaceRoot: runtime.workspaceRoot } : {}),
    ...(runtime.capabilities ? { capabilities: runtime.capabilities } : {}),
    ...(runtime.skillContentHashes ? { skillContentHashes: runtime.skillContentHashes } : {}),
    ...(runtime.runtimeContext ? { runtimeContext: runtime.runtimeContext } : {})
  });
}

/**
 * 投影为与 SQLite JSON 持久化一致的快照，移除可选字段中的 undefined。
 * @param value - 结构化克隆安全输入
 * @returns 仅含 JSON 值的快照
 */
function createJsonSnapshot(value: unknown): unknown {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new ChatAgentDelegationError({
      code: 'protocol_error',
      phase: 'recovery',
      category: 'protocol',
      retryable: false,
      message: '委派快照无法转换为 JSON',
      details: { reason: 'delegation_snapshot_not_json' }
    });
  }
  return JSON.parse(serialized) as unknown;
}

/**
 * 校验 Primary Runtime A 身份边界。
 * @param input - prepare 输入
 */
function assertPrimaryRuntime(input: ChatRuntimeDelegationPrepareInput): void {
  if (input.runtime.agentId === 'primary' && !input.runtime.parentAgentId) return;
  throw new ChatAgentDelegationError({
    code: 'capability_denied',
    phase: 'contract_validation',
    category: 'policy',
    retryable: false,
    message: '只有顶层 Primary Runtime 可以创建 Child 委派',
    details: { reason: 'delegation_caller_not_primary', runtimeId: input.runtime.runtimeId }
  });
}

/**
 * 验证单个 deferred 调用并创建 Task 持久化输入。
 * @param input - prepare 输入
 * @param checkpointId - Checkpoint ID
 * @param index - 有序调用索引
 * @param createId - ID 生成器
 * @returns Task、规范化契约和 ordered-call 链接
 */
function createTaskFacts(
  input: ChatRuntimeDelegationPrepareInput,
  checkpointId: string,
  index: number,
  createId: ChatAgentDelegationServiceDependencies['createId']
): { task: PrepareAgentTaskInput; contract: Readonly<DelegateTaskInput>; orderedCall: AgentOrderedToolCallSnapshot } {
  const deferredCall = input.suspension.toolCalls[index];
  if (!deferredCall) throw createFenceError(checkpointId, 'deferred_call_missing');
  const validation = validateFoundationContract(deferredCall.input);
  if (!validation.ok) throw new ChatAgentDelegationError(validation.error);
  const taskId = createId('task', index + 1);
  const agentId = createId('child', index + 1);
  return {
    task: {
      taskId,
      sessionId: input.runtime.sessionId,
      turnId: input.runtime.turnId,
      agentId,
      parentAgentId: input.runtime.agentId,
      rootRuntimeId: input.runtime.rootRuntimeId,
      checkpointId,
      toolCallId: deferredCall.toolCallId,
      contractSnapshot: validation.contractSnapshot,
      contractSnapshotHash: validation.contractSnapshotHash,
      priority: validation.contract.priority,
      ...(validation.contract.deadlineAt ? { deadlineAt: validation.contract.deadlineAt } : {})
    },
    contract: validation.contract,
    orderedCall: {
      toolCallId: deferredCall.toolCallId,
      taskId,
      required: validation.contract.required,
      argumentsHash: deferredCall.argumentsHash,
      providerMetadataHash: deferredCall.providerMetadataHash ?? hashAgentPayload(null)
    }
  };
}

/**
 * 投影 Renderer 可见的 Checkpoint allowlist。
 * @param checkpoint - 完整内部 Checkpoint
 * @param checkpointSequence - 持久化事件 cursor
 * @returns 不含 continuation 与 Child 结果的公开投影
 */
function projectCheckpoint(checkpoint: AgentCheckpointRecord, checkpointSequence: number): ChatAgentCheckpointSnapshot {
  return Object.freeze({
    checkpointId: checkpoint.checkpointId,
    sessionId: checkpoint.sessionId,
    turnId: checkpoint.turnId,
    primaryAgentId: checkpoint.primaryAgentId,
    rootRuntimeId: checkpoint.rootRuntimeId,
    sourceRuntimeId: checkpoint.sourceRuntimeId,
    status: checkpoint.status,
    version: checkpoint.version,
    ...(checkpoint.resumeRuntimeId ? { resumeRuntimeId: checkpoint.resumeRuntimeId } : {}),
    checkpointSequence,
    createdAt: checkpoint.createdAt,
    updatedAt: checkpoint.updatedAt
  });
}

/**
 * 从 Checkpoint 不可变身份派生 Primary Runtime B 地址。
 * @param checkpoint - 已 claim Checkpoint
 * @param runtimeId - Checkpoint 绑定的 Runtime B
 * @returns 完整 Runtime 地址
 */
function createResumeAddress(checkpoint: AgentCheckpointRecord, runtimeId: string): ChatRuntimeAddress {
  return Object.freeze({
    sessionId: checkpoint.sessionId,
    turnId: checkpoint.turnId,
    agentId: checkpoint.primaryAgentId,
    runtimeId,
    parentRuntimeId: checkpoint.sourceRuntimeId,
    rootRuntimeId: checkpoint.rootRuntimeId,
    continuationOfRuntimeId: checkpoint.sourceRuntimeId
  });
}

/**
 * 判断 Checkpoint 是否已经形成可幂等观察的终态。
 * @param status - Checkpoint 状态
 * @returns 是否为 settled resume 结果
 */
function isSettledStatus(
  status: AgentCheckpointRecord['status']
): status is Extract<AgentCheckpointRecord['status'], 'completed' | 'failed' | 'cancelled' | 'interrupted'> {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
}

/** Child Runtime 允许进入冻结计划的本地 pure-read 与 staged-file 工具。 */
const CHILD_TOOL_NAMES = new Set(['glob', 'grep', 'read_directory', 'read_file', 'stage_file_edit', 'stage_file_write']);

/** Main-owned 单 Turn Child/Primary 共享 token ceiling。 */
const DEFAULT_TURN_BUDGET: AgentBudgetSnapshot = Object.freeze({
  tokenLimit: 32_768,
  costLimitUsd: 0,
  pricingVersion: 'unknown'
});

/** 首版单个 Child Task 的最大 token 预留。 */
const DEFAULT_CHILD_BUDGET: AgentBudgetSnapshot = Object.freeze({
  tokenLimit: 4_096,
  costLimitUsd: 0,
  pricingVersion: 'unknown'
});

/**
 * 在层级预算账本接入前拒绝生产默认授权。
 * @param task - 当前 Task
 * @param checkpoint - 当前 Checkpoint
 * @param context - 已校验冻结上下文
 * @returns 不会返回；必须由 Main 注入可信权限与预算提供器
 */
function resolveDefaultLimits(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, context: ContinuationRuntimeContext): ChatAgentReadPlanLimits {
  const hasFrozenAuthority = task.checkpointId === checkpoint.checkpointId && checkpoint.status === 'waiting_children' && Boolean(context.workspaceRoot);
  throw new ChatAgentDelegationError({
    code: 'capability_denied',
    phase: 'plan_validation',
    category: 'policy',
    retryable: false,
    message: '层级预算与父权限提供器尚未接入，默认授权保持关闭',
    details: {
      reason: hasFrozenAuthority ? 'plan_budget_allocator_unavailable' : 'plan_parent_authority_invalid',
      taskId: task.taskId,
      checkpointId: checkpoint.checkpointId
    }
  });
}

/**
 * 使用主进程 registry、scope resolver 与显式 policy 编译计划。
 * @param input - 持久化事实和可信当前上限
 * @returns 已冻结计划或结构化错误
 */
function compileDefaultPlan(input: AgentPlanCompileInput): AgentPlanCompileResult {
  return compileAgentPlan(input, {
    resolveScopes: resolveAgentScopes,
    getToolEntry: getToolRegistryEntry,
    isToolAllowed: (toolName: string): boolean => CHILD_TOOL_NAMES.has(toolName),
    // 当前输入本身来自一次已发生的 delegate_task tool-call，因此冻结模型已证明支持工具调用。
    isModelToolCapable: (): boolean => input.checkpoint.continuationSnapshot.orderedToolCalls.length > 0
  });
}

/**
 * 创建 Child Agent 委派服务。
 * @param dependencies - 同步 Store、共享锁和事件依赖
 * @returns 委派服务
 */
export function createChatAgentDelegationService(dependencies: ChatAgentDelegationServiceDependencies): ChatAgentDelegationService {
  const continuationContexts = new Map<string, ContinuationRuntimeContext>();
  const fenceHandles = new Map<string, RuntimeContinuationFenceHandle>();
  const deliveryInFlight = new Map<string, Promise<void>>();
  let deliveryTail = Promise.resolve();

  /**
   * 读取已接线的 Main-owned confirmation queue。
   * @returns confirmation queue
   */
  function getConfirmationQueue(): AgentConfirmationQueue {
    if (dependencies.confirmationQueue) return dependencies.confirmationQueue;
    throw createFenceError('confirmation-queue', 'confirmation_queue_unavailable');
  }

  /**
   * 按当前持久化 Checkpoint 状态判断 Outbox 是否仍可交付。
   * @param outbox - 待交付事实
   * @returns 中断、终态或 tombstone 聚合一律不可继续消费旧事件
   */
  function isOutboxEligible(outbox: AgentOutboxRecord): boolean {
    const checkpoint = dependencies.store.getCheckpoint(outbox.payload.checkpointId);
    if (!checkpoint || checkpoint.recordState !== 'active') return false;
    if (outbox.eventType === 'delegation.created') return checkpoint.status === 'waiting_children';
    return checkpoint.status === 'ready_to_resume';
  }

  /**
   * 先交付强制 Main 内部消费者，再发布 Renderer 投影并确认 Outbox。
   * @param outbox - 已持久化 Outbox
   */
  async function deliverOutbox(outbox: AgentOutboxRecord): Promise<void> {
    if (outbox.deliveryStatus === 'delivered' || !isOutboxEligible(outbox)) return;
    const existing = deliveryInFlight.get(outbox.outboxId);
    if (existing) return existing;
    const delivery = (async (): Promise<void> => {
      if (dependencies.dispatchInternal) {
        if (outbox.eventType === 'delegation.created') {
          await dependencies.dispatchInternal('delegation.created', outbox.payload);
        } else {
          await dependencies.dispatchInternal('delegation.ready', outbox.payload);
        }
      }
      if (!isOutboxEligible(outbox)) return;
      if (outbox.eventType === 'delegation.created') {
        dependencies.publish('delegation.created', outbox.payload);
      } else {
        dependencies.publish('delegation.ready', outbox.payload);
      }
      dependencies.store.markOutboxDelivered({
        outboxId: outbox.outboxId,
        deliveredAt: dependencies.now()
      });
    })().finally((): void => {
      deliveryInFlight.delete(outbox.outboxId);
    });
    deliveryInFlight.set(outbox.outboxId, delivery);
    return delivery;
  }

  /**
   * 后台尝试交付 Outbox；失败记录保持 pending，供恢复流程重放。
   * @param outbox - 已持久化 Outbox
   */
  function queueOutbox(outbox: AgentOutboxRecord): void {
    const scheduled = deliveryTail.then((): Promise<void> => deliverOutbox(outbox));
    deliveryTail = scheduled.catch((): void => {
      // transactional Outbox 失败时不修改交付状态，后续按 dedupeKey 重放。
    });
  }

  /**
   * 读取 Checkpoint 事务内创建的 delegation.ready Outbox。
   * @param checkpoint - 已 ready 的 Checkpoint
   * @returns 对应待交付或已交付 Outbox
   */
  function findReadyOutbox(checkpoint: AgentCheckpointRecord): AgentOutboxRecord {
    const readyOutbox = dependencies.store.getOutbox(`delegation.ready:${checkpoint.checkpointId}`);
    if (!readyOutbox || readyOutbox.eventType !== 'delegation.ready') {
      throw new ChatAgentDelegationError({
        code: 'protocol_error',
        phase: 'recovery',
        category: 'protocol',
        retryable: false,
        message: 'Ready Checkpoint is missing its transactional Outbox fact',
        details: { reason: 'delegation_ready_outbox_missing', checkpointId: checkpoint.checkpointId }
      });
    }
    return readyOutbox;
  }

  /**
   * 在 Checkpoint 已安全终态化后释放内存上下文与 fence。
   * @param checkpointId - 已完成或失败的 Checkpoint
   */
  function releaseContinuation(checkpointId: string): void {
    const fence = fenceHandles.get(checkpointId);
    if (fence) {
      fence.release();
      fenceHandles.delete(checkpointId);
    }
    continuationContexts.delete(checkpointId);
  }

  /**
   * 读取 Checkpoint 当前持久化事件 cursor。
   * @param checkpointId - Checkpoint ID
   * @returns 最新 sequence
   */
  function readCheckpointSequence(checkpointId: string): number {
    return dependencies.store.listEvents('checkpoint', checkpointId).at(-1)?.sequence ?? 0;
  }

  /**
   * 构造并广播公开 Checkpoint application event。
   * @param checkpoint - 已持久化 Checkpoint
   * @returns 同一份公开投影
   */
  function publishCheckpointSnapshot(checkpoint: AgentCheckpointRecord): ChatAgentCheckpointSnapshot {
    const snapshot = projectCheckpoint(checkpoint, readCheckpointSequence(checkpoint.checkpointId));
    try {
      dependencies.publishCheckpoint({
        schemaVersion: 1,
        type: 'checkpoint.updated',
        checkpoint: snapshot,
        checkpointSequence: snapshot.checkpointSequence
      });
    } catch {
      // application event 是可通过 listActive 补偿的投影，发布失败不能回滚持久化事实。
    }
    return snapshot;
  }

  /**
   * 发布 commit 终态化后的持久化 Checkpoint，并驱动 ready Outbox。
   * @param checkpoint - 已持久化 Checkpoint
   */
  function publishCommitCheckpoint(checkpoint: AgentCheckpointRecord): void {
    publishCheckpointSnapshot(checkpoint);
    if (checkpoint.status === 'ready_to_resume') queueOutbox(findReadyOutbox(checkpoint));
  }

  /**
   * 终态化安全取消 journal，并从持久化结果驱动公开投影与 ready 交付。
   * @param input - journal 身份与终态时间
   * @returns 已持久化 Checkpoint
   */
  function finishCommitCancel(input: FinalizeAgentCommitCancellationInput): AgentCheckpointRecord {
    const checkpoint = dependencies.store.finalizeCommitCancellation(input);
    publishCommitCheckpoint(checkpoint);
    return checkpoint;
  }

  /**
   * 校验易失上下文仍与不可变 Continuation Snapshot 一致。
   * @param checkpoint - 已 claim Checkpoint
   * @param context - 进程内 allowlist 上下文
   */
  function assertResumeContext(
    checkpoint: AgentCheckpointRecord,
    context: ContinuationRuntimeContext | undefined
  ): asserts context is ContinuationRuntimeContext {
    if (!context) throw createFenceError(checkpoint.checkpointId, 'continuation_context_missing');
    const snapshot = checkpoint.continuationSnapshot;
    const modelMatches =
      context.modelSnapshot.providerId === snapshot.modelSnapshot.providerId && context.modelSnapshot.modelId === snapshot.modelSnapshot.modelId;
    const contextHash = hashAgentPayload(createJsonSnapshot(context));
    const toolSchemaHash = hashAgentPayload(createJsonSnapshot(context.toolSchemaSnapshot));
    if (
      !modelMatches ||
      contextHash !== snapshot.continuationContextHash ||
      toolSchemaHash !== snapshot.toolSchemaSnapshotHash ||
      context.toolSchemaSnapshot.some((tool): boolean => tool.name === 'delegate_task') === false
    ) {
      throw createFenceError(checkpoint.checkpointId, 'continuation_context_hash_mismatch');
    }
  }

  /**
   * CAS claim 当前 ready Checkpoint 的唯一 Runtime B。
   * @param checkpointId - Checkpoint ID
   * @returns claim 成功后的 Checkpoint
   */
  function claimPrimaryResume(checkpointId: string): AgentCheckpointRecord | null {
    const checkpoint = dependencies.store.getCheckpoint(checkpointId);
    if (!checkpoint || checkpoint.status !== 'ready_to_resume' || checkpoint.recordState !== 'active') return null;
    // 易失上下文必须在 CAS 前通过不可变快照校验，避免把不可启动事实推进到 resuming。
    assertResumeContext(checkpoint, continuationContexts.get(checkpoint.checkpointId));
    const resumeRuntimeId = dependencies.createId('runtime', 1);
    return dependencies.store.claimResume({
      checkpointId: checkpoint.checkpointId,
      expectedVersion: checkpoint.version,
      resumeRuntimeId,
      occurredAt: dependencies.now()
    });
  }

  /**
   * claim、启动并终态化唯一 Primary Runtime B。
   * @param checkpointId - ready Checkpoint
   * @returns 本次调用是否取得 claim
   */
  async function finalizePrimaryResume(claimed: AgentCheckpointRecord, completion: Promise<ChatAgentPrimaryContinuationResult>): Promise<void> {
    const runtimeResult = await completion;
    if (runtimeResult.outcome === 'failed') {
      const validatedError = validateAgentTaskError(runtimeResult.error);
      if (!validatedError || validatedError.phase !== runtimeResult.phase || !['runtime_start_failed', 'runtime_failed'].includes(validatedError.code)) {
        throw createFenceError(claimed.checkpointId, 'continuation_failure_result_invalid');
      }
    }
    if (!claimed.resumeRuntimeId) throw createFenceError(claimed.checkpointId, 'resume_runtime_missing');
    const finalized = dependencies.store.finalizeResume({
      checkpointId: claimed.checkpointId,
      expectedVersion: claimed.version,
      resumeRuntimeId: claimed.resumeRuntimeId,
      outcome: runtimeResult.outcome,
      occurredAt: dependencies.now(),
      ...(runtimeResult.outcome === 'failed' ? { error: runtimeResult.error } : {})
    });
    const [budgetRelease] = await Promise.allSettled([
      Promise.resolve().then((): void => {
        dependencies.budgetLedger?.releaseCheckpoint(claimed.checkpointId);
      })
    ]);
    // finalize 成功证明 assistant 已安全终态化；预算释放失败留给恢复，但不能继续占用 history fence。
    releaseContinuation(claimed.checkpointId);
    publishCheckpointSnapshot(finalized);
    if (budgetRelease.status === 'rejected') throw budgetRelease.reason;
  }

  /**
   * CAS claim 并启动唯一 Primary Runtime B，不等待模型完成。
   * @param input - Renderer 的身份提议与观察版本
   * @returns 启动确认或已存在的权威 Runtime 地址
   */
  async function resumePrimary(input: ChatAgentResumePrimaryInput): Promise<ChatAgentResumeResult> {
    const current = dependencies.store.getCheckpoint(input.checkpointId);
    if (!current || current.recordState !== 'active') {
      throw new ChatAgentDelegationError({
        code: 'protocol_error',
        phase: 'recovery',
        category: 'protocol',
        retryable: false,
        message: 'Checkpoint 不存在或已删除',
        details: { reason: 'checkpoint_not_found', checkpointId: input.checkpointId }
      });
    }
    if (current.status === 'resuming' && current.resumeRuntimeId) {
      const checkpoint = projectCheckpoint(current, readCheckpointSequence(current.checkpointId));
      return {
        status: 'already_started',
        checkpoint,
        address: createResumeAddress(current, current.resumeRuntimeId)
      };
    }
    if (isSettledStatus(current.status)) {
      const checkpoint = Object.freeze({
        ...projectCheckpoint(current, readCheckpointSequence(current.checkpointId)),
        status: current.status
      });
      return {
        status: 'settled',
        checkpoint,
        ...(current.resumeRuntimeId ? { address: createResumeAddress(current, current.resumeRuntimeId) } : {})
      };
    }
    if (current.status !== 'ready_to_resume' || current.version !== input.expectedVersion) {
      throw new ChatAgentDelegationError({
        code: 'protocol_error',
        phase: 'recovery',
        category: 'protocol',
        retryable: true,
        message: 'Checkpoint 状态或版本已变化',
        details: {
          reason: 'checkpoint_resume_conflict',
          checkpointId: input.checkpointId,
          status: current.status,
          expectedVersion: input.expectedVersion,
          actualVersion: current.version
        }
      });
    }
    assertResumeContext(current, continuationContexts.get(current.checkpointId));
    const claimed = dependencies.store.claimResume({
      checkpointId: current.checkpointId,
      expectedVersion: input.expectedVersion,
      resumeRuntimeId: input.resumeRuntimeId,
      occurredAt: dependencies.now()
    });
    if (!claimed?.resumeRuntimeId) {
      const winner = dependencies.store.getCheckpoint(input.checkpointId);
      if (winner?.status === 'resuming' && winner.resumeRuntimeId) {
        return {
          status: 'already_started',
          checkpoint: projectCheckpoint(winner, readCheckpointSequence(winner.checkpointId)),
          address: createResumeAddress(winner, winner.resumeRuntimeId)
        };
      }
      throw createFenceError(input.checkpointId, 'resume_claim_conflict');
    }
    const { resumeRuntimeId } = claimed;
    const context = continuationContexts.get(claimed.checkpointId);
    assertResumeContext(claimed, context);
    const snapshot = publishCheckpointSnapshot(claimed);
    // completion rejection 表示 Runtime 未能证明失败 assistant 已安全持久化，必须保留 resuming 与 fence。
    const completion = dependencies.startPrimaryContinuation({
      checkpoint: claimed,
      runtimeId: resumeRuntimeId,
      context: structuredClone(context)
    });
    finalizePrimaryResume(claimed, completion).catch((): void => {
      // 未能安全终态化时保留 resuming、易失上下文与 continuation fence，等待恢复流程介入。
      console.error(`[chat-agent-resume-finalize] checkpointId=${claimed.checkpointId}`);
    });
    return {
      status: 'started',
      checkpoint: snapshot,
      address: createResumeAddress(claimed, resumeRuntimeId)
    };
  }

  /**
   * 编译并原子授权一个 created Task。
   * @param taskId - 目标 Task
   * @returns queued(start) Task
   */
  function authorizeTask(taskId: string): AgentTaskRecord {
    const normalizedTaskId = taskId.trim();
    const task = normalizedTaskId ? dependencies.store.getTask(normalizedTaskId) : null;
    const checkpoint = task ? dependencies.store.getCheckpoint(task.checkpointId) : null;
    if (!task || !checkpoint) {
      throw new ChatAgentDelegationError({
        code: 'protocol_error',
        phase: 'plan_validation',
        category: 'protocol',
        retryable: false,
        message: 'Task 或所属 Checkpoint 不存在',
        details: { reason: 'authorization_context_missing', taskId: normalizedTaskId }
      });
    }
    if (task.contractSnapshot.mode === 'write' && dependencies.featureConfig?.controlledWriteChildEnabled !== true) {
      throw new ChatAgentDelegationError({
        code: 'capability_denied',
        phase: 'plan_validation',
        category: 'policy',
        retryable: false,
        message: '受控写入 Child 尚未由主进程启用',
        details: { reason: 'controlled_write_child_disabled', taskId: task.taskId }
      });
    }
    const context = continuationContexts.get(checkpoint.checkpointId);
    assertResumeContext(checkpoint, context);
    if (!context.workspaceRoot) {
      throw new ChatAgentDelegationError({
        code: 'resource_scope_invalid',
        phase: 'resource_validation',
        category: 'resource',
        retryable: false,
        message: 'Child Task 缺少冻结工作区',
        details: { reason: 'workspace_root_missing', taskId: task.taskId }
      });
    }

    const limitsResolver = dependencies.resolveReadLimits ?? resolveDefaultLimits;
    const compiler = dependencies.compileReadPlan ?? compileDefaultPlan;
    const limits = limitsResolver(task, checkpoint, context);
    const compiled = compiler({
      task,
      checkpoint,
      parentToolNames: context.toolSchemaSnapshot.map((tool): string => tool.name),
      availableToolNames: limits.availableToolNames,
      permissionScopeIds: limits.permissionScopeIds,
      workspaceRoot: context.workspaceRoot,
      budget: limits.budget
    });
    if (!compiled.ok) throw new ChatAgentDelegationError(compiled.error);
    dependencies.budgetLedger?.reserveTask(task.taskId, compiled.plan.budget);
    try {
      return dependencies.store.authorizeTask({
        taskId: task.taskId,
        executionPlanSnapshot: compiled.plan,
        executionPlanSnapshotHash: compiled.plan.planHash,
        occurredAt: dependencies.now(),
        source: 'coordinator'
      });
    } catch (error) {
      dependencies.budgetLedger?.releaseTask(task.taskId);
      throw error;
    }
  }

  /**
   * 返回所有公开非终态 Checkpoint 投影。
   * @returns 按 Store 顺序排列的 allowlist 快照
   */
  function listActive(): ChatAgentCheckpointSnapshot[] {
    return dependencies.store.listActive().map((recovery): ChatAgentCheckpointSnapshot => projectCheckpoint(recovery.checkpoint, recovery.eventSequence));
  }

  /**
   * 使用 Main-owned Projector 查询当前 Session Task 页。
   * @param input - Session、游标和页大小
   * @returns 公开轻量 Task 页
   */
  function listTasks(input: ChatAgentListTasksInput): ChatAgentListTasksResult {
    return dependencies.taskProjector.listTasks(input);
  }

  /**
   * 使用 Main-owned Projector 定向查询 Task。
   * @param input - Session 与 Task 身份
   * @returns 公开 Detail/Tombstone 或 null
   */
  function getTask(input: ChatAgentGetTaskInput): ChatAgentGetTaskResult {
    return dependencies.taskProjector.projectDetail(input.sessionId, input.taskId);
  }

  /**
   * 校验取消响应仍属于命令开始时的同一公开 Task。
   * @param baseline - 命令前权威 Summary
   * @param updated - Coordinator 完成后重新投影的 Summary
   */
  function assertCancelSummary(
    baseline: ChatAgentTaskSummarySnapshot,
    updated: ChatAgentTaskEventSnapshot | null
  ): asserts updated is ChatAgentTaskSummarySnapshot {
    if (
      !updated ||
      updated.recordState !== 'active' ||
      updated.taskId !== baseline.taskId ||
      updated.sessionId !== baseline.sessionId ||
      updated.turnId !== baseline.turnId ||
      updated.checkpointId !== baseline.checkpointId ||
      updated.assistantMessageId !== baseline.assistantMessageId ||
      updated.toolCallId !== baseline.toolCallId ||
      updated.agentId !== baseline.agentId ||
      updated.taskSequence < baseline.taskSequence
    ) {
      throw createProjectorError('agent_task_cancel_projection_invalid');
    }
  }

  /**
   * 等待 Coordinator 取消一个 Session-bound Task，再返回重新投影的 Summary。
   * @param input - Session 与 Task 身份
   * @returns 不包含 Detail 的权威结果
   */
  async function cancelTask(input: ChatAgentCancelTaskInput): Promise<ChatAgentCancelTaskResult> {
    const baseline = dependencies.taskProjector.projectSummary(input.taskId);
    if (!baseline || baseline.recordState !== 'active' || baseline.sessionId !== input.sessionId) throw createTaskNotFound();
    if (!dependencies.cancelTaskExecution) throw createProjectorError('agent_task_cancel_unavailable');
    const disposition = await dependencies.cancelTaskExecution(input.taskId);
    const updated = dependencies.taskProjector.projectSummary(input.taskId);
    assertCancelSummary(baseline, updated);
    if (disposition !== 'already_settled' && !updated.cancellation) {
      throw createProjectorError('agent_task_cancel_projection_invalid');
    }
    return Object.freeze({
      disposition,
      task: updated
    });
  }

  /**
   * 返回所有公开 pending confirmation 投影。
   * @returns Main 持久化事实的 allowlist 快照
   */
  function listConfirmations(): ChatAgentConfirmationSnapshot[] {
    return getConfirmationQueue().listPending();
  }

  /**
   * 通过 Main-owned queue 执行 confirmation CAS。
   * @param input - Renderer 最小决议输入
   * @returns 权威 allowlist 快照
   */
  function resolveConfirmation(input: ChatAgentResolveConfirmationInput): ChatAgentConfirmationSnapshot {
    return getConfirmationQueue().resolve(input);
  }

  /**
   * 终态化 cancelled Checkpoint 的 source assistant、预算和 continuation fence。
   * @param checkpoint - Store 已持久化的 cancelled Checkpoint
   */
  function finishCancellation(checkpoint: AgentCheckpointRecord): AgentCheckpointRecord {
    const persisted = dependencies.store.getCheckpoint(checkpoint.checkpointId);
    const current = persisted?.status === 'cancelled' ? persisted : checkpoint;
    if (current.cancellationFinalizedAt) return current;
    const sourceAssistant = dependencies
      .readMessages(current.sessionId)
      .find((message): boolean => message.id === current.assistantMessageId && message.role === 'assistant');
    if (!sourceAssistant) {
      throw createFenceError(current.checkpointId, 'cancel_source_assistant_missing');
    }
    const interruptedAssistant = structuredClone(sourceAssistant);
    finishAssistantMessageInterrupted(interruptedAssistant);
    dependencies.persistAssistant(interruptedAssistant, current.checkpointId);
    dependencies.budgetLedger?.releaseCheckpoint(current.checkpointId);
    dependencies.publishAssistant(interruptedAssistant, current);
    releaseContinuation(current.checkpointId);
    // marker 必须最后 CAS；崩溃时宁可重放 publish，也不能遗漏 assistant、预算或 fence 补偿。
    const finalized = dependencies.store.finalizeCancellation({
      checkpointId: current.checkpointId,
      finalizedAt: dependencies.now()
    });
    return finalized;
  }

  /**
   * 使用可信机器原因持久化 cooperative cancellation，并在 Store 安全终态后关闭 source assistant。
   * @param checkpointId - 目标 Checkpoint
   * @param reason - 稳定机器原因
   * @returns 当前公开 Checkpoint
   */
  function cancelWithReason(checkpointId: string, reason: string): ChatAgentCheckpointSnapshot {
    const normalizedReason = reason.trim();
    if (!normalizedReason) throw createFenceError(checkpointId, 'cancel_reason_invalid');
    const taskIds = dependencies.store
      .listActive()
      .find((recovery): boolean => recovery.checkpoint.checkpointId === checkpointId)
      ?.tasks.map((task): string => task.taskId);
    const checkpoint = dependencies.store.cancelCheckpoint({
      checkpointId,
      reason: normalizedReason,
      occurredAt: dependencies.now()
    });
    // 先持久化 checkpoint/task cancellation intent，再撤销仍 pending 的确认。
    taskIds?.forEach((taskId): void => {
      dependencies.confirmationQueue?.revokeTask(taskId, normalizedReason);
    });
    if (checkpoint.status !== 'cancelled') {
      return publishCheckpointSnapshot(checkpoint);
    }

    const finalized = finishCancellation(checkpoint);
    return publishCheckpointSnapshot(finalized);
  }

  /**
   * 持久化 Renderer 发起的 cooperative cancellation。
   * @param input - 最小取消输入
   * @returns 当前公开 Checkpoint
   */
  async function cancelCheckpoint(input: ChatAgentCancelCheckpointInput): Promise<ChatAgentCheckpointSnapshot> {
    if (!dependencies.cancelCheckpointExecution) throw createFenceError(input.checkpointId, 'checkpoint_cancel_coordinator_unavailable');
    await dependencies.cancelCheckpointExecution(input.checkpointId, 'user_cancelled');
    const checkpoint = dependencies.store.getCheckpoint(input.checkpointId);
    if (!checkpoint || checkpoint.recordState !== 'active') throw createFenceError(input.checkpointId, 'checkpoint_not_found');
    return projectCheckpoint(checkpoint, readCheckpointSequence(checkpoint.checkpointId));
  }

  /**
   * 中断所有不能跨进程恢复的活动聚合，并维护预算与 continuation fence。
   * @returns 被中断的 Checkpoint 数
   */
  function interruptActiveCheckpoints(): number {
    const activeBeforeInterrupt = dependencies.store.listActive();
    const interruptedCount = dependencies.store.interruptActive({
      code: 'runtime_interrupted',
      phase: 'recovery',
      category: 'runtime',
      retryable: false,
      message: '主进程重启后不自动恢复模型执行',
      details: { reason: 'process_restart' }
    });
    const survivors = dependencies.store.listActive();
    const survivorIds = new Set(survivors.map((snapshot): string => snapshot.checkpoint.checkpointId));
    activeBeforeInterrupt.forEach((snapshot): void => {
      if (!survivorIds.has(snapshot.checkpoint.checkpointId)) {
        dependencies.budgetLedger?.releaseCheckpoint(snapshot.checkpoint.checkpointId);
      }
    });

    // 只有已被 Store 收敛为终态的 Checkpoint 可以释放旧 fence。
    fenceHandles.forEach((handle, checkpointId): void => {
      if (survivorIds.has(checkpointId)) return;
      handle.release();
      fenceHandles.delete(checkpointId);
    });
    continuationContexts.clear();

    // journal 阻塞的 survivor 必须继续持有或重建 fence，但绝不恢复易失 Runtime 上下文。
    survivors.forEach((snapshot): void => {
      const { checkpoint } = snapshot;
      const scope = getSessionHistoryScope(checkpoint.sessionId);
      const existingFence = dependencies.locks.getContinuationFence(scope);
      if (existingFence) {
        if (existingFence.checkpointId !== checkpoint.checkpointId) {
          throw createFenceError(checkpoint.checkpointId, 'startup_survivor_fence_conflict');
        }
        return;
      }

      const fence = dependencies.locks.acquireContinuationFence({
        scope,
        checkpointId: checkpoint.checkpointId
      });
      if (!fence) {
        throw createFenceError(checkpoint.checkpointId, 'startup_survivor_fence_conflict');
      }
      fenceHandles.set(checkpoint.checkpointId, fence);
    });
    return interruptedCount;
  }

  return {
    prepareDelegation(input: ChatRuntimeDelegationPrepareInput): ChatRuntimeDelegationPrepareAck {
      assertPrimaryRuntime(input);
      const checkpointId = input.checkpointId.trim();
      if (!checkpointId || input.suspension.toolCalls.length === 0) {
        throw createFenceError(input.checkpointId, 'delegation_prepare_identity_invalid');
      }
      const modelSnapshot = createModelSnapshot(input);
      const continuationContext = createRuntimeContext(input, modelSnapshot);
      const taskFacts = input.suspension.toolCalls.map((_toolCall, index) => createTaskFacts(input, checkpointId, index, dependencies.createId));
      const continuationSnapshot: AgentDelegationContinuationSnapshot = {
        checkpointSchemaVersion: AGENT_CHECKPOINT_SCHEMA_VERSION,
        policyVersion: AGENT_FOUNDATION_POLICY_VERSION,
        modelSnapshot,
        continuationContextReference: dependencies.createId('continuation', 1),
        continuationContextHash: hashAgentPayload(createJsonSnapshot(continuationContext)),
        sourceMessageRevision: hashAgentPayload(createJsonSnapshot(input.assistantMessage)),
        toolSchemaSnapshotHash: hashAgentPayload(createJsonSnapshot(input.runtime.tools ?? [])),
        orderedToolCalls: taskFacts.map((facts): AgentOrderedToolCallSnapshot => facts.orderedCall),
        reservedResumeBudget: {
          tokenLimit: 4096,
          costLimitUsd: 0,
          pricingVersion: 'unknown'
        },
        absoluteTurnDeadline: new Date(Date.parse(dependencies.now()) + CONTINUATION_DEADLINE_MS).toISOString()
      };
      const continuationSnapshotHash = hashContinuationSnapshot(continuationSnapshot);
      const continuationValidation = validateContinuationSnapshot(continuationSnapshot, continuationSnapshotHash);
      if (!continuationValidation.ok) throw new ChatAgentDelegationError(continuationValidation.error);
      const outboxPayload: AgentDelegationCreatedPayload = {
        checkpointId,
        sessionId: input.runtime.sessionId,
        turnId: input.runtime.turnId
      };
      const outboxId = dependencies.createId('outbox', 1);
      const occurredAt = dependencies.now();
      const prepareInput: PrepareDelegationInput = {
        tasks: taskFacts.map((facts): PrepareAgentTaskInput => facts.task),
        checkpoint: {
          checkpointId,
          sessionId: input.runtime.sessionId,
          turnId: input.runtime.turnId,
          primaryAgentId: input.runtime.agentId,
          rootRuntimeId: input.runtime.rootRuntimeId,
          sourceRuntimeId: input.runtime.runtimeId,
          assistantMessageId: input.assistantMessage.id,
          continuationSnapshot: continuationValidation.continuation,
          continuationSnapshotHash
        },
        outbox: {
          outboxId,
          dedupeKey: `delegation.created:${checkpointId}`,
          eventType: 'delegation.created',
          payload: outboxPayload,
          payloadHash: hashAgentPayload(outboxPayload),
          schemaVersion: 1
        },
        occurredAt
      };

      // Store 写入前只预留 scope；inactive reservation 不会阻止当前 Runtime 的 history 写入。
      const fenceReservation = dependencies.locks.reserveContinuationFence({
        scope: getSessionHistoryScope(input.runtime.sessionId),
        checkpointId
      });
      if (!fenceReservation) {
        throw createFenceError(checkpointId, 'continuation_fence_reservation_unavailable');
      }
      try {
        dependencies.store.prepareDelegation(prepareInput, (): undefined => {
          return dependencies.persistAssistant(structuredClone(input.assistantMessage));
        });
      } catch (error) {
        // 事务失败时没有持久化委派事实，释放 inactive reservation 即可安全重试。
        fenceReservation.release();
        throw error;
      }

      // 预留 token 在提交后同步转为 active fence，不再存在二次竞争窗口。
      const fence = fenceReservation.activate();
      fenceHandles.set(checkpointId, fence);
      continuationContexts.set(checkpointId, Object.freeze(structuredClone(continuationContext)));
      const preparedCheckpoint = dependencies.store.getCheckpoint(checkpointId);
      if (!preparedCheckpoint) throw createFenceError(checkpointId, 'prepared_checkpoint_missing');
      publishCheckpointSnapshot(preparedCheckpoint);
      const createdOutbox = dependencies.store.getOutbox(`delegation.created:${checkpointId}`);
      if (!createdOutbox || createdOutbox.eventType !== 'delegation.created' || createdOutbox.outboxId !== outboxId) {
        throw createFenceError(checkpointId, 'delegation_created_outbox_missing');
      }
      queueOutbox(createdOutbox);
      return { prepared: true };
    },

    authorizeTask,

    recordPreFailure(task: AgentTaskRecord, error: AgentTaskError): ReturnType<AgentDelegationStore['recordPreAttemptFailure']> {
      const current = dependencies.store.getTask(task.taskId);
      const validatedError = validateAgentTaskError(error);
      if (
        !current ||
        current.checkpointId !== task.checkpointId ||
        current.toolCallId !== task.toolCallId ||
        !validatedError ||
        validatedError.retryable ||
        (validatedError.phase !== 'plan_validation' && validatedError.phase !== 'resource_validation')
      ) {
        throw new ChatAgentDelegationError({
          code: 'protocol_error',
          phase: 'plan_validation',
          category: 'protocol',
          retryable: false,
          message: 'Coordinator pre-Attempt failure does not match one persisted Task',
          details: { reason: 'pre_attempt_failure_context_invalid', taskId: task.taskId, checkpointId: task.checkpointId }
        });
      }
      const checkpoint = dependencies.store.recordPreAttemptFailure({
        taskId: current.taskId,
        checkpointId: current.checkpointId,
        toolCallId: current.toolCallId,
        error: validatedError,
        occurredAt: dependencies.now()
      });
      publishCheckpointSnapshot(checkpoint);
      if (checkpoint.status === 'ready_to_resume') queueOutbox(findReadyOutbox(checkpoint));
      return checkpoint;
    },

    recordPreCancellation(
      task: AgentTaskRecord,
      requestKind: 'single_task' | 'checkpoint_cascade'
    ): ReturnType<AgentDelegationStore['recordPreAttemptCancellation']> {
      const current = dependencies.store.getTask(task.taskId);
      if (
        !current ||
        current.checkpointId !== task.checkpointId ||
        current.toolCallId !== task.toolCallId ||
        current.agentId !== task.agentId ||
        current.currentAttemptId !== undefined
      ) {
        throw new ChatAgentDelegationError({
          code: 'protocol_error',
          phase: 'queue',
          category: 'protocol',
          retryable: false,
          details: { reason: 'pre_attempt_cancel_context_invalid', taskId: task.taskId }
        });
      }
      const candidate: AgentPreAttemptCancellationResult = {
        resultKind: 'pre_attempt_cancelled',
        taskId: current.taskId,
        agentId: current.agentId,
        executionStatus: 'cancelled',
        completion: {
          level: 'none',
          criteria: current.contractSnapshot.acceptanceCriteria.map((_criterion, criterionIndex) => ({
            criterionIndex,
            claim: {
              status: 'unknown',
              summary: 'Task was cancelled before this criterion could be evaluated.',
              evidence: []
            },
            verification: {
              status: 'unverified',
              verifier: 'policy',
              evidence: []
            }
          }))
        },
        summary: 'Task was cancelled before execution.',
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
          monetaryCost: {
            currency: 'unknown',
            pricingVersion: 'unknown',
            estimated: 'unknown',
            actual: 'unknown'
          }
        },
        error: {
          code: 'cancelled',
          phase: 'queue',
          category: 'user',
          retryable: false
        }
      };
      const validation = validateAgentResult(candidate, {
        taskId: current.taskId,
        agentId: current.agentId,
        contractSnapshot: current.contractSnapshot
      });
      if (!validation.ok) throw new ChatAgentDelegationError(validation.error);
      if (!('resultKind' in validation.result) || validation.result.resultKind !== 'pre_attempt_cancelled') {
        throw createProjectorError('pre_attempt_cancel_result_invalid');
      }
      const checkpoint = dependencies.store.recordPreAttemptCancellation({
        taskId: current.taskId,
        checkpointId: current.checkpointId,
        toolCallId: current.toolCallId,
        requestKind,
        result: structuredClone(validation.result),
        resultHash: validation.resultHash,
        occurredAt: dependencies.now()
      });
      publishCheckpointSnapshot(checkpoint);
      if (checkpoint.status === 'ready_to_resume') queueOutbox(findReadyOutbox(checkpoint));
      return checkpoint;
    },

    requestTaskCancellation(taskId: string, requestKind: 'single_task' | 'checkpoint_cascade'): AgentTaskCancellationProjection {
      return dependencies.store.requestTaskCancellation({
        taskId,
        requestKind,
        occurredAt: dependencies.now()
      });
    },

    recordTaskResult(input: ChatAgentRecordTaskResultInput): ReturnType<AgentDelegationStore['recordTaskResult']> {
      const task = dependencies.store.getTask(input.taskId);
      if (!task || task.checkpointId !== input.checkpointId || task.toolCallId !== input.toolCallId || !task.currentAttemptId || !task.executionPlanSnapshot) {
        throw new ChatAgentDelegationError({
          code: 'result_evidence_invalid',
          phase: 'result_validation',
          category: 'integrity',
          retryable: false,
          message: 'Child result does not match one runnable persisted Task',
          details: { reason: 'result_task_context_invalid', taskId: input.taskId, checkpointId: input.checkpointId }
        });
      }
      const validation = validateAgentResult(input.result, {
        taskId: task.taskId,
        agentId: task.agentId,
        attemptId: task.currentAttemptId,
        contractSnapshot: task.contractSnapshot,
        executionPlanSnapshot: task.executionPlanSnapshot
      });
      if (!validation.ok) throw new ChatAgentDelegationError(validation.error);
      const occurredAt = dependencies.now();
      const checkpoint = dependencies.store.recordTaskResult({
        taskId: task.taskId,
        checkpointId: input.checkpointId,
        toolCallId: task.toolCallId,
        result: structuredClone(validation.result),
        resultHash: validation.resultHash,
        occurredAt
      });
      if (checkpoint.status === 'cancelled') {
        publishCheckpointSnapshot(checkpoint);
        return checkpoint;
      }
      publishCheckpointSnapshot(checkpoint);
      if (checkpoint.status !== 'ready_to_resume') return checkpoint;

      const readyOutbox = findReadyOutbox(checkpoint);
      queueOutbox(readyOutbox);
      return checkpoint;
    },

    claimPrimaryResume,

    resumePrimary,

    listActive,

    listTasks,

    getTask,

    cancelTask,

    listConfirmations,

    resolveConfirmation,

    cancelCheckpoint,

    cancelInternal(checkpointId: string, reason: string): ChatAgentCheckpointSnapshot {
      return cancelWithReason(checkpointId, reason);
    },

    getContinuationContext(checkpointId: string): ContinuationRuntimeContext | undefined {
      const context = continuationContexts.get(checkpointId);
      return context ? structuredClone(context) : undefined;
    },

    async recoverInterruptedWrites(recoveryResults: readonly AgentJournalRecoveryResult[]): Promise<number> {
      const activeTasks = dependencies.store.listActive().flatMap((snapshot): AgentTaskRecord[] => snapshot.tasks);
      const journalTaskIds = new Set(recoveryResults.map((result): string => result.taskId));
      const orphanWrites = activeTasks.filter(
        (task): boolean =>
          task.contractSnapshot.mode === 'write' &&
          task.unfinishedJournalCount === 0 &&
          task.currentAttemptId !== undefined &&
          !journalTaskIds.has(task.taskId) &&
          !['completed', 'failed', 'cancelled', 'deadline_exceeded', 'commit_failed', 'interrupted'].includes(task.status)
      );
      const cancelledJournals = recoveryResults.filter(
        (result): result is AgentJournalRecoveryResult & { readonly status: 'cancelled' } => result.status === 'cancelled'
      );
      orphanWrites.forEach((task): void => {
        dependencies.confirmationQueue?.revokeTask(task.taskId, 'process_restart');
      });
      const cleanupTargets = [
        ...cancelledJournals.map((result): { taskId: string; attemptId: string } => ({
          taskId: result.taskId,
          attemptId: result.attemptId
        })),
        ...orphanWrites.map((task): { taskId: string; attemptId: string } => ({
          taskId: task.taskId,
          attemptId: task.currentAttemptId as string
        }))
      ];
      if (cleanupTargets.length > 0 && !dependencies.discardTaskOverlay) {
        throw new Error('agent_overlay_cleanup_missing');
      }
      for (const cleanupTarget of cleanupTargets) {
        // Recovery cleanup stays ordered so no Task can be finalized before its exact overlay is gone.
        // eslint-disable-next-line no-await-in-loop
        await dependencies.discardTaskOverlay?.(cleanupTarget);
      }
      cancelledJournals.forEach((result): void => {
        finishCommitCancel({
          journalId: result.journalId,
          occurredAt: dependencies.now(),
          startupRecovery: true
        });
      });
      return interruptActiveCheckpoints();
    },

    interruptUnrecoverableCheckpoints(): number {
      return interruptActiveCheckpoints();
    },

    recoverCancellations(): number {
      const checkpoints = dependencies.store.listCancelledCheckpoints();
      checkpoints.forEach((checkpoint): void => {
        finishCancellation(checkpoint);
      });
      return checkpoints.length;
    },

    finalizeCommitCancellation(input: FinalizeAgentCommitCancellationInput): AgentCheckpointRecord {
      return finishCommitCancel(input);
    },

    publishCommitCheckpoint(checkpoint: AgentCheckpointRecord): void {
      publishCommitCheckpoint(checkpoint);
    },

    async drainOutbox(): Promise<void> {
      const pending = dependencies.store.listPendingOutbox();
      await pending.reduce((previous, outbox): Promise<void> => previous.then((): Promise<void> => deliverOutbox(outbox)), Promise.resolve());
    }
  };
}

/** 与聊天消息共享 SQLite 事务域的默认 Agent Store 适配器。 */
const agentStoreDatabase: AgentStoreDatabase = {
  execute(sql: string, params: readonly unknown[] = []): { changes: number; lastInsertRowid: number | bigint } {
    return dbExecute(sql, [...params]);
  },
  select<T>(sql: string, params: readonly unknown[] = []): T[] {
    return dbSelect<T>(sql, [...params]);
  },
  transaction<T>(operation: () => T): T {
    return transaction(operation);
  }
};

/**
 * 向全部应用窗口发布内部 delegation.created 投影事件。
 * @param eventType - 事件类型
 * @param payload - allowlist payload
 */
function publishDelegation(eventType: 'delegation.created' | 'delegation.ready', payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload): void {
  BrowserWindow.getAllWindows().forEach((window): void => {
    window.webContents.send('chat:agent:outbox-event', { type: eventType, payload });
  });
}

/**
 * 向全部应用窗口发布公开 Agent application event。
 * @param event - allowlist application event
 */
function publishCheckpoint(event: ChatAgentApplicationEvent): void {
  BrowserWindow.getAllWindows().forEach((window): void => {
    window.webContents.send('chat:agent:event', event);
  });
}

/**
 * 广播由 Checkpoint fence owner 终态化的 source assistant。
 * @param message - 已持久化 assistant
 * @param checkpoint - assistant 所属 Checkpoint
 */
function publishAssistant(message: ChatMessageRecord, checkpoint: AgentCheckpointRecord): void {
  BrowserWindow.getAllWindows().forEach((window): void => {
    window.webContents.send('chat:runtime:message-updated', {
      runtimeId: checkpoint.sourceRuntimeId,
      sessionId: checkpoint.sessionId,
      turnId: checkpoint.turnId,
      clientId: 'agent-continuation',
      agentId: checkpoint.primaryAgentId,
      rootRuntimeId: checkpoint.rootRuntimeId,
      message: structuredClone(message)
    });
  });
}

/** 主进程默认 Agent Store，供 Service 与 Coordinator 共享同一事实源。 */
const defaultAgentStore = createAgentDelegationStore(agentStoreDatabase);

/** 主进程默认 Task 公开投影器；未注册安全 resolver 时只保留可证明的本地文件展示。 */
const defaultTaskProjector = createAgentTaskProjector({
  store: defaultAgentStore,
  resolveResource: (): null => null,
  resolveArtifact: (): null => null
});

/** 主进程默认 post-commit Task application event Pump。 */
const defaultTaskPump = createTaskProjectionPump({
  projectSummary: (taskId): ChatAgentTaskEventSnapshot | null => defaultTaskProjector.projectSummary(taskId),
  publish: publishCheckpoint,
  reportError: (code): void => {
    console.error(code);
  }
});

/** Store 只把 committed Task 身份交给异步公开投影边界。 */
defaultAgentStore.subscribeTaskCommits((taskId): void => {
  defaultTaskPump.enqueue(taskId);
});

/** 主进程默认持久化 confirmation queue。 */
export const chatAgentConfirmationQueue = createAgentConfirmationQueue({
  store: defaultAgentStore,
  readUnifiedDiff: (reference: string): string => readFileSync(reference, 'utf8'),
  publish: publishCheckpoint,
  now: (): string => new Date().toISOString()
});

/** 主进程默认持久化 Turn/Checkpoint/Task 预算账本。 */
const defaultBudgetLedger = createAgentBudgetLedger({
  database: agentStoreDatabase,
  resolveTurnBudget: (): AgentBudgetSnapshot => DEFAULT_TURN_BUDGET,
  now: (): string => new Date().toISOString()
});

/** 主进程默认稳定 Child Actor 注册表。 */
const defaultChildRegistry = createChildActorRegistry();

/** 主进程默认 resource-scoped Child 调度器。 */
const defaultResourceScheduler = createAgentResourceScheduler();

/** 主进程默认冻结模型解析器。 */
const defaultChildModelResolver = createDefaultChatModelResolver();

/**
 * 创建并返回 Main userData 下的私有 Agent 目录。
 * @param kind - overlay 或 journal 子目录
 * @returns canonical 私有目录
 */
async function ensureAgentDirectory(kind: 'overlays' | 'journals'): Promise<string> {
  const directory = path.join(app.getPath('userData'), 'agent-runtime', kind);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return fs.realpath(directory);
}

/** 延迟创建的 durable file committer，commit 与 recover 必须共享同一 Store 和 journal 根。 */
let fileCommitterPromise: Promise<AgentFileCommitter> | null = null;

/**
 * 返回主进程共享 file committer。
 * @returns 绑定 durable journal 根的单例
 */
function getFileCommitter(): Promise<AgentFileCommitter> {
  if (!fileCommitterPromise) {
    fileCommitterPromise = ensureAgentDirectory('journals').then(
      (journalRoot): AgentFileCommitter =>
        createAgentFileCommitter({
          store: defaultAgentStore,
          journalRoot,
          now: (): string => new Date().toISOString(),
          createId: (): string => `journal-${nanoid()}`,
          // 生产 write flag 默认关闭；启用前必须把此处替换为当前权限事实，而不是恢复时猜测升级。
          getPermissionScopeIds: (): readonly string[] => []
        })
    );
  }
  return fileCommitterPromise;
}

/** 延迟解析 userData 的默认 durable file committer。 */
export const chatAgentFileCommitter: AgentFileCommitter = {
  async commit(input: AgentFileCommitInput): Promise<AgentFileCommitResult> {
    return (await getFileCommitter()).commit(input);
  },
  async cancelTask(taskId: string): ReturnType<AgentFileCommitter['cancelTask']> {
    return (await getFileCommitter()).cancelTask(taskId);
  },
  async recover(): ReturnType<AgentFileCommitter['recover']> {
    return (await getFileCommitter()).recover();
  }
};

/** 模块初始化完成后由默认内部 Outbox consumer 使用的 Coordinator。 */
let defaultCoordinator: AgentCoordinator | null = null;

/**
 * 返回当前 Main registry 中实际可执行的本地 pure-read 与 staged-file 工具。
 * @returns 已排序的安全工具集合
 */
function listChildTools(): string[] {
  return [...CHILD_TOOL_NAMES]
    .filter((toolName): boolean => {
      const entry = getToolRegistryEntry(toolName);
      return (
        entry?.runtime === 'main' && entry.executionClass === 'direct' && (entry.effect.effect === 'pure_read' || entry.effect.effect === 'staged_file_write')
      );
    })
    .sort();
}

/** 主进程默认 Child Agent 委派服务。 */
export const chatAgentDelegationService = createChatAgentDelegationService({
  store: defaultAgentStore,
  taskProjector: defaultTaskProjector,
  locks: chatRuntimeLocks,
  persistAssistant(message: ChatMessageRecord, ownerCheckpointId?: string): undefined {
    chatSessionManager.updateMessage(message, ownerCheckpointId);
    return undefined;
  },
  readMessages: (sessionId: string): ChatMessageRecord[] => chatSessionManager.getAllMessages(sessionId),
  publishAssistant,
  publish: publishDelegation,
  async dispatchInternal(
    eventType: 'delegation.created' | 'delegation.ready',
    payload: AgentDelegationCreatedPayload | AgentDelegationReadyPayload
  ): Promise<void> {
    if (!defaultCoordinator) throw new Error('agent_coordinator_not_initialized');
    if (eventType === 'delegation.created') {
      await defaultCoordinator.accept(payload as AgentDelegationCreatedPayload);
    }
  },
  publishCheckpoint,
  confirmationQueue: chatAgentConfirmationQueue,
  async discardTaskOverlay(input: { readonly taskId: string; readonly attemptId: string }): Promise<void> {
    const overlayRoot = await ensureAgentDirectory('overlays');
    await discardAgentTaskOverlay({ overlayRoot, ...input });
  },
  featureConfig: {
    enabled: process.env.TIBIS_PRIMARY_DELEGATION_ENABLED === '1',
    pureReadChildEnabled: true,
    controlledWriteChildEnabled: false,
    maxParallelReadChildren: 3
  },
  createId(kind: ChatAgentDelegationIdKind): string {
    return `${kind}-${nanoid()}`;
  },
  now: (): string => new Date().toISOString(),
  resolveReadLimits(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, context: ContinuationRuntimeContext): ChatAgentReadPlanLimits {
    if (task.checkpointId !== checkpoint.checkpointId || checkpoint.status !== 'waiting_children' || !context.workspaceRoot) {
      return resolveDefaultLimits(task, checkpoint, context);
    }
    return {
      availableToolNames: listChildTools(),
      permissionScopeIds: ['workspace:read'],
      budget: DEFAULT_CHILD_BUDGET
    };
  },
  budgetLedger: defaultBudgetLedger,
  async startPrimaryContinuation(input: ChatAgentPrimaryContinuationInput): Promise<ChatAgentPrimaryContinuationResult> {
    const { chatRuntimeService } = await import('../runtime/service.mjs');
    return chatRuntimeService.resumePrimary(input);
  },
  cancelTaskExecution(taskId: string): Promise<AgentTaskCancellationProjection['disposition']> {
    if (!defaultCoordinator) return Promise.reject(new Error('agent_coordinator_not_initialized'));
    return defaultCoordinator.cancelTask(taskId);
  },
  cancelCheckpointExecution(checkpointId: string, reason: string): Promise<void> {
    if (!defaultCoordinator) return Promise.reject(new Error('agent_coordinator_not_initialized'));
    return defaultCoordinator.cancel(checkpointId, reason);
  }
});

/** durable journal 和 orphan write 恢复完成前，默认 Coordinator 不得启动 write Runtime。 */
let controlledWriteReady = false;

/** 主进程默认无消息持久化 Child executor。 */
const defaultChildExecutor = createChildRuntimeExecutor({
  resolver: defaultChildModelResolver,
  streamText: aiService.streamText.bind(aiService),
  resolveWorkspaceRoot: (checkpointId: string): string | undefined => chatAgentDelegationService.getContinuationContext(checkpointId)?.workspaceRoot,
  resolveOverlayRoot: async (): Promise<string> => ensureAgentDirectory('overlays'),
  createOverlayId: (kind: 'changeset' | 'operation'): string => `${kind}-${nanoid()}`,
  calculateCost: (): AgentUsageAccounting['monetaryCost'] => ({
    currency: 'unknown',
    pricingVersion: 'unknown',
    estimated: 'unknown',
    actual: 'unknown'
  }),
  recordToolStarted: (input): void => {
    defaultAgentStore.recordToolStarted(input);
  },
  recordToolCompleted: (input): void => {
    defaultAgentStore.recordToolCompleted(input);
  },
  recordAttemptUsage: (input): void => {
    defaultAgentStore.recordAttemptUsage(input);
  },
  now: (): number => Date.now()
});

/** 主进程默认 Coordinator；Actor 创建和授权只消费持久化事实。 */
export const chatAgentCoordinator = createAgentCoordinator({
  listActive: () => defaultAgentStore.listActive(),
  authorizeTask: (taskId: string): AgentTaskRecord => chatAgentDelegationService.authorizeTask(taskId),
  recordPreFailure: (task: AgentTaskRecord, error: AgentTaskError): AgentCheckpointRecord => chatAgentDelegationService.recordPreFailure(task, error),
  recordPreCancellation: (task, requestKind) => chatAgentDelegationService.recordPreCancellation(task, requestKind),
  requestTaskCancellation: (taskId, requestKind) => chatAgentDelegationService.requestTaskCancellation(taskId, requestKind),
  reserveResume: (checkpointId: string, budget: AgentBudgetSnapshot): void => defaultBudgetLedger.reserveResume(checkpointId, budget),
  scheduler: defaultResourceScheduler,
  beginAttempt: (input: BeginAgentAttemptInput): AgentAttemptProjection => defaultAgentStore.beginAttempt(input),
  markAttemptRunning: (input: MarkAgentAttemptInput): AgentAttemptProjection => defaultAgentStore.markAttemptRunning(input),
  getAttempt: (attemptId: string) => defaultAgentStore.getAttempt(attemptId),
  recordAttemptUsage: (input) => defaultAgentStore.recordAttemptUsage(input),
  recordTaskResult: (task: AgentTaskRecord, result: ChatAgentResult): AgentCheckpointRecord =>
    chatAgentDelegationService.recordTaskResult({
      taskId: task.taskId,
      checkpointId: task.checkpointId,
      toolCallId: task.toolCallId,
      result
    }),
  settleTask: (taskId: string, usage: AgentUsageAccounting): void => defaultBudgetLedger.settleAttempt(taskId, usage),
  releaseBudget: (taskId: string): void => defaultBudgetLedger.releaseTask(taskId),
  executor: defaultChildExecutor,
  prepareChangeset: (input) => defaultAgentStore.prepareChangeset(input),
  confirmationQueue: chatAgentConfirmationQueue,
  isControlledWriteReady: (): boolean => controlledWriteReady,
  getConfirmation: (confirmationId: string) => defaultAgentStore.getConfirmation(confirmationId),
  getChangeset: (changesetId: string) => defaultAgentStore.getChangeset(changesetId),
  queueCommit: (input) => defaultAgentStore.queueCommit(input),
  fileCommitter: chatAgentFileCommitter,
  async discardTaskOverlay(input: { readonly taskId: string; readonly attemptId: string }): Promise<void> {
    const overlayRoot = await ensureAgentDirectory('overlays');
    await discardAgentTaskOverlay({ overlayRoot, ...input });
  },
  finalizeCommitCancellation: (input) => chatAgentDelegationService.finalizeCommitCancellation(input),
  publishCommitCheckpoint: (checkpoint) => chatAgentDelegationService.publishCommitCheckpoint(checkpoint),
  createConfirmationId: (task: AgentTaskRecord): string => `confirmation-${task.taskId}-${nanoid()}`,
  getTask: (taskId: string): AgentTaskRecord | null => defaultAgentStore.getTask(taskId),
  createRuntimeId: (task: AgentTaskRecord): string => `runtime-${task.taskId}-${nanoid()}`,
  cancelCheckpoint(checkpointId: string, reason: string): ChatAgentCheckpointSnapshot {
    if (!reason.trim()) throw new Error('agent_coordinator_cancel_reason_invalid');
    return chatAgentDelegationService.cancelInternal(checkpointId, reason);
  },
  now: (): string => new Date().toISOString(),
  registry: defaultChildRegistry
});
defaultCoordinator = chatAgentCoordinator;

/**
 * 按 durable journal、orphan write、Coordinator 的固定顺序恢复 Child Agent。
 * 任一步失败都会保持 write gate 关闭，且 Main 不会继续开放 IPC。
 */
export async function recoverChatAgentDelegations(): Promise<void> {
  controlledWriteReady = false;
  const journalResults = await chatAgentFileCommitter.recover();
  chatAgentConfirmationQueue.recover();
  await chatAgentDelegationService.recoverInterruptedWrites(journalResults);
  chatAgentDelegationService.recoverCancellations();
  defaultBudgetLedger.recoverTerminalReservations();
  controlledWriteReady = true;
  await chatAgentCoordinator.recover();
}
