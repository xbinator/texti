/**
 * @file advanced-setter.test.ts
 * @description 验证Widget 高级设置面板的循环配置交互。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent, nextTick, ref } from 'vue';
import type { PropType, Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { BSmartInputValue, Variable, VariableOptionGroup } from '@/components/BSmart/types';
import { createVariableValue } from '@/components/BSmart/utils/value';
import { provideWidgetContext } from '@/components/BWidget/hooks/useWidgetContext';
import type { WidgetData, WidgetElement, WidgetElementLoopConfig } from '@/components/BWidget/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import AdvancedSetter from '@/views/widget/components/AdvancedSetter.vue';

vi.mock('ant-design-vue', () => ({
  Checkbox: defineComponent({
    name: 'ACheckboxStub',
    props: {
      checked: {
        type: Boolean,
        default: false
      }
    },
    emits: ['update:checked'],
    setup(_props, { emit }) {
      /**
       * 将原生 checkbox 事件转换为 ACheckbox 的 checked 更新事件。
       * @param event - 原生输入事件
       */
      function handleChange(event: Event): void {
        if (event.target instanceof HTMLInputElement) {
          emit('update:checked', event.target.checked);
        }
      }

      return { handleChange };
    },
    template: '<input type="checkbox" :checked="checked" @change="handleChange" />'
  }),
  Input: defineComponent({
    name: 'AInputStub',
    props: {
      value: {
        type: String,
        default: ''
      },
      placeholder: {
        type: String,
        default: ''
      }
    },
    emits: ['update:value'],
    setup(_props, { emit }) {
      /**
       * 将原生 input 事件转换为 AInput 的 value 更新事件。
       * @param event - 原生输入事件
       */
      function handleInput(event: Event): void {
        if (event.target instanceof HTMLInputElement) {
          emit('update:value', event.target.value);
        }
      }

      return { handleInput };
    },
    template: '<input :value="value" :placeholder="placeholder" @input="handleInput" />'
  }),
  InputNumber: defineComponent({
    name: 'AInputNumberStub',
    props: {
      value: {
        type: Number,
        default: null
      },
      controls: {
        type: Boolean,
        default: true
      },
      placeholder: {
        type: String,
        default: ''
      }
    },
    emits: ['update:value'],
    setup(_props, { emit }) {
      /**
       * 将原生数字输入事件转换为 AInputNumber 的 value 更新事件。
       * @param event - 原生输入事件
       */
      function handleInput(event: Event): void {
        if (event.target instanceof HTMLInputElement) {
          emit('update:value', Number(event.target.value));
        }
      }

      return { handleInput };
    },
    template: '<input type="number" :value="value" :placeholder="placeholder" @input="handleInput" />'
  })
}));

/**
 * 创建测试循环配置。
 * @returns 循环配置
 */
function createLoopConfig(): WidgetElementLoopConfig {
  return {
    enabled: true,
    source: createVariableValue('$input.items'),
    autoColumns: false,
    columns: 2,
    columnGap: 12,
    rowGap: 12,
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
    id: 'text-1',
    name: 'text',
    label: '文本',
    icon: 'lucide:type',
    title: '文本',
    position: { x: 0, y: 0 },
    size: { width: 120, height: 40 },
    rotation: 0,
    style: {},
    loop: createLoopConfig(),
    metadata: {}
  };
}

/**
 * 创建测试Widget 数据。
 * @param element - Widget 元素
 * @returns Widget 数据
 */
function createWidgetData(element: WidgetElement): WidgetData {
  const dataItem = createDefaultWidgetData();
  dataItem.elements = [element];
  dataItem.inputSchema.properties.items = {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' }
      }
    }
  };

  return dataItem;
}

/**
 * 测试用变量树节点。
 */
interface VariableTreeNode extends Variable {
  /** 子级变量节点 */
  children?: VariableTreeNode[];
}

/**
 * 扁平化变量树。
 * @param variables - 变量树节点列表
 * @returns 扁平变量列表
 */
function flattenVariableTree(variables: VariableTreeNode[]): VariableTreeNode[] {
  return variables.flatMap((item: VariableTreeNode): VariableTreeNode[] => [item, ...flattenVariableTree(item.children ?? [])]);
}

/**
 * 读取变量分组中的全部变量。
 * @param options - 变量分组选项
 * @returns 扁平变量列表
 */
function readVariables(options: VariableOptionGroup[]): VariableTreeNode[] {
  return options.flatMap((group: VariableOptionGroup): VariableTreeNode[] => flattenVariableTree(group.options as VariableTreeNode[]));
}

describe('AdvancedSetter', (): void => {
  /**
   * 创建高级设置面板测试包装器。
   * @param element - 当前元素
   * @returns 组件包装器
   */
  function mountAdvancedSetter(element: WidgetElement): VueWrapper {
    const Host = defineComponent({
      name: 'AdvancedSetterHost',
      components: {
        AdvancedSetter
      },
      emits: {
        /**
         * 透传高级设置面板元素更新。
         * @param nextElement - 更新后的元素
         * @returns 是否允许触发事件
         */
        'update:element': (nextElement: WidgetElement): boolean => typeof nextElement.id === 'string'
      },
      setup(_props, { emit }): { elementModel: Ref<WidgetElement>; handleElementUpdate: (nextElement: WidgetElement) => void } {
        const widgetData = ref<WidgetData | undefined>(createWidgetData(element));
        const selectedElementIds = ref<string[]>([element.id]);
        const elementModel = ref<WidgetElement>(element);

        provideWidgetContext({
          widgetData,
          selectedElementIds
        });

        /**
         * 同步高级设置面板元素更新。
         * @param nextElement - 更新后的元素
         */
        function handleElementUpdate(nextElement: WidgetElement): void {
          elementModel.value = nextElement;
          emit('update:element', nextElement);
        }

        return {
          elementModel,
          handleElementUpdate
        };
      },
      template: '<AdvancedSetter :element="elementModel" @update:element="handleElementUpdate" />'
    });

    return mount(Host, {
      global: {
        stubs: {
          BSectionBlock: {
            template: '<section><slot></slot></section>'
          },
          BSectionItem: {
            props: {
              label: {
                type: String,
                default: ''
              }
            },
            template: '<label><span>{{ label }}</span><span class="section-item-label-extra"><slot name="label-extra"></slot></span><slot></slot></label>'
          },
          BSmartInput: defineComponent({
            name: 'BSmartInputStub',
            props: {
              value: {
                type: Object as PropType<BSmartInputValue>,
                required: true
              },
              options: {
                type: Array as PropType<VariableOptionGroup[]>,
                default: (): VariableOptionGroup[] => []
              },
              placeholder: {
                type: String,
                default: ''
              }
            },
            emits: ['update:value'],
            setup(_props, { emit }) {
              /**
               * 将原生 input 事件转换为 BSmartInput 的 value 更新事件。
               * @param event - 原生输入事件
               */
              function handleInput(event: Event): void {
                if (event.target instanceof HTMLInputElement) {
                  emit('update:value', { type: 'literal', value: event.target.value });
                }
              }

              return { handleInput };
            },
            template: '<input class="advanced-setter-source-input" :value="value.value" :placeholder="placeholder" @input="handleInput" />'
          }),
          BInputNumber: defineComponent({
            name: 'BInputNumberStub',
            props: {
              value: {
                type: Number,
                default: null
              },
              disabled: {
                type: Boolean,
                default: false
              },
              placeholder: {
                type: String,
                default: ''
              }
            },
            emits: ['update:value'],
            setup(_props, { emit }) {
              /**
               * 将原生数字输入事件转换为 BInputNumber 的 value 更新事件。
               * @param event - 原生输入事件
               */
              function handleInput(event: Event): void {
                if (event.target instanceof HTMLInputElement) {
                  emit('update:value', Number(event.target.value));
                }
              }

              return { handleInput };
            },
            template: '<input type="number" :value="value" :disabled="disabled" :placeholder="placeholder" @input="handleInput" />'
          })
        }
      }
    });
  }

  it('renders loop source options from element variables', (): void => {
    const element = createWidgetElement();
    const wrapper = mountAdvancedSetter(element);
    const input = wrapper.findComponent({ name: 'BSmartInputStub' });
    const options = input.props('options') as VariableOptionGroup[];
    const variables = readVariables(options).map((item: VariableTreeNode): string => item.value);

    expect(input.props('useTemplateSyntax')).toBeUndefined();
    expect(input.props('placeholder')).toBe('数组数据路径，如 $input.items');
    expect(variables).toContain('$input.items');
    wrapper.unmount();
  });

  it('updates loop config directly through element model', async (): Promise<void> => {
    const element = createWidgetElement();
    const wrapper = mountAdvancedSetter(element);

    wrapper.findComponent({ name: 'ACheckboxStub' }).vm.$emit('update:checked', false);
    await nextTick();

    expect(element.loop).toMatchObject({
      enabled: false,
      itemName: 'item',
      indexName: 'index'
    });

    wrapper.findComponent({ name: 'BSmartInputStub' }).vm.$emit('update:value', createVariableValue('$input.items'));
    await nextTick();

    expect(element.loop).toMatchObject({
      source: createVariableValue('$input.items')
    });
    expect(wrapper.emitted('update:element')).toBeUndefined();
    wrapper.unmount();
  });

  it('updates loop variable names directly through element model', async (): Promise<void> => {
    const element = createWidgetElement();
    const wrapper = mountAdvancedSetter(element);

    await wrapper.find('input[placeholder="默认为：index"]').setValue('item');

    expect(element.loop.indexName).toBe('item');
    wrapper.unmount();
  });

  it('renders loop number controls without stale field classes', (): void => {
    const element = createWidgetElement();
    const wrapper = mountAdvancedSetter(element);

    expect(wrapper.find('.widget-advanced-setter__loop-grid').exists()).toBe(true);
    expect(wrapper.find('.widget-advanced-setter__loop-field').exists()).toBe(false);
    expect(wrapper.find('.widget-advanced-setter__loop-field--columns').exists()).toBe(false);
    expect(wrapper.find('.widget-advanced-setter__loop-field--gap').exists()).toBe(false);
    wrapper.unmount();
  });

  it('toggles auto loop columns from label extra while keeping number input stable', async (): Promise<void> => {
    const element = createWidgetElement();
    const wrapper = mountAdvancedSetter(element);
    const autoCheckbox = wrapper.findAllComponents({ name: 'ACheckboxStub' })[1];
    const columnsInput = wrapper.find('input[placeholder="列数"]');

    expect(autoCheckbox).toBeDefined();
    expect(columnsInput.exists()).toBe(true);
    expect(wrapper.findAll('.section-item-label-extra').some((item): boolean => item.element.contains(autoCheckbox.element))).toBe(true);
    expect(columnsInput.attributes('disabled')).toBeUndefined();
    expect((columnsInput.element as HTMLInputElement).value).toBe('2');

    autoCheckbox.vm.$emit('update:checked', true);
    await nextTick();

    expect(element.loop.autoColumns).toBe(true);
    expect(element.loop.columns).toBe(2);
    expect(columnsInput.attributes('disabled')).toBeDefined();
    expect((columnsInput.element as HTMLInputElement).value).toBe('2');

    autoCheckbox.vm.$emit('update:checked', false);
    await nextTick();

    expect(element.loop.autoColumns).toBe(false);
    expect(element.loop.columns).toBe(2);
    expect(columnsInput.attributes('disabled')).toBeUndefined();
    expect((columnsInput.element as HTMLInputElement).value).toBe('2');
    wrapper.unmount();
  });
});
