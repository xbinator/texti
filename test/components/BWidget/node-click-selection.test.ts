/**
 * @file node-click-selection.test.ts
 * @description 验证 BWidget 节点点击选中后不会让节点消失。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { computed, defineComponent, nextTick, ref, toRaw } from 'vue';
import type { ComponentPublicInstance, ComputedRef, Ref } from 'vue';
import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BWidget from '@/components/BWidget/index.vue';
import type { WidgetData, WidgetElement, WidgetPoint, WidgetSelectTarget } from '@/components/BWidget/types';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import { queryWidgetElementTarget } from '@/components/BWidget/utils/widgetGeometry';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';

/**
 * 带内部选区的测试Widget 数据。
 */
type WidgetDataWithSelection = WidgetData & {
  /** 内部选区 */
  selection: string[];
};

/**
 * Moveable 拖拽事件测试数据。
 */
interface MoveableDragTestEvent {
  /** 操作目标 */
  target: Element;
  /** Moveable 拖拽总位移 */
  dist: [number, number];
  /** Moveable 基于已有 CSS transform 计算出的绝对 translate */
  translate: [number, number];
}

/**
 * Moveable 拖拽结束测试数据。
 */
interface MoveableDragEndTestEvent {
  /** 操作目标 */
  target: Element;
  /** 最后一帧拖拽数据 */
  lastEvent: MoveableDragTestEvent;
}

vi.mock('@/components/BWidget/components/Toolbar.vue', () => ({
  default: defineComponent({
    name: 'ToolbarStub',
    template: '<div class="toolbar-stub"></div>'
  })
}));

vi.mock('@/components/BWidget/components/SelectoLayer.vue', () => ({
  default: defineComponent({
    name: 'SelectoLayerStub',
    template: '<div class="selecto-layer-stub"></div>'
  })
}));

vi.mock('vue3-moveable/dist/moveable.js', () => ({
  default: defineComponent({
    name: 'VueMoveableStub',
    props: {
      target: {
        type: [Array, Object],
        default: null
      }
    },
    methods: {
      /**
       * 读取 Moveable 目标列表。
       * @param target - Moveable 目标
       * @returns 目标列表
       */
      getTargets(target: Element[] | Element | null): Element[] {
        if (Array.isArray(target)) {
          return target;
        }

        return target ? [target] : [];
      },
      /**
       * 模拟 Moveable 对外暴露的位置刷新方法。
       */
      updateRect(): void {
        return undefined;
      },
      /**
       * 读取目标元素当前 CSS translate。
       * @param target - Moveable 目标元素
       * @returns CSS translate
       */
      readTargetTranslate(target: Element): [number, number] {
        if (!(target instanceof HTMLElement)) {
          return [0, 0];
        }

        const match = target.style.transform.match(/translate\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/);
        if (!match) {
          return [0, 0];
        }

        return [Number(match[1]), Number(match[2])];
      },
      /**
       * 创建模拟 Moveable 真实 absolute translate 的拖拽事件。
       * @param targets - Moveable 目标元素列表
       * @returns 多选拖拽事件
       */
      createAbsoluteDragGroupEvent(targets: Element[]): { events: MoveableDragTestEvent[] } {
        return {
          events: targets.map((target: Element): MoveableDragTestEvent => {
            const currentTranslate = this.readTargetTranslate(target);

            return {
              target,
              dist: [40, 20],
              translate: [currentTranslate[0] + 40, currentTranslate[1] + 20]
            };
          })
        };
      },
      /**
       * 创建模拟 Moveable 真实 absolute translate 的拖拽结束事件。
       * @param targets - Moveable 目标元素列表
       * @returns 多选拖拽结束事件
       */
      createAbsoluteDragGroupEndEvent(targets: Element[]): { events: MoveableDragEndTestEvent[] } {
        const dragGroupEvent = this.createAbsoluteDragGroupEvent(targets);

        return {
          events: dragGroupEvent.events.map(
            (event: MoveableDragTestEvent): MoveableDragEndTestEvent => ({
              target: event.target,
              lastEvent: event
            })
          )
        };
      },
      /**
       * 创建模拟 Moveable 单目标真实 absolute translate 的拖拽结束事件。
       * @param targets - Moveable 目标元素列表
       * @returns 单目标拖拽结束事件
       */
      createAbsoluteDragEndEvent(targets: Element[]): MoveableDragEndTestEvent | null {
        return this.createAbsoluteDragGroupEndEvent(targets).events[0] ?? null;
      }
    },
    template: `
      <div v-if="getTargets(target).length" class="moveable-stub">
        <button
          class="moveable-absolute-drag-end"
          @click="$emit('drag-end', createAbsoluteDragEndEvent(getTargets(target)))"
        ></button>
        <button
          class="moveable-absolute-drag-group"
          @click="$emit('drag-group', createAbsoluteDragGroupEvent(getTargets(target)))"
        ></button>
        <button
          class="moveable-absolute-drag-group-end"
          @click="$emit('drag-group-end', createAbsoluteDragGroupEndEvent(getTargets(target)))"
        ></button>
      </div>
    `
  })
}));

/**
 * ResizeObserver 测试替身。
 */
class ResizeObserverMock {
  /** 监听目标元素尺寸。 */
  public observe = vi.fn();

  /** 停止监听目标元素。 */
  public unobserve = vi.fn();

  /** 断开全部尺寸监听。 */
  public disconnect = vi.fn();
}

/**
 * 创建节点点击测试用Widget 数据。
 * @returns Widget 数据
 */
function createNodeClickWidgetData(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [
      {
        id: 'node-1',
        name: 'rect',
        label: '矩形',
        icon: 'lucide:square',
        title: '节点',
        position: { x: 80, y: 60 },
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
 * 创建多选节点测试用Widget 数据。
 * @returns 带两个已选节点的Widget 数据
 */
function createMultiSelectedWidgetData(): WidgetDataWithSelection {
  return {
    ...createDefaultWidgetData(),
    elements: [
      {
        id: 'node-1',
        name: 'rect',
        label: '矩形',
        icon: 'lucide:square',
        title: '节点 1',
        position: { x: 80, y: 60 },
        size: { width: 180, height: 72 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {}
      },
      {
        id: 'node-2',
        name: 'rect',
        label: '矩形',
        icon: 'lucide:square',
        title: '节点 2',
        position: { x: 260, y: 120 },
        size: { width: 180, height: 72 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {}
      }
    ],
    selection: ['node-1', 'node-2']
  };
}

/**
 * 创建单选节点切换测试用Widget 数据。
 * @returns 带两个节点且已选中第一个节点的Widget 数据
 */
function createSingleSelectedTwoNodeWidgetData(): WidgetDataWithSelection {
  const data = createMultiSelectedWidgetData();

  return {
    ...data,
    selection: ['node-1']
  };
}

/**
 * 创建两个未内置选区的节点测试数据。
 * @returns 两个节点的Widget 数据
 */
function createTwoNodeWidgetData(): WidgetData {
  const data = createMultiSelectedWidgetData();

  return {
    ...createDefaultWidgetData(),
    metadata: data.metadata,
    elements: data.elements
  };
}

/**
 * 创建组合节点测试数据。
 * @returns 带组合节点的Widget 数据
 */
function createGroupedWidgetData(): WidgetData {
  const data = createMultiSelectedWidgetData();

  return {
    ...createDefaultWidgetData(),
    metadata: data.metadata,
    elements: [
      {
        id: 'group-1',
        name: 'group',
        label: '组合',
        icon: 'lucide:group',
        title: '组合',
        position: { x: 0, y: 0 },
        size: { width: 440, height: 220 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {},
        children: data.elements
      }
    ]
  };
}

/**
 * 创建锁定循环组合测试数据，模拟 movie-on-list Widget 结构。
 * @returns 带锁定循环组合节点的Widget 数据
 */
function createLockedLoopGroupedWidgetData(): WidgetData {
  const data = createGroupedWidgetData();
  const groupElement = data.elements[0];

  if (groupElement) {
    groupElement.loop = {
      ...groupElement.loop,
      enabled: true,
      source: 'movies',
      columns: 1
    };
    groupElement.locked = true;
    groupElement.children = groupElement.children?.map(
      (childElement: WidgetElement): WidgetElement => ({
        ...childElement,
        locked: true
      })
    );
  }

  return data;
}

/**
 * BWidget 暴露给页面层的创建命令。
 */
interface BWidgetExpose {
  /** 根据浏览器坐标创建元素 */
  createElementFromClientPoint: (name: string, point: WidgetPoint) => Promise<void>;
  /** 根据元素 ID 选择元素 */
  selectElementById: (id: string, options?: { activateElement?: boolean }) => void;
  /** 根据元素 ID 列表选中Widget元素 */
  selectElementsByIds: (ids: string[]) => void;
  /** 合并当前Widget选区 */
  groupSelection: () => void;
}

/**
 * BWidget v-model 回写测试宿主公开方法。
 */
interface WidgetRoundTripHostExpose {
  /** 根据元素 ID 列表选中Widget元素 */
  selectElementsByIds: (ids: string[]) => void;
  /** 合并当前Widget选区 */
  groupSelection: () => void;
  /** 读取父级接收到的Widget数据 */
  readDataItem: () => WidgetData;
  /** 读取父级接收到的设置目标 */
  readSelectedTarget: () => WidgetSelectTarget;
}

/**
 * 外部选择目标同步测试宿主公开方法。
 */
interface WidgetExternalSelectHostExpose {
  /** 更新外部Widget数据和设置目标 */
  updateValueAndSelect: (value: WidgetData, select: WidgetSelectTarget) => void;
}

/**
 * 初始外部选择组合测试宿主公开方法。
 */
interface WidgetInitialGroupSelectHostExpose {
  /** 读取父级接收到的设置目标 */
  readSelectedTarget: () => WidgetSelectTarget;
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
 * 查找测试节点。
 * @param wrapper - BWidget 测试包装器
 * @returns 节点包装器
 */
function findNode(wrapper: VueWrapper): DOMWrapper<Element> {
  return findNodeById(wrapper, 'node-1');
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
 * 判断设置目标是否为页面元信息。
 * @param target - 设置面板目标
 * @returns 是否为页面元信息
 */
function isMetadataSelectTarget(target: WidgetSelectTarget): boolean {
  return target !== null && typeof target === 'object' && !('id' in target);
}

/**
 * 判断设置目标是否为Widget 元素。
 * @param target - 设置面板目标
 * @returns 是否为Widget 元素
 */
function isElementSelectTarget(target: WidgetSelectTarget): target is WidgetElement {
  return target !== null && typeof target === 'object' && 'id' in target && typeof target.id === 'string';
}

/**
 * 创建带真实 v-model 回写的 BWidget 测试父组件。
 * @returns 父组件定义
 */
function createWidgetRoundTripHost(): ReturnType<typeof defineComponent> {
  return defineComponent({
    name: 'WidgetRoundTripHost',
    components: {
      BWidget
    },
    setup(
      _,
      { expose }
    ): {
      dataItem: Ref<WidgetData>;
      selectedTarget: Ref<WidgetSelectTarget>;
      selectedId: ComputedRef<string>;
      isSelectedCurrentElement: ComputedRef<boolean>;
      widgetRef: Ref<(ComponentPublicInstance & BWidgetExpose) | undefined>;
    } {
      const dataItem = ref<WidgetData>(createTwoNodeWidgetData());
      const selectedTarget = ref<WidgetSelectTarget>(dataItem.value.metadata);
      const widgetRef = ref<ComponentPublicInstance & BWidgetExpose>();
      const selectedId = computed<string>(() => (isElementSelectTarget(selectedTarget.value) ? selectedTarget.value.id : ''));
      const isSelectedCurrentElement = computed<boolean>(() =>
        isElementSelectTarget(selectedTarget.value) ? dataItem.value.elements.includes(selectedTarget.value) : false
      );

      expose({
        selectElementsByIds: (ids: string[]): void => {
          widgetRef.value?.selectElementsByIds(ids);
        },
        groupSelection: (): void => {
          widgetRef.value?.groupSelection();
        },
        readDataItem: (): WidgetData => dataItem.value,
        readSelectedTarget: (): WidgetSelectTarget => selectedTarget.value
      });

      return {
        dataItem,
        selectedTarget,
        selectedId,
        isSelectedCurrentElement,
        widgetRef
      };
    },
    template: `
      <div>
        <BWidget ref="widgetRef" v-model:value="dataItem" v-model:select="selectedTarget" />
        <span class="selected-id">{{ selectedId }}</span>
        <span class="selected-current">{{ isSelectedCurrentElement ? 'yes' : 'no' }}</span>
      </div>
    `
  });
}

/**
 * 创建外部选择目标同步测试宿主。
 * @returns 父组件定义
 */
function createWidgetExternalSelectHost(): ReturnType<typeof defineComponent> {
  return defineComponent({
    name: 'WidgetExternalSelectHost',
    components: {
      BWidget
    },
    setup(
      _,
      { expose }
    ): {
      dataItem: Ref<WidgetData>;
      selectedTarget: Ref<WidgetSelectTarget>;
    } {
      const dataItem = ref<WidgetData>(createTwoNodeWidgetData());
      const selectedTarget = ref<WidgetSelectTarget>({});

      expose({
        updateValueAndSelect: (value: WidgetData, select: WidgetSelectTarget): void => {
          dataItem.value = value;
          selectedTarget.value = select;
        }
      });

      return {
        dataItem,
        selectedTarget
      };
    },
    template: '<BWidget v-model:value="dataItem" v-model:select="selectedTarget" />'
  });
}

/**
 * 创建初始外部选择组合的测试宿主。
 * @returns 父组件定义
 */
function createWidgetInitialGroupSelectHost(): ReturnType<typeof defineComponent> {
  return defineComponent({
    name: 'WidgetInitialGroupSelectHost',
    components: {
      BWidget
    },
    setup(
      _,
      { expose }
    ): {
      dataItem: Ref<WidgetData>;
      selectedTarget: Ref<WidgetSelectTarget>;
    } {
      const dataItem = ref<WidgetData>(createGroupedWidgetData());
      const selectedTarget = ref<WidgetSelectTarget>(dataItem.value.elements[0] ?? null);

      expose({
        readSelectedTarget: (): WidgetSelectTarget => selectedTarget.value
      });

      return {
        dataItem,
        selectedTarget
      };
    },
    template: '<BWidget v-model:value="dataItem" v-model:select="selectedTarget" />'
  });
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
 * 派发带浏览器坐标的指针事件。
 * @param target - 目标对象
 * @param type - 事件类型
 * @param point - 浏览器坐标
 */
async function dispatchPointerEvent(target: Element | Window, type: string, point: { clientX: number; clientY: number }): Promise<void> {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      clientX: point.clientX,
      clientY: point.clientY
    })
  );
  await nextTick();
}

/**
 * 点击右键菜单项。
 * @param wrapper - BWidget 测试包装器
 * @param label - 菜单项文案
 */
async function clickContextMenuItem(wrapper: VueWrapper, label: string): Promise<void> {
  const item = wrapper
    .findAll<HTMLButtonElement>('.b-widget-context-menu__item')
    .find((menuItem: DOMWrapper<HTMLButtonElement>): boolean => menuItem.text().includes(label));
  expect(item).toBeDefined();
  await item?.trigger('click');
  await nextTick();
  await nextTick();
}

describe('BWidget node click selection', () => {
  beforeEach((): void => {
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

  it('keeps the clicked node visible and positioned after selection', async (): Promise<void> => {
    const data = createNodeClickWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data
      },
      attachTo: document.body
    });
    const node = findNode(wrapper);
    const initialTransform = node.attributes('style');

    await dispatchPointerEvent(node.element, 'pointerdown', { clientX: 100, clientY: 100 });
    await dispatchPointerEvent(window, 'pointerup', { clientX: 100, clientY: 100 });
    await nextTick();

    const selectedNode = findNode(wrapper);
    const selectedPayload = wrapper.emitted('update:select')?.at(-1)?.[0] as WidgetSelectTarget;
    const latestData = (wrapper.emitted('update:value') as Array<[WidgetData]> | undefined)?.at(-1)?.[0] ?? data;

    expect(selectedNode.exists()).toBe(true);
    expect(selectedNode.classes()).toContain('is-selected');
    expect(selectedNode.attributes('style')).toBe(initialTransform);
    expect(selectedPayload && 'id' in selectedPayload ? selectedPayload.id : '').toBe('node-1');
    expect(toRaw(selectedPayload)).toBe(latestData.elements[0]);
    expect(wrapper.find('.moveable-stub').exists()).toBe(true);
    wrapper.unmount();
  });

  it('creates a visible text node without opening the text editor', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createDefaultWidgetData()
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });

    await getWidgetExpose(wrapper).createElementFromClientPoint('text', { x: 400, y: 300 });
    await nextTick();

    const latestData = (wrapper.emitted('update:value') as Array<[WidgetData]> | undefined)?.at(-1)?.[0] ?? createDefaultWidgetData();
    const textElement = latestData.elements[0];
    const textNode = findNodeById(wrapper, textElement?.id ?? '');

    expect(textNode.exists()).toBe(true);
    expect(textNode.text()).toContain('文本');
    expect(textElement?.title).toBe('文本1');
    expect(textElement?.metadata).toEqual({ content: '文本' });
    expect(wrapper.find('textarea').exists()).toBe(false);
    wrapper.unmount();
  });

  it('creates new elements with schema default styles', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createDefaultWidgetData()
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });

    await getWidgetExpose(wrapper).createElementFromClientPoint('rect', { x: 240, y: 220 });
    await nextTick();
    const rectData = (wrapper.emitted('update:value') as Array<[WidgetData]> | undefined)?.at(-1)?.[0] ?? createDefaultWidgetData();

    await getWidgetExpose(wrapper).createElementFromClientPoint('text', { x: 400, y: 300 });
    await nextTick();
    const textData = (wrapper.emitted('update:value') as Array<[WidgetData]> | undefined)?.at(-1)?.[0] ?? createDefaultWidgetData();

    expect(rectData.elements[0]?.style).toEqual({
      backgroundColor: '#ffffff',
      borderColor: '#d9d9d9',
      borderRadius: 6,
      borderStyle: 'solid',
      borderWidth: 1,
      color: '#1f2937',
      fontSize: 14,
      fontWeight: 400,
      lineHeight: 1,
      textAlign: 'center',
      textVerticalAlign: 'middle'
    });
    expect(textData.elements[1]?.style).toEqual(rectData.elements[0]?.style);
    wrapper.unmount();
  });

  it('selects a node from the external element id command', async (): Promise<void> => {
    const data = createNodeClickWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data
      },
      attachTo: document.body
    });

    getWidgetExpose(wrapper).selectElementById('node-1');
    await nextTick();
    await nextTick();

    const selectedPayload = wrapper.emitted('update:select')?.at(-1)?.[0] as WidgetSelectTarget;

    expect(selectedPayload && 'id' in selectedPayload ? selectedPayload.id : '').toBe('node-1');
    expect(wrapper.find('.moveable-stub').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps moveable handles while pressing and moving an already selected single node', async (): Promise<void> => {
    const data = createSingleSelectedTwoNodeWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data,
        select: data.elements[0]
      },
      attachTo: document.body
    });
    await nextTick();
    await nextTick();

    await dispatchPointerEvent(findNodeById(wrapper, 'node-1').element, 'pointerdown', { clientX: 100, clientY: 100 });
    await dispatchPointerEvent(window, 'pointermove', { clientX: 140, clientY: 120 });

    expect(findNodeById(wrapper, 'node-1').classes()).toContain('is-selected');
    expect(wrapper.find('.moveable-stub').exists()).toBe(true);

    await dispatchPointerEvent(window, 'pointerup', { clientX: 140, clientY: 120 });
    wrapper.unmount();
  });

  it('does not move an already selected single node twice when Moveable finishes after pointerup', async (): Promise<void> => {
    const data = createSingleSelectedTwoNodeWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data,
        select: data.elements[0]
      },
      attachTo: document.body
    });
    await nextTick();
    await nextTick();

    await dispatchPointerEvent(findNodeById(wrapper, 'node-1').element, 'pointerdown', { clientX: 100, clientY: 100 });
    await dispatchPointerEvent(window, 'pointermove', { clientX: 140, clientY: 120 });
    await dispatchPointerEvent(window, 'pointerup', { clientX: 140, clientY: 120 });
    await nextTick();
    await wrapper.find('.moveable-absolute-drag-end').trigger('click');
    await nextTick();

    const latestData = (wrapper.emitted('update:value') as Array<[WidgetData]> | undefined)?.at(-1)?.[0] ?? data;

    expect(latestData.elements[0]?.position).toEqual({ x: 120, y: 80 });
    wrapper.unmount();
  });

  it('commits direct drag to the final pointerup position', async (): Promise<void> => {
    const data = createNodeClickWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data
      },
      attachTo: document.body
    });

    await dispatchPointerEvent(findNodeById(wrapper, 'node-1').element, 'pointerdown', { clientX: 100, clientY: 100 });
    await dispatchPointerEvent(window, 'pointermove', { clientX: 140, clientY: 120 });
    await dispatchPointerEvent(window, 'pointerup', { clientX: 170, clientY: 140 });
    await nextTick();

    const latestData = (wrapper.emitted('update:value') as Array<[WidgetData]> | undefined)?.at(-1)?.[0] ?? data;

    expect(latestData.elements[0]?.position).toEqual({ x: 150, y: 100 });
    wrapper.unmount();
  });

  it('keeps a grouped child editable while highlighting the whole group', async (): Promise<void> => {
    const data = createGroupedWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data
      },
      attachTo: document.body
    });

    getWidgetExpose(wrapper).selectElementById('node-2', { activateElement: true });
    await nextTick();
    await nextTick();

    const selectedPayload = wrapper.emitted('update:select')?.at(-1)?.[0] as WidgetSelectTarget;

    expect(selectedPayload && 'id' in selectedPayload ? selectedPayload.id : '').toBe('node-2');
    expect(findNodeById(wrapper, 'node-1').classes()).not.toContain('is-selected');
    expect(findNodeById(wrapper, 'node-2').classes()).toContain('is-selected');
    expect(findNodeById(wrapper, 'node-1').classes()).not.toContain('is-active-child');
    expect(findNodeById(wrapper, 'node-2').classes()).not.toContain('is-active-child');
    expect(wrapper.find('.moveable-stub').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps the settings target on an element while switching nodes', async (): Promise<void> => {
    const data = createSingleSelectedTwoNodeWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data,
        select: data.elements[0]
      },
      attachTo: document.body
    });
    await nextTick();
    await nextTick();
    const emittedBeforeSwitch = wrapper.emitted('update:select')?.length ?? 0;

    await dispatchPointerEvent(findNodeById(wrapper, 'node-2').element, 'pointerdown', { clientX: 300, clientY: 140 });

    const switchEmissions = ((wrapper.emitted('update:select') as Array<[WidgetSelectTarget]> | undefined) ?? []).slice(emittedBeforeSwitch);
    expect(switchEmissions.some(([target]: [WidgetSelectTarget]): boolean => isMetadataSelectTarget(target))).toBe(false);

    await dispatchPointerEvent(window, 'pointerup', { clientX: 300, clientY: 140 });
    await nextTick();

    const selectedPayload = wrapper.emitted('update:select')?.at(-1)?.[0] as WidgetSelectTarget;

    expect(selectedPayload && 'id' in selectedPayload ? selectedPayload.id : '').toBe('node-2');
    wrapper.unmount();
  });

  it('keeps the selected node and moveable handles after moving it one layer up from the context menu', async (): Promise<void> => {
    const data = createSingleSelectedTwoNodeWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data,
        select: data.elements[0]
      },
      attachTo: document.body
    });
    await nextTick();
    await nextTick();

    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 160, clientY: 120 });
    await clickContextMenuItem(wrapper, '上一层');

    const selectedPayload = wrapper.emitted('update:select')?.at(-1)?.[0] as WidgetSelectTarget;
    const latestData = (wrapper.emitted('update:value') as Array<[WidgetData]> | undefined)?.at(-1)?.[0] ?? data;

    expect(findNodeById(wrapper, 'node-1').classes()).toContain('is-selected');
    expect(wrapper.find('.moveable-stub').exists()).toBe(true);
    expect(selectedPayload && 'id' in selectedPayload ? selectedPayload.id : '').toBe('node-1');
    expect(latestData.elements.map((element: WidgetElement): string => element.id)).toEqual(['node-2', 'node-1']);
    wrapper.unmount();
  });

  it('keeps the parent v-model select bound to the current element after moving a node one layer up', async (): Promise<void> => {
    const wrapper = mount(createWidgetRoundTripHost(), {
      attachTo: document.body
    });
    await nextTick();
    await nextTick();

    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 160, clientY: 120 });
    expect(wrapper.find('.selected-id').text()).toBe('node-1');
    expect(wrapper.find('.selected-current').text()).toBe('yes');

    await clickContextMenuItem(wrapper, '上一层');

    expect(findNodeById(wrapper, 'node-1').classes()).toContain('is-selected');
    expect(wrapper.find('.moveable-stub').exists()).toBe(true);
    expect(wrapper.find('.selected-id').text()).toBe('node-1');
    expect(wrapper.find('.selected-current').text()).toBe('yes');
    wrapper.unmount();
  });

  it('keeps the grouped canvas node and moveable handles after grouping through v-model', async (): Promise<void> => {
    const wrapper = mount(createWidgetRoundTripHost(), {
      attachTo: document.body
    });
    await nextTick();
    await nextTick();

    const host = wrapper.vm as ComponentPublicInstance & WidgetRoundTripHostExpose;

    host.selectElementsByIds(['node-1', 'node-2']);
    await nextTick();
    await nextTick();
    host.groupSelection();
    await nextTick();
    await nextTick();

    const dataItem = host.readDataItem();
    const groupedElement = dataItem.elements[0];

    expect(groupedElement?.name).toBe('group');
    expect(findNodeById(wrapper, groupedElement?.id ?? '').classes()).toContain('is-selected');
    expect(wrapper.find('.moveable-stub').exists()).toBe(true);
    expect((host.readSelectedTarget() as WidgetElement | null)?.id).toBe(groupedElement?.id);
    wrapper.unmount();
  });

  it('drags the selected group when pointer starts from one of its children', async (): Promise<void> => {
    const data = createGroupedWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data,
        select: {}
      },
      attachTo: document.body
    });
    await nextTick();
    await nextTick();

    getWidgetExpose(wrapper).selectElementById('group-1');
    await nextTick();
    await nextTick();

    await dispatchPointerEvent(findNodeById(wrapper, 'node-1').element, 'pointerdown', { clientX: 100, clientY: 100 });
    await dispatchPointerEvent(window, 'pointermove', { clientX: 140, clientY: 120 });
    await dispatchPointerEvent(window, 'pointerup', { clientX: 140, clientY: 120 });
    await nextTick();

    const selectedPayload = wrapper.emitted('update:select')?.at(-1)?.[0] as WidgetSelectTarget;
    const latestData = (wrapper.emitted('update:value') as Array<[WidgetData]> | undefined)?.at(-1)?.[0] ?? data;
    const movedGroup = latestData.elements[0];
    const firstChild = movedGroup?.children?.[0];

    expect(selectedPayload && 'id' in selectedPayload ? selectedPayload.id : '').toBe('group-1');
    expect(movedGroup?.position).toEqual({ x: 40, y: 20 });
    expect(firstChild?.position).toEqual({ x: 80, y: 60 });
    wrapper.unmount();
  });

  it('keeps an externally selected group target when pressing one of its children before internal selection sync', async (): Promise<void> => {
    const wrapper = mount(createWidgetInitialGroupSelectHost(), {
      attachTo: document.body
    });

    await dispatchPointerEvent(findNodeById(wrapper, 'node-1').element, 'pointerdown', { clientX: 100, clientY: 100 });

    const selectedTarget = (wrapper.vm as ComponentPublicInstance & WidgetInitialGroupSelectHostExpose).readSelectedTarget();

    expect(selectedTarget && 'id' in selectedTarget ? selectedTarget.id : '').toBe('group-1');
    wrapper.unmount();
  });

  it('keeps an externally selected locked loop group when pressing one of its children', async (): Promise<void> => {
    const data = createLockedLoopGroupedWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data,
        select: data.elements[0]
      },
      attachTo: document.body
    });

    await dispatchPointerEvent(findNodeById(wrapper, 'node-1').element, 'pointerdown', { clientX: 100, clientY: 100 });
    await dispatchPointerEvent(window, 'pointermove', { clientX: 140, clientY: 120 });
    await dispatchPointerEvent(window, 'pointerup', { clientX: 140, clientY: 120 });
    await nextTick();

    const selectEmissions = ((wrapper.emitted('update:select') as Array<[WidgetSelectTarget]> | undefined) ?? []).map(
      ([target]: [WidgetSelectTarget]): string => (isElementSelectTarget(target) ? target.id : '')
    );
    const selectionEmissions = ((wrapper.emitted('selection-change') as Array<[string[]]> | undefined) ?? []).map(
      ([selection]: [string[]]): string[] => selection
    );

    expect(selectEmissions).not.toContain('node-1');
    expect(selectionEmissions).not.toContainEqual(['node-1']);
    if (selectEmissions.length > 0) {
      expect(selectEmissions.at(-1)).toBe('group-1');
    }
    if (selectionEmissions.length > 0) {
      expect(selectionEmissions.at(-1)).toEqual(['group-1']);
    }
    expect(findNodeById(wrapper, 'group-1').classes()).toContain('is-selected');
    expect(findNodeById(wrapper, 'node-1').classes()).not.toContain('is-selected');
    wrapper.unmount();
  });

  it('keeps moveable controls while directly dragging a selected group child', async (): Promise<void> => {
    const data = createGroupedWidgetData();
    const wrapper = mount(BWidget, {
      props: {
        value: data,
        select: {}
      },
      attachTo: document.body
    });
    await nextTick();
    await nextTick();

    getWidgetExpose(wrapper).selectElementById('group-1');
    await nextTick();
    await nextTick();

    await dispatchPointerEvent(findNodeById(wrapper, 'node-1').element, 'pointerdown', { clientX: 100, clientY: 100 });
    await dispatchPointerEvent(window, 'pointermove', { clientX: 140, clientY: 120 });

    expect(wrapper.find('.moveable-stub').exists()).toBe(true);
    expect(findNodeById(wrapper, 'group-1').attributes('style')).toContain('translate(40px, 20px)');
    expect(findNodeById(wrapper, 'node-1').attributes('style')).toContain('translate(120px, 80px)');

    await dispatchPointerEvent(window, 'pointerup', { clientX: 140, clientY: 120 });
    wrapper.unmount();
  });

  it('syncs an externally selected group target into the canvas selection', async (): Promise<void> => {
    const groupedData = createGroupedWidgetData();
    const groupedElement = groupedData.elements[0];
    const wrapper = mount(createWidgetExternalSelectHost(), {
      attachTo: document.body
    });
    await nextTick();
    await nextTick();

    (wrapper.vm as ComponentPublicInstance & WidgetExternalSelectHostExpose).updateValueAndSelect(groupedData, groupedElement ?? null);
    await nextTick();
    await flushPromises();
    await nextTick();

    expect(groupedElement?.name).toBe('group');
    expect(findNodeById(wrapper, groupedElement?.id ?? '').classes()).toContain('is-selected');
    expect(wrapper.find('.moveable-stub').exists()).toBe(true);
    wrapper.unmount();
  });

  it('does not open the text editor when a node is double clicked', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createNodeClickWidgetData()
      },
      attachTo: document.body
    });
    const node = findNode(wrapper);

    await dispatchPointerEvent(node.element, 'dblclick', { clientX: 100, clientY: 100 });
    await nextTick();

    expect(findNode(wrapper).exists()).toBe(true);
    expect(wrapper.find('textarea').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps multi selected nodes under the pointer when Moveable reports absolute translate', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createMultiSelectedWidgetData(),
        select: {}
      },
      attachTo: document.body
    });
    await nextTick();
    await nextTick();

    expect(wrapper.emitted('update:select')?.at(-1)?.[0]).toBeNull();

    await wrapper.find('.moveable-absolute-drag-group').trigger('click');
    await nextTick();

    expect(findNodeById(wrapper, 'node-1').attributes('style')).toContain('translate(120px, 80px)');
    expect(findNodeById(wrapper, 'node-2').attributes('style')).toContain('translate(300px, 140px)');

    await wrapper.find('.moveable-absolute-drag-group-end').trigger('click');
    await nextTick();

    expect(findNodeById(wrapper, 'node-1').attributes('style')).toContain('translate(120px, 80px)');
    expect(findNodeById(wrapper, 'node-2').attributes('style')).toContain('translate(300px, 140px)');
    wrapper.unmount();
  });

  it('opens the multi-selection context menu when right-clicking Moveable controls', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createMultiSelectedWidgetData(),
        select: {}
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    await nextTick();
    await nextTick();

    await wrapper.find('.moveable-stub').trigger('contextmenu', { clientX: 300, clientY: 200 });
    await nextTick();

    const mergeItem = wrapper
      .findAll<HTMLButtonElement>('.b-widget-context-menu__item')
      .find((menuItem: DOMWrapper<HTMLButtonElement>): boolean => menuItem.text().includes('合并'));

    expect(mergeItem).toBeDefined();
    expect(mergeItem?.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });
});
