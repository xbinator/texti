/**
 * @file useAgentTaskEvents.ts
 * @description 应用根唯一 Child Task application event 监听与有界协议恢复入口。
 */
import type { ChatAgentApplicationEvent } from 'types/chat-agent';
import { onScopeDispose } from 'vue';
import { logger } from '@/shared/logger';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { createTaskIndexKey, type ChatAgentTaskApplyOutcome, useChatAgentTaskStore } from '@/stores/chat/agentTask';

/** 一个 sequence mismatch streak 的三次自动恢复延迟。 */
const RECOVERY_DELAYS_MS = [0, 250, 1_000] as const;

/** Session sequence mismatch 的有界恢复状态。 */
interface SessionRecoveryState {
  /** 当前 streak 已实际发起的列表次数。 */
  attempts: number;
  /** 当前是否有真实 forced list。 */
  inFlight: boolean;
  /** 活动或冷却期间是否合并了新 mismatch。 */
  pending: boolean;
  /** 最近一次 mismatch 签名。 */
  lastSignature: string;
  /** 可选退避计时器。 */
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * 注册应用级 Task event 监听。
 * 该 hook 只由 useProvideActorSystem 调用，不主动执行 Session list。
 */
export function useAgentTaskEvents(): void {
  const electronAPI = getElectronAPI();
  if (typeof electronAPI.chatAgentOnEvent !== 'function') return;
  const taskStore = useChatAgentTaskStore();
  const sessionRecoveries = new Map<string, SessionRecoveryState>();
  const recoveredTasks = new Set<string>();
  let disposed = false;

  /**
   * 清除一个 Session 当前 mismatch streak 和退避计时器。
   * @param sessionId - Session 身份
   */
  function resetSessionRecovery(sessionId: string): void {
    const state = sessionRecoveries.get(sessionId);
    if (state?.timer) clearTimeout(state.timer);
    sessionRecoveries.delete(sessionId);
  }

  /**
   * 执行或延迟一个 Session 的下一次 forced list。
   * @param sessionId - Session 身份
   * @param state - 当前 mismatch streak
   */
  function scheduleSessionRecovery(sessionId: string, state: SessionRecoveryState): void {
    if (disposed || state.inFlight || state.timer || state.attempts >= RECOVERY_DELAYS_MS.length) return;
    /** 发起一次真实列表，并在结束后只调度一个 trailing incident。 */
    const executeRecovery = (): void => {
      state.timer = undefined;
      if (disposed || sessionRecoveries.get(sessionId) !== state) return;
      state.inFlight = true;
      state.pending = false;
      state.attempts += 1;
      const recovery = taskStore.ensureSession(sessionId, { force: true });
      const finishRecovery = (): void => {
        if (sessionRecoveries.get(sessionId) !== state) return;
        state.inFlight = false;
        if (state.pending) scheduleSessionRecovery(sessionId, state);
      };
      recovery.then(finishRecovery, finishRecovery);
    };
    const delay = RECOVERY_DELAYS_MS[state.attempts] ?? 1_000;
    if (delay === 0) executeRecovery();
    else state.timer = setTimeout(executeRecovery, delay);
  }

  /**
   * 合并同一 Session 的 mismatch，并限制一个 streak 最多三次列表。
   * @param sessionId - Session 身份
   * @param signature - 当前异常稳定签名
   */
  function recoverSession(sessionId: string, signature: string): void {
    const existing = sessionRecoveries.get(sessionId);
    if (existing?.lastSignature === signature) return;
    const state: SessionRecoveryState = existing ?? {
      attempts: 0,
      inFlight: false,
      pending: false,
      lastSignature: signature
    };
    state.lastSignature = signature;
    if (!existing) sessionRecoveries.set(sessionId, state);
    if (state.attempts >= RECOVERY_DELAYS_MS.length) {
      logger.error(`[chat-agent-task-recovery-exhausted] sessionId=${sessionId}`);
      return;
    }
    if (state.inFlight || state.timer) {
      state.pending = true;
      return;
    }
    scheduleSessionRecovery(sessionId, state);
  }

  /**
   * 对一个冲突 Task 发起至多一次定向恢复。
   * @param sessionId - Session 身份
   * @param taskId - Task 身份
   */
  function recoverTask(sessionId: string, taskId: string): void {
    const recoveryKey = createTaskIndexKey(sessionId, taskId, '');
    if (recoveredTasks.has(recoveryKey)) return;
    recoveredTasks.add(recoveryKey);
    taskStore.ensureTask(sessionId, taskId);
  }

  /**
   * 记录 Store 冲突并选择保守的有界恢复策略。
   * @param outcome - Store 精确应用结果
   * @param sessionId - Session 身份
   * @param taskId - Task 身份
   */
  function handleOutcome(outcome: ChatAgentTaskApplyOutcome, sessionId: string, taskId: string): void {
    if (outcome === 'applied') {
      // 一个可信新投影结束当前 Task 冲突 streak，后续独立冲突可再获得一次恢复预算。
      recoveredTasks.delete(createTaskIndexKey(sessionId, taskId, ''));
      return;
    }
    if (outcome === 'identity_conflict') {
      logger.error(`[chat-agent-task-identity-conflict] sessionId=${sessionId} taskId=${taskId}`);
      recoverTask(sessionId, taskId);
      return;
    }
    if (outcome === 'tombstone_conflict') {
      logger.error(`[chat-agent-task-tombstone-conflict] sessionId=${sessionId} taskId=${taskId}`);
      recoverTask(sessionId, taskId);
      return;
    }
    if (outcome === 'schema_incompatible') {
      // schema 不兼容不能用相同 Renderer 版本递归查询恢复。
      logger.error(`[chat-agent-task-schema-incompatible] sessionId=${sessionId} taskId=${taskId}`);
      resetSessionRecovery(sessionId);
    }
  }

  /**
   * 只消费 task.updated，并在写 Store 前校验事件外层 cursor。
   * @param event - Main application event
   */
  function handleEvent(event: ChatAgentApplicationEvent): void {
    if (disposed || event.type !== 'task.updated') return;
    const { task } = event;
    if (event.taskSequence !== task.taskSequence) {
      logger.error(`[chat-agent-task-event-sequence-mismatch] sessionId=${task.sessionId} taskId=${task.taskId}`);
      recoverSession(task.sessionId, createTaskIndexKey(task.taskId, String(task.taskSequence), String(event.taskSequence)));
      return;
    }
    const wasIncompatible = taskStore.incompatibleSessions[task.sessionId] === true;
    const outcome = taskStore.applySummary(task);
    handleOutcome(outcome, task.sessionId, task.taskId);
    if (outcome === 'applied') {
      // 一个外层 cursor 自洽且 schema 受支持的事件结束此前 sequence mismatch streak。
      resetSessionRecovery(task.sessionId);
      if (wasIncompatible) recoverSession(task.sessionId, `schema-supported:${task.projectionSchemaVersion}`);
    }
  }

  // 监听先于任何 BChat Session 激活查询，避免恢复期间出现事件空窗。
  const disposeEvent = electronAPI.chatAgentOnEvent(handleEvent);
  onScopeDispose((): void => {
    disposed = true;
    sessionRecoveries.forEach((state): void => {
      if (state.timer) clearTimeout(state.timer);
    });
    sessionRecoveries.clear();
    disposeEvent();
  });
}
