/**
 * @file widget-canvas.component.test.ts
 * @description 验证 BWidget HTML Widget 渲染和注册元素创建能力。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent, nextTick, ref, toRaw } from 'vue';
import type { ComponentPublicInstance, Ref } from 'vue';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BWidget from '@/components/BWidget/index.vue';
import type { WidgetData, WidgetPoint } from '@/components/BWidget/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import { queryWidgetElementTarget } from '@/components/BWidget/utils/widgetGeometry';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';

vi.mock('@/components/BWidget/components/Toolbar.vue', () => ({
  default: defineComponent({
    name: 'ToolbarStub',
    emits: ['fit-content'],
    template: '<button class="toolbar-stub" type="button" @click="$emit(\'fit-content\')"></button>'
  })
}));

vi.mock('@/components/BWidget/components/SelectoLayer.vue', () => ({
  default: defineComponent({
    name: 'SelectoLayerStub',
    template: '<div class="selecto-layer-stub"></div>'
  })
}));

vi.mock('@/components/BWidget/components/MoveableLayer.vue', () => ({
  default: defineComponent({
    name: 'MoveableLayerStub',
    template: '<div class="moveable-layer-stub"></div>'
  })
}));

/**
 * BWidget 暴露给页面层的创建命令。
 */
interface BWidgetExpose {
  /** 根据浏览器坐标创建元素 */
  createElementFromClientPoint: (name: string, point: WidgetPoint) => Promise<void>;
}

/**
 * ResizeObserver 测试替身。
 */
class ResizeObserverMock {
  /** 最近创建的 ResizeObserver 回调。 */
  public static latestCallback: ResizeObserverCallback | null = null;

  /** 创建 ResizeObserver 测试替身。 */
  public constructor(callback: ResizeObserverCallback) {
    ResizeObserverMock.latestCallback = callback;
  }

  /** 监听目标元素尺寸。 */
  public observe = vi.fn();

  /** 停止监听目标元素。 */
  public unobserve = vi.fn();

  /** 断开全部尺寸监听。 */
  public disconnect = vi.fn();

  /**
   * 触发测试尺寸变更。
   * @param target - 尺寸变化目标
   * @param size - 目标尺寸
   */
  public static trigger(target: Element, size: { width: number; height: number }): void {
    ResizeObserverMock.latestCallback?.(
      [
        {
          target,
          contentRect: DOMRect.fromRect({
            height: size.height,
            width: size.width,
            x: 0,
            y: 0
          })
        } as ResizeObserverEntry
      ],
      {} as ResizeObserver
    );
  }
}

/**
 * 创建测试用Widget 数据。
 * @returns 测试Widget 数据
 */
function createWidgetDataFixture(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [
      {
        id: 'external-node-1',
        name: 'rect',
        label: '矩形',
        icon: 'lucide:square',
        title: '外部节点',
        position: { x: 24, y: 36 },
        size: { width: 180, height: 72 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {}
      }
    ]
  };
}

/**
 * 创建带嵌套组合的测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createNestedWidgetDataFixture(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [
      {
        id: 'group-1',
        name: 'group',
        label: '组合',
        icon: 'lucide:group',
        title: '组合',
        position: { x: 100, y: 120 },
        size: { width: 240, height: 160 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {},
        children: [
          {
            id: 'child-node-1',
            name: 'rect',
            label: '矩形',
            icon: 'lucide:square',
            title: '子节点',
            position: { x: 24, y: 36 },
            size: { width: 120, height: 64 },
            rotation: 0,
            style: {},
            loop: createDefaultWidgetElementLoopConfig(),
            metadata: {}
          }
        ]
      }
    ]
  };
}

/**
 * 创建带双层嵌套组合的测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createDeepNestedWidgetDataFixture(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [
      {
        id: 'group-1',
        name: 'group',
        label: '组合',
        icon: 'lucide:group',
        title: '组合',
        position: { x: 100, y: 120 },
        size: { width: 240, height: 160 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {},
        children: [
          {
            id: 'nested-group-1',
            name: 'group',
            label: '组合',
            icon: 'lucide:group',
            title: '内层组合',
            position: { x: 24, y: 36 },
            size: { width: 120, height: 64 },
            rotation: 0,
            style: {},
            loop: createDefaultWidgetElementLoopConfig(),
            metadata: {},
            children: [
              {
                id: 'deep-child-node-1',
                name: 'rect',
                label: '矩形',
                icon: 'lucide:square',
                title: '深层子节点',
                position: { x: 10, y: 12 },
                size: { width: 40, height: 30 },
                rotation: 0,
                style: {},
                loop: createDefaultWidgetElementLoopConfig(),
                metadata: {}
              }
            ]
          }
        ]
      }
    ]
  };
}

/**
 * 读取 BWidget 暴露命令。
 * @param wrapper - BWidget 测试包装器
 * @returns 暴露命令
 */
function getWidgetExpose(wrapper: VueWrapper): ComponentPublicInstance & BWidgetExpose {
  return wrapper.vm as ComponentPublicInstance & BWidgetExpose;
}

/**
 * 通过节点 ID 查找测试节点。
 * @param wrapper - BWidget 测试包装器
 * @param id - 节点 ID
 * @returns 节点包装器
 */
function findNodeById(wrapper: VueWrapper, id: string): DOMWrapper<Element> {
  const target = queryWidgetElementTarget(wrapper.element, id);

  return (
    wrapper.findAll<Element>('.b-widget-node').find((node: DOMWrapper<Element>): boolean => node.element === target) ??
    wrapper.find<Element>('.missing-widget-node')
  );
}

/**
 * 设置元素测试尺寸。
 * @param element - DOM 元素
 * @param rect - 目标尺寸
 */
function setElementRect(element: Element, rect: { left: number; top: number; width: number; height: number }): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: (): DOMRect =>
      DOMRect.fromRect({
        height: rect.height,
        width: rect.width,
        x: rect.left,
        y: rect.top
      })
  });
}

/**
 * 等待组件响应式更新完成。
 */
async function flushWidgetUpdates(): Promise<void> {
  await nextTick();
  await nextTick();
}

/**
 * 派发带浏览器坐标的指针事件。
 * @param target - 目标对象
 * @param type - 事件类型
 * @param point - 浏览器坐标
 */
async function dispatchPointerEvent(target: Element | Window, type: string, point: { clientX: number; clientY: number }): Promise<void> {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      button: 0,
      clientX: point.clientX,
      clientY: point.clientY
    })
  );
  await nextTick();
}

describe('BWidget canvas component', (): void => {
  beforeEach((): void => {
    ResizeObserverMock.latestCallback = null;
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
  });

  it('renders existing widget data as HTML nodes with registered element views', (): void => {
    const wrapper = mount(BWidget, {
      props: {
        value: createWidgetDataFixture()
      },
      attachTo: document.body
    });
    const node = findNodeById(wrapper, 'external-node-1');

    expect(wrapper.find('.b-widget-canvas__stage').exists()).toBe(true);
    expect(node.exists()).toBe(true);
    expect(node.attributes('style')).toContain('width: 180px');
    expect(node.attributes('style')).toContain('height: 72px');
    expect(node.attributes('style')).toContain('translate(24px, 36px)');
    expect(node.find('.widget-rect-element').exists()).toBe(true);
    expect(node.find('.widget-rect-element').attributes('aria-hidden')).toBe('true');
    expect(wrapper.find('svg').exists()).toBe(false);
    wrapper.unmount();
  });

  it('fits the viewport after widget data loads into an initially empty canvas', async (): Promise<void> => {
    const dataItem = ref<WidgetData>(createDefaultWidgetData());
    const Host = defineComponent({
      name: 'BWidgetAsyncDataHost',
      components: {
        BWidget
      },
      setup(): { dataItem: Ref<WidgetData> } {
        return { dataItem };
      },
      template: '<BWidget :value="dataItem" />'
    });
    const wrapper = mount(Host, {
      attachTo: document.body
    });
    ResizeObserverMock.trigger(wrapper.element, { width: 800, height: 600 });
    await flushWidgetUpdates();

    dataItem.value = {
      ...createDefaultWidgetData(),
      elements: [
        {
          id: 'loaded-node-1',
          name: 'rect',
          label: '矩形',
          icon: 'lucide:square',
          title: '加载节点',
          position: { x: 1000, y: 600 },
          size: { width: 200, height: 100 },
          rotation: 0,
          style: {},
          loop: createDefaultWidgetElementLoopConfig(),
          metadata: {}
        }
      ]
    };
    await flushWidgetUpdates();

    expect(wrapper.find('.b-widget-canvas__stage').attributes('style')).toContain('translate(-1100px, -650px)');
    wrapper.unmount();
  });

  it('fits the full content when toolbar zoom label is clicked', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createWidgetDataFixture()
      },
      attachTo: document.body
    });
    ResizeObserverMock.trigger(wrapper.element, { width: 800, height: 600 });
    await flushWidgetUpdates();

    await wrapper.find('.toolbar-stub').trigger('click');
    await flushWidgetUpdates();

    expect(wrapper.find('.b-widget-canvas__stage').attributes('style')).toContain('scale(2) translate(-114px, -72px)');
    wrapper.unmount();
  });

  it('fits toolbar zoom content inside the visible viewport inset', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        fitViewportInset: { left: 365, right: 300 },
        value: createWidgetDataFixture()
      },
      attachTo: document.body
    });
    ResizeObserverMock.trigger(wrapper.element, { width: 1200, height: 600 });
    await flushWidgetUpdates();

    await wrapper.find('.toolbar-stub').trigger('click');
    await flushWidgetUpdates();

    expect(wrapper.find('.b-widget-canvas__stage').attributes('style')).toContain('scale(1.57) translate(-93.3px, -72px)');
    wrapper.unmount();
  });

  it('does not fit the viewport after creating the first element locally', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createDefaultWidgetData()
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    ResizeObserverMock.trigger(wrapper.element, { width: 800, height: 600 });
    await flushWidgetUpdates();

    await getWidgetExpose(wrapper).createElementFromClientPoint('rect', { x: 100, y: 100 });
    await flushWidgetUpdates();

    const emitted = wrapper.emitted('update:value') as Array<[WidgetData]> | undefined;
    const createdId = emitted?.at(-1)?.[0].elements[0]?.id ?? '';

    expect(wrapper.find('.b-widget-canvas__stage').attributes('style')).toContain('scale(1) translate(0px, 0px)');
    expect(findNodeById(wrapper, createdId).attributes('style')).toContain('translate(-390px, -236px)');
    wrapper.unmount();
  });

  it('renders nested group children with absolute canvas positions', (): void => {
    const wrapper = mount(BWidget, {
      props: {
        value: createNestedWidgetDataFixture()
      },
      attachTo: document.body
    });
    const group = findNodeById(wrapper, 'group-1');
    const child = findNodeById(wrapper, 'child-node-1');

    expect(group.exists()).toBe(true);
    expect(child.exists()).toBe(true);
    expect(group.attributes('style')).toContain('translate(100px, 120px)');
    expect(child.attributes('style')).toContain('translate(124px, 156px)');
    wrapper.unmount();
  });

  it('previews nested group children while directly dragging the group', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createNestedWidgetDataFixture()
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    const group = findNodeById(wrapper, 'group-1');
    const child = findNodeById(wrapper, 'child-node-1');

    await dispatchPointerEvent(group.element, 'pointerdown', { clientX: 100, clientY: 100 });
    await dispatchPointerEvent(window, 'pointermove', { clientX: 130, clientY: 120 });

    expect(group.attributes('style')).toContain('translate(130px, 140px)');
    expect(child.attributes('style')).toContain('translate(154px, 176px)');
    window.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    wrapper.unmount();
  });

  it('previews locked nested children while directly dragging their parent group', async (): Promise<void> => {
    const dataItem = createNestedWidgetDataFixture();
    const group = dataItem.elements[0];
    if (group?.children?.[0]) {
      group.children[0].locked = true;
    }
    const wrapper = mount(BWidget, {
      props: {
        value: dataItem
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    const groupNode = findNodeById(wrapper, 'group-1');
    const child = findNodeById(wrapper, 'child-node-1');

    await dispatchPointerEvent(groupNode.element, 'pointerdown', { clientX: 100, clientY: 100 });
    await dispatchPointerEvent(window, 'pointermove', { clientX: 130, clientY: 120 });

    expect(groupNode.attributes('style')).toContain('translate(130px, 140px)');
    expect(child.attributes('style')).toContain('translate(154px, 176px)');
    window.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    wrapper.unmount();
  });

  it('selects locked elements without directly dragging their geometry', async (): Promise<void> => {
    const dataItem = createWidgetDataFixture();
    if (dataItem.elements[0]) {
      dataItem.elements[0].locked = true;
    }
    const wrapper = mount(BWidget, {
      props: {
        value: dataItem
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    const node = findNodeById(wrapper, 'external-node-1');

    await dispatchPointerEvent(node.element, 'pointerdown', { clientX: 100, clientY: 100 });
    await dispatchPointerEvent(window, 'pointermove', { clientX: 140, clientY: 120 });
    await dispatchPointerEvent(window, 'pointerup', { clientX: 140, clientY: 120 });
    await flushWidgetUpdates();

    expect(node.attributes('style')).toContain('translate(24px, 36px)');
    expect(wrapper.emitted('selection-change')?.at(-1)).toEqual([['external-node-1']]);
    wrapper.unmount();
  });

  it('previews nested group children while moving the selected group through Moveable', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createNestedWidgetDataFixture()
      },
      attachTo: document.body
    });
    const moveableLayer = wrapper.findComponent({ name: 'MoveableLayerStub' });

    moveableLayer.vm.$emit('resize-preview', [
      {
        id: 'group-1',
        position: { x: 130, y: 140 }
      }
    ]);
    await flushWidgetUpdates();

    const group = findNodeById(wrapper, 'group-1');
    const child = findNodeById(wrapper, 'child-node-1');
    expect(group.attributes('style')).toContain('translate(130px, 140px)');
    expect(child.attributes('style')).toContain('translate(154px, 176px)');
    wrapper.unmount();
  });

  it('previews nested group children while resizing the group', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createNestedWidgetDataFixture()
      },
      attachTo: document.body
    });
    const moveableLayer = wrapper.findComponent({ name: 'MoveableLayerStub' });

    moveableLayer.vm.$emit('resize-preview', [
      {
        id: 'group-1',
        position: { x: 100, y: 120 },
        size: { width: 480, height: 320 }
      }
    ]);
    await flushWidgetUpdates();

    const group = findNodeById(wrapper, 'group-1');
    const child = findNodeById(wrapper, 'child-node-1');
    expect(group.attributes('style')).toContain('width: 480px');
    expect(group.attributes('style')).toContain('height: 320px');
    expect(child.attributes('style')).toContain('width: 240px');
    expect(child.attributes('style')).toContain('height: 128px');
    expect(child.attributes('style')).toContain('translate(148px, 192px)');
    wrapper.unmount();
  });

  it('previews deep nested group descendants while resizing the parent group', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createDeepNestedWidgetDataFixture()
      },
      attachTo: document.body
    });
    const moveableLayer = wrapper.findComponent({ name: 'MoveableLayerStub' });

    moveableLayer.vm.$emit('resize-preview', [
      {
        id: 'group-1',
        position: { x: 100, y: 120 },
        size: { width: 480, height: 320 }
      }
    ]);
    await flushWidgetUpdates();

    const nestedGroup = findNodeById(wrapper, 'nested-group-1');
    const deepChild = findNodeById(wrapper, 'deep-child-node-1');
    expect(nestedGroup.attributes('style')).toContain('width: 240px');
    expect(nestedGroup.attributes('style')).toContain('height: 128px');
    expect(nestedGroup.attributes('style')).toContain('translate(148px, 192px)');
    expect(deepChild.attributes('style')).toContain('width: 80px');
    expect(deepChild.attributes('style')).toContain('height: 60px');
    expect(deepChild.attributes('style')).toContain('translate(168px, 216px)');
    wrapper.unmount();
  });

  it('renders rectangle box style properties on the element view', (): void => {
    const data = createWidgetDataFixture();
    const element = data.elements[0];
    element.style = {
      backgroundColor: '#f8fafc',
      borderColor: '#123456',
      borderStyle: 'dashed',
      borderWidth: { top: 1, right: 2, bottom: 3, left: 4 },
      borderRadius: { topLeft: 5, topRight: 6, bottomRight: 7, bottomLeft: 8 },
      padding: { top: 9, right: 10, bottom: 11, left: 12 }
    };
    const wrapper = mount(BWidget, {
      props: {
        value: data
      },
      attachTo: document.body
    });
    const nodeStyle = (findNodeById(wrapper, 'external-node-1').element as HTMLElement).style;

    expect(nodeStyle.backgroundColor).toBe('rgb(248, 250, 252)');
    expect(nodeStyle.borderColor).toBe('rgb(18, 52, 86)');
    expect(nodeStyle.borderStyle).toBe('dashed');
    expect(nodeStyle.borderTopWidth).toBe('1px');
    expect(nodeStyle.borderRightWidth).toBe('2px');
    expect(nodeStyle.borderBottomWidth).toBe('3px');
    expect(nodeStyle.borderLeftWidth).toBe('4px');
    expect(nodeStyle.borderTopLeftRadius).toBe('5px');
    expect(nodeStyle.borderTopRightRadius).toBe('6px');
    expect(nodeStyle.borderBottomRightRadius).toBe('7px');
    expect(nodeStyle.borderBottomLeftRadius).toBe('8px');
    wrapper.unmount();
  });

  it('creates a rectangle through the exposed registered element command', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createDefaultWidgetData()
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });

    await getWidgetExpose(wrapper).createElementFromClientPoint('rect', { x: 400, y: 300 });
    await flushWidgetUpdates();

    const emitted = wrapper.emitted('update:value') as Array<[WidgetData]> | undefined;
    const latestData = emitted?.at(-1)?.[0];
    const createdId = latestData?.elements[0]?.id ?? '';
    const node = findNodeById(wrapper, createdId);

    expect(node.exists()).toBe(true);
    expect(node.classes()).not.toContain('is-text');
    expect(node.attributes('style')).toContain('translate(-90px, -36px)');
    expect(latestData?.elements).toHaveLength(1);
    expect(createdId).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(latestData?.elements[0]).toMatchObject({
      name: 'rect',
      label: '矩形',
      icon: 'lucide:square',
      title: '矩形1',
      style: {},
      metadata: {}
    });
    expect(latestData).not.toHaveProperty('viewport');
    wrapper.unmount();
  });

  it('creates a text node without opening the removed text editor', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createDefaultWidgetData()
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });

    await getWidgetExpose(wrapper).createElementFromClientPoint('text', { x: 400, y: 300 });
    await flushWidgetUpdates();

    const emitted = wrapper.emitted('update:value') as Array<[WidgetData]> | undefined;
    const textNodeId = emitted?.at(-1)?.[0].elements[0]?.id ?? '';
    const textNode = findNodeById(wrapper, textNodeId);
    expect(textNode.exists()).toBe(true);
    expect(textNode.attributes('style')).toContain('width: 180px');
    expect(textNode.attributes('style')).toContain('height: 72px');
    expect(textNode.attributes('style')).toContain('translate(0px, 0px)');
    expect(textNode.text()).toContain('文本');
    expect(wrapper.find('textarea').exists()).toBe(false);
    wrapper.unmount();
  });

  it('hides variable placeholders in registered text element views outside runtime', (): void => {
    const data = createDefaultWidgetData();
    data.metadata = {
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
    };
    data.elements = [
      {
        id: 'text-context-node',
        name: 'text',
        label: '文本',
        icon: 'lucide:type',
        title: '天气文本',
        position: { x: 0, y: 0 },
        size: { width: 180, height: 72 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {
          content: '{{ $input.city }} 当前 {{ weather.temperature }}°C'
        }
      }
    ];
    const wrapper = mount(BWidget, {
      props: {
        value: data
      },
      attachTo: document.body
    });

    const textNodeContent = findNodeById(wrapper, 'text-context-node').text();

    expect(textNodeContent).toContain('当前 °C');
    expect(textNodeContent).not.toContain('上海');
    expect(textNodeContent).not.toContain('28');
    wrapper.unmount();
  });

  it('measures design-mode text node size from static fragments only', (): void => {
    const data = createDefaultWidgetData();
    data.metadata = {
      previewContext: {
        input: {},
        output: undefined,
        data: {
          longText: ['第一行', '第二行', '第三行', '第四行', '第五行', '第六行'].join('\n')
        }
      }
    };
    data.elements = [
      {
        id: 'text-measure-node',
        name: 'text',
        label: '文本',
        icon: 'lucide:type',
        title: '天气文本',
        position: { x: 0, y: 0 },
        size: { width: 120, height: 24 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {
          content: '前缀{{ longText }}'
        }
      }
    ];
    const wrapper = mount(BWidget, {
      props: {
        value: data
      },
      attachTo: document.body
    });
    const nodeStyle = (findNodeById(wrapper, 'text-measure-node').element as HTMLElement).style;

    // 设计态隐藏变量绑定，混合文本只按静态片段「前缀」测量，选框不被 6 行解析内容撑高。
    expect(Number.parseFloat(nodeStyle.height)).toBeLessThanOrEqual(72);
    wrapper.unmount();
  });

  it('keeps bound text resize commits on the context-normalized size from Moveable', async (): Promise<void> => {
    const data = createDefaultWidgetData();
    data.metadata = {
      previewContext: {
        input: {},
        output: undefined,
        data: {
          shortText: 'abcdef'
        }
      }
    };
    data.elements = [
      {
        id: 'text-resize-node',
        name: 'text',
        label: '文本',
        icon: 'lucide:type',
        title: '绑定文本',
        position: { x: 0, y: 0 },
        size: { width: 30, height: 12 },
        rotation: 0,
        style: { fontSize: 10 },
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {
          content: '{{ shortText }}'
        }
      }
    ];
    const wrapper = mount(BWidget, {
      props: {
        value: data
      },
      attachTo: document.body
    });

    wrapper.findComponent({ name: 'MoveableLayerStub' }).vm.$emit('resize', [
      {
        id: 'text-resize-node',
        size: { width: 30, height: 31 }
      }
    ]);
    await flushWidgetUpdates();

    const emitted = wrapper.emitted('update:value') as Array<[WidgetData]> | undefined;
    const latestData = emitted?.at(-1)?.[0];

    expect(latestData?.elements[0]?.size).toEqual({ width: 30, height: 31 });
    wrapper.unmount();
  });

  it('ignores unknown registered element names', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createDefaultWidgetData()
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });

    await getWidgetExpose(wrapper).createElementFromClientPoint('unknown-node', { x: 400, y: 300 });
    await flushWidgetUpdates();

    expect(wrapper.findAll('.b-widget-node')).toHaveLength(0);
    wrapper.unmount();
  });

  it('emits metadata select target for empty selection without changing widget data', async (): Promise<void> => {
    const data = createDefaultWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data
      },
      attachTo: document.body
    });

    await flushWidgetUpdates();

    const selectedPayload = wrapper.emitted('update:select')?.at(-1)?.[0] as WidgetData['metadata'];

    expect(selectedPayload).toEqual({});
    expect(toRaw(selectedPayload)).toBe(data.metadata);
    expect(wrapper.emitted('update:value')).toBeUndefined();
    wrapper.unmount();
  });
});
