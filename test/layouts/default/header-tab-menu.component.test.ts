/**
 * @file header-tab-menu.component.test.ts
 * @description HeaderTabMenu 单例右键菜单业务与交互测试。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HeaderTabMenu from '@/layouts/default/components/HeaderTabMenu.vue';
import type { RecentRecord } from '@/shared/storage';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

const headerTabMenuSource = readFileSync('src/layouts/default/components/HeaderTabMenu.vue', 'utf8');

/** 当前路由 mock。 */
const routeMock = vi.hoisted(() => ({
  fullPath: '/settings/provider'
}));

/** router.push mock。 */
const routerPushMock = vi.hoisted(() => vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined));

/** 最近记录列表 mock。 */
const recentRecordsMock = vi.hoisted<{ value: RecentRecord[] }>(() => ({ value: [] }));

/** 剪贴板 mock。 */
const clipboardMock = vi.hoisted(() =>
  vi.fn<(content: string, options?: { successMessage?: string; trim?: boolean }) => Promise<boolean>>().mockResolvedValue(true)
);

vi.mock('vue-router', () => ({
  NavigationFailureType: {
    duplicated: 16
  },
  isNavigationFailure: (_result: unknown, _type?: number): boolean => false,
  useRoute: () => routeMock,
  useRouter: () => ({
    push: routerPushMock
  })
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: () => ({
    get recentRecords() {
      return recentRecordsMock.value;
    }
  })
}));

vi.mock('@/hooks/useClipboard', () => ({
  useClipboard: () => ({
    clipboard: clipboardMock
  })
}));

vi.mock('@/utils/modal', () => ({
  Modal: {
    confirm: vi.fn()
  }
}));

vi.mock('ant-design-vue', () => ({
  message: {
    error: vi.fn()
  }
}));

/**
 * HeaderTabMenu 对外暴露的命令式 API。
 */
interface HeaderTabMenuExpose {
  /** 在指定标签处打开右键菜单。 */
  openForTab: (tab: Tab, event: MouseEvent) => Promise<void>;
  /** 关闭指定标签。 */
  closeTab: (tab: Tab) => Promise<void>;
}

/**
 * 创建标签页测试数据。
 * @param id - 标签 ID
 * @param path - 标签路径
 * @param title - 标签标题
 * @param extra - 额外标签字段
 * @returns 标签页数据
 */
function createTab(id: string, path: string, title: string, extra: Partial<Tab> = {}): Tab {
  return {
    id,
    path,
    title,
    cacheKey: id,
    ...extra
  };
}

/**
 * 创建文件最近记录。
 * @param path - 文件真实路径
 * @returns 文件最近记录
 */
function createFileRecord(path: string): Extract<RecentRecord, { type: 'file' }> {
  return {
    type: 'file',
    id: 'file-a',
    url: '/editor/file-a',
    title: '复杂路径.md',
    description: path,
    path,
    content: '',
    savedContent: '',
    name: '复杂路径',
    ext: 'md'
  };
}

/**
 * 创建右键鼠标事件。
 * @param x - 横向坐标
 * @param y - 纵向坐标
 * @returns 右键鼠标事件
 */
function createContextMenuEvent(x: number, y: number): MouseEvent {
  return new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y
  });
}

/**
 * 挂载 HeaderTabMenu。
 * @returns 菜单包装器
 */
function mountMenu(): ReturnType<typeof mount> {
  return mount(HeaderTabMenu, {
    attachTo: document.body
  });
}

/**
 * 读取 HeaderTabMenu 暴露的 API。
 * @param wrapper - 菜单包装器
 * @returns 菜单暴露 API
 */
function getMenuApi(wrapper: ReturnType<typeof mountMenu>): HeaderTabMenuExpose {
  return wrapper.vm as unknown as HeaderTabMenuExpose;
}

/**
 * 读取指定标签。
 * @param tabId - 标签 ID
 * @returns 标签页数据
 */
function getTab(tabId: string): Tab {
  const tab = useTabsStore().tabs.find((item: Tab): boolean => item.id === tabId);
  if (!tab) throw new Error(`Missing test tab: ${tabId}`);

  return tab;
}

/**
 * 读取菜单按钮文案列表。
 * @param wrapper - 菜单包装器
 * @returns 菜单按钮文案列表
 */
function getButtonTexts(wrapper: ReturnType<typeof mountMenu>): string[] {
  return wrapper.findAll('.header-tab-menu__item').map((button): string => button.text());
}

/**
 * 读取指定文案的菜单按钮。
 * @param wrapper - 菜单包装器
 * @param text - 菜单按钮文案
 * @returns 菜单按钮包装器
 */
function getButtonByText(wrapper: ReturnType<typeof mountMenu>, text: string): ReturnType<ReturnType<typeof mountMenu>['get']> {
  const button = wrapper.findAll('.header-tab-menu__item').find((item): boolean => item.text() === text);
  if (!button) throw new Error(`Missing menu button: ${text}`);

  return button;
}

/**
 * 准备三标签测试状态。
 */
function prepareTabs(): void {
  useTabsStore().tabs = [
    createTab('settings', '/settings/provider', '设置'),
    createTab('file-a', '/editor/file-a', '复杂路径.md', { recentKey: 'file:file-a' }),
    createTab('web-a', `/webview/web?url=${encodeURIComponent('https://example.com')}`, 'Example')
  ];
}

describe('HeaderTabMenu', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
    routeMock.fullPath = '/settings/provider';
    routerPushMock.mockClear();
    recentRecordsMock.value = [];
    clipboardMock.mockClear();
    clipboardMock.mockResolvedValue(true);
  });

  it('does not render before a tab opens the menu', (): void => {
    const wrapper = mountMenu();

    expect(wrapper.find('.header-tab-menu').exists()).toBe(false);
    wrapper.unmount();
  });

  it('opens with close actions and a file copy action for file tabs', async (): Promise<void> => {
    prepareTabs();
    recentRecordsMock.value = [createFileRecord('/Users/demo/复杂 path/notes?#.md')];
    const wrapper = mountMenu();

    await getMenuApi(wrapper).openForTab(getTab('file-a'), createContextMenuEvent(220, 64));
    await flushPromises();

    expect(wrapper.find('.header-tab-menu').attributes('style')).toContain('left: 220px;');
    expect(getButtonTexts(wrapper)).toEqual(['关闭', '关闭其他', '关闭右侧', '关闭全部', '复制路径']);
    expect(wrapper.find('.header-tab-menu__icon').exists()).toBe(false);
    wrapper.unmount();
  });

  it('recreates the menu DOM when right-clicking another tab while open', async (): Promise<void> => {
    prepareTabs();
    const wrapper = mountMenu();

    await getMenuApi(wrapper).openForTab(getTab('settings'), createContextMenuEvent(120, 44));
    await flushPromises();
    const firstMenuElement = wrapper.get('.header-tab-menu').element;
    await getMenuApi(wrapper).openForTab(getTab('web-a'), createContextMenuEvent(360, 72));
    await flushPromises();

    expect(wrapper.get('.header-tab-menu').element).not.toBe(firstMenuElement);
    expect(wrapper.find('.header-tab-menu').attributes('style')).toContain('left: 360px;');
    wrapper.unmount();
  });

  it.each(['关闭其他', '关闭右侧', '关闭全部'] as const)('executes %s through the tabs close plan', async (label: string): Promise<void> => {
    prepareTabs();
    const tabsStore = useTabsStore();
    const getClosePlanSpy = vi.spyOn(tabsStore, 'getClosePlan');
    const applyClosePlanSpy = vi.spyOn(tabsStore, 'applyClosePlan');
    const wrapper = mountMenu();

    await getMenuApi(wrapper).openForTab(getTab('file-a'), createContextMenuEvent(220, 64));
    await getButtonByText(wrapper, label).trigger('click');
    await flushPromises();

    expect(getClosePlanSpy).toHaveBeenCalledWith(label === '关闭其他' ? 'closeOthers' : label === '关闭右侧' ? 'closeRight' : 'closeAll', {
      anchorTabId: 'file-a',
      activeTabId: 'settings',
      allowCloseLastTab: true
    });
    expect(applyClosePlanSpy).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('copies the real document path for file tabs', async (): Promise<void> => {
    const complexPath = '/Users/demo/资料/space name/notes?# 草稿.md';
    prepareTabs();
    recentRecordsMock.value = [createFileRecord(complexPath)];
    const wrapper = mountMenu();

    await getMenuApi(wrapper).openForTab(getTab('file-a'), createContextMenuEvent(220, 64));
    await getButtonByText(wrapper, '复制路径').trigger('click');
    await flushPromises();

    expect(clipboardMock).toHaveBeenCalledWith(complexPath, {
      successMessage: '已复制路径',
      trim: false
    });
    wrapper.unmount();
  });

  it('copies the decoded address for WebView tabs', async (): Promise<void> => {
    const url = 'https://example.test/a path/?q=中文#section';
    useTabsStore().tabs = [createTab('web-a', `/webview/web?url=${encodeURIComponent(url)}`, 'Example')];
    const wrapper = mountMenu();

    await getMenuApi(wrapper).openForTab(getTab('web-a'), createContextMenuEvent(120, 44));
    await getButtonByText(wrapper, '复制地址').trigger('click');
    await flushPromises();

    expect(clipboardMock).toHaveBeenCalledWith(url, {
      successMessage: '已复制地址',
      trim: false
    });
    wrapper.unmount();
  });

  it('closes when Escape is pressed', async (): Promise<void> => {
    prepareTabs();
    const wrapper = mountMenu();

    await getMenuApi(wrapper).openForTab(getTab('settings'), createContextMenuEvent(120, 44));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();

    expect(wrapper.find('.header-tab-menu').exists()).toBe(false);
    wrapper.unmount();
  });

  it('animates entry without transitioning menu coordinates', (): void => {
    expect(headerTabMenuSource).toContain('animation: header-tab-menu-enter');
    expect(headerTabMenuSource).not.toMatch(/transition[^;{]*(left|top)/u);
  });
});
