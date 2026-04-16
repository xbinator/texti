import { defineStore } from 'pinia';
import { local } from '@/shared/storage/base';

export interface Tab {
  // 标签页唯一标识
  id: string;
  // 当前页面路径（router path / fullPath）
  path: string;
  // 标签页显示的标题
  title: string;
}

export interface TabsState {
  // 标签页列表
  tabs: Tab[];
  dirtyById: Record<string, boolean>;
}

const TABS_STORAGE_KEY = 'app_tabs';

export function loadSavedData(): TabsState {
  const saved = local.getItem<TabsState>(TABS_STORAGE_KEY);
  if (!saved || !Array.isArray(saved.tabs)) return { tabs: [], dirtyById: {} };

  return {
    tabs: saved.tabs.map((tab) => ({ id: tab.id, path: tab.path, title: tab.title })),
    dirtyById: saved.dirtyById ?? {}
  };
}

export function persistData(state: TabsState): void {
  local.setItem(TABS_STORAGE_KEY, state);
}

// 标签页状态管理 Store
export const useTabsStore = defineStore('tabs', {
  state: (): TabsState => loadSavedData(),

  getters: {
    // 获取当前激活的标签页对象
    activeTab: (): Tab | null => {
      // 由于 activeId 已移除，这里返回 null
      return null;
    }
  },

  actions: {
    // 添加标签页
    addTab(tab: Tab): void {
      const index = this.tabs.findIndex((t) => t.id === tab.id);
      if (tab.path.startsWith('/settings')) {
        const _index = this.tabs.findIndex((t) => t.path.includes('/settings'));

        const _tab = { ...tab, title: '设置' };
        _index === -1 ? this.tabs.push(_tab) : (this.tabs[_index] = _tab);
      } else if (index === -1) {
        this.tabs.push(tab);
      }

      persistData(this.$state);
    },

    // 删除标签页
    removeTab(id: string): void {
      const index = this.tabs.findIndex((t) => t.id === id);
      if (index === -1) return;

      this.tabs.splice(index, 1);
      delete this.dirtyById[id];

      persistData(this.$state);
    },

    // 设置标签页为已修改状态
    setDirty(id: string): void {
      this.dirtyById[id] = true;
      persistData(this.$state);
    },

    // 清除标签页的修改状态
    clearDirty(id: string): void {
      this.dirtyById[id] = false;
      persistData(this.$state);
    },

    // 检查标签页是否已修改
    isDirty(id: string): boolean {
      return this.dirtyById[id] === true;
    }
  }
});
