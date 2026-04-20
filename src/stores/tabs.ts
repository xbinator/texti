/**
 * @file tabs.ts
 * @description 管理编辑器标签页列表、脏状态以及持久化顺序。
 */

import { defineStore } from 'pinia';
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
}

/**
 * 标签页状态结构。
 */
export interface TabsState {
  /** 标签页列表 */
  tabs: Tab[];
  /** 标签页未保存修改状态映射 */
  dirtyById: Record<string, boolean>;
}

const TABS_STORAGE_KEY = 'app_tabs';

/**
 * 读取本地持久化的标签页数据。
 * @returns 标签页状态
 */
export function loadSavedData(): TabsState {
  const saved = local.getItem<TabsState>(TABS_STORAGE_KEY);
  if (!saved || !Array.isArray(saved.tabs)) return { tabs: [], dirtyById: {} };

  return {
    tabs: saved.tabs.map((tab) => ({ id: tab.id, path: tab.path, title: tab.title })),
    dirtyById: saved.dirtyById ?? {}
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
      const index = this.tabs.findIndex((t) => t.id === tab.id);
      if (tab.path.startsWith('/settings')) {
        const _index = this.tabs.findIndex((t) => t.path.includes('/settings'));

        const _tab = { ...tab, title: '设置' };
        _index === -1 ? this.tabs.push(_tab) : (this.tabs[_index] = _tab);
      } else if (index === -1) {
        this.tabs.push(tab);
      } else {
        this.tabs[index] = tab;
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

      this.tabs.splice(index, 1);
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
