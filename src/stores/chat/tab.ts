/**
 * @file tab.ts
 * @description 管理聊天标签的 renderer 运行时归属、可视状态与后台分离记录。
 */
import { defineStore } from 'pinia';
import type { Tab, TabStatus } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

/** BChat 直接发布的运行状态。 */
export type ChatTabSourceStatus = 'idle' | 'running' | 'waiting' | 'error';
/** 聊天 Runtime 的完整状态。 */
export type ChatTabRuntimeStatus = ChatTabSourceStatus | 'completed';

/** 聊天运行状态到通用标签视觉状态的完整映射。 */
const TAB_STATUS_MAP: Record<ChatTabRuntimeStatus, TabStatus | undefined> = {
  idle: undefined,
  running: 'loading',
  waiting: 'attention',
  error: 'error',
  completed: 'completed'
};

/**
 * 将聊天运行状态写入通用标签状态。
 * @param tabId - 标签 ID
 * @param status - 聊天运行状态
 */
function syncTabStatus(tabId: string, status: ChatTabRuntimeStatus): void {
  useTabsStore().setTabStatus(tabId, TAB_STATUS_MAP[status]);
}

/**
 * 判断状态是否仍持有活动 Runtime。
 * @param status - 当前聊天标签状态
 * @returns 运行中或等待用户时返回 true
 */
export function isActiveRuntimeStatus(status: ChatTabRuntimeStatus): boolean {
  return status === 'running' || status === 'waiting';
}

/**
 * 单个聊天标签运行时记录。
 */
export interface ChatTabRuntimeRecord {
  /** 标签 ID。 */
  tabId: string;
  /** 当前真实会话 ID。 */
  sessionId?: string;
  /** 当前聊天 Runtime 状态。 */
  status: ChatTabRuntimeStatus;
  /** 外部宿主请求当前聊天页聚焦输入框的递增序号。 */
  focusRequestId?: number;
}

/**
 * 聊天标签运行时 Store 状态。
 */
interface ChatTabRuntimeState {
  /** 按标签 ID 保存的可序列化运行时记录。 */
  records: Record<string, ChatTabRuntimeRecord>;
  /** 正在执行关闭事务的标签 ID，阻止终止回调改变标签身份。 */
  closingTabIds: Set<string>;
  /** 正在提交草稿晋升导航的标签 ID，阻止并发关闭或删除。 */
  promotingTabIds: Set<string>;
}

/**
 * 创建空闲聊天标签运行时记录。
 * @param tabId - 标签 ID
 * @param sessionId - 可选持久化会话 ID
 * @returns 新运行时记录
 */
function createRuntimeRecord(tabId: string, sessionId?: string): ChatTabRuntimeRecord {
  return {
    tabId,
    ...(sessionId ? { sessionId } : {}),
    status: 'idle'
  };
}

/** 聊天标签 renderer 运行时 Store。 */
export const useChatTabStore = defineStore('chat-tab', {
  state: (): ChatTabRuntimeState => ({
    records: {},
    closingTabIds: new Set<string>(),
    promotingTabIds: new Set<string>()
  }),

  actions: {
    /**
     * 确保标签存在运行时记录。
     * @param tabId - 标签 ID
     * @param sessionId - 可选持久化会话 ID
     * @returns 当前运行时记录
     */
    ensureTab(tabId: string, sessionId?: string): ChatTabRuntimeRecord {
      const current = this.records[tabId];
      if (current) {
        if (sessionId) current.sessionId = sessionId;
        return current;
      }

      const record = createRuntimeRecord(tabId, sessionId);
      this.records[tabId] = record;
      return record;
    },

    /**
     * 将已有 Runtime 状态显式恢复到对应的通用标签。
     * @param tabId - 标签 ID
     */
    syncStatus(tabId: string): void {
      const record = this.records[tabId];
      if (!record) return;
      syncTabStatus(tabId, record.status);
    },

    /**
     * 将真实会话绑定到聊天标签。
     * @param tabId - 标签 ID
     * @param sessionId - 持久化会话 ID
     */
    bindSession(tabId: string, sessionId: string): void {
      const record = this.records[tabId];
      if (!record) return;
      record.sessionId = sessionId;
    },

    /**
     * 查找持有指定会话的聊天标签。
     * @param sessionId - 持久化会话 ID
     * @returns 会话拥有者记录
     */
    findOwner(sessionId: string): ChatTabRuntimeRecord | undefined {
      return Object.values(this.records).find((record: ChatTabRuntimeRecord): boolean => record.sessionId === sessionId);
    },

    /**
     * 读取聊天标签展示状态。
     * @param tabId - 标签 ID
     * @returns 标签状态，未注册时按 idle 处理
     */
    getStatus(tabId: string): ChatTabRuntimeStatus {
      return this.records[tabId]?.status ?? 'idle';
    },

    /**
     * 判断标签是否处于关闭事务中。
     * @param tabId - 标签 ID
     * @returns 是否正在关闭
     */
    isClosing(tabId: string): boolean {
      return this.closingTabIds.has(tabId);
    },

    /**
     * 标记一批标签进入关闭事务。
     * @param tabIds - 标签 ID 列表
     */
    markClosing(tabIds: string[]): void {
      tabIds.forEach((tabId: string): void => {
        this.closingTabIds.add(tabId);
      });
    },

    /**
     * 取消一批标签的关闭事务。
     * @param tabIds - 标签 ID 列表
     */
    clearClosing(tabIds: string[]): void {
      tabIds.forEach((tabId: string): void => {
        this.closingTabIds.delete(tabId);
      });
    },

    /**
     * 判断标签是否正在提交身份晋升。
     * @param tabId - 标签 ID
     * @returns 是否正在晋升
     */
    isPromoting(tabId: string): boolean {
      return this.promotingTabIds.has(tabId);
    },

    /**
     * 标记一批标签进入身份晋升事务。
     * @param tabIds - 标签 ID 列表
     */
    markPromoting(tabIds: string[]): void {
      tabIds.forEach((tabId: string): void => {
        this.promotingTabIds.add(tabId);
      });
    },

    /**
     * 结束一批标签的身份晋升事务。
     * @param tabIds - 标签 ID 列表
     */
    clearPromoting(tabIds: string[]): void {
      tabIds.forEach((tabId: string): void => {
        this.promotingTabIds.delete(tabId);
      });
    },

    /**
     * 同步 BChat 直接运行状态。
     * @param tabId - 标签 ID
     * @param status - BChat 状态
     */
    setStatus(tabId: string, status: ChatTabSourceStatus): void {
      const record = this.records[tabId];
      if (!record) return;
      if (!(record.status === 'completed' && status === 'idle')) {
        record.status = status;
      }
      syncTabStatus(tabId, record.status);
    },

    /**
     * 标记一次成功完成；后台完成时产生未读状态。
     * @param tabId - 标签 ID
     * @param active - 标签是否处于当前激活状态
     */
    markCompleted(tabId: string, active: boolean): void {
      const record = this.records[tabId];
      if (!record) return;
      record.status = active ? 'idle' : 'completed';
      syncTabStatus(tabId, record.status);
    },

    /**
     * 标记用户正在查看聊天标签。
     * running/waiting 保留真实状态以便再次进入后台时恢复提示；终态提示被确认后归一为 idle。
     * @param tabId - 标签 ID
     */
    markViewed(tabId: string): void {
      const record = this.records[tabId];
      if (!record) return;
      if (record.status === 'error' || record.status === 'completed') record.status = 'idle';
      const tabsStore = useTabsStore();
      const visualStatus = tabsStore.tabs.find((tab: Tab): boolean => tab.id === tabId)?.status;
      if (visualStatus) tabsStore.setTabStatus(tabId, undefined);
    },

    /**
     * 请求指定聊天标签在可见时聚焦输入框。
     * @param tabId - 标签 ID
     */
    requestFocus(tabId: string): void {
      const record = this.records[tabId];
      if (!record) return;
      record.focusRequestId = (record.focusRequestId ?? 0) + 1;
    },

    /**
     * 将草稿标签运行时状态迁移到持久化标签。
     * @param sourceTabId - 原草稿标签 ID
     * @param targetTabId - 新持久化标签 ID
     * @param sessionId - 新持久化会话 ID
     */
    promoteTab(sourceTabId: string, targetTabId: string, sessionId: string): void {
      const sourceRecord = this.records[sourceTabId];
      if (!sourceRecord || this.isClosing(sourceTabId)) return;
      this.records[targetTabId] = {
        ...sourceRecord,
        tabId: targetTabId,
        sessionId
      };
      delete this.records[sourceTabId];

      useTabsStore().setTabStatus(sourceTabId, undefined);
      syncTabStatus(targetTabId, sourceRecord.status);
    },

    /**
     * 清理聊天标签的运行时记录。
     * @param tabId - 标签 ID
     */
    removeTab(tabId: string): void {
      useTabsStore().setTabStatus(tabId, undefined);
      delete this.records[tabId];
      this.closingTabIds.delete(tabId);
      this.promotingTabIds.delete(tabId);
    },

    /**
     * 关闭一个可见聊天标签；活动 Runtime 改为后台记录，终态记录直接清理。
     * @param tabId - 已关闭的可见标签 ID
     */
    closeTab(tabId: string): void {
      const record = this.records[tabId];
      if (!record) return;
      useTabsStore().setTabStatus(tabId, undefined);
      this.closingTabIds.delete(tabId);
      this.promotingTabIds.delete(tabId);

      if (isActiveRuntimeStatus(record.status) && record.sessionId) {
        const detachedTabId = `chat:${record.sessionId}`;
        this.records[detachedTabId] = { ...record, tabId: detachedTabId };
        if (detachedTabId !== tabId) delete this.records[tabId];
        useTabsStore().setTabStatus(detachedTabId, undefined);
        return;
      }

      this.removeTab(tabId);
    }
  }
});
