/**
 * @file header-tab-status.test.ts
 * @description HeaderTab 通用视觉状态与聊天依赖隔离测试。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HeaderTab from '@/layouts/default/components/HeaderTab.vue';
import type { Tab, TabStatus } from '@/stores/workspace/tabs';

const headerTabSource = readFileSync('src/layouts/default/components/HeaderTab.vue', 'utf8');

vi.mock('vue-router', () => ({
  useRoute: (): { fullPath: string } => ({ fullPath: '/welcome' })
}));

vi.mock('@iconify/vue', () => ({
  Icon: {
    name: 'Icon',
    props: ['icon'],
    template: '<i :data-icon="icon"></i>'
  }
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: (): { recentRecords: [] } => ({ recentRecords: [] })
}));

/** 普通标签测试数据。 */
const tab: Tab = {
  id: 'welcome',
  path: '/welcome',
  title: '欢迎',
  cacheKey: 'welcome',
  icon: 'lucide:house'
};

/**
 * 挂载通用状态标签。
 * @param status - 通用标签状态
 * @returns 标签包装器
 */
function mountHeaderTab(status?: TabStatus): ReturnType<typeof mount> {
  return mount(HeaderTab, {
    props: { tab, status },
    global: {
      stubs: {
        BRecentIcon: {
          name: 'BRecentIcon',
          template: '<span class="recent-icon-stub"></span>'
        }
      }
    }
  });
}

describe('HeaderTab generic status', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  it.each([
    ['loading', 'lucide:loader-circle', 'is-spinning'],
    ['attention', 'lucide:circle-alert', 'header-tab__status--attention'],
    ['error', 'lucide:circle-x', 'header-tab__status--error']
  ] as const)('renders generic %s status', (status: TabStatus, icon: string, className: string): void => {
    const wrapper = mountHeaderTab(status);
    const indicator = wrapper.find('.header-tab__status');

    expect(indicator.find('[data-icon]').attributes('data-icon')).toBe(icon);
    expect(indicator.classes()).toContain(className);
    expect(wrapper.find('.recent-icon-stub').exists()).toBe(false);
  });

  it('renders a generic completed marker without an icon', (): void => {
    const wrapper = mountHeaderTab('completed');
    const indicator = wrapper.find('.header-tab__status');

    expect(indicator.classes()).toContain('header-tab__status--completed');
    expect(indicator.find('[data-icon]').exists()).toBe(false);
  });

  it('falls back to the normal tab icon when status is absent', (): void => {
    const wrapper = mountHeaderTab();

    expect(wrapper.find('.header-tab__status').exists()).toBe(false);
    expect(wrapper.find('.recent-icon-stub').exists()).toBe(true);
  });

  it('emits the original contextmenu event from the tab root', async (): Promise<void> => {
    const wrapper = mountHeaderTab();

    await wrapper.find('.header-tab').trigger('contextmenu', { clientX: 120, clientY: 48 });

    const emittedEvent = wrapper.emitted('contextmenu')?.[0]?.[0];
    expect(emittedEvent).toBeInstanceOf(MouseEvent);
    expect((emittedEvent as MouseEvent).clientX).toBe(120);
    expect((emittedEvent as MouseEvent).clientY).toBe(48);
    expect(headerTabSource).toContain("(e: 'contextmenu', event: MouseEvent): void;");
    expect(headerTabSource).toContain('@contextmenu.prevent="emit(\'contextmenu\', $event)"');
  });

  it('does not depend on chat runtime types or stores', (): void => {
    expect(headerTabSource).not.toContain('@/stores/chat/');
    expect(headerTabSource).not.toContain('ChatTabRuntimeStatus');
  });

  it('delegates icon prop resolution to the dedicated hook', (): void => {
    expect(headerTabSource).toContain('useHeaderTabIcon');
    expect(headerTabSource).toContain('v-bind="tabIconProps"');
    expect(headerTabSource).not.toContain('resolveTabIconRecentRecord');
    expect(headerTabSource).not.toContain('resolveTabIconFileName');
    expect(headerTabSource).not.toContain('resolveTabRecentRecord');
  });
});
