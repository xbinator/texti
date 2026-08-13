/**
 * @file widget-runtime-view.component.test.ts
 * @description 验证 BWidget 运行态只读视图按内容边界缩放渲染 Widget。
 * @vitest-environment jsdom
 */
import type { RequestInput, RequestResponse } from 'types/request';
import type { WidgetData, WidgetRenderContext } from 'types/widget';
import { defineComponent, nextTick } from 'vue';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { cloneDeep } from 'lodash-es';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWidgetRuntime } from '@/components/BWidget/hooks/useWidgetRuntime';
import { createVariableValue } from '@/components/BSmart/utils/value';
import BWidgetRuntime from '@/components/BWidget/Runtime.vue';
import { createDefaultWidgetData } from '@/components/BWidget/utils/widgetData';
import { queryWidgetElementTarget } from '@/components/BWidget/utils/widgetGeometry';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';
import type { WidgetRuntimeChange } from '@/components/BWidget/utils/widgetRuntime';

/** ResizeObserver 回调。 */
type ResizeObserverCallbackLike = (entries: ResizeObserverEntry[]) => void;

/** 运行态测试容器宽度。 */
const RUNTIME_CONTAINER_WIDTH = 504;
/** 运行态测试容器高度。 */
const RUNTIME_CONTAINER_HEIGHT = 300;
/** ResizeObserver 已监听的目标元素。 */
let observedResizeTargets: Element[] = [];
/** ResizeObserver 当前上报的测试宽度。 */
let resizeObserverWidth = RUNTIME_CONTAINER_WIDTH;
/** ResizeObserver 当前上报的测试高度。 */
let resizeObserverHeight = RUNTIME_CONTAINER_HEIGHT;
/** ResizeObserver 测试替身的尺寸触发器。 */
let resizeObserverTriggers: Array<(width: number, height: number) => void> = [];

/**
 * 创建 ResizeObserver 测试条目。
 * @param target - 尺寸变化目标
 * @param width - 目标宽度
 * @param height - 目标高度
 * @returns ResizeObserver 测试条目
 */
function createResizeObserverEntry(target: Element, width: number, height: number): ResizeObserverEntry {
  return {
    target,
    contentRect: DOMRect.fromRect({ width, height }),
    contentBoxSize: [
      {
        inlineSize: width,
        blockSize: height
      }
    ]
  } as unknown as ResizeObserverEntry;
}

/**
 * ResizeObserver 测试替身。
 */
class ResizeObserverMock {
  /** ResizeObserver 回调。 */
  private readonly callback: ResizeObserverCallbackLike;

  /** 当前观察器监听的目标。 */
  private readonly targets: Element[] = [];

  /**
   * 创建 ResizeObserver 测试替身。
   * @param callback - ResizeObserver 回调
   */
  public constructor(callback: ResizeObserverCallbackLike) {
    this.callback = callback;
    resizeObserverTriggers.push((width: number, height: number): void => {
      this.notify(width, height);
    });
  }

  /**
   * 重置已创建的观察器。
   */
  public static reset(): void {
    resizeObserverTriggers = [];
  }

  /**
   * 向全部观察目标发送新的容器尺寸。
   * @param width - 新容器宽度
   * @param height - 新容器高度
   */
  public static trigger(width: number, height: number): void {
    resizeObserverWidth = width;
    resizeObserverHeight = height;
    resizeObserverTriggers.forEach((trigger: (nextWidth: number, nextHeight: number) => void): void => {
      trigger(width, height);
    });
  }

  /**
   * 向当前观察器发送尺寸变化。
   * @param width - 新容器宽度
   * @param height - 新容器高度
   */
  private notify(width: number, height: number): void {
    if (!this.targets.length) return;
    this.callback(this.targets.map((target: Element): ResizeObserverEntry => createResizeObserverEntry(target, width, height)));
  }

  /**
   * 监听目标元素尺寸。
   * @param target - 监听目标
   */
  public observe = (target: Element): void => {
    observedResizeTargets.push(target);
    this.targets.push(target);
    this.callback([createResizeObserverEntry(target, resizeObserverWidth, resizeObserverHeight)]);
  };

  /** 停止监听目标元素。 */
  public unobserve = vi.fn();

  /** 断开全部尺寸监听。 */
  public disconnect = vi.fn();
}

/**
 * 创建运行态测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createRuntimeWidgetData(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [
      {
        id: 'text-1',
        name: 'text',
        label: '文本',
        icon: 'lucide:type',
        title: '天气文本',
        position: { x: 24, y: 36 },
        size: { width: 180, height: 48 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {
          content: '{{ $input.city }} 当前 {{ weather.temperature }}°C'
        }
      },
      {
        id: 'rect-1',
        name: 'rect',
        label: '矩形',
        icon: 'lucide:square',
        title: '背景卡片',
        position: { x: 12, y: 18 },
        size: { width: 220, height: 96 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {}
      }
    ]
  };
}

/**
 * 创建带单元素循环的运行态测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createRuntimeLoopTextWidgetData(): WidgetData {
  const dataItem = createRuntimeWidgetData();

  return {
    ...dataItem,
    elements: dataItem.elements.map((element) =>
      element.id === 'text-1'
        ? {
            ...element,
            metadata: {
              ...element.metadata,
              content: '{{ item.name }} {{ index }}'
            },
            loop: {
              enabled: true,
              source: createVariableValue('products'),
              autoColumns: false,
              columns: 2,
              columnGap: 12,
              rowGap: 10,
              itemName: 'item',
              indexName: 'index'
            }
          }
        : element
    )
  };
}

/**
 * 创建带组合循环的运行态测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createRuntimeLoopGroupWidgetData(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [
      {
        id: 'card-group',
        name: 'group',
        label: '组合',
        icon: 'lucide:group',
        title: '卡片组合',
        position: { x: 20, y: 10 },
        size: { width: 120, height: 60 },
        rotation: 0,
        style: {},
        loop: {
          enabled: true,
          source: createVariableValue('products'),
          autoColumns: false,
          columns: 2,
          columnGap: 12,
          rowGap: 10,
          itemName: 'item',
          indexName: 'index'
        },
        metadata: {},
        children: [
          {
            id: 'card-bg',
            name: 'rect',
            label: '矩形',
            icon: 'lucide:square',
            title: '背景',
            position: { x: 0, y: 0 },
            size: { width: 120, height: 60 },
            rotation: 0,
            style: {},
            loop: createDefaultWidgetElementLoopConfig(),
            metadata: {}
          },
          {
            id: 'card-title',
            name: 'text',
            label: '文本',
            icon: 'lucide:type',
            title: '标题',
            position: { x: 4, y: 8 },
            size: { width: 80, height: 24 },
            rotation: 0,
            style: {},
            loop: createDefaultWidgetElementLoopConfig(),
            metadata: {
              content: '{{ item.name }}'
            }
          }
        ]
      }
    ]
  };
}

/**
 * 创建嵌套组合运行态测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createRuntimeNestedGroupWidgetData(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [
      {
        id: 'group-1',
        name: 'group',
        label: '组合',
        icon: 'lucide:group',
        title: '组合',
        position: { x: 20, y: 10 },
        size: { width: 120, height: 60 },
        rotation: 0,
        style: {},
        loop: createDefaultWidgetElementLoopConfig(),
        metadata: {},
        children: [
          {
            id: 'nested-title',
            name: 'text',
            label: '文本',
            icon: 'lucide:type',
            title: '标题',
            position: { x: 4, y: 8 },
            size: { width: 80, height: 24 },
            rotation: 0,
            style: {},
            loop: createDefaultWidgetElementLoopConfig(),
            metadata: {
              content: '{{ $input.city }}'
            }
          }
        ]
      }
    ]
  };
}

/**
 * 创建展示 message 字段的运行态测试Widget 数据。
 * @param code - 运行脚本
 * @returns 测试Widget 数据
 */
function createRuntimeMessageWidgetData(code: string): WidgetData {
  const dataItem = createRuntimeWidgetData();

  return {
    ...dataItem,
    execute: {
      code
    },
    elements: dataItem.elements.map((element) =>
      element.id === 'text-1'
        ? {
            ...element,
            metadata: {
              ...element.metadata,
              content: '{{ message }}'
            }
          }
        : element
    )
  };
}

/**
 * 创建异步脚本驱动循环内容的运行态测试Widget 数据。
 * @param code - 运行脚本
 * @returns 测试Widget 数据
 */
function createRuntimeAsyncLoopWidgetData(code: string): WidgetData {
  return {
    ...createDefaultWidgetData(),
    execute: {
      code
    },
    elements: [
      {
        id: 'product-name',
        name: 'text',
        label: '文本',
        icon: 'lucide:type',
        title: '商品名称',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 24 },
        rotation: 0,
        style: {},
        loop: {
          enabled: true,
          source: createVariableValue('products'),
          autoColumns: false,
          columns: 1,
          columnGap: 0,
          rowGap: 0,
          itemName: 'item',
          indexName: 'index'
        },
        metadata: {
          content: '{{ item.name }}'
        }
      }
    ]
  };
}

/**
 * 创建运行态渲染上下文。
 * @param city - 城市名称
 * @param temperature - 温度
 * @returns 渲染上下文
 */
function createRenderContext(city: string, temperature: number): WidgetRenderContext {
  return {
    input: {
      city
    },
    output: undefined,
    data: {
      weather: {
        temperature
      }
    }
  };
}

/**
 * 挂载运行态Widget 视图。
 * @param dataItem - Widget 数据
 * @param renderContext - 渲染上下文
 * @returns 组件包装器
 */
async function mountRuntime(dataItem: WidgetData, renderContext: WidgetRenderContext): Promise<VueWrapper> {
  const wrapper = mount(BWidgetRuntime, {
    props: {
      value: dataItem,
      renderContext
    },
    attachTo: document.body
  });

  await nextTick();
  await nextTick();

  return wrapper;
}

/**
 * 等待运行态异步脚本执行完成。
 * @returns 异步完成信号
 */
async function flushWidgetRuntime(): Promise<void> {
  await nextTick();
  await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  await nextTick();
}

/**
 * 创建可手动 resolve 的 Promise。
 * @returns deferred 对象
 */
function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolveDeferred: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve): void => {
    resolveDeferred = resolve;
  });

  return {
    promise,
    resolve: resolveDeferred
  };
}

/**
 * 模拟 Electron request 能力。
 * @param request - request 实现
 */
function stubElectronRequest(request: (input: RequestInput) => Promise<RequestResponse>): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      request
    }
  });
}

/**
 * 通过节点 ID 查找Widget 节点。
 * @param wrapper - 组件包装器
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

/** 运行态控制器注入探针。 */
const RuntimeControllerProbe = defineComponent({
  name: 'RuntimeControllerProbe',
  setup() {
    const runtime = useWidgetRuntime();
    /**
     * 模拟元素运行自己声明的交互表达式。
     */
    function runProbe(): void {
      runtime.value?.runInteraction("this.$sendMessage('确认下单')");
    }

    return { runProbe };
  },
  template: '<button class="runtime-interaction-probe" type="button" @click="runProbe">运行交互</button>'
});

/** WidgetNode 测试替身，用于验证运行态控制器能被元素层注入。 */
const WidgetNodeRuntimeProbeStub = defineComponent({
  name: 'WidgetNode',
  components: {
    RuntimeControllerProbe
  },
  template: '<RuntimeControllerProbe />'
});

/** 运行态计数交互探针。 */
const RuntimeCounterProbe = defineComponent({
  name: 'RuntimeCounterProbe',
  setup() {
    const runtime = useWidgetRuntime();
    /**
     * 模拟元素连续更新运行态数据。
     */
    function increment(): void {
      runtime.value?.runInteraction('this.count = (this.count || 0) + 1');
    }

    return { increment };
  },
  template: '<button class="runtime-counter-probe" type="button" @click="increment">递增</button>'
});

/** 运行态方法调用探针。 */
const RuntimeMethodProbe = defineComponent({
  name: 'RuntimeMethodProbe',
  setup() {
    const runtime = useWidgetRuntime();
    /**
     * 模拟元素用方法名触发业务事件。
     */
    function clickButton(): void {
      runtime.value?.run('buttonByClick');
    }

    return { clickButton };
  },
  template: '<button class="runtime-method-probe" type="button" @click="clickButton">调用方法</button>'
});

/** WidgetNode 测试替身，用于验证运行态交互使用本地最新状态串行执行。 */
const WidgetNodeRuntimeCounterStub = defineComponent({
  name: 'WidgetNode',
  components: {
    RuntimeCounterProbe
  },
  template: '<RuntimeCounterProbe />'
});

/** WidgetNode 测试替身，用于验证元素可按方法名触发运行态方法。 */
const WidgetNodeRuntimeMethodStub = defineComponent({
  name: 'WidgetNode',
  components: {
    RuntimeMethodProbe
  },
  template: '<RuntimeMethodProbe />'
});

describe('BWidgetRuntime', (): void => {
  beforeEach((): void => {
    observedResizeTargets = [];
    resizeObserverWidth = RUNTIME_CONTAINER_WIDTH;
    resizeObserverHeight = RUNTIME_CONTAINER_HEIGHT;
    ResizeObserverMock.reset();
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach((): void => {
    Reflect.deleteProperty(window, 'electronAPI');
    vi.unstubAllGlobals();
  });

  it('renders widget nodes with template content from the runtime context', async (): Promise<void> => {
    const wrapper = await mountRuntime(createRuntimeWidgetData(), createRenderContext('上海', 28));

    expect(wrapper.find('.b-widget-runtime').exists()).toBe(true);
    expect(findNodeById(wrapper, 'text-1').text()).toBe('上海 当前 28°C');
    expect(findNodeById(wrapper, 'rect-1').find('.widget-rect-element').exists()).toBe(true);
    wrapper.unmount();
  });

  it('renders loop-expanded text nodes with item and index locals', async (): Promise<void> => {
    const wrapper = await mountRuntime(createRuntimeLoopTextWidgetData(), {
      input: {},
      output: undefined,
      data: {
        products: [{ name: '拿铁' }, { name: '美式' }]
      }
    });

    expect(findNodeById(wrapper, 'text-1').exists()).toBe(false);
    expect(findNodeById(wrapper, 'text-1__loop_0').text()).toBe('拿铁 0');
    expect(findNodeById(wrapper, 'text-1__loop_1').text()).toBe('美式 1');
    wrapper.unmount();
  });

  it('renders nested group children with inherited runtime context', async (): Promise<void> => {
    const wrapper = await mountRuntime(createRuntimeNestedGroupWidgetData(), createRenderContext('上海', 28));

    expect(findNodeById(wrapper, 'group-1').exists()).toBe(true);
    expect(findNodeById(wrapper, 'nested-title').text()).toBe('上海');
    wrapper.unmount();
  });

  it('renders grouped loop nodes with the same item local per iteration', async (): Promise<void> => {
    const wrapper = await mountRuntime(createRuntimeLoopGroupWidgetData(), {
      input: {},
      output: undefined,
      data: {
        products: [{ name: '拿铁' }, { name: '美式' }]
      }
    });

    expect(findNodeById(wrapper, 'card-group').exists()).toBe(false);
    expect(findNodeById(wrapper, 'card-bg').exists()).toBe(false);
    expect(findNodeById(wrapper, 'card-title').exists()).toBe(false);
    expect(findNodeById(wrapper, 'card-group__loop_0').exists()).toBe(true);
    expect(findNodeById(wrapper, 'card-bg__loop_0').exists()).toBe(true);
    expect(findNodeById(wrapper, 'card-title__loop_0').text()).toBe('拿铁');
    expect(findNodeById(wrapper, 'card-group__loop_1').exists()).toBe(true);
    expect(findNodeById(wrapper, 'card-bg__loop_1').exists()).toBe(true);
    expect(findNodeById(wrapper, 'card-title__loop_1').text()).toBe('美式');
    wrapper.unmount();
  });

  it('uses content bounds instead of infinite canvas or editor viewport', async (): Promise<void> => {
    const wrapper = await mountRuntime(createRuntimeWidgetData(), createRenderContext('上海', 28));
    const stageViewport = wrapper.find('.b-widget-runtime__stage-viewport');
    const stage = wrapper.find('.b-widget-runtime__stage');
    const textNode = findNodeById(wrapper, 'text-1');
    const rectNode = findNodeById(wrapper, 'rect-1');

    expect(wrapper.find('.b-widget-infinite-viewport').exists()).toBe(false);
    expect(wrapper.find('.b-widget-canvas').exists()).toBe(false);
    expect(stageViewport.attributes('style')).toContain('height: 219.92727272727274px');
    expect(stage.attributes('style')).toContain('width: 220px');
    expect(stage.attributes('style')).toContain('height: 96px');
    expect(stage.attributes('style')).toContain('scale(2.290909090909091)');
    expect(textNode.attributes('style')).toContain('translate(12px, 18px)');
    expect(rectNode.attributes('style')).toContain('translate(0px, 0px)');
    wrapper.unmount();
  });

  it('uses metadata width as the base display width before fitting the host width', async (): Promise<void> => {
    const dataItem = {
      ...createRuntimeWidgetData(),
      metadata: {
        width: 320
      }
    };
    const wrapper = await mountRuntime(dataItem, createRenderContext('上海', 28));
    const root = wrapper.find('.b-widget-runtime');
    const stageViewport = wrapper.find('.b-widget-runtime__stage-viewport');
    const stage = wrapper.find('.b-widget-runtime__stage');

    expect(root.attributes('style')).not.toContain('width:');
    expect(root.attributes('style')).toContain('height: 139.63636363636363px');
    expect(stageViewport.attributes('style')).toContain('width: 320px');
    expect(stageViewport.attributes('style')).toContain('height: 139.63636363636363px');
    expect(stage.attributes('style')).toContain('scale(1.4545454545454546)');
    wrapper.unmount();
  });

  it('uses metadata height as the base display height before fitting the host width', async (): Promise<void> => {
    const dataItem = {
      ...createRuntimeWidgetData(),
      metadata: {
        height: 180
      }
    };
    const wrapper = await mountRuntime(dataItem, createRenderContext('上海', 28));
    const root = wrapper.find('.b-widget-runtime');
    const stageViewport = wrapper.find('.b-widget-runtime__stage-viewport');
    const stage = wrapper.find('.b-widget-runtime__stage');

    expect(root.attributes('style')).not.toContain('width:');
    expect(root.attributes('style')).toContain('height: 180px');
    expect(stageViewport.attributes('style')).toContain('width: 412.5px');
    expect(stageViewport.attributes('style')).toContain('height: 180px');
    expect(stage.attributes('style')).toContain('scale(1.875)');
    wrapper.unmount();
  });

  it('fits runtime content inside configured metadata width and height without distortion', async (): Promise<void> => {
    const dataItem = {
      ...createRuntimeWidgetData(),
      metadata: {
        width: 320,
        height: 320
      }
    };
    const wrapper = await mountRuntime(dataItem, createRenderContext('上海', 28));
    const root = wrapper.find('.b-widget-runtime');
    const stageViewport = wrapper.find('.b-widget-runtime__stage-viewport');
    const stage = wrapper.find('.b-widget-runtime__stage');

    expect(root.attributes('style')).not.toContain('width:');
    expect(root.attributes('style')).toContain('height: 320px');
    expect(stageViewport.attributes('style')).toContain('width: 320px');
    expect(stageViewport.attributes('style')).toContain('height: 320px');
    expect(stage.attributes('style')).toContain('top: 90.18181818181819px');
    expect(stage.attributes('style')).toContain('scale(1.4545454545454546)');
    wrapper.unmount();
  });

  it('scales a configured runtime display box down when the host width is narrower', async (): Promise<void> => {
    resizeObserverWidth = 160;
    const dataItem = {
      ...createRuntimeWidgetData(),
      metadata: {
        width: 320,
        height: 180
      }
    };
    const wrapper = await mountRuntime(dataItem, createRenderContext('上海', 28));
    const root = wrapper.find('.b-widget-runtime');
    const stageViewport = wrapper.find('.b-widget-runtime__stage-viewport');
    const stage = wrapper.find('.b-widget-runtime__stage');

    expect(root.attributes('style')).not.toContain('width:');
    expect(root.attributes('style')).not.toContain('max-width:');
    expect(root.attributes('style')).toContain('height: 90px');
    expect(stageViewport.attributes('style')).toContain('width: 160px');
    expect(stageViewport.attributes('style')).toContain('height: 90px');
    expect(stage.attributes('style')).toContain('top: 10.090909090909093px');
    expect(stage.attributes('style')).toContain('scale(0.7272727272727273)');
    wrapper.unmount();
  });

  it('scales configured runtime content down and restores it with consecutive container resizes', async (): Promise<void> => {
    const dataItem = {
      ...createRuntimeWidgetData(),
      metadata: {
        width: 320,
        height: 180
      }
    };
    const wrapper = await mountRuntime(dataItem, createRenderContext('上海', 28));
    const root = wrapper.find('.b-widget-runtime');
    const stageViewport = wrapper.find('.b-widget-runtime__stage-viewport');
    const stage = wrapper.find('.b-widget-runtime__stage');
    const textNode = findNodeById(wrapper, 'text-1');
    const initialTextNodeStyle = textNode.attributes('style');

    expect(root.attributes('style')).not.toContain('width:');
    expect(stageViewport.attributes('style')).toContain('width: 320px');
    expect(stageViewport.attributes('style')).toContain('height: 180px');

    ResizeObserverMock.trigger(160, 90);
    await nextTick();

    expect(stageViewport.attributes('style')).toContain('width: 160px');
    expect(stageViewport.attributes('style')).toContain('height: 90px');
    expect(stage.attributes('style')).toContain('top: 10.090909090909093px');
    expect(stage.attributes('style')).toContain('scale(0.7272727272727273)');
    expect(textNode.attributes('style')).toBe(initialTextNodeStyle);

    ResizeObserverMock.trigger(640, 360);
    await nextTick();

    expect(stageViewport.attributes('style')).toContain('width: 320px');
    expect(stageViewport.attributes('style')).toContain('height: 180px');
    expect(stage.attributes('style')).toContain('top: 20.181818181818187px');
    expect(stage.attributes('style')).toContain('scale(1.4545454545454546)');
    expect(textNode.attributes('style')).toBe(initialTextNodeStyle);
    wrapper.unmount();
  });

  it('ignores invalid runtime display metadata values', async (): Promise<void> => {
    const dataItem = {
      ...createRuntimeWidgetData(),
      metadata: {
        width: 'wide',
        height: -10
      }
    };
    const wrapper = await mountRuntime(dataItem, createRenderContext('上海', 28));
    const root = wrapper.find('.b-widget-runtime');
    const stageViewport = wrapper.find('.b-widget-runtime__stage-viewport');
    const stage = wrapper.find('.b-widget-runtime__stage');

    expect(root.attributes('style')).not.toContain('width:');
    expect(root.attributes('style')).toContain('height: 219.92727272727274px');
    expect(stageViewport.attributes('style')).toContain('height: 219.92727272727274px');
    expect(stage.attributes('style')).toContain('scale(2.290909090909091)');
    wrapper.unmount();
  });

  it('observes the runtime root element for scale-to-width layout', async (): Promise<void> => {
    const wrapper = await mountRuntime(createRuntimeWidgetData(), createRenderContext('上海', 28));
    const root = wrapper.find('.b-widget-runtime').element;

    expect(observedResizeTargets).toContain(root);
    wrapper.unmount();
  });

  it('does not render editor-only interaction layers', async (): Promise<void> => {
    const wrapper = await mountRuntime(createRuntimeWidgetData(), createRenderContext('上海', 28));

    expect(wrapper.find('.b-widget').exists()).toBe(false);
    expect(wrapper.find('.toolbar-stub').exists()).toBe(false);
    expect(wrapper.find('.moveable-layer-stub').exists()).toBe(false);
    expect(wrapper.find('.selecto-layer-stub').exists()).toBe(false);
    expect(wrapper.find('.widget-context-menu').exists()).toBe(false);
    expect(wrapper.find('.b-widget-node.is-selected').exists()).toBe(false);
    wrapper.unmount();
  });

  it('does not mutate the source widget data while rendering', async (): Promise<void> => {
    const dataItem = createRuntimeWidgetData();
    const originalWidgetData = cloneDeep(dataItem);
    const wrapper = await mountRuntime(dataItem, createRenderContext('上海', 28));

    await wrapper.setProps({
      renderContext: createRenderContext('杭州', 31)
    });
    await flushWidgetRuntime();

    expect(dataItem).toEqual(originalWidgetData);
    wrapper.unmount();
  });

  it('updates rendered template content when the runtime context changes', async (): Promise<void> => {
    const wrapper = await mountRuntime(createRuntimeWidgetData(), createRenderContext('上海', 28));

    await wrapper.setProps({
      renderContext: createRenderContext('杭州', 31)
    });
    await nextTick();

    expect(findNodeById(wrapper, 'text-1').text()).toBe('杭州 当前 31°C');
    wrapper.unmount();
  });

  it('ignores submit payloads from runtime nodes', async (): Promise<void> => {
    const output = {
      coffeeId: 'latte',
      size: 'large'
    };
    const wrapper = await mountRuntime(createRuntimeWidgetData(), createRenderContext('上海', 28));

    wrapper.findComponent({ name: 'WidgetNode' }).vm.$emit('submit', output);

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.emitted('change')).toBeUndefined();
    wrapper.unmount();
  });

  it('executes mounted scripts and emits runtime changes from the view boundary', async (): Promise<void> => {
    const dataItem = {
      ...createRuntimeWidgetData(),
      execute: {
        code: ['export default class Weather extends Widget {', '  onMounted() {', '    this.weather = { temperature: 29 }', '  }', '}'].join('\n')
      }
    };
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: dataItem,
        renderContext: {
          input: {
            city: '上海'
          },
          output: undefined,
          data: {}
        }
      },
      attachTo: document.body
    });

    await flushWidgetRuntime();

    expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({
      reason: 'mount',
      renderContext: {
        isMounted: true,
        data: {
          weather: {
            temperature: 29
          }
        }
      }
    });
    wrapper.unmount();
  });

  it('emits mounted send messages even when mounted does not change data', async (): Promise<void> => {
    const dataItem = createRuntimeMessageWidgetData(
      ['export default class Weather extends Widget {', '  onMounted() {', "    this.$sendMessage('加载完成')", '  }', '}'].join('\n')
    );
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: dataItem,
        renderContext: {
          input: {},
          output: undefined,
          data: {}
        }
      },
      attachTo: document.body
    });

    await flushWidgetRuntime();

    expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({
      reason: 'mount',
      renderContext: {
        isMounted: true,
        data: {}
      },
      sendMessage: {
        content: '加载完成',
        isError: false
      }
    });
    wrapper.unmount();
  });

  it('renders Widget class field data before the host writes runtime changes back', async (): Promise<void> => {
    const dataItem = createRuntimeMessageWidgetData(['export default class Weather extends Widget {', "  message = '晴天'", '}'].join('\n'));
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: dataItem,
        renderContext: {
          input: {},
          output: undefined,
          data: {}
        }
      },
      attachTo: document.body
    });

    await flushWidgetRuntime();

    expect(findNodeById(wrapper, 'text-1').text()).toBe('晴天');
    expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({
      reason: 'mount',
      renderContext: {
        data: {
          message: '晴天'
        }
      }
    });
    wrapper.unmount();
  });

  it('does not render stale data after unsupported legacy scripts fail', async (): Promise<void> => {
    const dataItem = createRuntimeMessageWidgetData(['Widget({', '  data() {', "    return { message: '旧数据' }", '  }', '})'].join('\n'));
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: dataItem,
        renderContext: {
          input: {},
          output: undefined,
          data: {
            message: '旧数据'
          }
        }
      },
      attachTo: document.body
    });

    await flushWidgetRuntime();

    expect(wrapper.emitted('change')).toBeUndefined();
    expect(findNodeById(wrapper, 'text-1').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps cancelled runtime widgets visible after an interrupted turn', async (): Promise<void> => {
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: createRuntimeMessageWidgetData('export default class Weather extends Widget {}'),
        renderContext: {
          input: {},
          output: undefined,
          data: {
            message: '已经展示的数据'
          }
        }
      },
      attachTo: document.body
    });

    await nextTick();

    expect(findNodeById(wrapper, 'text-1').text()).toBe('已经展示的数据');
    wrapper.unmount();
  });

  it('reruns mounted when a remounted runtime receives a different source payload', async (): Promise<void> => {
    const dataItem = createRuntimeMessageWidgetData(
      ['export default class Weather extends Widget {', '  onMounted() {', '    this.message = this.$input.message', '  }', '}'].join('\n')
    );
    const firstWrapper = mount(BWidgetRuntime, {
      props: {
        value: dataItem,
        renderContext: {
          input: {
            message: '第一版'
          },
          output: undefined,
          data: {}
        }
      },
      attachTo: document.body
    });

    await flushWidgetRuntime();
    expect(firstWrapper.emitted('change')?.[0]?.[0]).toMatchObject({
      reason: 'mount',
      renderContext: {
        data: {
          message: '第一版'
        }
      }
    });
    firstWrapper.unmount();

    const secondWrapper = mount(BWidgetRuntime, {
      props: {
        value: dataItem,
        renderContext: {
          input: {
            message: '第二版'
          },
          output: undefined,
          data: {}
        }
      },
      attachTo: document.body
    });

    await flushWidgetRuntime();

    expect(secondWrapper.emitted('change')?.[0]?.[0]).toMatchObject({
      reason: 'mount',
      renderContext: {
        data: {
          message: '第二版'
        }
      }
    });
    expect(findNodeById(secondWrapper, 'text-1').text()).toBe('第二版');
    secondWrapper.unmount();
  });

  it('reruns mounted when a runtime is remounted with the same source payload', async (): Promise<void> => {
    const request = vi.fn<() => Promise<RequestResponse>>(
      async (): Promise<RequestResponse> => ({
        status: 200,
        ok: true,
        url: 'https://api.example.com/weather',
        headers: {},
        data: {}
      })
    );
    const dataItem = createRuntimeMessageWidgetData(
      [
        'export default class Weather extends Widget {',
        '  async onMounted() {',
        "    await this.$http.get('https://api.example.com/weather')",
        "    this.message = '加载完成'",
        '  }',
        '}'
      ].join('\n')
    );
    const runtimeProps = {
      value: dataItem,
      renderContext: {
        input: {},
        output: undefined,
        data: {}
      }
    };
    stubElectronRequest(request);

    const firstWrapper = mount(BWidgetRuntime, {
      props: runtimeProps,
      attachTo: document.body
    });
    await flushWidgetRuntime();

    expect(firstWrapper.emitted('change')?.[0]?.[0]).toMatchObject({ reason: 'mount' });
    firstWrapper.unmount();

    const secondWrapper = mount(BWidgetRuntime, {
      props: runtimeProps,
      attachTo: document.body
    });
    await flushWidgetRuntime();

    expect(request).toHaveBeenCalledTimes(2);
    expect(secondWrapper.emitted('change')?.[0]?.[0]).toMatchObject({ reason: 'mount' });
    secondWrapper.unmount();
  });

  it('does not rerun mounted when the render context is already marked as mounted', async (): Promise<void> => {
    const request = vi.fn<() => Promise<RequestResponse>>(
      async (): Promise<RequestResponse> => ({
        status: 200,
        ok: true,
        url: 'https://api.example.com/weather',
        headers: {},
        data: {}
      })
    );
    const dataItem = createRuntimeMessageWidgetData(
      [
        'export default class Weather extends Widget {',
        '  async onMounted() {',
        "    await this.$http.get('https://api.example.com/weather')",
        "    this.message = '加载完成'",
        '  }',
        '}'
      ].join('\n')
    );
    const runtimeProps = {
      value: dataItem,
      renderContext: {
        input: {},
        output: undefined,
        data: {
          message: '加载完成'
        },
        isMounted: true
      }
    };
    stubElectronRequest(request);

    const wrapper = mount(BWidgetRuntime, {
      props: runtimeProps,
      attachTo: document.body
    });
    await flushWidgetRuntime();

    expect(request).not.toHaveBeenCalled();
    expect(wrapper.emitted('change')).toBeUndefined();
    expect(findNodeById(wrapper, 'text-1').text()).toBe('加载完成');
    wrapper.unmount();
  });

  it('waits for host runtime change commits before running queued interactions', async (): Promise<void> => {
    const commitDeferred = createDeferred<void>();
    const commitRuntimeChange = vi.fn(async (change: WidgetRuntimeChange): Promise<void> => {
      if (change.reason === 'mount') {
        await commitDeferred.promise;
      }
    });
    const runtimeProps = {
      value: {
        ...createRuntimeWidgetData(),
        execute: {
          code: ['export default class Counter extends Widget {', '  onMounted() {', '    this.count = 0', '  }', '}'].join('\n')
        }
      },
      renderContext: {
        input: {},
        output: undefined,
        data: {}
      },
      commitRuntimeChange
    };
    const wrapper = mount(BWidgetRuntime, {
      props: runtimeProps,
      global: {
        stubs: {
          WidgetNode: WidgetNodeRuntimeCounterStub
        }
      },
      attachTo: document.body
    });
    await flushWidgetRuntime();

    await wrapper.get('.runtime-counter-probe').trigger('click');
    await flushWidgetRuntime();

    const beforeCommitChanges = (wrapper.emitted('change') ?? []).map(([change]): WidgetRuntimeChange => change as WidgetRuntimeChange);
    expect(beforeCommitChanges.map((change): WidgetRuntimeChange['reason'] => change.reason)).toEqual(['mount']);

    commitDeferred.resolve();
    await flushWidgetRuntime();

    const afterCommitChanges = (wrapper.emitted('change') ?? []).map(([change]): WidgetRuntimeChange => change as WidgetRuntimeChange);
    expect(afterCommitChanges.map((change): WidgetRuntimeChange['reason'] => change.reason)).toEqual(['mount', 'interaction']);
    expect(commitRuntimeChange).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('does not start queued runtime interactions after the component unmounts', async (): Promise<void> => {
    const mountedRequestDeferred = createDeferred<RequestResponse>();
    const requests: RequestInput[] = [];
    stubElectronRequest(async (input: RequestInput): Promise<RequestResponse> => {
      requests.push(input);
      if (input.url === 'https://api.example.com/mounted') return mountedRequestDeferred.promise;

      return {
        status: 200,
        ok: true,
        url: input.url,
        headers: {},
        data: {}
      };
    });
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: {
          ...createRuntimeWidgetData(),
          execute: {
            code: [
              'export default class LifecycleWidget extends Widget {',
              '  async onMounted() {',
              "    await this.$http.get('https://api.example.com/mounted')",
              '  }',
              '',
              '  async buttonByClick() {',
              "    await this.$http.get('https://api.example.com/interaction')",
              '  }',
              '}'
            ].join('\n')
          }
        },
        renderContext: {
          input: {},
          output: undefined,
          data: {}
        }
      },
      global: {
        stubs: {
          WidgetNode: WidgetNodeRuntimeMethodStub
        }
      },
      attachTo: document.body
    });

    await vi.waitFor((): void => {
      expect(requests).toHaveLength(1);
    });
    await wrapper.get('.runtime-method-probe').trigger('click');
    wrapper.unmount();
    mountedRequestDeferred.resolve({
      status: 200,
      ok: true,
      url: 'https://api.example.com/mounted',
      headers: {},
      data: {}
    });
    await flushWidgetRuntime();
    await flushWidgetRuntime();

    expect(requests.map((request): string => request.url)).toEqual(['https://api.example.com/mounted']);
    expect(wrapper.emitted('change')).toBeUndefined();
  });

  it('keeps runtime interactions available after skipping mounted by render context state', async (): Promise<void> => {
    const runtimeProps = {
      value: {
        ...createRuntimeWidgetData(),
        execute: {
          code: 'export default class Weather extends Widget {}'
        }
      },
      renderContext: {
        input: {},
        output: undefined,
        data: {
          count: 0
        },
        isMounted: true
      }
    };
    const wrapper = mount(BWidgetRuntime, {
      props: runtimeProps,
      global: {
        stubs: {
          WidgetNode: WidgetNodeRuntimeCounterStub
        }
      },
      attachTo: document.body
    });
    await wrapper.get('.runtime-counter-probe').trigger('click');
    await flushWidgetRuntime();

    const changes = (wrapper.emitted('change') ?? []).map(([change]): WidgetRuntimeChange => change as WidgetRuntimeChange);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      reason: 'interaction',
      renderContext: {
        isMounted: true,
        data: {
          count: 1
        }
      }
    });
    wrapper.unmount();
  });

  it('recreates the display session when execute code changes on the same runtime instance', async (): Promise<void> => {
    /**
     * 创建按钮点击脚本。
     * @param message - 点击后写入的消息
     * @returns Widget 脚本
     */
    function createButtonCode(message: string): string {
      return ['export default class MovieList extends Widget {', '  buttonByClick() {', `    this.message = '${message}'`, '  }', '}'].join('\n');
    }

    const wrapper: VueWrapper = mount(BWidgetRuntime, {
      props: {
        value: createRuntimeMessageWidgetData(createButtonCode('第一版')),
        renderContext: {
          input: {},
          output: undefined,
          data: {}
        }
      },
      global: {
        stubs: {
          WidgetNode: WidgetNodeRuntimeMethodStub
        }
      },
      attachTo: document.body
    });
    await flushWidgetRuntime();

    await wrapper.setProps({
      value: createRuntimeMessageWidgetData(createButtonCode('第二版')),
      renderContext: {
        input: {},
        output: undefined,
        data: {}
      }
    });
    await flushWidgetRuntime();
    await wrapper.get('.runtime-method-probe').trigger('click');
    await flushWidgetRuntime();

    const changes = (wrapper.emitted('change') ?? []).map(([change]): WidgetRuntimeChange => change as WidgetRuntimeChange);
    const lastChange = changes[changes.length - 1];

    expect(lastChange).toMatchObject({
      reason: 'interaction',
      renderContext: {
        data: {
          message: '第二版'
        }
      }
    });
    wrapper.unmount();
  });

  it('ignores stale mounted results when execute code changes before the previous mounted finishes', async (): Promise<void> => {
    const requestDeferred = createDeferred<RequestResponse>();
    const request = vi.fn<(input: RequestInput) => Promise<RequestResponse>>((): Promise<RequestResponse> => requestDeferred.promise);
    stubElectronRequest(request);

    const wrapper: VueWrapper = mount(BWidgetRuntime, {
      props: {
        value: createRuntimeMessageWidgetData(
          [
            'export default class MovieList extends Widget {',
            '  async onMounted() {',
            "    await this.$http.get('https://api.example.com/slow')",
            "    this.message = '第一版完成'",
            '  }',
            '}'
          ].join('\n')
        ),
        renderContext: {
          input: {},
          output: undefined,
          data: {}
        }
      },
      attachTo: document.body
    });
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(request).toHaveBeenCalledTimes(1);

    await wrapper.setProps({
      value: createRuntimeMessageWidgetData(
        ['export default class MovieList extends Widget {', '  onMounted() {', "    this.message = '第二版'", '  }', '}'].join('\n')
      ),
      renderContext: {
        input: {},
        output: undefined,
        data: {}
      }
    });
    requestDeferred.resolve({ status: 200, ok: true, url: 'https://api.example.com/slow', headers: {}, data: {} });
    await flushWidgetRuntime();
    await flushWidgetRuntime();

    const changes = (wrapper.emitted('change') ?? []).map(([change]): WidgetRuntimeChange => change as WidgetRuntimeChange);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      reason: 'mount',
      renderContext: {
        data: {
          message: '第二版'
        }
      }
    });
    wrapper.unmount();
  });

  it('does not rerun mounted when props fall back to created on the same runtime instance', async (): Promise<void> => {
    const request = vi.fn<() => Promise<RequestResponse>>(
      async (): Promise<RequestResponse> => ({
        status: 200,
        ok: true,
        url: 'https://api.example.com/weather',
        headers: {},
        data: {}
      })
    );
    const dataItem = createRuntimeMessageWidgetData(
      [
        'export default class Weather extends Widget {',
        '  async onMounted() {',
        "    await this.$http.get('https://api.example.com/weather')",
        "    this.message = '加载完成'",
        '  }',
        '}'
      ].join('\n')
    );
    const initialRenderContext: WidgetRenderContext = {
      input: {},
      output: undefined,
      data: {}
    };
    stubElectronRequest(request);

    const wrapper: VueWrapper = mount(BWidgetRuntime, {
      props: {
        value: dataItem,
        renderContext: initialRenderContext
      },
      attachTo: document.body
    });

    await flushWidgetRuntime();

    const firstChange = wrapper.emitted('change')?.[0]?.[0] as WidgetRuntimeChange;
    await wrapper.setProps({
      renderContext: firstChange.renderContext
    });
    await flushWidgetRuntime();

    await wrapper.setProps({
      renderContext: initialRenderContext
    });
    await flushWidgetRuntime();

    expect(request).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted('change')).toHaveLength(1);
    wrapper.unmount();
  });

  it('remeasures viewport width after async mounted data renders loop content', async (): Promise<void> => {
    resizeObserverWidth = 0.1;
    stubElectronRequest(
      async (): Promise<RequestResponse> => ({
        status: 200,
        ok: true,
        url: 'https://api.example.com/products',
        headers: {},
        data: {
          products: [{ name: '拿铁' }, { name: '美式' }]
        }
      })
    );

    const dataItem = createRuntimeAsyncLoopWidgetData(
      [
        'export default class Weather extends Widget {',
        '  products = []',
        '  async onMounted() {',
        "    const response = await this.$http.get('https://api.example.com/products')",
        '    this.products = response.data.products',
        '  }',
        '}'
      ].join('\n')
    );
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: dataItem,
        renderContext: {
          input: {},
          output: undefined,
          data: {}
        }
      },
      attachTo: document.body
    });
    const root = wrapper.find<HTMLElement>('.b-widget-runtime').element;

    root.getBoundingClientRect = (): DOMRect =>
      DOMRect.fromRect({
        width: RUNTIME_CONTAINER_WIDTH,
        height: 0
      });

    await flushWidgetRuntime();
    await flushWidgetRuntime();

    const stageViewport = wrapper.find('.b-widget-runtime__stage-viewport');
    const heightStyle = stageViewport.element.getAttribute('style')?.match(/height:\s*([^;]+)/)?.[1] ?? '0';

    expect(findNodeById(wrapper, 'product-name__loop_0').text()).toBe('拿铁');
    expect(findNodeById(wrapper, 'product-name__loop_1').text()).toBe('美式');
    expect(Number.parseFloat(heightStyle)).toBeGreaterThan(100);
    wrapper.unmount();
  });

  it('renders patch preview before mounted scripts finish', async (): Promise<void> => {
    const requestDeferred = createDeferred<RequestResponse>();
    const request = vi.fn<(input: RequestInput) => Promise<RequestResponse>>(() => requestDeferred.promise);
    stubElectronRequest(request);

    const dataItem = createRuntimeMessageWidgetData(
      [
        'export default class Weather extends Widget {',
        '  async onMounted() {',
        "    this.message = '正在加载'",
        "    await this.$http.get('https://api.example.com/weather')",
        "    this.message = '加载完成'",
        '  }',
        '}'
      ].join('\n')
    );
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: dataItem,
        renderContext: {
          input: {},
          output: undefined,
          data: {}
        }
      },
      attachTo: document.body
    });

    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(findNodeById(wrapper, 'text-1').text()).toBe('正在加载');
    expect(wrapper.emitted('change')).toBeUndefined();

    requestDeferred.resolve({ status: 200, ok: true, url: 'https://api.example.com/weather', headers: {}, data: {} });
    await flushWidgetRuntime();

    expect(wrapper.emitted('change')?.[0]?.[0]).toMatchObject({
      reason: 'mount',
      renderContext: {
        data: {
          message: '加载完成'
        }
      }
    });
    wrapper.unmount();
  });

  it('runs concurrent mounted scripts independently for separate runtime instances', async (): Promise<void> => {
    const requestDeferreds = [createDeferred<RequestResponse>(), createDeferred<RequestResponse>()];
    let requestIndex = 0;
    const request = vi.fn<(input: RequestInput) => Promise<RequestResponse>>((): Promise<RequestResponse> => {
      const deferred = requestDeferreds[requestIndex] ?? requestDeferreds[requestDeferreds.length - 1];
      requestIndex += 1;
      return deferred.promise;
    });
    const dataItem = createRuntimeMessageWidgetData(
      [
        'export default class Weather extends Widget {',
        '  async onMounted() {',
        "    await this.$http.get('https://api.example.com/movies')",
        "    this.message = '加载完成'",
        '  }',
        '}'
      ].join('\n')
    );
    const runtimeProps = {
      value: dataItem,
      renderContext: {
        input: {},
        output: undefined,
        data: {}
      }
    };
    stubElectronRequest(request);

    const firstWrapper = mount(BWidgetRuntime, {
      props: runtimeProps,
      attachTo: document.body
    });
    await nextTick();
    await Promise.resolve();
    await nextTick();

    const secondWrapper = mount(BWidgetRuntime, {
      props: runtimeProps,
      attachTo: document.body
    });
    await nextTick();
    await Promise.resolve();
    await nextTick();

    expect(request).toHaveBeenCalledTimes(2);

    requestDeferreds[0].resolve({ status: 200, ok: true, url: 'https://api.example.com/movies', headers: {}, data: {} });
    requestDeferreds[1].resolve({ status: 200, ok: true, url: 'https://api.example.com/movies', headers: {}, data: {} });
    await flushWidgetRuntime();

    expect(firstWrapper.emitted('change')?.[0]?.[0]).toMatchObject({ reason: 'mount' });
    expect(secondWrapper.emitted('change')?.[0]?.[0]).toMatchObject({ reason: 'mount' });
    firstWrapper.unmount();
    secondWrapper.unmount();
  });

  it('does not run cleanup methods from node submit events', async (): Promise<void> => {
    const output = {
      coffeeId: 'latte'
    };
    const dataItem = {
      ...createRuntimeWidgetData(),
      execute: {
        code: ['export default class Weather extends Widget {', '  cleanup() {', '    this.submitted = { coffeeId: this.$input.coffeeId }', '  }', '}'].join(
          '\n'
        )
      }
    };
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: dataItem,
        renderContext: {
          input: {
            coffeeId: 'latte'
          },
          output: undefined,
          data: {}
        }
      },
      attachTo: document.body
    });

    wrapper.findComponent({ name: 'WidgetNode' }).vm.$emit('submit', output);
    await flushWidgetRuntime();

    expect(wrapper.emitted('submit')).toBeUndefined();
    expect(wrapper.emitted('change')).toBeUndefined();
    wrapper.unmount();
  });

  it('finishes runtime interactions that do not send a message', async (): Promise<void> => {
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: {
          ...createRuntimeWidgetData(),
          execute: {
            code: 'export default class Weather extends Widget {}'
          }
        },
        renderContext: {
          input: {},
          output: undefined,
          data: {
            count: 0
          }
        }
      },
      global: {
        stubs: {
          WidgetNode: WidgetNodeRuntimeCounterStub
        }
      },
      attachTo: document.body
    });

    await nextTick();
    await wrapper.get('.runtime-counter-probe').trigger('click');
    await flushWidgetRuntime();

    const changes = (wrapper.emitted('change') ?? []).map(([change]): WidgetRuntimeChange => change as WidgetRuntimeChange);

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      reason: 'interaction',
      renderContext: {
        data: {
          count: 1
        }
      }
    });
    expect(changes[0].sendMessage).toBeUndefined();
    wrapper.unmount();
  });

  it('provides the runtime controller to rendered elements', async (): Promise<void> => {
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: createRuntimeWidgetData(),
        renderContext: createRenderContext('上海', 28)
      },
      global: {
        stubs: {
          WidgetNode: WidgetNodeRuntimeProbeStub
        }
      },
      attachTo: document.body
    });

    await nextTick();
    await wrapper.get('.runtime-interaction-probe').trigger('click');
    await flushWidgetRuntime();

    const interactionChange = (wrapper.emitted('change') ?? [])
      .map(([change]): WidgetRuntimeChange => change as WidgetRuntimeChange)
      .find((change) => change.reason === 'interaction');

    expect(interactionChange).toMatchObject({
      reason: 'interaction',
      sendMessage: {
        content: '确认下单',
        isError: false
      }
    });
    wrapper.unmount();
  });

  it('lets rendered elements run widget methods on the mounted session instance', async (): Promise<void> => {
    const wrapper = mount(BWidgetRuntime, {
      props: {
        value: {
          ...createRuntimeWidgetData(),
          execute: {
            code: [
              'export default class MovieList extends Widget {',
              '  private cache = new Map()',
              '',
              '  onMounted() {',
              "    this.cache.set('message', '方法点击')",
              '  }',
              '',
              '  buttonByClick() {',
              "    this.message = this.cache.get('message')",
              '  }',
              '}'
            ].join('\n')
          }
        },
        renderContext: {
          input: {},
          output: undefined,
          data: {}
        }
      },
      global: {
        stubs: {
          WidgetNode: WidgetNodeRuntimeMethodStub
        }
      },
      attachTo: document.body
    });

    await flushWidgetRuntime();
    await wrapper.get('.runtime-method-probe').trigger('click');
    await flushWidgetRuntime();

    const changes = (wrapper.emitted('change') ?? []).map(([change]): WidgetRuntimeChange => change as WidgetRuntimeChange);

    expect(changes.map((change): WidgetRuntimeChange['reason'] => change.reason)).toEqual(['mount', 'interaction']);
    expect(changes[1]).toMatchObject({
      reason: 'interaction',
      renderContext: {
        data: {
          message: '方法点击'
        }
      }
    });
    wrapper.unmount();
  });

  it('uses the latest runtime props input after local interaction state exists', async (): Promise<void> => {
    const value = {
      ...createRuntimeWidgetData(),
      execute: {
        code: ['export default class InputWidget extends Widget {', '  buttonByClick() {', '    this.message = this.$input.message', '  }', '}'].join('\n')
      }
    };
    const wrapper: VueWrapper = mount(BWidgetRuntime, {
      props: {
        value,
        renderContext: {
          input: { message: '第一版' },
          output: undefined,
          data: {},
          isMounted: true
        }
      },
      global: {
        stubs: {
          WidgetNode: WidgetNodeRuntimeMethodStub
        }
      },
      attachTo: document.body
    });

    await flushWidgetRuntime();
    await wrapper.get('.runtime-method-probe').trigger('click');
    await flushWidgetRuntime();
    await wrapper.setProps({
      renderContext: {
        input: { message: '第二版' },
        output: undefined,
        data: { message: '第一版' },
        isMounted: true
      }
    });
    await wrapper.get('.runtime-method-probe').trigger('click');
    await flushWidgetRuntime();

    const changes = (wrapper.emitted('change') ?? []).map(([change]): WidgetRuntimeChange => change as WidgetRuntimeChange);
    const lastChange = changes[changes.length - 1];

    expect(lastChange).toMatchObject({
      reason: 'interaction',
      renderContext: {
        data: {
          message: '第二版'
        }
      }
    });
    wrapper.unmount();
  });
});
