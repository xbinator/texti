/**
 * @file tabs.test.ts
 * @description 验证标签页状态管理的增删与拖拽排序行为。
 */

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 模拟持久化存储读取返回值。
 */
const getItemMock = vi.fn();

/**
 * 模拟持久化存储写入行为。
 */
const setItemMock = vi.fn();

vi.mock('@/shared/storage/base', () => ({
  local: {
    getItem: getItemMock,
    setItem: setItemMock
  }
}));

describe('useTabsStore', () => {
  beforeEach(() => {
    vi.resetModules();
    getItemMock.mockReset();
    setItemMock.mockReset();
    getItemMock.mockReturnValue(null);
    setActivePinia(createPinia());
  });

  it('moves the dragged tab before the target tab and persists the new order', async () => {
    const { useTabsStore } = await import('@/stores/tabs');
    const tabsStore = useTabsStore();

    tabsStore.addTab({ id: 'alpha', path: '/alpha', title: 'Alpha' });
    tabsStore.addTab({ id: 'beta', path: '/beta', title: 'Beta' });
    tabsStore.addTab({ id: 'gamma', path: '/gamma', title: 'Gamma' });

    setItemMock.mockClear();

    tabsStore.moveTab('gamma', 'alpha');

    expect(tabsStore.tabs.map((tab) => tab.id)).toEqual(['gamma', 'alpha', 'beta']);
    expect(setItemMock).toHaveBeenCalledTimes(1);
    expect(setItemMock.mock.calls[0]?.[0]).toBe('app_tabs');
  });

  it('does not persist when the drag source and target are identical', async () => {
    const { useTabsStore } = await import('@/stores/tabs');
    const tabsStore = useTabsStore();

    tabsStore.addTab({ id: 'alpha', path: '/alpha', title: 'Alpha' });
    setItemMock.mockClear();

    tabsStore.moveTab('alpha', 'alpha');

    expect(tabsStore.tabs.map((tab) => tab.id)).toEqual(['alpha']);
    expect(setItemMock).not.toHaveBeenCalled();
  });
});
