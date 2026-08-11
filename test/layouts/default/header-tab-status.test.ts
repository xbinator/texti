/**
 * @file header-tab-status.test.ts
 * @description HeaderTab 通用视觉状态与聊天依赖隔离测试。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HeaderTab from '@/layouts/default/components/HeaderTab.vue';
import type { Tab, TabStatus } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

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

/**
 * 转义选择器文本用于正则匹配。
 * @param value - 原始选择器文本
 * @returns 正则安全的选择器文本
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 生成可匹配 Less 多行选择器缩进的正则片段。
 * @param selector - 样式选择器
 * @returns 选择器正则片段
 */
function createSelectorPattern(selector: string): string {
  return escapeRegExp(selector).replace(/\n[ \t]*/gu, '\\n[ \\t]*');
}

/**
 * 查找指定选择器所在规则的源码起点。
 * @param selector - 样式选择器
 * @returns 规则起点索引，未找到时返回 -1
 */
function findRuleStart(selector: string): number {
  const selectorPattern = createSelectorPattern(selector);
  const match = new RegExp(`(?:^|\\n)[ \\t]*${selectorPattern}[ \\t]*\\{`, 'u').exec(headerTabSource);

  if (!match) {
    return -1;
  }

  return match.index + (match[0].startsWith('\n') ? 1 : 0);
}

/**
 * 读取指定样式选择器的规则内容，支持 Less 嵌套块。
 * @param selector - 样式选择器
 * @returns 规则体内容，未找到时返回空字符串
 */
function getStyleRule(selector: string): string {
  const start = findRuleStart(selector);
  if (start < 0) {
    return '';
  }

  const bodyStart = headerTabSource.indexOf('{', start) + 1;
  let depth = 1;

  for (let index = bodyStart; index < headerTabSource.length; index += 1) {
    const char = headerTabSource[index];

    // Less 支持嵌套规则，按大括号深度找到当前规则的真实结束位置。
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;

      if (depth === 0) {
        return headerTabSource.slice(bodyStart, index);
      }
    }
  }

  return '';
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

  it('renders dirty title color and mark after title text', (): void => {
    const tabsStore = useTabsStore();
    tabsStore.setDirty(tab.id);
    const wrapper = mountHeaderTab();
    const childClassNames = Array.from(wrapper.get('.header-tab__title').element.children, (child: Element): string => child.getAttribute('class') ?? '');
    const titleRule = getStyleRule('.header-tab__title-text--dirty');
    const dirtyMarkRule = getStyleRule('.header-tab__dirty-mark');

    expect(childClassNames).toEqual(['recent-icon-stub header-tab__icon', 'header-tab__title-text header-tab__title-text--dirty', 'header-tab__dirty-mark']);
    expect(wrapper.get('.header-tab__dirty-mark').text()).toBe('*');
    expect(titleRule).toContain('color: var(--warning-color, var(--color-warning, #faad14));');
    expect(dirtyMarkRule).toContain('margin-left: 2px;');
    expect(dirtyMarkRule).not.toContain('margin-right: 2px;');
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

  it('floats close button only after the tab grows beyond compact layout', (): void => {
    const tabRule = getStyleRule('.header-tab');
    const closeRule = getStyleRule('.header-tab__close');
    const floatingTabRule = getStyleRule('.header-tab.is-close-floating');
    const floatingCloseRule = getStyleRule('.header-tab.is-close-floating .header-tab__close');
    const revealRule = getStyleRule('&:hover .header-tab__close,\n&:focus-within .header-tab__close');
    const activeCloseRule = getStyleRule('.header-tab.is-close-floating.is-active .header-tab__close');
    const rootRuleDeclarations = tabRule.slice(0, tabRule.indexOf('/* Ensure tabs'));

    expect(rootRuleDeclarations).not.toContain('min-width: 88px;');
    expect(rootRuleDeclarations).toContain('padding: 0 0 0 10px;');
    expect(rootRuleDeclarations).not.toContain('padding: 0 4px 0 10px;');
    expect(closeRule).toContain('flex-shrink: 0;');
    expect(closeRule).toContain('width: 28px;');
    expect(closeRule).toContain('height: 100%;');
    expect(closeRule).toContain('pointer-events: none;');
    expect(closeRule).toContain('background: transparent;');
    expect(closeRule).toContain('border-radius: var(--control-radius);');
    expect(closeRule).not.toContain('position: absolute;');
    expect(closeRule).not.toContain('top: 0;');
    expect(closeRule).not.toContain('right: 0;');
    expect(closeRule).not.toContain('background: linear-gradient');
    expect(floatingTabRule).toContain('padding: 0 10px;');
    expect(floatingCloseRule).toContain('position: absolute;');
    expect(floatingCloseRule).toContain('top: 0;');
    expect(floatingCloseRule).toContain('right: 0;');
    expect(floatingCloseRule).toContain('background: linear-gradient(var(--bg-hover), var(--bg-hover)), var(--bg-secondary);');
    expect(floatingCloseRule).toContain('border-radius: 0 var(--control-radius) var(--control-radius) 0;');
    expect(revealRule).toContain('opacity: 1;');
    expect(revealRule).toContain('pointer-events: auto;');
    expect(activeCloseRule).toContain('background: linear-gradient(var(--bg-active, transparent), var(--bg-active, transparent)), var(--bg-secondary);');
    expect(headerTabSource).toContain("'is-close-floating': isCloseFloating.value");
    expect(headerTabSource).toContain('ref="titleRef"');
    expect(headerTabSource).toContain('ref="closeRef"');
    expect(headerTabSource).toContain('const titleRef = ref<HTMLElement | null>(null);');
    expect(headerTabSource).toContain('const closeRef = ref<HTMLButtonElement | null>(null);');
    expect(headerTabSource).not.toContain('querySelector');
    expect(headerTabSource).toContain('CLOSE_FLOATING_WIDTH_THRESHOLD = 100;');
    expect(headerTabSource).toContain('getCompactTabWidth() > CLOSE_FLOATING_WIDTH_THRESHOLD');
    expect(headerTabSource).toContain('<Icon icon="ic:round-close" width="16" height="16" />');
    expect(headerTabSource).toContain('.header-tab__close:hover');
  });

  it('toggles floating close layout when compact tab width crosses 100px', async (): Promise<void> => {
    const wrapper = mountHeaderTab();
    const title = wrapper.get('.header-tab__title').element;
    const close = wrapper.get('.header-tab__close').element;

    Object.defineProperty(title, 'scrollWidth', { configurable: true, value: 70 });
    Object.defineProperty(close, 'offsetWidth', { configurable: true, value: 28 });
    await wrapper.setProps({ tab: { ...tab, title: '较长标题' } });
    await nextTick();
    await nextTick();

    expect(wrapper.get('.header-tab').classes()).toContain('is-close-floating');

    Object.defineProperty(title, 'scrollWidth', { configurable: true, value: 50 });
    await wrapper.setProps({ tab: { ...tab, title: '短' } });
    await nextTick();
    await nextTick();

    expect(wrapper.get('.header-tab').classes()).not.toContain('is-close-floating');
  });
});
