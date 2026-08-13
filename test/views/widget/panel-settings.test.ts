/**
 * @file panel-settings.test.ts
 * @description 验证Widget 右侧设置面板会在属性页签渲染元素专属 Setter。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent } from 'vue';
import type { PropType } from 'vue';
import { config, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetData, WidgetElement, WidgetElementLoopConfig } from '@/components/BWidget/types';
import { createVariableValue } from '@/components/BSmart/utils/value';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';
import PanelSettings from '@/views/widget/components/PanelSettings.vue';

vi.mock('ant-design-vue', () => ({
  Tabs: defineComponent({
    name: 'ATabsStub',
    template: '<div class="settings-tabs-stub"><slot></slot></div>'
  }),
  TabPane: defineComponent({
    name: 'ATabPaneStub',
    props: {
      tab: {
        type: String,
        required: true
      }
    },
    template: '<section :data-tab="tab"><slot></slot></section>'
  }),
  Input: defineComponent({
    name: 'AInputStub',
    props: {
      value: {
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
    template: '<input :value="value" @input="handleInput" />'
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
    template: '<input type="number" :value="value" @input="handleInput" />'
  }),
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
  })
}));

vi.mock('@/views/widget/components/DesignSetter.vue', () => ({
  default: defineComponent({
    name: 'DesignSetterStub',
    template: '<div class="design-setter-stub"></div>'
  })
}));

vi.mock('@/views/widget/components/PageSetter.vue', () => ({
  default: defineComponent({
    name: 'PageSetterStub',
    props: {
      value: {
        type: Object as PropType<WidgetData>,
        required: true
      },
      metadata: {
        type: Object,
        required: true
      }
    },
    emits: ['update:value'],
    setup(props, { emit }) {
      /**
       * 模拟 PageSetter 修改Widget 配置后发出完整 WidgetData。
       */
      function emitWidgetDataChange(): void {
        emit('update:value', {
          ...props.value,
          name: 'page_tool'
        });
      }

      return { emitWidgetDataChange };
    },
    template: '<button class="page-setter-forward" @click="emitWidgetDataChange"></button>'
  })
}));

/** 测试前原始全局 stub 配置。 */
const originalGlobalStubs = config.global.stubs;

/** 面板测试中自动注册组件的最小可交互替身。 */
const panelGlobalStubs = {
  AInput: defineComponent({
    name: 'AInputStub',
    props: {
      value: {
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
    template: '<input :value="value" @input="handleInput" />'
  }),
  BButton: defineComponent({
    name: 'BButtonStub',
    props: {
      icon: {
        type: String,
        default: ''
      }
    },
    template: '<button type="button" :data-icon="icon"><slot></slot></button>'
  }),
  BColorPicker: defineComponent({
    name: 'BColorPickerStub',
    props: {
      value: {
        type: String,
        default: ''
      }
    },
    emits: ['update:value'],
    setup(_props, { emit }) {
      /**
       * 将原生 input 事件转换为 BColorPicker 的 value 更新事件。
       * @param event - 原生输入事件
       */
      function handleInput(event: Event): void {
        if (event.target instanceof HTMLInputElement) {
          emit('update:value', event.target.value);
        }
      }

      return { handleInput };
    },
    template: '<input type="color" :value="value || \'#000000\'" @input="handleInput" />'
  }),
  BIcon: defineComponent({
    name: 'BIconStub',
    props: {
      icon: {
        type: String,
        default: ''
      }
    },
    template: '<span :data-icon="icon"></span>'
  }),
  BInputNumber: defineComponent({
    name: 'BInputNumberStub',
    props: {
      value: {
        type: [Number, String],
        default: undefined
      },
      placeholder: {
        type: String,
        default: ''
      }
    },
    emits: ['update:value', 'change'],
    setup(_props, { emit }) {
      /**
       * 将原生数字输入事件转换为 BInputNumber 的更新事件。
       * @param event - 原生输入事件
       */
      function handleInput(event: Event): void {
        if (!(event.target instanceof HTMLInputElement)) {
          return;
        }

        const value = Number(event.target.value);
        emit('update:value', value);
        emit('change', value);
      }

      return { handleInput };
    },
    template: '<input type="number" :value="value" :placeholder="placeholder" @input="handleInput" />'
  }),
  BSectionBlock: defineComponent({
    name: 'BSectionBlockStub',
    props: {
      title: {
        type: String,
        required: true
      }
    },
    template: '<section class="b-section-block-stub" :data-title="title"><slot></slot></section>'
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
    template: '<label class="b-section-item-stub" :data-label="label" :data-icon="icon"><slot></slot></label>'
  }),
  BSelect: defineComponent({
    name: 'BSelectStub',
    props: {
      value: {
        type: [String, Number],
        default: undefined
      },
      options: {
        type: Array as PropType<Array<{ value: string | number; label: string }>>,
        default: (): Array<{ value: string | number; label: string }> => []
      }
    },
    emits: ['update:value', 'change'],
    setup(_props, { emit }) {
      /**
       * 将原生 select 事件转换为 BSelect 的更新事件。
       * @param event - 原生选择事件
       */
      function handleChange(event: Event): void {
        if (!(event.target instanceof HTMLSelectElement)) {
          return;
        }

        emit('update:value', event.target.value);
        emit('change', event.target.value);
      }

      return { handleChange };
    },
    template: `
      <select :value="value" @change="handleChange">
        <option v-for="option in options" :key="String(option.value)" :value="option.value">{{ option.label }}</option>
      </select>
    `
  })
};

/**
 * 创建测试Widget 元素。
 * @param id - 元素 ID
 * @param name - 元素注册名称
 * @returns 测试Widget 元素
 */
function createWidgetElement(id: string, name: 'rect' | 'text'): WidgetElement {
  return {
    id,
    name,
    label: name === 'text' ? '文本' : '矩形',
    icon: name === 'text' ? 'lucide:type' : 'lucide:square',
    title: name === 'text' ? '文本节点' : '矩形节点',
    position: { x: 12, y: 24 },
    size: { width: 160, height: 64 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {}
  };
}

/**
 * 创建测试组合元素。
 * @param id - 元素 ID
 * @param children - 子元素
 * @returns 测试组合元素
 */
function createGroupElement(id: string, children: WidgetElement[]): WidgetElement {
  return {
    id,
    name: 'group',
    label: '组合',
    icon: 'lucide:group',
    title: '组合节点',
    position: { x: 0, y: 0 },
    size: { width: 240, height: 160 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {},
    children
  };
}

/**
 * 创建测试Widget 数据。
 * @param elements - Widget 元素或元素列表
 * @returns 测试Widget 数据
 */
function createWidgetData(elements: WidgetElement | WidgetElement[]): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: Array.isArray(elements) ? elements : [elements]
  };
}

/**
 * 创建测试循环配置。
 * @param source - 数据源路径
 * @returns 循环配置
 */
function createLoopConfig(source = '$input.items'): WidgetElementLoopConfig {
  return {
    enabled: true,
    source: createVariableValue(source),
    autoColumns: false,
    columns: 2,
    columnGap: 12,
    rowGap: 12,
    itemName: 'item',
    indexName: 'index'
  };
}

describe('PanelSettings', (): void => {
  beforeEach((): void => {
    config.global.stubs = {
      ...originalGlobalStubs,
      ...panelGlobalStubs
    };
  });

  afterEach((): void => {
    config.global.stubs = originalGlobalStubs;
  });

  it('forwards page setting widget data changes', async (): Promise<void> => {
    const dataItem = createWidgetData([]);
    const wrapper = mount(PanelSettings, {
      props: {
        value: dataItem,
        select: dataItem.metadata
      }
    });

    await wrapper.find('.page-setter-forward').trigger('click');

    expect(wrapper.emitted('update:value')).toEqual([
      [
        {
          ...dataItem,
          name: 'page_tool'
        }
      ]
    ]);
    wrapper.unmount();
  });

  it('renders the selected element Setter.vue inside the property tab', (): void => {
    const element = createWidgetElement('text-1', 'text');
    const wrapper = mount(PanelSettings, {
      props: {
        value: createWidgetData(element),
        select: element
      },
      global: {
        stubs: {
          BSmartEditor: true,
          BSectionBlock: defineComponent({
            name: 'BSectionBlockStub',
            props: {
              title: {
                type: String,
                required: true
              }
            },
            template: '<section class="b-section-block-stub" :data-title="title"><slot></slot></section>'
          }),
          BSectionItem: true,
          BSelect: true
        }
      }
    });

    expect(wrapper.find('.design-setter-stub').exists()).toBe(true);
    expect(wrapper.find('.b-section-block-stub[data-title="内容"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('暂无专属属性');
    wrapper.unmount();
  });

  it('renders the group Setter.vue and forwards element commands', async (): Promise<void> => {
    const group = createGroupElement('group-1', [createWidgetElement('child-1', 'rect'), createWidgetElement('child-2', 'text')]);
    const wrapper = mount(PanelSettings, {
      props: {
        value: createWidgetData(group),
        select: group
      }
    });

    await wrapper.find('.widget-group-setter__ungroup').trigger('click');

    expect(wrapper.find('.b-section-block-stub[data-title="组合"]').exists()).toBe(true);
    expect(wrapper.find('.b-section-block-stub[data-title="布局"]').exists()).toBe(false);
    expect(wrapper.emitted('element-command')).toEqual([['ungroup']]);
    wrapper.unmount();
  });

  it('renders advanced tab for a selected element and edits the selected element directly', async (): Promise<void> => {
    const element = createWidgetElement('text-1', 'text');
    const dataItem = createWidgetData(element);
    const loopConfig = createLoopConfig();
    element.loop = loopConfig;
    dataItem.inputSchema.properties.items = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' }
        }
      }
    };
    const wrapper = mount(PanelSettings, {
      props: {
        value: dataItem,
        select: element
      }
    });

    expect(wrapper.find('[data-tab="高级"]').exists()).toBe(true);

    wrapper.findComponent({ name: 'ACheckboxStub' }).vm.$emit('update:checked', false);

    expect(dataItem.elements[0]?.loop.enabled).toBe(false);
    expect(wrapper.emitted('update:value')).toBeUndefined();
    expect(wrapper.emitted('update:select')).toBeUndefined();
    wrapper.unmount();
  });

  it('does not render advanced loop settings for multi-selection', (): void => {
    const firstRect = createWidgetElement('rect-1', 'rect');
    const secondRect = createWidgetElement('rect-2', 'rect');
    const groupElement = createGroupElement('group-1', [firstRect, secondRect]);
    const dataItem = createWidgetData([groupElement]);
    const wrapper = mount(PanelSettings, {
      props: {
        value: dataItem,
        select: null,
        selectedElementIds: ['rect-1', 'rect-2']
      },
      global: {
        stubs: {
          BIcon: true
        }
      }
    });

    expect(wrapper.find('[data-tab="高级"]').exists()).toBe(false);
    expect(wrapper.findComponent({ name: 'AdvancedSetter' }).exists()).toBe(false);
    expect(wrapper.emitted('update:value')).toBeUndefined();
    wrapper.unmount();
  });

  it('renders a multi-selection dashboard and forwards quick commands', async (): Promise<void> => {
    const firstRect = createWidgetElement('rect-1', 'rect');
    const secondRect = createWidgetElement('rect-2', 'rect');
    const textElement = createWidgetElement('text-1', 'text');
    firstRect.position = { x: 10, y: 20 };
    firstRect.size = { width: 100, height: 50 };
    secondRect.position = { x: 40, y: 100 };
    secondRect.size = { width: 80, height: 60 };
    textElement.position = { x: -20, y: 30 };
    textElement.size = { width: 60, height: 40 };
    const wrapper = mount(PanelSettings, {
      props: {
        value: createWidgetData([firstRect, secondRect, textElement]),
        select: null,
        selectedElementIds: ['rect-1', 'rect-2', 'text-1']
      },
      global: {
        stubs: {
          BIcon: true
        }
      }
    });

    expect(wrapper.find('[data-tab="设计"]').exists()).toBe(true);
    expect(wrapper.find('[data-tab="概览"]').exists()).toBe(false);
    expect(wrapper.find('[data-tab="样式"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('已选择 3 个元素');
    expect(wrapper.text()).not.toContain('左对齐');
    expect(wrapper.find('.multi-select-command--ungroup').exists()).toBe(false);
    expect(wrapper.find('.multi-select-command--group').exists()).toBe(true);
    expect(wrapper.find('.multi-select-command--copy').exists()).toBe(false);
    expect(wrapper.find('.multi-select-command--delete').exists()).toBe(false);
    const layoutInputs = wrapper.findAll('input[type="number"]').slice(0, 4);
    expect(layoutInputs.map((input) => (input.element as HTMLInputElement).value)).toEqual(['-20', '20', '140', '140']);
    expect(wrapper.findAllComponents({ name: 'ControlPanel' })).toHaveLength(2);

    await wrapper.findAll('input[type="number"]')[0].setValue('24');
    expect(wrapper.emitted('multi-layout-change')).toEqual([[{ x: 24 }]]);

    await wrapper.find('.multi-select-command--group').trigger('click');

    expect(wrapper.emitted('multi-command')).toEqual([['group']]);

    wrapper.findComponent({ name: 'BatchSetter' }).vm.$emit('style-change', {
      backgroundColor: '#fef3c7',
      borderColor: '#f97316',
      borderRadius: 6,
      borderWidth: 2
    });

    expect(wrapper.emitted('multi-style-change')).toEqual([
      [
        {
          backgroundColor: '#fef3c7',
          borderColor: '#f97316',
          borderRadius: 6,
          borderWidth: 2
        }
      ]
    ]);
    wrapper.unmount();
  });

  it('disables the multi-selection dashboard for elements from different parents', async (): Promise<void> => {
    const childRect = createWidgetElement('child-1', 'rect');
    const topRect = createWidgetElement('rect-1', 'rect');
    const wrapper = mount(PanelSettings, {
      props: {
        value: createWidgetData([createGroupElement('group-1', [childRect]), topRect]),
        select: null,
        selectedElementIds: ['child-1', 'rect-1']
      },
      global: {
        stubs: {
          BIcon: true
        }
      }
    });

    expect(wrapper.find('.multi-select-disabled').exists()).toBe(true);
    expect(wrapper.find('.multi-select-command--group').exists()).toBe(false);
    expect(wrapper.findAll('input[type="number"]')).toHaveLength(0);

    await wrapper.find('.multi-select-disabled').trigger('click');

    expect(wrapper.emitted('multi-command')).toBeUndefined();
    expect(wrapper.emitted('multi-layout-change')).toBeUndefined();
    expect(wrapper.emitted('multi-style-change')).toBeUndefined();
    wrapper.unmount();
  });

  it('does not render advanced tab for mixed multi-selection', (): void => {
    const firstRect = createWidgetElement('rect-1', 'rect');
    const secondRect = createWidgetElement('rect-2', 'rect');
    const wrapper = mount(PanelSettings, {
      props: {
        value: createWidgetData([firstRect, secondRect]),
        select: null,
        selectedElementIds: ['rect-1', 'rect-2']
      },
      global: {
        stubs: {
          BIcon: true
        }
      }
    });

    expect(wrapper.find('[data-tab="高级"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('rounds multi-selection layout inputs and emitted layout changes to two decimals', async (): Promise<void> => {
    const firstRect = createWidgetElement('rect-1', 'rect');
    const secondRect = createWidgetElement('rect-2', 'rect');
    firstRect.position = { x: -411.544, y: -1216.326 };
    firstRect.size = { width: 100.333, height: 50.555 };
    secondRect.position = { x: -200.555, y: -1132.022 };
    secondRect.size = { width: 74.135, height: 50.556 };
    const wrapper = mount(PanelSettings, {
      props: {
        value: createWidgetData([firstRect, secondRect]),
        select: null,
        selectedElementIds: ['rect-1', 'rect-2']
      }
    });
    const layoutInputs = wrapper.findAll('input[type="number"]').slice(0, 4);

    expect(layoutInputs.map((input) => (input.element as HTMLInputElement).value)).toEqual(['-411.54', '-1216.33', '285.12', '134.86']);

    await layoutInputs[3].setValue('134.8599999999999');

    expect(wrapper.emitted('multi-layout-change')).toEqual([[{ height: 134.86 }]]);
    wrapper.unmount();
  });

  it('switches the operation button to group after selected elements are ungrouped', async (): Promise<void> => {
    const firstRect = createWidgetElement('rect-1', 'rect');
    const secondRect = createWidgetElement('rect-2', 'rect');
    const groupElement = createGroupElement('group-1', [firstRect]);
    const wrapper = mount(PanelSettings, {
      props: {
        value: createWidgetData([groupElement, secondRect]),
        select: null,
        selectedElementIds: ['group-1', 'rect-2']
      },
      global: {
        stubs: {
          BIcon: true
        }
      }
    });

    expect(wrapper.find('.multi-select-command--ungroup').exists()).toBe(true);
    expect(wrapper.find('.multi-select-command--group').exists()).toBe(false);
    expect(wrapper.text()).toContain('拆分组');
    wrapper.unmount();

    const ungroupedWrapper = mount(PanelSettings, {
      props: {
        value: createWidgetData([firstRect, secondRect]),
        select: null,
        selectedElementIds: ['rect-1', 'rect-2']
      },
      global: {
        stubs: {
          BIcon: true
        }
      }
    });

    expect(ungroupedWrapper.find('.multi-select-command--ungroup').exists()).toBe(false);
    expect(ungroupedWrapper.find('.multi-select-command--group').exists()).toBe(true);
    expect(ungroupedWrapper.text()).toContain('合并');

    await ungroupedWrapper.find('.multi-select-command--group').trigger('click');

    expect(ungroupedWrapper.emitted('multi-command')?.at(-1)).toEqual(['group']);
    ungroupedWrapper.unmount();
  });
});
