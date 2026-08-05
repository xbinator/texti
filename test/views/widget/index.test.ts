/**
 * @file index.test.ts
 * @description 验证Widget 页面文件菜单事件绑定。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { readFileSync } from 'node:fs';
import { defineComponent, nextTick } from 'vue';
import type { ComponentPublicInstance, PropType } from 'vue';
import { shallowMount, type VueWrapper } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetData, WidgetElement, WidgetElementLoopConfig, WidgetSelectTarget, WidgetViewportInset } from '@/components/BWidget/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';
import WidgetPage from '@/views/widget/index.vue';

const onSaveMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const onSaveAsMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const onRenameMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const selectElementByIdMock = vi.hoisted(() => vi.fn());
const selectElementsByIdsMock = vi.hoisted(() => vi.fn());
const copySelectionMock = vi.hoisted(() => vi.fn());
const groupSelectionMock = vi.hoisted(() => vi.fn());
const ungroupSelectionMock = vi.hoisted(() => vi.fn());
const deleteSelectionMock = vi.hoisted(() => vi.fn());
const reorderSelectionMock = vi.hoisted(() => vi.fn());
const nanoidMock = vi.hoisted(() => vi.fn<() => string>());
const reloadMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const isLoadingMock = vi.hoisted((): { value: boolean; __v_isRef: true } => ({ value: false, __v_isRef: true }));
const loadErrorMock = vi.hoisted((): { value: string | null; __v_isRef: true } => ({ value: null, __v_isRef: true }));
const widgetDataMock = vi.hoisted((): { value: WidgetData } => ({
  value: {
    name: '',
    description: '',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    outputSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    dataSchema: {
      type: 'object',
      properties: {},
      required: []
    },
    execute: {
      code: 'export default class Weather extends Widget {}'
    },
    metadata: {},
    elements: []
  }
}));

vi.mock('nanoid', () => ({
  nanoid: nanoidMock
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({
    fullPath: '/widget/widget-1',
    params: {
      id: 'widget-1'
    }
  })
}));

vi.mock('@/views/widget/hooks/useSession', () => ({
  useSession: () => ({
    fileId: {
      value: 'widget-1',
      __v_isRef: true
    },
    isActive: {
      value: true,
      __v_isRef: true
    },
    isLoading: isLoadingMock,
    loadError: loadErrorMock,
    reload: reloadMock,
    currentTitle: {
      value: 'board.json',
      __v_isRef: true
    },
    fileState: {
      value: {
        id: 'widget-1',
        name: 'board',
        ext: 'json',
        path: null,
        content: ''
      },
      __v_isRef: true
    },
    data: widgetDataMock,
    actions: {
      onSave: onSaveMock,
      onSaveAs: onSaveAsMock,
      onRename: onRenameMock,
      onDelete: vi.fn(),
      onShowInFolder: vi.fn(),
      onCopyPath: vi.fn(),
      onCopyRelativePath: vi.fn(),
      onBlur: vi.fn()
    }
  })
}));

/**
 * 创建页面图层测试元素。
 * @param id - 元素 ID
 * @param title - 元素名称
 * @returns 测试元素
 */
function createWidgetElement(id: string, title: string): WidgetElement {
  return {
    id,
    name: 'rect',
    label: '矩形',
    icon: 'lucide:square',
    title,
    position: { x: 0, y: 0 },
    size: { width: 120, height: 80 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {}
  };
}

/**
 * 创建页面组合测试元素。
 * @param id - 组合元素 ID
 * @param title - 组合名称
 * @param children - 子元素
 * @returns 组合元素
 */
function createGroupElement(id: string, title: string, children: WidgetElement[]): WidgetElement {
  return {
    id,
    name: 'group',
    label: '组合',
    icon: 'lucide:group',
    title,
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
 * 创建页面循环配置测试数据。
 * @returns 循环配置
 */
function createLoopConfig(): WidgetElementLoopConfig {
  return {
    enabled: true,
    source: '$input.items',
    autoColumns: false,
    columns: 3,
    columnGap: 16,
    rowGap: 12,
    itemName: 'item',
    indexName: 'index'
  };
}

/**
 * 创建 BWidget 测试替身。
 * @returns BWidget 测试组件
 */
function createBWidgetStub(): ReturnType<typeof defineComponent> {
  return defineComponent({
    name: 'BWidget',
    props: {
      value: {
        type: Object as PropType<WidgetData>,
        required: true
      },
      select: {
        type: Object as PropType<WidgetSelectTarget>,
        default: null
      },
      fitViewportInset: {
        type: Object as PropType<Partial<WidgetViewportInset>>,
        default: (): Partial<WidgetViewportInset> => ({})
      }
    },
    emits: ['selection-change', 'update:select', 'update:value'],
    setup(_props, { attrs, expose }): Record<string, never> {
      expose({
        readAttrs: (): Record<string, unknown> => attrs,
        createElementFromClientPoint: vi.fn(),
        selectElementById: selectElementByIdMock,
        selectElementsByIds: selectElementsByIdsMock,
        copySelection: copySelectionMock,
        groupSelection: groupSelectionMock,
        ungroupSelection: ungroupSelectionMock,
        deleteSelection: deleteSelectionMock,
        reorderSelection: reorderSelectionMock
      });

      return {};
    },
    template: '<div class="b-widget-stub"></div>'
  });
}

/**
 * 创建 BPanelSplitter 测试替身，保留默认插槽渲染。
 * @returns BPanelSplitter 测试组件
 */
function createBPanelSplitterStub(): ReturnType<typeof defineComponent> {
  return defineComponent({
    name: 'BPanelSplitter',
    props: {
      size: {
        type: Number,
        default: 300
      }
    },
    emits: ['update:size'],
    template: '<section class="b-panel-splitter-stub"><slot /></section>'
  });
}

/**
 * BWidget 测试替身暴露能力。
 */
interface BWidgetStubExpose {
  /** 读取未声明为属性的透传参数 */
  readAttrs: () => Record<string, unknown>;
}

/**
 * 读取 BWidget 测试替身暴露能力。
 * @param wrapper - BWidget 测试替身包装器
 * @returns 替身暴露能力
 */
function getBWidgetStubExpose(wrapper: VueWrapper): ComponentPublicInstance & BWidgetStubExpose {
  return wrapper.vm as ComponentPublicInstance & BWidgetStubExpose;
}

/**
 * 等待异步事件处理完成。
 * @returns Promise
 */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('WidgetPage', (): void => {
  beforeEach((): void => {
    onSaveMock.mockClear();
    onSaveAsMock.mockClear();
    onRenameMock.mockClear();
    selectElementByIdMock.mockClear();
    selectElementsByIdsMock.mockClear();
    copySelectionMock.mockClear();
    groupSelectionMock.mockClear();
    ungroupSelectionMock.mockClear();
    deleteSelectionMock.mockClear();
    reorderSelectionMock.mockClear();
    reloadMock.mockReset().mockResolvedValue(undefined);
    isLoadingMock.value = false;
    loadErrorMock.value = null;
    nanoidMock.mockReset();
    widgetDataMock.value = createDefaultWidgetData();
  });

  it('uses the unified Widget session entry', (): void => {
    const source = readFileSync('src/views/widget/index.vue', 'utf-8');
    const sessionSource = readFileSync('src/views/widget/hooks/useSession.ts', 'utf-8');

    expect(source).toContain("import { useSession } from './hooks/useSession';");
    expect(source).toContain('const settingsWidth = ref(300);');
    expect(source).toContain("'--widget-page-settings-width':");
    expect(source).toContain('settingsWidth.value');
    expect(source).not.toContain('usePageSession');
    expect(sessionSource).not.toContain('settingsWidth');
    expect(sessionSource).not.toContain('widgetPageStyle');
  });

  it('does not render the Widget editor while the file session is loading', (): void => {
    isLoadingMock.value = true;
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: true,
          Icon: true
        }
      }
    });

    expect(wrapper.findComponent({ name: 'BWidget' }).exists()).toBe(false);
    expect(wrapper.find('.widget-page__state').text()).toContain('正在加载');
    wrapper.unmount();
  });

  it('syncs page settings data through the value model', async (): Promise<void> => {
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: true,
          Icon: true
        }
      }
    });
    const panelSettings = wrapper.findComponent({ name: 'PanelSettings' });
    const nextWidgetData: WidgetData = {
      ...createDefaultWidgetData(),
      name: 'profile_card',
      description: '根据用户资料生成卡片节点'
    };

    expect(panelSettings.props('value')).toBe(widgetDataMock.value);

    panelSettings.vm.$emit('update:value', nextWidgetData);
    await nextTick();

    expect(widgetDataMock.value).toEqual(nextWidgetData);
    wrapper.unmount();
  });

  it('syncs action sidebar data through the value model and save event', async (): Promise<void> => {
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      execute: {
        enabled: false,
        description: '已有脚本说明',
        code: 'export default class Weather extends Widget {}'
      }
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: true,
          BPanelSplitter: createBPanelSplitterStub(),
          Icon: true
        }
      }
    });
    const panelSettings = wrapper.findComponent({ name: 'PanelSettings' });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });
    const nextWidgetData: WidgetData = {
      ...widgetDataMock.value,
      execute: {
        enabled: false,
        description: '已有脚本说明',
        code: 'export default class Weather extends Widget { confirm() {} }'
      }
    };

    expect(panelSettings.exists()).toBe(true);
    expect(panelSidebar.exists()).toBe(true);
    expect(panelSidebar.props('value')).toBe(widgetDataMock.value);
    expect(wrapper.find('.widget-page__code-overlay').exists()).toBe(false);

    panelSidebar.vm.$emit('update:value', nextWidgetData);
    await nextTick();

    expect(widgetDataMock.value).toEqual(nextWidgetData);

    panelSidebar.vm.$emit('save');
    await flushPromises();

    expect(onSaveMock).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });

  it('keeps script editing owned by PanelSidebar instead of a page overlay', (): void => {
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      execute: {
        code: 'export default class Weather extends Widget {}'
      }
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: true,
          BPanelSplitter: createBPanelSplitterStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    expect(panelSidebar.exists()).toBe(true);
    expect(panelSidebar.props('value')).toBe(widgetDataMock.value);
    expect(panelSidebar.props('settingsWidth')).toBe(300);
    expect(wrapper.findComponent({ name: 'CodeEditor' }).exists()).toBe(false);
    expect(wrapper.find('.widget-page__code-overlay').exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders the settings splitter as an overlay so the canvas keeps the full page width', (): void => {
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: true,
          BPanelSplitter: createBPanelSplitterStub(),
          Icon: true
        }
      }
    });

    expect(wrapper.find('.widget-page__canvas').exists()).toBe(true);
    expect(wrapper.find('.widget-page__settings').exists()).toBe(true);

    wrapper.unmount();
  });

  it('offsets the widget toolbar from the overlaid settings panel', (): void => {
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: true,
          BPanelSplitter: createBPanelSplitterStub(),
          Icon: true
        }
      }
    });
    const source = readFileSync('src/views/widget/index.vue', 'utf-8');

    expect(wrapper.find('.widget-page').attributes('style') ?? '').toContain('--widget-page-settings-width: 300px;');
    expect(source).toContain('.widget-page :deep(.b-widget-toolbar__group--bottom-left)');
    expect(source).toContain('right: calc(var(--widget-page-settings-width) + 12px);');

    wrapper.unmount();
  });

  it('passes visible viewport insets to the widget canvas', async (): Promise<void> => {
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          BPanelSplitter: createBPanelSplitterStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });
    const widget = wrapper.findComponent({ name: 'BWidget' });

    expect(widget.props('fitViewportInset')).toEqual({
      left: 365,
      right: 300
    });

    panelSidebar.vm.$emit('update:size', 280);
    await nextTick();

    expect(widget.props('fitViewportInset')).toEqual({
      left: 325,
      right: 300
    });
    wrapper.unmount();
  });

  it('keeps design preview context inside widget value instead of passing a separate prop', (): void => {
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
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
      }
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const widget = wrapper.findComponent({ name: 'BWidget' });
    const widgetAttrs = getBWidgetStubExpose(widget).readAttrs();

    expect(widget.props('value')).toEqual(widgetDataMock.value);
    expect(widgetAttrs).not.toHaveProperty('renderContext');
    expect(widgetAttrs).not.toHaveProperty('render-context');
    wrapper.unmount();
  });

  it('selects the widget element when the sidebar layer emits selection', async (): Promise<void> => {
    const selectedElement = createWidgetElement('node-2', '节点 2');
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [createWidgetElement('node-1', '节点 1'), selectedElement]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [selectedElement]);
    await nextTick();

    expect(selectElementByIdMock).toHaveBeenCalledWith('node-2');
    expect(panelSidebar.props('selectedElementIds')).toEqual(['node-2']);
    wrapper.unmount();
  });

  it('selects a grouped child as the editable target when the sidebar layer emits child selection', async (): Promise<void> => {
    const selectedElement = createWidgetElement('node-2', '节点 2');
    const groupElement = createGroupElement('group-1', '组合', [createWidgetElement('node-1', '节点 1'), selectedElement]);
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [groupElement]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });
    const panelSettings = wrapper.findComponent({ name: 'PanelSettings' });

    panelSidebar.vm.$emit('select-elements', [selectedElement]);
    await nextTick();

    expect(selectElementByIdMock).toHaveBeenCalledWith('node-2');
    expect(panelSidebar.props('selectedElementIds')).toEqual(['node-2']);
    expect(panelSettings.props('select')).toEqual(selectedElement);
    wrapper.unmount();
  });

  it('selects the group widget element when the sidebar layer emits group selection', async (): Promise<void> => {
    const groupElement = createGroupElement('group-1', '组合', [createWidgetElement('node-1', '节点 1'), createWidgetElement('node-2', '节点 2')]);
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [groupElement, createWidgetElement('node-3', '节点 3')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [groupElement]);
    await nextTick();

    expect(selectElementByIdMock).toHaveBeenCalledWith('group-1');
    expect(panelSidebar.props('selectedElementIds')).toEqual(['group-1']);
    wrapper.unmount();
  });

  it('syncs sidebar highlights from canvas multi-selection changes', async (): Promise<void> => {
    const selectedElement = createWidgetElement('node-2', '节点 2');
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [createWidgetElement('node-1', '节点 1'), selectedElement, createWidgetElement('node-3', '节点 3')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });
    const widget = wrapper.findComponent({ name: 'BWidget' });

    panelSidebar.vm.$emit('select-elements', [selectedElement]);
    await nextTick();
    widget.vm.$emit('selection-change', ['node-1', 'node-3']);
    widget.vm.$emit('update:select', null);
    await nextTick();

    expect(panelSidebar.props('selectedElementIds')).toEqual(['node-1', 'node-3']);
    wrapper.unmount();
  });

  it('keeps a non-empty canvas selection when a stale metadata target is emitted after grouping', async (): Promise<void> => {
    const firstElement = createWidgetElement('node-1', '节点 1');
    const secondElement = createWidgetElement('node-2', '节点 2');
    const thirdElement = createWidgetElement('node-3', '节点 3');
    const groupedElement = createGroupElement('group-1', '组合', [createWidgetElement('node-1', '节点 1'), createWidgetElement('node-2', '节点 2')]);
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [firstElement, secondElement, thirdElement]
    };
    const staleMetadataTarget = widgetDataMock.value.metadata;
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });
    const panelSettings = wrapper.findComponent({ name: 'PanelSettings' });
    const widget = wrapper.findComponent({ name: 'BWidget' });

    widget.vm.$emit('selection-change', ['group-1']);
    widget.vm.$emit('update:value', {
      ...widgetDataMock.value,
      elements: [groupedElement, thirdElement]
    });
    widget.vm.$emit('update:select', staleMetadataTarget);
    await nextTick();

    expect(panelSidebar.props('selectedElementIds')).toEqual(['group-1']);
    expect(panelSettings.props('select')).toEqual(groupedElement);
    wrapper.unmount();
  });

  it('keeps the selected nested child highlighted from canvas selection changes', async (): Promise<void> => {
    const secondElement = createWidgetElement('node-2', '节点 2');
    const groupElement = createGroupElement('group-1', '组合', [createWidgetElement('node-1', '节点 1'), secondElement]);
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [groupElement, createWidgetElement('node-3', '节点 3')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });
    const widget = wrapper.findComponent({ name: 'BWidget' });

    widget.vm.$emit('update:select', secondElement);
    widget.vm.$emit('selection-change', ['node-1', 'node-2']);
    await nextTick();

    expect(panelSidebar.props('selectedElementIds')).toEqual(['node-2']);
    expect(panelSidebar.props('activeElementId')).toBe('node-2');
    wrapper.unmount();
  });

  it('copies the widget element when the sidebar layer emits copy', async (): Promise<void> => {
    nanoidMock.mockReturnValueOnce('copy0001');
    const copiedElement = createWidgetElement('node-2', '节点 2');
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [createWidgetElement('node-1', '节点 1'), copiedElement, createWidgetElement('node-3', '节点 3')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('copy-elements', [copiedElement]);
    await flushPromises();

    expect(widgetDataMock.value.elements.map((element: WidgetElement): string => element.id)).toEqual(['node-1', 'node-2', 'copy0001', 'node-3']);
    expect(widgetDataMock.value.elements[2]).toMatchObject({
      title: '节点 2',
      position: {
        x: 16,
        y: 16
      }
    });
    expect(selectElementByIdMock).toHaveBeenCalledWith('copy0001');
    expect(panelSidebar.props('selectedElementIds')).toEqual(['copy0001']);
    wrapper.unmount();
  });

  it('copies grouped widget elements as a new group when the sidebar layer emits group copy', async (): Promise<void> => {
    nanoidMock.mockReturnValueOnce('copy0001').mockReturnValueOnce('copy0002').mockReturnValueOnce('copy0003');
    const groupElement = createGroupElement('group-1', '组合', [createWidgetElement('node-1', '节点 1'), createWidgetElement('node-2', '节点 2')]);
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [groupElement, createWidgetElement('node-3', '节点 3')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('copy-elements', [groupElement]);
    await flushPromises();
    const copiedGroup = widgetDataMock.value.elements[1];

    expect(widgetDataMock.value.elements.map((element: WidgetElement): string => element.id)).toEqual(['group-1', 'copy0001', 'node-3']);
    expect(copiedGroup?.children?.map((element: WidgetElement): string => element.id)).toEqual(['copy0002', 'copy0003']);
    expect(selectElementByIdMock).toHaveBeenCalledWith('copy0001');
    expect(panelSidebar.props('selectedElementIds')).toEqual(['copy0001']);
    wrapper.unmount();
  });

  it('forwards settings multi-selection commands to the widget canvas', async (): Promise<void> => {
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [createWidgetElement('node-1', '节点 1'), createWidgetElement('node-2', '节点 2')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSettings = wrapper.findComponent({ name: 'PanelSettings' });

    panelSettings.vm.$emit('multi-command', 'group');
    panelSettings.vm.$emit('multi-command', 'ungroup');
    panelSettings.vm.$emit('multi-command', 'copy');
    panelSettings.vm.$emit('multi-command', 'delete');
    panelSettings.vm.$emit('multi-command', 'bringToFront');
    await nextTick();

    expect(groupSelectionMock).toHaveBeenCalledTimes(1);
    expect(ungroupSelectionMock).toHaveBeenCalledTimes(1);
    expect(copySelectionMock).toHaveBeenCalledTimes(1);
    expect(deleteSelectionMock).toHaveBeenCalledTimes(1);
    expect(reorderSelectionMock).toHaveBeenCalledWith('bringToFront');
    wrapper.unmount();
  });

  it('forwards settings element commands to the widget canvas', async (): Promise<void> => {
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [createGroupElement('group-1', '组合', [createWidgetElement('node-1', '节点 1'), createWidgetElement('node-2', '节点 2')])]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSettings = wrapper.findComponent({ name: 'PanelSettings' });

    panelSettings.vm.$emit('element-command', 'ungroup');
    await nextTick();

    expect(ungroupSelectionMock).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('ungroups the current settings multi-selection by selected ids', async (): Promise<void> => {
    const groupElement = createGroupElement('group-1', '组合', [createWidgetElement('node-1', '节点 1'), createWidgetElement('node-2', '节点 2')]);
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [groupElement, createWidgetElement('node-3', '节点 3')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const widget = wrapper.findComponent({ name: 'BWidget' });
    const panelSettings = wrapper.findComponent({ name: 'PanelSettings' });

    widget.vm.$emit('selection-change', ['group-1']);
    await nextTick();
    panelSettings.vm.$emit('multi-command', 'ungroup');
    await nextTick();

    expect(ungroupSelectionMock).toHaveBeenCalledTimes(1);
    expect(widgetDataMock.value.elements).toEqual([groupElement, createWidgetElement('node-3', '节点 3')]);
    wrapper.unmount();
  });

  it('applies settings style changes to the current multi-selection only', async (): Promise<void> => {
    const firstElement = createWidgetElement('node-1', '节点 1');
    const secondElement = createWidgetElement('node-2', '节点 2');
    const thirdElement = createWidgetElement('node-3', '节点 3');
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [firstElement, secondElement, thirdElement]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [firstElement, secondElement]);
    await nextTick();

    wrapper.findComponent({ name: 'PanelSettings' }).vm.$emit('multi-style-change', {
      backgroundColor: '#fef3c7',
      borderColor: '#f97316',
      borderRadius: 6,
      borderWidth: 2
    });
    await nextTick();

    expect(widgetDataMock.value.elements[0]?.style).toEqual({
      backgroundColor: '#fef3c7',
      borderColor: '#f97316',
      borderRadius: 6,
      borderWidth: 2
    });
    expect(widgetDataMock.value.elements[1]?.style).toEqual({
      backgroundColor: '#fef3c7',
      borderColor: '#f97316',
      borderRadius: 6,
      borderWidth: 2
    });
    expect(widgetDataMock.value.elements[2]?.style).toEqual({});
    expect(wrapper.findComponent({ name: 'PanelSettings' }).props('selectedElementIds')).toEqual(['node-1', 'node-2']);
    wrapper.unmount();
  });

  it('keeps locked direct multi-selection elements fixed during settings layout changes', async (): Promise<void> => {
    const lockedElement = {
      ...createWidgetElement('node-1', '节点 1'),
      locked: true,
      position: { x: 10, y: 20 },
      size: { width: 100, height: 50 }
    };
    const editableElement = {
      ...createWidgetElement('node-2', '节点 2'),
      position: { x: 130, y: 20 },
      size: { width: 100, height: 50 }
    };
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [lockedElement, editableElement]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [lockedElement, editableElement]);
    await nextTick();

    wrapper.findComponent({ name: 'PanelSettings' }).vm.$emit('multi-layout-change', {
      x: 20,
      y: 40,
      width: 440,
      height: 100
    });
    await nextTick();

    expect(widgetDataMock.value.elements[0]).toMatchObject({
      locked: true,
      position: { x: 10, y: 20 },
      size: { width: 100, height: 50 }
    });
    expect(widgetDataMock.value.elements[1]).toMatchObject({
      position: { x: 260, y: 40 },
      size: { width: 200, height: 100 }
    });
    wrapper.unmount();
  });

  it('ignores settings style changes for a multi-selection across different parents', async (): Promise<void> => {
    const childElement = createWidgetElement('child-1', '子节点');
    const groupElement = createGroupElement('group-1', '组合', [childElement]);
    const topElement = createWidgetElement('node-1', '节点 1');
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [groupElement, topElement]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [childElement, topElement]);
    await nextTick();

    wrapper.findComponent({ name: 'PanelSettings' }).vm.$emit('multi-style-change', {
      backgroundColor: '#fef3c7'
    });
    await nextTick();

    expect(widgetDataMock.value.elements[0]?.children?.[0]?.style).toEqual({});
    expect(widgetDataMock.value.elements[1]?.style).toEqual({});
    expect(wrapper.findComponent({ name: 'PanelSettings' }).props('selectedElementIds')).toEqual(['child-1', 'node-1']);
    wrapper.unmount();
  });

  it('accepts settings element updates through PanelSettings v-model', async (): Promise<void> => {
    const selectedElement = createWidgetElement('node-1', '节点 1');
    const loopConfig = createLoopConfig();
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [selectedElement, createWidgetElement('node-2', '节点 2')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });
    const panelSettings = wrapper.findComponent({ name: 'PanelSettings' });

    panelSidebar.vm.$emit('select-elements', [selectedElement]);
    await nextTick();

    const updatedElement = {
      ...selectedElement,
      loop: loopConfig
    };
    panelSettings.vm.$emit('update:value', {
      ...widgetDataMock.value,
      elements: [updatedElement, widgetDataMock.value.elements[1]]
    });
    panelSettings.vm.$emit('update:select', updatedElement);
    await nextTick();

    expect(widgetDataMock.value.elements[0]?.loop).toEqual(loopConfig);
    expect(widgetDataMock.value.elements[1]?.loop).toEqual(createDefaultWidgetElementLoopConfig());
    expect(panelSettings.props('select')).toEqual(widgetDataMock.value.elements[0]);
    wrapper.unmount();
  });

  it('refreshes the selected settings target when the selected element model changes', async (): Promise<void> => {
    const selectedElement = createWidgetElement('node-1', '节点 1');
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [selectedElement]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });
    const widget = wrapper.findComponent({ name: 'BWidget' });
    const updatedElement = {
      ...selectedElement,
      position: { x: 48, y: 56 },
      size: { width: 180, height: 120 }
    };

    panelSidebar.vm.$emit('select-elements', [selectedElement]);
    await nextTick();
    widget.vm.$emit('update:value', {
      ...widgetDataMock.value,
      elements: [updatedElement]
    });
    await nextTick();

    expect(wrapper.findComponent({ name: 'PanelSettings' }).props('select')).toEqual(updatedElement);
    wrapper.unmount();
  });

  it('applies settings layout changes to the current multi-selection bounds', async (): Promise<void> => {
    const firstElement = createWidgetElement('node-1', '节点 1');
    const secondElement = createWidgetElement('node-2', '节点 2');
    const thirdElement = createWidgetElement('node-3', '节点 3');
    firstElement.position = { x: 10, y: 20 };
    firstElement.size = { width: 100, height: 50 };
    secondElement.position = { x: 40, y: 100 };
    secondElement.size = { width: 80, height: 60 };
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [firstElement, secondElement, thirdElement]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [firstElement, secondElement]);
    await nextTick();

    wrapper.findComponent({ name: 'PanelSettings' }).vm.$emit('multi-layout-change', {
      x: 20,
      y: 10,
      width: 220,
      height: 280
    });
    await nextTick();

    expect(widgetDataMock.value.elements[0]?.position).toEqual({ x: 20, y: 10 });
    expect(widgetDataMock.value.elements[0]?.size).toEqual({ width: 200, height: 100 });
    expect(widgetDataMock.value.elements[1]?.position).toEqual({ x: 80, y: 170 });
    expect(widgetDataMock.value.elements[1]?.size).toEqual({ width: 160, height: 120 });
    expect(widgetDataMock.value.elements[2]?.position).toEqual({ x: 0, y: 0 });
    expect(widgetDataMock.value.elements[2]?.size).toEqual({ width: 120, height: 80 });
    wrapper.unmount();
  });

  it('ignores settings layout changes for a multi-selection across different parents', async (): Promise<void> => {
    const childElement = createWidgetElement('child-1', '子节点');
    const groupElement = createGroupElement('group-1', '组合', [childElement]);
    const topElement = createWidgetElement('node-1', '节点 1');
    childElement.position = { x: 10, y: 20 };
    topElement.position = { x: 80, y: 90 };
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [groupElement, topElement]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [childElement, topElement]);
    await nextTick();

    wrapper.findComponent({ name: 'PanelSettings' }).vm.$emit('multi-layout-change', {
      x: 24,
      width: 180
    });
    await nextTick();

    expect(widgetDataMock.value.elements[0]?.children?.[0]?.position).toEqual({ x: 10, y: 20 });
    expect(widgetDataMock.value.elements[1]?.position).toEqual({ x: 80, y: 90 });
    wrapper.unmount();
  });

  it('deletes the widget element when the sidebar layer emits delete', async (): Promise<void> => {
    const selectedElement = createWidgetElement('node-2', '节点 2');
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [createWidgetElement('node-1', '节点 1'), selectedElement]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [selectedElement]);
    panelSidebar.vm.$emit('delete-elements', [selectedElement]);
    await nextTick();

    expect(widgetDataMock.value.elements.map((element: WidgetElement): string => element.id)).toEqual(['node-1']);
    expect(panelSidebar.props('selectedElementIds')).toEqual([]);
    wrapper.unmount();
  });

  it('deletes grouped widget elements when the sidebar layer emits group delete', async (): Promise<void> => {
    const groupElement = createGroupElement('group-1', '组合', [createWidgetElement('node-1', '节点 1'), createWidgetElement('node-2', '节点 2')]);
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [groupElement, createWidgetElement('node-3', '节点 3')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [groupElement]);
    panelSidebar.vm.$emit('delete-elements', [groupElement]);
    await nextTick();

    expect(widgetDataMock.value.elements.map((element: WidgetElement): string => element.id)).toEqual(['node-3']);
    expect(panelSidebar.props('selectedElementIds')).toEqual([]);
    wrapper.unmount();
  });

  it('removes the parent group when deleting its last child from the sidebar layer', async (): Promise<void> => {
    const childElement = createWidgetElement('node-1', '节点 1');
    const groupElement = createGroupElement('group-1', '组合', [childElement]);
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [groupElement, createWidgetElement('node-2', '节点 2')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [childElement]);
    panelSidebar.vm.$emit('delete-elements', [childElement]);
    await nextTick();

    expect(widgetDataMock.value.elements.map((element: WidgetElement): string => element.id)).toEqual(['node-2']);
    expect(panelSidebar.props('selectedElementIds')).toEqual([]);
    wrapper.unmount();
  });

  it('reorders widget elements when the sidebar layer emits move', async (): Promise<void> => {
    const selectedElement = createWidgetElement('node-2', '节点 2');
    widgetDataMock.value = {
      ...createDefaultWidgetData(),
      elements: [createWidgetElement('node-1', '节点 1'), selectedElement, createWidgetElement('node-3', '节点 3')]
    };
    const wrapper = shallowMount(WidgetPage, {
      global: {
        stubs: {
          BWidget: createBWidgetStub(),
          Icon: true
        }
      }
    });
    const panelSidebar = wrapper.findComponent({ name: 'PanelSidebar' });

    panelSidebar.vm.$emit('select-elements', [selectedElement]);
    await nextTick();
    panelSidebar.vm.$emit('move-elements', { sourceIds: ['node-1'], targetIds: ['node-3'], position: 'before' });
    await nextTick();

    expect(widgetDataMock.value.elements.map((element: WidgetElement): string => element.id)).toEqual(['node-2', 'node-3', 'node-1']);
    expect(panelSidebar.props('selectedElementIds')).toEqual(['node-2']);
    wrapper.unmount();
  });
});
