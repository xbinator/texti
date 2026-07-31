/**
 * @file coordinator.mts
 * @description 消费持久化 delegation.created 事实，幂等协调只读与受控写入 Child Task。
 */
import type { ChildActorRegistry } from './child-registry.mjs';
import type { AgentConfirmationQueue } from './confirmation-store.mjs';
import type { ChildTaskRuntimeExecutor } from './executor.mjs';
import type { AgentResourceLease, AgentResourceScheduler, AgentScheduleRequest, AgentScheduleCancelDisposition } from './scheduler.mjs';
import type {
  AgentAttemptProjection,
  AgentAttemptRecord,
  AgentCheckpointRecord,
  AgentDelegationRecoverySnapshot,
  AgentTaskCancellationProjection,
  AgentTaskRecord,
  BeginAgentAttemptInput,
  MarkAgentAttemptInput,
  PrepareAgentChangesetInput,
  QueueAgentCommitInput,
  RecordAttemptUsageInput
} from './types.mjs';
import type {
  AgentBudgetSnapshot,
  AgentChangesetRecord,
  AgentCheckpointStatus,
  AgentConfirmationRecord,
  AgentConfirmationRequestSnapshot,
  AgentDelegationCreatedPayload,
  AgentTaskError,
  AgentUsageAccounting,
  AgentWriteResultDraft,
  ChatAgentResult
} from 'types/chat-agent';
import type { ChatRuntimeAddress } from 'types/chat-runtime';
import { AGENT_CONFIRMATION_SCHEMA_VERSION, hashChangesetSnapshot, hashConfirmationRequestSnapshot, validateAgentTaskError } from './contracts.mjs';
import { AgentFileCommitError, type AgentFileCommitter } from './file-commit.mjs';
import { isTaskTerminal } from './state.mjs';

/** 首版单个 Checkpoint 允许协调的最大 Task 数。 */
const MAX_CHECKPOINT_TASKS = 6;

/** 生产默认单个 Child 覆盖排队和执行的最长时间。 */
const DEFAULT_CHILD_TIMEOUT_MS = 30 * 60 * 1_000;

/** 生产默认 cooperative cancellation 宽限期。 */
const DEFAULT_CANCEL_GRACE_MS = 2_000;

/** 单次内存清理恢复 sweep 的最大尝试次数。 */
const MAX_CLEANUP_SWEEP_ATTEMPTS = 3;

/** Coordinator 对一个 Checkpoint 的进程内执行状态。 */
export type AgentCoordinatorState = 'idle' | 'planning' | 'running' | 'terminal';

/** Main-owned Coordinator 的可信依赖。 */
export interface AgentCoordinatorDependencies {
  /** @returns 全部持久化非终态 Checkpoint 聚合。 */
  listActive(): AgentDelegationRecoverySnapshot[];
  /**
   * 编译、校验并冻结一个 mode-aware Task 计划。
   * @param taskId - created Task
   * @returns queued(start) Task
   */
  authorizeTask(taskId: string): AgentTaskRecord;
  /**
   * 原子记录不含 Attempt 的授权前失败。
   * @param task - 失败所属 Task
   * @param error - 不可重试计划或资源错误
   * @returns 推进后的 Checkpoint
   */
  recordPreFailure(task: AgentTaskRecord, error: AgentTaskError): AgentCheckpointRecord;
  /**
   * 原子写入无 Attempt 取消结果并推进 Task rendezvous。
   * @param task - 取消所属 Task
   * @param requestKind - 单 Task 或 Checkpoint 级联
   * @returns 推进后的 Checkpoint
   */
  recordPreCancellation(task: AgentTaskRecord, requestKind: 'single_task' | 'checkpoint_cascade'): AgentCheckpointRecord;
  /**
   * CAS 持久化已有 Attempt Task 的 cooperative cancellation 请求。
   * @param taskId - 目标 Task
   * @param requestKind - 单 Task 或 Checkpoint 级联
   * @returns 权威取消投影
   */
  requestTaskCancellation(taskId: string, requestKind: 'single_task' | 'checkpoint_cascade'): AgentTaskCancellationProjection;
  /**
   * 在任何 Child Task 分配之前幂等预留 Primary Runtime B 预算。
   * @param checkpointId - Checkpoint 身份
   * @param budget - 冻结续接预算
   */
  reserveResume(checkpointId: string, budget: AgentBudgetSnapshot): void;
  /** 资源范围级 read/write/commit 调度器。 */
  scheduler: AgentResourceScheduler;
  /**
   * 原子创建 starting Attempt。
   * @param input - Task、Runtime 与父 Runtime 身份
   * @returns starting Task/Attempt 投影
   */
  beginAttempt(input: BeginAgentAttemptInput): AgentAttemptProjection;
  /**
   * 原子确认 Runtime 已进入 running。
   * @param input - 当前 Task/Attempt/Runtime 身份
   * @returns running Task/Attempt 投影
   */
  markAttemptRunning(input: MarkAgentAttemptInput): AgentAttemptProjection;
  /**
   * 读取当前 Attempt 的权威持久化投影。
   * @param attemptId - Attempt 身份
   * @returns 当前 Attempt，不存在时返回 null
   */
  getAttempt(attemptId: string): AgentAttemptRecord | null;
  /**
   * 在结果 rendezvous 之前冻结 Attempt 的最终完整 usage。
   * @param input - Attempt 身份与 complete usage
   * @returns 最终 usage 已持久化的 Attempt
   */
  recordAttemptUsage(input: RecordAttemptUsageInput): AgentAttemptRecord;
  /**
   * 校验并汇合一个 Child 终态结果。
   * @param task - 结果所属 Task
   * @param result - executor 或 Coordinator 生成的完整结果
   * @returns 汇合后的 Checkpoint
   */
  recordTaskResult(task: AgentTaskRecord, result: ChatAgentResult): AgentCheckpointRecord;
  /**
   * 按可信结果结算 Task 预算。
   * @param taskId - Task 身份
   * @param usage - 实际用量
   */
  settleTask(taskId: string, usage: AgentUsageAccounting): void;
  /**
   * 释放没有创建 Attempt 的 Task 预算。
   * @param taskId - Task 身份
   */
  releaseBudget(taskId: string): void;
  /** 无聊天消息持久化的 Child executor。 */
  executor: ChildTaskRuntimeExecutor;
  /**
   * 持久化 write Attempt 的不可变 changeset。
   * 只读 Coordinator 测试可省略；write Task 缺失时稳定失败。
   */
  prepareChangeset?: (input: PrepareAgentChangesetInput) => AgentChangesetRecord;
  /** write Task 的 Main-owned 持久化确认队列。 */
  confirmationQueue?: Pick<AgentConfirmationQueue, 'request' | 'invalidate' | 'revokeTask'>;
  /**
   * 判断启动恢复是否已经完成；恢复前 write Task 只能保持 queued。
   * 缺省为 true，避免改变显式隔离实例与只读 fixture。
   */
  isControlledWriteReady?: () => boolean;
  /**
   * 读取 confirmation 权威记录。
   * @param confirmationId - confirmation 身份
   * @returns 当前 CAS 记录
   */
  getConfirmation?: (confirmationId: string) => AgentConfirmationRecord | null;
  /**
   * 在 approval 后重新读取 changeset 权威状态。
   * @param changesetId - changeset 身份
   * @returns 当前 Store 投影
   */
  getChangeset?: (changesetId: string) => AgentChangesetRecord | null;
  /**
   * 把批准的 write Task 放入 commit 队列。
   * @param input - confirmation CAS 事实
   * @returns queued(commit) Task
   */
  queueCommit?: (input: QueueAgentCommitInput) => AgentTaskRecord;
  /** durable file commit boundary。 */
  fileCommitter?: AgentFileCommitter;
  /**
   * 删除安全取消 journal 对应的精确 Attempt overlay。
   * @param input - Task 与当前 Attempt 身份
   */
  discardTaskOverlay?: (input: { readonly taskId: string; readonly attemptId: string }) => Promise<void>;
  /**
   * 在精确 overlay 删除成功后终态化 journal cancellation。
   * @param input - cancelled journal 身份与终态时间
   * @returns 汇合后的 Checkpoint
   */
  finalizeCommitCancellation?: (input: { readonly journalId: string; readonly occurredAt: string }) => AgentCheckpointRecord;
  /**
   * 发布 FileCommitter 已持久化收敛的 Checkpoint，并驱动 ready Outbox。
   * @param checkpoint - Store 原子汇合结果
   */
  publishCommitCheckpoint?: (checkpoint: AgentCheckpointRecord) => void;
  /**
   * 创建 confirmation 身份。
   * @param task - confirmation 所属 Task
   * @returns 唯一 confirmation ID
   */
  createConfirmationId?: (task: AgentTaskRecord) => string;
  /**
   * 读取 Task 最新投影，用于 journal 后错误的安全收敛。
   * @param taskId - Task 身份
   * @returns 最新 Task
   */
  getTask?: (taskId: string) => AgentTaskRecord | null;
  /**
   * 创建一个新的 Child Runtime 身份。
   * @param task - Runtime 所属 Task
   * @returns 唯一 Runtime ID
   */
  createRuntimeId(task: AgentTaskRecord): string;
  /**
   * 持久化 Checkpoint cooperative cancellation。
   * @param checkpointId - 目标 Checkpoint
   * @param reason - 稳定取消原因
   * @returns 持久化后的 Checkpoint 投影
   */
  cancelCheckpoint(checkpointId: string, reason: string): Pick<AgentCheckpointRecord, 'status'>;
  /** @returns 当前 ISO-8601 时间。 */
  now(): string;
  /** 单个 Child 相对系统截止时间；缺省为三十分钟。 */
  systemChildTimeoutMs?: number;
  /** cooperative cancellation 后执行 hard abort 的宽限期。 */
  cancellationGraceMs?: number;
  /** Actor/Runtime 分离注册表。 */
  registry: ChildActorRegistry;
}

/** Main-owned Coordinator 对外边界。 */
export interface AgentCoordinator {
  /**
   * 接受一个已持久化 delegation.created payload。
   * @param payload - allowlist Outbox payload
   */
  accept(payload: AgentDelegationCreatedPayload): Promise<void>;
  /** 从持久化非终态聚合恢复可协调工作。 */
  recover(): Promise<void>;
  /**
   * 发起 cooperative cancellation。
   * @param checkpointId - 目标 Checkpoint
   * @param reason - 稳定取消原因
   */
  cancel(checkpointId: string, reason: string): Promise<void>;
  /**
   * 发起单 Task cooperative cancellation。
   * 非 async 包装保证重复调用取得同一个 Promise。
   * @param taskId - 目标 Task
   * @returns 权威取消 disposition
   */
  cancelTask(taskId: string): Promise<AgentTaskCancellationProjection['disposition']>;
  /**
   * 读取进程内协调状态。
   * @param checkpointId - 目标 Checkpoint
   * @returns 当前状态
   */
  getCheckpointState(checkpointId: string): AgentCoordinatorState;
}

/** Coordinator 内部带更新时间的执行状态。 */
interface CoordinatorExecution {
  /** 当前协调状态。 */
  status: AgentCoordinatorState;
  /** 状态最后更新时间。 */
  updatedAt: string;
}

/** write Runtime 已结束并持久化 changeset 后的进程内交接事实。 */
interface PreparedWriteExecution {
  /** waiting confirmation 前的 running Task 投影。 */
  readonly task: AgentTaskRecord;
  /** changeset 所属 Attempt。 */
  readonly attempt: AgentAttemptRecord;
  /** Store 权威 changeset。 */
  readonly changeset: AgentChangesetRecord;
  /** commit journal 最终结果草稿。 */
  readonly draft: AgentWriteResultDraft;
}

/** Task 内存收尾中可独立重试的幂等动作。 */
type TaskCleanupAction = () => void | Promise<void>;

/** 一个 Task 的有界内存清理恢复事实。 */
interface TaskCleanupSweep {
  /** 每轮只重试仍失败的动作。 */
  actions: readonly TaskCleanupAction[];
  /** 全部动作成功后的进程内引用收尾。 */
  complete: () => void;
  /** 当前 sweep flight；失败后清空以允许显式重试。 */
  flight?: Promise<void>;
}

/** Coordinator write 分支必需依赖的收窄投影。 */
interface CoordinatorWriteDependencies {
  /** changeset Store boundary。 */
  readonly prepareChangeset: NonNullable<AgentCoordinatorDependencies['prepareChangeset']>;
  /** 持久化 confirmation queue。 */
  readonly confirmationQueue: NonNullable<AgentCoordinatorDependencies['confirmationQueue']>;
  /** confirmation 权威读取。 */
  readonly getConfirmation: NonNullable<AgentCoordinatorDependencies['getConfirmation']>;
  /** changeset 权威读取。 */
  readonly getChangeset: NonNullable<AgentCoordinatorDependencies['getChangeset']>;
  /** commit queue Store boundary。 */
  readonly queueCommit: NonNullable<AgentCoordinatorDependencies['queueCommit']>;
  /** durable commit boundary。 */
  readonly fileCommitter: NonNullable<AgentCoordinatorDependencies['fileCommitter']>;
  /** confirmation ID 工厂。 */
  readonly createConfirmationId: NonNullable<AgentCoordinatorDependencies['createConfirmationId']>;
}

/** Coordinator 同步授权调用的判别结果。 */
type CoordinatorAuthorization = { ok: true; task: AgentTaskRecord } | { ok: false; error: unknown };

/**
 * 收窄 write Coordinator 依赖，避免 write Task 静默退化为 read。
 * @param dependencies - Coordinator 全部依赖
 * @returns 完整 write 依赖或 null
 */
function readWriteDependencies(dependencies: AgentCoordinatorDependencies): CoordinatorWriteDependencies | null {
  if (
    !dependencies.prepareChangeset ||
    !dependencies.confirmationQueue ||
    !dependencies.getConfirmation ||
    !dependencies.getChangeset ||
    !dependencies.queueCommit ||
    !dependencies.fileCommitter ||
    !dependencies.createConfirmationId
  ) {
    return null;
  }
  return {
    prepareChangeset: dependencies.prepareChangeset,
    confirmationQueue: dependencies.confirmationQueue,
    getConfirmation: dependencies.getConfirmation,
    getChangeset: dependencies.getChangeset,
    queueCommit: dependencies.queueCommit,
    fileCommitter: dependencies.fileCommitter,
    createConfirmationId: dependencies.createConfirmationId
  };
}

/**
 * 从抛出的 Error 或普通对象提取结构化 AgentTaskError。
 * @param input - 授权器抛出的未知错误
 * @returns 通过 allowlist 的错误，否则为 null
 */
function readAgentError(input: unknown): AgentTaskError | null {
  if (typeof input !== 'object' || input === null) return null;
  const source = input as Record<string, unknown>;
  return validateAgentTaskError({
    code: source.code,
    phase: source.phase,
    category: source.category,
    retryable: source.retryable,
    ...(typeof source.message === 'string' ? { message: source.message } : {}),
    ...(source.details !== undefined ? { details: source.details } : {})
  });
}

/**
 * 判断错误是否可以安全收敛为授权前失败。
 * @param error - 已通过 allowlist 的错误
 * @returns 是否为不可重试计划或资源错误
 */
function isPreAttemptError(error: AgentTaskError): boolean {
  return !error.retryable && (error.phase === 'plan_validation' || error.phase === 'resource_validation');
}

/**
 * 创建超过 Checkpoint Task 上限的稳定错误。
 * @param observed - 实际 Task 数量
 * @returns 不可重试的策略错误
 */
function createLimitError(observed: number): AgentTaskError {
  return {
    code: 'capability_denied',
    phase: 'plan_validation',
    category: 'policy',
    retryable: false,
    message: 'A delegated checkpoint cannot contain more than six Child Tasks.',
    details: {
      reason: 'checkpoint_task_limit_exceeded',
      limit: MAX_CHECKPOINT_TASKS,
      observed
    }
  };
}

/**
 * 创建 required Task 授权失败后的 sibling 补偿错误。
 * @param failedTaskId - required 失败 Task
 * @returns 不启动 sibling 的稳定失败原因
 */
function createSiblingError(failedTaskId: string): AgentTaskError {
  return {
    code: 'capability_denied',
    phase: 'plan_validation',
    category: 'policy',
    retryable: false,
    message: 'A required sibling Task failed authorization before execution.',
    details: {
      reason: 'required_sibling_authorization_failed',
      taskId: failedTaskId
    }
  };
}

/**
 * 判断 Outbox payload 与持久化聚合是否完全一致。
 * @param payload - Outbox payload
 * @param recovery - Store 恢复聚合
 * @returns 身份是否一致
 */
function matchesPayload(payload: AgentDelegationCreatedPayload, recovery: AgentDelegationRecoverySnapshot): boolean {
  const { checkpoint } = recovery;
  return checkpoint.checkpointId === payload.checkpointId && checkpoint.sessionId === payload.sessionId && checkpoint.turnId === payload.turnId;
}

/**
 * 取 Task、Turn 与系统 Child 截止时间中的最早者。
 * @param task - 已授权 Task
 * @param checkpoint - Task 所属 Checkpoint
 * @param now - 当前 ISO 时间
 * @param systemTimeoutMs - 系统 Child 相对时限
 * @returns 覆盖排队与执行的绝对截止时间
 */
function resolveDeadline(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, now: string, systemTimeoutMs: number): string {
  const nowTimestamp = Date.parse(now);
  if (!Number.isFinite(nowTimestamp) || !Number.isSafeInteger(systemTimeoutMs) || systemTimeoutMs <= 0) {
    throw new Error('coordinator_system_deadline_invalid');
  }
  const deadlines = [checkpoint.continuationSnapshot.absoluteTurnDeadline, new Date(nowTimestamp + systemTimeoutMs).toISOString()];
  if (task.deadlineAt) deadlines.push(task.deadlineAt);
  return new Date(Math.min(...deadlines.map((deadline): number => Date.parse(deadline)))).toISOString();
}

/**
 * 从冻结计划构造调度器最小请求。
 * @param task - queued(start) Task
 * @param checkpoint - Task 所属 Checkpoint
 * @param now - 当前 ISO 时间
 * @param systemTimeoutMs - 系统 Child 相对时限
 * @param phase - 模型启动或排他提交
 * @returns 不含可变 Runtime 状态的请求
 */
function createScheduleRequest(
  task: AgentTaskRecord,
  checkpoint: AgentCheckpointRecord,
  now: string,
  systemTimeoutMs: number,
  phase: AgentScheduleRequest['phase'] = 'start'
): AgentScheduleRequest {
  if (!task.executionPlanSnapshot) {
    throw new Error('coordinator_execution_plan_missing');
  }
  const writeMode = task.contractSnapshot.mode === 'write';
  if (phase === 'commit' && !writeMode) throw new Error('coordinator_commit_mode_invalid');
  let kind: AgentScheduleRequest['kind'] = 'shared-read';
  if (writeMode) kind = 'write-intent';
  if (phase === 'commit') kind = 'exclusive-commit';
  return {
    taskId: task.taskId,
    phase,
    kind,
    priority: task.priority,
    deadlineAt: resolveDeadline(task, checkpoint, now, systemTimeoutMs),
    createdAt: task.createdAt,
    resourceScopes: task.executionPlanSnapshot.resourceScopes
  };
}

/**
 * 判断 Checkpoint 是否已不再需要 Child Coordinator 工作。
 * @param status - Checkpoint 状态
 * @returns 是否 ready 或已进入终态
 */
function isCoordinatorTerminal(status: AgentCheckpointStatus): boolean {
  return status === 'ready_to_resume' || status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'interrupted';
}

/**
 * 从冻结计划构造零用量成本表达。
 * @param task - 已授权 Task
 * @returns 没有发起 Provider 调用时的真实零用量
 */
function createZeroUsage(task: AgentTaskRecord): AgentUsageAccounting {
  const pricingVersion = task.executionPlanSnapshot?.budget.pricingVersion ?? 'unknown';
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    modelCalls: 0,
    toolRounds: 0,
    queueDurationMs: 0,
    executionDurationMs: 0,
    externalRequests: 0,
    monetaryCost:
      pricingVersion === 'unknown'
        ? {
            currency: 'unknown',
            pricingVersion: 'unknown',
            estimated: 'unknown',
            actual: 'unknown'
          }
        : {
            currency: 'USD',
            pricingVersion,
            estimated: 0,
            actual: 'unknown'
          }
  };
}

/**
 * 返回 Coordinator 异常结果的稳定摘要。
 * @param status - 失败、取消或 deadline 终态
 * @returns Primary 可见紧凑摘要
 */
function createFailureSummary(status: Extract<ChatAgentResult['executionStatus'], 'failed' | 'cancelled' | 'deadline_exceeded' | 'commit_failed'>): string {
  if (status === 'cancelled') return 'Child execution was cancelled.';
  if (status === 'deadline_exceeded') return 'Child execution exceeded its deadline.';
  if (status === 'commit_failed') return 'Child changeset could not be committed.';
  return 'Child execution failed.';
}

/**
 * 创建 Coordinator 在已有 Attempt 上收敛异常所需的完整结果。
 * @param projection - 已持久化 Attempt 投影
 * @param status - 执行终态
 * @param error - 结构化错误
 * @param usage - 可选已消费 Provider 用量
 * @returns 零 Provider 用量的安全结果
 */
function createFailureResult(
  projection: AgentAttemptProjection,
  status: Extract<ChatAgentResult['executionStatus'], 'failed' | 'cancelled' | 'deadline_exceeded' | 'commit_failed'>,
  error: AgentTaskError,
  usage?: AgentUsageAccounting
): ChatAgentResult {
  return {
    taskId: projection.task.taskId,
    agentId: projection.task.agentId,
    attemptId: projection.attempt.attemptId,
    executionStatus: status,
    completion: {
      level: 'none',
      criteria: projection.task.contractSnapshot.acceptanceCriteria.map((_criterion, criterionIndex) => ({
        criterionIndex,
        claim: {
          status: 'unknown',
          summary: 'Child execution ended before this criterion could be verified.',
          evidence: []
        },
        verification: {
          status: 'unverified',
          verifier: 'policy',
          evidence: []
        }
      }))
    },
    summary: createFailureSummary(status),
    warnings: [],
    artifacts: [],
    usage: usage ?? createZeroUsage(projection.task),
    error
  };
}

/**
 * 创建已有 Attempt 的稳定失败错误。
 * @param phase - starting 或 runtime 阶段
 * @param reason - 稳定机器原因
 * @param runtimeId - Runtime 身份
 * @returns 结构化 Runtime 错误
 */
function createRuntimeError(phase: 'starting' | 'runtime', reason: string, runtimeId: string): AgentTaskError {
  return {
    code: phase === 'starting' ? 'runtime_start_failed' : 'runtime_failed',
    phase,
    category: 'runtime',
    retryable: phase === 'starting',
    details: { reason, runtimeId }
  };
}

/**
 * 创建无 journal write overlay 清理失败的恢复错误。
 * @param runtimeId - 当前 Runtime 身份
 * @returns 可由精确清理流程重试的结构化错误
 */
function createCleanupError(runtimeId: string): AgentTaskError {
  return {
    code: 'runtime_interrupted',
    phase: 'recovery',
    category: 'runtime',
    retryable: true,
    details: {
      reason: 'write_overlay_cleanup_failed',
      runtimeId
    }
  };
}

/**
 * 从 AbortSignal 判断 deadline 或用户取消。
 * @param signal - Scheduler lease 信号
 * @returns 对应执行终态和错误；未中止时为 null
 */
function readAbortResult(
  signal: AbortSignal
): { status: Extract<ChatAgentResult['executionStatus'], 'cancelled' | 'deadline_exceeded'>; error: AgentTaskError } | null {
  if (!signal.aborted) return null;
  const source = typeof signal.reason === 'object' && signal.reason !== null ? (signal.reason as Record<string, unknown>) : {};
  const deadline = source.code === 'deadline_exceeded';
  return {
    status: deadline ? 'deadline_exceeded' : 'cancelled',
    error: deadline
      ? {
          code: 'deadline_exceeded',
          phase: 'runtime',
          category: 'policy',
          retryable: false,
          details: { reason: 'schedule_deadline_exceeded' }
        }
      : {
          code: 'cancelled',
          phase: 'runtime',
          category: 'user',
          retryable: false,
          details: { reason: typeof signal.reason === 'string' && signal.reason.trim() ? signal.reason.trim() : 'cooperative_cancellation' }
        }
  };
}

/**
 * 把 executor 的取消结果校正为 Scheduler deadline 终态，并保留实际 usage。
 * @param result - executor 结果
 * @param signal - Scheduler lease 信号
 * @returns 与中止原因一致的结果
 */
function normalizeAbortResult(result: ChatAgentResult, signal: AbortSignal, projection: AgentAttemptProjection): ChatAgentResult {
  const abortResult = readAbortResult(signal);
  if (!abortResult || result.executionStatus === abortResult.status) return result;
  return createFailureResult(projection, abortResult.status, abortResult.error, result.usage);
}

/**
 * 把 Scheduler 拒绝归一化为持久化取消使用的稳定机器原因。
 * @param error - Scheduler 抛出的未知错误
 * @returns 不依赖展示文本的取消原因
 */
function readScheduleReason(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'schedule_rejected';
  const source = error as Record<string, unknown>;
  if (source.code === 'deadline_exceeded') return 'schedule_deadline_exceeded';
  if (source.code === 'cancelled') {
    return typeof source.reason === 'string' && source.reason.trim() ? source.reason.trim() : 'schedule_cancelled';
  }
  return source.code === 'protocol_error' ? 'schedule_protocol_error' : 'schedule_rejected';
}

/**
 * 创建 Child Runtime 的完整 Actor lineage 地址。
 * @param task - 已授权 Task
 * @param checkpoint - 所属 Checkpoint
 * @param runtimeId - 新 Runtime 身份
 * @returns Registry 可绑定地址
 */
function createRuntimeAddress(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, runtimeId: string): ChatRuntimeAddress {
  return {
    sessionId: task.sessionId,
    turnId: task.turnId,
    agentId: task.agentId,
    runtimeId,
    parentAgentId: task.parentAgentId,
    parentRuntimeId: checkpoint.sourceRuntimeId,
    rootRuntimeId: task.rootRuntimeId
  };
}

/**
 * 从已持久化 changeset 构造完整性绑定确认请求。
 * @param prepared - changeset 交接事实
 * @param confirmationId - 新 confirmation 身份
 * @param createdAt - 创建时间
 * @returns 不含 Renderer 输入的确认快照
 */
function createConfirmationRequest(prepared: PreparedWriteExecution, confirmationId: string, createdAt: string): AgentConfirmationRequestSnapshot {
  const { task, attempt, changeset } = prepared;
  const { snapshot } = changeset;
  return {
    confirmationSchemaVersion: AGENT_CONFIRMATION_SCHEMA_VERSION,
    confirmationId,
    sessionId: task.sessionId,
    turnId: task.turnId,
    taskId: task.taskId,
    attemptId: attempt.attemptId,
    agentId: task.agentId,
    runtimeId: attempt.currentRuntimeId,
    toolCallId: task.toolCallId,
    changesetId: snapshot.changesetId,
    planHash: snapshot.planHash,
    baseRevision: snapshot.baseRevision,
    diffHash: snapshot.diffHash,
    operationSetHash: snapshot.operationSetHash,
    resourceScopes: [...snapshot.resourceScopes],
    displayPaths: snapshot.operations.map((operation): string => operation.displayPath),
    unifiedDiffReference: snapshot.diffReference,
    riskLevel: 'write',
    createdAt
  };
}

/**
 * 创建 confirmation 拒绝的终态错误。
 * @returns 用户拒绝错误
 */
function createConfirmationError(): AgentTaskError {
  return {
    code: 'confirmation_denied',
    phase: 'confirmation',
    category: 'user',
    retryable: false,
    details: { reason: 'confirmation_rejected' }
  };
}

/**
 * 把未知 commit 异常收缩为可持久化 Agent 错误。
 * @param error - file committer 或 scheduler 异常
 * @returns 可信错误或稳定 commit_failed
 */
function createCommitError(error: unknown): AgentTaskError {
  const structured = readAgentError(error);
  if (structured) return structured;
  if (typeof error === 'object' && error !== null) {
    const source = error as Record<string, unknown>;
    if (source.code === 'deadline_exceeded') {
      return {
        code: 'deadline_exceeded',
        phase: 'commit',
        category: 'policy',
        retryable: false,
        details: { reason: 'schedule_deadline_exceeded' }
      };
    }
    if (source.code === 'cancelled') {
      return {
        code: 'cancelled',
        phase: 'commit',
        category: 'user',
        retryable: false,
        details: {
          reason: typeof source.reason === 'string' && source.reason.trim() ? source.reason.trim() : 'schedule_cancelled'
        }
      };
    }
  }
  return {
    code: 'commit_failed',
    phase: 'commit',
    category: 'runtime',
    retryable: false,
    details: { reason: 'commit_execution_rejected' }
  };
}

/**
 * 从 commit 错误选择合法 Task 终态。
 * @param error - 可信 commit 错误
 * @returns failed、cancelled、deadline 或 commit_failed
 */
function readCommitStatus(error: AgentTaskError): Extract<ChatAgentResult['executionStatus'], 'failed' | 'cancelled' | 'deadline_exceeded' | 'commit_failed'> {
  if (error.code === 'cancelled') return 'cancelled';
  if (error.code === 'deadline_exceeded') return 'deadline_exceeded';
  if (error.code === 'commit_failed' || error.code === 'manual_recovery_required') return 'commit_failed';
  return 'failed';
}

/**
 * 创建 Main-owned Child Coordinator。
 * @param dependencies - Store、授权器、Registry 和调度入口
 * @returns 幂等 Coordinator
 */
export function createAgentCoordinator(dependencies: AgentCoordinatorDependencies): AgentCoordinator {
  const executions = new Map<string, CoordinatorExecution>();
  const inFlight = new Map<string, Promise<void>>();
  const taskRuns = new Map<string, Promise<void>>();
  const cancelFlights = new Map<string, Promise<AgentTaskCancellationProjection['disposition']>>();
  const cancelReasons = new Map<string, string>();
  const pendingFinalizations = new Map<string, string>();
  const preparedWrites = new Map<string, PreparedWriteExecution>();
  const runtimeIds = new Map<string, string>();
  const abortTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const cleanupSweeps = new Map<string, TaskCleanupSweep>();
  const systemChildTimeoutMs = dependencies.systemChildTimeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS;
  const cancellationGraceMs = dependencies.cancellationGraceMs ?? DEFAULT_CANCEL_GRACE_MS;
  if (!Number.isSafeInteger(systemChildTimeoutMs) || systemChildTimeoutMs <= 0 || !Number.isSafeInteger(cancellationGraceMs) || cancellationGraceMs <= 0) {
    throw new Error('coordinator_timing_policy_invalid');
  }

  /**
   * 更新一个 Checkpoint 的进程内状态。
   * @param checkpointId - Checkpoint ID
   * @param status - 新状态
   */
  function setState(checkpointId: string, status: AgentCoordinatorState): void {
    executions.set(checkpointId, { status, updatedAt: dependencies.now() });
  }

  /**
   * 对失败动作执行固定次数的有界恢复。
   * @param actions - 幂等清理动作
   */
  async function executeCleanup(actions: readonly TaskCleanupAction[]): Promise<void> {
    let pending = [...actions];
    let firstFailure: unknown = new Error('coordinator_cleanup_failed');
    for (let attempt = 0; attempt < MAX_CLEANUP_SWEEP_ATTEMPTS && pending.length > 0; attempt += 1) {
      const outcomes = await Promise.allSettled(pending.map((action): Promise<void> => Promise.resolve().then(action)));
      const failedActions: TaskCleanupAction[] = [];
      outcomes.forEach((outcome, index): void => {
        if (outcome.status !== 'rejected') return;
        if (failedActions.length === 0) firstFailure = outcome.reason;
        const action = pending[index];
        if (action) failedActions.push(action);
      });
      pending = failedActions;
    }
    if (pending.length > 0) throw firstFailure;
  }

  /**
   * 创建或重试一个 Task 的有界清理 sweep。
   * @param taskId - 目标 Task
   * @param actions - 首次注册的精确清理动作
   * @param complete - 全部动作成功后的引用收尾
   */
  function runCleanupSweep(taskId: string, actions?: readonly TaskCleanupAction[], complete: () => void = (): void => undefined): Promise<void> {
    const existing = cleanupSweeps.get(taskId);
    const sweep: TaskCleanupSweep = existing ?? {
      actions: actions ?? [],
      complete
    };
    if (!existing) cleanupSweeps.set(taskId, sweep);
    if (sweep.flight) return sweep.flight;
    const execution = executeCleanup(sweep.actions).then((): void => {
      sweep.complete();
      if (cleanupSweeps.get(taskId) === sweep) cleanupSweeps.delete(taskId);
    });
    sweep.flight = execution;
    void execution.catch((): void => {
      if (cleanupSweeps.get(taskId) === sweep && sweep.flight === execution) sweep.flight = undefined;
    });
    return execution;
  }

  /**
   * 在同步授权边界捕获可信结构化错误。
   * @param taskId - 待授权 Task
   * @returns 授权后的 Task 或原始错误
   */
  function authorizeTask(taskId: string): CoordinatorAuthorization {
    try {
      return { ok: true, task: dependencies.authorizeTask(taskId) };
    } catch (error) {
      return { ok: false, error };
    }
  }

  /**
   * 清理 Task 的 hard-abort 计时器。
   * @param taskId - Task 身份
   */
  function clearAbortTimer(taskId: string): void {
    const timer = abortTimers.get(taskId);
    if (!timer) return;
    clearTimeout(timer);
    abortTimers.delete(taskId);
  }

  /**
   * 为运行中的目标 Runtime 安排一次 hard abort。
   * @param taskId - 目标 Task
   * @param runtimeId - 当前 Runtime
   * @param reason - 稳定取消原因
   */
  function scheduleHardAbort(taskId: string, runtimeId: string, reason: string): void {
    if (abortTimers.has(taskId)) return;
    const timer = setTimeout((): void => {
      abortTimers.delete(taskId);
      dependencies.executor.abort(runtimeId, reason);
    }, cancellationGraceMs);
    abortTimers.set(taskId, timer);
  }

  /**
   * 在 Attempt 尚未创建时，把调度或启动失败收敛为持久化取消终态。
   * @param task - 尚无 Attempt 的已授权 Task
   * @param checkpoint - Task 所属 Checkpoint
   * @param reason - 稳定机器原因
   */
  async function cancelBeforeAttempt(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, reason: string): Promise<void> {
    const alreadyTerminal = executions.get(checkpoint.checkpointId)?.status === 'terminal';
    if (alreadyTerminal) {
      await Promise.allSettled([
        Promise.resolve().then((): void => {
          dependencies.releaseBudget(task.taskId);
        })
      ]);
      return;
    }
    const [cancelOutcome] = await Promise.allSettled([
      Promise.resolve().then((): Pick<AgentCheckpointRecord, 'status'> => dependencies.cancelCheckpoint(checkpoint.checkpointId, reason))
    ]);
    await Promise.allSettled([
      Promise.resolve().then((): void => {
        dependencies.releaseBudget(task.taskId);
      })
    ]);
    if (cancelOutcome.status === 'rejected') {
      setState(checkpoint.checkpointId, 'idle');
      return;
    }
    setState(checkpoint.checkpointId, isCoordinatorTerminal(cancelOutcome.value.status) ? 'terminal' : 'running');
  }

  /**
   * 有界等待 cooperative cancellation 与 hard abort 后的 Task 清理。
   * @param executionsToWait - 取消时仍在活动的 Task 执行
   */
  async function waitTaskRuns(executionsToWait: readonly Promise<void>[]): Promise<boolean> {
    if (executionsToWait.length === 0) return true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const boundedWait = new Promise<boolean>((resolve): void => {
      timeout = setTimeout((): void => resolve(false), cancellationGraceMs * 2);
    });
    const completed = await Promise.race([Promise.allSettled(executionsToWait).then((): boolean => true), boundedWait]);
    if (timeout) clearTimeout(timeout);
    return completed;
  }

  /**
   * 把完整结果写入 rendezvous 并结算预算。
   * @param task - 结果所属 Task
   * @param result - 完整 Child 结果
   */
  async function commitTaskResult(task: AgentTaskRecord, result: ChatAgentResult): Promise<void> {
    const [usageOutcome] = await Promise.allSettled([
      Promise.resolve().then(
        (): AgentAttemptRecord =>
          dependencies.recordAttemptUsage({
            taskId: task.taskId,
            attemptId: result.attemptId,
            usage: result.usage,
            complete: true,
            occurredAt: dependencies.now()
          })
      )
    ]);
    if (usageOutcome.status === 'rejected') {
      if (executions.get(task.checkpointId)?.status !== 'terminal') setState(task.checkpointId, 'idle');
      return;
    }
    const [recordOutcome] = await Promise.allSettled([Promise.resolve().then((): AgentCheckpointRecord => dependencies.recordTaskResult(task, result))]);
    if (recordOutcome.status === 'rejected') {
      if (executions.get(task.checkpointId)?.status !== 'terminal') setState(task.checkpointId, 'idle');
      return;
    }
    const checkpointTerminal = isCoordinatorTerminal(recordOutcome.value.status);
    setState(task.checkpointId, checkpointTerminal ? 'terminal' : 'running');
    const [settleOutcome] = await Promise.allSettled([
      Promise.resolve().then((): void => {
        dependencies.settleTask(task.taskId, result.usage);
      })
    ]);
    if (settleOutcome.status === 'rejected') {
      if (!checkpointTerminal) setState(task.checkpointId, 'idle');
    }
    const pendingReason = pendingFinalizations.get(task.checkpointId);
    if (recordOutcome.value.status === 'cancelled' && pendingReason) {
      const [finalizeOutcome] = await Promise.allSettled([
        Promise.resolve().then((): Pick<AgentCheckpointRecord, 'status'> => dependencies.cancelCheckpoint(task.checkpointId, pendingReason))
      ]);
      if (finalizeOutcome.status === 'fulfilled') {
        pendingFinalizations.delete(task.checkpointId);
        setState(task.checkpointId, 'terminal');
      } else {
        setState(task.checkpointId, 'idle');
      }
    }
  }

  /**
   * 先删除无 journal 的 write overlay，再持久化真实终态。
   * @param projection - 当前 Task/Attempt 投影
   * @param runtimeId - retained write Runtime 身份
   * @param result - 清理成功后应写入的终态结果
   * @param usage - 清理失败时仍需冻结的实际用量
   * @returns 是否按原结果完成收敛
   */
  async function commitAfterDiscard(
    projection: AgentAttemptProjection,
    runtimeId: string,
    result: ChatAgentResult,
    usage: AgentUsageAccounting
  ): Promise<boolean> {
    const [discardOutcome] = await Promise.allSettled([dependencies.executor.discard(runtimeId)]);
    if (discardOutcome.status === 'rejected') {
      await commitTaskResult(projection.task, createFailureResult(projection, 'failed', createCleanupError(runtimeId), usage));
      return false;
    }
    await commitTaskResult(projection.task, result);
    return true;
  }

  /**
   * 在 start lease 内创建 Attempt、执行模型并持久化可选 changeset。
   * @param task - 已授权 Task
   * @param checkpoint - Task 所属 Checkpoint
   * @param lease - shared-read 或 write-intent 许可
   * @returns write 交接事实；read/终态路径为 null
   */
  async function executeLease(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, lease: AgentResourceLease): Promise<PreparedWriteExecution | null> {
    const authoritativeTask = dependencies.getTask?.(task.taskId);
    if (!authoritativeTask || authoritativeTask.recordState !== 'active') return null;
    if (
      authoritativeTask.status !== 'queued' ||
      authoritativeTask.queuePhase !== 'start' ||
      authoritativeTask.currentAttemptId !== undefined ||
      authoritativeTask.cancelRequestedAt !== undefined
    ) {
      return null;
    }
    const handoffAbort = readAbortResult(lease.signal);
    if (handoffAbort) {
      const requestKind = cancelReasons.get(task.taskId) === 'user_cancelled' ? 'single_task' : 'checkpoint_cascade';
      dependencies.recordPreCancellation(authoritativeTask, requestKind);
      dependencies.releaseBudget(authoritativeTask.taskId);
      if (!cancelReasons.has(task.taskId)) {
        dependencies.cancelCheckpoint(checkpoint.checkpointId, handoffAbort.error.details?.reason?.toString() ?? 'schedule_cancelled');
      }
      return null;
    }
    const runtimeId = dependencies.createRuntimeId(authoritativeTask);
    const attemptId = `attempt-${runtimeId}`;
    const beginInput: BeginAgentAttemptInput = {
      taskId: authoritativeTask.taskId,
      attemptId,
      parentRuntimeId: checkpoint.sourceRuntimeId,
      runtimeId,
      occurredAt: dependencies.now()
    };
    const [beginOutcome] = await Promise.allSettled([Promise.resolve().then((): AgentAttemptProjection => dependencies.beginAttempt(beginInput))]);
    if (beginOutcome.status === 'rejected') {
      await cancelBeforeAttempt(authoritativeTask, checkpoint, 'attempt_start_rejected');
      return null;
    }

    let projection = beginOutcome.value;
    runtimeIds.set(task.taskId, runtimeId);
    const address = createRuntimeAddress(task, checkpoint, runtimeId);
    const [startOutcome] = await Promise.allSettled([
      Promise.resolve().then((): AgentAttemptProjection => {
        dependencies.registry.bindRuntime(address, projection.task.executionPlanSnapshotHash as string);
        return dependencies.markAttemptRunning({
          taskId: task.taskId,
          attemptId: projection.attempt.attemptId,
          runtimeId,
          occurredAt: dependencies.now()
        });
      })
    ]);
    if (startOutcome.status === 'rejected') {
      const abortResult = readAbortResult(lease.signal);
      const result = abortResult
        ? createFailureResult(projection, abortResult.status, abortResult.error)
        : createFailureResult(projection, 'failed', createRuntimeError('starting', 'runtime_start_rejected', runtimeId));
      await commitTaskResult(projection.task, result);
      return null;
    }
    projection = startOutcome.value;

    const [executionOutcome] = await Promise.allSettled([
      dependencies.executor.execute({
        task: projection.task,
        attempt: projection.attempt,
        checkpoint,
        signal: lease.signal
      })
    ]);
    const abortResult = readAbortResult(lease.signal);
    if (executionOutcome.status === 'rejected') {
      const currentAttempt = dependencies.getAttempt(projection.attempt.attemptId);
      if (!currentAttempt || currentAttempt.taskId !== projection.task.taskId) {
        throw new Error('coordinator_attempt_usage_unavailable');
      }
      const result = abortResult
        ? createFailureResult(projection, abortResult.status, abortResult.error, currentAttempt.usageSnapshot)
        : createFailureResult(projection, 'failed', createRuntimeError('runtime', 'runtime_execution_rejected', runtimeId), currentAttempt.usageSnapshot);
      await commitTaskResult(projection.task, result);
      return null;
    }
    const execution = executionOutcome.value;
    if (execution.kind === 'terminal') {
      await commitTaskResult(projection.task, normalizeAbortResult(execution.result, lease.signal, projection));
      return null;
    }
    if (abortResult) {
      await commitAfterDiscard(
        projection,
        runtimeId,
        createFailureResult(projection, abortResult.status, abortResult.error, execution.draft.usage),
        execution.draft.usage
      );
      return null;
    }
    const writeDependencies = readWriteDependencies(dependencies);
    if (!writeDependencies) {
      await Promise.allSettled([dependencies.executor.discard(runtimeId)]);
      await commitTaskResult(
        projection.task,
        createFailureResult(
          projection,
          'failed',
          {
            code: 'capability_denied',
            phase: 'plan_validation',
            category: 'policy',
            retryable: false,
            details: { reason: 'write_orchestration_unavailable' }
          },
          execution.draft.usage
        )
      );
      return null;
    }
    const [prepareOutcome] = await Promise.allSettled([
      Promise.resolve().then(
        (): AgentChangesetRecord =>
          writeDependencies.prepareChangeset({
            snapshot: execution.changeset,
            snapshotHash: hashChangesetSnapshot(execution.changeset),
            occurredAt: dependencies.now()
          })
      )
    ]);
    if (prepareOutcome.status === 'rejected') {
      await Promise.allSettled([dependencies.executor.discard(runtimeId)]);
      const error =
        readAgentError(prepareOutcome.reason) ??
        ({
          code: 'protocol_error',
          phase: 'commit_validation',
          category: 'protocol',
          retryable: false,
          details: { reason: 'changeset_persistence_rejected' }
        } satisfies AgentTaskError);
      await commitTaskResult(projection.task, createFailureResult(projection, 'failed', error, execution.draft.usage));
      return null;
    }
    const prepared = {
      task: projection.task,
      attempt: projection.attempt,
      changeset: prepareOutcome.value,
      draft: execution.draft
    };
    preparedWrites.set(task.taskId, prepared);
    return prepared;
  }

  /**
   * 等待一次用户确认，并在批准后通过新排他 lease 提交 changeset。
   * @param prepared - 已释放 write-intent 的 write 交接事实
   * @param checkpoint - Task 所属 Checkpoint
   */
  async function commitPrepared(prepared: PreparedWriteExecution, checkpoint: AgentCheckpointRecord): Promise<void> {
    const writeDependencies = readWriteDependencies(dependencies);
    const projection: AgentAttemptProjection = { task: prepared.task, attempt: prepared.attempt };
    if (!writeDependencies) {
      await Promise.allSettled([dependencies.executor.discard(prepared.attempt.currentRuntimeId)]);
      return;
    }
    const confirmationId = writeDependencies.createConfirmationId(prepared.task);
    const request = createConfirmationRequest(prepared, confirmationId, dependencies.now());
    const [decisionOutcome] = await Promise.allSettled([
      writeDependencies.confirmationQueue.request({
        request,
        requestHash: hashConfirmationRequestSnapshot(request),
        occurredAt: dependencies.now()
      })
    ]);
    if (decisionOutcome.status === 'rejected') {
      const error =
        readAgentError(decisionOutcome.reason) ??
        ({
          code: 'protocol_error',
          phase: 'confirmation',
          category: 'protocol',
          retryable: false,
          details: { reason: 'confirmation_request_rejected' }
        } satisfies AgentTaskError);
      await commitTaskResult(prepared.task, createFailureResult(projection, 'failed', error, prepared.draft.usage));
      await Promise.allSettled([dependencies.executor.discard(prepared.attempt.currentRuntimeId)]);
      return;
    }
    const confirmation = writeDependencies.getConfirmation(confirmationId);
    if (decisionOutcome.value.decision !== 'approved' || confirmation?.status !== 'approved') {
      const revoked = confirmation?.status === 'revoked';
      const error: AgentTaskError = revoked
        ? {
            code: 'cancelled',
            phase: 'runtime',
            category: 'user',
            retryable: false,
            details: { reason: 'confirmation_revoked' }
          }
        : createConfirmationError();
      const result = createFailureResult(projection, revoked ? 'cancelled' : 'failed', error, prepared.draft.usage);
      if (revoked) {
        await commitAfterDiscard(projection, prepared.attempt.currentRuntimeId, result, prepared.draft.usage);
        return;
      }
      await commitTaskResult(prepared.task, result);
      await Promise.allSettled([dependencies.executor.discard(prepared.attempt.currentRuntimeId)]);
      return;
    }
    if (confirmation.version !== decisionOutcome.value.version || confirmation.changesetId !== prepared.changeset.snapshot.changesetId) {
      await commitTaskResult(
        prepared.task,
        createFailureResult(
          projection,
          'failed',
          {
            code: 'protocol_error',
            phase: 'confirmation',
            category: 'protocol',
            retryable: false,
            details: { reason: 'confirmation_decision_mismatch' }
          },
          prepared.draft.usage
        )
      );
      await Promise.allSettled([dependencies.executor.discard(prepared.attempt.currentRuntimeId)]);
      return;
    }
    const [queueOutcome] = await Promise.allSettled([
      Promise.resolve().then(
        (): AgentTaskRecord =>
          writeDependencies.queueCommit({
            taskId: prepared.task.taskId,
            confirmationId: confirmation.confirmationId,
            confirmationVersion: confirmation.version,
            occurredAt: dependencies.now()
          })
      )
    ]);
    if (queueOutcome.status === 'rejected') {
      const error = createCommitError(queueOutcome.reason);
      await commitTaskResult(prepared.task, createFailureResult(projection, readCommitStatus(error), error, prepared.draft.usage));
      await Promise.allSettled([dependencies.executor.discard(prepared.attempt.currentRuntimeId)]);
      return;
    }
    const commitTask = queueOutcome.value;
    const commitChangeset = writeDependencies.getChangeset(prepared.changeset.snapshot.changesetId);
    if (!commitChangeset || commitChangeset.snapshotHash !== prepared.changeset.snapshotHash) {
      await commitTaskResult(
        commitTask,
        createFailureResult(
          { task: commitTask, attempt: prepared.attempt },
          'failed',
          {
            code: 'protocol_error',
            phase: 'commit_validation',
            category: 'integrity',
            retryable: false,
            details: { reason: 'approved_changeset_projection_invalid' }
          },
          prepared.draft.usage
        )
      );
      await Promise.allSettled([dependencies.executor.discard(prepared.attempt.currentRuntimeId)]);
      return;
    }
    const [leaseOutcome] = await Promise.allSettled([
      dependencies.scheduler.enqueue(createScheduleRequest(commitTask, checkpoint, dependencies.now(), systemChildTimeoutMs, 'commit'))
    ]);
    if (leaseOutcome.status === 'rejected') {
      const currentTask = dependencies.getTask?.(prepared.task.taskId);
      if (currentTask?.status === 'cancelled') {
        await Promise.allSettled([dependencies.executor.discard(prepared.attempt.currentRuntimeId)]);
        return;
      }
      if (currentTask?.status === 'cancelling') {
        const cancellationError: AgentTaskError = {
          code: 'cancelled',
          phase: 'commit',
          category: 'user',
          retryable: false,
          details: { reason: cancelReasons.get(prepared.task.taskId) ?? 'cooperative_cancellation' }
        };
        const cancellationProjection = { task: currentTask, attempt: prepared.attempt };
        await commitAfterDiscard(
          cancellationProjection,
          prepared.attempt.currentRuntimeId,
          createFailureResult(cancellationProjection, 'cancelled', cancellationError, prepared.draft.usage),
          prepared.draft.usage
        );
        return;
      }
      const error = createCommitError(leaseOutcome.reason);
      await commitTaskResult(
        commitTask,
        createFailureResult({ task: commitTask, attempt: prepared.attempt }, readCommitStatus(error), error, prepared.draft.usage)
      );
      await Promise.allSettled([dependencies.executor.discard(prepared.attempt.currentRuntimeId)]);
      return;
    }
    const lease = leaseOutcome.value;
    let deferredCancellation: { readonly projection: AgentAttemptProjection; readonly result: ChatAgentResult } | undefined;
    /** 在 commit lease 内执行受控外部写入并持久化最终结果。 */
    const applyCommit = async (): Promise<void> => {
      const currentTask = dependencies.getTask?.(prepared.task.taskId);
      const handoffAbort = readAbortResult(lease.signal);
      if (currentTask?.status === 'cancelled') return;
      if (currentTask?.status === 'cancelling' || handoffAbort) {
        const cancellation =
          currentTask?.status === 'queued' && currentTask.queuePhase === 'commit'
            ? dependencies.requestTaskCancellation(currentTask.taskId, 'checkpoint_cascade').task
            : currentTask;
        if (!cancellation?.currentAttemptId || cancellation.currentAttemptId !== prepared.attempt.attemptId) {
          throw new Error('coordinator_commit_cancel_projection_invalid');
        }
        const cancellationError: AgentTaskError = handoffAbort
          ? { ...handoffAbort.error, phase: 'commit' }
          : {
              code: 'cancelled',
              phase: 'commit',
              category: 'user',
              retryable: false,
              details: { reason: cancelReasons.get(prepared.task.taskId) ?? 'cooperative_cancellation' }
            };
        const cancellationProjection = { task: cancellation, attempt: prepared.attempt };
        deferredCancellation = {
          projection: cancellationProjection,
          result: createFailureResult(cancellationProjection, handoffAbort?.status ?? 'cancelled', cancellationError, prepared.draft.usage)
        };
        return;
      }
      if (currentTask?.status !== 'queued' || currentTask.queuePhase !== 'commit') {
        throw new Error('coordinator_commit_handoff_invalid');
      }
      const [commitOutcome] = await Promise.allSettled([
        writeDependencies.fileCommitter.commit({
          task: commitTask,
          attempt: prepared.attempt,
          changeset: commitChangeset,
          confirmation,
          resultDraft: prepared.draft,
          lease
        })
      ]);
      if (commitOutcome.status === 'fulfilled') {
        await commitTaskResult(commitTask, commitOutcome.value.result);
      } else {
        const failedCommitTask = dependencies.getTask?.(prepared.task.taskId);
        const cancelledError = readAgentError(commitOutcome.reason);
        if (
          failedCommitTask?.status === 'cancelled' ||
          (cancelledError?.code === 'cancelled' &&
            failedCommitTask?.status === 'committing' &&
            failedCommitTask.unfinishedJournalCount === 0 &&
            failedCommitTask.cancelRequestedAt !== undefined)
        ) {
          setState(prepared.task.checkpointId, 'idle');
          return;
        }
        if (failedCommitTask?.status === 'commit_failed' && failedCommitTask.result) {
          const failureCheckpoint = commitOutcome.reason instanceof AgentFileCommitError ? commitOutcome.reason.checkpoint : undefined;
          if (failureCheckpoint) dependencies.publishCommitCheckpoint?.(failureCheckpoint);
          dependencies.settleTask(failedCommitTask.taskId, failedCommitTask.result.usage);
          setState(prepared.task.checkpointId, failureCheckpoint && isCoordinatorTerminal(failureCheckpoint.status) ? 'terminal' : 'idle');
          return;
        }
        if ((failedCommitTask?.unfinishedJournalCount ?? 0) > 0) {
          setState(prepared.task.checkpointId, 'idle');
        } else {
          const error = createCommitError(commitOutcome.reason);
          if (error.code === 'stale_context' && error.phase === 'commit_validation') {
            await Promise.allSettled([
              Promise.resolve().then(() => writeDependencies.confirmationQueue.invalidate(confirmation.confirmationId, 'stale_context'))
            ]);
          }
          await commitTaskResult(
            commitTask,
            createFailureResult({ task: commitTask, attempt: prepared.attempt }, readCommitStatus(error), error, prepared.draft.usage)
          );
        }
      }
    };
    const [operationOutcome] = await Promise.allSettled([applyCommit()]);
    const [leaseCleanup, overlayCleanup] = await Promise.allSettled([
      Promise.resolve().then((): void => lease.release()),
      dependencies.executor.discard(prepared.attempt.currentRuntimeId)
    ]);
    // 业务错误优先，避免清理异常覆盖真正的提交失败。
    if (operationOutcome.status === 'rejected') throw operationOutcome.reason;
    if (deferredCancellation) {
      if (overlayCleanup.status === 'rejected') {
        await commitTaskResult(
          deferredCancellation.projection.task,
          createFailureResult(deferredCancellation.projection, 'failed', createCleanupError(prepared.attempt.currentRuntimeId), prepared.draft.usage)
        );
      } else {
        await commitTaskResult(deferredCancellation.projection.task, deferredCancellation.result);
      }
    }
    if (leaseCleanup.status === 'rejected') throw leaseCleanup.reason;
    if (overlayCleanup.status === 'rejected' && !deferredCancellation) throw overlayCleanup.reason;
  }

  /**
   * 独立清理 start lease 与 Runtime 路由。
   * @param taskId - 目标 Task
   * @param lease - 已取得 start lease
   */
  async function releaseStartResources(taskId: string, lease: AgentResourceLease): Promise<void> {
    clearAbortTimer(taskId);
    const runtimeId = runtimeIds.get(taskId);
    const outcomes = await Promise.allSettled([
      Promise.resolve().then((): void => {
        if (runtimeId) dependencies.registry.unbindRuntime(runtimeId);
      }),
      Promise.resolve().then((): void => lease.release())
    ]);
    const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
    if (failure) throw failure.reason;
    runtimeIds.delete(taskId);
  }

  /**
   * 在取得 start lease 后执行 Child，并保证确认前释放 Runtime 与资源许可。
   * @param task - 已授权 Task
   * @param checkpoint - Task 所属 Checkpoint
   */
  async function runScheduledTask(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord): Promise<void> {
    let lease: AgentResourceLease | undefined;
    /** 执行 start 调度、Child Runtime 运行以及可能的受控提交。 */
    const executeScheduled = async (): Promise<void> => {
      const [leaseOutcome] = await Promise.allSettled([
        dependencies.scheduler.enqueue(createScheduleRequest(task, checkpoint, dependencies.now(), systemChildTimeoutMs, 'start'))
      ]);
      if (leaseOutcome.status === 'rejected') {
        const currentTask = dependencies.getTask?.(task.taskId);
        if (currentTask?.status !== 'cancelled' && currentTask?.status !== 'cancelling') {
          await cancelBeforeAttempt(task, checkpoint, readScheduleReason(leaseOutcome.reason));
        }
      } else {
        lease = leaseOutcome.value;
        const [executionOutcome] = await Promise.allSettled([executeLease(task, checkpoint, lease)]);
        await releaseStartResources(task.taskId, lease);
        lease = undefined;
        if (executionOutcome.status === 'fulfilled' && executionOutcome.value) {
          await commitPrepared(executionOutcome.value, checkpoint);
        } else if (executionOutcome.status === 'rejected') {
          setState(task.checkpointId, 'idle');
        }
      }
    };
    const [operationOutcome] = await Promise.allSettled([executeScheduled()]);
    clearAbortTimer(task.taskId);
    const runtimeId = runtimeIds.get(task.taskId);
    const [cleanupOutcome] = await Promise.allSettled([
      runCleanupSweep(
        task.taskId,
        [
          (): void => {
            if (runtimeId) dependencies.registry.unbindRuntime(runtimeId);
          },
          (): void => {
            lease?.release();
          },
          (): void => dependencies.registry.releaseTask(task.taskId)
        ],
        (): void => {
          runtimeIds.delete(task.taskId);
          preparedWrites.delete(task.taskId);
        }
      )
    ]);
    // 保留执行主错误；只有执行成功时才把有界清理失败上抛。
    if (operationOutcome.status === 'rejected') throw operationOutcome.reason;
    if (cleanupOutcome.status === 'rejected') throw cleanupOutcome.reason;
  }

  /**
   * 幂等启动一个 Task 的异步 lease 获取与执行。
   * @param task - queued(start) Task
   * @param checkpoint - Task 所属 Checkpoint
   */
  function startScheduledTask(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord): void {
    if (taskRuns.has(task.taskId)) return;
    const execution = runScheduledTask(task, checkpoint);
    taskRuns.set(task.taskId, execution);
    /** 成功或异常结束时只清理仍指向本次执行的 Task 槽位。 */
    const clearRun = (): void => {
      if (taskRuns.get(task.taskId) === execution) taskRuns.delete(task.taskId);
    };
    execution.then(clearRun, clearRun);
  }

  /**
   * 等待目标 Task 当前执行完成，等待时间受取消策略约束。
   * @param taskId - 目标 Task
   */
  async function waitTaskRun(taskId: string): Promise<void> {
    const execution = taskRuns.get(taskId);
    if (!execution) return;
    if (!(await waitTaskRuns([execution]))) throw new Error('coordinator_cancel_cleanup_timeout');
    await execution;
  }

  /**
   * 从当前 Store 投影读取一个可取消 Task。
   * @param taskId - 目标身份
   * @returns 当前 Task
   */
  function readCancelTask(taskId: string): AgentTaskRecord {
    const task = dependencies.getTask?.(taskId);
    if (!task || task.recordState !== 'active') throw new Error('coordinator_task_not_found');
    return task;
  }

  /**
   * 归一化单 Task 与 Checkpoint 级联取消。
   * @param taskId - 目标 Task
   * @param requestKind - 首次持久化的请求种类
   * @returns 权威 disposition
   */
  async function cancelTaskInternal(
    taskId: string,
    requestKind: 'single_task' | 'checkpoint_cascade'
  ): Promise<AgentTaskCancellationProjection['disposition']> {
    if (cleanupSweeps.has(taskId)) await runCleanupSweep(taskId);
    const task = readCancelTask(taskId);
    const reason = cancelReasons.get(taskId) ?? (requestKind === 'single_task' ? 'user_cancelled' : 'checkpoint_cancelled');
    if (isTaskTerminal(task.status)) {
      return dependencies.requestTaskCancellation(task.taskId, requestKind).disposition;
    }
    if (
      task.currentAttemptId === undefined &&
      (task.status === 'created' || task.status === 'planning' || task.status === 'authorized' || (task.status === 'queued' && task.queuePhase === 'start'))
    ) {
      if (task.status === 'queued') {
        const scheduleDisposition = dependencies.scheduler.cancel(task.taskId, reason);
        if (scheduleDisposition !== 'queued_cancelled' && scheduleDisposition !== 'active_signalled') {
          throw new Error('coordinator_queued_cancel_conflict');
        }
      }
      dependencies.recordPreCancellation(task, requestKind);
      dependencies.releaseBudget(task.taskId);
      dependencies.registry.releaseTask(task.taskId);
      await waitTaskRun(task.taskId);
      return 'cancel_requested';
    }
    const projection = dependencies.requestTaskCancellation(task.taskId, requestKind);
    if (projection.disposition === 'already_settled') return projection.disposition;
    if (task.status === 'committing' || projection.task.status === 'committing') {
      if (!dependencies.fileCommitter || !dependencies.discardTaskOverlay || !dependencies.finalizeCommitCancellation || !projection.task.currentAttemptId) {
        throw new Error('coordinator_commit_cancel_dependencies_missing');
      }
      const cancellation = await dependencies.fileCommitter.cancelTask(task.taskId);
      if (cancellation.disposition === 'commit_in_progress') return cancellation.disposition;
      if (
        cancellation.journal.taskId !== task.taskId ||
        cancellation.journal.attemptId !== projection.task.currentAttemptId ||
        cancellation.journal.status !== 'cancelled' ||
        cancellation.journal.appliedOperationIds.length !== 0
      ) {
        throw new Error('coordinator_commit_cancel_projection_invalid');
      }
      await dependencies.discardTaskOverlay({
        taskId: cancellation.journal.taskId,
        attemptId: cancellation.journal.attemptId
      });
      const checkpoint = dependencies.finalizeCommitCancellation({
        journalId: cancellation.journal.journalId,
        occurredAt: dependencies.now()
      });
      const cancelledTask = dependencies.getTask?.(task.taskId);
      if (cancelledTask?.status === 'cancelled' && cancelledTask.result) {
        dependencies.settleTask(cancelledTask.taskId, cancelledTask.result.usage);
      }
      setState(task.checkpointId, isCoordinatorTerminal(checkpoint.status) ? 'terminal' : 'running');
      return 'cancel_requested';
    }
    if (projection.disposition === 'commit_in_progress') return projection.disposition;
    const currentTask = projection.task;
    if (task.status === 'waiting_confirmation') {
      dependencies.confirmationQueue?.revokeTask(task.taskId, reason);
      await waitTaskRun(task.taskId);
      return projection.disposition;
    }
    const scheduleDisposition: AgentScheduleCancelDisposition = dependencies.scheduler.cancel(task.taskId, reason);
    if (scheduleDisposition === 'active_signalled') {
      const error: AgentTaskError = {
        code: 'cancelled',
        phase: 'runtime',
        category: 'user',
        retryable: false,
        details: { reason }
      };
      if (dependencies.registry.getActor(task.taskId)) dependencies.registry.abortTask(task.taskId, error);
      const runtimeId = runtimeIds.get(task.taskId);
      if (runtimeId) scheduleHardAbort(task.taskId, runtimeId, reason);
    } else if (scheduleDisposition === 'not_found' && currentTask.status !== 'cancelling') {
      throw new Error('coordinator_active_cancel_route_missing');
    }
    await waitTaskRun(task.taskId);
    return projection.disposition;
  }

  /**
   * 返回或创建单 Task 取消 flight。
   * @param taskId - 目标 Task
   * @param requestKind - 首次请求种类
   * @returns 同一 Task 当前共享 Promise
   */
  function getCancelFlight(taskId: string, requestKind: 'single_task' | 'checkpoint_cascade'): Promise<AgentTaskCancellationProjection['disposition']> {
    const existing = cancelFlights.get(taskId);
    if (existing) return existing;
    const execution = cancelTaskInternal(taskId, requestKind).finally((): void => {
      if (cancelFlights.get(taskId) === execution) {
        cancelFlights.delete(taskId);
        cancelReasons.delete(taskId);
      }
    });
    cancelFlights.set(taskId, execution);
    return execution;
  }

  /**
   * 按持久化事实协调一次 Checkpoint。
   * @param payload - 已提交 Outbox payload
   */
  async function coordinate(payload: AgentDelegationCreatedPayload): Promise<void> {
    setState(payload.checkpointId, 'planning');
    const recovery = dependencies.listActive().find((entry): boolean => entry.checkpoint.checkpointId === payload.checkpointId);
    if (!recovery) {
      setState(payload.checkpointId, 'terminal');
      return;
    }
    if (!matchesPayload(payload, recovery)) {
      setState(payload.checkpointId, 'idle');
      throw new Error('coordinator_payload_mismatch');
    }
    if (recovery.checkpoint.status !== 'waiting_children' || recovery.checkpoint.recordState !== 'active') {
      setState(payload.checkpointId, 'terminal');
      return;
    }
    dependencies.reserveResume(recovery.checkpoint.checkpointId, recovery.checkpoint.continuationSnapshot.reservedResumeBudget);

    const tasks = recovery.checkpoint.continuationSnapshot.orderedToolCalls.map((toolCall): AgentTaskRecord => {
      const task = recovery.tasks.find((entry): boolean => entry.taskId === toolCall.taskId && entry.toolCallId === toolCall.toolCallId);
      if (!task) throw new Error('coordinator_task_snapshot_incomplete');
      return task;
    });
    if (tasks.length > MAX_CHECKPOINT_TASKS) {
      let latestCheckpoint = recovery.checkpoint;
      tasks.forEach((task): void => {
        if (isTaskTerminal(task.status)) return;
        latestCheckpoint = dependencies.recordPreFailure(task, createLimitError(tasks.length));
      });
      setState(payload.checkpointId, latestCheckpoint.status === 'ready_to_resume' ? 'terminal' : 'running');
      return;
    }

    const authorizedTasks: AgentTaskRecord[] = [];
    const settledTaskIds = new Set<string>();
    let latestCheckpoint = recovery.checkpoint;
    let requiredFailure: { taskId: string } | null = null;

    for (const task of tasks) {
      if (isTaskTerminal(task.status)) {
        settledTaskIds.add(task.taskId);
        continue;
      }
      if (task.currentAttemptId || task.status === 'starting' || task.status === 'running') {
        continue;
      }
      if (task.status === 'queued' && task.queuePhase === 'start' && task.executionPlanSnapshotHash) {
        authorizedTasks.push(task);
        continue;
      }
      const authorization = authorizeTask(task.taskId);
      if (authorization.ok) {
        authorizedTasks.push(authorization.task);
        continue;
      }
      const error = readAgentError(authorization.error);
      if (!error || !isPreAttemptError(error)) {
        setState(payload.checkpointId, 'idle');
        throw authorization.error;
      }
      latestCheckpoint = dependencies.recordPreFailure(task, error);
      settledTaskIds.add(task.taskId);
      if (task.contractSnapshot.required) {
        requiredFailure = { taskId: task.taskId };
        break;
      }
    }

    if (requiredFailure) {
      const siblingError = createSiblingError(requiredFailure.taskId);
      authorizedTasks.forEach((task): void => {
        dependencies.releaseBudget(task.taskId);
      });
      tasks.forEach((task): void => {
        if (settledTaskIds.has(task.taskId) || isTaskTerminal(task.status) || task.currentAttemptId) return;
        latestCheckpoint = dependencies.recordPreFailure(task, siblingError);
        settledTaskIds.add(task.taskId);
      });
      setState(payload.checkpointId, latestCheckpoint.status === 'ready_to_resume' ? 'terminal' : 'running');
      return;
    }

    const runnableTasks = authorizedTasks.filter((task): boolean => task.contractSnapshot.mode === 'read' || (dependencies.isControlledWriteReady?.() ?? true));
    const hasDeferredWrite = runnableTasks.length !== authorizedTasks.length;
    runnableTasks.forEach((task): void => {
      dependencies.registry.ensureActor(task);
      startScheduledTask(task, recovery.checkpoint);
    });
    const hasOutstandingWork = authorizedTasks.length > 0 || tasks.some((task): boolean => !settledTaskIds.has(task.taskId) && !isTaskTerminal(task.status));
    if (hasDeferredWrite) {
      setState(payload.checkpointId, 'idle');
      return;
    }
    setState(payload.checkpointId, latestCheckpoint.status === 'ready_to_resume' || !hasOutstandingWork ? 'terminal' : 'running');
  }

  const coordinator: AgentCoordinator = {
    accept(payload: AgentDelegationCreatedPayload): Promise<void> {
      const existing = inFlight.get(payload.checkpointId);
      if (existing) return existing;
      const current = executions.get(payload.checkpointId)?.status;
      if (current === 'running' || current === 'terminal') return Promise.resolve();
      const execution = coordinate(payload).finally((): void => {
        inFlight.delete(payload.checkpointId);
      });
      inFlight.set(payload.checkpointId, execution);
      return execution;
    },

    async recover(): Promise<void> {
      const recoveries = dependencies.listActive();
      await Promise.all(
        recoveries.map((recovery): Promise<void> => {
          const { checkpoint } = recovery;
          return coordinator.accept({
            checkpointId: checkpoint.checkpointId,
            sessionId: checkpoint.sessionId,
            turnId: checkpoint.turnId
          });
        })
      );
    },

    async cancel(checkpointId: string, reason: string): Promise<void> {
      const normalizedReason = reason.trim();
      if (!normalizedReason) throw new Error('coordinator_cancel_reason_invalid');
      const recovery = dependencies.listActive().find((entry): boolean => entry.checkpoint.checkpointId === checkpointId);
      const checkpoint = dependencies.cancelCheckpoint(checkpointId, normalizedReason);
      setState(checkpointId, isCoordinatorTerminal(checkpoint.status) ? 'terminal' : 'running');
      const cancellationOutcomes = await Promise.allSettled(
        recovery?.tasks.map((task): Promise<AgentTaskCancellationProjection['disposition']> => {
          if (!cancelFlights.has(task.taskId)) cancelReasons.set(task.taskId, normalizedReason);
          return getCancelFlight(task.taskId, 'checkpoint_cascade');
        }) ?? []
      );
      // 所有 Task flight 完成后必须再次驱动 Store 汇合，不能用易失 Coordinator 状态跳过
      // assistant/fence 的最终清理。ready_to_resume 取消也在这一步直接收敛。
      const finalized = dependencies.cancelCheckpoint(checkpointId, normalizedReason);
      setState(checkpointId, isCoordinatorTerminal(finalized.status) ? 'terminal' : 'running');
      const cancellationFailure = cancellationOutcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected');
      if (cancellationFailure) {
        if (!isCoordinatorTerminal(finalized.status)) pendingFinalizations.set(checkpointId, normalizedReason);
        throw cancellationFailure.reason;
      }
    },

    cancelTask(taskId: string): Promise<AgentTaskCancellationProjection['disposition']> {
      if (!cancelFlights.has(taskId)) cancelReasons.set(taskId, 'user_cancelled');
      return getCancelFlight(taskId, 'single_task');
    },

    getCheckpointState(checkpointId: string): AgentCoordinatorState {
      return executions.get(checkpointId)?.status ?? 'idle';
    }
  };
  return coordinator;
}
