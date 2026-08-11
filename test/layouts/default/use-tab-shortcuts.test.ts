/**
 * @file use-tab-shortcuts.test.ts
 * @description 验证默认布局标签页快捷键的关闭与切换行为。
 * @vitest-environment jsdom
 */
import { defineComponent, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabShortcuts } from '@/layouts/default/hooks/useTabShortcuts';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

/** 当前路由 mock。 */
const routeMock = vi.hoisted(() => ({
  fullPath: '/settings/provider'
}));

/** router.push mock。 */
const routerPushMock = vi.hoisted(() => vi.fn<(_path: string) => Promise<void>>().mockResolvedValue(undefined));

vi.mock('vue-router', () => ({
  NavigationFailureType: {
    duplicated: 16
  },
  isNavigationFailure: (): boolean => false,
  useRoute: () => routeMock,
  useRouter: () => ({
    push: routerPushMock
  })
}));

vi.mock('@/shared/platform/env', () => ({
  isMac: (): boolean => false
}));

vi.mock('@/utils/modal', () => ({
  Modal: {
    confirm: vi.fn()
  }
}));

/**
 * 派发窗口键盘事件。
 * @param type - 键盘事件类型
 * @param options - 键盘事件参数
 */
function dispatchWindowKeyboardEvent(type: 'keydown' | 'keyup', options: KeyboardEventInit): void {
  window.dispatchEvent(
    new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      ...options
    })
  );
}

/**
 * 创建标签页测试数据。
 * @param id - 标签 ID
 * @param path - 标签路径
 * @param title - 标签标题
 * @returns 标签页数据
 */
function createTab(id: string, path: string, title: string): Tab {
  return {
    id,
    path,
    title,
    cacheKey: id
  };
}

/**
 * 挂载标签页快捷键 hook 测试组件。
 * @returns 组件 wrapper
 */
function mountTabShortcuts(): VueWrapper {
  return mount(
    defineComponent({
      setup() {
        useTabShortcuts();

        return () => null;
      }
    }),
    { attachTo: document.body }
  );
}

/**
 * 准备三标签测试状态。
 */
function prepareTabs(): void {
  useTabsStore().tabs = [
    createTab('settings', '/settings/provider', '设置'),
    createTab('file-a', '/editor/file-a', '文档 A'),
    createTab('web-a', '/webview/web?url=https%3A%2F%2Fexample.com', 'Example')
  ];
}

describe('useTabShortcuts', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
    routeMock.fullPath = '/settings/provider';
    routerPushMock.mockClear();
  });

  it('closes the active tab with Ctrl W and activates the right neighbor', async (): Promise<void> => {
    prepareTabs();
    routeMock.fullPath = '/editor/file-a';
    const wrapper = mountTabShortcuts();

    dispatchWindowKeyboardEvent('keydown', { key: 'w', ctrlKey: true });
    await flushPromises();
    await nextTick();

    expect(routerPushMock).toHaveBeenCalledWith('/webview/web?url=https%3A%2F%2Fexample.com');
    expect(useTabsStore().tabs.map((tab: Tab): string => tab.id)).toEqual(['settings', 'web-a']);
    wrapper.unmount();
  });

  it('returns to welcome when Ctrl W closes the final tab', async (): Promise<void> => {
    useTabsStore().tabs = [createTab('file-a', '/editor/file-a', '文档 A')];
    routeMock.fullPath = '/editor/file-a';
    const wrapper = mountTabShortcuts();

    dispatchWindowKeyboardEvent('keydown', { key: 'w', ctrlKey: true });
    await flushPromises();
    await nextTick();

    expect(routerPushMock).toHaveBeenCalledWith('/welcome');
    expect(useTabsStore().tabs).toEqual([]);
    wrapper.unmount();
  });

  it('switches to the next tab with Ctrl Tab and wraps at the end', async (): Promise<void> => {
    prepareTabs();
    routeMock.fullPath = '/webview/web?url=https%3A%2F%2Fexample.com';
    const wrapper = mountTabShortcuts();

    dispatchWindowKeyboardEvent('keydown', { key: 'Tab', ctrlKey: true });
    await flushPromises();
    await nextTick();

    expect(routerPushMock).toHaveBeenCalledWith('/settings/provider');
    wrapper.unmount();
  });

  it('opens the draft chat tab with Ctrl Shift N', async (): Promise<void> => {
    const wrapper = mountTabShortcuts();

    dispatchWindowKeyboardEvent('keydown', { key: 'Control', ctrlKey: true });
    dispatchWindowKeyboardEvent('keydown', { key: 'Shift', ctrlKey: true, shiftKey: true });
    dispatchWindowKeyboardEvent('keydown', { key: 'n', ctrlKey: true, shiftKey: true });
    await flushPromises();
    await nextTick();

    expect(routerPushMock).toHaveBeenCalledWith('/chat');
    wrapper.unmount();
  });
});
