/**
 * @file useAgentDelegationEvents.ts
 * @description 应用级 Child Agent Checkpoint 恢复、Runtime B 续接与合作式取消协调。
 */
/* eslint-disable no-use-before-define */
import type { ChatAgentApplicationEvent, ChatAgentCheckpointSnapshot, ChatAgentHandlerResult, ChatAgentResumeResult } from 'types/chat-agent';
import type { ChatRuntimeAddress } from 'types/chat-runtime';
import type { Subscription } from 'xstate';
import { onScopeDispose } from 'vue';
import { nanoid } from 'nanoid';
import { ChatActorProtocolError, createResumeAddress, type ChatActorSystem } from '@/ai/chat/actorSystem';
import type { RuntimeExecutionCapabilities } from '@/ai/chat/runtimeCapabilities';
import { logger } from '@/shared/logger';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { useChatTabStore } from '@/stores/chat/tab';
import { asyncTo } from '@/utils/asyncTo';

/** 默认取消事实对账间隔。 */
const DEFAULT_RECONCILE_DELAY_MS = 1_000;
/** 同一个 resume tuple 的最大传输尝试次数。 */
const MAX_RESUME_ATTEMPTS = 2;
/** 单个 Checkpoint 的最大取消提交尝试次数。 */
const MAX_CANCEL_ATTEMPTS = 3;

/** 委派事件 hook 的可测试依赖。 */
export interface AgentDelegationEventOptions {
  /** 创建 renderer 预注册的 Runtime B 身份。 */
  createRuntimeId?: () => string;
  /** 取消事实的有界对账间隔。 */
  reconcileDelayMs?: number;
}

/** 每个 Checkpoint 的 renderer 去重状态。 */
interface DelegationCursor {
  /** 已投影的 CAS 版本。 */
  version: number;
  /** 已投影的持久化事件 cursor。 */
  checkpointSequence: number;
}

/** Renderer 为一个不可变 ready tuple 保留的 Runtime B 提议。 */
interface ResumeFlight {
  /** 发起提议时观察到的 ready 快照。 */
  snapshot: ChatAgentCheckpointSnapshot;
  /** 同一 tuple 重试必须复用的 Runtime ID。 */
  resumeRuntimeId: string;
  /** 已提交到 IPC 的次数。 */
  attempt: number;
  /** 当前是否存在未决请求。 */
  requesting: boolean;
}

/** 一个 Checkpoint 的 cooperative cancellation 对账状态。 */
interface CancelFlight {
  /** 已提交取消命令的次数。 */
  attempt: number;
  /** 当前是否存在未决请求。 */
  requesting: boolean;
  /** 有界对账定时器。 */
  timer?: ReturnType<typeof setTimeout>;
}

/** 快照相对本地 cursor 的顺序。 */
type SnapshotOrder = 'newer' | 'same' | 'stale';

/**
 * 解包 Chat Agent IPC 结果。
 * @param result - Agent handler 信封
 * @returns 信封数据
 */
function unwrapAgentResult<T>(result: ChatAgentHandlerResult<T>): T {
  if (!result.ok) {
    const error = new Error(result.error);
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.data;
}

/**
 * 创建 Runtime B 的 fail-closed renderer 能力。
 * Primary continuation 不允许恢复 Runtime A 的 renderer 工具。
 * @returns 空工具能力
 */
function createResumeCapabilities(): RuntimeExecutionCapabilities {
  return {
    tools: [],
    descriptor: { rendererToolNames: [] },
    getToolContext: (): undefined => undefined,
    handleBridgeRequest: async (): Promise<never> => {
      throw new Error('Primary continuation has no renderer bridge capability');
    }
  };
}

/**
 * 注册应用级委派事件与启动恢复。
 * 监听先于 listActive，事件与快照再按持久化 cursor 单调收敛。
 * @param actorSystem - 应用级 Chat Actor system
 * @param options - 可测试依赖
 */
export function useAgentDelegationEvents(actorSystem: ChatActorSystem, options: AgentDelegationEventOptions = {}): void {
  const electronAPI = getElectronAPI();
  if (
    typeof electronAPI.chatAgentOnEvent !== 'function' ||
    typeof electronAPI.chatAgentListActive !== 'function' ||
    typeof electronAPI.chatAgentResumePrimary !== 'function' ||
    typeof electronAPI.chatAgentCancelCheckpoint !== 'function'
  ) {
    return;
  }
  const createRuntimeId = options.createRuntimeId ?? ((): string => `runtime-${nanoid()}`);
  const reconcileDelayMs = options.reconcileDelayMs ?? DEFAULT_RECONCILE_DELAY_MS;
  const runtimeStore = useChatTabStore();
  const cursors = new Map<string, DelegationCursor>();
  const latestSnapshots = new Map<string, ChatAgentCheckpointSnapshot>();
  const resumeFlights = new Map<string, ResumeFlight>();
  const rejectedResumeTuples = new Set<string>();
  const cancelFlights = new Map<string, CancelFlight>();
  const checkpointSubscriptions = new Map<string, Subscription>();
  let disposed = false;
  let readyDrainQueued = false;
  let resyncPromise: Promise<void> | undefined;
  let resyncQueued = false;

  /**
   * 创建不可变 ready tuple 的去重键。
   * @param snapshot - ready 快照
   * @returns Checkpoint 与版本组合
   */
  function createResumeKey(snapshot: ChatAgentCheckpointSnapshot): string {
    return `${snapshot.checkpointId}:${snapshot.version}`;
  }

  /**
   * 比较并记录权威快照的单调位置。
   * 相同位置仍允许执行对账，但不会重复推进状态机。
   * @param snapshot - 权威公开快照
   * @returns 快照顺序
   */
  function trackSnapshot(snapshot: ChatAgentCheckpointSnapshot): SnapshotOrder {
    const current = cursors.get(snapshot.checkpointId);
    if (
      current &&
      (snapshot.checkpointSequence < current.checkpointSequence ||
        (snapshot.checkpointSequence === current.checkpointSequence && snapshot.version < current.version))
    ) {
      return 'stale';
    }
    const order: SnapshotOrder =
      current && snapshot.checkpointSequence === current.checkpointSequence && snapshot.version === current.version ? 'same' : 'newer';
    cursors.set(snapshot.checkpointId, {
      version: snapshot.version,
      checkpointSequence: snapshot.checkpointSequence
    });
    latestSnapshots.set(snapshot.checkpointId, snapshot);
    return order;
  }

  /**
   * 清理一个未决 Runtime B 提议。
   * @param checkpointId - Checkpoint ID
   * @param preservedRuntimeId - 已成为权威事实、不得注销的 Runtime ID
   */
  function clearResumeFlight(checkpointId: string, preservedRuntimeId?: string): void {
    const flight = resumeFlights.get(checkpointId);
    if (!flight) return;
    if (flight.resumeRuntimeId !== preservedRuntimeId) {
      actorSystem.unregisterRuntime(flight.resumeRuntimeId);
    }
    resumeFlights.delete(checkpointId);
  }

  /**
   * 耗尽一个 resume tuple 的传输预算并清除 managed ghost。
   * @param flight - 已耗尽的 ResumeFlight
   */
  function exhaustResumeFlight(flight: ResumeFlight): void {
    if (resumeFlights.get(flight.snapshot.checkpointId) !== flight) return;
    rejectedResumeTuples.add(createResumeKey(flight.snapshot));
    clearResumeFlight(flight.snapshot.checkpointId);
    logger.error(`[chat-agent-resume-exhausted] checkpointId=${flight.snapshot.checkpointId}`);
  }

  /**
   * 清理 cancellation 对账状态与定时器。
   * @param checkpointId - Checkpoint ID
   */
  function clearCancelFlight(checkpointId: string): void {
    const flight = cancelFlights.get(checkpointId);
    if (flight?.timer) clearTimeout(flight.timer);
    cancelFlights.delete(checkpointId);
  }

  /**
   * 清理 Checkpoint 局部监听。
   * @param checkpointId - Checkpoint ID
   */
  function clearCheckpointWatch(checkpointId: string): void {
    checkpointSubscriptions.get(checkpointId)?.unsubscribe();
    checkpointSubscriptions.delete(checkpointId);
  }

  /**
   * 判断 Session 是否已经观察到 Runtime A 的 matching waitingChildren。
   * @param snapshot - ready Checkpoint
   * @returns 是否允许向 Main 提交 CAS
   */
  function canClaimResume(snapshot: ChatAgentCheckpointSnapshot): boolean {
    if (actorSystem.actor.getSnapshot().context.runtimeRoutes.has(snapshot.sourceRuntimeId)) return false;
    const sessionSnapshot = actorSystem.getSession(snapshot.sessionId)?.getSnapshot();
    return Boolean(sessionSnapshot?.matches('waitingChildren') && sessionSnapshot.context.checkpointId === snapshot.checkpointId);
  }

  /**
   * 预注册或复用 ready tuple 的完整候选 Runtime B route。
   * @param snapshot - ready 快照
   * @returns 可用提议；被明确拒绝时返回 undefined
   */
  function ensureResumeFlight(snapshot: ChatAgentCheckpointSnapshot): ResumeFlight | undefined {
    if (rejectedResumeTuples.has(createResumeKey(snapshot))) return undefined;
    const current = resumeFlights.get(snapshot.checkpointId);
    if (current && current.snapshot.version === snapshot.version) {
      current.snapshot = snapshot;
      return current;
    }
    if (current) clearResumeFlight(snapshot.checkpointId);
    const flight: ResumeFlight = {
      snapshot,
      resumeRuntimeId: createRuntimeId(),
      attempt: 0,
      requesting: false
    };
    resumeFlights.set(snapshot.checkpointId, flight);
    try {
      actorSystem.registerRuntime(createResumeAddress(snapshot, flight.resumeRuntimeId), createResumeCapabilities());
    } catch (error: unknown) {
      resumeFlights.delete(snapshot.checkpointId);
      throw error;
    }
    return flight;
  }

  /**
   * 比较 Main 地址与 Checkpoint 派生地址的全部不可变字段。
   * @param left - Main 返回地址
   * @param right - Renderer 派生地址
   * @returns 地址是否完全一致
   */
  function isSameResumeAddress(left: ChatRuntimeAddress, right: ChatRuntimeAddress): boolean {
    return (
      left.sessionId === right.sessionId &&
      left.turnId === right.turnId &&
      left.agentId === right.agentId &&
      left.runtimeId === right.runtimeId &&
      left.parentAgentId === right.parentAgentId &&
      left.parentRuntimeId === right.parentRuntimeId &&
      left.rootRuntimeId === right.rootRuntimeId &&
      left.continuationOfRuntimeId === right.continuationOfRuntimeId
    );
  }

  /**
   * 把 CAS 后的 Runtime B 地址收敛到 Main 返回的权威地址。
   * Main 地址必须同时匹配持久化快照派生地址和 renderer 本地候选地址。
   * @param result - Main 启动或观察结果
   * @param proposedRuntimeId - renderer 预注册 Runtime ID
   */
  async function applyResumeResult(result: ChatAgentResumeResult, proposedRuntimeId: string): Promise<void> {
    if (result.status === 'settled') {
      clearResumeFlight(result.checkpoint.checkpointId);
      await projectSnapshot(result.checkpoint);
      return;
    }
    const order = trackSnapshot(result.checkpoint);
    if (order === 'stale') {
      clearResumeFlight(result.checkpoint.checkpointId);
      return;
    }
    const derivedAddress = createResumeAddress(result.checkpoint, result.address.runtimeId);
    if (!isSameResumeAddress(result.address, derivedAddress)) {
      rejectedResumeTuples.add(createResumeKey(result.checkpoint));
      clearResumeFlight(result.checkpoint.checkpointId);
      throw new ChatActorProtocolError(`Runtime ${result.address.runtimeId} authoritative address validation failed`);
    }
    if (result.address.runtimeId !== proposedRuntimeId) {
      actorSystem.unregisterRuntime(proposedRuntimeId);
    }
    actorSystem.registerRuntime(result.address, createResumeCapabilities());
    clearResumeFlight(result.checkpoint.checkpointId, result.address.runtimeId);
    if (order === 'newer') actorSystem.recoverDelegation(result.checkpoint);
    watchCheckpoint(result.checkpoint);
  }

  /**
   * 请求 Main CAS 并启动 Runtime B。
   * 传输结果不确定时只允许以同一 tuple 对账和重试。
   * @param flight - 已预注册的 ready tuple
   */
  async function requestResume(flight: ResumeFlight): Promise<void> {
    const { snapshot } = flight;
    if (
      disposed ||
      flight.requesting ||
      flight.attempt >= MAX_RESUME_ATTEMPTS ||
      resumeFlights.get(snapshot.checkpointId) !== flight ||
      !canClaimResume(snapshot)
    ) {
      return;
    }
    flight.requesting = true;
    flight.attempt += 1;
    const requestAttempt = flight.attempt;
    let shouldRetry = false;
    try {
      const [requestError, response] = await asyncTo(
        electronAPI.chatAgentResumePrimary({
          checkpointId: snapshot.checkpointId,
          expectedVersion: snapshot.version,
          resumeRuntimeId: flight.resumeRuntimeId
        })
      );
      if (disposed || resumeFlights.get(snapshot.checkpointId) !== flight) return;
      if (!requestError && response?.ok) {
        try {
          await applyResumeResult(response.data, flight.resumeRuntimeId);
        } catch (error: unknown) {
          rejectedResumeTuples.add(createResumeKey(snapshot));
          clearResumeFlight(snapshot.checkpointId);
          if (error instanceof ChatActorProtocolError) throw error;
          throw new ChatActorProtocolError(`Runtime ${flight.resumeRuntimeId} authoritative address validation failed`);
        }
        return;
      }

      const errorCode = !requestError && response && !response.ok ? response.code : undefined;
      if (errorCode === 'INVALID_INPUT') {
        rejectedResumeTuples.add(createResumeKey(snapshot));
        clearResumeFlight(snapshot.checkpointId);
        actorSystem.sendToSession(snapshot.sessionId, {
          type: 'session.resumeRejected',
          checkpointId: snapshot.checkpointId
        });
        return;
      }

      // IPC 可能在 Main CAS 前或后断开；事实源会决定 ready 重试、resuming winner 或 absent 清理。
      // 对账期间保持 requesting，确保同一 tuple 的下一次 attempt 只会在本次请求完整收尾后启动。
      await resync();
      if (disposed || resumeFlights.get(snapshot.checkpointId) !== flight) return;
      if (requestAttempt >= MAX_RESUME_ATTEMPTS) {
        exhaustResumeFlight(flight);
      } else {
        shouldRetry = true;
      }
    } finally {
      flight.requesting = false;
      if (shouldRetry && !disposed && resumeFlights.get(snapshot.checkpointId) === flight) {
        scheduleReadyDrain();
      }
    }
  }

  /**
   * 异步扫描所有 ready tuple，避免候选 route 注册回调早于 capability 注册完成。
   */
  function scheduleReadyDrain(): void {
    if (readyDrainQueued || disposed) return;
    readyDrainQueued = true;
    Promise.resolve().then((): void => {
      readyDrainQueued = false;
      if (disposed) return;
      resumeFlights.forEach((flight): void => {
        requestResume(flight).catch((error: unknown): void => {
          logger.error(`[chat-agent-resume] ${error instanceof Error ? error.message : String(error)}`);
        });
      });
    });
  }

  /**
   * 判断 Session 当前是否正在等待该 Checkpoint 的持久化取消。
   * @param snapshot - Checkpoint 身份
   * @returns 是否需要发送或对账取消
   */
  function isCancellationPending(snapshot: ChatAgentCheckpointSnapshot): boolean {
    const sessionSnapshot = actorSystem.getSession(snapshot.sessionId)?.getSnapshot();
    return Boolean(sessionSnapshot?.matches('cancellingChildren') && sessionSnapshot.context.checkpointId === snapshot.checkpointId);
  }

  /**
   * 取得或创建 cancellation 对账状态。
   * @param checkpointId - Checkpoint ID
   * @returns cancellation flight
   */
  function ensureCancelFlight(checkpointId: string): CancelFlight {
    const existing = cancelFlights.get(checkpointId);
    if (existing) return existing;
    const flight: CancelFlight = { attempt: 0, requesting: false };
    cancelFlights.set(checkpointId, flight);
    return flight;
  }

  /**
   * 为未终态 cancellation 安排一次有界事实对账。
   * @param snapshot - 当前 Checkpoint 快照
   */
  function scheduleCancelReconcile(snapshot: ChatAgentCheckpointSnapshot): void {
    const flight = ensureCancelFlight(snapshot.checkpointId);
    if (disposed || flight.timer || flight.attempt >= MAX_CANCEL_ATTEMPTS) return;
    flight.timer = setTimeout((): void => {
      flight.timer = undefined;
      resync()
        .then((): void => {
          const current = latestSnapshots.get(snapshot.checkpointId);
          if (!current || !isCancellationPending(current)) return;
          requestCancellation(current).catch((error: unknown): void => {
            logger.error(`[chat-agent-cancel] ${error instanceof Error ? error.message : String(error)}`);
          });
        })
        .catch((error: unknown): void => {
          logger.error(`[chat-agent-resync] ${error instanceof Error ? error.message : String(error)}`);
        });
    }, reconcileDelayMs);
  }

  /**
   * 请求 cooperative cancellation。
   * 成功响应本身就是 Main 持久化事实，必须立即投影。
   * @param snapshot - 正在等待的 Checkpoint
   */
  async function requestCancellation(snapshot: ChatAgentCheckpointSnapshot): Promise<void> {
    const flight = ensureCancelFlight(snapshot.checkpointId);
    if (disposed || flight.requesting || flight.attempt >= MAX_CANCEL_ATTEMPTS || !isCancellationPending(snapshot)) return;
    if (flight.timer) {
      clearTimeout(flight.timer);
      flight.timer = undefined;
    }
    flight.requesting = true;
    flight.attempt += 1;
    try {
      const [requestError, response] = await asyncTo(
        electronAPI.chatAgentCancelCheckpoint({
          checkpointId: snapshot.checkpointId
        })
      );
      if (disposed || cancelFlights.get(snapshot.checkpointId) !== flight) return;
      if (!requestError && response?.ok) {
        await projectSnapshot(response.data);
        return;
      }

      // transport/UNKNOWN 不表示取消失败；保持 busy，并只通过事实源和有界 retry 收敛。
      await resync();
    } finally {
      flight.requesting = false;
      if (!disposed && cancelFlights.get(snapshot.checkpointId) === flight) {
        const current = latestSnapshots.get(snapshot.checkpointId) ?? snapshot;
        if (isCancellationPending(current) && flight.attempt < MAX_CANCEL_ATTEMPTS) {
          scheduleCancelReconcile(current);
        }
      }
    }
  }

  /**
   * 检查当前 Session 快照，覆盖订阅前已经发生的取消或挂起收敛。
   * @param checkpointId - Checkpoint ID
   */
  function inspectCheckpoint(checkpointId: string): void {
    const snapshot = latestSnapshots.get(checkpointId);
    if (!snapshot || disposed) return;
    if (snapshot.status === 'ready_to_resume') scheduleReadyDrain();
    if (isCancellationPending(snapshot)) {
      requestCancellation(snapshot).catch((error: unknown): void => {
        logger.error(`[chat-agent-cancel] ${error instanceof Error ? error.message : String(error)}`);
      });
    }
  }

  /**
   * 为 Checkpoint 所属 Session 监听 cooperative cancellation 与等待栅栏。
   * 注册后立即检查当前状态，避免 cancel-before-watch 丢失。
   * @param snapshot - Checkpoint 身份投影
   */
  function watchCheckpoint(snapshot: ChatAgentCheckpointSnapshot): void {
    if (!checkpointSubscriptions.has(snapshot.checkpointId)) {
      const sessionRef = actorSystem.getSession(snapshot.sessionId);
      if (!sessionRef) return;
      checkpointSubscriptions.set(
        snapshot.checkpointId,
        sessionRef.subscribe((): void => {
          inspectCheckpoint(snapshot.checkpointId);
        })
      );
    }
    inspectCheckpoint(snapshot.checkpointId);
  }

  /**
   * 更新已有聊天标签的 Checkpoint 终态，不无端创建 owner。
   * @param snapshot - 终态 Checkpoint
   */
  function updateTerminalTab(snapshot: ChatAgentCheckpointSnapshot): void {
    const owner = runtimeStore.findOwner(snapshot.sessionId);
    if (!owner) return;
    if (snapshot.status === 'cancelled' || snapshot.status === 'completed') {
      runtimeStore.setStatus(owner.tabId, 'idle');
    } else if (snapshot.status === 'interrupted' || snapshot.status === 'failed') {
      runtimeStore.setStatus(owner.tabId, 'error');
    }
  }

  /**
   * 投影单个权威 Checkpoint，并按状态执行幂等对账。
   * @param snapshot - allowlist 快照
   */
  async function projectSnapshot(snapshot: ChatAgentCheckpointSnapshot): Promise<void> {
    if (disposed) return;
    const order = trackSnapshot(snapshot);
    if (order === 'stale') return;

    if (snapshot.status === 'resuming' && snapshot.resumeRuntimeId) {
      clearResumeFlight(snapshot.checkpointId, snapshot.resumeRuntimeId);
      const address = createResumeAddress(snapshot, snapshot.resumeRuntimeId);
      actorSystem.registerRuntime(address, createResumeCapabilities());
    }
    if (order === 'newer') actorSystem.recoverDelegation(snapshot);
    watchCheckpoint(snapshot);

    if (snapshot.status === 'ready_to_resume') {
      ensureResumeFlight(snapshot);
      scheduleReadyDrain();
      return;
    }
    if (snapshot.status === 'resuming') {
      clearCancelFlight(snapshot.checkpointId);
      return;
    }
    if (snapshot.status === 'cancelling') {
      scheduleCancelReconcile(snapshot);
      return;
    }
    if (snapshot.status === 'cancelled' || snapshot.status === 'interrupted' || snapshot.status === 'completed' || snapshot.status === 'failed') {
      clearResumeFlight(snapshot.checkpointId);
      clearCancelFlight(snapshot.checkpointId);
      clearCheckpointWatch(snapshot.checkpointId);
      updateTerminalTab(snapshot);
    }
  }

  /**
   * 处理 listActive 中缺席的未决候选。
   * absence 不是终态证据；保留同一 tuple/attempt，并按已有预算继续幂等请求。
   * @param activeCheckpointIds - 当前公开非终态 Checkpoint 集合
   */
  function reconcileAbsent(activeCheckpointIds: ReadonlySet<string>): void {
    resumeFlights.forEach((flight, checkpointId): void => {
      if (activeCheckpointIds.has(checkpointId)) return;
      if (!flight.requesting && flight.attempt >= MAX_RESUME_ATTEMPTS) {
        exhaustResumeFlight(flight);
      } else {
        scheduleReadyDrain();
      }
    });
    cancelFlights.forEach((flight, checkpointId): void => {
      if (activeCheckpointIds.has(checkpointId)) return;
      const snapshot = latestSnapshots.get(checkpointId);
      if (snapshot && isCancellationPending(snapshot)) {
        if (!flight.requesting && flight.attempt < MAX_CANCEL_ATTEMPTS) scheduleCancelReconcile(snapshot);
      } else {
        clearCancelFlight(checkpointId);
      }
    });
  }

  /**
   * 从 Main 事实源对账全部非终态 Checkpoint。
   */
  async function runResync(): Promise<void> {
    if (disposed) return;
    const [requestError, response] = await asyncTo(electronAPI.chatAgentListActive());
    if (requestError || !response) throw requestError ?? new Error('Chat Agent recovery returned no response');
    const snapshots = unwrapAgentResult(response);
    const activeCheckpointIds = new Set(snapshots.map((snapshot): string => snapshot.checkpointId));
    for (const snapshot of snapshots) {
      // 同一 Checkpoint 必须串行投影，防止多个 Runtime B 预注册交错。
      // eslint-disable-next-line no-await-in-loop
      await projectSnapshot(snapshot);
    }
    reconcileAbsent(activeCheckpointIds);
  }

  /**
   * 合并当前对账；对账内部再次请求时排队下一轮，避免 Promise 自等待。
   */
  async function resync(): Promise<void> {
    if (resyncPromise) {
      resyncQueued = true;
      return;
    }
    resyncPromise = runResync();
    try {
      await resyncPromise;
    } finally {
      resyncPromise = undefined;
      if (resyncQueued && !disposed) {
        resyncQueued = false;
        resync().catch((error: unknown): void => {
          logger.error(`[chat-agent-resync] ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    }
  }

  /**
   * 处理单调 application event；检测 sequence gap 后补一次事实源对账。
   * @param event - Main 广播的公开事件
   */
  function handleEvent(event: ChatAgentApplicationEvent): void {
    if (event.type !== 'checkpoint.updated') return;
    const current = cursors.get(event.checkpoint.checkpointId);
    if (current && event.checkpointSequence > current.checkpointSequence + 1) {
      resync().catch((error: unknown): void => {
        logger.error(`[chat-agent-resync] ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    projectSnapshot(event.checkpoint).catch((error: unknown): void => {
      logger.error(`[chat-agent-event] ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  const disposeEvent = electronAPI.chatAgentOnEvent(handleEvent);
  const supervisorSubscription = actorSystem.actor.subscribe((): void => {
    scheduleReadyDrain();
  });
  resync().catch((error: unknown): void => {
    logger.error(`[chat-agent-recovery] ${error instanceof Error ? error.message : String(error)}`);
  });

  onScopeDispose((): void => {
    disposed = true;
    disposeEvent();
    supervisorSubscription.unsubscribe();
    checkpointSubscriptions.forEach((subscription): void => subscription.unsubscribe());
    checkpointSubscriptions.clear();
    resumeFlights.forEach((flight): void => actorSystem.unregisterRuntime(flight.resumeRuntimeId));
    resumeFlights.clear();
    cancelFlights.forEach((flight): void => {
      if (flight.timer) clearTimeout(flight.timer);
    });
    cancelFlights.clear();
    cursors.clear();
    latestSnapshots.clear();
    rejectedResumeTuples.clear();
  });
}
