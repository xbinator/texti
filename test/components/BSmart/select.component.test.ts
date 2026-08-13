/**
 * @file select.component.test.ts
 * @description 验证 BSmartSelect 直接支持静态选择与可编辑变量路径。
 * @vitest-environment jsdom
 */
import { readFileSync } from 'node:fs';
import type { PropType, Ref } from 'vue';
import { defineComponent, nextTick, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import BSmartSelect from '@/components/BSmart/Select.vue';
import type { BSmartSelectOption, BSmartSelectValue, VariableOptionGroup } from '@/components/BSmart/types';
import { createLiteralValue, createVariableValue } from '@/components/BSmart/utils/value';

/** BSmartSelect 源码，用于锁定组件边界。 */
const selectSource = readFileSync('src/components/BSmart/Select.vue', 'utf8');

/**
 * 测试宿主组件实例。
 */
interface TextSelectHostVm {
  /** 当前选择值 */
  value: BSmartSelectValue<boolean>;
}

/**
 * BSelect 测试桩属性。
 */
interface TextSelectStubProps {
  /** 当前选中内部值 */
  value?: string | number;
}

/**
 * 创建变量候选。
 * @returns 变量分组选项
 */
function createVariableOptions(): VariableOptionGroup[] {
  return [
    {
      type: 'variable',
      options: [{ label: '加载中', value: 'loading' }]
    }
  ];
}

/**
 * 挂载 BSmartSelect。
 * @param initialValue - 初始结构化值
 * @returns 组件包装器
 */
function mountTextSelect(initialValue: BSmartSelectValue<boolean>): VueWrapper {
  const Host = defineComponent({
    name: 'TextSelectHost',
    components: { BSmartSelect },
    setup(): { options: BSmartSelectOption<boolean>[]; value: Ref<BSmartSelectValue<boolean>>; variables: VariableOptionGroup[] } {
      return {
        options: [
          { label: '启用', value: false },
          { label: '禁用', value: true }
        ],
        value: ref<BSmartSelectValue<boolean>>(initialValue),
        variables: createVariableOptions()
      };
    },
    template: '<BSmartSelect v-model:value="value" :options="options" :variables="variables" />'
  });

  return mount(Host, {
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
          template: '<button v-bind="$attrs" type="button" :data-icon="icon" @click="$emit(\'click\')"></button>'
        }),
        BIcon: defineComponent({
          name: 'BIconStub',
          props: {
            icon: { type: String, required: true }
          },
          template: '<span class="b-icon-stub" :data-icon="icon"></span>'
        }),
        BSelect: defineComponent({
          name: 'BSelectStub',
          props: {
            value: { type: [String, Number], default: undefined },
            options: {
              type: Array as PropType<Array<{ label: string; value: string | number }>>,
              default: (): Array<{ label: string; value: string | number }> => []
            }
          },
          emits: {
            /** 透传静态选项值。 */
            'update:value': (value: string | number): boolean => typeof value === 'string' || typeof value === 'number'
          },
          template: `
            <div class="b-smart-select-test-select">
              <button
                v-for="item in options"
                :key="item.value"
                class="b-smart-select-test-option"
                type="button"
                @click="$emit('update:value', item.value)"
              >
                {{ item.label }}
              </button>
            </div>
          `
        })
      }
    },
    attachTo: document.body
  });
}

describe('BSmartSelect', (): void => {
  afterEach((): void => {
    document.body.innerHTML = '';
  });

  it('does not depend on BSmartInput', (): void => {
    expect(selectSource).not.toContain('BSmartInput');
    expect(selectSource).toContain('icon="lucide:list"');
  });

  it('wraps a static option in a literal value', async (): Promise<void> => {
    const wrapper = mountTextSelect(createLiteralValue(false));

    await wrapper.findAll('.b-smart-select-test-option')[1].trigger('click');

    expect((wrapper.vm as unknown as TextSelectHostVm).value).toEqual(createLiteralValue(true));
    wrapper.unmount();
  });

  it('shows a closed shared variable input without mutating the model', async (): Promise<void> => {
    const wrapper = mountTextSelect(createLiteralValue(false));

    await wrapper.find('.b-smart-select__variable-button').trigger('click');
    await nextTick();

    expect(wrapper.find('.b-smart-variable-input').exists()).toBe(true);
    expect(wrapper.find('.select-dropdown').exists()).toBe(false);
    expect((wrapper.vm as unknown as TextSelectHostVm).value).toEqual(createLiteralValue(false));

    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    expect(wrapper.find('.select-dropdown').exists()).toBe(true);
    wrapper.unmount();
  });

  it('preserves an unfinished variable mode across an equivalent model refresh', async (): Promise<void> => {
    const wrapper = mountTextSelect(createLiteralValue(false));

    await wrapper.find('.b-smart-select__variable-button').trigger('click');
    (wrapper.vm as unknown as TextSelectHostVm).value = createLiteralValue(false);
    await nextTick();

    expect(wrapper.find('.b-smart-variable-input').exists()).toBe(true);
    expect((wrapper.vm as unknown as TextSelectHostVm).value).toEqual(createLiteralValue(false));
    wrapper.unmount();
  });

  it('writes the selected variable reference', async (): Promise<void> => {
    const wrapper = mountTextSelect(createLiteralValue(false));

    await wrapper.find('.b-smart-select__variable-button').trigger('click');
    await nextTick();
    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    await wrapper.find('[data-variable-value="loading"]').trigger('click');

    expect((wrapper.vm as unknown as TextSelectHostVm).value).toEqual(createVariableValue('loading'));
    wrapper.unmount();
  });

  it('renders and edits an existing variable reference', async (): Promise<void> => {
    const wrapper = mountTextSelect(createVariableValue('loading'));
    const input = wrapper.find<HTMLInputElement>('.b-smart-variable-input__control input');

    expect(input.element.value).toBe('loading');
    await input.setValue('$input.nextField');

    expect((wrapper.vm as unknown as TextSelectHostVm).value).toEqual(createVariableValue('$input.nextField'));
    wrapper.unmount();
  });

  it('clearing a committed variable path returns to no static selection', async (): Promise<void> => {
    const wrapper = mountTextSelect(createVariableValue('loading'));

    await wrapper.find<HTMLInputElement>('.b-smart-variable-input__control input').setValue('');
    await nextTick();
    await flushPromises();

    expect((wrapper.vm as unknown as TextSelectHostVm).value).toEqual(createVariableValue('loading'));
    expect(wrapper.find('.b-smart-variable-input').exists()).toBe(true);

    await wrapper.find('.b-smart-select__select-button').trigger('click');

    expect((wrapper.vm as unknown as TextSelectHostVm).value).toBeUndefined();
    expect(wrapper.find('.b-smart-variable-input').exists()).toBe(false);
    wrapper.unmount();
  });

  it('switches back to the static UI without mutating the variable model', async (): Promise<void> => {
    const wrapper = mountTextSelect(createVariableValue('loading'));

    await wrapper.find('.b-smart-select__select-button').trigger('click');

    const select = wrapper.findComponent({ name: 'BSelectStub' });
    const selectProps = select.props() as TextSelectStubProps;
    expect(select.exists()).toBe(true);
    expect(selectProps.value).toBeUndefined();
    expect((wrapper.vm as unknown as TextSelectHostVm).value).toEqual(createVariableValue('loading'));
    wrapper.unmount();
  });

  it('follows an external static model update', async (): Promise<void> => {
    const wrapper = mountTextSelect(createVariableValue('loading'));

    (wrapper.vm as unknown as TextSelectHostVm).value = createLiteralValue(false);
    await nextTick();

    const selectProps = wrapper.findComponent({ name: 'BSelectStub' }).props() as TextSelectStubProps;
    expect(selectProps.value).toBe('static:0:boolean:false');
    expect(wrapper.find('.b-smart-variable-input').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders an unselected static control for undefined', (): void => {
    const wrapper = mountTextSelect(undefined);
    const selectProps = wrapper.findComponent({ name: 'BSelectStub' }).props() as TextSelectStubProps;

    expect(selectProps.value).toBeUndefined();
    expect(wrapper.find('.b-smart-variable-input').exists()).toBe(false);
    wrapper.unmount();
  });
});
