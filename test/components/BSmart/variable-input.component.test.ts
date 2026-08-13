/**
 * @file variable-input.component.test.ts
 * @description 验证共享变量路径输入、键盘循环与选中变量定位。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import { defineComponent, nextTick } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VariableInput from '@/components/BSmart/components/VariableInput.vue';
import VariableSelect from '@/components/BSmart/components/VariableSelect.vue';
import type { VariableOptionGroup } from '@/components/BSmart/types';

/** 共享变量输入源码，用于锁定不支持挂载自动打开。 */
const variableInputSource = readFileSync('src/components/BSmart/components/VariableInput.vue', 'utf8');

/**
 * 创建带嵌套节点的变量候选。
 * @returns 变量分组选项
 */
function createVariableOptions(): VariableOptionGroup[] {
  return [
    {
      type: 'variable',
      options: [
        {
          label: '入参',
          value: '$input',
          children: [
            { label: '城市', value: '$input.city' },
            { label: '图片', value: '$input.image' }
          ]
        },
        {
          label: '天气',
          value: 'weather',
          children: [{ label: '图标', value: 'weather.icon' }]
        }
      ]
    }
  ];
}

/**
 * 挂载共享变量输入。
 * @param value - 当前变量路径
 * @param extraProps - 额外属性
 * @returns 组件包装器
 */
function mountVariableInput(value = '', extraProps: Record<string, unknown> = {}): VueWrapper {
  return mount(VariableInput, {
    props: {
      value,
      options: createVariableOptions(),
      ...extraProps
    },
    global: {
      components: {
        BButton: defineComponent({
          name: 'BButtonStub',
          inheritAttrs: false,
          props: {
            icon: { type: String, default: '' }
          },
          emits: {
            /** 透传点击事件。 */
            click: (): boolean => true
          },
          template: '<button v-bind="$attrs" type="button" :data-icon="icon" @click="$emit(\'click\', $event)"></button>'
        }),
        BIcon: defineComponent({
          name: 'BIconStub',
          props: {
            icon: { type: String, required: true }
          },
          template: '<span class="b-icon-stub" :data-icon="icon"></span>'
        })
      }
    },
    attachTo: document.body
  });
}

describe('BSmart VariableInput', (): void => {
  beforeEach((): void => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('emits the edited path and keeps the chevron in the input suffix', async (): Promise<void> => {
    const wrapper = mountVariableInput('$input.city');
    const input = wrapper.find<HTMLInputElement>('.b-smart-variable-input__control input');

    expect(wrapper.find('.ant-input-suffix [data-icon="lucide:chevron-down"]').exists()).toBe(true);
    await input.setValue('$input.image');

    expect(wrapper.emitted('update:value')?.at(-1)).toEqual(['$input.image']);
    expect(wrapper.emitted('change')?.at(-1)).toEqual(['$input.image']);
    wrapper.unmount();
  });

  it('opens manually and activates the current variable', async (): Promise<void> => {
    const wrapper = mountVariableInput('weather.icon');

    expect(wrapper.find('.select-dropdown').exists()).toBe(false);
    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    await nextTick();
    await nextTick();

    expect(wrapper.find('.select-dropdown').exists()).toBe(true);
    expect(wrapper.find('[data-variable-value="weather.icon"]').element.closest('.select-dropdown__item')?.classList.contains('active')).toBe(true);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    wrapper.unmount();
  });

  it('does not support opening automatically on mount', (): void => {
    expect(variableInputSource).not.toContain('openOnMount');
  });

  it('wraps keyboard navigation between the last and first variable', async (): Promise<void> => {
    const wrapper = mountVariableInput('weather.icon');
    const input = wrapper.find<HTMLInputElement>('.b-smart-variable-input__control input');

    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    await nextTick();
    await nextTick();
    expect(wrapper.findAll('.select-dropdown__item').at(-1)?.classes()).toContain('active');

    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.findAll('.select-dropdown__item')[0]?.classes()).toContain('active');

    await input.trigger('keydown', { key: 'ArrowUp' });
    expect(wrapper.findAll('.select-dropdown__item').at(-1)?.classes()).toContain('active');
    wrapper.unmount();
  });

  it('re-expands selected ancestors when the dropdown is reopened', async (): Promise<void> => {
    const wrapper = mountVariableInput('$input.image');
    const input = wrapper.find<HTMLInputElement>('.b-smart-variable-input__control input');

    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    await nextTick();
    await wrapper.find('[data-variable-value="$input"] button').trigger('click');
    expect(wrapper.find('[data-variable-value="$input.image"]').exists()).toBe(false);

    await input.trigger('keydown', { key: 'Escape' });
    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    await nextTick();

    expect(wrapper.find('[data-variable-value="$input.image"]').exists()).toBe(true);
    expect(wrapper.find('[data-variable-value="$input.image"]').element.closest('.select-dropdown__item')?.classList.contains('active')).toBe(true);
    wrapper.unmount();
  });

  it('emits only the selected variable path', async (): Promise<void> => {
    const wrapper = mountVariableInput('');

    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    await nextTick();
    await wrapper.find('[data-variable-value="$input.city"]').trigger('click');

    expect(wrapper.emitted('update:value')?.at(-1)).toEqual(['$input.city']);
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['$input.city']);
    wrapper.unmount();
  });

  it('closes and blocks variable selection when disabled while open', async (): Promise<void> => {
    const wrapper = mountVariableInput('');

    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    await nextTick();
    expect(wrapper.find('.select-dropdown').exists()).toBe(true);

    await wrapper.setProps({ disabled: true });
    wrapper.findComponent(VariableSelect).vm.$emit('select', { label: '城市', value: '$input.city' });
    await nextTick();

    expect(wrapper.find('.select-dropdown').exists()).toBe(false);
    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(wrapper.emitted('select')).toBeUndefined();
    wrapper.unmount();
  });

  it('closes when another dropdown outside this control is clicked', async (): Promise<void> => {
    const wrapper = mountVariableInput('');
    const externalDropdown = document.createElement('div');
    externalDropdown.className = 'select-dropdown';
    document.body.appendChild(externalDropdown);

    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    await nextTick();
    expect(wrapper.find('.select-dropdown').exists()).toBe(true);

    externalDropdown.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();

    expect(wrapper.find('.select-dropdown').exists()).toBe(false);
    wrapper.unmount();
  });
});
