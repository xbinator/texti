/**
 * @file design-setter.test.ts
 * @description 验证Widget 设计设置面板的布局输入行为。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent } from 'vue';
import type { PropType } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { WIDGET_MIN_ELEMENT_SIZE } from '@/components/BWidget/constants/board';
import { createLiteralValue } from '@/components/BSmart/utils/value';
import type { WidgetElement, WidgetElementLoopConfig } from '@/components/BWidget/types';
import DesignSetter from '@/views/widget/components/DesignSetter.vue';

vi.mock('ant-design-vue', () => ({
  Input: defineComponent({
    name: 'AInputStub',
    props: {
      value: {
        type: String,
        default: ''
      }
    },
    emits: ['update:value'],
    template: '<input :value="value" @input="$emit(\'update:value\', $event.target.value)" />'
  }),
  InputNumber: defineComponent({
    name: 'AInputNumberStub',
    props: {
      value: {
        type: Number,
        default: undefined
      },
      controls: {
        type: Boolean,
        default: true
      },
      min: {
        type: Number,
        default: undefined
      },
      placeholder: {
        type: String,
        default: ''
      },
      disabled: {
        type: Boolean,
        default: false
      }
    },
    emits: {
      /**
       * 更新数字值；清空输入时传入 null，与真实 AInputNumber 行为一致。
       * @param value - 新值
       * @returns 是否允许触发事件
       */
      'update:value': (value: number | null): boolean => value === null || typeof value === 'number'
    },
    template: `
      <input
        type="number"
        :disabled="disabled"
        :value="value ?? ''"
        @input="$emit('update:value', $event.target.value === '' ? null : Number($event.target.value))"
      />
    `
  })
}));

/**
 * 创建测试循环配置。
 * @returns 循环配置
 */
function createLoopConfig(): WidgetElementLoopConfig {
  return {
    enabled: false,
    source: createLiteralValue(''),
    autoColumns: false,
    columns: 1,
    columnGap: 0,
    rowGap: 0,
    itemName: 'item',
    indexName: 'index'
  };
}

/**
 * 创建测试Widget 元素。
 * @returns Widget 元素
 */
function createWidgetElement(): WidgetElement {
  return {
    id: 'rect-1',
    name: 'rect',
    label: '矩形',
    icon: 'lucide:square',
    title: '矩形节点',
    position: { x: 12, y: 24 },
    size: { width: 160, height: 64 },
    rotation: 0,
    style: {},
    loop: createLoopConfig(),
    metadata: {}
  };
}

/**
 * 挂载设计设置面板。
 * @param element - 待编辑的 Widget 元素
 * @returns 组件包装器
 */
function mountDesignSetter(element: WidgetElement): VueWrapper {
  return mount(DesignSetter, {
    props: {
      element
    },
    global: {
      stubs: {
        BSectionBlock: defineComponent({
          name: 'BSectionBlockStub',
          props: {
            title: {
              type: String,
              required: true
            }
          },
          template: '<section :data-title="title"><slot /></section>'
        }),
        BSectionItem: defineComponent({
          name: 'BSectionItemStub',
          props: {
            label: {
              type: String,
              default: ''
            },
            icon: {
              type: String,
              default: ''
            }
          },
          template: '<label :data-label="label" :data-icon="icon"><slot /></label>'
        }),
        BButton: defineComponent({
          name: 'BButtonStub',
          props: {
            icon: {
              type: String,
              default: ''
            },
            tooltip: {
              type: String,
              default: ''
            }
          },
          emits: ['click'],
          template: '<button type="button" :data-icon="icon" :data-tooltip="tooltip" @click="$emit(\'click\', $event)"><slot /></button>'
        }),
        BInputNumber: defineComponent({
          name: 'BInputNumberStub',
          props: {
            value: {
              type: Number,
              default: undefined
            },
            disabled: {
              type: Boolean,
              default: false
            },
            defaultValue: {
              type: Number,
              default: undefined
            },
            decimalPrecision: {
              type: Number,
              default: undefined
            }
          },
          emits: {
            /**
             * 更新数字输入值。
             * @param value - 新输入值
             * @returns 是否允许触发事件
             */
            'update:value': (value: number | null): boolean => value === null || typeof value === 'number'
          },
          methods: {
            /**
             * 归一化数字输入测试值。
             * @param value - 原始输入值
             * @returns 归一化后的输出值
             */
            normalizeValue(value: number | null): number | undefined {
              if (value === null) {
                return this.defaultValue;
              }

              if (this.decimalPrecision === undefined) {
                return value;
              }

              return Number(value.toFixed(this.decimalPrecision));
            }
          },
          template: `
            <input
              type="number"
              :disabled="disabled"
              :value="value ?? ''"
              @input="$emit('update:value', normalizeValue($event.target.value === '' ? null : Number($event.target.value)))"
            />
          `
        }),
        BSelect: defineComponent({
          name: 'BSelectStub',
          props: {
            value: {
              type: [Number, String],
              default: undefined
            },
            options: {
              type: Array as PropType<Array<{ value: number | string; label: string }>>,
              default: (): Array<{ value: number | string; label: string }> => []
            }
          },
          emits: ['update:value'],
          template: `
            <select :value="value">
              <option v-for="option in options" :key="String(option.value)" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          `
        }),
        BColorPicker: defineComponent({
          name: 'BColorPickerStub',
          template: '<div><slot /></div>'
        }),
        BSegmented: defineComponent({
          name: 'BSegmentedStub',
          props: {
            value: {
              type: String,
              default: ''
            },
            options: {
              type: Array as PropType<Array<{ value: string; label: string }>>,
              default: (): Array<{ value: string; label: string }> => []
            }
          },
          template: '<div><slot v-for="option in options" name="label" :record="option" /></div>'
        }),
        BMonacoModal: defineComponent({
          name: 'BMonacoModal',
          props: {
            open: {
              type: Boolean,
              default: false
            },
            value: {
              type: String,
              default: ''
            },
            language: {
              type: String,
              default: ''
            }
          },
          emits: ['confirm', 'update:open', 'update:value'],
          template: '<div class="b-monaco-modal-stub"></div>'
        }),
        BIcon: true
      }
    }
  });
}

/**
 * 清空指定布局项的数字输入。
 * @param wrapper - 组件包装器
 * @param label - 布局项标签
 */
async function clearLayoutInput(wrapper: VueWrapper, label: string): Promise<void> {
  const input = wrapper.find(`[data-label="${label}"] input`);
  expect(input.exists()).toBe(true);

  await input.setValue('');
}

/**
 * 读取指定布局项的数字输入。
 * @param wrapper - 组件包装器
 * @param label - 布局项标签
 * @returns 数字输入包装器
 */
function findLayoutInput(wrapper: VueWrapper, label: string): ReturnType<VueWrapper['find']> {
  const input = wrapper.find(`[data-label="${label}"] input`);
  expect(input.exists()).toBe(true);

  return input;
}

describe('DesignSetter', (): void => {
  it('opens css source modal and writes confirmed css to the element model', async (): Promise<void> => {
    const element = createWidgetElement();
    element.style = {
      color: '#111827',
      fontSize: 14
    };
    const wrapper = mountDesignSetter(element);

    await wrapper.find('.design-setter__css-edit').trigger('click');

    const modal = wrapper.findComponent({ name: 'BMonacoModal' });
    expect(modal.props('open')).toBe(true);
    expect(modal.props('language')).toBe('css');
    expect(modal.props('value')).toContain(':root {');
    expect(modal.props('value')).toContain('font-size: 14px;');

    modal.vm.$emit('confirm', ':root {\n  filter: blur(2px);\n  color: #0f172a;\n}');

    expect(element.style).toEqual({
      css: ':root {\n  filter: blur(2px);\n  color: #0f172a;\n}',
      color: '#0f172a'
    });
    wrapper.unmount();
  });

  it('keeps layout geometry valid when numeric layout inputs are cleared', async (): Promise<void> => {
    const element = createWidgetElement();
    const wrapper = mountDesignSetter(element);

    await clearLayoutInput(wrapper, 'X');
    await clearLayoutInput(wrapper, 'Y');
    await clearLayoutInput(wrapper, '宽');
    await clearLayoutInput(wrapper, '高');

    expect(element.position).toEqual({ x: 0, y: 0 });
    expect(element.size).toEqual({
      width: WIDGET_MIN_ELEMENT_SIZE.width,
      height: WIDGET_MIN_ELEMENT_SIZE.height
    });
    wrapper.unmount();
  });

  it('locks persisted element geometry inputs without disabling style controls', async (): Promise<void> => {
    const element = createWidgetElement();
    const wrapper = mountDesignSetter(element);

    const lockButton = wrapper.find('[data-label="锁"] button');
    expect(lockButton.exists()).toBe(true);

    await lockButton.trigger('click');

    expect(element.locked).toBe(true);
    expect(findLayoutInput(wrapper, 'X').attributes('disabled')).toBeDefined();
    expect(findLayoutInput(wrapper, 'Y').attributes('disabled')).toBeDefined();
    expect(findLayoutInput(wrapper, '宽').attributes('disabled')).toBeDefined();
    expect(findLayoutInput(wrapper, '高').attributes('disabled')).toBeDefined();
    expect(wrapper.find('[data-icon="lucide:paint-bucket"]').exists()).toBe(true);

    await lockButton.trigger('click');

    expect(element.locked).toBe(false);
    expect(findLayoutInput(wrapper, 'X').attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });
});
