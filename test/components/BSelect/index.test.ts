/**
 * @file index.test.ts
 * @description 验证 BSelect 下拉底部扩展区、菜单渲染和关闭回调行为。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent, h, nextTick, type PropType, type VNode } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import BSelect from '@/components/BSelect/index.vue';
import type { SelectOption } from '@/components/BSelect/types';

/**
 * ASelect 测试替身，保留 dropdownRender、dropdownVisibleChange 和 open 传递。
 */
const ASelectStub = defineComponent({
  name: 'ASelect',
  props: {
    value: { type: [String, Number], default: undefined },
    open: { type: Boolean, default: false },
    options: { type: Array as PropType<SelectOption[]>, default: (): SelectOption[] => [] }
  },
  emits: ['dropdownVisibleChange'],
  setup(_props, { emit, slots }): () => VNode {
    /**
     * 模拟菜单节点。
     * @returns 菜单节点
     */
    function renderMenuNode(): VNode {
      return h('div', { class: 'a-select-stub__menu-node' }, 'menu node');
    }

    /**
     * 在挂载后模拟下拉展开。
     */
    nextTick((): void => {
      emit('dropdownVisibleChange', true);
    });

    return (): VNode =>
      h('div', { class: 'a-select-stub', 'data-open': String(_props.open), 'data-value': String(_props.value) }, [
        h('div', { class: 'a-select-stub__suffix' }, slots.suffixIcon ? slots.suffixIcon() : []),
        h('div', { class: 'a-select-stub__dropdown' }, slots.dropdownRender ? slots.dropdownRender({ menuNode: renderMenuNode() }) : [])
      ]);
  }
});

/**
 * BIcon 测试替身，保留 icon 属性输出。
 */
const BIconStub = defineComponent({
  name: 'BIcon',
  props: {
    icon: { type: String, default: '' },
    size: { type: Number, default: 16 }
  },
  template: '<i class="b-icon-stub" :data-icon="icon" :data-size="size"></i>'
});

/**
 * 挂载 BSelect 组件。
 * @param slots - 传入的插槽内容
 * @param props - 传入的组件属性
 * @returns 组件包装器
 */
function mountSelect(slots: Record<string, string>, props?: { value?: string | number | null; options?: SelectOption[] }): VueWrapper {
  return mount(BSelect, {
    props: {
      value: props?.value,
      options: props?.options ?? [{ value: 'default', label: '默认主题' }]
    },
    slots,
    global: {
      stubs: {
        ASelect: ASelectStub,
        BIcon: BIconStub
      }
    }
  });
}

describe('BSelect', (): void => {
  beforeEach((): void => {
    document.body.innerHTML = '';
  });

  it('renders the dropdown footer slot after the default menu node', async (): Promise<void> => {
    const wrapper = mountSelect(
      {
        dropdownFooter: `
          <div class="b-select-footer-stub">
            <span class="b-select-footer-stub__label">{{ selectedOption ? selectedOption.label : '' }}</span>
            <button class="b-select-footer-stub__button" @click="closeDropdown()">自定义主题</button>
          </div>
        `
      },
      {
        value: 'default',
        options: [{ value: 'default', label: '默认主题', tips: '基础主题' }]
      }
    );

    await nextTick();

    expect(wrapper.find('.a-select-stub__menu-node').exists()).toBe(true);
    expect(wrapper.find('.b-select-footer-stub__label').text()).toBe('默认主题');
    expect(wrapper.text()).toContain('自定义主题');
  });

  it('exposes closeDropdown to the dropdown footer slot', async (): Promise<void> => {
    const wrapper = mountSelect({
      dropdownFooter: `
        <button class="b-select-footer-stub__button" @click="closeDropdown()">自定义主题</button>
      `
    });

    await nextTick();

    expect(wrapper.find('.a-select-stub').attributes('data-open')).toBe('true');

    await wrapper.find('.b-select-footer-stub__button').trigger('click');
    await nextTick();

    expect(wrapper.find('.a-select-stub').attributes('data-open')).toBe('false');
  });

  it('normalizes null value to undefined for the underlying ASelect binding', async (): Promise<void> => {
    const wrapper = mountSelect({}, { value: null });

    await nextTick();

    expect(wrapper.find('.a-select-stub').attributes('data-value')).toBe('undefined');
  });
});
