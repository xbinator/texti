/**
 * @file locks.mts
 * @description ChatRuntime session 写入锁与 resource-scope continuation fence。
 */

/** 锁获取成功结果。 */
export interface RuntimeLockAcquired {
  /** 是否成功获取锁。 */
  ok: true;
}

/** 锁获取失败结果。 */
export interface RuntimeLockRejected {
  /** 是否成功获取锁。 */
  ok: false;
  /** 稳定失败原因。 */
  reason: 'session_busy' | 'turn_waiting_children';
  /** 当前占用普通写锁的 runtime id。 */
  ownerRuntimeId?: string;
  /** 当前 continuation fence 的 Checkpoint owner。 */
  ownerCheckpointId?: string;
}

/** 写入锁获取结果。 */
export type RuntimeLockResult = RuntimeLockAcquired | RuntimeLockRejected;

/** Session history continuation fence 的只读投影。 */
export interface RuntimeContinuationFence {
  /** 规范化资源范围。 */
  scope: string;
  /** 唯一允许续接写入的 Checkpoint。 */
  checkpointId: string;
}

/** 可释放且绑定单次 acquisition token 的 continuation fence handle。 */
export interface RuntimeContinuationFenceHandle extends RuntimeContinuationFence {
  /**
   * 释放本 handle 获取的 fence。
   * @returns 是否释放成功
   */
  release(): boolean;
}

/** 尚未生效的 continuation fence 两阶段预留。 */
export interface RuntimeContinuationFenceReservation extends RuntimeContinuationFence {
  /**
   * 在持久化事实提交后同步激活 fence。
   * @returns 已激活且可释放的 fence handle
   */
  activate(): RuntimeContinuationFenceHandle;
  /**
   * 在持久化失败时释放本次预留。
   * @returns 是否释放成功
   */
  release(): boolean;
}

/** Session history 被 Child 等待态阻挡时的稳定错误。 */
export class ChatHistoryFenceError extends Error {
  /** Renderer 和主进程共同判断的稳定错误码。 */
  readonly code = 'TURN_WAITING_CHILDREN';

  /** 当前 fence owner。 */
  readonly checkpointId: string;

  /**
   * 创建 history fence 错误。
   * @param sessionId - Session ID
   * @param checkpointId - fence owner
   */
  constructor(sessionId: string, checkpointId: string) {
    super(`Session ${sessionId} is waiting for Child tasks at ${checkpointId}`);
    this.name = 'ChatHistoryFenceError';
    this.checkpointId = checkpointId;
  }
}

/** Runtime 写入锁注册表。 */
export interface RuntimeLockRegistry {
  /**
   * 获取 session 写入锁。
   * @param input - session 与 runtime 标识
   * @returns 锁获取结果
   */
  acquireWritingLock(input: { sessionId: string; runtimeId: string }): RuntimeLockResult;
  /**
   * 仅为 fence owner 获取 Session continuation 写锁。
   * @param input - session、runtime 与 checkpoint 标识
   * @returns 锁获取结果
   */
  acquireContinuationWritingLock(input: { sessionId: string; runtimeId: string; checkpointId: string }): RuntimeLockResult;
  /**
   * 释放 session 写入锁。
   * @param input - session 与 runtime 标识
   * @returns 是否释放成功
   */
  releaseWritingLock(input: { sessionId: string; runtimeId: string }): boolean;
  /**
   * 读取当前 session 写入锁 owner。
   * @param sessionId - session id
   * @returns 当前 owner runtime id
   */
  getWritingOwner(sessionId: string): string | undefined;
  /**
   * 预留 Session history continuation fence，但在激活前不阻止 history 写入。
   * @param input - resource scope 与 Checkpoint owner
   * @returns 唯一预留；非法范围或 scope 已被预留/占用时返回 null
   */
  reserveContinuationFence(input: { scope: string; checkpointId: string }): RuntimeContinuationFenceReservation | null;
  /**
   * 获取 Session history continuation fence。
   * @param input - resource scope 与 Checkpoint owner
   * @returns 唯一 handle；非法范围或已存在 fence 时返回 null
   */
  acquireContinuationFence(input: { scope: string; checkpointId: string }): RuntimeContinuationFenceHandle | null;
  /**
   * 读取 resource scope 当前 fence。
   * @param scope - resource scope
   * @returns 只读 fence 投影
   */
  getContinuationFence(scope: string): RuntimeContinuationFence | undefined;
}

/** 内部 fence 记录；token 防止陈旧 handle 释放后续 owner。 */
interface RuntimeContinuationFenceRecord extends RuntimeContinuationFence {
  /** 单次 acquisition 身份。 */
  token: symbol;
}

/**
 * 生成 Session history resource scope。
 * @param sessionId - Session ID
 * @returns 规范化 resource scope
 */
export function getSessionHistoryScope(sessionId: string): string {
  return `session:${sessionId.trim()}/history`;
}

/**
 * 校验并规范化 Session history resource scope。
 * @param scope - 未可信 resource scope
 * @returns 规范化 scope，非法时返回 null
 */
function normalizeHistoryScope(scope: string): string | null {
  const normalized = scope.trim();
  const match = /^session:([^/]+)\/history$/.exec(normalized);
  if (!match?.[1]?.trim()) return null;
  return getSessionHistoryScope(match[1]);
}

/**
 * 创建内存写入锁注册表。
 * @returns runtime 写入锁注册表
 */
export function createRuntimeLockRegistry(): RuntimeLockRegistry {
  const writingLocks = new Map<string, string>();
  const continuationFences = new Map<string, RuntimeContinuationFenceRecord>();
  const continuationReservations = new Map<string, RuntimeContinuationFenceRecord>();

  /**
   * 读取 Session 当前 history fence。
   * @param sessionId - Session ID
   * @returns fence 记录
   */
  function getSessionFence(sessionId: string): RuntimeContinuationFenceRecord | undefined {
    return continuationFences.get(getSessionHistoryScope(sessionId));
  }

  /**
   * 获取普通或 continuation writer 的共同底层锁。
   * @param input - Session 与 Runtime
   * @returns 写锁结果
   */
  function acquireSessionWriter(input: { sessionId: string; runtimeId: string }): RuntimeLockResult {
    const ownerRuntimeId = writingLocks.get(input.sessionId);
    if (ownerRuntimeId && ownerRuntimeId !== input.runtimeId) {
      return { ok: false, ownerRuntimeId, reason: 'session_busy' };
    }

    writingLocks.set(input.sessionId, input.runtimeId);
    return { ok: true };
  }

  /**
   * 为已激活记录创建 token 绑定 handle。
   * @param record - 已激活 fence 记录
   * @returns fence handle
   */
  function createFenceHandle(record: RuntimeContinuationFenceRecord): RuntimeContinuationFenceHandle {
    return {
      scope: record.scope,
      checkpointId: record.checkpointId,
      release(): boolean {
        const current = continuationFences.get(record.scope);
        if (!current || current.token !== record.token) return false;
        continuationFences.delete(record.scope);
        return true;
      }
    };
  }

  return {
    acquireWritingLock(input: { sessionId: string; runtimeId: string }): RuntimeLockResult {
      const fence = getSessionFence(input.sessionId);
      if (fence) {
        return { ok: false, ownerCheckpointId: fence.checkpointId, reason: 'turn_waiting_children' };
      }

      return acquireSessionWriter(input);
    },

    acquireContinuationWritingLock(input: { sessionId: string; runtimeId: string; checkpointId: string }): RuntimeLockResult {
      const fence = getSessionFence(input.sessionId);
      if (!fence || fence.checkpointId !== input.checkpointId) {
        return {
          ok: false,
          ...(fence ? { ownerCheckpointId: fence.checkpointId } : {}),
          reason: 'turn_waiting_children'
        };
      }

      return acquireSessionWriter(input);
    },

    releaseWritingLock(input: { sessionId: string; runtimeId: string }): boolean {
      if (writingLocks.get(input.sessionId) !== input.runtimeId) {
        return false;
      }

      writingLocks.delete(input.sessionId);
      return true;
    },

    getWritingOwner(sessionId: string): string | undefined {
      return writingLocks.get(sessionId);
    },

    reserveContinuationFence(input: { scope: string; checkpointId: string }): RuntimeContinuationFenceReservation | null {
      const scope = normalizeHistoryScope(input.scope);
      const checkpointId = input.checkpointId.trim();
      if (!scope || !checkpointId || continuationFences.has(scope) || continuationReservations.has(scope)) return null;

      const token = Symbol(checkpointId);
      const record: RuntimeContinuationFenceRecord = { scope, checkpointId, token };
      let activatedHandle: RuntimeContinuationFenceHandle | undefined;
      continuationReservations.set(scope, record);
      return {
        scope,
        checkpointId,
        activate(): RuntimeContinuationFenceHandle {
          if (activatedHandle) return activatedHandle;
          const current = continuationReservations.get(scope);
          if (!current || current.token !== token) {
            throw new Error(`Continuation fence reservation ${scope} is no longer active`);
          }

          // 同步迁移同一 token，确保提交成功后不会出现第二次竞争窗口。
          continuationReservations.delete(scope);
          continuationFences.set(scope, record);
          activatedHandle = createFenceHandle(record);
          return activatedHandle;
        },
        release(): boolean {
          if (activatedHandle) return false;
          const current = continuationReservations.get(scope);
          if (!current || current.token !== token) return false;
          continuationReservations.delete(scope);
          return true;
        }
      };
    },

    acquireContinuationFence(input: { scope: string; checkpointId: string }): RuntimeContinuationFenceHandle | null {
      const reservation = this.reserveContinuationFence(input);
      return reservation?.activate() ?? null;
    },

    getContinuationFence(scope: string): RuntimeContinuationFence | undefined {
      const normalizedScope = normalizeHistoryScope(scope);
      if (!normalizedScope) return undefined;
      const fence = continuationFences.get(normalizedScope);
      return fence ? { scope: fence.scope, checkpointId: fence.checkpointId } : undefined;
    }
  };
}

/** Chat 与 Runtime 主进程共享的全局锁和 continuation fence 注册表。 */
export const chatRuntimeLocks = createRuntimeLockRegistry();

/**
 * 断言 Session history 当前允许主进程变更。
 * @param sessionId - Session ID
 * @param ownerCheckpointId - 内部 continuation owner；Renderer 不得传入
 * @param locks - 共享 resource-scope 锁注册表
 * @throws ChatHistoryFenceError 当 Turn 正等待 Child
 */
export function assertSessionHistoryWritable(sessionId: string, ownerCheckpointId?: string, locks: RuntimeLockRegistry = chatRuntimeLocks): void {
  const fence = locks.getContinuationFence(getSessionHistoryScope(sessionId));
  if (fence && fence.checkpointId !== ownerCheckpointId) {
    throw new ChatHistoryFenceError(sessionId, fence.checkpointId);
  }
}
