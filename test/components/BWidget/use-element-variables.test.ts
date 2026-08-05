/**
 * @file use-element-variables.test.ts
 * @description 验证 BWidget 元素变量 hook 从Widget schema 与JS 脚本生成变量候选。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import type { VueWrapper } from '@vue/test-utils';
import type { Ref } from 'vue';
import { defineComponent, h, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { Variable, VariableOptionGroup } from '@/components/BSmart/types';
import { useElementVariables, type ElementTargetReader, type UseElementVariablesReturn } from '@/components/BWidget/hooks/useElementVariables';
import { provideWidgetContext } from '@/components/BWidget/hooks/useWidgetContext';
import type { WidgetData, WidgetElement, WidgetElementLoopConfig } from '@/components/BWidget/types';
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
        unit: {
          type: 'string',
          description: '温度单位'
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
        'wind-speed': {
          type: 'number',
          description: '风速'
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
        '  "weather-data" = {',
        '    "feels.like": 31',
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
          },
          'weather-data': {
            'feels.like': 31
          }
        }
      }
    },
    elements: []
  };
}

/**
 * 创建测试Widget元素。
 * @param id - 元素 ID
 * @param metadata - 元素元数据
 * @returns 测试元素
 */
function createWidgetElement(
  id: string,
  metadata: WidgetElement['metadata'] = {},
  loop: WidgetElementLoopConfig = createDefaultWidgetElementLoopConfig()
): WidgetElement {
  return {
    id,
    name: 'text',
    label: '文本',
    icon: 'lucide:type',
    title: '文本',
    position: { x: 0, y: 0 },
    size: { width: 120, height: 40 },
    rotation: 0,
    style: {},
    loop,
    metadata
  };
}

/**
 * 创建测试组合元素。
 * @param id - 元素 ID
 * @param metadata - 元素元数据
 * @param children - 子元素
 * @returns 测试组合元素
 */
function createGroupElement(
  id: string,
  metadata: WidgetElement['metadata'],
  children: WidgetElement[],
  loop: WidgetElementLoopConfig = createDefaultWidgetElementLoopConfig()
): WidgetElement {
  return {
    id,
    name: 'group',
    label: '组合',
    icon: 'lucide:group',
    title: '组合',
    position: { x: 0, y: 0 },
    size: { width: 120, height: 80 },
    rotation: 0,
    style: {},
    loop,
    metadata,
    children
  };
}

/**
 * 创建测试循环配置。
 * @returns 循环配置
 */
function createLoopConfig(): WidgetElementLoopConfig {
  return {
    enabled: true,
    source: '$input.products',
    autoColumns: false,
    columns: 2,
    columnGap: 12,
    rowGap: 12,
    itemName: 'item',
    indexName: 'index'
  };
}

/**
 * 创建带数组入参的测试Widget 数据。
 * @param elements - Widget 元素
 * @returns Widget 数据
 */
function createLoopWidgetData(elements: WidgetElement[]): WidgetData {
  const widgetData = createWidgetData();
  widgetData.inputSchema.properties.products = {
    type: 'array',
    description: '商品列表',
    items: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '商品名'
        },
        price: {
          type: 'number',
          description: '价格'
        }
      }
    }
  };
  widgetData.elements = elements;

  return widgetData;
}

/**
 * 读取变量树根节点。
 * @param groups - 变量分组
 * @returns 变量树根节点列表
 */
function readVariableTrees(groups: VariableOptionGroup[]): VariableTreeNode[] {
  return groups.flatMap((group: VariableOptionGroup): VariableTreeNode[] => group.options as VariableTreeNode[]);
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
 * 扁平读取变量值。
 * @param groups - 变量分组
 * @returns 变量值列表
 */
function readVariableValues(groups: VariableOptionGroup[]): string[] {
  return flattenVariableTree(readVariableTrees(groups)).map((item: VariableTreeNode): string => item.value);
}

/**
 * 扁平读取变量标签。
 * @param groups - 变量分组
 * @returns 变量标签列表
 */
function readVariableLabels(groups: VariableOptionGroup[]): string[] {
  return flattenVariableTree(readVariableTrees(groups)).map((item: VariableTreeNode): string => item.label);
}

/**
 * 扁平读取变量选项。
 * @param groups - 变量分组
 * @returns 变量选项列表
 */
function readVariables(groups: VariableOptionGroup[]): VariableTreeNode[] {
  return flattenVariableTree(readVariableTrees(groups));
}

/**
 * 按变量值查找变量节点。
 * @param groups - 变量分组
 * @param value - 变量值
 * @returns 匹配到的变量节点
 */
function findVariable(groups: VariableOptionGroup[], value: string): VariableTreeNode | undefined {
  return readVariables(groups).find((item: VariableTreeNode): boolean => item.value === value);
}

/**
 * 挂载使用 Widget 上下文的变量 hook。
 */
interface MountedElementVariables extends UseElementVariablesReturn {
  /** 测试组件包装器 */
  wrapper: VueWrapper;
}

/**
 * 挂载元素变量 hook 消费组件。
 * @param widgetData - Widget 数据引用
 * @param readElement - Widget 元素读取函数
 * @returns hook 返回值和包装器
 */
function mountElementVariables(widgetData: Ref<WidgetData | undefined>, readElement?: ElementTargetReader): MountedElementVariables {
  const variablesResultRef: { value?: UseElementVariablesReturn } = {};
  const selectedElementIds = ref<string[]>([]);
  const Consumer = defineComponent({
    name: 'ElementVariablesConsumer',
    setup(): () => ReturnType<typeof h> {
      variablesResultRef.value = useElementVariables(readElement);

      return (): ReturnType<typeof h> => h('span');
    }
  });
  const Provider = defineComponent({
    name: 'ElementVariablesProvider',
    setup(): () => ReturnType<typeof h> {
      provideWidgetContext({
        widgetData,
        selectedElementIds
      });

      return (): ReturnType<typeof h> => h(Consumer);
    }
  });
  const wrapper = mount(Provider);
  const initializedResult = variablesResultRef.value;
  if (!initializedResult) {
    throw new Error('Element variables hook was not initialized');
  }

  return {
    loopSourceOptions: initializedResult.loopSourceOptions,
    variableOptions: initializedResult.variableOptions,
    wrapper
  };
}

describe('useElementVariables', (): void => {
  it('reads widget data from injected widget context without explicit source', (): void => {
    const widgetData = ref<WidgetData | undefined>(createWidgetData());
    const { variableOptions, wrapper } = mountElementVariables(widgetData);
    const values = readVariableValues(variableOptions.value);

    expect(values).toContain('$input.city');
    expect(values).toContain('weather.temperature');
    wrapper.unmount();
  });

  it('provides variables from input schema and execute data updates', (): void => {
    const widgetDataRef = ref<WidgetData | undefined>(createWidgetData());
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef);
    const values = readVariableValues(variableOptions.value);
    const labels = readVariableLabels(variableOptions.value);

    expect(values).toContain('$input.city');
    expect(values).toContain('$input.unit');
    expect(values).toContain('$input.user');
    expect(values).toContain('$input.user.name');
    expect(values).toContain('$input["wind-speed"]');
    expect(values).toContain('$input.weather.temperature');
    expect(values).toContain('weather');
    expect(values).toContain('weather.temperature');
    expect(values).toContain('["weather-data"]["feels.like"]');
    expect(values).not.toContain('data');
    expect(values).not.toContain('data.weather.temperature');
    expect(values).not.toContain('output');
    expect(values).not.toContain(REMOVED_LEGACY_ROOT);
    expect(labels).toContain('城市名称');
    expect(labels).toContain('温度单位');
    expect(labels).toContain('用户');
    expect(labels).toContain('用户名');
    expect(labels).toContain('温度');
    wrapper.unmount();
  });

  it('nests object children under selectable parent variables', (): void => {
    const widgetDataRef = ref<WidgetData | undefined>(createWidgetData());
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef);
    const roots = readVariableTrees(variableOptions.value);
    const inputVariable = findVariable(variableOptions.value, '$input');
    const userVariable = findVariable(variableOptions.value, '$input.user');
    const weatherVariable = findVariable(variableOptions.value, 'weather');

    expect(roots.map((item: VariableTreeNode): string => item.value)).toEqual(['$input', '$output', 'weather', '["weather-data"]']);
    expect(inputVariable?.label).toBe('入参');
    expect(inputVariable?.children?.map((item: VariableTreeNode): string => item.value)).toEqual([
      '$input.city',
      '$input.unit',
      '$input.user',
      '$input["wind-speed"]',
      '$input.weather'
    ]);
    expect(userVariable).toMatchObject({
      label: '用户',
      value: '$input.user',
      children: [
        {
          label: '用户名',
          value: '$input.user.name'
        }
      ]
    });
    expect(weatherVariable).toMatchObject({
      label: '',
      value: 'weather',
      children: [
        {
          label: '',
          value: 'weather.temperature'
        }
      ]
    });
    wrapper.unmount();
  });

  it('does not duplicate variable paths in the description field', (): void => {
    const widgetDataRef = ref<WidgetData | undefined>(createWidgetData());
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef);
    const variables = readVariables(variableOptions.value);
    const cityVariable = variables.find((item: Variable): boolean => item.value === '$input.city');
    const temperatureVariable = variables.find((item: Variable): boolean => item.value === 'weather.temperature');

    expect(cityVariable).toEqual({
      label: '城市名称',
      value: '$input.city'
    });
    expect(temperatureVariable).toEqual({
      label: '',
      value: 'weather.temperature'
    });
    expect(variables.filter((item: Variable): boolean => item.description === item.value)).toEqual([]);
    wrapper.unmount();
  });

  it('ignores manually declared data schema when execute code defines data', (): void => {
    const widgetDataRef = ref<WidgetData | undefined>({
      ...createWidgetData(),
      dataSchema: {
        type: 'object',
        properties: {
          stale: {
            type: 'string',
            description: '旧数据'
          }
        }
      }
    });
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef);
    const values = readVariableValues(variableOptions.value);

    expect(values).toContain('weather.temperature');
    expect(values).not.toContain('stale');
    wrapper.unmount();
  });

  it('uses default execute code to provide default data variables when execute config is missing', (): void => {
    const widgetData: Partial<WidgetData> = createWidgetData();
    delete widgetData.execute;
    const widgetDataRef = ref<WidgetData | undefined>(widgetData as WidgetData);
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef);
    const values = readVariableValues(variableOptions.value);

    expect(values).toContain('$input');
    expect(values).not.toContain('data');
    wrapper.unmount();
  });

  it('provides item and index variables for a loop-enabled element', (): void => {
    const loopElement = createWidgetElement('text-1', {}, createLoopConfig());
    const widgetDataRef = ref<WidgetData | undefined>(createLoopWidgetData([loopElement]));
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef, (): WidgetElement => loopElement);
    const values = readVariableValues(variableOptions.value);
    const itemVariable = findVariable(variableOptions.value, 'item');

    expect(values).toContain('item');
    expect(values).toContain('item.name');
    expect(values).toContain('item.price');
    expect(values).toContain('index');
    expect(itemVariable?.children?.map((item: VariableTreeNode): string => item.value)).toEqual(['item.name', 'item.price']);
    wrapper.unmount();
  });

  it('hides loop variables when loop source is empty', (): void => {
    const loopElement = createWidgetElement('text-1', {}, { ...createLoopConfig(), source: '' });
    const widgetDataRef = ref<WidgetData | undefined>(createLoopWidgetData([loopElement]));
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef, (): WidgetElement => loopElement);
    const values = readVariableValues(variableOptions.value);

    expect(values).not.toContain('item');
    expect(values).not.toContain('index');
    wrapper.unmount();
  });

  it('hides loop variables when loop source points to a non-array field', (): void => {
    const loopElement = createWidgetElement('text-1', {}, { ...createLoopConfig(), source: '$input.city' });
    const widgetDataRef = ref<WidgetData | undefined>(createLoopWidgetData([loopElement]));
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef, (): WidgetElement => loopElement);
    const values = readVariableValues(variableOptions.value);

    expect(values).not.toContain('item');
    expect(values).not.toContain('index');
    wrapper.unmount();
  });

  it('provides group loop variables to elements covered by the same group context', (): void => {
    const groupChild = createWidgetElement('text-1');
    const loopContextGroup = createGroupElement('group-1', {}, [groupChild], createLoopConfig());
    const widgetDataRef = ref<WidgetData | undefined>(createLoopWidgetData([loopContextGroup]));
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef, (): WidgetElement => groupChild);
    const values = readVariableValues(variableOptions.value);

    expect(values).toContain('item.name');
    expect(values).toContain('index');
    wrapper.unmount();
  });

  it('hides inherited loop variables when group loop source is invalid', (): void => {
    const groupChild = createWidgetElement('text-1');
    const loopContextGroup = createGroupElement('group-1', {}, [groupChild], { ...createLoopConfig(), source: '$input.city' });
    const widgetDataRef = ref<WidgetData | undefined>(createLoopWidgetData([loopContextGroup]));
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef, (): WidgetElement => groupChild);
    const values = readVariableValues(variableOptions.value);

    expect(values).not.toContain('item');
    expect(values).not.toContain('index');
    wrapper.unmount();
  });

  it('uses nearest enabled loop context for nested group elements', (): void => {
    const leafElement = createWidgetElement('text-1');
    const innerLoopGroup = createGroupElement('group-inner', {}, [leafElement], {
      ...createLoopConfig(),
      itemName: 'innerItem',
      indexName: 'innerIndex'
    });
    const outerLoopGroup = createGroupElement('group-outer', {}, [innerLoopGroup], {
      ...createLoopConfig(),
      itemName: 'outerItem',
      indexName: 'outerIndex'
    });
    const widgetDataRef = ref<WidgetData | undefined>(createLoopWidgetData([outerLoopGroup]));
    const { variableOptions, wrapper } = mountElementVariables(widgetDataRef, (): WidgetElement => leafElement);
    const values = readVariableValues(variableOptions.value);

    expect(values).toContain('innerItem.name');
    expect(values).toContain('innerIndex');
    expect(values).not.toContain('outerItem.name');
    expect(values).not.toContain('outerIndex');
    wrapper.unmount();
  });

  it('provides loop source options from input and inferred data schema', (): void => {
    const widgetDataRef = ref<WidgetData | undefined>(createLoopWidgetData([]));
    const { loopSourceOptions, wrapper } = mountElementVariables(widgetDataRef);

    expect(loopSourceOptions.value).toEqual([
      {
        label: '商品列表',
        value: '$input.products'
      }
    ]);
    wrapper.unmount();
  });

  it('falls back to root variables when widget data is not ready', (): void => {
    const widgetDataRef = ref<WidgetData | undefined>();
    const { loopSourceOptions, variableOptions, wrapper } = mountElementVariables(widgetDataRef);

    expect(readVariableValues(variableOptions.value)).toEqual(['$input', '$output']);
    expect(loopSourceOptions.value).toEqual([]);
    wrapper.unmount();
  });
});
