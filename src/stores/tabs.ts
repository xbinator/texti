/**
 * @file tabs.ts
 * @description 管理编辑器标签页列表、脏状态以及持久化顺序。
 */

import { defineStore } from 'pinia';
import { resolveRouteCacheName } from '@/router/cache';
import { local } from '@/shared/storage/base';

/**
 * 拖拽排序时的插入位置。
 */
export type TabMovePosition = 'before' | 'after';

/**
 * 单个标签页数据。
 */
export interface Tab {
  /** 标签页唯一标识 */
  id: string;
  /** 当前页面路径（router path / fullPath） */
  path: string;
  /** 标签页显示的标题 */
  title: string;
  /** 标签页对应的 KeepAlive 缓存 key */
  cacheKey?: string;
}

/**
 * 标签页状态结构。
 */
export interface TabsState {
  /** 标签页列表 */
  tabs: Tab[];
  /** 标签页未保存修改状态映射 */
  dirtyById: Record<string, boolean>;
  /** 当前需要保留的 KeepAlive 缓存 key 列表 */
  cachedKeys: string[];
}

const TABS_STORAGE_KEY = 'app_tabs';

/**
 * 规范化标签页数据，兼容历史缓存中缺少 cacheKey 的记录。
 * @param tab - 待规范化的标签页
 * @returns 带有缓存 key 的标签页
 */
function normalizeTab(tab: Tab): Tab {
  return { id: tab.id, path: tab.path, title: tab.title, cacheKey: tab.cacheKey || tab.id };
}

/**
 * 去重缓存 key，并过滤空值。
 * @param keys - 缓存 key 列表
 * @returns 去重后的缓存 key 列表
 */
function normalizeCachedKeys(keys: string[]): string[] {
  return Array.from(new Set(keys.filter(Boolean)));
}

/**
 * 读取本地持久化的标签页数据。
 * @returns 标签页状态
 */
export function loadSavedData(): TabsState {
  const saved = local.getItem<TabsState>(TABS_STORAGE_KEY);
  if (!saved || !Array.isArray(saved.tabs)) return { tabs: [], dirtyById: {}, cachedKeys: [] };

  const tabs = saved.tabs.map(normalizeTab);
  const savedCachedKeys = Array.isArray(saved.cachedKeys) ? saved.cachedKeys : [];

  return {
    tabs,
    dirtyById: saved.dirtyById ?? {},
    cachedKeys: normalizeCachedKeys([...savedCachedKeys, ...tabs.map((tab) => tab.cacheKey || tab.id)])
  };
}

/**
 * 持久化标签页状态。
 * @param state - 当前标签页状态
 */
export function persistData(state: TabsState): void {
  local.setItem(TABS_STORAGE_KEY, state);
}

// 标签页状态管理 Store
export const useTabsStore = defineStore('tabs', {
  state: (): TabsState => loadSavedData(),

  getters: {
    /**
     * 获取当前 KeepAlive 应保留的包装组件名称。
     * Vue KeepAlive 的 include 按组件名过滤，因此不能直接使用业务缓存 key。
     * @param state - 标签页状态
     * @returns 组件名称列表
     */
    cachedComponentNames: (state): string[] => state.cachedKeys.map(resolveRouteCacheName),

    /**
     * 获取当前激活的标签页对象。
     * @returns 当前激活标签页，暂未维护 activeId 时返回 null
     */
    activeTab: (): Tab | null => {
      // 由于 activeId 已移除，这里返回 null
      return null;
    }
  },

  actions: {
    /**
     * 添加或更新标签页。
     * @param tab - 需要加入状态的标签页
     */
    addTab(tab: Tab): void {
      const normalizedTab = normalizeTab(tab);
      const index = this.tabs.findIndex((t) => t.id === normalizedTab.id);
      if (tab.path.startsWith('/settings')) {
        const _index = this.tabs.findIndex((t) => t.path.includes('/settings'));

        const _tab = { ...normalizedTab, title: '设置' };
        _index === -1 ? this.tabs.push(_tab) : (this.tabs[_index] = _tab);
      } else if (index === -1) {
        this.tabs.push(normalizedTab);
      } else {
        this.tabs[index] = normalizedTab;
      }

      const cacheKey = normalizedTab.cacheKey || normalizedTab.id;
      if (cacheKey && !this.cachedKeys.includes(cacheKey)) {
        this.cachedKeys.push(cacheKey);
      }

      persistData(this.$state);
    },

    /**
     * 按拖拽结果重新排列标签页顺序。
     * @param fromId - 被拖拽标签页 ID
     * @param toId - 目标标签页 ID
     * @param position - 插入到目标标签页前方或后方
     */
    moveTab(fromId: string, toId: string, position: TabMovePosition = 'before'): void {
      if (fromId === toId) {
        return;
      }

      const fromIndex = this.tabs.findIndex((tab) => tab.id === fromId);
      const toIndex = this.tabs.findIndex((tab) => tab.id === toId);
      if (fromIndex === -1 || toIndex === -1) {
        return;
      }

      const [movedTab] = this.tabs.splice(fromIndex, 1);
      if (!movedTab) {
        return;
      }

      const nextTargetIndex = this.tabs.findIndex((tab) => tab.id === toId);
      if (nextTargetIndex === -1) {
        this.tabs.splice(fromIndex, 0, movedTab);
        return;
      }

      const insertIndex = position === 'after' ? nextTargetIndex + 1 : nextTargetIndex;
      this.tabs.splice(insertIndex, 0, movedTab);
      persistData(this.$state);
    },

    /**
     * 删除标签页。
     * @param id - 标签页 ID
     */
    removeTab(id: string): void {
      const index = this.tabs.findIndex((t) => t.id === id);
      if (index === -1) return;

      const [removedTab] = this.tabs.splice(index, 1);
      const removedCacheKey = removedTab?.cacheKey || removedTab?.id || '';
      if (removedCacheKey) {
        this.cachedKeys = this.cachedKeys.filter((cacheKey) => cacheKey !== removedCacheKey);
      }
      delete this.dirtyById[id];

      persistData(this.$state);
    },

    /**
     * 标记标签页存在未保存修改。
     * @param id - 标签页 ID
     */
    setDirty(id: string): void {
      this.dirtyById[id] = true;
      persistData(this.$state);
    },

    /**
     * 清除标签页未保存修改标记。
     * @param id - 标签页 ID
     */
    clearDirty(id: string): void {
      this.dirtyById[id] = false;
      persistData(this.$state);
    },

    /**
     * 检查标签页是否存在未保存修改。
     * @param id - 标签页 ID
     * @returns 是否为脏状态
     */
    isDirty(id: string): boolean {
      return this.dirtyById[id] === true;
    }
  }
});
