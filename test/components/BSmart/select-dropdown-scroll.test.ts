/**
 * @file select-dropdown-scroll.test.ts
 * @description 验证提示词编辑器通用下拉菜单的活动项滚动行为。
 * @vitest-environment jsdom
 */
import { h, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SelectDropdown from '@/components/BSmart/components/_SelectDropdown.vue';

/**
 * 下拉测试项。
 */
interface DropdownTestItem {
  /** 展示标签 */
  label: string;
}

const originalScrollIntoView = Element.prototype.scrollIntoView;
const scrollIntoViewMock = vi.fn<(_options?: boolean | ScrollIntoViewOptions) => void>();

/**
 * 创建固定数量的下拉测试项。
 * @param count - 测试项数量
 * @returns 下拉测试项列表
 */
function createItems(count: number): DropdownTestItem[] {
  return Array.from(
    { length: count },
    (_value: unknown, index: number): DropdownTestItem => ({
      label: `Item ${index}`
    })
  );
}

/**
 * 挂载通用下拉组件。
 * @param propsOverrides - 需要覆盖的组件属性
 * @returns 下拉组件包装器
 */
function mountDropdown(propsOverrides: Record<string, unknown> = {}): VueWrapper {
  return mount(SelectDropdown, {
    props: {
      visible: true,
      items: createItems(12),
      activeIndex: 0,
      ...propsOverrides
    },
    slots: {
      item: ({ item }: { item: DropdownTestItem }) => h('span', item.label)
    }
  });
}

describe('SelectDropdown active item scrolling', (): void => {
  beforeEach((): void => {
    scrollIntoViewMock.mockClear();
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewMock
    });
  });

  afterEach((): void => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: originalScrollIntoView
    });
  });

  it('scrolls the active item into view when keyboard navigation requests it', async (): Promise<void> => {
    const wrapper = mountDropdown({
      scrollActiveIntoView: true
    });

    await wrapper.setProps({ activeIndex: 8 });
    await nextTick();

    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('does not scroll when active index changes without a keyboard scroll request', async (): Promise<void> => {
    const wrapper = mountDropdown({
      scrollActiveIntoView: false
    });

    await wrapper.setProps({ activeIndex: 8 });
    await nextTick();

    expect(scrollIntoViewMock).not.toHaveBeenCalled();
  });

  it('stays safe when the host does not provide scrollIntoView', async (): Promise<void> => {
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      configurable: true,
      value: undefined
    });
    const wrapper = mountDropdown({
      scrollActiveIntoView: true
    });

    await expect(wrapper.setProps({ activeIndex: 8 })).resolves.toBeUndefined();
    await nextTick();
  });

  it('renders the complete item list', (): void => {
    const wrapper = mountDropdown({
      items: createItems(100)
    });
    const renderedItems = wrapper.findAll('.select-dropdown__item');

    expect(renderedItems).toHaveLength(100);
    expect(renderedItems[0]?.text()).toBe('Item 0');
    expect(renderedItems[99]?.text()).toBe('Item 99');
  });
});
