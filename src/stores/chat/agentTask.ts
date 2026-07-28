/**
 * @file agentTask.ts
 * @description 应用级 Child Task Renderer 投影、单调收敛和按 Session 恢复 Store。
 */
import type {
  ChatAgentGetTaskResult,
  ChatAgentHandlerResult,
  ChatAgentListTasksResult,
  ChatAgentTaskDetailSnapshot,
  ChatAgentTaskEventSnapshot,
  ChatAgentTaskSnapshot,
  ChatAgentTaskSummarySnapshot
} from 'types/chat-agent';
import { ref } from 'vue';
import { defineStore } from 'pinia';
import { logger } from '@/shared/logger';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { asyncTo } from '@/utils/asyncTo';

/** Renderer 当前支持的公开 Task 投影版本。 */
const TASK_SCHEMA_VERSION = 1;
/** Session 摘要和历史分页的固定页大小。 */
const TASK_PAGE_LIMIT = 50;

/** Task 投影的精确应用结果。 */
export type ChatAgentTaskApplyOutcome = 'applied' | 'stale' | 'identity_conflict' | 'schema_incompatible' | 'tombstone_conflict';

/** Session 请求应用分页内容后的兼容性结果。 */
interface PageApplyResult {
  /** 当前页是否全部使用受支持的投影版本。 */
  compatible: boolean;
  /** 当前页是否没有身份、tombstone 或 Session 冲突。 */
  valid: boolean;
}

/** 带稳定机器码的 Agent IPC 失败。 */
interface AgentTaskIPCError extends Error {
  /** Main handler 返回的稳定错误码。 */
  code: string;
}

/**
 * 为一个复合索引片段添加 UTF-8 字节长度前缀。
 * @param value - 原始索引片段
 * @returns 无碰撞长度编码
 */
function encodeKeyPart(value: string): string {
  return `${new TextEncoder().encode(value).byteLength}:${value}`;
}

/**
 * 创建 Session、Assistant Message 和 Tool Call 的无碰撞索引。
 * @param sessionId - Session 身份
 * @param assistantMessageId - Assistant 消息身份
 * @param toolCallId - Tool Call 身份
 * @returns 长度编码后的复合 key
 */
export function createTaskIndexKey(sessionId: string, assistantMessageId: string, toolCallId: string): string {
  return `${encodeKeyPart(sessionId)}${encodeKeyPart(assistantMessageId)}${encodeKeyPart(toolCallId)}`;
}

/**
 * 解包 Agent IPC handler 信封并保留稳定错误码。
 * @param result - Main handler 结果
 * @returns 成功数据
 */
function unwrapAgentResult<T>(result: ChatAgentHandlerResult<T>): T {
  if (!result.ok) {
    const error = new Error('chat_agent_request_failed') as AgentTaskIPCError;
    error.code = result.code;
    throw error;
  }
  return result.data;
}

/**
 * 从 asyncTo 归一化错误中读取原 handler 机器码。
 * @param error - asyncTo 返回的错误
 * @returns 稳定机器码
 */
function readErrorCode(error: Error): string {
  const { cause } = error;
  if (cause instanceof Error && 'code' in cause && typeof cause.code === 'string') return cause.code;
  return 'transport_failed';
}

/**
 * 判断字符串是否可作为不可变身份。
 * @param value - 待判断值
 * @returns 是否为非空字符串
 */
function isIdentity(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * 校验公开 Task 快照的公共不可变身份与 sequence。
 * @param snapshot - 待校验投影
 * @returns 身份字段是否完整
 */
function hasValidIdentity(snapshot: ChatAgentTaskEventSnapshot): boolean {
  return (
    isIdentity(snapshot.taskId) &&
    isIdentity(snapshot.sessionId) &&
    isIdentity(snapshot.turnId) &&
    isIdentity(snapshot.checkpointId) &&
    isIdentity(snapshot.assistantMessageId) &&
    isIdentity(snapshot.toolCallId) &&
    Number.isSafeInteger(snapshot.taskSequence) &&
    snapshot.taskSequence > 0 &&
    (snapshot.recordState === 'tombstoned' || isIdentity(snapshot.agentId))
  );
}

/**
 * 判断两个投影是否属于同一不可变 Task 身份。
 * live 对 live 额外约束稳定 Child Actor。
 * @param current - 当前可信投影
 * @param incoming - 待应用投影
 * @returns 不可变身份是否一致
 */
function hasSameIdentity(current: ChatAgentTaskEventSnapshot, incoming: ChatAgentTaskEventSnapshot): boolean {
  const samePublicIdentity =
    current.taskId === incoming.taskId &&
    current.sessionId === incoming.sessionId &&
    current.turnId === incoming.turnId &&
    current.checkpointId === incoming.checkpointId &&
    current.assistantMessageId === incoming.assistantMessageId &&
    current.toolCallId === incoming.toolCallId;
  if (!samePublicIdentity) return false;
  if (current.recordState === 'active' && incoming.recordState === 'active') return current.agentId === incoming.agentId;
  return true;
}

/**
 * 从 Detail 显式裁剪列表与事件允许使用的 Summary 字段。
 * @param detail - Main 返回的公开 Detail
 * @returns 不携带详情字段的 Summary
 */
function trimTaskSummary(detail: ChatAgentTaskDetailSnapshot): ChatAgentTaskSummarySnapshot {
  return {
    recordState: 'active',
    taskId: detail.taskId,
    sessionId: detail.sessionId,
    turnId: detail.turnId,
    checkpointId: detail.checkpointId,
    assistantMessageId: detail.assistantMessageId,
    toolCallId: detail.toolCallId,
    agentId: detail.agentId,
    projectionSchemaVersion: detail.projectionSchemaVersion,
    taskSequence: detail.taskSequence,
    task: detail.task,
    mode: detail.mode,
    required: detail.required,
    priority: detail.priority,
    ...(detail.deadlineAt ? { deadlineAt: detail.deadlineAt } : {}),
    status: detail.status,
    ...(detail.queuePhase ? { queuePhase: detail.queuePhase } : {}),
    ...(detail.currentAttempt ? { currentAttempt: detail.currentAttempt } : {}),
    ...(detail.cancellation ? { cancellation: detail.cancellation } : {}),
    ...(detail.summary ? { summary: detail.summary } : {}),
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt
  };
}

/** 应用级 Child Task Renderer Store。 */
export const useChatAgentTaskStore = defineStore('chat-agent-task', () => {
  /** taskId 到最新 Summary 或 tombstone。 */
  const tasksById = ref<Record<string, ChatAgentTaskEventSnapshot>>({});
  /** taskId 到按需加载的 Detail。 */
  const detailsById = ref<Record<string, ChatAgentTaskDetailSnapshot>>({});
  /** 消息与 Tool Call 复合身份到 taskId。 */
  const taskIdsByMessageToolCall = ref<Record<string, string>>({});
  /** tombstone 后仍保留的 task sequence cursor。 */
  const taskCursors = ref<Record<string, number>>({});
  /** 已完成兼容快照恢复的 Session。 */
  const loadedSessions = ref<Record<string, boolean>>({});
  /** 最近恢复失败的 Session。 */
  const staleSessions = ref<Record<string, boolean>>({});
  /** Main/Renderer 投影版本不兼容的 Session。 */
  const incompatibleSessions = ref<Record<string, boolean>>({});
  /** Session 的下一历史页 cursor。 */
  const sessionNextCursors = ref<Record<string, string>>({});

  // 请求与 generation 是每个 Pinia Store 实例独享的运行态，不能进入可序列化 state。
  const ensureFlights = new Map<string, Promise<void>>();
  const forceRefreshFlights = new Map<string, Promise<void>>();
  const activeForceSessions = new Set<string>();
  const dirtyForceSessions = new Set<string>();
  const nextPageFlights = new Map<string, Promise<void>>();
  const taskFlights = new Map<string, Promise<ChatAgentTaskSnapshot | null>>();
  const sessionGenerations = new Map<string, number>();
  const incompatibleVersions = new Map<string, number>();
  const pageRecoveryTasks = new Set<string>();

  /**
   * 标记 Session 的最新恢复已失败。
   * @param sessionId - Session 身份
   */
  function markSessionStale(sessionId: string): void {
    if (!isIdentity(sessionId)) return;
    staleSessions.value[sessionId] = true;
  }

  /**
   * 领取 Session 下一次跨请求类型 generation。
   * @param sessionId - Session 身份
   * @returns 新 generation
   */
  function nextGeneration(sessionId: string): number {
    const generation = (sessionGenerations.get(sessionId) ?? 0) + 1;
    sessionGenerations.set(sessionId, generation);
    return generation;
  }

  /**
   * 判断请求是否仍是 Session 最新 generation。
   * @param sessionId - Session 身份
   * @param generation - 请求 generation
   * @returns 是否允许写入 Session 元状态
   */
  function isLatestGeneration(sessionId: string, generation: number): boolean {
    return sessionGenerations.get(sessionId) === generation;
  }

  /**
   * 校验新投影索引不会覆盖其他 Task。
   * @param snapshot - 待应用投影
   * @returns 索引是否仍属于同一 Task
   */
  function hasValidIndex(snapshot: ChatAgentTaskEventSnapshot): boolean {
    const indexKey = createTaskIndexKey(snapshot.sessionId, snapshot.assistantMessageId, snapshot.toolCallId);
    const indexedTaskId = taskIdsByMessageToolCall.value[indexKey];
    if (indexedTaskId !== undefined && indexedTaskId !== snapshot.taskId) return false;

    // cursor-only 恢复仍需服从已保留的反向位置事实，禁止为同一 taskId 建立第二位置。
    return Object.entries(taskIdsByMessageToolCall.value).every(
      ([retainedKey, taskId]: [string, string]): boolean => taskId !== snapshot.taskId || retainedKey === indexKey
    );
  }

  /**
   * 应用公开 Summary 或 tombstone。
   * @param snapshot - Main 权威投影
   * @returns 精确单调应用结果
   */
  function applySummary(snapshot: ChatAgentTaskEventSnapshot): ChatAgentTaskApplyOutcome {
    if (snapshot.projectionSchemaVersion !== TASK_SCHEMA_VERSION) {
      if (isIdentity(snapshot.sessionId)) {
        incompatibleSessions.value[snapshot.sessionId] = true;
        incompatibleVersions.set(snapshot.sessionId, snapshot.projectionSchemaVersion);
        // 不兼容观察属于新的 Session epoch，必须阻止更早兼容响应提交成功元状态。
        nextGeneration(snapshot.sessionId);
      }
      return 'schema_incompatible';
    }
    if (!hasValidIdentity(snapshot)) return 'identity_conflict';

    const cursor = taskCursors.value[snapshot.taskId];
    if (cursor !== undefined && snapshot.taskSequence <= cursor) return 'stale';

    const current = tasksById.value[snapshot.taskId];
    if (current && !hasSameIdentity(current, snapshot)) return 'identity_conflict';
    if (!hasValidIndex(snapshot)) return 'identity_conflict';
    if (current?.recordState === 'tombstoned' && snapshot.recordState === 'active') return 'tombstone_conflict';

    const indexKey = createTaskIndexKey(snapshot.sessionId, snapshot.assistantMessageId, snapshot.toolCallId);
    taskCursors.value[snapshot.taskId] = snapshot.taskSequence;
    tasksById.value[snapshot.taskId] = snapshot;
    taskIdsByMessageToolCall.value[indexKey] = snapshot.taskId;

    const currentDetail = detailsById.value[snapshot.taskId];
    if (snapshot.recordState === 'tombstoned' || (currentDetail && currentDetail.taskSequence < snapshot.taskSequence)) {
      delete detailsById.value[snapshot.taskId];
    }
    return 'applied';
  }

  /**
   * 应用按需加载的 Task Detail。
   * @param snapshot - Main 权威 Detail
   * @returns 精确单调应用结果
   */
  function applyDetail(snapshot: ChatAgentTaskDetailSnapshot): ChatAgentTaskApplyOutcome {
    const summary = trimTaskSummary(snapshot);
    if (summary.projectionSchemaVersion !== TASK_SCHEMA_VERSION) return applySummary(summary);
    if (!hasValidIdentity(summary)) return 'identity_conflict';

    const cursor = taskCursors.value[snapshot.taskId];
    if (cursor !== undefined && snapshot.taskSequence < cursor) return 'stale';

    const current = tasksById.value[snapshot.taskId];
    if (current && !hasSameIdentity(current, summary)) return 'identity_conflict';
    if (!hasValidIndex(summary)) return 'identity_conflict';
    if (current?.recordState === 'tombstoned') {
      return snapshot.taskSequence > current.taskSequence ? 'tombstone_conflict' : 'stale';
    }

    const currentDetail = detailsById.value[snapshot.taskId];
    if (cursor === snapshot.taskSequence) {
      if (currentDetail && currentDetail.taskSequence >= snapshot.taskSequence) return 'stale';
      if (!current) {
        const indexKey = createTaskIndexKey(snapshot.sessionId, snapshot.assistantMessageId, snapshot.toolCallId);
        // cursor-only 水位允许同 sequence 定向 Detail 恢复纯 Summary 与原位置索引。
        tasksById.value[snapshot.taskId] = summary;
        taskIdsByMessageToolCall.value[indexKey] = snapshot.taskId;
      }
      detailsById.value[snapshot.taskId] = snapshot;
      return 'applied';
    }

    const summaryOutcome = applySummary(summary);
    if (summaryOutcome !== 'applied') return summaryOutcome;
    detailsById.value[snapshot.taskId] = snapshot;
    return 'applied';
  }

  /**
   * 执行一次 Task 定向查询。
   * @param sessionId - Session 身份
   * @param taskId - Task 身份
   * @returns 收敛后的 Detail、tombstone 或 null
   */
  async function runEnsureTask(sessionId: string, taskId: string): Promise<ChatAgentTaskSnapshot | null> {
    const responsePromise = Promise.resolve()
      .then(() => getElectronAPI().chatAgentGetTask({ sessionId, taskId }))
      .then(unwrapAgentResult);
    const [requestError, snapshot] = await asyncTo<ChatAgentGetTaskResult>(responsePromise);
    if (requestError || snapshot === undefined) {
      logger.error(`[chat-agent-task-get-failed] sessionId=${sessionId} taskId=${taskId} code=${readErrorCode(requestError ?? new Error())}`);
      return null;
    }
    if (!snapshot) return null;
    if (snapshot.sessionId !== sessionId || snapshot.taskId !== taskId) {
      logger.error(`[chat-agent-task-get-identity-conflict] sessionId=${sessionId} taskId=${taskId}`);
      return null;
    }

    const outcome = snapshot.recordState === 'active' ? applyDetail(snapshot) : applySummary(snapshot);
    if (outcome === 'identity_conflict' || outcome === 'schema_incompatible' || outcome === 'tombstone_conflict') return null;
    const trustedDetail = detailsById.value[taskId];
    if (trustedDetail && trustedDetail.taskSequence === taskCursors.value[taskId]) return trustedDetail;
    const trustedTask = tasksById.value[taskId];
    return trustedTask?.recordState === 'tombstoned' ? trustedTask : null;
  }

  /**
   * 启动或复用一个 Task 定向查询，不读取当前 Summary 快捷路径。
   * @param sessionId - Session 身份
   * @param taskId - Task 身份
   * @returns 定向查询 flight
   */
  function startTaskFlight(sessionId: string, taskId: string): Promise<ChatAgentTaskSnapshot | null> {
    const flightKey = createTaskIndexKey(sessionId, taskId, '');
    const existingFlight = taskFlights.get(flightKey);
    if (existingFlight) return existingFlight;
    const flight = runEnsureTask(sessionId, taskId).finally((): void => {
      if (taskFlights.get(flightKey) === flight) taskFlights.delete(flightKey);
    });
    taskFlights.set(flightKey, flight);
    return flight;
  }

  /**
   * 消费冲突页定向恢复的全部异常并只记录稳定机器日志。
   * @param recovery - 定向恢复 Promise
   * @param sessionId - 请求 Session
   * @param taskId - 冲突 Task
   */
  async function consumePageRecovery(recovery: Promise<ChatAgentTaskSnapshot | null>, sessionId: string, taskId: string): Promise<void> {
    const [recoveryError] = await asyncTo(recovery);
    if (!recoveryError) return;
    logger.error(`[chat-agent-task-page-recovery-failed] sessionId=${sessionId} taskId=${taskId} code=projection_recovery_failed`);
  }

  /**
   * 对冲突列表项执行一次有界定向事实恢复。
   * @param sessionId - 请求 Session
   * @param taskId - 冲突 Task
   * @param recoveryKey - Session 与 Task 去重键
   */
  function recoverPageTask(sessionId: string, taskId: string, recoveryKey: string): void {
    if (!isIdentity(taskId) || pageRecoveryTasks.has(recoveryKey)) return;
    pageRecoveryTasks.add(recoveryKey);
    consumePageRecovery(startTaskFlight(sessionId, taskId), sessionId, taskId);
  }

  /**
   * 逐条单调应用一页 Session Summary。
   * @param sessionId - 请求 Session
   * @param page - Main 列表页
   * @param writeSessionMeta - 是否允许本 generation 写 Session 失败或不兼容元状态
   * @returns 当前页版本兼容性与身份有效性
   */
  function applyPageTasks(sessionId: string, page: ChatAgentListTasksResult, writeSessionMeta: boolean): PageApplyResult {
    let compatible = true;
    let valid = true;
    for (const snapshot of page.tasks) {
      const recoveryKey = createTaskIndexKey(sessionId, snapshot.taskId, '');
      if (snapshot.sessionId !== sessionId) {
        valid = false;
        logger.error(`[chat-agent-task-page-conflict] sessionId=${sessionId} taskId=${snapshot.taskId} code=session_conflict`);
        recoverPageTask(sessionId, snapshot.taskId, recoveryKey);
        continue;
      }
      if (snapshot.projectionSchemaVersion !== TASK_SCHEMA_VERSION) {
        compatible = false;
        if (writeSessionMeta) applySummary(snapshot);
        continue;
      }
      const outcome = applySummary(snapshot);
      if (outcome === 'identity_conflict' || outcome === 'tombstone_conflict') {
        valid = false;
        logger.error(`[chat-agent-task-page-conflict] sessionId=${sessionId} taskId=${snapshot.taskId} code=${outcome}`);
        recoverPageTask(sessionId, snapshot.taskId, recoveryKey);
        continue;
      }
      if (outcome === 'applied') pageRecoveryTasks.delete(recoveryKey);
    }
    if (!valid && writeSessionMeta) markSessionStale(sessionId);
    return { compatible, valid };
  }

  /**
   * 应用显式提供的 Session 列表页。
   * 列表缺失不代表删除，只有 tombstone 可以移除 live Detail。
   * @param sessionId - 请求 Session
   * @param page - Main 列表页
   */
  function applySessionPage(sessionId: string, page: ChatAgentListTasksResult): void {
    if (!isIdentity(sessionId)) return;
    const result = applyPageTasks(sessionId, page, true);
    if (!result.compatible || !result.valid) return;
    if (page.nextCursor) sessionNextCursors.value[sessionId] = page.nextCursor;
    else delete sessionNextCursors.value[sessionId];
  }

  /**
   * 提交一个兼容分页请求的最新 Session 元状态。
   * @param sessionId - Session 身份
   * @param page - 成功列表页
   */
  function commitPageMeta(sessionId: string, page: ChatAgentListTasksResult): void {
    loadedSessions.value[sessionId] = true;
    staleSessions.value[sessionId] = false;
    incompatibleSessions.value[sessionId] = false;
    incompatibleVersions.delete(sessionId);
    if (page.nextCursor) sessionNextCursors.value[sessionId] = page.nextCursor;
    else delete sessionNextCursors.value[sessionId];
  }

  /**
   * 执行一次 Session 首屏恢复。
   * @param sessionId - Session 身份
   * @param generation - 当前请求 generation
   */
  async function runEnsureSession(sessionId: string, generation: number): Promise<void> {
    const responsePromise = Promise.resolve()
      .then(() => getElectronAPI().chatAgentListTasks({ sessionId, limit: TASK_PAGE_LIMIT }))
      .then(unwrapAgentResult);
    const [requestError, page] = await asyncTo(responsePromise);
    if (requestError || !page) {
      if (isLatestGeneration(sessionId, generation)) markSessionStale(sessionId);
      logger.error(`[chat-agent-task-list-failed] sessionId=${sessionId} code=${readErrorCode(requestError ?? new Error())}`);
      return;
    }

    const latest = isLatestGeneration(sessionId, generation);
    const result = applyPageTasks(sessionId, page, latest);
    if (!latest || !result.compatible || !result.valid) return;
    commitPageMeta(sessionId, page);
  }

  /**
   * 启动一个实际 Session 首屏请求并登记当前 active flight。
   * @param sessionId - Session 身份
   * @param generation - 请求 generation
   * @returns 实际请求 Promise
   */
  function startEnsureFlight(sessionId: string, generation: number): Promise<void> {
    const flight = runEnsureSession(sessionId, generation).finally((): void => {
      if (ensureFlights.get(sessionId) === flight) ensureFlights.delete(sessionId);
    });
    ensureFlights.set(sessionId, flight);
    return flight;
  }

  /**
   * 排空一个 Session 的 forced refresh dirty epoch。
   * 实际请求期间新增 force 只追加一轮 trailing list。
   * @param sessionId - Session 身份
   * @returns 当前 dirty drain 完成 Promise
   */
  async function drainForcedRefresh(sessionId: string): Promise<void> {
    const existingFlight = ensureFlights.get(sessionId);
    if (existingFlight) await existingFlight;

    activeForceSessions.add(sessionId);
    dirtyForceSessions.delete(sessionId);
    await startEnsureFlight(sessionId, nextGeneration(sessionId));
    activeForceSessions.delete(sessionId);

    if (!dirtyForceSessions.has(sessionId)) return;
    dirtyForceSessions.delete(sessionId);
    return drainForcedRefresh(sessionId);
  }

  /**
   * 合并并排队一次强制 Session 刷新。
   * @param sessionId - Session 身份
   * @returns 强制刷新 Promise
   */
  function queueForcedRefresh(sessionId: string): Promise<void> {
    const existingForce = forceRefreshFlights.get(sessionId);
    if (existingForce) {
      if (activeForceSessions.has(sessionId)) {
        dirtyForceSessions.add(sessionId);
        // trailing force 立即夺取元状态写权，当前实际请求只允许逐条应用 Task。
        nextGeneration(sessionId);
      }
      return existingForce;
    }

    // 首次 force 立即使旧普通请求失去元状态写权；微任务启动前的重复 force 合并。
    nextGeneration(sessionId);
    const forceFlight = Promise.resolve().then((): Promise<void> => drainForcedRefresh(sessionId));
    const trackedFlight = forceFlight.finally((): void => {
      activeForceSessions.delete(sessionId);
      dirtyForceSessions.delete(sessionId);
      if (forceRefreshFlights.get(sessionId) === trackedFlight) forceRefreshFlights.delete(sessionId);
    });
    forceRefreshFlights.set(sessionId, trackedFlight);
    return trackedFlight;
  }

  /**
   * 确保 Session 首屏 Task 投影已恢复。
   * @param sessionId - Session 身份
   * @param options - 是否显式强制刷新
   * @returns 合并后的恢复 Promise
   */
  function ensureSession(sessionId: string, options: { readonly force?: boolean } = {}): Promise<void> {
    if (!isIdentity(sessionId)) return Promise.resolve();
    if (options.force) return queueForcedRefresh(sessionId);
    const existingFlight = ensureFlights.get(sessionId);
    if (existingFlight) return existingFlight;
    if (incompatibleSessions.value[sessionId]) return Promise.resolve();
    if (loadedSessions.value[sessionId] && !staleSessions.value[sessionId]) return Promise.resolve();

    const generation = nextGeneration(sessionId);
    return startEnsureFlight(sessionId, generation);
  }

  /**
   * 执行一页历史 Task 恢复。
   * @param sessionId - Session 身份
   * @param cursor - 发起请求时冻结的 cursor
   * @param generation - 当前请求 generation
   */
  async function runNextPage(sessionId: string, cursor: string, generation: number): Promise<void> {
    const responsePromise = Promise.resolve()
      .then(() => getElectronAPI().chatAgentListTasks({ sessionId, cursor, limit: TASK_PAGE_LIMIT }))
      .then(unwrapAgentResult);
    const [requestError, page] = await asyncTo(responsePromise);
    if (requestError || !page) {
      if (isLatestGeneration(sessionId, generation)) markSessionStale(sessionId);
      logger.error(`[chat-agent-task-page-failed] sessionId=${sessionId} code=${readErrorCode(requestError ?? new Error())}`);
      return;
    }

    const latest = isLatestGeneration(sessionId, generation);
    const result = applyPageTasks(sessionId, page, latest);
    if (!latest || !result.compatible || !result.valid) return;
    commitPageMeta(sessionId, page);
  }

  /**
   * 加载 Session 下一页历史 Task。
   * @param sessionId - Session 身份
   * @returns 合并后的分页 Promise
   */
  function loadNextPage(sessionId: string): Promise<void> {
    if (!isIdentity(sessionId) || incompatibleSessions.value[sessionId]) return Promise.resolve();
    const existingFlight = nextPageFlights.get(sessionId);
    if (existingFlight) return existingFlight;
    const cursor = sessionNextCursors.value[sessionId];
    if (!cursor) return Promise.resolve();

    const generation = nextGeneration(sessionId);
    const flight = runNextPage(sessionId, cursor, generation).finally((): void => {
      if (nextPageFlights.get(sessionId) === flight) nextPageFlights.delete(sessionId);
    });
    nextPageFlights.set(sessionId, flight);
    return flight;
  }

  /**
   * 确保一个历史 Task 的 Detail 或 tombstone 已恢复。
   * @param sessionId - Session 身份
   * @param taskId - Task 身份
   * @returns 合并后的定向查询结果
   */
  function ensureTask(sessionId: string, taskId: string): Promise<ChatAgentTaskSnapshot | null> {
    if (!isIdentity(sessionId) || !isIdentity(taskId)) return Promise.resolve(null);
    const current = tasksById.value[taskId];
    if (current?.sessionId === sessionId && current.recordState === 'tombstoned') return Promise.resolve(current);
    const detail = detailsById.value[taskId];
    if (detail?.sessionId === sessionId && detail.taskSequence === taskCursors.value[taskId]) return Promise.resolve(detail);

    return startTaskFlight(sessionId, taskId);
  }

  /**
   * 通过消息原位置复合身份查找 Task 投影。
   * @param sessionId - Session 身份
   * @param assistantMessageId - Assistant 消息身份
   * @param toolCallId - Tool Call 身份
   * @returns 最新 Summary 或 tombstone
   */
  function findTask(sessionId: string, assistantMessageId: string, toolCallId: string): ChatAgentTaskEventSnapshot | undefined {
    const taskId = taskIdsByMessageToolCall.value[createTaskIndexKey(sessionId, assistantMessageId, toolCallId)];
    return taskId ? tasksById.value[taskId] : undefined;
  }

  return {
    tasksById,
    detailsById,
    taskIdsByMessageToolCall,
    taskCursors,
    loadedSessions,
    staleSessions,
    incompatibleSessions,
    sessionNextCursors,
    applySummary,
    applyDetail,
    applySessionPage,
    ensureSession,
    ensureTask,
    loadNextPage,
    findTask,
    markSessionStale
  };
});
