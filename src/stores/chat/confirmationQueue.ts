/**
 * @file confirmationQueue.ts
 * @description 合并 Runtime 临时确认与 Child Agent 持久化确认的应用级 Renderer 队列投影。
 */
import type { ChatAgentConfirmationSnapshot } from 'types/chat-agent';
import { defineStore } from 'pinia';
import type { AIToolConfirmationRequest } from '@/ai/tools/confirmation';

/** Renderer confirmation queue 的统一可序列化项。 */
export type ChatConfirmationQueueItem =
  | {
      /** 普通 ChatRuntime 的临时确认。 */
      readonly source: 'runtime';
      /** Renderer 内稳定 confirmation 身份。 */
      readonly confirmationId: string;
      /** 创建该确认控制器的稳定 owner。 */
      readonly ownerId: string;
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

/** Agent confirmation 的单调 cursor。 */
interface AgentConfirmationCursor {
  /** 最近权威 CAS 版本。 */
  version: number;
  /** 同版本的权威更新时间。 */
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
}

/** 风险排序权重；数值越大越优先展示。 */
const RISK_PRIORITY = {
  read: 1,
  write: 2,
  dangerous: 3
} as const;

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
 * 判断 Agent 快照是否严格更新。
 * @param snapshot - 待应用快照
 * @param current - 当前 cursor
 * @returns 是否允许覆盖或终态化当前投影
 */
function isNewerSnapshot(snapshot: ChatAgentConfirmationSnapshot, current: AgentConfirmationCursor | undefined): boolean {
  if (!current) return true;
  if (snapshot.version !== current.version) return snapshot.version > current.version;
  return snapshot.updatedAt > current.updatedAt;
}

/** 应用级 confirmation queue Store。 */
export const useChatConfirmationQueueStore = defineStore('chat-confirmation-queue', {
  state: (): ChatConfirmationQueueState => ({
    items: {},
    selectedId: null,
    agentCursors: {}
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
     * 仅由匹配 owner 删除一个 Runtime confirmation。
     * @param confirmationId - 目标 confirmation
     * @param ownerId - 控制器 owner
     * @returns 是否删除成功
     */
    removeRuntime(confirmationId: string, ownerId: string): boolean {
      const item = this.items[confirmationId];
      if (!item || item.source !== 'runtime' || item.ownerId !== ownerId) return false;
      delete this.items[confirmationId];
      if (this.selectedId === confirmationId) this.selectedId = null;
      return true;
    },

    /**
     * 删除一个 controller 拥有的全部 Runtime 项，绝不触碰 Agent 项。
     * @param ownerId - 稳定 controller owner
     * @returns 已删除 confirmation IDs
     */
    removeOwner(ownerId: string): string[] {
      const ownedIds = Object.values(this.items)
        .filter((item): item is ChatRuntimeConfirmationItem => item.source === 'runtime' && item.ownerId === ownerId)
        .map((item): string => item.confirmationId);
      ownedIds.forEach((confirmationId): void => {
        this.removeRuntime(confirmationId, ownerId);
      });
      return ownedIds;
    },

    /**
     * 应用单条 Agent 权威快照，旧 version/event 不得复活或覆盖。
     * @param snapshot - Main allowlist 快照
     */
    applyAgent(snapshot: ChatAgentConfirmationSnapshot): void {
      const currentCursor = this.agentCursors[snapshot.confirmationId];
      if (!isNewerSnapshot(snapshot, currentCursor)) return;
      this.agentCursors[snapshot.confirmationId] = {
        version: snapshot.version,
        updatedAt: snapshot.updatedAt
      };
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
     * 合并一次 Main pending snapshot。
     * 新事件可能先于 list response 到达，因此只移除不晚于 snapshot 水位的缺失旧项。
     * @param snapshots - Main 当前全部 pending confirmation
     */
    applySnapshot(snapshots: readonly ChatAgentConfirmationSnapshot[]): void {
      const snapshotIds = new Set(snapshots.map((snapshot): string => snapshot.confirmationId));
      const snapshotWatermark = snapshots.reduce((latest, snapshot): string => (snapshot.updatedAt > latest ? snapshot.updatedAt : latest), '');
      snapshots.forEach((snapshot): void => this.applyAgent(snapshot));
      if (!snapshotWatermark) return;
      Object.values(this.items).forEach((item): void => {
        if (item.source !== 'agent' || snapshotIds.has(item.confirmationId) || item.snapshot.updatedAt > snapshotWatermark) return;
        delete this.items[item.confirmationId];
        if (this.selectedId === item.confirmationId) this.selectedId = null;
      });
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
