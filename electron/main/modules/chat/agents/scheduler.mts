/**
 * @file scheduler.mts
 * @description 按资源范围确定性调度最多三个并行的共享只读 Child Task。
 */
import type { AgentTaskPriority } from 'types/chat-agent';

/** 首版允许同时运行的共享只读 Child Task 数。 */
const MAX_PARALLEL_READS = 3;

/** JavaScript 计时器单次可安全等待的最大毫秒数。 */
const MAX_TIMER_DELAY = 2_147_483_647;

/** 调度排序使用的固定优先级权重。 */
const PRIORITY_WEIGHT: Readonly<Record<AgentTaskPriority, number>> = {
  low: 0,
  normal: 1,
  high: 2
};

/** 调度器接受的冻结只读 Task 投影。 */
export interface AgentScheduleRequest {
  /** Task 稳定身份。 */
  readonly taskId: string;
  /** 持久化调度优先级。 */
  readonly priority: AgentTaskPriority;
  /** 覆盖排队和执行的绝对截止时间。 */
  readonly deadlineAt: string;
  /** Task 不可变创建时间。 */
  readonly createdAt: string;
  /** 一次性获取的完整规范化资源范围。 */
  readonly resourceScopes: readonly string[];
  /** 首版仅开放 read。 */
  readonly mode: 'read';
}

/** 已取得的共享只读 lease。 */
export interface AgentReadLease {
  /** lease 所属 Task。 */
  readonly taskId: string;
  /** deadline 或取消传播使用的协作中止信号。 */
  readonly signal: AbortSignal;
  /** 幂等释放全部资源范围和并行名额。 */
  release(): void;
}

/** 只读 Child Task 调度器边界。 */
export interface AgentReadScheduler {
  /**
   * 幂等排队一个冻结 Task。
   * @param request - 完整只读调度请求
   * @returns 取得全部资源范围后的 lease
   */
  enqueue(request: AgentScheduleRequest): Promise<AgentReadLease>;
  /**
   * 取消排队 Task，或向活动 Task 传播协作中止。
   * @param taskId - Task 身份
   * @param reason - 稳定取消原因
   * @returns 是否找到可取消的 Task
   */
  cancel(taskId: string, reason: string): boolean;
  /** @returns 当前活动 lease 数。 */
  activeCount(): number;
  /** @returns 当前等待 lease 的 Task 数。 */
  queuedCount(): number;
}

/** Scheduler 可观察的稳定错误码。 */
export type AgentSchedulerErrorCode = 'cancelled' | 'deadline_exceeded' | 'protocol_error';

/** Scheduler 队列阶段的结构化错误。 */
export class AgentSchedulerError extends Error {
  /** 机器可判断的调度错误码。 */
  readonly code: AgentSchedulerErrorCode;

  /** 调度错误固定发生在 queue phase。 */
  readonly phase = 'queue';

  /** 不依赖展示文本的稳定原因。 */
  readonly reason: string;

  /**
   * 创建 Scheduler 错误。
   * @param code - 稳定错误码
   * @param reason - 稳定机器原因
   */
  constructor(code: AgentSchedulerErrorCode, reason: string) {
    super(reason);
    this.name = 'AgentSchedulerError';
    this.code = code;
    this.reason = reason;
  }
}

/** 内部资源许可种类，保留后续写入和提交兼容判定位置。 */
type ResourceLeaseKind = 'shared-read' | 'write-intent' | 'exclusive-commit';

/** 一次性获取的资源许可声明。 */
interface ResourceLeaseClaim {
  /** 许可种类。 */
  readonly kind: ResourceLeaseKind;
  /** 已规范化并冻结的全部资源范围。 */
  readonly scopes: readonly string[];
}

/** Scheduler 条目生命周期。 */
type ScheduleEntryState = 'queued' | 'active' | 'released';

/** 单个 Task 的进程内调度条目。 */
interface ScheduleEntry {
  /** 规范化调度请求。 */
  readonly request: Readonly<AgentScheduleRequest>;
  /** 资源许可声明。 */
  readonly claim: ResourceLeaseClaim;
  /** deadline 与取消共享的控制器。 */
  readonly controller: AbortController;
  /** 重放 enqueue 返回的同一个 Promise。 */
  readonly promise: Promise<AgentReadLease>;
  /** lease 成功回调。 */
  readonly resolve: (lease: AgentReadLease) => void;
  /** 排队失败回调。 */
  readonly reject: (error: AgentSchedulerError) => void;
  /** 当前条目状态。 */
  state: ScheduleEntryState;
  /** deadline 计时器。 */
  deadlineTimer?: ReturnType<typeof setTimeout>;
}

/**
 * 规范化非空字符串。
 * @param value - 外部请求值
 * @param reason - 无效时的稳定原因
 * @returns 去除首尾空白的字符串
 */
function requireText(value: string, reason: string): string {
  const normalized = value.trim();
  if (!normalized) throw new AgentSchedulerError('protocol_error', reason);
  return normalized;
}

/**
 * 规范化绝对 ISO 时间。
 * @param value - 时间输入
 * @param reason - 无效时的稳定原因
 * @returns 规范化 ISO 时间
 */
function normalizeTime(value: string, reason: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new AgentSchedulerError('protocol_error', reason);
  return new Date(timestamp).toISOString();
}

/**
 * 规范化、去重并排序资源范围。
 * @param resourceScopes - 冻结计划范围
 * @returns 稳定资源范围集合
 */
function normalizeScopes(resourceScopes: readonly string[]): readonly string[] {
  const scopes = [...new Set(resourceScopes.map((scope): string => requireText(scope, 'schedule_resource_scope_invalid')))].sort();
  if (scopes.length === 0) throw new AgentSchedulerError('protocol_error', 'schedule_resource_scope_empty');
  return Object.freeze(scopes);
}

/**
 * 创建不可变、可确定比较的调度请求。
 * @param request - 外部请求
 * @returns 规范化请求
 */
function normalizeRequest(request: AgentScheduleRequest): Readonly<AgentScheduleRequest> {
  if (request.mode !== 'read' || !(request.priority in PRIORITY_WEIGHT)) {
    throw new AgentSchedulerError('protocol_error', 'schedule_request_invalid');
  }
  return Object.freeze({
    taskId: requireText(request.taskId, 'schedule_task_id_invalid'),
    priority: request.priority,
    deadlineAt: normalizeTime(request.deadlineAt, 'schedule_deadline_invalid'),
    createdAt: normalizeTime(request.createdAt, 'schedule_created_at_invalid'),
    resourceScopes: normalizeScopes(request.resourceScopes),
    mode: 'read'
  });
}

/**
 * 判断同一 Task 的重放请求是否保持不可变。
 * @param left - 已存在请求
 * @param right - 重放请求
 * @returns 请求是否完全一致
 */
function requestsMatch(left: Readonly<AgentScheduleRequest>, right: Readonly<AgentScheduleRequest>): boolean {
  return (
    left.taskId === right.taskId &&
    left.priority === right.priority &&
    left.deadlineAt === right.deadlineAt &&
    left.createdAt === right.createdAt &&
    left.mode === right.mode &&
    left.resourceScopes.length === right.resourceScopes.length &&
    left.resourceScopes.every((scope, index): boolean => scope === right.resourceScopes[index])
  );
}

/**
 * 按 priority 降序、createdAt 升序、taskId 升序比较队列。
 * @param left - 左侧条目
 * @param right - 右侧条目
 * @returns Array.sort 比较值
 */
function compareEntries(left: ScheduleEntry, right: ScheduleEntry): number {
  const priorityOrder = PRIORITY_WEIGHT[right.request.priority] - PRIORITY_WEIGHT[left.request.priority];
  if (priorityOrder !== 0) return priorityOrder;
  const createdOrder = left.request.createdAt.localeCompare(right.request.createdAt);
  if (createdOrder !== 0) return createdOrder;
  return left.request.taskId.localeCompare(right.request.taskId);
}

/**
 * 判断两个资源许可是否可以同时持有。
 * @param left - 已活动许可
 * @param right - 待获取许可
 * @returns 当前阶段是否相容
 */
function claimsCompatible(left: ResourceLeaseClaim, right: ResourceLeaseClaim): boolean {
  // 首版 shared-read 即使 scope 重叠也相容；后续写入阶段在此加入 scope 冲突判定。
  return left.kind === 'shared-read' && right.kind === 'shared-read';
}

/**
 * 创建最多三个并行的只读资源调度器。
 * @returns 进程内确定性调度器
 */
export function createAgentReadScheduler(): AgentReadScheduler {
  const entries = new Map<string, ScheduleEntry>();
  const queued: ScheduleEntry[] = [];
  const active = new Map<string, ScheduleEntry>();

  /**
   * 清理条目的 deadline 计时器。
   * @param entry - 调度条目
   */
  function clearDeadline(entry: ScheduleEntry): void {
    if (!entry.deadlineTimer) return;
    clearTimeout(entry.deadlineTimer);
    entry.deadlineTimer = undefined;
  }

  /**
   * 创建 deadline 或 cancel 对应的 Scheduler 错误。
   * @param code - 错误码
   * @param reason - 稳定原因
   * @returns 调度错误
   */
  function createScheduleError(code: AgentSchedulerErrorCode, reason: string): AgentSchedulerError {
    return new AgentSchedulerError(code, reason);
  }

  /**
   * 从等待队列移除指定条目。
   * @param entry - 待移除条目
   */
  function removeQueued(entry: ScheduleEntry): void {
    const index = queued.indexOf(entry);
    if (index >= 0) queued.splice(index, 1);
  }

  /**
   * 在队列阶段终止一个条目。
   * @param entry - 排队条目
   * @param error - 稳定终止原因
   */
  function rejectQueued(entry: ScheduleEntry, error: AgentSchedulerError): void {
    if (entry.state !== 'queued') return;
    entry.state = 'released';
    removeQueued(entry);
    entries.delete(entry.request.taskId);
    clearDeadline(entry);
    entry.controller.abort(error);
    entry.reject(error);
  }

  /**
   * 处理 deadline 到期。
   * @param entry - 到期条目
   */
  function expireEntry(entry: ScheduleEntry): void {
    const error = createScheduleError('deadline_exceeded', 'schedule_deadline_exceeded');
    if (entry.state === 'queued') {
      rejectQueued(entry, error);
      return;
    }
    if (entry.state === 'active' && !entry.controller.signal.aborted) {
      entry.controller.abort(error);
    }
  }

  /**
   * 为条目安排 deadline 检查，长时间等待会分段重排计时器。
   * @param entry - 调度条目
   */
  function scheduleDeadline(entry: ScheduleEntry): void {
    clearDeadline(entry);
    const remaining = Date.parse(entry.request.deadlineAt) - Date.now();
    if (remaining <= 0) {
      expireEntry(entry);
      return;
    }
    entry.deadlineTimer = setTimeout((): void => {
      scheduleDeadline(entry);
    }, Math.min(remaining, MAX_TIMER_DELAY));
  }

  /**
   * 判断一个条目能否原子取得全部资源范围。
   * @param entry - 待启动条目
   * @returns 是否具备并行名额且与活动许可相容
   */
  function canAcquire(entry: ScheduleEntry): boolean {
    return active.size < MAX_PARALLEL_READS && [...active.values()].every((activeEntry): boolean => claimsCompatible(activeEntry.claim, entry.claim));
  }

  /**
   * 激活条目并创建幂等 release lease。
   * @param entry - 已排在队首的条目
   * @param continueQueue - 释放后继续填充队列
   */
  function activateEntry(entry: ScheduleEntry, continueQueue: () => void): void {
    if (entry.state !== 'queued') return;
    removeQueued(entry);
    entry.state = 'active';
    active.set(entry.request.taskId, entry);
    let released = false;
    const lease: AgentReadLease = Object.freeze({
      taskId: entry.request.taskId,
      signal: entry.controller.signal,
      release(): void {
        if (released) return;
        released = true;
        if (entry.state !== 'active') return;
        entry.state = 'released';
        active.delete(entry.request.taskId);
        entries.delete(entry.request.taskId);
        clearDeadline(entry);
        continueQueue();
      }
    });
    entry.resolve(lease);
  }

  /** 按确定顺序尽可能填满共享只读并行名额。 */
  function drainQueue(): void {
    queued.sort(compareEntries);
    while (active.size < MAX_PARALLEL_READS && queued.length > 0) {
      const entry = queued.find((candidate): boolean => canAcquire(candidate));
      if (!entry) return;
      if (Date.parse(entry.request.deadlineAt) <= Date.now()) {
        expireEntry(entry);
        continue;
      }
      activateEntry(entry, drainQueue);
    }
  }

  /**
   * 创建一个未决 Scheduler 条目。
   * @param request - 规范化请求
   * @returns 未决条目
   */
  function createEntry(request: Readonly<AgentScheduleRequest>): ScheduleEntry {
    let resolveLease: (lease: AgentReadLease) => void = (): void => undefined;
    let rejectLease: (error: AgentSchedulerError) => void = (): void => undefined;
    const promise = new Promise<AgentReadLease>((resolve, reject): void => {
      resolveLease = resolve;
      rejectLease = reject;
    });
    return {
      request,
      claim: {
        kind: 'shared-read',
        scopes: request.resourceScopes
      },
      controller: new AbortController(),
      promise,
      resolve: resolveLease,
      reject: rejectLease,
      state: 'queued'
    };
  }

  return {
    enqueue(request: AgentScheduleRequest): Promise<AgentReadLease> {
      let normalized: Readonly<AgentScheduleRequest>;
      try {
        normalized = normalizeRequest(request);
      } catch (error) {
        return Promise.reject(error);
      }
      const existing = entries.get(normalized.taskId);
      if (existing) {
        if (!requestsMatch(existing.request, normalized)) {
          return Promise.reject(createScheduleError('protocol_error', 'schedule_replay_conflict'));
        }
        return existing.promise;
      }
      if (Date.parse(normalized.deadlineAt) <= Date.now()) {
        return Promise.reject(createScheduleError('deadline_exceeded', 'schedule_deadline_exceeded'));
      }
      const entry = createEntry(normalized);
      entries.set(normalized.taskId, entry);
      queued.push(entry);
      scheduleDeadline(entry);
      drainQueue();
      return entry.promise;
    },

    cancel(taskId: string, reason: string): boolean {
      const normalizedTaskId = taskId.trim();
      const normalizedReason = reason.trim();
      if (!normalizedTaskId || !normalizedReason) {
        throw createScheduleError('protocol_error', 'schedule_cancel_input_invalid');
      }
      const entry = entries.get(normalizedTaskId);
      if (!entry || entry.state === 'released') return false;
      const error = createScheduleError('cancelled', normalizedReason);
      if (entry.state === 'queued') {
        rejectQueued(entry, error);
        drainQueue();
        return true;
      }
      if (!entry.controller.signal.aborted) entry.controller.abort(error);
      return true;
    },

    activeCount(): number {
      return active.size;
    },

    queuedCount(): number {
      return queued.length;
    }
  };
}
