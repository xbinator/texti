/**
 * @file scheduler.mts
 * @description 按 canonical resource scope 调度 shared-read、write-intent 与 exclusive-commit Child lease。
 */
import type { AgentTaskPriority } from 'types/chat-agent';
import { scopesOverlap } from './resource-scopes.mjs';

/** 所有 Child execution/commit lease 共用的最大活动槽位数。 */
const MAX_ACTIVE_LEASES = 3;

/** JavaScript 计时器单次可安全等待的最大毫秒数。 */
const MAX_TIMER_DELAY = 2_147_483_647;

/** 调度排序使用的固定优先级权重。 */
const PRIORITY_WEIGHT: Readonly<Record<AgentTaskPriority, number>> = {
  low: 0,
  normal: 1,
  high: 2
};

/** 资源许可种类。 */
export type AgentResourceLeaseKind = 'shared-read' | 'write-intent' | 'exclusive-commit';

/** Scheduler 接受的冻结 Task/phase claim。 */
export interface AgentScheduleRequest {
  /** Task 稳定身份。 */
  readonly taskId: string;
  /** start model execution 或 commit 阶段。 */
  readonly phase: 'start' | 'commit';
  /** 资源许可种类。 */
  readonly kind: AgentResourceLeaseKind;
  /** 持久化调度优先级。 */
  readonly priority: AgentTaskPriority;
  /** 覆盖排队和执行的绝对截止时间。 */
  readonly deadlineAt: string;
  /** Task 不可变创建时间。 */
  readonly createdAt: string;
  /** 一次性获取的完整 canonical scopes。 */
  readonly resourceScopes: readonly string[];
}

/** 已取得的资源 lease。 */
export interface AgentResourceLease {
  /** lease 所属 Task。 */
  readonly taskId: string;
  /** lease 所属 Task phase。 */
  readonly phase: AgentScheduleRequest['phase'];
  /** 已取得的许可种类。 */
  readonly kind: AgentResourceLeaseKind;
  /** deadline 或取消传播使用的协作中止信号。 */
  readonly signal: AbortSignal;
  /** 幂等释放全部 scopes 和全局活动槽位。 */
  release(): void;
}

/** Scheduler 单 Task 取消仲裁结果。 */
export type AgentScheduleCancelDisposition = 'not_found' | 'queued_cancelled' | 'active_signalled';

/** resource-scoped Child Task 调度器边界。 */
export interface AgentResourceScheduler {
  /**
   * 幂等排队一个冻结 Task phase。
   * @param request - 完整资源调度请求
   * @returns 原子取得全部 scopes 后的 lease
   */
  enqueue(request: AgentScheduleRequest): Promise<AgentResourceLease>;
  /**
   * 取消排队 Task，或向活动 Task 传播协作中止。
   * @param taskId - Task 身份
   * @param reason - 稳定取消原因
   * @returns 未找到、赢得队列移除或向活动 lease 发出信号
   */
  cancel(taskId: string, reason: string): AgentScheduleCancelDisposition;
  /** @returns 当前活动 lease 数。 */
  activeCount(): number;
  /** @returns 当前等待 lease 数。 */
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

/** Scheduler 条目生命周期。 */
type ScheduleEntryState = 'queued' | 'active' | 'released';

/** 单个 Task phase 的进程内调度条目。 */
interface ScheduleEntry {
  /** 规范化调度请求。 */
  readonly request: Readonly<AgentScheduleRequest>;
  /** taskId:phase 幂等键。 */
  readonly key: string;
  /** deadline 与取消共享的控制器。 */
  readonly controller: AbortController;
  /** 精确重放 enqueue 返回的同一个 Promise。 */
  readonly promise: Promise<AgentResourceLease>;
  /** lease 成功回调。 */
  readonly resolve: (lease: AgentResourceLease) => void;
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
 * 规范化、验证、去重并排序 canonical scopes。
 * @param resourceScopes - 冻结计划范围
 * @returns 稳定资源范围集合
 */
function normalizeScopes(resourceScopes: readonly string[]): readonly string[] {
  if (!Array.isArray(resourceScopes)) throw new AgentSchedulerError('protocol_error', 'schedule_resource_scope_invalid');
  const scopes = [...new Set(resourceScopes)].sort();
  if (scopes.length === 0) throw new AgentSchedulerError('protocol_error', 'schedule_resource_scope_empty');
  for (const scope of scopes) {
    if (typeof scope !== 'string') throw new AgentSchedulerError('protocol_error', 'schedule_resource_scope_invalid');
    try {
      scopesOverlap(scope, scope);
    } catch {
      throw new AgentSchedulerError('protocol_error', 'schedule_resource_scope_invalid');
    }
  }
  return Object.freeze(scopes);
}

/**
 * 判断 phase 与 lease kind 是否形成合法协议组合。
 * @param phase - 请求阶段
 * @param kind - 许可种类
 * @returns start 只允许 read/write-intent，commit 只允许 exclusive-commit
 */
function isPhaseKindValid(phase: AgentScheduleRequest['phase'], kind: AgentResourceLeaseKind): boolean {
  return phase === 'commit' ? kind === 'exclusive-commit' : kind === 'shared-read' || kind === 'write-intent';
}

/**
 * 创建不可变、可确定比较的调度请求。
 * @param request - 外部请求
 * @returns 规范化请求
 */
function normalizeRequest(request: AgentScheduleRequest): Readonly<AgentScheduleRequest> {
  if (
    (request.phase !== 'start' && request.phase !== 'commit') ||
    !['shared-read', 'write-intent', 'exclusive-commit'].includes(request.kind) ||
    !isPhaseKindValid(request.phase, request.kind) ||
    !(request.priority in PRIORITY_WEIGHT)
  ) {
    throw new AgentSchedulerError('protocol_error', 'schedule_request_invalid');
  }
  return Object.freeze({
    taskId: requireText(request.taskId, 'schedule_task_id_invalid'),
    phase: request.phase,
    kind: request.kind,
    priority: request.priority,
    deadlineAt: normalizeTime(request.deadlineAt, 'schedule_deadline_invalid'),
    createdAt: normalizeTime(request.createdAt, 'schedule_created_at_invalid'),
    resourceScopes: normalizeScopes(request.resourceScopes)
  });
}

/**
 * 创建 Task phase 幂等键。
 * @param request - 规范化请求
 * @returns taskId:phase
 */
function createEntryKey(request: Pick<AgentScheduleRequest, 'taskId' | 'phase'>): string {
  return `${request.taskId}:${request.phase}`;
}

/**
 * 判断同一 Task phase 的重放请求是否保持不可变。
 * @param left - 已存在请求
 * @param right - 重放请求
 * @returns claim 是否完全一致
 */
function requestsMatch(left: Readonly<AgentScheduleRequest>, right: Readonly<AgentScheduleRequest>): boolean {
  return (
    left.taskId === right.taskId &&
    left.phase === right.phase &&
    left.kind === right.kind &&
    left.priority === right.priority &&
    left.deadlineAt === right.deadlineAt &&
    left.createdAt === right.createdAt &&
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
 * 判断两个 claim 是否有任一 canonical scope 重叠。
 * @param left - 左侧请求
 * @param right - 右侧请求
 * @returns 是否存在资源交集
 */
function claimsOverlap(left: Readonly<AgentScheduleRequest>, right: Readonly<AgentScheduleRequest>): boolean {
  return left.resourceScopes.some((leftScope): boolean => right.resourceScopes.some((rightScope): boolean => scopesOverlap(leftScope, rightScope)));
}

/**
 * 判断两个资源许可是否可以同时持有。
 * @param left - 已活动许可
 * @param right - 待获取许可
 * @returns scope 不重叠，或重叠但双方都是 shared-read
 */
function claimsCompatible(left: Readonly<AgentScheduleRequest>, right: Readonly<AgentScheduleRequest>): boolean {
  if (!claimsOverlap(left, right)) return true;
  return left.kind === 'shared-read' && right.kind === 'shared-read';
}

/**
 * 创建 resource-scoped Agent 调度器。
 * @returns 最多三个活动 lease 的确定性调度器
 */
export function createAgentResourceScheduler(): AgentResourceScheduler {
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
    entries.delete(entry.key);
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
    if (entry.state === 'active' && !entry.controller.signal.aborted) entry.controller.abort(error);
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
   * 判断候选 reader 是否会越过排序在前的同级或更高优先级冲突 writer。
   * @param candidate - 待读取候选
   * @returns 是否必须为 writer fairness 留在队列
   */
  function isWriterBlocked(candidate: ScheduleEntry): boolean {
    if (candidate.request.kind !== 'shared-read') return false;
    const candidateIndex = queued.indexOf(candidate);
    return queued
      .slice(0, candidateIndex)
      .some(
        (writer): boolean =>
          writer.request.kind !== 'shared-read' &&
          PRIORITY_WEIGHT[writer.request.priority] >= PRIORITY_WEIGHT[candidate.request.priority] &&
          claimsOverlap(writer.request, candidate.request)
      );
  }

  /**
   * 判断条目能否原子取得全部 scopes。
   * @param entry - 待启动条目
   * @returns 是否具备槽位、活动兼容性和 writer fairness
   */
  function canAcquire(entry: ScheduleEntry): boolean {
    return (
      active.size < MAX_ACTIVE_LEASES &&
      !isWriterBlocked(entry) &&
      [...active.values()].every((activeEntry): boolean => claimsCompatible(activeEntry.request, entry.request))
    );
  }

  /**
   * 激活条目并创建幂等 release lease。
   * @param entry - 可取得资源的条目
   * @param continueQueue - 释放后继续填充队列
   */
  function activateEntry(entry: ScheduleEntry, continueQueue: () => void): void {
    if (entry.state !== 'queued') return;
    removeQueued(entry);
    entry.state = 'active';
    active.set(entry.key, entry);
    let released = false;
    const lease: AgentResourceLease = Object.freeze({
      taskId: entry.request.taskId,
      phase: entry.request.phase,
      kind: entry.request.kind,
      signal: entry.controller.signal,
      release(): void {
        if (released) return;
        released = true;
        if (entry.state !== 'active') return;
        entry.state = 'released';
        active.delete(entry.key);
        entries.delete(entry.key);
        clearDeadline(entry);
        continueQueue();
      }
    });
    entry.resolve(lease);
  }

  /** 按确定顺序尽可能填满全局活动槽位。 */
  function drainQueue(): void {
    queued.sort(compareEntries);
    while (active.size < MAX_ACTIVE_LEASES && queued.length > 0) {
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
    let resolveLease: (lease: AgentResourceLease) => void = (): void => undefined;
    let rejectLease: (error: AgentSchedulerError) => void = (): void => undefined;
    const promise = new Promise<AgentResourceLease>((resolve, reject): void => {
      resolveLease = resolve;
      rejectLease = reject;
    });
    return {
      request,
      key: createEntryKey(request),
      controller: new AbortController(),
      promise,
      resolve: resolveLease,
      reject: rejectLease,
      state: 'queued'
    };
  }

  return {
    enqueue(request: AgentScheduleRequest): Promise<AgentResourceLease> {
      let normalized: Readonly<AgentScheduleRequest>;
      try {
        normalized = normalizeRequest(request);
      } catch (error) {
        return Promise.reject(error);
      }
      const key = createEntryKey(normalized);
      const existing = entries.get(key);
      if (existing) {
        if (!requestsMatch(existing.request, normalized)) {
          return Promise.reject(createScheduleError('protocol_error', 'schedule_replay_conflict'));
        }
        return existing.promise;
      }
      const activePhase = [...entries.values()].find((entry): boolean => entry.request.taskId === normalized.taskId);
      if (activePhase) return Promise.reject(createScheduleError('protocol_error', 'schedule_task_phase_conflict'));
      if (Date.parse(normalized.deadlineAt) <= Date.now()) {
        return Promise.reject(createScheduleError('deadline_exceeded', 'schedule_deadline_exceeded'));
      }
      const entry = createEntry(normalized);
      entries.set(entry.key, entry);
      queued.push(entry);
      scheduleDeadline(entry);
      drainQueue();
      return entry.promise;
    },

    cancel(taskId: string, reason: string): AgentScheduleCancelDisposition {
      const normalizedTaskId = taskId.trim();
      const normalizedReason = reason.trim();
      if (!normalizedTaskId || !normalizedReason) {
        throw createScheduleError('protocol_error', 'schedule_cancel_input_invalid');
      }
      const entry = [...entries.values()].find((candidate): boolean => candidate.request.taskId === normalizedTaskId);
      if (!entry || entry.state === 'released') return 'not_found';
      const error = createScheduleError('cancelled', normalizedReason);
      if (entry.state === 'queued') {
        rejectQueued(entry, error);
        drainQueue();
        return 'queued_cancelled';
      }
      if (!entry.controller.signal.aborted) entry.controller.abort(error);
      return 'active_signalled';
    },

    activeCount(): number {
      return active.size;
    },

    queuedCount(): number {
      return queued.length;
    }
  };
}
