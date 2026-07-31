/**
 * @file header-tabs-chat-status.test.ts
 * @description HeaderTabs 聊天运行状态、标题同步与安全关闭测试。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { PropType } from 'vue';
import { defineComponent } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HeaderTabs from '@/layouts/default/components/HeaderTabs.vue';
import { useChatTabStore } from '@/stores/chat/tab';
import { storeEvents } from '@/stores/helpers/events';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

const routeMock = vi.hoisted(() => ({ fullPath: '/welcome' }));
const routerPushMock = vi.hoisted(() => vi.fn<(path: string) => Promise<unknown>>());
const routeFailureMock = vi.hoisted(() => ({ type: 'aborted' }));
const modalConfirmMock = vi.hoisted(() => vi.fn<() => Promise<[boolean, boolean]>>());

vi.mock('vue-router', () => ({
  useRoute: (): typeof routeMock => routeMock,
  useRouter: (): { push: typeof routerPushMock } => ({ push: routerPushMock })
}));

vi.mock('@/router/navigation', () => ({
  isBlockingNavigationFailure: (result: unknown): boolean => result === routeFailureMock
}));

vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    props: ['icon', 'width', 'height'],
    template: '<i class="icon-stub" :data-icon="icon"></i>'
  }
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: (): { recentRecords: []; ensureLoaded: () => Promise<void> } => ({
    recentRecords: [],
    ensureLoaded: async (): Promise<void> => undefined
  })
}));

vi.mock('@/shared/platform', () => ({
  native: {
    setWindowTitle: vi.fn<(title: string) => Promise<void>>().mockResolvedValue(undefined)
  }
}));

vi.mock('@/utils/modal', () => ({
  Modal: {
    confirm: modalConfirmMock
  }
}));

/** HeaderTabs 拖拽容器测试替身。 */
const BDraggableStub = defineComponent({
  name: 'BDraggable',
  props: {
    list: { type: Array as PropType<Tab[]>, required: true }
  },
  emits: ['move', 'drag-end'],
  template: '<div><div v-for="item in list" :key="item.id"><slot :item="item" :dragging="false" /></div></div>'
});

/** 标签普通图标测试替身。 */
const BRecentIconStub = defineComponent({
  name: 'BRecentIcon',
  template: '<span class="recent-icon-stub"></span>'
});

/**
 * 创建测试标签。
 * @param id - 标签 ID
 * @param path - 标签路径
 * @returns 标签数据
 */
function createTab(id: string, path: string): Tab {
  return { id, path, title: id, cacheKey: id, icon: id.startsWith('chat:') ? 'lucide:message-circle' : undefined };
}

/** 挂载 HeaderTabs。 */
function mountTabs(): ReturnType<typeof mount> {
  return mount(HeaderTabs, {
    global: {
      stubs: {
        BDraggable: BDraggableStub,
        BRecentIcon: BRecentIconStub
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
function getTabElement(wrapper: ReturnType<typeof mountTabs>, tabId: string): ReturnType<ReturnType<typeof mountTabs>['get']> {
  const tabElement = wrapper.findAll('.header-tab').find((item): boolean => item.find('.header-tab__title-text').text() === tabId);
  if (!tabElement) throw new Error(`Missing rendered tab: ${tabId}`);

  return tabElement;
}

describe('HeaderTabs chat status', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
    routeMock.fullPath = '/welcome';
    routerPushMock.mockReset();
    routerPushMock.mockResolvedValue(undefined);
    modalConfirmMock.mockReset();
    modalConfirmMock.mockResolvedValue([false, true]);
  });

  it('renders running, waiting, error and completed chat states', (): void => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [
      { ...createTab('chat:running', '/chat/running'), status: 'loading' },
      { ...createTab('chat:waiting', '/chat/waiting'), status: 'attention' },
      { ...createTab('chat:error', '/chat/error'), status: 'error' },
      { ...createTab('chat:completed', '/chat/completed'), status: 'completed' },
      createTab('welcome', '/welcome')
    ];

    const wrapper = mountTabs();

    const runningStatus = getTabElement(wrapper, 'chat:running').find('.header-tab__status');
    expect(runningStatus.find('[data-icon]').attributes('data-icon')).toBe('lucide:loader-circle');
    expect(runningStatus.classes()).toContain('is-spinning');
    const waitingStatus = getTabElement(wrapper, 'chat:waiting').find('.header-tab__status');
    expect(waitingStatus.find('[data-icon]').attributes('data-icon')).toBe('lucide:circle-alert');
    expect(waitingStatus.classes()).toContain('header-tab__status--attention');
    expect(waitingStatus.classes()).not.toContain('header-tab__status--waiting');
    expect(getTabElement(wrapper, 'chat:error').find('.header-tab__status [data-icon]').attributes('data-icon')).toBe('lucide:circle-x');
    expect(getTabElement(wrapper, 'chat:completed').find('.header-tab__status').exists()).toBe(true);
    expect(getTabElement(wrapper, 'welcome').find('.header-tab__status').exists()).toBe(false);
  });

  it('updates a persisted chat title from the global title event', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:session-a', '/chat/session-a')];
    const wrapper = mountTabs();

    storeEvents.emitChatSessionTitleUpdated('session-a', '新的标题');
    await flushPromises();

    expect(tabsStore.tabs[0]?.title).toBe('新的标题');
    wrapper.unmount();
  });

  it('closes a running chat without Runtime confirmation and retains its background record', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:session-a', '/chat/session-a')];
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.setStatus('chat:session-a', 'running');
    const wrapper = mountTabs();

    await getTabElement(wrapper, 'chat:session-a').find('.header-tab__close').trigger('click');
    await flushPromises();

    expect(modalConfirmMock).not.toHaveBeenCalled();
    expect(tabsStore.tabs).toEqual([]);
    expect(runtimeStore.records['chat:session-a']).toMatchObject({ sessionId: 'session-a', status: 'running' });
  });

  it('still keeps a dirty running chat when the dirty-content confirmation is cancelled', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('chat:session-a', '/chat/session-a')];
    tabsStore.dirtyById['chat:session-a'] = true;
    const runtimeStore = useChatTabStore();
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    runtimeStore.setStatus('chat:session-a', 'running');
    const cancelledWrapper = mountTabs();
    modalConfirmMock.mockResolvedValueOnce([true, false]);

    await cancelledWrapper.find('.header-tab__close').trigger('click');
    await flushPromises();
    expect(tabsStore.tabs).toHaveLength(1);
    expect(runtimeStore.records['chat:session-a']).toMatchObject({ status: 'running' });
  });

  it('retains the existing dirty confirmation for ordinary tabs', async (): Promise<void> => {
    const tabsStore = useTabsStore();
    tabsStore.tabs = [createTab('editor-a', '/editor/a')];
    tabsStore.dirtyById['editor-a'] = true;
    const wrapper = mountTabs();

    await wrapper.find('.header-tab__close').trigger('click');
    await flushPromises();

    expect(modalConfirmMock).toHaveBeenCalledTimes(1);
    expect(tabsStore.tabs).toEqual([]);
  });

  it('keeps an active chat tab when fallback navigation is rejected', async (): Promise<void> => {
    routeMock.fullPath = '/chat/session-a';
    const tabsStore = useTabsStore();
    const runtimeStore = useChatTabStore();
    tabsStore.tabs = [createTab('chat:session-a', '/chat/session-a')];
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    routerPushMock.mockRejectedValue(new Error('navigation failed'));
    const wrapper = mountTabs();

    await wrapper.find('.header-tab__close').trigger('click');
    await flushPromises();

    expect(tabsStore.tabs).toHaveLength(1);
    expect(runtimeStore.records['chat:session-a']).toBeDefined();
    expect(runtimeStore.isClosing('chat:session-a')).toBe(false);
  });

  it('keeps an active chat tab when fallback navigation is aborted', async (): Promise<void> => {
    routeMock.fullPath = '/chat/session-a';
    const tabsStore = useTabsStore();
    const runtimeStore = useChatTabStore();
    tabsStore.tabs = [createTab('chat:session-a', '/chat/session-a')];
    runtimeStore.ensureTab('chat:session-a', 'session-a');
    routerPushMock.mockResolvedValue(routeFailureMock);
    const wrapper = mountTabs();

    await wrapper.find('.header-tab__close').trigger('click');
    await flushPromises();

    expect(tabsStore.tabs).toHaveLength(1);
    expect(runtimeStore.records['chat:session-a']).toBeDefined();
    expect(runtimeStore.isClosing('chat:session-a')).toBe(false);
  });
});
