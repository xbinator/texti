/**
 * @file page-setter.test.ts
 * @description 验证 Widget 页面默认设置面板会展示 Widget 概览。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { readFileSync } from 'node:fs';
import { defineComponent, nextTick, ref } from 'vue';
import type { ComponentPublicInstance, Ref } from 'vue';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import type { WidgetData, WidgetElement, WidgetSchemaObject } from '@/components/BWidget/types';
import { createDefaultWidgetData, DEFAULT_WIDGET_EMPTY_SCHEMA } from '@/components/BWidget/utils/widgetData';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';
import PageSetter from '@/views/widget/components/PageSetter.vue';
import SidebarState from '@/views/widget/components/SidebarState.vue';

const globalStubs = {
  ATabs: defineComponent({
    name: 'ATabsStub',
    template: '<div class="page-setter-tabs"><slot></slot></div>'
  }),
  ATabPane: defineComponent({
    name: 'ATabPaneStub',
    props: {
      tab: {
        type: String,
        required: true
      }
    },
    template: '<section :data-tab="tab"><slot></slot></section>'
  }),
  AInput: defineComponent({
    name: 'AInputStub',
    props: {
      size: {
        type: String,
        default: undefined
      },
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
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
          emit('update:value', event.target.value);
        }
      }

      return { handleInput };
    },
    template: '<input :value="value" @input="handleInput" />'
  }),
  ATextarea: defineComponent({
    name: 'ATextareaStub',
    props: {
      value: {
        type: String,
        default: ''
      }
    },
    emits: ['blur', 'update:value'],
    setup(_props, { emit }) {
      /**
       * 将原生 textarea 输入事件转换为 ATextarea 的 value 更新事件。
       * @param event - 原生输入事件
       */
      function handleInput(event: Event): void {
        if (event.target instanceof HTMLTextAreaElement) {
          emit('update:value', event.target.value);
        }
      }

      /**
       * 转发原生 blur 事件给被测组件。
       */
      function handleBlur(): void {
        emit('blur');
      }

      return { handleBlur, handleInput };
    },
    template: '<textarea :value="value" @blur="handleBlur" @input="handleInput"></textarea>'
  }),
  BInputNumber: defineComponent({
    name: 'BInputNumberStub',
    props: {
      value: {
        type: Number,
        default: undefined
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
          emit('update:value', event.target.value === '' ? undefined : Number(event.target.value));
        }
      }

      return { handleInput };
    },
    template: '<input class="b-input-number-stub" type="number" :value="value ?? \'\'" @input="handleInput" />'
  }),
  ACheckbox: defineComponent({
    name: 'ACheckboxStub',
    props: {
      checked: {
        type: Boolean,
        default: false
      }
    },
    emits: ['change', 'update:checked'],
    setup(_props, { emit }) {
      /**
       * 将原生 checkbox 事件转换为 ACheckbox 的 checked 更新事件。
       * @param event - 原生变更事件
       */
      function handleChange(event: Event): void {
        if (event.target instanceof HTMLInputElement) {
          emit('update:checked', event.target.checked);
          emit('change', event.target.checked);
        }
      }

      return { handleChange };
    },
    template: '<label class="a-checkbox-stub"><input type="checkbox" :checked="checked" @change="handleChange" /><slot></slot></label>'
  }),
  BDrawer: defineComponent({
    name: 'BDrawerStub',
    props: {
      open: {
        type: Boolean,
        default: false
      },
      title: {
        type: String,
        default: ''
      }
    },
    emits: ['update:open'],
    template: '<aside v-if="open" class="schema-help-drawer-stub" :data-title="title"><slot></slot></aside>'
  }),
  BButton: defineComponent({
    name: 'BButtonStub',
    props: {
      icon: {
        type: String,
        default: ''
      },
      size: {
        type: String,
        default: 'middle'
      },
      square: {
        type: Boolean,
        default: false
      },
      tooltip: {
        type: String,
        default: ''
      },
      type: {
        type: String,
        default: 'primary'
      }
    },
    emits: ['click'],
    setup(_props, { emit }) {
      /**
       * 转发按钮点击事件。
       * @param event - 原生鼠标事件
       */
      function handleClick(event: MouseEvent): void {
        emit('click', event);
      }

      return { handleClick };
    },
    template: `
      <button
        class="b-button-stub"
        :data-icon="icon"
        :data-size="size"
        :data-square="square"
        :data-tooltip="tooltip"
        :data-type="type"
        @click="handleClick"
      >
        <slot></slot>
      </button>
    `
  }),
  BSegmented: defineComponent({
    name: 'BSegmentedStub',
    props: {
      block: {
        type: Boolean,
        default: false
      },
      options: {
        type: Array,
        default: (): unknown[] => []
      },
      value: {
        type: [String, Number],
        default: ''
      }
    },
    emits: ['change', 'update:value'],
    setup(_props, { emit }) {
      /**
       * 转发分段选项点击事件。
       * @param value - 被选中的选项值
       * @param option - 被选中的选项配置
       */
      function handleClick(value: string | number, option: unknown): void {
        emit('update:value', value);
        emit('change', value, option);
      }

      return { handleClick };
    },
    template: `
      <div class="b-segmented-stub" :data-block="block">
        <button
          v-for="option in options"
          :key="option.value"
          class="b-segmented-stub__button"
          :class="{ 'is-active': option.value === value }"
          type="button"
          @click="handleClick(option.value, option)"
        >
          {{ option.label }}
        </button>
      </div>
    `
  }),
  BIcon: defineComponent({
    name: 'BIconStub',
    props: {
      icon: {
        type: String,
        default: ''
      },
      size: {
        type: Number,
        default: 16
      }
    },
    emits: ['click'],
    setup(_props, { emit }) {
      /**
       * 转发图标点击事件。
       * @param event - 原生鼠标事件
       */
      function handleClick(event: MouseEvent): void {
        emit('click', event);
      }

      return { handleClick };
    },
    template: '<span class="b-icon-stub" :data-icon="icon" :data-size="size" @click="handleClick"><slot></slot></span>'
  }),
  BModal: defineComponent({
    name: 'BModalStub',
    props: {
      open: {
        type: Boolean,
        default: false
      },
      title: {
        type: String,
        default: ''
      },
      width: {
        type: [Number, String],
        default: 500
      }
    },
    emits: ['cancel', 'close', 'update:open'],
    setup(_props, { emit }) {
      /**
       * 模拟弹窗取消。
       */
      function handleCancel(): void {
        emit('cancel');
        emit('close');
        emit('update:open', false);
      }

      return { handleCancel };
    },
    template: `
      <div v-if="open" class="schema-editor-modal-stub" :data-title="title" :data-width="width">
        <slot></slot>
        <footer><slot name="footer"></slot></footer>
        <button class="schema-editor-modal-stub__cancel" @click="handleCancel"></button>
      </div>
    `
  }),
  BMonaco: defineComponent({
    name: 'BMonacoStub',
    props: {
      editorState: {
        type: Object,
        default: (): Record<string, unknown> => ({})
      },
      extraLibs: {
        type: Array,
        default: (): unknown[] => []
      },
      language: {
        type: String,
        default: ''
      },
      options: {
        type: Object,
        default: (): Record<string, unknown> => ({})
      },
      value: {
        type: String,
        default: ''
      }
    },
    emits: ['save', 'update:value'],
    setup(_props, { emit, expose }) {
      /**
       * 将输入事件转换为 Monaco 的 value 更新事件。
       * @param event - 原生输入事件
       */
      function handleInput(event: Event): void {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
          emit('update:value', event.target.value);
        }
      }

      /**
       * 模拟 Monaco 聚焦方法。
       */
      function focusEditor(): void {
        return undefined;
      }

      /**
       * 模拟 Monaco 保存快捷键。
       */
      function handleSave(): void {
        emit('save');
      }

      expose({ focusEditor });

      return { handleInput, handleSave };
    },
    template: `
      <div>
        <textarea class="schema-editor-monaco-stub" :value="value" @input="handleInput"></textarea>
        <button class="schema-editor-monaco-save-stub" @click="handleSave"></button>
      </div>
    `
  }),
  BMessage: defineComponent({
    name: 'BMessageStub',
    props: {
      content: {
        type: String,
        default: ''
      }
    },
    setup() {
      const isExpanded = ref<boolean>(false);

      /**
       * 切换测试用 JSON 示例展开状态。
       */
      function toggleExpanded(): void {
        isExpanded.value = !isExpanded.value;
      }

      return { isExpanded, toggleExpanded };
    },
    template: `
      <article class="b-message-stub">
        <template v-if="content.includes('properties')">
          <ul class="schema-help__field-list">
            <li class="schema-help__field-item">
              <span class="schema-help__type">string</span>
              <span>必填</span>
              <span>city</span>
              <span>城市名称</span>
            </li>
            <li class="schema-help__field-item">
              <span class="schema-help__type">string</span>
              <span>date</span>
            </li>
            <li class="schema-help__field-item">
              <span class="schema-help__type">string</span>
              <span>unit</span>
            </li>
          </ul>
          <section class="schema-help__example" :class="{ 'is-expanded': isExpanded }">
            <button
              class="schema-help__expand"
              type="button"
              :data-icon="isExpanded ? 'lucide:minimize-2' : 'lucide:maximize-2'"
              :data-tooltip="isExpanded ? '收起查看' : '展开查看'"
              @click="toggleExpanded"
            ></button>
            <pre v-if="isExpanded">{{ content }}</pre>
          </section>
        </template>
        <template v-else>{{ content }}</template>
      </article>
    `
  }),
  BSectionBlock: defineComponent({
    name: 'BSectionBlockStub',
    props: {
      title: {
        type: String,
        required: true
      },
      tips: {
        type: String,
        default: ''
      }
    },
    template: `
      <section class="section-block-stub" :data-tips="tips">
        <header>
          <div class="section-block-stub__title">
            <h3>{{ title }}</h3>
            <span class="section-block-stub__help">
              <slot name="help"></slot>
            </span>
          </div>
          <div class="section-block-stub__extra">
            <slot name="extra"></slot>
          </div>
        </header>
        <slot></slot>
      </section>
    `
  }),
  BSectionItem: defineComponent({
    name: 'BSectionItemStub',
    props: {
      label: {
        type: String,
        default: ''
      },
      direction: {
        type: String,
        default: 'horizontal'
      }
    },
    template: '<label><span>{{ label }}</span><slot></slot></label>'
  }),
  BSelect: defineComponent({
    name: 'BSelectStub',
    props: {
      options: {
        type: Array,
        default: (): unknown[] => []
      },
      value: {
        type: String,
        default: ''
      }
    },
    emits: ['change', 'update:value'],
    setup(_props, { emit }) {
      /**
       * 将原生 select 事件转换为 BSelect 的 value 更新事件。
       * @param event - 原生变更事件
       */
      function handleChange(event: Event): void {
        if (event.target instanceof HTMLSelectElement) {
          emit('update:value', event.target.value);
          emit('change', event.target.value);
        }
      }

      return { handleChange };
    },
    template: `
      <select class="b-select-stub" :data-options="options.map((option) => option.label).join('|')" :value="value" @change="handleChange">
        <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
    `
  })
};

/**
 * PageSetter 测试宿主公开状态。
 */
interface PageSetterHostVm extends ComponentPublicInstance {
  /** 当前Widget 数据 */
  dataItem: WidgetData;
}

/**
 * SidebarState 测试宿主公开状态。
 */
interface SidebarStateHostVm extends ComponentPublicInstance {
  /** 当前Widget 数据 */
  dataItem: WidgetData;
}

/** Vue 测试包装器查询目标。 */
type QueryableWrapper = VueWrapper | DOMWrapper<Element>;

/**
 * 创建测试用天气入参 schema。
 * @returns 天气入参 schema
 */
function createWeatherInputSchema(): WidgetSchemaObject {
  return {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称，例如上海'
      },
      date: {
        type: 'string',
        description: '查询日期，例如今天或明天'
      },
      unit: {
        type: 'string',
        description: '温度单位，celsius 或 fahrenheit'
      }
    },
    required: ['city']
  };
}

/**
 * 设置面板区块标题快照。
 */
interface SectionBlockTitleSnapshot {
  /** 区块标题 */
  title: string;
  /** 区块提示 */
  tips?: string;
}

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
 * 创建测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createWidgetData(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [createWidgetElement('rect-1', 'rect'), createWidgetElement('text-1', 'text')]
  };
}

/**
 * 创建带天气 schema 的测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createWeatherWidgetData(): WidgetData {
  return {
    ...createWidgetData(),
    inputSchema: createWeatherInputSchema()
  };
}

/**
 * 创建带 v-model 回写的 PageSetter 测试宿主。
 * @param initialData - 初始Widget 数据
 * @returns 测试宿主组件
 */
function createPageSetterHost(initialData: WidgetData): ReturnType<typeof defineComponent> {
  return defineComponent({
    name: 'PageSetterHost',
    components: {
      PageSetter
    },
    setup(): { dataItem: Ref<WidgetData> } {
      return {
        dataItem: ref(initialData)
      };
    },
    template: '<PageSetter v-model:value="dataItem" />'
  });
}

/**
 * 挂载带 v-model 回写的 PageSetter 测试宿主。
 * @param initialData - 初始Widget 数据
 * @returns 测试包装器
 */
function mountPageSetterHost(initialData: WidgetData): VueWrapper<PageSetterHostVm> {
  return mount(createPageSetterHost(initialData), {
    global: {
      stubs: globalStubs
    }
  }) as VueWrapper<PageSetterHostVm>;
}

/**
 * 创建带 v-model 回写的 SidebarState 测试宿主。
 * @param initialData - 初始Widget 数据
 * @returns 测试宿主组件
 */
function createSidebarStateHost(initialData: WidgetData): ReturnType<typeof defineComponent> {
  return defineComponent({
    name: 'SidebarStateHost',
    components: {
      SidebarState
    },
    setup(): { dataItem: Ref<WidgetData> } {
      return {
        dataItem: ref(initialData)
      };
    },
    template: '<SidebarState v-model:value="dataItem" />'
  });
}

/**
 * 挂载带 v-model 回写的 SidebarState 测试宿主。
 * @param initialData - 初始Widget 数据
 * @returns 测试包装器
 */
function mountSidebarStateHost(initialData: WidgetData): VueWrapper<SidebarStateHostVm> {
  return mount(createSidebarStateHost(initialData), {
    global: {
      stubs: globalStubs
    }
  }) as VueWrapper<SidebarStateHostVm>;
}

/**
 * 读取设置面板所有区块标题。
 * @param wrapper - PageSetter 测试包装器
 * @returns 区块标题列表
 */
function readSectionBlockTitles(wrapper: VueWrapper<PageSetterHostVm>): string[] {
  return wrapper.findAllComponents({ name: 'BSectionBlockStub' }).map((item: VueWrapper): string => {
    const props = item.props() as SectionBlockTitleSnapshot;

    return props.title;
  });
}

/**
 * 查找 SidebarState 数据源面板。
 * @param wrapper - SidebarState 测试包装器
 * @returns 数据源面板包装器
 */
function findSidebarStatePanel(wrapper: VueWrapper<SidebarStateHostVm>): DOMWrapper<Element> {
  const panel = wrapper.find('.sidebar-panel');
  if (!panel.exists()) {
    throw new Error('未找到数据源侧栏面板');
  }

  return panel;
}

/**
 * 查找 SidebarState 右侧操作区。
 * @param wrapper - SidebarState 测试包装器
 * @returns 操作区包装器
 */
function findSidebarStateExtra(wrapper: VueWrapper<SidebarStateHostVm>): DOMWrapper<Element> {
  const extra = wrapper.find('.sidebar-panel__extra');
  if (!extra.exists()) {
    throw new Error('数据源侧栏缺少操作区');
  }

  return extra;
}

/**
 * 查找 SidebarState 添加字段按钮。
 * @param wrapper - SidebarState 测试包装器
 * @returns 按钮包装器
 */
function findSidebarStateAddFieldButton(wrapper: VueWrapper<SidebarStateHostVm>): VueWrapper {
  const extraElement = findSidebarStateExtra(wrapper).element;
  const button = wrapper.findAllComponents({ name: 'BButtonStub' }).find((item: VueWrapper): boolean => {
    const props = item.props() as { icon?: string };

    return extraElement.contains(item.element) && props.icon === 'lucide:plus';
  });
  if (!button) {
    throw new Error('数据源侧栏缺少添加字段按钮');
  }

  return button;
}

/**
 * 查找 SidebarState Schema 编辑按钮。
 * @param wrapper - SidebarState 测试包装器
 * @returns 按钮包装器
 */
function findSidebarStateSchemaEditButton(wrapper: VueWrapper<SidebarStateHostVm>): VueWrapper {
  const extraElement = findSidebarStateExtra(wrapper).element;
  const button = wrapper
    .findAllComponents({ name: 'BButtonStub' })
    .find((item: VueWrapper): boolean => extraElement.contains(item.element) && item.text().includes('编辑'));
  if (!button) {
    throw new Error('数据源侧栏缺少编辑 Schema 按钮');
  }

  return button;
}

/**
 * 查找 SidebarState schema 类型切换按钮。
 * @param wrapper - SidebarState 测试包装器
 * @param label - 切换按钮文案
 * @returns 按钮包装器
 */
function findSidebarStateSchemaModeButton(wrapper: VueWrapper<SidebarStateHostVm>, label: '入参' | '出参'): DOMWrapper<Element> {
  const button = wrapper.findAll('.b-segmented-stub__button').find((item: DOMWrapper<Element>): boolean => item.text() === label);
  if (!button) {
    throw new Error(`数据源侧栏缺少 ${label} 切换按钮`);
  }

  return button;
}

/**
 * 查找 SidebarState 标题旁边的说明图标。
 * @param wrapper - SidebarState 测试包装器
 * @returns 图标包装器
 */
function findSidebarStateHelpIcon(wrapper: VueWrapper<SidebarStateHostVm>): VueWrapper {
  const icon = wrapper
    .find('.sidebar-panel__help')
    .findAllComponents({ name: 'BIconStub' })
    .find((item: VueWrapper): boolean => {
      const props = item.props() as { icon?: string };

      return props.icon === 'lucide:circle-alert';
    });
  if (!icon) {
    throw new Error('数据源侧栏缺少说明图标');
  }

  return icon;
}

/**
 * 查找指定字段名对应的 schema 字段行。
 * @param section - Schema 所在区块
 * @param name - schema 字段名
 * @returns 字段行包装器
 */
function findSchemaRow(section: QueryableWrapper, name: string): DOMWrapper<Element> {
  const row = section.findAll('.schema-editor__row').find((item: DOMWrapper<Element>): boolean => {
    const input = item.find('.schema-editor__name-input input');

    return input.exists() && (input.element as HTMLInputElement).value === name;
  });
  if (!row) {
    throw new Error(`未找到 Schema 字段行：${name}`);
  }

  return row;
}

/**
 * 判断指定字段名对应的 schema 字段行是否存在。
 * @param section - Schema 所在区块
 * @param name - schema 字段名
 * @returns 字段行是否存在
 */
function hasSchemaRow(section: QueryableWrapper, name: string): boolean {
  return section.findAll('.schema-editor__row').some((item: DOMWrapper<Element>): boolean => {
    const input = item.find('.schema-editor__name-input input');

    return input.exists() && (input.element as HTMLInputElement).value === name;
  });
}

/**
 * 读取指定 CSS 选择器对应的首个样式块。
 * @param source - Vue 文件源码
 * @param selector - CSS 选择器
 * @returns 样式块内容
 */
function readStyleBlock(source: string, selector: string): string {
  const blockStart = source.indexOf(`${selector} {`);
  if (blockStart < 0) {
    return '';
  }

  const openingBraceIndex = source.indexOf('{', blockStart);
  let blockDepth = 0;
  let blockEnd = source.length;

  for (let index = openingBraceIndex; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      blockDepth += 1;
    }

    if (character === '}') {
      blockDepth -= 1;
      if (blockDepth === 0) {
        blockEnd = index + 1;
        break;
      }
    }
  }

  return source.slice(blockStart, blockEnd);
}

describe('PageSetter', (): void => {
  it('keeps the schema editor row layout flexible without grid columns', (): void => {
    const source = readFileSync('src/views/widget/components/PageSetter/SchemaTreeEditor.vue', 'utf-8');
    const rowStyle = readStyleBlock(source, '.schema-editor__row');

    expect(rowStyle).toContain('display: flex;');
    expect(rowStyle).not.toContain('display: grid;');
    expect(rowStyle).not.toContain('grid-template-columns');
  });

  it('aligns schema header and rows on shared flex columns without is-fill', (): void => {
    const source = readFileSync('src/views/widget/components/PageSetter/SchemaTreeEditor.vue', 'utf-8');

    expect(source).not.toContain('is-fill');
    expect(readStyleBlock(source, '.schema-editor__header')).toContain('display: flex;');
    expect(readStyleBlock(source, '.schema-editor__header')).not.toContain('grid-template-columns');
    expect(readStyleBlock(source, '.schema-editor__header-name')).toContain('flex: 1 1 132px;');
    expect(readStyleBlock(source, '.schema-editor__name-cell')).toContain('flex: 1 1 132px;');
    expect(readStyleBlock(source, '.schema-editor')).toContain('--schema-editor-type-width: 100px;');
    expect(readStyleBlock(source, '.schema-editor__header-type')).toContain('width: var(--schema-editor-type-width);');
    expect(readStyleBlock(source, '.schema-editor__header-type')).not.toContain('flex: 0 1 220px;');
    expect(readStyleBlock(source, '.schema-editor__type-select')).not.toContain('flex: 0 1 220px;');
    expect(readStyleBlock(source, '.schema-editor__type-select')).toContain('width: var(--schema-editor-type-width);');
    expect(readStyleBlock(source, '.schema-editor__header-controls')).toContain('flex: 0 0 92px;');
    expect(readStyleBlock(source, '.schema-editor__header-controls')).toContain('grid-template-columns: 28px 28px 28px;');
    expect(readStyleBlock(source, '.schema-editor__header-controls')).toContain('grid-template-columns: 28px 28px 28px 28px;');
    expect(readStyleBlock(source, '.schema-editor__controls')).toContain('flex: 0 0 92px;');
    expect(readStyleBlock(source, '.schema-editor__controls')).toContain('grid-template-columns: 28px 28px 28px;');
    expect(readStyleBlock(source, '.schema-editor__controls')).toContain('grid-template-columns: 28px 28px 28px 28px;');
    expect(readStyleBlock(source, '.schema-editor__row-wrap')).toContain('&.is-description-expanded');
    expect(readStyleBlock(source, '.schema-editor__row-wrap')).toContain('background: var(--bg-secondary);');
    expect(readStyleBlock(source, '.schema-editor__description')).toContain('box-sizing: border-box;');
    expect(readStyleBlock(source, '.schema-editor__description')).toContain('width: 100%;');
    expect(readStyleBlock(source, '.schema-editor__description')).not.toContain('padding-left');
    expect(readStyleBlock(source, '.schema-editor__header-controls')).not.toContain('40px');
    expect(readStyleBlock(source, '.schema-editor__controls')).not.toContain('40px');
    expect(source).not.toContain('schema-editor__required');
    expect(source).not.toContain('schema-editor__action');
    expect(source).not.toContain('schema-editor__action-placeholder');
    expect(source).not.toContain('schema-editor__header-name-label');
  });

  it('keeps schema input and type selector text at 12px', (): void => {
    const source = readFileSync('src/views/widget/components/PageSetter/SchemaTreeEditor.vue', 'utf-8');
    const nameInputBlock = readStyleBlock(source, '.schema-editor__name-input');
    const typeSelectBlock = readStyleBlock(source, '.schema-editor__type-select');

    expect(nameInputBlock).toContain(':deep(.ant-input),');
    expect(nameInputBlock).toContain(':deep(input) {');
    expect(nameInputBlock).toContain('font-size: 12px;');
    expect(typeSelectBlock).toContain(':deep(.b-select),');
    expect(typeSelectBlock).toContain(':deep(.ant-select-selector),');
    expect(typeSelectBlock).toContain(':deep(.ant-select-selection-item),');
    expect(typeSelectBlock).toContain(':deep(select) {');
    expect(typeSelectBlock).toContain('font-size: 12px;');
  });

  it('keeps SidebarState schema modal usage bound directly to active schema', (): void => {
    const source = readFileSync('src/views/widget/components/SidebarState.vue', 'utf-8');
    const legacySchemaKindHelperName = ['getSidebar', 'WidgetSchema', 'Kind'].join('');
    const legacySchemaKeyGuardName = ['isSidebar', 'SchemaKey'].join('');

    expect(source).toContain('v-model:value="activeSchema"');
    expect(source).toContain(':default-value="WIDGET_SCHEMA_DEFAULT_FIELD_NAME"');
    expect(source).toContain(':kind="activeMode"');
    expect(source).toContain("{ label: '入参', value: 'inputSchema' }");
    expect(source).toContain("{ label: '出参', value: 'outputSchema' }");
    expect(source).not.toContain('activeSchemaKey');
    expect(source).not.toContain(legacySchemaKeyGuardName);
    expect(source).not.toContain(':kind="activeSchemaKind"');
    expect(source).not.toContain(legacySchemaKindHelperName);
    expect(source).toContain('normalizeWidgetSchemaObject(dataItem.value[activeMode.value])');
    expect(source).not.toContain('editorTitle');
    expect(source).not.toContain('schemaDraftText');
    expect(source).not.toContain('activeSchemaDraftDefaultText');
    expect(source).not.toContain('handleSchemaInputEditorConfirm');
    expect(source).not.toContain('handleSchemaInputEditorCancel');
  });

  it('keeps SchemaHelp keyed by WidgetData schema fields', (): void => {
    const source = readFileSync('src/views/widget/components/PageSetter/SchemaHelp.vue', 'utf-8');

    expect(source).toContain("type SchemaHelpKey = 'inputSchema' | 'outputSchema'");
    expect(source).toContain('Record<SchemaHelpKey, SchemaHelpContent>');
    expect(source).toContain('inputSchema: {');
    expect(source).toContain('outputSchema: {');
    expect(source).not.toContain("type SchemaHelpKind = 'input' | 'output'");
    expect(source).not.toContain("kind: 'input'");
    expect(source).not.toContain('input: {');
    expect(source).not.toContain('output: {');
  });

  it('edits widget name and description on the selected page', async (): Promise<void> => {
    const dataItem = createWidgetData();
    const wrapper = mountPageSetterHost(dataItem);
    const inputs = wrapper.findAll('input');
    const descriptionEditor = wrapper.findComponent({ name: 'ATextareaStub' });

    await inputs[0]?.setValue('profile_card');
    await descriptionEditor.find('textarea').setValue('根据用户资料生成卡片节点');

    expect(wrapper.text()).toContain('名称');
    expect(wrapper.text()).not.toContain('标识符');
    expect(wrapper.html()).not.toContain(['data', 'testid'].join('-'));
    expect(wrapper.vm.dataItem.name).toBe('profile_card');
    expect(wrapper.vm.dataItem.description).toBe('根据用户资料生成卡片节点');
    wrapper.unmount();
  });

  it('edits runtime display width and height metadata on the selected page', async (): Promise<void> => {
    const dataItem = createWidgetData();
    dataItem.metadata = { preserved: true };
    const wrapper = mountPageSetterHost(dataItem);
    const sizeInputs = wrapper.findAll('.b-input-number-stub');
    const sizeSection = wrapper.findAllComponents({ name: 'BSectionBlockStub' }).find((item: VueWrapper): boolean => {
      const props = item.props() as SectionBlockTitleSnapshot;

      return props.title === '尺寸';
    });
    if (!sizeSection) {
      throw new Error('未找到尺寸设置区块');
    }

    await sizeInputs[0]?.setValue('320');
    await sizeInputs[1]?.setValue('180');

    expect((sizeSection.props() as SectionBlockTitleSnapshot).tips).toBe('设置组件运行时的显示尺寸。空间足够时保持设定尺寸，空间不足时自动等比缩小');
    expect(wrapper.vm.dataItem.metadata).toMatchObject({
      preserved: true,
      width: 320,
      height: 180
    });

    await sizeInputs[0]?.setValue('');

    expect(wrapper.vm.dataItem.metadata).toEqual({
      preserved: true,
      height: 180
    });
    wrapper.unmount();
  });

  it('shows schemas as inline tree editors and opens an input schema dialog for advanced editing', async (): Promise<void> => {
    const dataItem = createWidgetData();
    const wrapper = mountSidebarStateHost(dataItem);
    const inputSection = findSidebarStatePanel(wrapper);
    const extra = findSidebarStateExtra(wrapper);

    expect(wrapper.findAllComponents({ name: 'ATextareaStub' })).toHaveLength(0);
    expect(inputSection.find('.sidebar-panel__title').text()).toBe('数据源');
    expect(wrapper.find('.schema-preview').exists()).toBe(false);
    expect(findSidebarStateSchemaModeButton(wrapper, '入参').classes()).toContain('is-active');
    expect(findSidebarStateSchemaModeButton(wrapper, '出参').exists()).toBe(true);
    expect(inputSection.find('.schema-editor').exists()).toBe(true);
    expect(inputSection.find('.schema-editor').html()).not.toContain('data-schema');
    expect(inputSection.findAll('.schema-editor__row')).toHaveLength(0);
    expect(inputSection.find('.schema-editor__footer').exists()).toBe(false);
    expect(wrapper.text()).toContain('入参');
    expect(wrapper.text()).not.toContain('inputSchema');
    expect(wrapper.text()).not.toContain('dataSchema');
    expect(wrapper.text()).not.toContain('outputSchema');

    const addButton = findSidebarStateAddFieldButton(wrapper);
    const editButton = findSidebarStateSchemaEditButton(wrapper);
    expect((addButton.props() as { icon?: string; size?: string }).icon).toBe('lucide:plus');
    expect((addButton.props() as { size?: string }).size).toBe('mini');
    expect((editButton.props() as { size?: string }).size).toBe('mini');
    expect(findSidebarStateHelpIcon(wrapper).exists()).toBe(true);
    expect(extra.text()).not.toContain('添加字段');
    expect(extra.find('[data-tooltip="添加字段"]').exists()).toBe(true);
    expect(extra.text()).toContain('编辑');
    expect(extra.text()).not.toContain('JSON导入');
    expect(extra.findComponent({ name: 'BIconStub' }).exists()).toBe(false);

    await addButton.trigger('click');
    expect(wrapper.vm.dataItem.inputSchema.properties.field).toEqual({
      type: 'string'
    });
    expect(findSchemaRow(inputSection, 'field').find('.schema-editor__name-input input').element).toHaveProperty('value', 'field');
    expect(findSchemaRow(inputSection, 'field').find('.schema-editor__name-input').classes()).not.toContain('is-fill');
    expect(findSchemaRow(inputSection, 'field').find('.schema-editor__type-select select').attributes('data-options')).toBe(
      'String|Number|Boolean|Object|Array'
    );
    expect(findSchemaRow(inputSection, 'field').find('.schema-editor__toggle-placeholder').exists()).toBe(false);
    expect(findSchemaRow(inputSection, 'field').find('[data-tooltip="添加子字段"]').exists()).toBe(false);
    expect(findSchemaRow(inputSection, 'field').find('.schema-editor__action-spacer').exists()).toBe(false);
    expect(findSchemaRow(inputSection, 'field').find('.schema-editor__controls').exists()).toBe(true);
    expect(findSchemaRow(inputSection, 'field').findAll('.schema-editor__control-cell')).toHaveLength(3);

    await editButton.trigger('click');
    expect(wrapper.find('.schema-editor-modal-stub').attributes('data-title')).toBe('编辑');

    await wrapper.find('.schema-editor-modal-stub .schema-editor-monaco-stub').setValue(
      JSON.stringify({
        type: 'object',
        properties: {
          userName: {
            type: 'string',
            description: '用户名'
          }
        },
        required: ['userName']
      })
    );
    await nextTick();
    await wrapper
      .findAllComponents({ name: 'BButtonStub' })
      .find((button: VueWrapper): boolean => button.text() === '保存')
      ?.trigger('click');

    expect(wrapper.vm.dataItem.inputSchema.properties.userName).toEqual({
      type: 'string',
      description: '用户名'
    });
    expect(wrapper.vm.dataItem.inputSchema.required).toEqual(['userName']);
    expect(wrapper.find('.schema-editor-modal-stub').exists()).toBe(false);
    wrapper.unmount();
  });

  it('switches SidebarState between input and output schema editing', async (): Promise<void> => {
    const dataItem = createWidgetData();
    dataItem.inputSchema = {
      type: 'object',
      properties: {
        query: {
          type: 'string'
        }
      },
      required: ['query']
    };
    dataItem.outputSchema = {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: '天气摘要'
        }
      },
      required: ['summary']
    };
    const wrapper = mountSidebarStateHost(dataItem);
    const inputSection = findSidebarStatePanel(wrapper);

    expect(findSchemaRow(inputSection, 'query').exists()).toBe(true);
    expect(hasSchemaRow(inputSection, 'summary')).toBe(false);

    await findSidebarStateSchemaModeButton(wrapper, '出参').trigger('click');

    expect(findSidebarStateSchemaModeButton(wrapper, '出参').classes()).toContain('is-active');
    expect(findSchemaRow(inputSection, 'summary').find('.schema-editor__name-input input').element).toHaveProperty('value', 'summary');
    expect(hasSchemaRow(inputSection, 'query')).toBe(false);

    await findSidebarStateAddFieldButton(wrapper).trigger('click');

    expect(wrapper.vm.dataItem.outputSchema.properties.field).toEqual({
      type: 'string'
    });
    expect(wrapper.vm.dataItem.inputSchema.properties.field).toBeUndefined();

    await findSidebarStateSchemaEditButton(wrapper).trigger('click');
    expect(wrapper.find('.schema-editor-modal-stub').attributes('data-title')).toBe('编辑');

    await wrapper.find('.schema-editor-modal-stub .schema-editor-monaco-stub').setValue(
      JSON.stringify({
        type: 'object',
        properties: {
          resultCode: {
            type: 'number',
            description: '结果码'
          }
        },
        required: ['resultCode']
      })
    );
    await nextTick();
    await wrapper
      .findAllComponents({ name: 'BButtonStub' })
      .find((button: VueWrapper): boolean => button.text() === '保存')
      ?.trigger('click');

    expect(wrapper.vm.dataItem.outputSchema.properties.resultCode).toEqual({
      type: 'number',
      description: '结果码'
    });
    expect(wrapper.vm.dataItem.outputSchema.required).toEqual(['resultCode']);
    expect(wrapper.vm.dataItem.inputSchema.properties.query).toEqual({
      type: 'string'
    });
    wrapper.unmount();
  });

  it('edits schema fields inline from the data-source sidebar tree editor', async (): Promise<void> => {
    const dataItem = createWeatherWidgetData();
    const wrapper = mountSidebarStateHost(dataItem);
    const inputSection = findSidebarStatePanel(wrapper);

    await findSchemaRow(inputSection, 'city').find('.schema-editor__name-input input').setValue('location');

    expect(wrapper.vm.dataItem.inputSchema.properties.city).toBeUndefined();
    expect(wrapper.vm.dataItem.inputSchema.properties.location).toEqual({
      type: 'string',
      description: '城市名称，例如上海'
    });
    expect(wrapper.vm.dataItem.inputSchema.required).toEqual(['location']);

    const locationRequiredInput = findSchemaRow(inputSection, 'location').findAll('.schema-editor__control-cell')[0]?.find('input');
    if (!locationRequiredInput || !locationRequiredInput.exists()) {
      throw new Error('缺少必填勾选框');
    }
    (locationRequiredInput.element as HTMLInputElement).checked = false;
    await locationRequiredInput.trigger('change');

    expect(wrapper.vm.dataItem.inputSchema.required).toEqual([]);

    await findSchemaRow(inputSection, 'date').find('.schema-editor__type-select select').setValue('object');

    expect(wrapper.vm.dataItem.inputSchema.properties.date).toEqual({
      type: 'object',
      description: '查询日期，例如今天或明天',
      properties: {},
      required: []
    });
    expect(findSchemaRow(inputSection, 'date').classes()).toContain('is-object');
    expect(findSchemaRow(inputSection, 'date').find('.schema-editor__toggle').exists()).toBe(false);
    expect(findSchemaRow(inputSection, 'location').find('.schema-editor__toggle-placeholder').exists()).toBe(false);
    expect(findSchemaRow(inputSection, 'date').findAll('.schema-editor__control-cell')).toHaveLength(4);
    expect(findSchemaRow(inputSection, 'date').find('[data-tooltip="添加子字段"]').attributes('data-icon')).toBe('lucide:git-branch-plus');

    await findSchemaRow(inputSection, 'date').find('[data-tooltip="添加子字段"]').trigger('click');

    expect(wrapper.vm.dataItem.inputSchema.properties.date.properties?.field).toEqual({
      type: 'string'
    });
    expect(findSchemaRow(inputSection, 'field').exists()).toBe(true);
    expect(findSchemaRow(inputSection, 'date').find('.schema-editor__toggle').exists()).toBe(true);
    expect(findSchemaRow(inputSection, 'location').find('.schema-editor__toggle-placeholder').exists()).toBe(true);
    expect(inputSection.find('.schema-editor__header-toggle-placeholder').exists()).toBe(true);
    expect(inputSection.find('.schema-editor__header-name').text()).toBe('变量名');

    await findSchemaRow(inputSection, 'date').find('.schema-editor__toggle').trigger('click');

    expect(hasSchemaRow(inputSection, 'field')).toBe(false);

    await findSchemaRow(inputSection, 'date').find('.schema-editor__toggle').trigger('click');
    await findSchemaRow(inputSection, 'field').find('[data-tooltip="删除字段"]').trigger('click');

    expect(wrapper.vm.dataItem.inputSchema.properties.date.properties?.field).toBeUndefined();

    await findSidebarStateAddFieldButton(wrapper).trigger('click');

    expect(wrapper.vm.dataItem.inputSchema.properties.field).toEqual({
      type: 'string'
    });
    wrapper.unmount();
  });

  it('expands schema rows to edit field descriptions inline', async (): Promise<void> => {
    const dataItem = createWeatherWidgetData();
    const wrapper = mountSidebarStateHost(dataItem);
    const inputSection = findSidebarStatePanel(wrapper);
    const collapsedDescriptionButton = findSchemaRow(inputSection, 'city').find('[data-icon="lucide:maximize-2"]');

    expect(inputSection.find('.schema-editor__description').exists()).toBe(false);
    expect(findSchemaRow(inputSection, 'city').element.closest('.schema-editor__row-wrap')?.classList.contains('is-description-expanded')).toBe(false);
    expect(collapsedDescriptionButton.exists()).toBe(true);
    expect(collapsedDescriptionButton.attributes('data-tooltip')).toBe('');

    await collapsedDescriptionButton.trigger('click');

    const descriptionEditor = inputSection.find('.schema-editor__description textarea');
    const expandedDescriptionButton = findSchemaRow(inputSection, 'city').find('[data-icon="lucide:minimize-2"]');
    expect(descriptionEditor.exists()).toBe(true);
    expect(findSchemaRow(inputSection, 'city').element.closest('.schema-editor__row-wrap')?.classList.contains('is-description-expanded')).toBe(true);
    expect((descriptionEditor.element as HTMLTextAreaElement).value).toBe('城市名称，例如上海');
    expect(expandedDescriptionButton.exists()).toBe(true);
    expect(expandedDescriptionButton.attributes('data-tooltip')).toBe('');

    await descriptionEditor.setValue('新的城市说明');
    expect(wrapper.vm.dataItem.inputSchema.properties.city.description).toBe('新的城市说明');

    await inputSection.find('.schema-editor__description textarea').setValue('');
    expect(wrapper.vm.dataItem.inputSchema.properties.city.description).toBeUndefined();

    await expandedDescriptionButton.trigger('click');
    expect(inputSection.find('.schema-editor__description').exists()).toBe(false);
    expect(findSchemaRow(inputSection, 'city').element.closest('.schema-editor__row-wrap')?.classList.contains('is-description-expanded')).toBe(false);
    wrapper.unmount();
  });

  it('keeps dotted schema field names editable as a single path segment', async (): Promise<void> => {
    const dataItem = createWidgetData();
    dataItem.inputSchema = {
      type: 'object',
      properties: {
        'temperature.celsius': {
          type: 'object',
          properties: {},
          required: []
        }
      },
      required: []
    };
    const wrapper = mountSidebarStateHost(dataItem);
    const inputSection = findSidebarStatePanel(wrapper);

    await findSchemaRow(inputSection, 'temperature.celsius').find('[data-tooltip="添加子字段"]').trigger('click');

    expect(wrapper.vm.dataItem.inputSchema.properties['temperature.celsius'].properties?.field).toEqual({
      type: 'string'
    });
    expect(findSchemaRow(inputSection, 'field').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps PageSetter focused on basic settings after moving schema and script editing to side tabs', (): void => {
    const dataItem = createWeatherWidgetData();
    dataItem.inputSchema = { ...dataItem.inputSchema, description: '查询天气入参' };
    const wrapper = mountPageSetterHost(dataItem);
    const sectionTitles = readSectionBlockTitles(wrapper);

    expect(sectionTitles).toEqual(['基础', '尺寸']);
    expect(sectionTitles).not.toContain('入参');
    expect(sectionTitles).not.toContain('运行脚本');
    expect(sectionTitles).not.toContain('执行方法');
    expect(sectionTitles).not.toContain('出参');
    expect(sectionTitles).not.toContain('动态预览');
    expect(
      wrapper.findAllComponents({ name: 'ATabPaneStub' }).map((pane: VueWrapper): string | undefined => (pane.props() as { tab?: string }).tab)
    ).not.toContain('方法');
    expect(wrapper.find('.method-summary').exists()).toBe(false);
    expect(wrapper.find('.schema-editor').exists()).toBe(false);
    expect(wrapper.findComponent(PageSetter).emitted('edit-code')).toBeUndefined();
    expect(wrapper.vm.dataItem.execute).toEqual(dataItem.execute);
    expect(wrapper.vm.dataItem.metadata.skill).toBeUndefined();
    expect(wrapper.find('.schema-editor-modal-stub').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps previous schema and shows dialog validation feedback for invalid schema JSON', async (): Promise<void> => {
    const dataItem = createWidgetData();
    dataItem.inputSchema = {
      type: 'object',
      properties: {
        query: {
          type: 'string'
        }
      },
      required: ['query']
    };
    const previousInputSchema = dataItem.inputSchema;
    const wrapper = mountSidebarStateHost(dataItem);

    await findSidebarStateSchemaEditButton(wrapper).trigger('click');
    await wrapper.find('.schema-editor-modal-stub .schema-editor-monaco-stub').setValue('{broken');
    await nextTick();
    await wrapper
      .findAllComponents({ name: 'BButtonStub' })
      .find((button: VueWrapper): boolean => button.text() === '保存')
      ?.trigger('click');

    expect(wrapper.vm.dataItem.inputSchema).toEqual(previousInputSchema);
    expect(wrapper.find('.b-monaco-modal__error').text()).toContain('JSON 必须是合法格式');
    expect(wrapper.find('.schema-editor-modal-stub').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps previous schema and shows validation feedback for non-object schema JSON', async (): Promise<void> => {
    const dataItem = createWidgetData();
    dataItem.inputSchema = {
      type: 'object',
      properties: {
        query: {
          type: 'string'
        }
      },
      required: ['query']
    };
    const previousInputSchema = dataItem.inputSchema;
    const wrapper = mountSidebarStateHost(dataItem);

    await findSidebarStateSchemaEditButton(wrapper).trigger('click');
    await wrapper.find('.schema-editor-modal-stub .schema-editor-monaco-stub').setValue(
      JSON.stringify({
        type: 'array',
        items: {
          type: 'string'
        }
      })
    );
    await nextTick();
    await wrapper
      .findAllComponents({ name: 'BButtonStub' })
      .find((button: VueWrapper): boolean => button.text() === '保存')
      ?.trigger('click');

    expect(wrapper.vm.dataItem.inputSchema).toEqual(previousInputSchema);
    expect(wrapper.find('.b-monaco-modal__error').text()).toContain('Schema 必须是合法 JSON 对象');
    expect(wrapper.find('.schema-editor-modal-stub').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps previous schema and shows validation feedback for object schema without properties', async (): Promise<void> => {
    const dataItem = createWidgetData();
    dataItem.inputSchema = {
      type: 'object',
      properties: {
        query: {
          type: 'string'
        }
      },
      required: ['query']
    };
    const previousInputSchema = dataItem.inputSchema;
    const wrapper = mountSidebarStateHost(dataItem);

    await findSidebarStateSchemaEditButton(wrapper).trigger('click');
    await wrapper.find('.schema-editor-modal-stub .schema-editor-monaco-stub').setValue(JSON.stringify({ type: 'object' }));
    await nextTick();
    await wrapper
      .findAllComponents({ name: 'BButtonStub' })
      .find((button: VueWrapper): boolean => button.text() === '保存')
      ?.trigger('click');

    expect(wrapper.vm.dataItem.inputSchema).toEqual(previousInputSchema);
    expect(wrapper.find('.b-monaco-modal__error').text()).toContain('Schema 必须是合法 JSON 对象');
    expect(wrapper.find('.schema-editor-modal-stub').exists()).toBe(true);
    wrapper.unmount();
  });

  it('uses default schema as the JSON draft when the active schema is undefined on open', async (): Promise<void> => {
    const dataItem = createWidgetData();

    delete (dataItem as unknown as { outputSchema?: WidgetSchemaObject }).outputSchema;
    const wrapper = mountSidebarStateHost(dataItem);

    await findSidebarStateSchemaModeButton(wrapper, '出参').trigger('click');
    await findSidebarStateSchemaEditButton(wrapper).trigger('click');

    await nextTick();

    expect(JSON.parse((wrapper.find('.schema-editor-modal-stub .schema-editor-monaco-stub').element as HTMLTextAreaElement).value)).toEqual(
      DEFAULT_WIDGET_EMPTY_SCHEMA
    );
    wrapper.unmount();
  });

  it('opens schema guidance drawer from the input help icon', async (): Promise<void> => {
    const wrapper = mountSidebarStateHost(createWidgetData());
    const inputHelpIcon = findSidebarStateHelpIcon(wrapper);

    expect((inputHelpIcon.props() as { icon?: string }).icon).toBe('lucide:circle-alert');
    expect((inputHelpIcon.props() as { size?: number }).size).toBe(14);
    expect(
      wrapper
        .find('.sidebar-panel__help')
        .findAllComponents({ name: 'BButtonStub' })
        .some((button: VueWrapper): boolean => {
          const props = button.props() as { icon?: string };

          return props.icon === 'lucide:circle-alert';
        })
    ).toBe(false);

    await inputHelpIcon.trigger('click');
    expect(wrapper.find('.schema-help-drawer-stub').attributes('data-title')).toBe('入参填写说明');
    expect(wrapper.find('.schema-help-drawer-stub').text()).toContain('调用组件前需要提供的数据');
    expect(wrapper.find('.schema-help-drawer-stub').find('.schema-help__field-list').exists()).toBe(true);
    expect(wrapper.find('.schema-help-drawer-stub').findAll('.schema-help__field-item')).toHaveLength(3);
    expect(wrapper.find('.schema-help-drawer-stub').find('.schema-help__type').text()).toBe('string');
    expect(wrapper.find('.schema-help-drawer-stub').text()).toContain('必填');
    expect(wrapper.find('.schema-help-drawer-stub').text()).toContain('city');
    expect(wrapper.find('.schema-help-drawer-stub').text()).toContain('城市名称');
    expect(wrapper.find('.schema-help-drawer-stub').text()).toContain('查天气');

    wrapper.unmount();
  });

  it('expands the JSON schema example inline from the guidance drawer', async (): Promise<void> => {
    const wrapper = mountSidebarStateHost(createWidgetData());

    await findSidebarStateHelpIcon(wrapper).trigger('click');
    expect(wrapper.find('.schema-help__example').classes()).not.toContain('is-expanded');

    await wrapper.find('.schema-help__expand').trigger('click');

    expect(wrapper.find('.schema-help__example').classes()).toContain('is-expanded');
    expect(wrapper.find('.schema-help__expand').attributes('data-icon')).toBe('lucide:minimize-2');
    expect(wrapper.find('.schema-help__expand').attributes('data-tooltip')).toBe('收起查看');
    expect(wrapper.find('.schema-editor-modal-stub').exists()).toBe(false);
    expect(wrapper.find('.schema-help__example').text()).toContain('"required": ["city"]');
    expect(wrapper.find('.schema-help__example').text()).toContain('"description": "城市名称，例如上海"');
    wrapper.unmount();
  });

  it('resets the JSON schema example expanded state after closing the guidance drawer', async (): Promise<void> => {
    const wrapper = mountSidebarStateHost(createWidgetData());

    await findSidebarStateHelpIcon(wrapper).trigger('click');
    await wrapper.find('.schema-help__expand').trigger('click');
    expect(wrapper.find('.schema-help__example').classes()).toContain('is-expanded');

    wrapper.findComponent({ name: 'BDrawerStub' }).vm.$emit('update:open', false);
    await nextTick();
    expect(wrapper.find('.schema-help-drawer-stub').exists()).toBe(false);

    await findSidebarStateHelpIcon(wrapper).trigger('click');

    expect(wrapper.find('.schema-help__example').classes()).not.toContain('is-expanded');
    expect(wrapper.find('.schema-help__expand').attributes('data-icon')).toBe('lucide:maximize-2');
    wrapper.unmount();
  });
});
