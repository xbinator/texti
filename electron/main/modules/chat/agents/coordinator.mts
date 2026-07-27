/**
 * @file coordinator.mts
 * @description 消费持久化 delegation.created 事实，幂等授权并排队只读 Child Task。
 */
import type { ChildActorRegistry } from './child-registry.mjs';
import type { ChildTaskRuntimeExecutor } from './executor.mjs';
import type { AgentResourceLease, AgentResourceScheduler, AgentScheduleRequest } from './scheduler.mjs';
import type {
  AgentAttemptProjection,
  AgentCheckpointRecord,
  AgentDelegationRecoverySnapshot,
  AgentTaskRecord,
  BeginAgentAttemptInput,
  MarkAgentAttemptInput
} from './types.mjs';
import type {
  AgentBudgetSnapshot,
  AgentCheckpointStatus,
  AgentDelegationCreatedPayload,
  AgentTaskError,
  AgentUsageAccounting,
  ChatAgentResult
} from 'types/chat-agent';
import type { ChatRuntimeAddress } from 'types/chat-runtime';
import { validateAgentTaskError } from './contracts.mjs';
import { isTaskTerminal } from './state.mjs';

/** 首版单个 Checkpoint 允许协调的最大 Task 数。 */
const MAX_CHECKPOINT_TASKS = 6;

/** 生产默认单个 Child 覆盖排队和执行的最长时间。 */
const DEFAULT_CHILD_TIMEOUT_MS = 30 * 60 * 1_000;

/** 生产默认 cooperative cancellation 宽限期。 */
const DEFAULT_CANCEL_GRACE_MS = 2_000;

/** Coordinator 对一个 Checkpoint 的进程内执行状态。 */
export type AgentCoordinatorState = 'idle' | 'planning' | 'running' | 'terminal';

/** Main-owned Coordinator 的可信依赖。 */
export interface AgentCoordinatorDependencies {
  /** @returns 全部持久化非终态 Checkpoint 聚合。 */
  listActive(): AgentDelegationRecoverySnapshot[];
  /**
   * 编译、校验并冻结一个只读 Task 计划。
   * @param taskId - created Task
   * @returns queued(start) Task
   */
  authorizeReadTask(taskId: string): AgentTaskRecord;
  /**
   * 原子记录不含 Attempt 的授权前失败。
   * @param task - 失败所属 Task
   * @param error - 不可重试计划或资源错误
   * @returns 推进后的 Checkpoint
   */
  recordPreFailure(task: AgentTaskRecord, error: AgentTaskError): AgentCheckpointRecord;
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

/** Coordinator 同步授权调用的判别结果。 */
type CoordinatorAuthorization = { ok: true; task: AgentTaskRecord } | { ok: false; error: unknown };

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
 * @returns 不含可变 Runtime 状态的请求
 */
function createScheduleRequest(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, now: string, systemTimeoutMs: number): AgentScheduleRequest {
  if (!task.executionPlanSnapshot || task.contractSnapshot.mode !== 'read') {
    throw new Error('coordinator_execution_plan_missing');
  }
  return {
    taskId: task.taskId,
    phase: 'start',
    kind: 'shared-read',
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
function createFailureSummary(status: Extract<ChatAgentResult['executionStatus'], 'failed' | 'cancelled' | 'deadline_exceeded'>): string {
  if (status === 'cancelled') return 'Child execution was cancelled.';
  if (status === 'deadline_exceeded') return 'Child execution exceeded its deadline.';
  return 'Child execution failed.';
}

/**
 * 创建 Coordinator 在已有 Attempt 上收敛异常所需的完整结果。
 * @param projection - 已持久化 Attempt 投影
 * @param status - 执行终态
 * @param error - 结构化错误
 * @returns 零 Provider 用量的安全结果
 */
function createFailureResult(
  projection: AgentAttemptProjection,
  status: Extract<ChatAgentResult['executionStatus'], 'failed' | 'cancelled' | 'deadline_exceeded'>,
  error: AgentTaskError
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
    usage: createZeroUsage(projection.task),
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
function normalizeAbortResult(result: ChatAgentResult, signal: AbortSignal): ChatAgentResult {
  const abortResult = readAbortResult(signal);
  if (!abortResult || abortResult.status !== 'deadline_exceeded' || result.executionStatus !== 'cancelled') return result;
  return {
    ...result,
    executionStatus: 'deadline_exceeded',
    summary: 'Child execution exceeded its deadline.',
    error: abortResult.error
  };
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
 * 创建 Main-owned Child Coordinator。
 * @param dependencies - Store、授权器、Registry 和调度入口
 * @returns 幂等 Coordinator
 */
export function createAgentCoordinator(dependencies: AgentCoordinatorDependencies): AgentCoordinator {
  const executions = new Map<string, CoordinatorExecution>();
  const inFlight = new Map<string, Promise<void>>();
  const taskRuns = new Map<string, Promise<void>>();
  const runtimeIds = new Map<string, string>();
  const abortTimers = new Map<string, ReturnType<typeof setTimeout>>();
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
   * 在同步授权边界捕获可信结构化错误。
   * @param taskId - 待授权 Task
   * @returns 授权后的 Task 或原始错误
   */
  function authorizeTask(taskId: string): CoordinatorAuthorization {
    try {
      return { ok: true, task: dependencies.authorizeReadTask(taskId) };
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
  async function waitTaskRuns(executionsToWait: readonly Promise<void>[]): Promise<void> {
    if (executionsToWait.length === 0) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const boundedWait = new Promise<void>((resolve): void => {
      timeout = setTimeout(resolve, cancellationGraceMs * 2);
    });
    await Promise.race([Promise.allSettled(executionsToWait).then((): void => undefined), boundedWait]);
    if (timeout) clearTimeout(timeout);
  }

  /**
   * 把完整结果写入 rendezvous 并结算预算。
   * @param task - 结果所属 Task
   * @param result - 完整 Child 结果
   */
  async function commitTaskResult(task: AgentTaskRecord, result: ChatAgentResult): Promise<void> {
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
  }

  /**
   * 在已取得 lease 后创建 Attempt、绑定 Runtime、执行并汇合结果。
   * @param task - 已授权 Task
   * @param checkpoint - Task 所属 Checkpoint
   * @param lease - 已取得的资源许可
   */
  async function executeLease(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord, lease: AgentResourceLease): Promise<void> {
    const runtimeId = dependencies.createRuntimeId(task);
    const attemptId = `attempt-${runtimeId}`;
    const beginInput: BeginAgentAttemptInput = {
      taskId: task.taskId,
      attemptId,
      parentRuntimeId: checkpoint.sourceRuntimeId,
      runtimeId,
      occurredAt: dependencies.now()
    };
    const [beginOutcome] = await Promise.allSettled([Promise.resolve().then((): AgentAttemptProjection => dependencies.beginAttempt(beginInput))]);
    if (beginOutcome.status === 'rejected') {
      await cancelBeforeAttempt(task, checkpoint, 'attempt_start_rejected');
      return;
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
      return;
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
    let result: ChatAgentResult;
    if (executionOutcome.status === 'fulfilled') {
      result = normalizeAbortResult(executionOutcome.value, lease.signal);
    } else if (abortResult) {
      result = createFailureResult(projection, abortResult.status, abortResult.error);
    } else {
      result = createFailureResult(projection, 'failed', createRuntimeError('runtime', 'runtime_execution_rejected', runtimeId));
    }
    await commitTaskResult(projection.task, result);
  }

  /**
   * 在取得 lease 后执行完整 Child 链路，并保证所有退出路径只释放一次。
   * @param task - 已授权 Task
   * @param checkpoint - Task 所属 Checkpoint
   */
  async function runScheduledTask(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord): Promise<void> {
    const [leaseOutcome] = await Promise.allSettled([
      dependencies.scheduler.enqueue(createScheduleRequest(task, checkpoint, dependencies.now(), systemChildTimeoutMs))
    ]);
    if (leaseOutcome.status === 'rejected') {
      await cancelBeforeAttempt(task, checkpoint, readScheduleReason(leaseOutcome.reason));
      return;
    }
    const lease = leaseOutcome.value;
    await Promise.allSettled([executeLease(task, checkpoint, lease)]);
    clearAbortTimer(task.taskId);
    const runtimeId = runtimeIds.get(task.taskId);
    if (runtimeId) {
      await Promise.allSettled([
        Promise.resolve().then((): void => {
          dependencies.registry.unbindRuntime(runtimeId);
        })
      ]);
    }
    runtimeIds.delete(task.taskId);
    lease.release();
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

    authorizedTasks.forEach((task): void => {
      dependencies.registry.ensureActor(task);
      startScheduledTask(task, recovery.checkpoint);
    });
    const hasOutstandingWork = authorizedTasks.length > 0 || tasks.some((task): boolean => !settledTaskIds.has(task.taskId) && !isTaskTerminal(task.status));
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
      const error: AgentTaskError = {
        code: 'cancelled',
        phase: 'runtime',
        category: 'user',
        retryable: false,
        details: { reason: normalizedReason }
      };
      recovery?.tasks.forEach((task): void => {
        const runtimeId = runtimeIds.get(task.taskId);
        dependencies.scheduler.cancel(task.taskId, normalizedReason);
        if (dependencies.registry.getActor(task.taskId)) dependencies.registry.abortTask(task.taskId, error);
        if (runtimeId && !abortTimers.has(task.taskId)) {
          const timer = setTimeout((): void => {
            abortTimers.delete(task.taskId);
            dependencies.executor.abort(runtimeId, normalizedReason);
          }, cancellationGraceMs);
          abortTimers.set(task.taskId, timer);
        }
      });
      setState(checkpointId, isCoordinatorTerminal(checkpoint.status) ? 'terminal' : 'running');
      const activeRuns = recovery?.tasks
        .map((task): Promise<void> | undefined => taskRuns.get(task.taskId))
        .filter((execution): execution is Promise<void> => execution !== undefined);
      if (activeRuns && activeRuns.length > 0) await waitTaskRuns(activeRuns);
      if (executions.get(checkpointId)?.status !== 'terminal') {
        const finalized = dependencies.cancelCheckpoint(checkpointId, normalizedReason);
        setState(checkpointId, isCoordinatorTerminal(finalized.status) ? 'terminal' : 'running');
      }
    },

    getCheckpointState(checkpointId: string): AgentCoordinatorState {
      return executions.get(checkpointId)?.status ?? 'idle';
    }
  };
  return coordinator;
}
