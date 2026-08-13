/**
 * @file text-setter.component.test.ts
 * @description 验证 BWidget 文本元素 Setter 使用单个 Prompt 编辑器编辑静态文本与动态变量。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent, ref } from 'vue';
import type { PropType, Ref } from 'vue';
import { mount, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { BSmartValue, Variable, VariableOptionGroup } from '@/components/BSmart/types';
import { createLiteralValue } from '@/components/BSmart/utils/value';
import TextSetter from '@/components/BWidget/elements/Text/Setter.vue';
import { provideWidgetContext } from '@/components/BWidget/hooks/useWidgetContext';
import type { WidgetData, WidgetElement } from '@/components/BWidget/types';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';

/** 已移除的旧根变量名。 */
const REMOVED_LEGACY_ROOT = ['last', 'Result'].join('');

/**
 * 测试用变量树节点。
 */
interface VariableTreeNode extends Variable {
  /** 子级变量节点 */
  children?: VariableTreeNode[];
}

/**
 * 创建测试文本元素。
 * @returns 测试文本元素
 */
function createTextElement(): WidgetElement {
  return {
    id: 'text-1',
    name: 'text',
    label: '文本',
    icon: 'lucide:type',
    title: '文本名称',
    position: { x: 0, y: 0 },
    size: { width: 100, height: 24 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {
      content: '原始内容'
    }
  };
}

/**
 * 创建测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createWidgetData(): WidgetData {
  return {
    name: 'weather',
    description: '天气 Widget',
    inputSchema: {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          description: '城市名称'
        },
        user: {
          type: 'object',
          description: '用户',
          properties: {
            name: {
              type: 'string',
              description: '用户名'
            }
          }
        },
        weather: {
          type: 'object',
          description: '天气输入',
          properties: {
            temperature: {
              type: 'number',
              description: '温度'
            }
          },
          required: []
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
      code: [
        'export default class Weather extends Widget {',
        '  weather = {',
        '    temperature: 0',
        '  }',
        '',
        '  async onMounted() {',
        '    this.weather.temperature = this.$input.weather.temperature',
        '  }',
        '}'
      ].join('\n')
    },
    metadata: {
      previewContext: {
        input: {
          city: '上海'
        },
        output: undefined,
        data: {
          weather: {
            temperature: 28
          }
        }
      }
    },
    elements: []
  };
}

/**
 * 创建测试循环配置。
 * @param source - 循环数据源路径
 * @returns 循环配置
 */
function createLoopConfig(source: BSmartValue<string> = createLiteralValue('')): WidgetElement['loop'] {
  return {
    enabled: true,
    source,
    autoColumns: false,
    columns: 1,
    columnGap: 12,
    rowGap: 12,
    itemName: '',
    indexName: ''
  };
}

/**
 * 挂载文本 Setter。
 * @param element - 文本元素
 * @param widgetData - Widget 数据
 * @returns 组件包装器
 */
function mountTextSetter(element: WidgetElement, widgetData: WidgetData = createWidgetData()): VueWrapper {
  const Host = defineComponent({
    name: 'TextSetterHost',
    components: {
      TextSetter
    },
    setup(): { elementModel: Ref<WidgetElement> } {
      const elementModel = ref<WidgetElement>(element);
      const widgetDataRef = ref<WidgetData | undefined>(widgetData);
      const selectedElementIds = ref<string[]>([element.id]);

      provideWidgetContext({
        widgetData: widgetDataRef,
        selectedElementIds
      });

      return { elementModel };
    },
    template: '<TextSetter v-model:element="elementModel" />'
  });

  return mount(Host, {
    global: {
      components: {
        BSectionBlock: defineComponent({
          name: 'BSectionBlockStub',
          props: {
            title: {
              type: String,
              required: true
            }
          },
          template: '<section class="widget-text-setter-stub" :data-title="title"><slot></slot></section>'
        }),
        BSectionItem: defineComponent({
          name: 'BSectionItemStub',
          props: {
            label: {
              type: String,
              default: undefined
            }
          },
          template: '<div class="widget-text-setter-stub-item" :data-label="label"><slot></slot></div>'
        }),
        BInputNumber: defineComponent({
          name: 'BInputNumberStub',
          props: {
            value: {
              type: Number,
              default: undefined
            },
            min: {
              type: Number,
              default: undefined
            },
            max: {
              type: Number,
              default: undefined
            },
            precision: {
              type: Number,
              default: undefined
            },
            allowClear: {
              type: Boolean,
              default: false
            },
            placeholder: {
              type: String,
              default: undefined
            }
          },
          emits: {
            /**
             * 更新数字值；清空时传入 null 与 BInputNumber allow-clear 行为一致。
             * @param value - 新值
             * @returns 是否允许触发事件
             */
            'update:value': (value: number | null): boolean => value === null || typeof value === 'number'
          },
          template: `
            <input
              class="widget-text-setter-stub-max-lines"
              type="number"
              :value="value === undefined ? '' : value"
              @input="$emit('update:value', $event.target.value === '' ? null : Number($event.target.value))"
            />
          `
        }),
        BSmartEditor: defineComponent({
          name: 'BSmartEditorStub',
          props: {
            value: {
              type: String,
              default: ''
            },
            options: {
              type: Array as PropType<VariableOptionGroup[]>,
              default: (): VariableOptionGroup[] => []
            }
          },
          emits: {
            /**
             * 更新编辑器文本。
             * @param value - 新文本
             * @returns 是否允许触发事件
             */
            'update:value': (value: string): boolean => typeof value === 'string'
          },
          template: '<textarea class="text-setter-prompt-editor" :value="value" @input="$emit(\'update:value\', $event.target.value)"></textarea>'
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

describe('Text Setter', (): void => {
  it('edits static text and binding expression with one prompt editor', async (): Promise<void> => {
    const element = createTextElement();
    const wrapper = mountTextSetter(element);
    const editor = wrapper.findComponent({ name: 'BSmartEditorStub' });

    expect(wrapper.find('.widget-text-setter-stub').attributes('data-title')).toBe('内容');
    expect(wrapper.findAllComponents({ name: 'BSmartEditorStub' })).toHaveLength(1);
    expect(editor.props('value')).toBe('原始内容');

    await wrapper.find('.text-setter-prompt-editor').setValue('{{ $input.city }} 当前 {{ weather.temperature }}°C');

    expect(element.title).toBe('文本名称');
    expect(element.metadata.content).toBe('{{ $input.city }} 当前 {{ weather.temperature }}°C');
    wrapper.unmount();
  });

  it('keeps unrelated metadata when editing the unified content value', async (): Promise<void> => {
    const element = createTextElement();
    element.metadata.helperText = '温度辅助信息';
    const wrapper = mountTextSetter(element);
    const editor = wrapper.findComponent({ name: 'BSmartEditorStub' });

    expect(editor.props('value')).toBe('原始内容');

    await wrapper.find('.text-setter-prompt-editor').setValue('温度：{{ weather.temperature }}°C');

    expect(element.metadata.content).toBe('温度：{{ weather.temperature }}°C');
    expect(element.metadata.helperText).toBe('温度辅助信息');
    wrapper.unmount();
  });

  it('uses an empty editor value when metadata content is missing', (): void => {
    const element = createTextElement();
    delete element.metadata.content;
    const wrapper = mountTextSetter(element);
    const editor = wrapper.findComponent({ name: 'BSmartEditorStub' });

    expect(editor.props('value')).toBe('');
    wrapper.unmount();
  });

  it('provides widget context variables to the prompt editor', (): void => {
    const wrapper = mountTextSetter(createTextElement());
    const editor = wrapper.findComponent({ name: 'BSmartEditorStub' });
    const options = editor.props('options') as VariableOptionGroup[];
    const rootVariables = options.flatMap((group: VariableOptionGroup): string[] => group.options.map((item): string => item.value));
    const variables = readVariables(options).map((item: VariableTreeNode): string => item.value);
    const labels = readVariables(options).map((item: VariableTreeNode): string => item.label);

    expect(rootVariables).toEqual(['$input', '$output', 'weather']);
    expect(variables).toContain('$input.city');
    expect(variables).toContain('$input.user');
    expect(variables).toContain('$input.user.name');
    expect(variables).toContain('weather.temperature');
    expect(variables).not.toContain('data');
    expect(variables).not.toContain('data.weather.temperature');
    expect(variables).not.toContain('output.condition');
    expect(variables).not.toContain(REMOVED_LEGACY_ROOT);
    expect(labels).toContain('入参');
    expect(labels).toContain('城市名称');
    expect(labels).toContain('用户');
    expect(labels).toContain('用户名');
    expect(labels).toContain('温度');
    wrapper.unmount();
  });

  it('does not provide loop variables when the selected text element has no array loop source', (): void => {
    const element = createTextElement();
    element.loop = createLoopConfig();
    const widgetData = createWidgetData();
    widgetData.elements = [element];
    const wrapper = mountTextSetter(element, widgetData);
    const editor = wrapper.findComponent({ name: 'BSmartEditorStub' });
    const options = editor.props('options') as VariableOptionGroup[];
    const variables = readVariables(options).map((item: VariableTreeNode): string => item.value);

    expect(variables).not.toContain('item');
    expect(variables).not.toContain('index');
    wrapper.unmount();
  });

  it('writes maxLines to metadata when the number input changes', async (): Promise<void> => {
    const element = createTextElement();
    const wrapper = mountTextSetter(element);
    const maxLinesItem = wrapper.find('.widget-text-setter-stub-item[data-label="最大行数"]');
    const input = maxLinesItem.find('.widget-text-setter-stub-max-lines');

    await input.setValue(3);

    expect(element.metadata.maxLines).toBe(3);
    wrapper.unmount();
  });

  it('keeps the cleared maxLines value from the number input', async (): Promise<void> => {
    const element = createTextElement();
    element.metadata.maxLines = 5;
    const wrapper = mountTextSetter(element);
    const input = wrapper.find('.widget-text-setter-stub-max-lines');

    await input.setValue('');

    expect(element.metadata.maxLines).toBeNull();
    wrapper.unmount();
  });

  it('initializes the number input with the existing metadata maxLines', async (): Promise<void> => {
    const element = createTextElement();
    element.metadata.maxLines = 7;
    const wrapper = mountTextSetter(element);
    const input = wrapper.find('.widget-text-setter-stub-max-lines');

    expect((input.element as HTMLInputElement).value).toBe('7');
    wrapper.unmount();
  });

  it('leaves the number input empty when metadata has no maxLines', (): void => {
    const element = createTextElement();
    const wrapper = mountTextSetter(element);
    const input = wrapper.find('.widget-text-setter-stub-max-lines');

    expect((input.element as HTMLInputElement).value).toBe('');
    wrapper.unmount();
  });

  it('preserves unrelated metadata when updating maxLines', async (): Promise<void> => {
    const element = createTextElement();
    element.metadata.helperText = '温度辅助信息';
    const wrapper = mountTextSetter(element);
    const input = wrapper.find('.widget-text-setter-stub-max-lines');

    await input.setValue(2);

    expect(element.metadata.maxLines).toBe(2);
    expect(element.metadata.content).toBe('原始内容');
    expect(element.metadata.helperText).toBe('温度辅助信息');
    wrapper.unmount();
  });
});
