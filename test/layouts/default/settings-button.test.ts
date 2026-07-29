/**
 * @file settings-button.test.ts
 * @description 默认布局设置按钮路由行为测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DefaultLayout from '@/layouts/default/index.vue';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

/** 当前路由 mock。 */
const routeMock = vi.hoisted(() => ({
  fullPath: '/welcome'
}));

/** router.push mock。 */
const routerPushMock = vi.hoisted(() => vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined));

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');

  return {
    ...actual,
    useRoute: () => routeMock,
    useRouter: () => ({
      push: routerPushMock
    })
  };
});

vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    props: ['icon', 'width', 'height'],
    template: '<span class="icon-stub" :data-icon="icon"></span>'
  }
}));

vi.mock('@/components/BButton/index.vue', () => ({
  default: {
    name: 'BButton',
    props: {
      icon: { type: String, default: '' },
      type: { type: String, default: '' },
      size: { type: String, default: '' },
      square: { type: Boolean, default: false }
    },
    emits: ['click'],
    template: '<button class="b-button-module-stub" type="button" :data-icon="icon" :data-type="type" @click="$emit(\'click\')"><slot /></button>'
  }
}));

vi.mock('@/components/BCommandPanel/index.vue', () => ({
  default: {
    name: 'BCommandPanel',
    template: '<div />'
  }
}));

vi.mock('@/layouts/default/components/ChatSider.vue', () => ({
  default: {
    name: 'ChatSider',
    template: '<aside />'
  }
}));

vi.mock('@/layouts/default/components/HeaderEditorActions.vue', () => ({
  default: {
    name: 'HeaderEditorActions',
    template: '<div />'
  }
}));

vi.mock('@/layouts/default/components/HeaderTabs.vue', () => ({
  default: {
    name: 'HeaderTabs',
    template: '<div />'
  }
}));

vi.mock('@/layouts/default/components/HeaderUpdateNotice.vue', () => ({
  default: {
    name: 'HeaderUpdateNotice',
    template: '<div />'
  }
}));

vi.mock('@/layouts/default/components/MainDropZone.vue', () => ({
  default: {
    name: 'MainDropZone',
    template: '<main><slot /></main>'
  }
}));

vi.mock('@/layouts/default/components/ShortcutsHelp.vue', () => ({
  default: {
    name: 'ShortcutsHelp',
    template: '<div />'
  }
}));

vi.mock('@/shared/platform/env', () => ({
  isMac: () => false
}));

vi.mock('@/shared/platform/electron-api', () => ({
  getElectronAPI: () => ({
    windowIsMaximized: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    windowIsFullScreen: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    windowMinimize: vi.fn<() => void>(),
    windowMaximize: vi.fn<() => void>(),
    windowClose: vi.fn<() => void>()
  }),
  // 单测环境无真实 Electron，logger 走 console 分支，避免 mock 缺失导出导致 asyncTo 抛错。
  hasElectronAPI: () => false
}));

vi.mock('@/layouts/default/hooks/useFileActive', () => ({
  useFileActive: () => ({ toolbarFileOptions: [] })
}));

vi.mock('@/layouts/default/hooks/useEditActive', () => ({
  useEditActive: () => ({ toolbarEditOptions: [] })
}));

vi.mock('@/layouts/default/hooks/useViewActive', () => ({
  useViewActive: () => ({ toolbarViewOptions: [] })
}));

vi.mock('@/layouts/default/hooks/useHelpActive', () => ({
  useHelpActive: () => ({ toolbarHelpOptions: [] })
}));

vi.mock('@/layouts/default/hooks/useWatchSkill', () => ({
  useWatchSkill: vi.fn<() => void>()
}));

vi.mock('@/layouts/default/hooks/useWatchWidget', () => ({
  useWatchWidget: vi.fn<() => void>()
}));

/**
 * BButton 测试替身，用原生按钮承接点击事件。
 */
const BButtonStub = defineComponent({
  name: 'BButton',
  props: {
    icon: { type: String, default: '' },
    type: { type: String, default: '' },
    size: { type: String, default: '' },
    square: { type: Boolean, default: false }
  },
  emits: ['click'],
  template: '<button class="b-button-stub" type="button" :data-icon="icon" :data-type="type" @click="$emit(\'click\')"><slot /></button>'
});

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
 * 挂载默认布局。
 * @returns 组件 wrapper
 */
function mountDefaultLayout(): VueWrapper {
  return shallowMount(DefaultLayout, {
    global: {
      stubs: {
        BButton: BButtonStub,
        BCommandPanel: true,
        BToolbar: true,
        ChatSider: true,
        HeaderEditorActions: true,
        HeaderTabs: true,
        HeaderUpdateNotice: true,
        MainDropZone: true,
        RouterView: true,
        ShortcutsHelp: true
      }
    }
  });
}

/**
 * 读取指定图标对应的 BButton 测试替身。
 * @param wrapper - 默认布局 wrapper
 * @param icon - 按钮图标
 * @returns 按钮 wrapper
 */
function getBButtonByIcon(wrapper: VueWrapper, icon: string): ReturnType<VueWrapper['get']> {
  const button = wrapper.findAll('.b-button-stub').find((item): boolean => item.attributes('data-icon') === icon);
  if (!button) throw new Error(`Missing layout button: ${icon}`);

  return button;
}

/**
 * 点击指定图标对应的布局按钮。
 * @param wrapper - 默认布局 wrapper
 * @param icon - 按钮图标
 */
async function clickLayoutButton(wrapper: VueWrapper, icon: string): Promise<void> {
  await getBButtonByIcon(wrapper, icon).trigger('click');
  await nextTick();
}

/**
 * 触发设置按钮点击。
 * @param wrapper - 默认布局 wrapper
 */
async function clickSettingsButton(wrapper: VueWrapper): Promise<void> {
  await clickLayoutButton(wrapper, 'tabler:settings');
}

describe('Default layout settings button', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
    routeMock.fullPath = '/welcome';
    routerPushMock.mockClear();
  });

  it('does not navigate again when the current route is already inside settings', async (): Promise<void> => {
    routeMock.fullPath = '/settings/provider';

    const wrapper = mountDefaultLayout();
    await clickSettingsButton(wrapper);

    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('marks the welcome button soft while the welcome route is active', (): void => {
    routeMock.fullPath = '/welcome';

    const wrapper = mountDefaultLayout();
    const welcomeButton = getBButtonByIcon(wrapper, 'lucide:blocks');

    expect(welcomeButton.attributes('data-type')).toBe('soft');
  });

  it('opens the welcome page from the dashboard button in the tab bar', async (): Promise<void> => {
    routeMock.fullPath = '/settings/provider';

    const wrapper = mountDefaultLayout();
    const welcomeButton = getBButtonByIcon(wrapper, 'lucide:blocks');

    expect(welcomeButton.attributes('data-icon')).toBe('lucide:blocks');
    expect(welcomeButton.attributes('data-type')).toBe('secondary');

    await clickLayoutButton(wrapper, 'lucide:blocks');

    expect(routerPushMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock).toHaveBeenCalledWith('/welcome');
  });

  it('activates the existing settings tab path instead of reopening the settings root', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('settings', '/settings/tools/mcp', '设置'), createTab('welcome', '/welcome', '欢迎')];

    const wrapper = mountDefaultLayout();
    await clickSettingsButton(wrapper);

    expect(routerPushMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock).toHaveBeenCalledWith('/settings/tools/mcp');
  });

  it('opens the settings root when no settings tab exists', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('welcome', '/welcome', '欢迎')];

    const wrapper = mountDefaultLayout();
    await clickSettingsButton(wrapper);

    expect(routerPushMock).toHaveBeenCalledTimes(1);
    expect(routerPushMock).toHaveBeenCalledWith('/settings');
  });
});
