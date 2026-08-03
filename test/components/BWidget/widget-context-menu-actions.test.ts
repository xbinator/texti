/**
 * @file widget-context-menu-actions.test.ts
 * @description 验证 BWidget 右键菜单动作会驱动Widget 数据变更。
 * @vitest-environment jsdom
 */
/* eslint-disable vue/one-component-per-file */
import { defineComponent, nextTick } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BWidget from '@/components/BWidget/index.vue';
import type { WidgetData, WidgetElement, WidgetSelectTarget } from '@/components/BWidget/types';
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
 * BWidget 暴露给页面层的测试命令。
 */
interface BWidgetExpose {
  /** 根据元素 ID 选择元素 */
  selectElementById: (id: string, options?: { activateElement?: boolean }) => void;
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

vi.mock('@/components/BWidget/components/MoveableLayer.vue', () => ({
  default: defineComponent({
    name: 'MoveableLayerStub',
    template: '<div class="moveable-layer-stub"></div>'
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
 * 创建测试元素。
 * @param id - 元素 ID
 * @param x - 横坐标
 * @param y - 纵坐标
 * @returns 测试元素
 */
function createElement(id: string, x: number, y: number): WidgetElement {
  return {
    id,
    name: 'rect',
    label: '矩形',
    icon: 'lucide:square',
    title: '节点',
    position: { x, y },
    size: { width: 100, height: 60 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {}
  };
}

/**
 * 创建测试组合元素。
 * @returns 测试组合元素
 */
function createGroupElement(): WidgetElement {
  return {
    id: 'group-1',
    name: 'group',
    label: '组合',
    icon: 'lucide:group',
    title: '组合',
    position: { x: 80, y: 60 },
    size: { width: 240, height: 100 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {},
    children: [createElement('node-1', 0, 0), createElement('node-2', 140, 40)]
  };
}

/**
 * 创建右键菜单测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createWidgetData(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [createElement('node-1', 80, 60)]
  };
}

/**
 * 创建锁定节点测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createLockedWidgetData(): WidgetData {
  const data = createWidgetData();
  if (data.elements[0]) {
    data.elements[0].locked = true;
  }

  return data;
}

/**
 * 创建组合测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createGroupedWidgetData(): WidgetData {
  return {
    ...createDefaultWidgetData(),
    elements: [createGroupElement()]
  };
}

/**
 * 创建多选右键菜单测试Widget 数据。
 * @returns 测试Widget 数据
 */
function createMultiSelectedWidgetData(): WidgetDataWithSelection {
  return {
    ...createDefaultWidgetData(),
    elements: [createElement('node-1', 80, 60), createElement('node-2', 220, 100)],
    selection: ['node-1', 'node-2']
  };
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
 * 读取 BWidget 暴露命令。
 * @param wrapper - BWidget 测试包装器
 * @returns 暴露命令
 */
function getWidgetExpose(wrapper: VueWrapper): ComponentPublicInstance & BWidgetExpose {
  return wrapper.vm as ComponentPublicInstance & BWidgetExpose;
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
  await flushWidgetUpdates();
}

/**
 * 读取最后一次Widget 数据更新。
 * @param wrapper - BWidget 测试包装器
 * @returns Widget 数据
 */
function getLatestWidgetData(wrapper: VueWrapper): WidgetData | undefined {
  const emitted = wrapper.emitted('update:value') as Array<[WidgetData]> | undefined;

  return emitted?.at(-1)?.[0];
}

/**
 * 读取右键菜单按钮文案。
 * @param wrapper - BWidget 测试包装器
 * @returns 菜单按钮文案
 */
function readContextMenuLabels(wrapper: VueWrapper): string[] {
  return wrapper.findAll<HTMLButtonElement>('.b-widget-context-menu__item').map((item: DOMWrapper<HTMLButtonElement>): string => item.text());
}

/**
 * 按文案读取右键菜单按钮。
 * @param wrapper - BWidget 测试包装器
 * @param label - 菜单项文案
 * @returns 菜单按钮包装器，不存在时返回 undefined
 */
function findContextMenuItem(wrapper: VueWrapper, label: string): DOMWrapper<HTMLButtonElement> | undefined {
  return wrapper
    .findAll<HTMLButtonElement>('.b-widget-context-menu__item')
    .find((menuItem: DOMWrapper<HTMLButtonElement>): boolean => menuItem.text().includes(label));
}

/**
 * 读取右键菜单条目顺序，分割线以 divider 表示。
 * @param wrapper - BWidget 测试包装器
 * @returns 菜单条目顺序
 */
function readContextMenuEntries(wrapper: VueWrapper): string[] {
  return Array.from(wrapper.find('.b-widget-context-menu').element.children).map((child: Element): string => {
    if (child.classList.contains('b-widget-context-menu__divider')) {
      return 'divider';
    }

    return child.textContent ?? '';
  });
}

describe('BWidget context menu actions', (): void => {
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

  it('copies a node and pastes it from an element context menu point', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createWidgetData()
      },
      global: {
        stubs: {
          BIcon: true
        }
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    setElementRect(wrapper.find('.b-widget-canvas').element, { height: 600, left: 0, top: 0, width: 800 });

    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 440, clientY: 330 });
    await clickContextMenuItem(wrapper, '复制');
    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 500, clientY: 360 });
    await clickContextMenuItem(wrapper, '粘贴');

    const latestData = getLatestWidgetData(wrapper);
    expect(latestData?.elements).toHaveLength(2);
    expect(latestData?.elements[1]).toMatchObject({
      position: { x: 100, y: 60 }
    });
    expect(latestData?.elements[1]?.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    wrapper.unmount();
  });

  it('opens the blank canvas context menu with selection actions disabled', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createWidgetData()
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    setElementRect(wrapper.find('.b-widget-canvas').element, { height: 600, left: 0, top: 0, width: 800 });

    await flushWidgetUpdates();
    await wrapper.find('.b-widget-canvas').trigger('contextmenu', { clientX: 500, clientY: 360 });
    await flushWidgetUpdates();

    expect(wrapper.find('.b-widget-context-menu').exists()).toBe(true);
    expect(readContextMenuLabels(wrapper)).toEqual(['复制', '粘贴', '上一层', '下一层', '置顶', '置底', '删除']);
    expect(readContextMenuLabels(wrapper)).not.toContain('锁定');
    expect(readContextMenuLabels(wrapper)).not.toContain('合并');
    expect(findContextMenuItem(wrapper, '复制')?.attributes('disabled')).toBeDefined();
    expect(findContextMenuItem(wrapper, '粘贴')?.attributes('disabled')).toBeDefined();
    expect(findContextMenuItem(wrapper, '上一层')?.attributes('disabled')).toBeDefined();
    expect(findContextMenuItem(wrapper, '下一层')?.attributes('disabled')).toBeDefined();
    expect(findContextMenuItem(wrapper, '置顶')?.attributes('disabled')).toBeDefined();
    expect(findContextMenuItem(wrapper, '置底')?.attributes('disabled')).toBeDefined();
    expect(findContextMenuItem(wrapper, '删除')?.attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('selection-change')?.at(-1)).toEqual([[]]);
    wrapper.unmount();
  });

  it('ungroups the selected group from a group context menu', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createGroupedWidgetData()
      },
      global: {
        stubs: {
          BIcon: true
        }
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    setElementRect(wrapper.find('.b-widget-canvas').element, { height: 600, left: 0, top: 0, width: 800 });

    await findNodeById(wrapper, 'group-1').trigger('contextmenu', { clientX: 440, clientY: 330 });
    expect(readContextMenuLabels(wrapper)).toContain('取消合并');
    expect(readContextMenuLabels(wrapper)).not.toContain('合并');
    expect(readContextMenuEntries(wrapper).slice(0, 6)).toEqual(['复制', '粘贴', 'divider', '锁定', '取消合并', 'divider']);
    expect(wrapper.findAll('.b-widget-context-menu__divider')).toHaveLength(3);

    await clickContextMenuItem(wrapper, '取消合并');

    const latestData = getLatestWidgetData(wrapper);
    expect(latestData?.elements.map((element: WidgetElement): string => element.id)).toEqual(['node-1', 'node-2']);
    expect(latestData?.elements[0]?.position).toEqual({ x: 80, y: 60 });
    expect(latestData?.elements[1]?.position).toEqual({ x: 220, y: 100 });
    wrapper.unmount();
  });

  it('locks and unlocks a single element from the dynamic context menu item', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createWidgetData()
      },
      global: {
        stubs: {
          BIcon: true
        }
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    setElementRect(wrapper.find('.b-widget-canvas').element, { height: 600, left: 0, top: 0, width: 800 });

    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 440, clientY: 330 });
    expect(readContextMenuLabels(wrapper)).toContain('锁定');
    expect(readContextMenuLabels(wrapper)).not.toContain('解锁');
    expect(readContextMenuEntries(wrapper).slice(0, 4)).toEqual(['复制', '粘贴', 'divider', '锁定']);

    await clickContextMenuItem(wrapper, '锁定');
    expect(getLatestWidgetData(wrapper)?.elements[0]?.locked).toBe(true);

    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 440, clientY: 330 });
    expect(readContextMenuLabels(wrapper)).toContain('解锁');
    expect(readContextMenuLabels(wrapper)).not.toContain('锁定');
    expect(readContextMenuEntries(wrapper).slice(0, 4)).toEqual(['复制', '粘贴', 'divider', '解锁']);

    await clickContextMenuItem(wrapper, '解锁');
    expect(getLatestWidgetData(wrapper)?.elements[0]?.locked).toBeUndefined();
    wrapper.unmount();
  });

  it('uses lock when any selected element is unlocked and unlock when all selected elements are locked', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createMultiSelectedWidgetData(),
        select: {}
      },
      global: {
        stubs: {
          BIcon: true
        }
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    setElementRect(wrapper.find('.b-widget-canvas').element, { height: 600, left: 0, top: 0, width: 800 });

    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 440, clientY: 330 });

    expect(readContextMenuLabels(wrapper)).toContain('锁定');
    expect(readContextMenuLabels(wrapper)).not.toContain('解锁');

    await clickContextMenuItem(wrapper, '锁定');
    const lockedData = getLatestWidgetData(wrapper);
    expect(lockedData?.elements.every((element: WidgetElement): boolean => element.locked === true)).toBe(true);

    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 440, clientY: 330 });

    expect(readContextMenuLabels(wrapper)).toContain('解锁');
    expect(readContextMenuLabels(wrapper)).not.toContain('锁定');
    wrapper.unmount();
  });

  it('shows an unlock action for a locked single element context menu', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createLockedWidgetData()
      },
      global: {
        stubs: {
          BIcon: true
        }
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    setElementRect(wrapper.find('.b-widget-canvas').element, { height: 600, left: 0, top: 0, width: 800 });

    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 440, clientY: 330 });

    expect(readContextMenuLabels(wrapper)).toContain('解锁');
    expect(readContextMenuLabels(wrapper)).not.toContain('锁定');
    wrapper.unmount();
  });

  it('clears the active grouped child settings target after ungrouping selection', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createGroupedWidgetData(),
        select: {}
      },
      global: {
        stubs: {
          BIcon: true
        }
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    setElementRect(wrapper.find('.b-widget-canvas').element, { height: 600, left: 0, top: 0, width: 800 });

    getWidgetExpose(wrapper).selectElementById('node-2', { activateElement: true });
    await flushWidgetUpdates();

    const activeChildPayload = wrapper.emitted('update:select')?.at(-1)?.[0] as WidgetSelectTarget;
    expect(activeChildPayload && 'id' in activeChildPayload ? activeChildPayload.id : '').toBe('node-2');

    await findNodeById(wrapper, 'group-1').trigger('contextmenu', { clientX: 440, clientY: 330 });
    await clickContextMenuItem(wrapper, '取消合并');

    expect(wrapper.emitted('update:select')?.at(-1)?.[0]).toBeNull();
    wrapper.unmount();
  });

  it('keeps the selected group when opening the context menu from one of its children', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createGroupedWidgetData(),
        select: {}
      },
      global: {
        stubs: {
          BIcon: true
        }
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    setElementRect(wrapper.find('.b-widget-canvas').element, { height: 600, left: 0, top: 0, width: 800 });

    getWidgetExpose(wrapper).selectElementById('group-1');
    await flushWidgetUpdates();
    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 440, clientY: 330 });

    const selectedPayload = wrapper.emitted('update:select')?.at(-1)?.[0] as WidgetSelectTarget;
    expect(selectedPayload && 'id' in selectedPayload ? selectedPayload.id : '').toBe('group-1');
    expect(readContextMenuLabels(wrapper)).toContain('取消合并');
    wrapper.unmount();
  });

  it('keeps a multi-selection when right-clicking a selected member so merge and paste stay usable', async (): Promise<void> => {
    const wrapper = mount(BWidget, {
      props: {
        value: createMultiSelectedWidgetData(),
        select: {}
      },
      attachTo: document.body
    });
    setElementRect(wrapper.element, { height: 600, left: 0, top: 0, width: 800 });
    setElementRect(wrapper.find('.b-widget-canvas').element, { height: 600, left: 0, top: 0, width: 800 });

    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 440, clientY: 330 });
    const mergeItem = wrapper
      .findAll<HTMLButtonElement>('.b-widget-context-menu__item')
      .find((item: DOMWrapper<HTMLButtonElement>): boolean => item.text().includes('合并'));

    expect(mergeItem?.attributes('disabled')).toBeUndefined();
    expect(readContextMenuLabels(wrapper)).not.toContain('取消合并');

    await clickContextMenuItem(wrapper, '复制');
    await findNodeById(wrapper, 'node-1').trigger('contextmenu', { clientX: 500, clientY: 360 });
    const pasteItem = wrapper
      .findAll<HTMLButtonElement>('.b-widget-context-menu__item')
      .find((item: DOMWrapper<HTMLButtonElement>): boolean => item.text().includes('粘贴'));

    expect(pasteItem?.attributes('disabled')).toBeUndefined();

    await clickContextMenuItem(wrapper, '粘贴');

    const latestData = getLatestWidgetData(wrapper);
    expect(latestData?.elements.map((element: WidgetElement): string => element.id).slice(0, 2)).toEqual(['node-1', 'node-2']);
    expect(latestData?.elements.slice(2).map((element: WidgetElement): string => element.id)).toHaveLength(2);
    expect(latestData?.elements[2]?.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(latestData?.elements[3]?.id).toMatch(/^[A-Za-z0-9_-]{8}$/);
    wrapper.unmount();
  });
});
