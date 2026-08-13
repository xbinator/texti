/**
 * @file button-setter.component.test.ts
 * @description 验证 BWidget 按钮元素 Setter 编辑文本并提供变量候选。
 * @vitest-environment jsdom
 */
import { defineComponent, ref } from 'vue';
import type { PropType, Ref } from 'vue';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { BSmartInputValue, BSmartValue, Variable, VariableOptionGroup } from '@/components/BSmart/types';
import { createLiteralValue, createVariableValue, isSmartValue } from '@/components/BSmart/utils/value';
import ButtonSetter from '@/components/BWidget/elements/Button/Setter.vue';
import { buttonElementSchema } from '@/components/BWidget/elements/Button/schema';
import { provideWidgetContext } from '@/components/BWidget/hooks/useWidgetContext';
import type { WidgetData, WidgetElement } from '@/components/BWidget/types';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';

/**
 * 测试用变量树节点。
 */
interface VariableTreeNode extends Variable {
  /** 子级变量节点 */
  children?: VariableTreeNode[];
}

/**
 * 创建测试按钮元素。
 * @returns 测试按钮元素
 */
function createButtonElement(): WidgetElement {
  return {
    id: 'button-1',
    name: 'button',
    label: '按钮',
    icon: 'lucide:mouse-pointer-click',
    title: '按钮名称',
    position: { x: 0, y: 0 },
    size: { width: 120, height: 40 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {
      actions: [],
      disabled: createLiteralValue(false),
      loading: createLiteralValue(false),
      text: createLiteralValue('确认')
    }
  };
}

/**
 * 创建测试 Widget 数据。
 * @param element - 当前按钮元素
 * @returns 测试 Widget 数据
 */
function createWidgetData(element: WidgetElement): WidgetData {
  return {
    name: 'button-widget',
    description: '按钮 Widget',
    inputSchema: {
      type: 'object',
      properties: {
        orderId: {
          type: 'string',
          description: '订单号'
        }
      }
    },
    outputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    dataSchema: {
      type: 'object',
      properties: {}
    },
    execute: {
      code: ['export default class ButtonWidget extends Widget {', '  buttonByClick(orderId) {}', '  onMounted() {}', '}'].join('\n')
    },
    metadata: {
      previewContext: {
        input: {
          orderId: 'A-1024'
        },
        output: undefined,
        data: {}
      }
    },
    elements: [element]
  };
}

/**
 * 挂载按钮 Setter。
 * @param element - 按钮元素
 * @returns 组件包装器
 */
function mountButtonSetter(element: WidgetElement): VueWrapper {
  const Host = defineComponent({
    name: 'ButtonSetterHost',
    components: {
      ButtonSetter
    },
    setup(): { elementModel: Ref<WidgetElement> } {
      const elementModel = ref<WidgetElement>(element);
      const widgetDataRef = ref<WidgetData | undefined>(createWidgetData(element));
      const selectedElementIds = ref<string[]>([element.id]);

      provideWidgetContext({
        widgetData: widgetDataRef,
        selectedElementIds
      });

      return { elementModel };
    },
    template: '<ButtonSetter v-model:element="elementModel" />'
  });

  return mount(Host, {
    global: {
      components: {
        BSectionBlock: defineComponent({
          name: 'BSectionBlockStub',
          props: {
            title: { type: String, required: true },
            labelMinWidth: { type: [String, Number], default: undefined }
          },
          template: '<section class="widget-button-setter-stub" :data-title="title" :data-label-min-width="labelMinWidth"><slot></slot></section>'
        }),
        BSectionItem: defineComponent({
          name: 'BSectionItemStub',
          props: {
            label: { type: String, default: undefined }
          },
          template: '<div class="widget-button-setter-stub-item" :data-label="label"><slot></slot></div>'
        }),
        BSmartInput: defineComponent({
          name: 'BSmartInputStub',
          props: {
            value: { type: Object as PropType<BSmartInputValue>, required: true },
            options: {
              type: Array as PropType<VariableOptionGroup[]>,
              default: (): VariableOptionGroup[] => []
            },
            placeholder: { type: String, default: undefined }
          },
          emits: {
            /**
             * 更新输入文本。
             * @param value - 新结构化输入值
             * @returns 是否允许触发事件
             */
            'update:value': (value: BSmartInputValue): boolean => isSmartValue(value)
          },
          template: `
            <input
              class="widget-button-setter-stub-smart-input"
              :data-placeholder="placeholder"
              :value="value.value"
              @input="$emit('update:value', { type: 'literal', value: $event.target.value })"
            />
          `
        }),
        BSmartSelect: defineComponent({
          name: 'BSmartSelectStub',
          props: {
            value: { type: Object as PropType<BSmartValue<boolean>>, default: undefined },
            options: {
              type: Array as PropType<Array<{ label: string; value: boolean | string }>>,
              default: (): Array<{ label: string; value: boolean | string }> => []
            },
            variables: {
              type: Array as PropType<VariableOptionGroup[]>,
              default: (): VariableOptionGroup[] => []
            }
          },
          emits: {
            /**
             * 更新静态值或变量引用。
             * @param value - 新结构化选择值
             * @returns 是否允许触发事件
             */
            'update:value': (value: BSmartValue<boolean>): boolean => isSmartValue(value)
          },
          template: `
            <div class="widget-button-setter-stub-smart-select">
              <button
                v-for="item in options"
                :key="String(item.value)"
                class="widget-button-setter-stub-smart-select-option"
                :data-option-label="item.label"
                type="button"
                @click="$emit('update:value', { type: 'literal', value: item.value })"
              >
                {{ item.label }}
              </button>
              <button
                class="widget-button-setter-stub-smart-select-variable"
                type="button"
                @click="$emit('update:value', { type: 'variable', value: 'loading' })"
              >
                变量
              </button>
            </div>
          `
        }),
        BSmartMethod: defineComponent({
          name: 'BSmartMethodStub',
          props: {
            value: {
              type: Array as PropType<Array<{ args: BSmartValue<string>[]; method: string }>>,
              default: (): Array<{ args: BSmartValue<string>[]; method: string }> => []
            },
            methods: {
              type: Array as PropType<Array<{ label: string; parameters?: string[]; value: string }>>,
              default: (): Array<{ label: string; parameters?: string[]; value: string }> => []
            },
            variables: {
              type: Array as PropType<VariableOptionGroup[]>,
              default: (): VariableOptionGroup[] => []
            }
          },
          emits: {
            /**
             * 更新动作配置。
             * @param value - 新动作配置
             * @returns 是否允许触发事件
             */
            'update:value': (value: Array<{ args: BSmartValue<string>[]; method: string }>): boolean =>
              value.every((action: { args: BSmartValue<string>[]; method: string }): boolean => typeof action.method === 'string' && Array.isArray(action.args))
          },
          template: `
            <button
              class="widget-button-setter-stub-method"
              type="button"
              @click="$emit('update:value', [{ method: 'buttonByClick', args: [{ type: 'variable', value: '$input.orderId' }] }])"
            >
              动作设置
            </button>
          `
        })
      }
    }
  });
}

/**
 * 扁平化变量树。
 * @param variables - 变量树节点列表
 * @returns 扁平变量节点列表
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

/**
 * 按设置项标签和选项标签查找变量下拉选项。
 * @param wrapper - 组件包装器
 * @param label - 设置项标签
 * @param optionLabel - 选项标签
 * @returns 选项按钮包装器
 */
function findTextSelectOptionByLabel(wrapper: VueWrapper, label: string, optionLabel: string): DOMWrapper<Element> {
  return wrapper.find(`[data-label="${label}"] .widget-button-setter-stub-smart-select-option[data-option-label="${optionLabel}"]`);
}

/**
 * 按设置项标签查找变量覆盖按钮。
 * @param wrapper - 组件包装器
 * @param label - 设置项标签
 * @returns 变量覆盖按钮包装器
 */
function findTextSelectVariableByLabel(wrapper: VueWrapper, label: string): DOMWrapper<Element> {
  return wrapper.find(`[data-label="${label}"] .widget-button-setter-stub-smart-select-variable`);
}

/**
 * 按 placeholder 查找文本输入框。
 * @param wrapper - 组件包装器
 * @param placeholder - 输入框 placeholder
 * @returns 文本输入框包装器
 */
function findInputByPlaceholder(wrapper: VueWrapper, placeholder: string): DOMWrapper<Element> {
  return wrapper.find(`.widget-button-setter-stub-smart-input[data-placeholder="${placeholder}"]`);
}

describe('Button Setter', (): void => {
  it('defines structured Smart defaults in the button schema', (): void => {
    expect(buttonElementSchema.metadata?.text).toEqual(createLiteralValue('按钮'));
    expect(buttonElementSchema.metadata?.disabled).toEqual(createLiteralValue(false));
    expect(buttonElementSchema.metadata?.loading).toEqual(createLiteralValue(false));
  });

  it('writes text to metadata when the label input changes', async (): Promise<void> => {
    const element = createButtonElement();
    const wrapper = mountButtonSetter(element);
    const input = findInputByPlaceholder(wrapper, '按钮文字');

    await input.setValue('确认订单');

    expect(element.metadata.text).toEqual(createLiteralValue('确认订单'));
    wrapper.unmount();
  });

  it('uses a compact 60px label width for button settings', (): void => {
    const wrapper = mountButtonSetter(createButtonElement());
    const section = wrapper.find('.widget-button-setter-stub');

    expect(section.attributes('data-label-min-width')).toBe('60');
    wrapper.unmount();
  });

  it('does not render button size controls', (): void => {
    const wrapper = mountButtonSetter(createButtonElement());

    expect(wrapper.find('[data-label="尺寸"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('writes button behavior metadata from controls', async (): Promise<void> => {
    const element = createButtonElement();
    const wrapper = mountButtonSetter(element);

    await findTextSelectOptionByLabel(wrapper, '状态', '禁用').trigger('click');
    await findTextSelectVariableByLabel(wrapper, '加载').trigger('click');
    wrapper.findComponent({ name: 'BSmartMethodStub' }).vm.$emit('update:value', [
      { method: 'buttonByClick', args: [createVariableValue('$input.orderId')] }
    ]);

    expect(element.metadata.disabled).toEqual(createLiteralValue(true));
    expect(element.metadata.loading).toEqual(createVariableValue('loading'));
    expect(element.metadata.actions).toEqual([
      {
        args: [createVariableValue('$input.orderId')],
        method: 'buttonByClick'
      }
    ]);
    expect(element.metadata.size).toBeUndefined();
    wrapper.unmount();
  });

  it('passes script public methods to the action modal', (): void => {
    const wrapper = mountButtonSetter(createButtonElement());
    const method = wrapper.findComponent({ name: 'BSmartMethodStub' });
    const methods = method.props('methods') as Array<{ parameters?: string[]; value: string }>;

    expect(methods).toEqual([
      {
        label: 'buttonByClick',
        parameters: ['orderId'],
        value: 'buttonByClick'
      }
    ]);
    wrapper.unmount();
  });

  it('provides widget variables to the text input', (): void => {
    const wrapper = mountButtonSetter(createButtonElement());
    const input = wrapper.findComponent({ name: 'BSmartInputStub' });
    const options = input.props('options') as VariableOptionGroup[];
    const variables = readVariables(options).map((item: VariableTreeNode): string => item.value);

    expect(input.props('placeholder')).toBe('按钮文字');
    expect(variables).toContain('$input.orderId');
    wrapper.unmount();
  });
});
