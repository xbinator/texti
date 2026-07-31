/**
 * @file confirmationQueue.ts
 * @description 合并 Runtime 临时确认与 Child Agent 持久化确认的应用级 Renderer 队列投影。
 */
import type { ChatAgentConfirmationSnapshot, ChatAgentHandlerResult } from 'types/chat-agent';
import { defineStore } from 'pinia';
import type { AIToolConfirmationRequest } from '@/ai/tools/confirmation';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { asyncTo } from '@/utils/asyncTo';

/** Renderer confirmation queue 的统一可序列化项。 */
export type ChatConfirmationQueueItem =
  | {
      /** 普通 ChatRuntime 的临时确认。 */
      readonly source: 'runtime';
      /** Renderer 内稳定 confirmation 身份。 */
      readonly confirmationId: string;
      /** confirmation 所属会话。 */
      readonly sessionId: string;
      /** confirmation 所属 Runtime。 */
      readonly runtimeId: string;
      /** 可选的工具调用身份，用于精确处理取消事件。 */
      readonly toolCallId?: string;
      /** 归一化工具确认请求。 */
      readonly request: AIToolConfirmationRequest;
      /** 请求进入队列的 ISO-8601 时间。 */
      readonly createdAt: string;
    }
  | {
      /** Main-owned Child Agent 持久化确认。 */
      readonly source: 'agent';
      /** Main 持久化 confirmation 身份。 */
      readonly confirmationId: string;
      /** 只包含 Renderer allowlist 的权威快照。 */
      readonly snapshot: ChatAgentConfirmationSnapshot;
      /** 不可变请求时间。 */
      readonly createdAt: string;
    };

/** Runtime confirmation queue 项。 */
export type ChatRuntimeConfirmationItem = Extract<ChatConfirmationQueueItem, { source: 'runtime' }>;
/** Agent confirmation queue 窄类型。 */
export type ChatAgentConfirmationItem = Extract<ChatConfirmationQueueItem, { source: 'agent' }>;

/** Agent confirmation 的单调 cursor。 */
interface AgentConfirmationCursor {
  /** 最近权威 CAS 版本。 */
  version: number;
  /** 同版本的权威更新时间。 */
  updatedAt: string;
  /** 不含可变状态、版本和更新时间的冻结请求身份。 */
  identityKey: string;
  /** 一旦观察到终态，后续 pending 永远不得复活。 */
  terminal: boolean;
}

/** recovery 请求开始时冻结的 Agent pending cursor。 */
interface AgentRecoveryBaseline {
  /** wrapper 与 snapshot 共同身份。 */
  confirmationId: string;
  /** 请求开始时的 CAS 版本。 */
  version: number;
  /** 请求开始时的权威更新时间。 */
  updatedAt: string;
}

/** Application-level confirmation queue 状态。 */
interface ChatConfirmationQueueState {
  /** 按 confirmationId 保存的可序列化 pending 投影。 */
  items: Record<string, ChatConfirmationQueueItem>;
  /** 用户显式定位的当前 confirmation。 */
  selectedId: string | null;
  /** 即使终态项已移除，仍保留其单调 cursor 防止旧事件复活。 */
  agentCursors: Record<string, AgentConfirmationCursor>;
  /** Agent 终态 cursor 从最旧到最新的淘汰顺序。 */
  agentTerminalOrder: string[];
}

/** 风险排序权重；数值越大越优先展示。 */
const RISK_PRIORITY = {
  read: 1,
  write: 2,
  dangerous: 3
} as const;

/** Renderer 最多保留的 Agent 终态 tombstone 数量。 */
const MAX_AGENT_TERMINAL_CURSORS = 512;

/** 每个 Pinia Store 实例独享的不可序列化 recovery flight。 */
const AGENT_RECOVERY_FLIGHTS = new WeakMap<object, Promise<void>>();

/**
 * 写入 Agent cursor，并按最近终态顺序淘汰最旧 tombstone。
 * @param cursors - 当前 Agent cursor 表
 * @param terminalOrder - 从最旧到最新的终态 cursor 身份
 * @param confirmationId - confirmation 身份
 * @param cursor - 最新单调 cursor
 */
function setAgentCursor(
  cursors: Record<string, AgentConfirmationCursor>,
  terminalOrder: string[],
  confirmationId: string,
  cursor: AgentConfirmationCursor
): void {
  const existingOrderIndex = terminalOrder.indexOf(confirmationId);
  if (existingOrderIndex >= 0) terminalOrder.splice(existingOrderIndex, 1);
  cursors[confirmationId] = cursor;
  if (cursor.terminal) terminalOrder.push(confirmationId);
  while (terminalOrder.length > MAX_AGENT_TERMINAL_CURSORS) {
    const oldestId = terminalOrder.shift();
    if (oldestId) delete cursors[oldestId];
  }
}

/**
 * 解包 confirmation IPC 信封。
 * @param result - Main handler 结果
 * @returns 公开 pending 快照
 */
function unwrapAgentResult(result: ChatAgentHandlerResult<ChatAgentConfirmationSnapshot[]>): ChatAgentConfirmationSnapshot[] {
  if (!result.ok) {
    const error = new Error('chat_agent_confirmation_recovery_failed');
    Object.assign(error, { code: result.code });
    throw error;
  }
  return result.data;
}

/**
 * 读取统一 queue item 的风险级别。
 * @param item - Runtime 或 Agent confirmation
 * @returns 风险等级
 */
function getRisk(item: ChatConfirmationQueueItem): keyof typeof RISK_PRIORITY {
  return item.source === 'runtime' ? item.request.riskLevel : item.snapshot.riskLevel;
}

/**
 * 按风险优先、FIFO 和稳定 ID 比较 confirmation。
 * @param left - 左侧项
 * @param right - 右侧项
 * @returns Array.sort 比较值
 */
function compareConfirmations(left: ChatConfirmationQueueItem, right: ChatConfirmationQueueItem): number {
  const riskDifference = RISK_PRIORITY[getRisk(right)] - RISK_PRIORITY[getRisk(left)];
  if (riskDifference !== 0) return riskDifference;
  const timeDifference = left.createdAt.localeCompare(right.createdAt);
  if (timeDifference !== 0) return timeDifference;
  return left.confirmationId.localeCompare(right.confirmationId);
}

/**
 * 创建 confirmation 不可变请求字段的有序身份键。
 * @param snapshot - Main allowlist confirmation
 * @returns 排除 status、version、updatedAt 后的稳定序列化身份
 */
function createIdentityKey(snapshot: ChatAgentConfirmationSnapshot): string {
  return JSON.stringify([
    snapshot.confirmationId,
    snapshot.sessionId,
    snapshot.turnId,
    snapshot.taskId,
    snapshot.attemptId,
    snapshot.agentId,
    snapshot.runtimeId,
    snapshot.toolCallId,
    snapshot.changesetId,
    snapshot.riskLevel,
    snapshot.displayPaths,
    snapshot.resourceScopes,
    snapshot.unifiedDiff,
    snapshot.baseRevision,
    snapshot.diffHash,
    snapshot.operationSetHash,
    snapshot.planHash,
    snapshot.createdAt
  ]);
}

/**
 * 判断 Agent 快照是否严格更新。
 * @param snapshot - 待应用快照
 * @param current - 当前 cursor
 * @returns 是否允许覆盖或终态化当前投影
 */
function isNewerSnapshot(snapshot: ChatAgentConfirmationSnapshot, current: AgentConfirmationCursor | undefined): boolean {
  if (!current) return true;
  if (current.identityKey !== createIdentityKey(snapshot)) return false;
  if (current.terminal && snapshot.status === 'pending') return false;
  if (snapshot.version !== current.version) return snapshot.version > current.version;
  return snapshot.updatedAt > current.updatedAt;
}

/**
 * 判断 confirmation 是否已经进入不可逆终态。
 * @param snapshot - Main allowlist confirmation
 * @returns 是否为非 pending 状态
 */
function isTerminalSnapshot(snapshot: ChatAgentConfirmationSnapshot): boolean {
  return snapshot.status !== 'pending';
}

/** 应用级 confirmation queue Store。 */
export const useChatConfirmationQueueStore = defineStore('chat-confirmation-queue', {
  state: (): ChatConfirmationQueueState => ({
    items: {},
    selectedId: null,
    agentCursors: {},
    agentTerminalOrder: []
  }),

  getters: {
    /** @returns 风险优先、请求时间 FIFO 的全部 pending 项。 */
    pending(state): ChatConfirmationQueueItem[] {
      return Object.values(state.items).sort(compareConfirmations);
    },

    /** @returns 显式选中项；不存在时返回队列首项。 */
    current(): ChatConfirmationQueueItem | null {
      if (this.selectedId && this.items[this.selectedId]) return this.items[this.selectedId] ?? null;
      return this.pending[0] ?? null;
    }
  },

  actions: {
    /**
     * 加入一个 Runtime 临时 confirmation。
     * @param item - 已归一化 Runtime queue item
     */
    addRuntime(item: ChatRuntimeConfirmationItem): void {
      if (this.items[item.confirmationId]) {
        throw new Error('confirmation_identity_conflict');
      }
      this.items[item.confirmationId] = item;
    },

    /**
     * 删除一个 Runtime confirmation 投影。
     * @param confirmationId - 目标 confirmation
     * @returns 是否删除成功
     */
    removeRuntime(confirmationId: string): boolean {
      const item = this.items[confirmationId];
      if (!item || item.source !== 'runtime') return false;
      delete this.items[confirmationId];
      if (this.selectedId === confirmationId) this.selectedId = null;
      return true;
    },

    /**
     * 应用单条 Agent 权威快照，旧 version/event 不得复活或覆盖。
     * @param snapshot - Main allowlist 快照
     */
    applyAgent(snapshot: ChatAgentConfirmationSnapshot): void {
      const currentItem = this.items[snapshot.confirmationId];
      // Runtime 临时身份属于另一个 owner 域，Agent 快照不得覆盖。
      if (currentItem?.source === 'runtime') return;
      const currentCursor = this.agentCursors[snapshot.confirmationId];
      if (!isNewerSnapshot(snapshot, currentCursor)) return;
      setAgentCursor(this.agentCursors, this.agentTerminalOrder, snapshot.confirmationId, {
        version: snapshot.version,
        updatedAt: snapshot.updatedAt,
        identityKey: createIdentityKey(snapshot),
        terminal: currentCursor?.terminal === true || isTerminalSnapshot(snapshot)
      });
      if (snapshot.status !== 'pending') {
        const current = this.items[snapshot.confirmationId];
        if (current?.source === 'agent') delete this.items[snapshot.confirmationId];
        if (this.selectedId === snapshot.confirmationId) this.selectedId = null;
        return;
      }
      this.items[snapshot.confirmationId] = {
        source: 'agent',
        confirmationId: snapshot.confirmationId,
        snapshot,
        createdAt: snapshot.createdAt
      };
    },

    /**
     * 单调合并一组 Main pending snapshot。
     * 此方法不表达删除；带请求前 baseline 的缺失清理由 applyRecovery 执行。
     * @param snapshots - Main 当前全部 pending confirmation
     */
    applySnapshot(snapshots: readonly ChatAgentConfirmationSnapshot[]): void {
      snapshots.forEach((snapshot): void => this.applyAgent(snapshot));
    },

    /**
     * 以请求前 baseline 收敛一次恢复响应。
     * 响应缺失只清理从请求开始后完全未变化的 Agent 项。
     * @param snapshots - Main 当前全部 pending confirmation
     * @param baseline - 请求发起前冻结的本地 pending cursor
     */
    applyRecovery(snapshots: readonly ChatAgentConfirmationSnapshot[], baseline: readonly AgentRecoveryBaseline[]): void {
      const responseIds = new Set(snapshots.map((snapshot): string => snapshot.confirmationId));
      snapshots.forEach((snapshot): void => this.applyAgent(snapshot));
      baseline.forEach((entry): void => {
        if (responseIds.has(entry.confirmationId)) return;
        const current = this.items[entry.confirmationId];
        const cursor = this.agentCursors[entry.confirmationId];
        if (
          current?.source !== 'agent' ||
          current.confirmationId !== current.snapshot.confirmationId ||
          current.snapshot.status !== 'pending' ||
          current.snapshot.version !== entry.version ||
          current.snapshot.updatedAt !== entry.updatedAt ||
          !cursor ||
          cursor.version !== entry.version ||
          cursor.updatedAt !== entry.updatedAt
        ) {
          return;
        }
        // Main 权威 pending 列表已确认该请求消失，保留有界终态 fence 防止迟到事件复活。
        setAgentCursor(this.agentCursors, this.agentTerminalOrder, entry.confirmationId, { ...cursor, terminal: true });
        delete this.items[entry.confirmationId];
        if (this.selectedId === entry.confirmationId) this.selectedId = null;
      });
    },

    /**
     * 精确查找同一 Session、Task 和 Attempt 的 pending Agent confirmation。
     * @param sessionId - Session 身份
     * @param taskId - Task 身份
     * @param attemptId - Attempt 身份
     * @returns 维持统一队列稳定排序的精确匹配
     */
    findAgent(sessionId: string, taskId: string, attemptId: string): ChatAgentConfirmationItem[] {
      if (!sessionId.trim() || !taskId.trim() || !attemptId.trim()) return [];
      return this.pending.filter(
        (item): item is ChatAgentConfirmationItem =>
          item.source === 'agent' &&
          item.confirmationId === item.snapshot.confirmationId &&
          item.snapshot.status === 'pending' &&
          item.snapshot.sessionId === sessionId &&
          item.snapshot.taskId === taskId &&
          item.snapshot.attemptId === attemptId
      );
    },

    /**
     * 从 Main 事实源恢复全部 pending Agent confirmation。
     * 同一个 Store 的 hook 与任务卡片共享一个 flight。
     */
    recoverAgent(): Promise<void> {
      const storeKey = this as object;
      const currentFlight = AGENT_RECOVERY_FLIGHTS.get(storeKey);
      if (currentFlight) return currentFlight;
      const baseline = Object.values(this.items)
        .filter(
          (item): item is ChatAgentConfirmationItem =>
            item.source === 'agent' && item.confirmationId === item.snapshot.confirmationId && item.snapshot.status === 'pending'
        )
        .map(
          (item): AgentRecoveryBaseline => ({
            confirmationId: item.confirmationId,
            version: item.snapshot.version,
            updatedAt: item.snapshot.updatedAt
          })
        );
      // 延迟到 microtask 才调用 IPC，使 WeakMap 能先同步登记 flight，并把同步 throw 转为 rejected Promise。
      const request = Promise.resolve()
        .then(() => getElectronAPI().chatAgentListConfirmations())
        .then(unwrapAgentResult);
      const flight = (async (): Promise<void> => {
        const [requestError, snapshots] = await asyncTo(request);
        if (requestError || !snapshots) throw requestError ?? new Error('chat_agent_confirmation_recovery_empty');
        this.applyRecovery(snapshots, baseline);
      })().finally((): void => {
        if (AGENT_RECOVERY_FLIGHTS.get(storeKey) === flight) AGENT_RECOVERY_FLIGHTS.delete(storeKey);
      });
      AGENT_RECOVERY_FLIGHTS.set(storeKey, flight);
      return flight;
    },

    /**
     * 定位一个现存 pending confirmation。
     * @param confirmationId - 目标身份
     */
    select(confirmationId: string): void {
      if (this.items[confirmationId]) this.selectedId = confirmationId;
    }
  }
});
