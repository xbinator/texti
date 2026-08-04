/**
 * @file tool-watchdog.mts
 * @description 统一管理 Chat Runtime 工具活性、实质进展、等待与取消边界。
 */
import type { AIToolExecutionError, AIToolExecutionResult, ChatToolActivitySnapshot, ChatToolArtifactRef, ChatToolProgressSnapshot } from 'types/ai';
import type { ChatRuntimeControlToolInput, ChatRuntimeSubmitToolActivityInput, ChatRuntimeToolActivity } from 'types/chat-runtime';
import { cloneDeep, isEqual } from 'lodash-es';
import { createMainToolCancelledResult, createMainToolFailureResult } from '../tools/results.mjs';

/** 默认工具活性窗口。 */
export const TOOL_LIVENESS_TIMEOUT_MS = 60_000;
/** 默认无实质进展提醒窗口。 */
export const TOOL_IDLE_NOTICE_MS = 60_000;
/** 默认取消宽限期。 */
export const TOOL_CANCEL_GRACE_MS = 5_000;
/** 默认心跳接收限流窗口。 */
export const TOOL_HEARTBEAT_RATE_MS = 1_000;
/** 默认进展持久化限流窗口。 */
export const TOOL_PROGRESS_RATE_MS = 1_000;
/** 活动说明最大 Unicode code point 数量。 */
const TOOL_ACTIVITY_MESSAGE_LIMIT = 500;
/** 单次进展允许保留的产物引用数量。 */
const TOOL_ACTIVITY_ARTIFACT_LIMIT = 50;

/** Watchdog 通过 AbortSignal 传递给底层执行器的稳定终止码。 */
type ToolWatchdogAbortCode = Extract<AIToolExecutionError['code'], 'USER_CANCELLED' | 'TOOL_UNRESPONSIVE' | 'EXTERNAL_WAIT_TIMEOUT' | 'RUNTIME_INTERRUPTED'>;

/** 带稳定工具错误码的 Watchdog 中止原因。 */
class ToolWatchdogAbortError extends Error {
  /** 稳定工具错误码。 */
  readonly code: ToolWatchdogAbortCode;

  /**
   * 创建 Watchdog 中止原因。
   * @param code - 稳定工具错误码
   * @param message - 安全错误说明
   */
  constructor(code: ToolWatchdogAbortCode, message: string) {
    super(message);
    this.name = 'ToolWatchdogAbortError';
    this.code = code;
  }
}

/** Watchdog 使用的双时钟。 */
export interface ToolWatchdogClock {
  /** 单调时钟，仅用于持续时间判断。 */
  monotonicNow(): number;
  /** 墙钟，仅用于持久化和外部期限。 */
  wallNow(): number;
}

/** Watchdog 状态投影回调。 */
export type ToolWatchdogChangeHandler = (snapshot: ChatToolActivitySnapshot, immediate: boolean) => void;

/** Watchdog 可配置边界。 */
export interface ToolWatchdogOptions {
  /** 可注入时钟。 */
  clock?: ToolWatchdogClock;
  /** 无活动中止窗口。 */
  livenessMs?: number;
  /** 无实质进展提醒窗口。 */
  idleMs?: number;
  /** 取消后的宽限期。 */
  cancelGraceMs?: number;
  /** 心跳接收限流窗口。 */
  heartbeatRateMs?: number;
  /** 进展投影限流窗口。 */
  persistRateMs?: number;
  /** 默认状态投影回调。 */
  onChange?: ToolWatchdogChangeHandler;
}

/** 启动单个工具 Watchdog 的输入。 */
export interface StartToolWatchdogInput {
  /** 所属 Runtime。 */
  runtimeId: string;
  /** 工具调用标识。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** 覆盖注册表默认投影回调。 */
  onChange?: ToolWatchdogChangeHandler;
}

/** 单个工具调用的 Watchdog 租约。 */
export interface ToolWatchdogLease {
  /** Watchdog 中止工具时触发的信号。 */
  readonly signal: AbortSignal;
  /** Watchdog 主动收敛时返回的结构化工具结果。 */
  readonly settled: Promise<AIToolExecutionResult>;
  /** Main 或 MCP 执行器提交内部活动。 */
  report(activity: ChatRuntimeToolActivity): boolean;
  /** 工具自然完成后释放租约。 */
  finish(): void;
}

/** Runtime 级 Watchdog 注册表。 */
export interface ToolWatchdogs {
  /** 启动单个工具租约。 */
  start(input: StartToolWatchdogInput): ToolWatchdogLease;
  /** 接受跨进程活动。 */
  submit(input: ChatRuntimeSubmitToolActivityInput): boolean;
  /** 执行用户控制。 */
  control(input: ChatRuntimeControlToolInput): boolean;
  /** 读取当前安全快照。 */
  read(runtimeId: string, toolCallId: string): ChatToolActivitySnapshot | null;
  /** 清理一个 Runtime 的全部工具。 */
  clear(runtimeId: string, code: 'RUNTIME_INTERRUPTED' | 'USER_CANCELLED'): void;
}

/** 暂停前保留的剩余计时。 */
interface ToolPauseSnapshot {
  /** 剩余活性时间。 */
  livenessMs: number;
  /** 剩余无进展提醒时间。 */
  idleMs: number;
}

/** 单个工具 Watchdog 的内部状态。 */
interface ToolWatchdogEntry {
  /** 所属 Runtime。 */
  runtimeId: string;
  /** 工具调用标识。 */
  toolCallId: string;
  /** 工具名称。 */
  toolName: string;
  /** 当前持久化安全快照。 */
  snapshot: ChatToolActivitySnapshot;
  /** 最后观察到的跨进程序号。 */
  lastSeenSequence: number;
  /** 内部 reporter 下一个序号。 */
  nextSequence: number;
  /** 最后有效活动的单调时间。 */
  lastActivityTick: number;
  /** 当前无进展提醒窗口起点。 */
  idleAnchorTick: number;
  /** 最后接受心跳的单调时间。 */
  lastHeartbeatTick: number;
  /** 最后一次普通进展投影时间。 */
  lastPersistTick: number;
  /** 暂停时保留的剩余计时。 */
  pause?: ToolPauseSnapshot;
  /** 根中止控制器。 */
  controller: AbortController;
  /** 主动收敛 Promise。 */
  settled: Promise<AIToolExecutionResult>;
  /** 主动收敛 resolver。 */
  resolveSettled: (result: AIToolExecutionResult) => void;
  /** 状态投影回调。 */
  onChange: ToolWatchdogChangeHandler;
  /** 活性 timer。 */
  livenessTimer?: ReturnType<typeof setTimeout>;
  /** 无进展提醒 timer。 */
  idleTimer?: ReturnType<typeof setTimeout>;
  /** 外部等待截止 timer。 */
  externalTimer?: ReturnType<typeof setTimeout>;
  /** 进展合并投影 timer。 */
  persistTimer?: ReturnType<typeof setTimeout>;
  /** 取消宽限 timer。 */
  cancelTimer?: ReturnType<typeof setTimeout>;
  /** 是否已有等待投影尚未发送。 */
  pendingPersist: boolean;
  /** 是否已经进入终态。 */
  terminal: boolean;
}

/** 归一化后的必填配置。 */
interface NormalizedWatchdogOptions {
  /** Watchdog 双时钟。 */
  clock: ToolWatchdogClock;
  /** 无活动中止窗口。 */
  livenessMs: number;
  /** 无进展提醒窗口。 */
  idleMs: number;
  /** 取消宽限期。 */
  cancelGraceMs: number;
  /** 心跳接收限流。 */
  heartbeatRateMs: number;
  /** 进展投影限流。 */
  persistRateMs: number;
  /** 默认投影回调。 */
  onChange: ToolWatchdogChangeHandler;
}

/**
 * 创建默认双时钟。
 * @returns 主进程单调时钟与墙钟
 */
function createDefaultClock(): ToolWatchdogClock {
  return {
    monotonicNow: (): number => performance.now(),
    wallNow: (): number => Date.now()
  };
}

/** 默认忽略状态投影。 */
function ignoreToolChange(): void {
  // 未配置投影消费者时只维护 Watchdog 内存状态。
}

/**
 * 归一化 Watchdog 配置。
 * @param options - 外部配置
 * @returns 必填配置
 */
function normalizeOptions(options: ToolWatchdogOptions): NormalizedWatchdogOptions {
  return {
    clock: options.clock ?? createDefaultClock(),
    livenessMs: options.livenessMs ?? TOOL_LIVENESS_TIMEOUT_MS,
    idleMs: options.idleMs ?? TOOL_IDLE_NOTICE_MS,
    cancelGraceMs: options.cancelGraceMs ?? TOOL_CANCEL_GRACE_MS,
    heartbeatRateMs: options.heartbeatRateMs ?? TOOL_HEARTBEAT_RATE_MS,
    persistRateMs: options.persistRateMs ?? TOOL_PROGRESS_RATE_MS,
    onChange: options.onChange ?? ignoreToolChange
  };
}

/**
 * 截断不可信活动说明。
 * @param value - 原始说明
 * @returns 最多 500 个 Unicode code point 的说明
 */
function truncateMessage(value: string): string {
  return Array.from(value).slice(0, TOOL_ACTIVITY_MESSAGE_LIMIT).join('');
}

/**
 * 判断未知值是否为普通记录。
 * @param value - 未知值
 * @returns 是否为非数组对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 归一化不可信产物引用列表。
 * @param value - 原始产物引用
 * @returns 有界安全引用；格式非法时返回 null
 */
function normalizeArtifacts(value: unknown): ChatToolArtifactRef[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;

  const artifacts: ChatToolArtifactRef[] = [];
  for (const candidate of value.slice(0, TOOL_ACTIVITY_ARTIFACT_LIMIT)) {
    if (!isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.kind !== 'string') return null;
    if (candidate.label !== undefined && typeof candidate.label !== 'string') return null;
    const id = truncateMessage(candidate.id).trim();
    const kind = truncateMessage(candidate.kind).trim();
    if (!id || !kind) return null;
    artifacts.push({
      id,
      kind,
      ...(typeof candidate.label === 'string' ? { label: truncateMessage(candidate.label) } : {})
    });
  }
  return artifacts;
}

/**
 * 归一化进展快照。
 * @param progress - 执行器进展
 * @returns 可安全比较与持久化的进展
 */
function normalizeProgress(progress: unknown): Omit<ChatToolProgressSnapshot, 'updatedAt'> | null {
  if (!isRecord(progress) || typeof progress.phase !== 'string') return null;
  if (
    progress.completed !== undefined &&
    (typeof progress.completed !== 'number' || !Number.isFinite(progress.completed) || progress.completed < 0)
  )
    return null;
  if (progress.total !== undefined && (typeof progress.total !== 'number' || !Number.isFinite(progress.total) || progress.total < 0)) return null;
  if (progress.message !== undefined && typeof progress.message !== 'string') return null;
  const artifacts = normalizeArtifacts(progress.artifacts);
  if (artifacts === null) return null;

  return {
    phase: truncateMessage(progress.phase),
    ...(progress.completed === undefined ? {} : { completed: progress.completed }),
    ...(progress.total === undefined ? {} : { total: progress.total }),
    ...(progress.message === undefined ? {} : { message: truncateMessage(progress.message) }),
    ...(artifacts === undefined ? {} : { artifacts })
  };
}

/**
 * 归一化 IPC 或执行器提交的活动联合。
 * @param activity - 原始活动
 * @returns 安全活动；格式非法时返回 null
 */
function normalizeActivity(activity: unknown): ChatRuntimeToolActivity | null {
  if (!isRecord(activity) || typeof activity.kind !== 'string') return null;
  if (activity.kind === 'started' || activity.kind === 'heartbeat' || activity.kind === 'resumed') return { kind: activity.kind };
  if (activity.kind === 'progress') {
    const progress = normalizeProgress(activity.progress);
    return progress ? { kind: 'progress', progress } : null;
  }
  if (activity.kind === 'waiting_user') {
    return typeof activity.prompt === 'string' ? { kind: 'waiting_user', prompt: truncateMessage(activity.prompt) } : null;
  }
  if (activity.kind !== 'waiting_external' || !isRecord(activity.wait)) return null;
  const { reason, retryAt, deadlineAt } = activity.wait;
  if (typeof reason !== 'string' || typeof retryAt !== 'number' || typeof deadlineAt !== 'number') return null;
  return { kind: 'waiting_external', wait: { reason: truncateMessage(reason), retryAt, deadlineAt } };
}

/**
 * 创建结构化 Watchdog 失败结果。
 * @param entry - 工具入口
 * @param code - 稳定错误码
 * @param message - 错误说明
 * @returns 工具结果
 */
function createWatchdogFailure(
  entry: ToolWatchdogEntry,
  code: Extract<AIToolExecutionError['code'], 'TOOL_UNRESPONSIVE' | 'EXTERNAL_WAIT_TIMEOUT' | 'RUNTIME_INTERRUPTED'>,
  message: string
): AIToolExecutionResult {
  return createMainToolFailureResult(entry.toolName, code, message);
}

/**
 * 创建 Runtime 级工具 Watchdog 注册表。
 * @param options - Watchdog 配置
 * @returns Watchdog 注册表
 */
export function createToolWatchdogs(options: ToolWatchdogOptions = {}): ToolWatchdogs {
  const config = normalizeOptions(options);
  const runtimes = new Map<string, Map<string, ToolWatchdogEntry>>();

  /**
   * 查找入口。
   * @param runtimeId - Runtime 标识
   * @param toolCallId - 工具调用标识
   * @returns 匹配入口
   */
  function findEntry(runtimeId: string, toolCallId: string): ToolWatchdogEntry | undefined {
    return runtimes.get(runtimeId)?.get(toolCallId);
  }

  /**
   * 清除入口全部 timer。
   * @param entry - 工具入口
   */
  function clearTimers(entry: ToolWatchdogEntry): void {
    if (entry.livenessTimer) clearTimeout(entry.livenessTimer);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    if (entry.externalTimer) clearTimeout(entry.externalTimer);
    if (entry.persistTimer) clearTimeout(entry.persistTimer);
    if (entry.cancelTimer) clearTimeout(entry.cancelTimer);
    entry.livenessTimer = undefined;
    entry.idleTimer = undefined;
    entry.externalTimer = undefined;
    entry.persistTimer = undefined;
    entry.cancelTimer = undefined;
  }

  /**
   * 从注册表移除入口。
   * @param entry - 工具入口
   */
  function removeEntry(entry: ToolWatchdogEntry): void {
    const tools = runtimes.get(entry.runtimeId);
    tools?.delete(entry.toolCallId);
    if (tools?.size === 0) runtimes.delete(entry.runtimeId);
  }

  /**
   * 克隆入口安全快照。
   * @param entry - 工具入口
   * @returns 可交给外部的快照
   */
  function copySnapshot(entry: ToolWatchdogEntry): ChatToolActivitySnapshot {
    return cloneDeep(entry.snapshot);
  }

  /**
   * 隔离状态投影故障，保证 Watchdog 自身始终能中止并收敛。
   * @param entry - 工具入口
   * @param immediate - 是否为立即投影
   */
  function notifyChange(entry: ToolWatchdogEntry, immediate: boolean): void {
    try {
      entry.onChange(copySnapshot(entry), immediate);
    } catch {
      // 投影属于旁路持久化/UI 通知，不能反向破坏工具执行状态机。
    }
  }

  /**
   * 立即投影状态并合并等待中的普通进展。
   * @param entry - 工具入口
   */
  function emitImmediate(entry: ToolWatchdogEntry): void {
    if (entry.persistTimer) clearTimeout(entry.persistTimer);
    entry.persistTimer = undefined;
    entry.pendingPersist = false;
    notifyChange(entry, true);
  }

  /**
   * 投影已通过实质变化判断的进展。
   * @param entry - 工具入口
   */
  function emitProgress(entry: ToolWatchdogEntry): void {
    const now = config.clock.monotonicNow();
    const elapsed = now - entry.lastPersistTick;
    if (elapsed >= config.persistRateMs) {
      entry.lastPersistTick = now;
      entry.pendingPersist = false;
      notifyChange(entry, false);
      return;
    }

    entry.pendingPersist = true;
    if (entry.persistTimer) return;
    entry.persistTimer = setTimeout((): void => {
      entry.persistTimer = undefined;
      if (entry.terminal || !entry.pendingPersist) return;
      entry.pendingPersist = false;
      entry.lastPersistTick = config.clock.monotonicNow();
      notifyChange(entry, false);
    }, Math.max(0, config.persistRateMs - elapsed));
  }

  /**
   * 结束入口并解析主动收敛结果。
   * @param entry - 工具入口
   * @param result - 结构化工具结果
   */
  function settleEntry(entry: ToolWatchdogEntry, result: AIToolExecutionResult): void {
    if (entry.terminal) return;
    entry.terminal = true;
    clearTimers(entry);
    removeEntry(entry);
    entry.resolveSettled(result);
  }

  /**
   * 把入口切到停止状态并触发底层中止。
   * @param entry - 工具入口
   * @param code - 稳定终止码
   * @param message - 中止原因
   */
  function abortEntry(entry: ToolWatchdogEntry, code: ToolWatchdogAbortCode, message: string): void {
    if (entry.terminal) return;
    entry.snapshot = { ...entry.snapshot, state: 'stopping' };
    clearTimers(entry);
    emitImmediate(entry);
    if (!entry.controller.signal.aborted) entry.controller.abort(new ToolWatchdogAbortError(code, message));
  }

  /**
   * 安排活性和无进展 timer。
   * @param entry - 工具入口
   * @param livenessDelay - 剩余活性时间
   * @param idleDelay - 剩余无进展时间
   */
  function scheduleActive(entry: ToolWatchdogEntry, livenessDelay?: number, idleDelay?: number): void {
    if (entry.livenessTimer) clearTimeout(entry.livenessTimer);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    const now = config.clock.monotonicNow();
    const liveDelay = livenessDelay ?? Math.max(0, config.livenessMs - (now - entry.lastActivityTick));
    entry.livenessTimer = setTimeout((): void => {
      abortEntry(entry, 'TOOL_UNRESPONSIVE', '工具执行器长时间没有活动');
      settleEntry(entry, createWatchdogFailure(entry, 'TOOL_UNRESPONSIVE', '工具执行器长时间没有活动'));
    }, liveDelay);

    if (entry.snapshot.state !== 'executing') {
      entry.idleTimer = undefined;
      return;
    }
    const nextIdleDelay = idleDelay ?? Math.max(0, config.idleMs - (now - entry.idleAnchorTick));
    entry.idleTimer = setTimeout((): void => {
      if (entry.terminal || entry.snapshot.state !== 'executing') return;
      entry.snapshot = { ...entry.snapshot, state: 'running_idle' };
      emitImmediate(entry);
    }, nextIdleDelay);
  }

  /**
   * 保存暂停时的剩余时间并清除活动 timer。
   * @param entry - 工具入口
   */
  function pauseEntry(entry: ToolWatchdogEntry): void {
    const now = config.clock.monotonicNow();
    entry.pause = {
      livenessMs: Math.max(0, config.livenessMs - (now - entry.lastActivityTick)),
      idleMs: Math.max(0, config.idleMs - (now - entry.idleAnchorTick))
    };
    if (entry.livenessTimer) clearTimeout(entry.livenessTimer);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.livenessTimer = undefined;
    entry.idleTimer = undefined;
  }

  /**
   * 从暂停状态恢复剩余计时。
   * @param entry - 工具入口
   */
  function resumeEntry(entry: ToolWatchdogEntry): void {
    const now = config.clock.monotonicNow();
    const pause = entry.pause ?? { livenessMs: config.livenessMs, idleMs: config.idleMs };
    entry.pause = undefined;
    entry.lastActivityTick = now - (config.livenessMs - pause.livenessMs);
    entry.idleAnchorTick = now - (config.idleMs - pause.idleMs);
    entry.snapshot = {
      ...entry.snapshot,
      state: 'executing',
      userPrompt: undefined,
      externalWait: undefined
    };
    emitImmediate(entry);
    scheduleActive(entry, pause.livenessMs, pause.idleMs);
  }

  /**
   * 应用一个已通过身份和序号检查的活动。
   * @param entry - 工具入口
   * @param activity - 工具活动
   * @param sequence - 接受后的序号
   * @returns 活动是否有效
   */
  function applyActivity(entry: ToolWatchdogEntry, activity: ChatRuntimeToolActivity, sequence: number): boolean {
    if (entry.terminal || entry.snapshot.state === 'stopping' || entry.snapshot.state === 'interrupted') return false;
    const now = config.clock.monotonicNow();
    const wallNow = config.clock.wallNow();

    if (entry.snapshot.state === 'waiting_user' || entry.snapshot.state === 'waiting_external') {
      if (activity.kind !== 'resumed') return false;
      if (entry.snapshot.state === 'waiting_external' && wallNow < (entry.snapshot.externalWait?.retryAt ?? Number.POSITIVE_INFINITY)) return false;
      entry.snapshot = { ...entry.snapshot, sequence };
      resumeEntry(entry);
      return true;
    }

    if (activity.kind === 'resumed') return false;

    if (activity.kind === 'heartbeat') {
      if (now - entry.lastHeartbeatTick < config.heartbeatRateMs) return false;
      entry.lastHeartbeatTick = now;
      entry.lastActivityTick = now;
      entry.snapshot = { ...entry.snapshot, sequence };
      scheduleActive(entry);
      return true;
    }

    if (activity.kind === 'started') {
      if (entry.snapshot.state !== 'starting') return false;
      entry.lastActivityTick = now;
      entry.snapshot = { ...entry.snapshot, state: 'executing', sequence };
      emitImmediate(entry);
      scheduleActive(entry);
      return true;
    }

    if (activity.kind === 'progress') {
      const progress = normalizeProgress(activity.progress);
      const previous = entry.snapshot.progress ? normalizeProgress(entry.snapshot.progress) : undefined;
      if (!progress) return false;
      const changed = !isEqual(previous, progress);
      entry.lastActivityTick = now;
      entry.snapshot = { ...entry.snapshot, sequence };
      if (changed) {
        entry.idleAnchorTick = now;
        entry.snapshot = {
          ...entry.snapshot,
          state: 'executing',
          lastProgressAt: wallNow,
          idleAcknowledgedAt: undefined,
          progress: { ...progress, updatedAt: wallNow }
        };
        emitProgress(entry);
      }
      scheduleActive(entry);
      return true;
    }

    if (activity.kind === 'waiting_user') {
      pauseEntry(entry);
      entry.snapshot = {
        ...entry.snapshot,
        state: 'waiting_user',
        sequence,
        userPrompt: truncateMessage(activity.prompt),
        externalWait: undefined
      };
      emitImmediate(entry);
      return true;
    }

    const { wait } = activity;
    if (
      !wait.reason.trim() ||
      !Number.isFinite(wait.retryAt) ||
      !Number.isFinite(wait.deadlineAt) ||
      wait.deadlineAt <= wait.retryAt ||
      wait.deadlineAt <= wallNow
    ) {
      return false;
    }
    pauseEntry(entry);
    entry.snapshot = {
      ...entry.snapshot,
      state: 'waiting_external',
      sequence,
      userPrompt: undefined,
      externalWait: { ...wait, reason: truncateMessage(wait.reason) }
    };
    emitImmediate(entry);
    entry.externalTimer = setTimeout((): void => {
      abortEntry(entry, 'EXTERNAL_WAIT_TIMEOUT', '外部等待已超过工具声明的截止时间');
      settleEntry(entry, createWatchdogFailure(entry, 'EXTERNAL_WAIT_TIMEOUT', '外部等待已超过工具声明的截止时间'));
    }, Math.max(0, wait.deadlineAt - wallNow));
    return true;
  }

  /**
   * 启动单个工具租约。
   * @param input - 工具身份与投影回调
   * @returns Watchdog 租约
   */
  function start(input: StartToolWatchdogInput): ToolWatchdogLease {
    if (findEntry(input.runtimeId, input.toolCallId)) {
      throw new Error(`Tool watchdog already exists: ${input.runtimeId}/${input.toolCallId}`);
    }
    const now = config.clock.monotonicNow();
    let resolveSettled: (result: AIToolExecutionResult) => void = (): void => undefined;
    const settled = new Promise<AIToolExecutionResult>((resolve): void => {
      resolveSettled = resolve;
    });
    const entry: ToolWatchdogEntry = {
      runtimeId: input.runtimeId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      snapshot: { state: 'starting', sequence: 0 },
      lastSeenSequence: 0,
      nextSequence: 0,
      lastActivityTick: now,
      idleAnchorTick: now,
      lastHeartbeatTick: Number.NEGATIVE_INFINITY,
      lastPersistTick: Number.NEGATIVE_INFINITY,
      controller: new AbortController(),
      settled,
      resolveSettled,
      onChange: input.onChange ?? config.onChange,
      pendingPersist: false,
      terminal: false
    };
    const tools = runtimes.get(input.runtimeId) ?? new Map<string, ToolWatchdogEntry>();
    tools.set(input.toolCallId, entry);
    runtimes.set(input.runtimeId, tools);
    emitImmediate(entry);
    scheduleActive(entry);

    return {
      signal: entry.controller.signal,
      settled: entry.settled,
      report(activity: ChatRuntimeToolActivity): boolean {
        const normalized = normalizeActivity(activity);
        if (!normalized) return false;
        const sequence = Math.max(entry.nextSequence, entry.lastSeenSequence) + 1;
        entry.nextSequence = sequence;
        entry.lastSeenSequence = sequence;
        return applyActivity(entry, normalized, sequence);
      },
      finish(): void {
        if (entry.terminal) return;
        entry.terminal = true;
        clearTimers(entry);
        removeEntry(entry);
      }
    };
  }

  /**
   * 接受 Renderer 活动。
   * @param input - 带严格序号的活动
   * @returns 是否接受
   */
  function submit(input: ChatRuntimeSubmitToolActivityInput): boolean {
    const entry = findEntry(input.runtimeId, input.toolCallId);
    if (!entry || !Number.isSafeInteger(input.sequence) || input.sequence <= 0 || !Number.isFinite(input.occurredAt)) return false;
    if (input.sequence <= entry.lastSeenSequence) return false;
    const activity = normalizeActivity(input.activity);
    if (!activity) return false;
    entry.lastSeenSequence = input.sequence;
    entry.nextSequence = Math.max(entry.nextSequence, input.sequence);
    return applyActivity(entry, activity, input.sequence);
  }

  /**
   * 执行用户控制。
   * @param input - 单工具控制输入
   * @returns 是否接受
   */
  function control(input: ChatRuntimeControlToolInput): boolean {
    const entry = findEntry(input.runtimeId, input.toolCallId);
    if (!entry || entry.terminal) return false;
    if (input.action === 'continue_waiting') {
      if (entry.snapshot.state !== 'running_idle') return false;
      entry.idleAnchorTick = config.clock.monotonicNow();
      entry.snapshot = {
        ...entry.snapshot,
        state: 'executing',
        idleAcknowledgedAt: config.clock.wallNow()
      };
      emitImmediate(entry);
      scheduleActive(entry);
      return true;
    }
    if (entry.snapshot.state === 'stopping') return false;
    abortEntry(entry, 'USER_CANCELLED', '用户停止了工具调用');
    entry.cancelTimer = setTimeout((): void => {
      settleEntry(entry, createMainToolCancelledResult(entry.toolName));
    }, config.cancelGraceMs);
    return true;
  }

  /**
   * 读取安全快照。
   * @param runtimeId - Runtime 标识
   * @param toolCallId - 工具调用标识
   * @returns 当前快照
   */
  function read(runtimeId: string, toolCallId: string): ChatToolActivitySnapshot | null {
    const entry = findEntry(runtimeId, toolCallId);
    return entry ? copySnapshot(entry) : null;
  }

  /**
   * 清理 Runtime 的全部在途工具。
   * @param runtimeId - Runtime 标识
   * @param code - 清理原因
   */
  function clear(runtimeId: string, code: 'RUNTIME_INTERRUPTED' | 'USER_CANCELLED'): void {
    const entries = [...(runtimes.get(runtimeId)?.values() ?? [])];
    for (const entry of entries) {
      if (entry.terminal) continue;
      if (code === 'RUNTIME_INTERRUPTED') {
        entry.snapshot = { ...entry.snapshot, state: 'interrupted' };
        clearTimers(entry);
        emitImmediate(entry);
        if (!entry.controller.signal.aborted) {
          entry.controller.abort(new ToolWatchdogAbortError('RUNTIME_INTERRUPTED', 'Runtime 执行链已中断'));
        }
        settleEntry(entry, createWatchdogFailure(entry, code, 'Runtime 恢复时无法重建工具执行链'));
      } else {
        abortEntry(entry, 'USER_CANCELLED', '用户取消了 Runtime');
        settleEntry(entry, createMainToolCancelledResult(entry.toolName));
      }
    }
  }

  return { start, submit, control, read, clear };
}
