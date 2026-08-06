/**
 * @file selecto-layer.component.test.ts
 * @description 验证 BWidget Selecto 图层不会抢占节点拖拽和右键菜单交互。
 * @vitest-environment jsdom
 */
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SelectoLayer from '@/components/BWidget/components/SelectoLayer.vue';
import type { WidgetViewport } from '@/components/BWidget/types';

/**
 * Selecto 拖拽起始事件测试替身。
 */
interface SelectoDragStartTestEvent {
  /** 原始输入事件 */
  inputEvent?: Event;
}

/**
 * Selecto 测试配置。
 */
interface SelectoTestOptions {
  /** 是否允许从当前事件启动框选 */
  dragCondition?: (event: SelectoDragStartTestEvent) => boolean;
}

let latestSelectoOptions: SelectoTestOptions | null = null;

vi.mock('selecto', () => ({
  default: class SelectoMock {
    /**
     * 缓存 Selecto 初始化配置，供测试读取 dragCondition。
     * @param options - Selecto 配置
     */
    public constructor(options: SelectoTestOptions) {
      latestSelectoOptions = options;
    }

    /**
     * 模拟 Selecto 事件注册。
     * @returns Selecto 实例
     */
    public on(): SelectoMock {
      return this;
    }

    /**
     * 模拟刷新可选目标。
     */
    public findSelectableTargets(): void {
      return undefined;
    }

    /**
     * 模拟滚动检查。
     */
    public checkScroll(): void {
      return undefined;
    }

    /**
     * 模拟销毁 Selecto。
     */
    public destroy(): void {
      return undefined;
    }
  }
}));

/**
 * 创建 Selecto 测试根节点。
 * @returns 测试根节点
 */
function createRootElement(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);

  return root;
}

/**
 * 创建带目标元素的鼠标事件。
 * @param target - 事件目标
 * @returns 鼠标事件
 */
function createMouseEventWithTarget(target: Element): MouseEvent {
  const event = new MouseEvent('mousedown', { bubbles: true });
  Object.defineProperty(event, 'target', {
    configurable: true,
    value: target
  });

  return event;
}

describe('SelectoLayer', (): void => {
  afterEach((): void => {
    latestSelectoOptions = null;
    document.body.innerHTML = '';
  });

  it('blocks drag selection from context menu items', (): void => {
    const root = createRootElement();
    const viewport: WidgetViewport = { center: { x: 0, y: 0 }, zoom: 1 };
    const menu = document.createElement('div');
    const menuButton = document.createElement('button');
    menu.className = 'b-widget-context-menu';
    menu.appendChild(menuButton);
    root.appendChild(menu);

    const wrapper = mount(SelectoLayer, {
      props: {
        root,
        activeTool: 'select',
        selection: ['node-1'],
        viewport,
        viewportSize: { width: 800, height: 600 }
      },
      attachTo: document.body
    });

    const canStartDrag = latestSelectoOptions?.dragCondition?.({
      inputEvent: createMouseEventWithTarget(menuButton)
    });

    expect(canStartDrag).toBe(false);
    wrapper.unmount();
  });

  it('blocks drag selection from widget element targets', (): void => {
    const root = createRootElement();
    const viewport: WidgetViewport = { center: { x: 0, y: 0 }, zoom: 1 };
    const node = document.createElement('div');
    node.className = 'b-widget-node b-widget-element';
    root.appendChild(node);

    const wrapper = mount(SelectoLayer, {
      props: {
        root,
        activeTool: 'select',
        selection: ['group-1'],
        viewport,
        viewportSize: { width: 800, height: 600 }
      },
      attachTo: document.body
    });

    const canStartDrag = latestSelectoOptions?.dragCondition?.({
      inputEvent: createMouseEventWithTarget(node)
    });

    expect(canStartDrag).toBe(false);
    wrapper.unmount();
  });
});
