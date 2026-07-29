/**
 * @file tabs.ts
 * @description 管理编辑器标签页列表、脏状态以及持久化顺序。
 */

import { defineStore } from 'pinia';
import { isPlainObject, omit, uniqBy } from 'lodash-es';
import { resolveRouteCacheName } from '@/router/cache';
import { createRecentKey } from '@/shared/storage';
import { storeEvents } from '@/stores/helpers/events';
import type { FileMissingPayload, FileRecoveredPayload } from '@/stores/helpers/events';
import { loadPersistedState, persistState } from '@/stores/helpers/persist';
import type { PersistConfig } from '@/stores/helpers/types';

/**
 * 拖拽排序时的插入位置。
 */
export type TabMovePosition = 'before' | 'after';

/**
 * 标签页关闭动作类型。
 */
export type TabCloseAction = 'close' | 'closeOthers' | 'closeRight' | 'closeSaved' | 'closeAll';

/**
 * 关闭计划生成时的输入参数。
 */
export interface TabClosePlanOptions {
  /** 右键命中的锚点标签 ID */
  anchorTabId?: string | null;
  /** 调用方感知到的当前激活标签 ID */
  activeTabId?: string | null;
  /** 是否允许关闭最后一个剩余标签 */
  allowCloseLastTab?: boolean;
}

/**
 * 标签页通用视觉状态。
 */
export type TabStatus = 'loading' | 'attention' | 'error' | 'completed';

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
  /** 标签页显示图标，使用 Iconify 图标名 */
  icon?: string;
  /** 标签页关联的最近记录稳定键。 */
  recentKey?: string;
  /** 标签页瞬时视觉状态，不进入持久化。 */
  status?: TabStatus;
}

/**
 * 添加标签页时的行为选项。
 */
export interface AddTabOptions {
  /** 已存在相同标签时是否保留当前标题 */
  preserveTitle?: boolean;
}

/**
 * 标签原位替换参数。
 */
export interface ReplaceTabOptions {
  /** 被替换的标签 ID。 */
  sourceId: string;
  /** 替换后的完整标签。 */
  tab: Tab;
}

/**
 * 标签页状态结构。
 */
export interface TabsState {
  /** 标签页列表 */
  tabs: Tab[];
  /** 最近一次成功导航到的页面路径。 */
  activePath: string | null;
  /** 标签页未保存修改状态映射 */
  dirtyById: Record<string, boolean>;
  /** 标签页对应文件已从磁盘丢失的状态映射 */
  missingById: Record<string, boolean>;
  /** 当前需要保留的 KeepAlive 缓存 key 列表 */
  cachedKeys: string[];
}

/**
 * 单次标签页关闭动作的执行计划。
 */
export interface TabClosePlan {
  /** 关闭动作类型 */
  action: TabCloseAction;
  /** 本次动作的锚点标签 ID */
  anchorTabId: string | null;
  /** 当前激活标签 ID */
  activeTabId: string | null;
  /** 是否允许关闭最后一个剩余标签 */
  allowCloseLastTab: boolean;
  /** 当前动作是否禁用 */
  disabled: boolean;
  /** 命中的目标标签 ID 列表 */
  targetTabIds: string[];
  /** 目标中处于脏状态的标签 ID 列表 */
  dirtyTabIds: string[];
  /** 是否需要二次确认 */
  requiresConfirm: boolean;
  /** 执行后是否需要导航 */
  requiresNavigation: boolean;
  /** 导航目标路径；当 requiresNavigation 为 true 且为 null 时表示跳转欢迎页 */
  nextActivePath: string | null;
}

const TABS_STORAGE_KEY = 'app_tabs';
const WELCOME_ROUTE_PATH = '/welcome';

const DEFAULT_TABS_STATE: TabsState = {
  tabs: [],
  activePath: null,
  dirtyById: {},
  missingById: {},
  cachedKeys: []
};

/**
 * 安全解码路由片段。
 * @param value - 原始路由片段
 * @returns 解码后的路由片段
 */
function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 从路由路径解析指定前缀后的业务 ID。
 * @param path - 标签页路径
 * @param routePrefix - 路由前缀
 * @returns 解码后的业务 ID，非目标路由时返回空字符串
 */
function resolveRouteEntityId(path: string, routePrefix: string): string {
  if (!path.startsWith(routePrefix)) return '';

  const rawId = path.slice(routePrefix.length).split(/[/?#]/)[0] ?? '';
  return rawId ? decodeRouteSegment(rawId).trim() : '';
}

/**
 * 从旧标签页路径迁移最近记录稳定键。
 * @param path - 标签页路径
 * @returns 最近记录稳定键，非最近记录路由时返回空字符串
 */
function deriveRecentKey(path: string): string {
  const fileId = resolveRouteEntityId(path, '/editor/');
  if (fileId) return createRecentKey({ type: 'file', id: fileId });

  const widgetId = resolveRouteEntityId(path, '/widget/');
  if (widgetId) return createRecentKey({ type: 'widget', id: widgetId });

  const chatId = resolveRouteEntityId(path, '/chat/');
  if (chatId) return createRecentKey({ type: 'chat', id: chatId });

  return '';
}

/**
 * 规范化运行时标签页数据，兼容缺少 cacheKey 的记录并保留瞬时状态。
 * @param tab - 待规范化的标签页
 * @returns 带有缓存 key 的运行时标签页
 */
function normalizeTab(tab: Tab): Tab {
  const icon = typeof tab.icon === 'string' ? tab.icon.trim() : '';
  const recentKey = typeof tab.recentKey === 'string' ? tab.recentKey.trim() : deriveRecentKey(tab.path);

  return {
    id: tab.id,
    path: tab.path,
    title: tab.title,
    cacheKey: tab.cacheKey || tab.id,
    ...(icon ? { icon } : {}),
    ...(recentKey ? { recentKey } : {}),
    ...(tab.status ? { status: tab.status } : {})
  };
}

/**
 * 规范化持久化标签页并移除历史瞬时状态。
 * @param value - 从持久化数据读取的未知标签值
 * @returns 不含瞬时状态的有效标签；字段损坏时返回 undefined
 */
function normalizePersistedTab(value: unknown): Tab | undefined {
  if (!isPlainObject(value)) return undefined;

  const tab = value as Record<string, unknown>;
  const id = typeof tab.id === 'string' ? tab.id.trim() : '';
  const path = typeof tab.path === 'string' ? tab.path.trim() : '';
  const title = typeof tab.title === 'string' ? tab.title.trim() : undefined;
  if (!id || !path || title === undefined) return undefined;

  const cacheKey = typeof tab.cacheKey === 'string' ? tab.cacheKey.trim() : '';
  const icon = typeof tab.icon === 'string' ? tab.icon.trim() : '';
  const recentKey = typeof tab.recentKey === 'string' ? tab.recentKey.trim() : '';
  return {
    id,
    path,
    title,
    cacheKey: cacheKey || id,
    ...(recentKey ? { recentKey } : {}),
    ...(icon ? { icon } : {})
  };
}

/**
 * 过滤持久化布尔映射，仅保留当前有效标签的 true 标记。
 * @param value - 未知持久化映射
 * @param validIds - 当前有效标签 ID
 * @returns 安全的状态映射
 */
function normalizeFlagMap(value: unknown, validIds: Set<string>): Record<string, boolean> {
  if (!isPlainObject(value)) return {};

  return Object.entries(value as Record<string, unknown>).reduce<Record<string, boolean>>(
    (result: Record<string, boolean>, [tabId, enabled]): Record<string, boolean> => {
      if (enabled === true && validIds.has(tabId)) result[tabId] = true;
      return result;
    },
    {}
  );
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
 * 规范化待持久化的路由路径。
 * @param value - 未知路由路径值
 * @returns 合法应用内路径，非法时返回 null
 */
function normalizeActiveRoutePath(value: unknown): string | null {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path || path === '/' || !path.startsWith('/')) return null;

  return path;
}

/**
 * 过滤恢复入口路径，避免启动时跳转到已关闭的标签。
 * @param value - 未知持久化路径
 * @param tabs - 已恢复的标签页列表
 * @returns 可用于启动恢复的路径
 */
function normalizeRestoredActivePath(value: unknown, tabs: Tab[]): string | null {
  const path = normalizeActiveRoutePath(value);
  if (!path) return null;
  if (path === WELCOME_ROUTE_PATH) return path;

  return tabs.some((tab: Tab): boolean => tab.path === path) ? path : null;
}

/**
 * 归一化持久化的标签页数据。
 * @param value - 从 localStorage 读取的原始数据
 * @returns 归一化后的标签页状态
 */
function normalizeTabsState(value: unknown): TabsState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_TABS_STATE };
  }

  const saved = value as Record<string, unknown>;
  if (!Array.isArray(saved.tabs)) return { ...DEFAULT_TABS_STATE };

  const tabs = uniqBy(
    saved.tabs.map(normalizePersistedTab).filter((tab: Tab | undefined): tab is Tab => tab !== undefined),
    (tab: Tab): string => tab.id
  );
  const validIds = new Set(tabs.map((tab: Tab): string => tab.id));

  return {
    tabs,
    activePath: normalizeRestoredActivePath(saved.activePath, tabs),
    dirtyById: normalizeFlagMap(saved.dirtyById, validIds),
    missingById: normalizeFlagMap(saved.missingById, validIds),
    cachedKeys: normalizeCachedKeys(tabs.map((tab: Tab): string => tab.cacheKey || tab.id))
  };
}

const TABS_CONFIG: PersistConfig<TabsState> = {
  storageKey: TABS_STORAGE_KEY,
  defaults: DEFAULT_TABS_STATE,
  normalize: normalizeTabsState
};

/**
 * 加载彼此隔离的标签状态，避免默认集合在 Store 实例间共享引用。
 * @returns 当前标签状态的独立副本
 */
function loadTabsState(): TabsState {
  const state = loadPersistedState(TABS_CONFIG);

  return {
    tabs: state.tabs.map(normalizeTab),
    activePath: state.activePath,
    dirtyById: { ...state.dirtyById },
    missingById: { ...state.missingById },
    cachedKeys: [...state.cachedKeys]
  };
}

/**
 * 创建不含瞬时标签状态的持久化快照。
 * @param state - 当前标签状态
 * @returns 可安全持久化的标签状态
 */
function createPersistedState(state: TabsState): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab: Tab): Tab => omit(tab, ['status']))
  };
}

/**
 * 持久化标签状态并排除瞬时字段。
 * @param state - 当前标签状态
 */
function persistTabsState(state: TabsState): void {
  persistState(TABS_STORAGE_KEY, createPersistedState(state));
}

/**
 * 在标签页列表中查找指定标签的索引。
 * @param tabs - 当前标签页列表
 * @param tabId - 待查找的标签 ID
 * @returns 标签索引，不存在时返回 -1
 */
function findTabIndex(tabs: Tab[], tabId: string | null | undefined): number {
  if (!tabId) {
    return -1;
  }

  return tabs.findIndex((tab) => tab.id === tabId);
}

/**
 * 按关闭动作收集将被关闭的目标标签。
 * @param tabs - 当前标签页列表
 * @param action - 关闭动作类型
 * @param anchorIndex - 锚点标签索引
 * @param dirtyById - 脏状态映射
 * @returns 命中的目标标签列表
 */
function collectTargetTabs(tabs: Tab[], action: TabCloseAction, anchorIndex: number, dirtyById: Record<string, boolean>): Tab[] {
  if (action === 'close') {
    return anchorIndex === -1 ? [] : [tabs[anchorIndex]];
  }

  if (action === 'closeOthers') {
    return anchorIndex === -1 ? [] : tabs.filter((_, index) => index !== anchorIndex);
  }

  if (action === 'closeRight') {
    return anchorIndex === -1 ? [] : tabs.slice(anchorIndex + 1);
  }

  if (action === 'closeSaved') {
    return tabs.filter((tab) => dirtyById[tab.id] !== true);
  }

  return tabs.slice();
}

/**
 * 收集目标集合中的脏标签 ID。
 * @param targetTabIds - 目标标签 ID 列表
 * @param dirtyById - 脏状态映射
 * @returns 脏标签 ID 列表
 */
function collectDirtyTabIds(targetTabIds: string[], dirtyById: Record<string, boolean>): string[] {
  return targetTabIds.filter((tabId) => dirtyById[tabId] === true);
}

/**
 * 计算关闭后需要回退到的标签路径。
 * @param tabs - 关闭前的标签顺序
 * @param activeTabId - 当前激活标签 ID
 * @param targetTabIds - 本次将关闭的标签 ID 列表
 * @returns 导航目标路径；null 表示应跳转欢迎页
 */
function resolveNextActivePath(tabs: Tab[], activeTabId: string | null, targetTabIds: string[]): string | null {
  const activeIndex = findTabIndex(tabs, activeTabId);
  if (activeIndex === -1) {
    return null;
  }

  const closingIds = new Set(targetTabIds);
  const survivingTabs = tabs.filter((tab) => !closingIds.has(tab.id));
  if (survivingTabs.length === 0) {
    return null;
  }

  // 优先选择原激活标签右侧仍然保留的标签。
  for (let index = activeIndex + 1; index < tabs.length; index += 1) {
    const candidate = tabs[index];
    if (candidate && !closingIds.has(candidate.id)) {
      return candidate.path;
    }
  }

  // 若右侧没有，再回退到左侧最近的保留标签。
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    const candidate = tabs[index];
    if (candidate && !closingIds.has(candidate.id)) {
      return candidate.path;
    }
  }

  return null;
}

/**
 * 生成不可执行的空关闭计划。
 * @param action - 关闭动作类型
 * @param anchorTabId - 锚点标签 ID
 * @param activeTabId - 当前激活标签 ID
 * @param allowCloseLastTab - 是否允许关闭最后一个标签
 * @returns 禁用态关闭计划
 */
function createDisabledClosePlan(action: TabCloseAction, anchorTabId: string | null, activeTabId: string | null, allowCloseLastTab: boolean): TabClosePlan {
  return {
    action,
    anchorTabId,
    activeTabId,
    allowCloseLastTab,
    disabled: true,
    targetTabIds: [],
    dirtyTabIds: [],
    requiresConfirm: false,
    requiresNavigation: false,
    nextActivePath: null
  };
}

// 标签页状态管理 Store
export const useTabsStore = defineStore('tabs', {
  state: (): TabsState => loadTabsState(),

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
     * @returns 当前激活标签页，未命中或欢迎页时返回 null
     */
    activeTab: (state): Tab | null => state.tabs.find((tab: Tab): boolean => tab.path === state.activePath) ?? null
  },

  actions: {
    /**
     * 更新最近一次成功导航路径。
     * @param path - 当前路由完整路径
     */
    setActivePath(path: string | null): void {
      this.activePath = normalizeActiveRoutePath(path);
      persistTabsState(this.$state);
    },

    /**
     * 获取冷启动时应恢复的页面路径。
     * @returns 可恢复路径；没有可恢复页面时返回欢迎页
     */
    getStartupPath(): string {
      return this.activePath ?? WELCOME_ROUTE_PATH;
    },

    /**
     * 添加或更新标签页。
     * @param tab - 需要加入状态的标签页
     */
    addTab(tab: Tab, options: AddTabOptions = {}): void {
      const normalizedTab = normalizeTab(tab);
      const index = this.tabs.findIndex((t) => t.id === normalizedTab.id);
      if (index === -1) {
        this.tabs.push(normalizedTab);
      } else {
        const existingTab = this.tabs[index];
        const nextStatus = normalizedTab.status ?? existingTab?.status;

        this.tabs[index] = {
          ...normalizedTab,
          title: options.preserveTitle && existingTab ? existingTab.title : normalizedTab.title,
          ...(nextStatus ? { status: nextStatus } : {})
        };
      }

      const cacheKey = normalizedTab.cacheKey || normalizedTab.id;
      if (cacheKey && !this.cachedKeys.includes(cacheKey)) {
        this.cachedKeys.push(cacheKey);
      }

      persistTabsState(this.$state);
    },

    /**
     * 原位替换标签并迁移关联状态。
     * 如果路由守卫已临时创建目标标签，则折叠重复项并保留源标签位置。
     * @param options - 源标签与替换后的完整标签
     * @returns 是否完成替换
     */
    replaceTab(options: ReplaceTabOptions): boolean {
      const sourceIndex = this.tabs.findIndex((tab: Tab): boolean => tab.id === options.sourceId);
      if (sourceIndex === -1) return false;

      const normalizedTab = normalizeTab(options.tab);
      const sourceDirty = this.dirtyById[options.sourceId] ?? this.dirtyById[normalizedTab.id];
      const sourceMissing = this.missingById[options.sourceId] ?? this.missingById[normalizedTab.id];
      const nextStatus = normalizedTab.status ?? this.tabs[sourceIndex]?.status ?? this.tabs.find((tab: Tab): boolean => tab.id === normalizedTab.id)?.status;
      const nextTabs = this.tabs.filter((tab: Tab, index: number): boolean => index === sourceIndex || tab.id !== normalizedTab.id);
      const nextSourceIndex = nextTabs.findIndex((tab: Tab): boolean => tab.id === options.sourceId);

      nextTabs[nextSourceIndex] = nextStatus ? { ...normalizedTab, status: nextStatus } : normalizedTab;
      this.tabs = nextTabs;
      this.cachedKeys = normalizeCachedKeys(nextTabs.map((tab: Tab): string => tab.cacheKey || tab.id));

      delete this.dirtyById[options.sourceId];
      delete this.missingById[options.sourceId];
      if (normalizedTab.id !== options.sourceId) {
        delete this.dirtyById[normalizedTab.id];
        delete this.missingById[normalizedTab.id];
      }
      if (sourceDirty !== undefined) this.dirtyById[normalizedTab.id] = sourceDirty;
      if (sourceMissing !== undefined) this.missingById[normalizedTab.id] = sourceMissing;

      persistTabsState(this.$state);
      return true;
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
      persistTabsState(this.$state);
    },

    /**
     * 根据关闭动作生成统一关闭计划。
     * @param action - 关闭动作类型
     * @param options - 关闭动作上下文
     * @returns 关闭计划
     */
    getClosePlan(action: TabCloseAction, options: TabClosePlanOptions = {}): TabClosePlan {
      const anchorTabId = options.anchorTabId ?? null;
      const activeTabId = options.activeTabId ?? null;
      const allowCloseLastTab = options.allowCloseLastTab === true;
      const anchorIndex = findTabIndex(this.tabs, anchorTabId);
      const activeIndex = findTabIndex(this.tabs, activeTabId);
      const targetTabs = collectTargetTabs(this.tabs, action, anchorIndex, this.dirtyById);
      const targetTabIds = targetTabs.map((tab) => tab.id);
      const dirtyTabIds = collectDirtyTabIds(targetTabIds, this.dirtyById);

      let disabled = false;
      if (action === 'close') {
        disabled = anchorIndex === -1 || (!allowCloseLastTab && this.tabs.length === 1);
      } else if (action === 'closeOthers') {
        disabled = anchorIndex === -1 || this.tabs.length === 1;
      } else if (action === 'closeRight') {
        disabled = anchorIndex === -1 || anchorIndex === this.tabs.length - 1;
      } else if (action === 'closeSaved') {
        disabled = targetTabIds.length === 0;
      } else if (action === 'closeAll') {
        disabled = this.tabs.length === 0;
      }

      if (disabled || targetTabIds.length === 0) {
        return createDisabledClosePlan(action, anchorTabId, activeTabId, allowCloseLastTab);
      }

      const closesActiveTab = activeIndex !== -1 && targetTabIds.includes(activeTabId as string);

      return {
        action,
        anchorTabId,
        activeTabId,
        allowCloseLastTab,
        disabled: false,
        targetTabIds,
        dirtyTabIds,
        requiresConfirm: action !== 'closeSaved' && dirtyTabIds.length > 0,
        requiresNavigation: closesActiveTab,
        nextActivePath: closesActiveTab ? resolveNextActivePath(this.tabs, activeTabId, targetTabIds) : null
      };
    },

    /**
     * 按关闭计划批量删除标签页。
     * @param plan - 已确认的关闭计划
     */
    applyClosePlan(plan: TabClosePlan): void {
      if (plan.disabled || plan.targetTabIds.length === 0) {
        return;
      }

      const existingIds = new Set(this.tabs.map((tab) => tab.id));
      const validIds = plan.targetTabIds.filter((tabId) => existingIds.has(tabId));
      if (validIds.length === 0) {
        return;
      }

      this.removeTabsByIds(validIds);
    },

    /**
     * 批量删除标签页并清理关联状态。
     * @param ids - 待删除的标签页 ID 列表
     */
    removeTabsByIds(ids: string[]): void {
      if (ids.length === 0) {
        return;
      }

      const idSet = new Set(ids);
      const shouldClearActivePath = this.activePath ? this.tabs.some((tab: Tab): boolean => idSet.has(tab.id) && tab.path === this.activePath) : false;
      const removedCacheKeys = this.tabs
        .filter((tab) => idSet.has(tab.id))
        .map((tab) => tab.cacheKey || tab.id)
        .filter(Boolean);

      this.tabs = this.tabs.filter((tab) => !idSet.has(tab.id));
      this.cachedKeys = this.cachedKeys.filter((cacheKey) => !removedCacheKeys.includes(cacheKey));

      ids.forEach((id) => {
        delete this.dirtyById[id];
        delete this.missingById[id];
      });
      if (shouldClearActivePath) {
        this.activePath = null;
      }

      persistTabsState(this.$state);
    },

    /**
     * 删除标签页。
     * @param id - 标签页 ID
     */
    removeTab(id: string): void {
      this.removeTabsByIds([id]);
    },

    /**
     * 更新标签页瞬时视觉状态。
     * @param tabId - 标签 ID
     * @param status - 通用视觉状态；空值表示清除
     */
    setTabStatus(tabId: string, status?: TabStatus): void {
      const index = this.tabs.findIndex((tab: Tab): boolean => tab.id === tabId);
      if (index === -1) return;

      const current = this.tabs[index];
      if (!current) return;
      this.tabs[index] = status ? { ...current, status } : omit(current, ['status']);
    },

    /**
     * 标记标签页存在未保存修改。
     * @param id - 标签页 ID
     */
    setDirty(id: string): void {
      this.dirtyById[id] = true;
      persistTabsState(this.$state);
    },

    /**
     * 清除标签页未保存修改标记。
     * @param id - 标签页 ID
     */
    clearDirty(id: string): void {
      this.dirtyById[id] = false;
      persistTabsState(this.$state);
    },

    /**
     * 检查标签页是否存在未保存修改。
     * @param id - 标签页 ID
     * @returns 是否为脏状态
     */
    isDirty(id: string): boolean {
      return this.dirtyById[id] === true;
    },

    /**
     * 标记标签页对应的磁盘文件已丢失。
     * @param id - 标签页 ID
     */
    markMissing(id: string): void {
      this.missingById[id] = true;
      persistTabsState(this.$state);
    },

    /**
     * 清除标签页对应的磁盘文件丢失标记。
     * @param id - 标签页 ID
     */
    clearMissing(id: string): void {
      this.missingById[id] = false;
      persistTabsState(this.$state);
    },

    /**
     * 检查标签页对应的磁盘文件是否已丢失。
     * @param id - 标签页 ID
     * @returns 文件是否已丢失
     */
    isMissing(id: string): boolean {
      return this.missingById[id] === true;
    },

    /**
     * 更新标签页标题。
     * @param params - 包含 id 和 title 的对象
     */
    updateTabTitle(params: { id: string; title: string }): void {
      const index = this.tabs.findIndex((t) => t.id === params.id);
      if (index === -1) return;

      this.tabs[index] = { ...this.tabs[index], title: params.title };
      persistTabsState(this.$state);
    },

    /** 事件取消订阅函数列表 */
    _unsubscribers: [] as (() => void)[],

    /**
     * 订阅文件丢失/恢复事件，将事件路由到对应的 markMissing/clearMissing。
     */
    subscribeToFileWatchEvents(): void {
      if (this._unsubscribers.length > 0) return;

      const unsubMissing = storeEvents.onFileMissing((payload: FileMissingPayload) => {
        this.markMissing(payload.fileId);
      });

      const unsubRecovered = storeEvents.onFileRecovered((payload: FileRecoveredPayload) => {
        this.clearMissing(payload.fileId);
      });

      this._unsubscribers = [unsubMissing, unsubRecovered];
    },

    /**
     * 取消订阅文件丢失/恢复事件。
     */
    unsubscribeFromFileWatchEvents(): void {
      this._unsubscribers.forEach((unsub) => unsub());
      this._unsubscribers = [];
    }
  }
});
