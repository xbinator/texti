/**
 * @file coordinator.mts
 * @description 消费持久化 delegation.created 事实，幂等授权并排队只读 Child Task。
 */
import type { ChildActorRegistry } from './child-registry.mjs';
import type { AgentReadLease, AgentReadScheduler, AgentScheduleRequest } from './scheduler.mjs';
import type { AgentCheckpointRecord, AgentDelegationRecoverySnapshot, AgentTaskRecord } from './types.mjs';
import type { AgentDelegationCreatedPayload, AgentTaskError } from 'types/chat-agent';
import { validateAgentTaskError } from './contracts.mjs';
import { isTaskTerminal } from './state.mjs';

/** 首版单个 Checkpoint 允许协调的最大 Task 数。 */
const MAX_CHECKPOINT_TASKS = 6;

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
  /** 资源范围级共享只读调度器。 */
  scheduler: AgentReadScheduler;
  /**
   * lease 获取后的受控执行缝；Task 6 将在此接入 Attempt 与 Child executor。
   * @param task - queued(start) Task
   * @param signal - lease 的 cooperative cancellation 信号
   */
  runTask(task: AgentTaskRecord, signal: AbortSignal): Promise<void>;
  /**
   * 持久化 Checkpoint cooperative cancellation。
   * @param checkpointId - 目标 Checkpoint
   * @param reason - 稳定取消原因
   */
  cancelCheckpoint(checkpointId: string, reason: string): void;
  /** @returns 当前 ISO-8601 时间。 */
  now(): string;
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
 * 取 Task 与 Turn 截止时间中的较早者。
 * @param task - 已授权 Task
 * @param checkpoint - Task 所属 Checkpoint
 * @returns 覆盖排队与执行的绝对截止时间
 */
function resolveDeadline(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord): string {
  const turnDeadline = checkpoint.continuationSnapshot.absoluteTurnDeadline;
  if (!task.deadlineAt) return turnDeadline;
  return Date.parse(task.deadlineAt) <= Date.parse(turnDeadline) ? task.deadlineAt : turnDeadline;
}

/**
 * 从冻结计划构造调度器最小请求。
 * @param task - queued(start) Task
 * @param checkpoint - Task 所属 Checkpoint
 * @returns 不含可变 Runtime 状态的请求
 */
function createScheduleRequest(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord): AgentScheduleRequest {
  if (!task.executionPlanSnapshot || task.contractSnapshot.mode !== 'read') {
    throw new Error('coordinator_execution_plan_missing');
  }
  return {
    taskId: task.taskId,
    priority: task.priority,
    deadlineAt: resolveDeadline(task, checkpoint),
    createdAt: task.createdAt,
    resourceScopes: task.executionPlanSnapshot.resourceScopes,
    mode: 'read'
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

  /**
   * 更新一个 Checkpoint 的进程内状态。
   * @param checkpointId - Checkpoint ID
   * @param status - 新状态
   */
  function setState(checkpointId: string, status: AgentCoordinatorState): void {
    executions.set(checkpointId, { status, updatedAt: dependencies.now() });
  }

  /**
   * 在取得 lease 后调用受控执行缝，并保证所有退出路径只释放一次。
   * @param task - 已授权 Task
   * @param checkpoint - Task 所属 Checkpoint
   */
  async function runScheduledTask(task: AgentTaskRecord, checkpoint: AgentCheckpointRecord): Promise<void> {
    let lease: AgentReadLease | undefined;
    try {
      lease = await dependencies.scheduler.enqueue(createScheduleRequest(task, checkpoint));
      await dependencies.runTask(task, lease.signal);
    } catch {
      // Task 6 接入结构化执行结果前，启动失败保持可恢复 idle，不能伪造 Attempt 或终态。
      if (executions.get(checkpoint.checkpointId)?.status !== 'terminal') {
        setState(checkpoint.checkpointId, 'idle');
      }
    } finally {
      lease?.release();
    }
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
    execution.then((): void => {
      if (taskRuns.get(task.taskId) === execution) taskRuns.delete(task.taskId);
    });
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
      try {
        authorizedTasks.push(dependencies.authorizeReadTask(task.taskId));
      } catch (input) {
        const error = readAgentError(input);
        if (!error || !isPreAttemptError(error)) {
          setState(payload.checkpointId, 'idle');
          throw input;
        }
        latestCheckpoint = dependencies.recordPreFailure(task, error);
        settledTaskIds.add(task.taskId);
        if (task.contractSnapshot.required) {
          requiredFailure = { taskId: task.taskId };
          break;
        }
      }
    }

    if (requiredFailure) {
      const siblingError = createSiblingError(requiredFailure.taskId);
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
      dependencies.cancelCheckpoint(checkpointId, normalizedReason);
      const error: AgentTaskError = {
        code: 'cancelled',
        phase: 'runtime',
        category: 'user',
        retryable: false,
        details: { reason: normalizedReason }
      };
      recovery?.tasks.forEach((task): void => {
        dependencies.scheduler.cancel(task.taskId, normalizedReason);
        if (dependencies.registry.getActor(task.taskId)) dependencies.registry.abortTask(task.taskId, error);
      });
      setState(checkpointId, 'terminal');
    },

    getCheckpointState(checkpointId: string): AgentCoordinatorState {
      return executions.get(checkpointId)?.status ?? 'idle';
    }
  };
  return coordinator;
}
