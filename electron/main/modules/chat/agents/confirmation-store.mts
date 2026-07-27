/**
 * @file confirmation-store.mts
 * @description Main-owned Child Agent confirmation queue、持久化 waiter 与 Renderer allowlist 投影。
 */
import type {
  AgentConfirmationDecision,
  AgentConfirmationRecord,
  ChatAgentApplicationEvent,
  ChatAgentConfirmationSnapshot,
  ChatAgentResolveConfirmationInput
} from 'types/chat-agent';
import { AGENT_MAX_DIFF_BYTES, hashAgentPayload, hashAgentText } from './contracts.mjs';
import { AgentStoreProtocolError, type AgentDelegationStore, type CreateAgentConfirmationInput, type ResolveAgentConfirmationInput } from './types.mjs';

/** Confirmation queue 允许调用的最小持久化 Store 能力。 */
export type AgentConfirmationQueueStore = Pick<
  AgentDelegationStore,
  'createConfirmation' | 'resolveConfirmation' | 'revokeConfirmation' | 'listPendingConfirmations'
>;

/** Confirmation queue 可替换依赖。 */
export interface AgentConfirmationQueueDependencies {
  /** confirmation 权威持久化事实。 */
  readonly store: AgentConfirmationQueueStore;
  /**
   * 从 Main 私有引用读取 unified diff。
   * @param reference - 已持久化的私有 diff 引用
   * @returns 完整文本 diff
   */
  readonly readUnifiedDiff: (reference: string) => string;
  /**
   * 发布可通过 list snapshot 补偿的 Renderer event。
   * @param event - allowlist application event
   */
  readonly publish: (event: ChatAgentApplicationEvent) => void;
  /** @returns 当前 ISO-8601 时间。 */
  readonly now: () => string;
}

/** 单个 pending confirmation 的进程内完成回调。 */
type ConfirmationWaiter = (decision: AgentConfirmationDecision) => void;

/** Main-owned confirmation queue 对外能力。 */
export interface AgentConfirmationQueue {
  /**
   * 先持久化 confirmation，再注册当前进程 waiter。
   * @param input - 不可变 confirmation 请求
   * @returns 用户决议；Main 重启不会恢复旧 Promise
   */
  request(input: CreateAgentConfirmationInput): Promise<AgentConfirmationDecision>;
  /**
   * 使用 Renderer 观察版本执行 CAS 决议。
   * @param input - 最小决议输入
   * @returns 已通过 allowlist 的权威投影
   */
  resolve(input: ChatAgentResolveConfirmationInput): ChatAgentConfirmationSnapshot;
  /**
   * 撤销一个 Task 的全部 pending confirmation。
   * @param taskId - 目标 Task
   * @param reason - 稳定撤销原因
   * @returns 已撤销的权威投影
   */
  revokeTask(taskId: string, reason: string): ChatAgentConfirmationSnapshot[];
  /**
   * 使 pending 或已批准但尚未创建 journal 的 confirmation 失效。
   * @param confirmationId - 目标 confirmation
   * @param reason - 稳定失效原因
   * @returns revoked 权威投影
   */
  invalidate(confirmationId: string, reason: string): ChatAgentConfirmationSnapshot;
  /** @returns 当前全部 pending confirmation allowlist 投影。 */
  listPending(): ChatAgentConfirmationSnapshot[];
  /** 启动或 Renderer 恢复时重发全部 pending 事实，不创建 waiter。 */
  recover(): void;
}

/**
 * 验证并投影一条持久化 confirmation。
 * @param record - Store 权威记录
 * @param readUnifiedDiff - 私有 diff 读取器
 * @returns Renderer allowlist 快照
 */
function projectConfirmation(
  record: AgentConfirmationRecord,
  readUnifiedDiff: AgentConfirmationQueueDependencies['readUnifiedDiff']
): ChatAgentConfirmationSnapshot {
  const { request } = record;
  const unifiedDiff = readUnifiedDiff(request.unifiedDiffReference);
  if (Buffer.byteLength(unifiedDiff, 'utf8') > AGENT_MAX_DIFF_BYTES) {
    throw new AgentStoreProtocolError('confirmation_diff_size_exceeded', 'Confirmation diff exceeds the projection limit', 'confirmation');
  }
  const observedDiffHash = hashAgentPayload({
    schemaVersion: 1,
    baseRevision: request.baseRevision,
    operationSetHash: request.operationSetHash,
    diffContentHash: hashAgentText(unifiedDiff)
  });
  if (observedDiffHash !== request.diffHash) {
    throw new AgentStoreProtocolError(
      'confirmation_diff_integrity_invalid',
      'Confirmation diff no longer matches its persisted integrity facts',
      'confirmation'
    );
  }

  return Object.freeze({
    confirmationId: record.confirmationId,
    sessionId: request.sessionId,
    turnId: request.turnId,
    taskId: request.taskId,
    attemptId: request.attemptId,
    agentId: request.agentId,
    runtimeId: request.runtimeId,
    toolCallId: request.toolCallId,
    changesetId: request.changesetId,
    status: record.status,
    version: record.version,
    riskLevel: request.riskLevel,
    displayPaths: Object.freeze([...request.displayPaths]),
    resourceScopes: Object.freeze([...request.resourceScopes]),
    unifiedDiff,
    baseRevision: request.baseRevision,
    diffHash: request.diffHash,
    operationSetHash: request.operationSetHash,
    planHash: request.planHash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  });
}

/**
 * 把权威终态映射为 waiter 可消费的决议。
 * revoked 代表权限已失效，对执行方等价于拒绝。
 * @param snapshot - confirmation 权威投影
 * @returns 可完成 waiter 的决议；pending 返回 undefined
 */
function projectDecision(snapshot: ChatAgentConfirmationSnapshot): AgentConfirmationDecision | undefined {
  if (snapshot.status === 'pending') return undefined;
  return {
    decision: snapshot.status === 'approved' ? 'approved' : 'rejected',
    version: snapshot.version
  };
}

/**
 * 创建 Main-owned 持久化 confirmation queue。
 * @param dependencies - Store、diff 读取器与发布器
 * @returns confirmation queue
 */
export function createAgentConfirmationQueue(dependencies: AgentConfirmationQueueDependencies): AgentConfirmationQueue {
  const waiters = new Map<string, Set<ConfirmationWaiter>>();
  const publishedRevisions = new Map<string, string>();

  /**
   * 发布新权威版本；Renderer 不在线时持久化事实仍保持有效。
   * @param snapshot - allowlist 快照
   * @param force - 恢复流程是否强制重发当前版本
   */
  function publishSnapshot(snapshot: ChatAgentConfirmationSnapshot, force = false): void {
    const revision = `${snapshot.version}:${snapshot.status}:${snapshot.updatedAt}`;
    if (!force && publishedRevisions.get(snapshot.confirmationId) === revision) return;
    try {
      dependencies.publish({
        schemaVersion: 1,
        type: 'confirmation.updated',
        confirmation: snapshot
      });
      publishedRevisions.set(snapshot.confirmationId, revision);
    } catch {
      // Renderer event 是可由 listPending 补偿的投影，发布失败不能回滚持久化决议。
    }
  }

  /**
   * 完成并删除一个 confirmation 的全部当前进程 waiter。
   * @param snapshot - 已终态化 confirmation
   */
  function settleWaiters(snapshot: ChatAgentConfirmationSnapshot): void {
    const decision = projectDecision(snapshot);
    if (!decision) return;
    const pendingWaiters = waiters.get(snapshot.confirmationId);
    if (!pendingWaiters) return;
    waiters.delete(snapshot.confirmationId);
    pendingWaiters.forEach((resolve): void => resolve(decision));
  }

  /**
   * 投影并广播 Store 权威记录。
   * @param record - 持久化 confirmation
   * @returns allowlist 投影
   */
  function projectRecord(record: AgentConfirmationRecord): ChatAgentConfirmationSnapshot {
    const snapshot = projectConfirmation(record, dependencies.readUnifiedDiff);
    publishSnapshot(snapshot);
    settleWaiters(snapshot);
    return snapshot;
  }

  return {
    request(input: CreateAgentConfirmationInput): Promise<AgentConfirmationDecision> {
      // 持久化必须发生在 waiter 建立之前，Renderer 缺席也不会丢失请求事实。
      const record = dependencies.store.createConfirmation(input);
      const snapshot = projectRecord(record);
      const settledDecision = projectDecision(snapshot);
      if (settledDecision) return Promise.resolve(settledDecision);

      return new Promise<AgentConfirmationDecision>((resolve): void => {
        const confirmationWaiters = waiters.get(record.confirmationId) ?? new Set<ConfirmationWaiter>();
        confirmationWaiters.add(resolve);
        waiters.set(record.confirmationId, confirmationWaiters);
      });
    },

    resolve(input: ChatAgentResolveConfirmationInput): ChatAgentConfirmationSnapshot {
      const storeInput: ResolveAgentConfirmationInput = {
        confirmationId: input.confirmationId,
        expectedVersion: input.expectedVersion,
        decision: input.decision,
        occurredAt: dependencies.now()
      };
      return projectRecord(dependencies.store.resolveConfirmation(storeInput));
    },

    revokeTask(taskId: string, reason: string): ChatAgentConfirmationSnapshot[] {
      const occurredAt = dependencies.now();
      return dependencies.store
        .listPendingConfirmations()
        .filter((record): boolean => record.request.taskId === taskId)
        .map((record): ChatAgentConfirmationSnapshot => {
          const revoked = dependencies.store.revokeConfirmation(record.confirmationId, reason, occurredAt);
          return projectRecord(revoked);
        });
    },

    invalidate(confirmationId: string, reason: string): ChatAgentConfirmationSnapshot {
      return projectRecord(dependencies.store.revokeConfirmation(confirmationId, reason, dependencies.now()));
    },

    listPending(): ChatAgentConfirmationSnapshot[] {
      return dependencies.store.listPendingConfirmations().map((record): ChatAgentConfirmationSnapshot => {
        return projectConfirmation(record, dependencies.readUnifiedDiff);
      });
    },

    recover(): void {
      dependencies.store.listPendingConfirmations().forEach((record): void => {
        publishSnapshot(projectConfirmation(record, dependencies.readUnifiedDiff), true);
      });
    }
  };
}
