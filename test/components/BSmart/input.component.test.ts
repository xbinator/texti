/**
 * @file input.component.test.ts
 * @description 验证 BSmartInput 的静态输入、变量路径编辑和显式类型切换。
 * @vitest-environment jsdom
 */
import { defineComponent, nextTick } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import BSmartInput from '@/components/BSmart/Input.vue';
import type { BSmartInputValue, VariableOptionGroup } from '@/components/BSmart/types';
import { createLiteralValue, createVariableValue } from '@/components/BSmart/utils/value';

/**
 * 创建变量选项。
 * @returns 变量选项分组
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
            { label: '城市名称', value: '$input.city' },
            { label: '图片地址', value: '$input.imageUrl' }
          ]
        }
      ]
    }
  ];
}

/**
 * 挂载单行 Smart 输入。
 * @param value - 初始结构化输入值
 * @param extraProps - 额外组件属性
 * @returns 输入组件包装器
 */
function mountTextInput(value: BSmartInputValue = createLiteralValue(''), extraProps: Record<string, unknown> = {}): VueWrapper {
  const wrapper: VueWrapper = mount(BSmartInput, {
    props: {
      value,
      options: createVariableOptions(),
      ...extraProps,
      'onUpdate:value': (nextValue: BSmartInputValue): void => {
        wrapper.setProps({ value: nextValue }).catch((error: unknown): void => {
          throw error;
        });
      }
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
          template: '<button v-bind="$attrs" type="button" :data-icon="icon" @click="$emit(\'click\')"></button>'
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

  return wrapper;
}

describe('BSmart Input', (): void => {
  afterEach((): void => {
    document.body.innerHTML = '';
  });

  it('renders the literal variable button outside the input suffix', (): void => {
    const wrapper = mountTextInput(createLiteralValue('hello'));

    expect(wrapper.find('.b-smart-input__variable-button').exists()).toBe(true);
    expect(wrapper.find('.ant-input-suffix .b-smart-input__variable-button').exists()).toBe(false);
    expect(wrapper.find<HTMLInputElement>('.b-smart-input__literal-control').element.value).toBe('hello');
    wrapper.unmount();
  });

  it('emits a literal value when literal text changes', async (): Promise<void> => {
    const wrapper = mountTextInput(createLiteralValue('old'));

    await wrapper.find<HTMLInputElement>('.b-smart-input__literal-control').setValue('new');

    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createLiteralValue('new')]);
    expect(wrapper.emitted('change')?.at(-1)).toEqual([createLiteralValue('new')]);
    wrapper.unmount();
  });

  it('switches to a closed variable input without mutating the literal model', async (): Promise<void> => {
    const wrapper = mountTextInput(createLiteralValue('unchanged'));

    await wrapper.find('.b-smart-input__variable-button').trigger('click');
    await nextTick();

    expect(wrapper.find('.b-smart-variable-input').exists()).toBe(true);
    expect(wrapper.find('.select-dropdown').exists()).toBe(false);
    expect(wrapper.emitted('update:value')).toBeUndefined();

    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    expect(wrapper.find('.select-dropdown').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps the literal text as the variable draft when switching modes', async (): Promise<void> => {
    const wrapper = mountTextInput(createLiteralValue('draft-text'));

    await wrapper.find('.b-smart-input__variable-button').trigger('click');
    await nextTick();

    expect(wrapper.find<HTMLInputElement>('.b-smart-variable-input__control input').element.value).toBe('draft-text');
    expect(wrapper.emitted('update:value')).toBeUndefined();
    wrapper.unmount();
  });

  it('returns from an uncommitted variable mode without overwriting the literal model', async (): Promise<void> => {
    const wrapper = mountTextInput(createLiteralValue('unchanged'));

    await wrapper.find('.b-smart-input__variable-button').trigger('click');
    await wrapper.find('.b-smart-input__type-button').trigger('click');

    expect(wrapper.find('.b-smart-input__literal-control').exists()).toBe(true);
    expect(wrapper.emitted('update:value')).toBeUndefined();
    wrapper.unmount();
  });

  it('preserves an unfinished variable mode across an equivalent model refresh', async (): Promise<void> => {
    const wrapper = mountTextInput(createLiteralValue('unchanged'));

    await wrapper.find('.b-smart-input__variable-button').trigger('click');
    await wrapper.setProps({ value: createLiteralValue('unchanged') });

    expect(wrapper.find('.b-smart-variable-input').exists()).toBe(true);
    expect(wrapper.emitted('update:value')).toBeUndefined();
    wrapper.unmount();
  });

  it('keeps an edited variable path as a variable value', async (): Promise<void> => {
    const wrapper = mountTextInput(createVariableValue('$input.city'));

    await wrapper.find<HTMLInputElement>('.b-smart-variable-input__control input').setValue('$input.imageUrl');

    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createVariableValue('$input.imageUrl')]);
    expect(wrapper.emitted('change')?.at(-1)).toEqual([createVariableValue('$input.imageUrl')]);
    wrapper.unmount();
  });

  it('clearing a committed variable path falls back to an empty literal', async (): Promise<void> => {
    const wrapper = mountTextInput(createVariableValue('$input.city'));

    await wrapper.find<HTMLInputElement>('.b-smart-variable-input__control input').setValue('');
    await nextTick();
    await flushPromises();

    expect(wrapper.find('.b-smart-variable-input').exists()).toBe(true);
    expect(wrapper.emitted('update:value')).toBeUndefined();

    await wrapper.find('.b-smart-input__type-button').trigger('click');

    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createLiteralValue('')]);
    wrapper.unmount();
  });

  it('converts the current variable path to a literal through the type button', async (): Promise<void> => {
    const wrapper = mountTextInput(createVariableValue('$input.city'));

    expect(wrapper.find('.b-smart-input__type-button [data-icon="lucide:type"]').exists()).toBe(true);
    await wrapper.find('.b-smart-input__type-button').trigger('click');

    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createLiteralValue('$input.city')]);
    expect(wrapper.find('.b-smart-input__literal-control').exists()).toBe(true);
    wrapper.unmount();
  });

  it('stores only the selected variable path', async (): Promise<void> => {
    const wrapper = mountTextInput(createLiteralValue(''));

    await wrapper.find('.b-smart-input__variable-button').trigger('click');
    await nextTick();
    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    await wrapper.find('[data-variable-value="$input.imageUrl"]').trigger('click');

    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createVariableValue('$input.imageUrl')]);
    wrapper.unmount();
  });

  it('does not open variables when template braces are typed', async (): Promise<void> => {
    const wrapper = mountTextInput(createLiteralValue(''));

    await wrapper.find<HTMLInputElement>('.b-smart-input__literal-control').setValue('{{city');
    await nextTick();

    expect(wrapper.find('.select-dropdown').exists()).toBe(false);
    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createLiteralValue('{{city')]);
    wrapper.unmount();
  });

  it('keeps explicit readonly text locked while allowing variable selection', async (): Promise<void> => {
    const wrapper = mountTextInput(createLiteralValue('locked'), { readonly: true });

    await wrapper.find<HTMLInputElement>('.b-smart-input__literal-control').setValue('changed');
    expect(wrapper.emitted('update:value')).toBeUndefined();

    await wrapper.find('.b-smart-input__variable-button').trigger('click');
    await nextTick();
    await wrapper.find('.b-smart-variable-input__dropdown-button').trigger('click');
    await wrapper.find('[data-variable-value="$input.city"]').trigger('click');

    expect(wrapper.emitted('update:value')?.at(-1)).toEqual([createVariableValue('$input.city')]);
    wrapper.unmount();
  });
});
