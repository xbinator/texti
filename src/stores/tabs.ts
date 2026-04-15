import { defineStore } from 'pinia';
import { local } from '@/shared/storage/base';

export interface Tab {
  // 标签页唯一标识
  id: string;
  // 当前页面路径（router path / fullPath）
  path: string;
  // 标签页显示的标题
  title: string;

  // 标签页元数据
  meta?: {
    // 文件 id
    fileId?: string;
  };
}

export interface TabsState {
  // 标签页列表
  tabs: Tab[];
  // 当前激活的标签页ID
  activeId: string | null;
  dirtyById: Record<string, boolean>;
}

const TABS_STORAGE_KEY = 'app_tabs';

export function loadSavedData(): TabsState {
  const saved = local.getItem<TabsState>(TABS_STORAGE_KEY);
  if (!saved || !Array.isArray(saved.tabs)) return { tabs: [], activeId: null, dirtyById: {} };

  return {
    tabs: saved.tabs.map((tab) => ({ id: tab.id, path: tab.path, title: tab.title })),
    // 当前激活的标签页ID
    activeId: saved.activeId ?? null,
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
    activeTab: (state): Tab | null => {
      return state.tabs.find((tab) => tab.id === state.activeId) || null;
    }
  },

  actions: {
    // 添加标签页
    addTab(tab: Tab): void {
      const index = this.tabs.findIndex((t) => t.id === tab.id);
      index === -1 && this.tabs.push(tab);

      this.activeId = tab.id;

      persistData(this.$state);
    },

    // 删除标签页
    removeTab(id: string): void {
      const index = this.tabs.findIndex((t) => t.id === id);
      if (index === -1) return;

      this.tabs.splice(index, 1);
      delete this.dirtyById[id];

      if (this.activeId === id) {
        if (this.tabs.length > 0) this.activeId = this.tabs[Math.max(0, index - 1)].id;
        else this.activeId = null;
      }

      persistData(this.$state);
    },

    setActiveTab(id: string): void {
      if (!this.tabs.some((t) => t.id === id)) return;

      this.activeId = id;

      persistData(this.$state);
    }
  }
});
