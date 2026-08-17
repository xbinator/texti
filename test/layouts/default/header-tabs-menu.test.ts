/**
 * @file header-tabs-menu.test.ts
 * @description HeaderTabs 与单例右键菜单的集成边界测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { PropType } from 'vue';
import { defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeaderTabs from '@/layouts/default/components/HeaderTabs.vue';
import type { RecentRecord } from '@/shared/storage';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

/** 当前路由 mock。 */
const routeMock = vi.hoisted(() => ({
  fullPath: '/settings/provider'
}));

/** router.push mock。 */
const routerPushMock = vi.hoisted(() => vi.fn<(path: string) => Promise<void>>().mockResolvedValue(undefined));

/** 最近记录加载 mock。 */
const ensureLoadedMock = vi.hoisted(() => vi.fn<() => Promise<void>>().mockResolvedValue(undefined));

/** 最近记录列表 mock。 */
const recentRecordsMock = vi.hoisted<{ value: RecentRecord[] }>(() => ({ value: [] }));

/** matchMedia mock：jsdom 缺少该 API，返回减少动效偏好使关闭事件立即发出。 */
const matchMediaMock = vi.fn((): { matches: boolean } => ({ matches: true }));

/** 菜单打开请求记录。 */
interface MenuOpenRequest {
  /** 右键命中的标签 ID。 */
  tabId: string;
  /** 右键横向坐标。 */
  x: number;
  /** 右键纵向坐标。 */
  y: number;
}

/** 菜单关闭请求记录。 */
interface MenuCloseRequest {
  /** 被关闭的标签 ID。 */
  tabId: string;
}

/** HeaderTabMenu.openForTab 调用记录。 */
let menuOpenRequests: MenuOpenRequest[] = [];

/** HeaderTabMenu.closeTab 调用记录。 */
let menuCloseRequests: MenuCloseRequest[] = [];

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
  useRouter: () => ({
    push: routerPushMock
  })
}));

vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    props: ['icon', 'width', 'height'],
    template: '<i class="icon-stub" :data-icon="icon"></i>'
  }
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: () => ({
    get recentRecords() {
      return recentRecordsMock.value;
    },
    ensureLoaded: ensureLoadedMock
  })
}));

vi.mock('@/shared/platform', () => ({
  native: {
    setWindowTitle: vi.fn<(title: string) => Promise<void>>().mockResolvedValue(undefined)
  }
}));

/**
 * BRecentIcon 测试替身。
 */
const BRecentIconStub = defineComponent({
  name: 'BRecentIcon',
  template: '<span class="b-recent-icon-stub"></span>'
});

/**
 * BDraggable 测试替身。
 */
const BDraggableStub = defineComponent({
  name: 'BDraggable',
  props: {
    list: { type: Array as PropType<Tab[]>, required: true },
    itemKey: { type: String, required: true },
    direction: { type: String, default: 'vertical' },
    itemClass: { type: String, default: '' }
  },
  emits: ['move', 'drag-end'],
  template: `
    <div class="b-draggable-stub">
      <div v-for="item in list" :key="item.id" class="b-draggable-stub__item">
        <slot :item="item" :item-key="item.id" :dragging="false" />
      </div>
    </div>
  `
});

/**
 * HeaderTabMenu 测试替身，暴露父组件需要调用的菜单 API。
 */
const HeaderTabMenuStub = defineComponent({
  name: 'HeaderTabMenu',
  setup(_props, { expose }) {
    /**
     * 记录右键菜单打开请求。
     * @param tab - 右键命中的标签
     * @param event - 右键事件
     */
    async function openForTab(tab: Tab, event: MouseEvent): Promise<void> {
      menuOpenRequests.push({
        tabId: tab.id,
        x: event.clientX,
        y: event.clientY
      });
    }

    /**
     * 记录标签关闭请求。
     * @param tab - 待关闭的标签
     */
    async function closeTab(tab: Tab): Promise<void> {
      menuCloseRequests.push({ tabId: tab.id });
    }

    expose({ openForTab, closeTab });

    return {};
  },
  template: '<div class="header-tab-menu-stub"></div>'
});

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
 * 挂载 HeaderTabs。
 * @returns 组件包装器
 */
function mountHeaderTabs(): ReturnType<typeof mount> {
  return mount(HeaderTabs, {
    global: {
      stubs: {
        BDraggable: BDraggableStub,
        BRecentIcon: BRecentIconStub,
        HeaderTabMenu: HeaderTabMenuStub
      }
    }
  });
}

/**
 * 按标签 ID 读取渲染后的标签元素。
 * @param wrapper - HeaderTabs 包装器
 * @param tabId - 标签 ID
 * @returns 标签根元素包装器
 */
function getTabElement(wrapper: ReturnType<typeof mountHeaderTabs>, tabId: string): ReturnType<ReturnType<typeof mountHeaderTabs>['get']> {
  const tab = useTabsStore().tabs.find((item: Tab): boolean => item.id === tabId);
  if (!tab) throw new Error(`Missing test tab: ${tabId}`);

  const tabElement = wrapper.findAll('.header-tab').find((item): boolean => item.find('.header-tab__title-text').text() === tab.title);
  if (!tabElement) throw new Error(`Missing rendered tab: ${tabId}`);

  return tabElement;
}

/**
 * 打开指定标签的右键菜单。
 * @param wrapper - HeaderTabs 包装器
 * @param tabId - 标签 ID
 * @param position - 右键坐标
 */
async function openMenuForTab(
  wrapper: ReturnType<typeof mountHeaderTabs>,
  tabId: string,
  position: { x: number; y: number } = { x: 220, y: 64 }
): Promise<void> {
  await getTabElement(wrapper, tabId).trigger('contextmenu', { clientX: position.x, clientY: position.y });
}

/**
 * 点击指定标签的关闭按钮。
 * @param wrapper - HeaderTabs 包装器
 * @param tabId - 标签 ID
 */
async function clickCloseButton(wrapper: ReturnType<typeof mountHeaderTabs>, tabId: string): Promise<void> {
  await getTabElement(wrapper, tabId).get('.header-tab__close').trigger('click');
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

describe('HeaderTabs menu integration', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
    routeMock.fullPath = '/settings/provider';
    routerPushMock.mockClear();
    ensureLoadedMock.mockClear();
    recentRecordsMock.value = [];
    menuOpenRequests = [];
    menuCloseRequests = [];
    matchMediaMock.mockReset().mockReturnValue({ matches: true });
    vi.stubGlobal('matchMedia', matchMediaMock);
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('renders a single HeaderTabMenu for multiple tabs', (): void => {
    prepareTabs();

    const wrapper = mountHeaderTabs();

    expect(wrapper.findAllComponents(HeaderTabMenuStub)).toHaveLength(1);
  });

  it('delegates right-click requests to the menu component', async (): Promise<void> => {
    prepareTabs();
    const wrapper = mountHeaderTabs();

    await openMenuForTab(wrapper, 'file-a');

    expect(menuOpenRequests).toEqual([{ tabId: 'file-a', x: 220, y: 64 }]);
  });

  it('delegates repeated right-click requests in pointer order', async (): Promise<void> => {
    prepareTabs();
    const wrapper = mountHeaderTabs();

    await openMenuForTab(wrapper, 'settings', { x: 120, y: 44 });
    await openMenuForTab(wrapper, 'web-a', { x: 360, y: 72 });

    expect(menuOpenRequests).toEqual([
      { tabId: 'settings', x: 120, y: 44 },
      { tabId: 'web-a', x: 360, y: 72 }
    ]);
  });

  it('delegates close button requests to the same tab action owner', async (): Promise<void> => {
    prepareTabs();
    const wrapper = mountHeaderTabs();

    await clickCloseButton(wrapper, 'file-a');

    expect(menuCloseRequests).toEqual([{ tabId: 'file-a' }]);
  });
});
