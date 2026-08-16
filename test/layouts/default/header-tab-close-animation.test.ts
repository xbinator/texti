/**
 * @file header-tab-close-animation.test.ts
 * @description HeaderTab 关闭离场动画测试：宽度收缩流程、关闭事件时序、守卫拦截恢复与样式声明。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import type { DOMWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HeaderTab from '@/layouts/default/components/HeaderTab.vue';
import type { Tab } from '@/stores/workspace/tabs';
import { useTabsStore } from '@/stores/workspace/tabs';

const headerTabSource = readFileSync('src/layouts/default/components/HeaderTab.vue', 'utf8');
const headerTabsSource = readFileSync('src/layouts/default/components/HeaderTabs.vue', 'utf8');

/** 关闭动画兜底超时时长（与组件常量保持一致）。 */
const CLOSE_FALLBACK_TIMEOUT_MS = 400;

/** 关闭被拦截后的检查延时（与组件常量保持一致）。 */
const CLOSE_CANCEL_CHECK_DELAY_MS = 200;

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

/** matchMedia mock，控制减少动效偏好。 */
const matchMediaMock = vi.fn((): { matches: boolean } => ({ matches: false }));

/** 普通标签测试数据。 */
const tab: Tab = {
  id: 'welcome',
  path: '/welcome',
  title: '欢迎',
  cacheKey: 'welcome',
  icon: 'lucide:house'
};

/**
 * 挂载待关闭标签组件。
 * @returns 标签包装器
 */
function mountHeaderTab(): ReturnType<typeof mount> {
  return mount(HeaderTab, {
    props: { tab },
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
 * 在元素上派发宽度过渡结束的 transitionend 事件。
 * @param element - 目标元素
 */
function fireTransitionEnd(element: Element): void {
  element.dispatchEvent(new TransitionEvent('transitionend', { propertyName: 'width', bubbles: true }));
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

/**
 * 读取标签根元素。
 * @param wrapper - 标签包装器
 * @returns 根元素 DOM 包装器
 */
function getTabRoot(wrapper: ReturnType<typeof mount>): DOMWrapper<Element> {
  return wrapper.get('.header-tab');
}

/**
 * 模拟 jsdom 缺失的布局宽度并点击关闭按钮。
 * @param wrapper - 标签包装器
 */
async function clickClose(wrapper: ReturnType<typeof mount>): Promise<void> {
  Object.defineProperty(getTabRoot(wrapper).element, 'offsetWidth', { configurable: true, value: 120 });
  await wrapper.get('.header-tab__close').trigger('click');
}

describe('HeaderTab close animation', (): void => {
  beforeEach((): void => {
    localStorage.clear();
    setActivePinia(createPinia());
    matchMediaMock.mockReset().mockReturnValue({ matches: false });
    vi.stubGlobal('matchMedia', matchMediaMock);
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('locks the rendered width then collapses to zero before emitting close', async (): Promise<void> => {
    const wrapper = mountHeaderTab();
    const root = getTabRoot(wrapper);
    Object.defineProperty(root.element, 'offsetWidth', { configurable: true, value: 120 });
    const reflowSpy = vi.spyOn(root.element, 'getBoundingClientRect');

    await wrapper.get('.header-tab__close').trigger('click');

    expect(root.classes()).toContain('is-closing');
    expect((root.element as HTMLElement).style.width).toBe('0px');
    expect(reflowSpy).toHaveBeenCalled();
    expect(wrapper.emitted('close')).toBeUndefined();
  });

  it('emits close after the width transition ends', async (): Promise<void> => {
    const wrapper = mountHeaderTab();
    await clickClose(wrapper);

    fireTransitionEnd(getTabRoot(wrapper).element);

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('emits close via fallback timeout when transitionend is lost', async (): Promise<void> => {
    vi.useFakeTimers();
    const wrapper = mountHeaderTab();
    await clickClose(wrapper);

    vi.advanceTimersByTime(CLOSE_FALLBACK_TIMEOUT_MS);

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('ignores repeated close clicks while closing', async (): Promise<void> => {
    const wrapper = mountHeaderTab();
    await clickClose(wrapper);
    await wrapper.get('.header-tab__close').trigger('click');

    fireTransitionEnd(getTabRoot(wrapper).element);

    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('restores the tab when the close guard keeps it in the store', async (): Promise<void> => {
    vi.useFakeTimers();
    const tabsStore = useTabsStore();
    tabsStore.tabs.push(tab);
    const wrapper = mountHeaderTab();
    await clickClose(wrapper);

    fireTransitionEnd(getTabRoot(wrapper).element);
    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(getTabRoot(wrapper).classes()).toContain('is-closing');

    vi.advanceTimersByTime(CLOSE_CANCEL_CHECK_DELAY_MS);
    await nextTick();

    const root = getTabRoot(wrapper);
    expect(root.classes()).not.toContain('is-closing');
    expect((root.element as HTMLElement).style.width).toBe('');
  });

  it('keeps the closing state when the tab has left the store', async (): Promise<void> => {
    vi.useFakeTimers();
    const wrapper = mountHeaderTab();
    await clickClose(wrapper);

    fireTransitionEnd(getTabRoot(wrapper).element);
    vi.advanceTimersByTime(CLOSE_CANCEL_CHECK_DELAY_MS);

    expect(getTabRoot(wrapper).classes()).toContain('is-closing');
    expect((getTabRoot(wrapper).element as HTMLElement).style.width).toBe('0px');
  });

  it('closes immediately when the user prefers reduced motion', async (): Promise<void> => {
    matchMediaMock.mockReturnValue({ matches: true });
    const wrapper = mountHeaderTab();
    const root = getTabRoot(wrapper);
    Object.defineProperty(root.element, 'offsetWidth', { configurable: true, value: 120 });

    await wrapper.get('.header-tab__close').trigger('click');

    expect(wrapper.emitted('close')).toHaveLength(1);
    expect(root.classes()).not.toContain('is-closing');
    expect((root.element as HTMLElement).style.width).toBe('');
  });

  it('declares the closing collapse and margin collapse styles', (): void => {
    const tabRule = getStyleRule('.header-tab');
    const closingRule = getStyleRule('.header-tab.is-closing');

    expect(closingRule).toContain('padding: 0;');
    expect(closingRule).toContain('border-right-width: 0;');
    expect(closingRule).toContain('border-left-width: 0;');
    expect(closingRule).toContain('opacity: 0;');
    expect(closingRule).toContain('overflow: hidden;');
    expect(closingRule).toContain('pointer-events: none;');
    expect(tabRule).toContain('width var(--motion-duration-base) var(--motion-easing-standard)');
    expect(tabRule).toContain('padding var(--motion-duration-base) var(--motion-easing-standard)');
    expect(tabRule).toContain('border-width var(--motion-duration-base) var(--motion-easing-standard)');

    expect(headerTabsSource).toContain('transition: margin-right var(--motion-duration-base) var(--motion-easing-standard);');
    expect(headerTabsSource).toContain(':has(> .header-tab.is-closing)');
    expect(headerTabsSource).toContain('margin-right: 0;');
    expect(headerTabsSource).toContain('width var(--motion-duration-base) var(--motion-easing-standard)');
  });
});
