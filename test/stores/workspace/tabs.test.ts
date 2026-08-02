/**
 * @file tabs.test.ts
 * @description 工作区标签原位替换与瞬时视觉状态测试。
 * @vitest-environment jsdom
 */
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { local } from '@/shared/storage/base';
import type { Tab, TabsState } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

/**
 * 创建测试标签。
 * @param id - 标签 ID
 * @param path - 标签路径
 * @returns 测试标签
 */
function createTab(id: string, path = `/${id}`): Tab {
  return {
    id,
    path,
    title: id,
    cacheKey: id
  };
}

describe('tabs store replacement', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it('replaces a draft tab in place and migrates cache state', (): void => {
    const store = useTabsStore();
    store.tabs = [createTab('before'), createTab('chat:new', '/chat'), createTab('after')];
    store.cachedKeys = ['before', 'chat:new', 'after'];
    store.dirtyById['chat:new'] = true;
    store.missingById['chat:new'] = true;

    const replaced = store.replaceTab({
      sourceId: 'chat:new',
      tab: {
        id: 'chat:session-a',
        path: '/chat/session-a',
        title: 'A',
        cacheKey: 'chat:session-a',
        icon: 'lucide:message-circle'
      }
    });

    expect(replaced).toBe(true);
    expect(store.tabs.map((tab) => tab.id)).toEqual(['before', 'chat:session-a', 'after']);
    expect(store.cachedKeys).toEqual(['before', 'chat:session-a', 'after']);
    expect(store.dirtyById['chat:session-a']).toBe(true);
    expect(store.dirtyById['chat:new']).toBeUndefined();
    expect(store.missingById['chat:session-a']).toBe(true);
    expect(store.missingById['chat:new']).toBeUndefined();
  });

  it('collapses a router-created target while preserving the draft position', (): void => {
    const store = useTabsStore();
    store.tabs = [createTab('chat:new', '/chat'), createTab('other'), createTab('chat:session-a', '/chat/session-a')];
    store.cachedKeys = ['chat:new', 'other', 'chat:session-a'];

    const replaced = store.replaceTab({ sourceId: 'chat:new', tab: createTab('chat:session-a', '/chat/session-a') });

    expect(replaced).toBe(true);
    expect(store.tabs.map((tab) => tab.id)).toEqual(['chat:session-a', 'other']);
    expect(store.cachedKeys).toEqual(['chat:session-a', 'other']);
  });

  it('returns false without mutating state when the source tab is absent', (): void => {
    const store = useTabsStore();
    store.tabs = [createTab('other')];

    expect(store.replaceTab({ sourceId: 'chat:new', tab: createTab('chat:session-a', '/chat/session-a') })).toBe(false);
    expect(store.tabs.map((tab) => tab.id)).toEqual(['other']);
  });

  it('creates isolated default state for each store instance', (): void => {
    const firstStore = useTabsStore();
    firstStore.tabs.push(createTab('first'));
    firstStore.dirtyById.first = true;
    localStorage.clear();
    setActivePinia(createPinia());

    const secondStore = useTabsStore();

    expect(secondStore.tabs).toEqual([]);
    expect(secondStore.dirtyById).toEqual({});
  });

  it('keeps transient status in memory without persisting it', (): void => {
    const store = useTabsStore();
    store.addTab(createTab('chat:session-a', '/chat/session-a'));

    store.setTabStatus('chat:session-a', 'loading');
    store.addTab(createTab('chat:session-a', '/chat/session-a'));

    expect(store.tabs[0]?.status).toBe('loading');
    store.updateTabTitle({ id: 'chat:session-a', title: 'A' });
    expect(local.getItem<TabsState>('app_tabs')?.tabs[0]).not.toHaveProperty('status');
  });

  it('keeps recentKey in memory and persisted tab snapshots', (): void => {
    const store = useTabsStore();

    store.addTab({ ...createTab('file-a', '/editor/file-a'), recentKey: 'file:file-a' });

    expect(store.tabs[0]?.recentKey).toBe('file:file-a');
    expect(local.getItem<TabsState>('app_tabs')?.tabs[0]).toMatchObject({ recentKey: 'file:file-a' });
  });

  it('persists the last active route path with tab state', (): void => {
    const store = useTabsStore();
    store.addTab(createTab('chat:session-a', '/chat/session-a'));

    store.setActivePath('/chat/session-a');

    expect(store.activePath).toBe('/chat/session-a');
    expect(local.getItem<TabsState>('app_tabs')?.activePath).toBe('/chat/session-a');
  });

  it('loads a persisted active route only when it still points to an open tab or welcome page', (): void => {
    local.setItem('app_tabs', {
      tabs: [createTab('chat:session-a', '/chat/session-a')],
      dirtyById: {},
      missingById: {},
      cachedKeys: [],
      activePath: '/missing'
    });

    const store = useTabsStore();

    expect(store.activePath).toBeNull();
  });

  it('clears the active route when removing its owning tab', (): void => {
    const store = useTabsStore();
    store.addTab(createTab('chat:session-a', '/chat/session-a'));
    store.setActivePath('/chat/session-a');

    store.removeTab('chat:session-a');

    expect(store.activePath).toBeNull();
    expect(local.getItem<TabsState>('app_tabs')?.activePath).toBeNull();
  });

  it('derives recentKey for legacy persisted editor and widget tabs', (): void => {
    local.setItem('app_tabs', {
      tabs: [
        { id: 'shared-id', path: '/editor/shared-id', title: '文件' },
        { id: 'shared-id-widget', path: '/widget/shared-id', title: 'Widget' }
      ],
      dirtyById: {},
      missingById: {},
      cachedKeys: []
    });

    const store = useTabsStore();

    expect(store.tabs.map((tab) => tab.recentKey)).toEqual(['file:shared-id', 'widget:shared-id']);
  });

  it('keeps an explicitly supplied status when adding a new tab', (): void => {
    const store = useTabsStore();

    store.addTab({ ...createTab('chat:session-a', '/chat/session-a'), status: 'loading' });

    expect(store.tabs[0]?.status).toBe('loading');
    expect(local.getItem<TabsState>('app_tabs')?.tabs[0]).not.toHaveProperty('status');
  });

  it('inserts a new tab right after the active tab', (): void => {
    const store = useTabsStore();
    store.tabs = [createTab('tab-a'), createTab('tab-b'), createTab('tab-c')];
    store.setActivePath('/tab-a');

    store.addTab(createTab('tab-d'));

    expect(store.tabs.map((tab) => tab.id)).toEqual(['tab-a', 'tab-d', 'tab-b', 'tab-c']);
  });

  it('appends a new tab when there is no active tab', (): void => {
    const store = useTabsStore();
    store.tabs = [createTab('tab-a')];

    store.addTab(createTab('tab-b'));

    expect(store.tabs.map((tab) => tab.id)).toEqual(['tab-a', 'tab-b']);
  });

  it('migrates transient status when replacing a tab', (): void => {
    const store = useTabsStore();
    store.tabs = [createTab('chat:new', '/chat')];
    store.setTabStatus('chat:new', 'attention');

    store.replaceTab({ sourceId: 'chat:new', tab: createTab('chat:session-a', '/chat/session-a') });

    expect(store.tabs[0]?.status).toBe('attention');
  });

  it('prefers an explicitly supplied status when replacing a tab', (): void => {
    const store = useTabsStore();
    store.tabs = [{ ...createTab('chat:new', '/chat'), status: 'attention' }];

    store.replaceTab({
      sourceId: 'chat:new',
      tab: { ...createTab('chat:session-a', '/chat/session-a'), status: 'error' }
    });

    expect(store.tabs[0]?.status).toBe('error');
  });

  it('sanitizes malformed persisted tabs and their related state', (): void => {
    local.setItem('app_tabs', {
      tabs: [
        null,
        {},
        { id: 42, path: '/invalid-id', title: 'invalid' },
        { id: 'chat:session-a', path: '/chat/session-a', title: '会话 A', cacheKey: 99, icon: ' lucide:message-circle ', status: 'loading' },
        { id: 'chat:session-a', path: '/duplicate', title: '重复会话' }
      ],
      dirtyById: { 'chat:session-a': true, ghost: true, invalid: 'yes' },
      missingById: null,
      cachedKeys: [null, 42, 'ghost-cache']
    });

    const store = useTabsStore();

    expect(store.tabs).toEqual([
      {
        id: 'chat:session-a',
        path: '/chat/session-a',
        title: '会话 A',
        cacheKey: 'chat:session-a',
        recentKey: 'chat:session-a',
        icon: 'lucide:message-circle'
      }
    ]);
    expect(store.dirtyById).toEqual({ 'chat:session-a': true });
    expect(store.missingById).toEqual({});
    expect(store.cachedKeys).toEqual(['chat:session-a']);
  });
});
