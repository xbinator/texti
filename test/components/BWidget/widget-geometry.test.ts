/**
 * @file widget-geometry.test.ts
 * @description 验证 BWidget 共享几何工具的坐标、路径和 DOM 查询逻辑。
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import type { WidgetElement, WidgetShapeElement, WidgetViewport } from '@/components/BWidget/types';
import {
  clientDeltaToWidgetDelta,
  createWidgetElementCssTransform,
  createWidgetViewportForElements,
  getWidgetResponsiveViewBoxSize,
  getWidgetShapeRenderSize,
  projectClientPointToWidgetBoard,
  queryWidgetElementTarget,
  registerWidgetElementTarget
} from '@/components/BWidget/utils/widgetGeometry';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';
import { findElementTreeNode } from '@/components/BWidget/utils/widgetTree';

/**
 * 创建测试形状元素。
 * @param id - 元素 ID
 * @param position - 元素位置
 * @returns 测试形状元素
 */
function createShapeElement(id: string, position = { x: 40, y: 60 }): WidgetShapeElement {
  return {
    id,
    name: 'rect',
    label: '矩形',
    icon: 'lucide:square',
    title: '矩形',
    position,
    size: { width: 120, height: 80 },
    rotation: 0,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {}
  };
}

/**
 * 创建测试文本元素。
 * @param id - 元素 ID
 * @param content - 文本正文
 * @param position - 元素位置
 * @param style - 文本样式
 * @returns 测试文本元素
 */
function createTextElement(
  id: string,
  content = '标题',
  position = { x: 400, y: 260 },
  style: WidgetShapeElement['style'] = { fontSize: 20 }
): WidgetShapeElement {
  return {
    id,
    name: 'text',
    label: '文本',
    icon: 'lucide:type',
    title: '文本',
    position,
    size: { width: 180, height: 72 },
    rotation: 0,
    style,
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {
      content
    }
  };
}

describe('widgetGeometry', (): void => {
  it('projects client coordinates into board coordinates', (): void => {
    const viewport: WidgetViewport = {
      center: { x: 100, y: 80 },
      zoom: 2
    };
    const projection = projectClientPointToWidgetBoard(
      { x: 50, y: 25 },
      {
        left: 0,
        top: 0,
        width: 100,
        height: 50
      },
      viewport
    );

    expect(projection?.viewportRatio).toEqual({ x: 0.5, y: 0.5 });
    expect(projection?.boardPoint).toEqual({ x: 100, y: 80 });
  });

  it('uses the rendered viewport size as the viewBox baseline', (): void => {
    const viewport: WidgetViewport = {
      center: { x: 0, y: 0 },
      zoom: 1
    };
    const projection = projectClientPointToWidgetBoard(
      { x: 800, y: 600 },
      {
        left: 0,
        top: 0,
        width: 800,
        height: 600
      },
      viewport
    );

    expect(getWidgetResponsiveViewBoxSize(1, { width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(projection?.boardPoint).toEqual({ x: 400, y: 300 });
  });

  it('returns null when browser geometry is unavailable', (): void => {
    const viewport: WidgetViewport = {
      center: { x: 0, y: 0 },
      zoom: 1
    };

    expect(projectClientPointToWidgetBoard({ x: 10, y: 20 }, { left: 0, top: 0, width: 0, height: 0 }, viewport)).toBeNull();
    expect(clientDeltaToWidgetDelta({ x: 10, y: 20 }, { width: 0, height: 0 }, 1)).toBeNull();
  });

  it('converts browser deltas into board deltas with the current zoom', (): void => {
    expect(clientDeltaToWidgetDelta({ x: 80, y: 40 }, { width: 800, height: 400 }, 2)).toEqual({ x: 40, y: 20 });
  });

  it('creates a viewport that contains existing widget content', (): void => {
    const viewport = createWidgetViewportForElements([createShapeElement('node-1'), createShapeElement('node-2', { x: 400, y: 260 })], {
      width: 800,
      height: 600
    });

    expect(viewport).toEqual({
      center: { x: 280, y: 200 },
      zoom: 1
    });
  });

  it('uses schema model size for text element render bounds', (): void => {
    expect(getWidgetShapeRenderSize(createShapeElement('node-1'))).toEqual({ width: 120, height: 80 });
    expect(getWidgetShapeRenderSize(createTextElement('text-1'))).toEqual({ width: 180, height: 72 });
  });

  it('keeps text model height independent from content padding render bounds', (): void => {
    const element = createTextElement(
      'text-1',
      '标题',
      { x: 400, y: 260 },
      {
        fontSize: 20,
        padding: { top: 4, right: 5, bottom: 6, left: 7 }
      }
    );

    expect(getWidgetShapeRenderSize(element)).toEqual({ width: 180, height: 72 });
  });

  it('keeps text element render size from the stored model size', (): void => {
    const wideElement = createTextElement('text-1', 'abcdef', { x: 400, y: 260 }, { fontSize: 10 });
    const narrowElement = {
      ...wideElement,
      size: { width: 30, height: 72 }
    };

    expect(getWidgetShapeRenderSize(wideElement)).toEqual({ width: 180, height: 72 });
    expect(getWidgetShapeRenderSize(narrowElement)).toEqual({ width: 30, height: 72 });
  });

  it('raises text render height to the wrapped content height when model height is too small', (): void => {
    const element = {
      ...createTextElement('text-1', 'abcdef', { x: 400, y: 260 }, { fontSize: 10 }),
      size: { width: 30, height: 12 }
    };

    expect(getWidgetShapeRenderSize(element)).toEqual({ width: 30, height: 31 });
  });

  it('measures text from the content visible in the requested render mode', (): void => {
    const element = {
      ...createTextElement('text-1', '前缀{{ weather.summary }}', { x: 0, y: 0 }, { fontSize: 10 }),
      size: { width: 30, height: 12 }
    };
    const context = {
      input: {},
      output: undefined,
      data: {
        weather: {
          summary: '很长很长很长的天气说明'
        }
      }
    };

    const designSize = getWidgetShapeRenderSize(element, {
      renderContext: context,
      renderOptions: { mode: 'design' }
    });
    const runtimeSize = getWidgetShapeRenderSize(element, {
      renderContext: context,
      renderOptions: { mode: 'runtime' }
    });

    expect(runtimeSize.height).toBeGreaterThan(designSize.height);
  });

  it('creates a viewport from schema render sizes', (): void => {
    const viewport = createWidgetViewportForElements([createShapeElement('node-1'), createTextElement('text-1')], {
      width: 800,
      height: 600
    });

    expect(viewport).toEqual({
      center: { x: 310, y: 196 },
      zoom: 1
    });
  });

  it('creates a bounded fit viewport when max zoom is provided', (): void => {
    const viewport = createWidgetViewportForElements(
      [createShapeElement('node-1')],
      {
        width: 800,
        height: 600
      },
      { maxZoom: 2 }
    );

    expect(viewport).toEqual({
      center: { x: 100, y: 100 },
      zoom: 2
    });
  });

  it('keeps fitted viewport zoom above the minimum zoom', (): void => {
    const viewport = createWidgetViewportForElements(
      [
        {
          ...createShapeElement('node-1'),
          size: { width: 5000, height: 4000 }
        }
      ],
      {
        width: 800,
        height: 600
      },
      { maxZoom: 2 }
    );

    expect(viewport).toEqual({
      center: { x: 2540, y: 2060 },
      zoom: 0.4
    });
  });

  it('queries DOM targets by widget element id', (): void => {
    const root = document.createElement('div');
    const node = document.createElement('div');
    node.className = 'b-widget-node';
    registerWidgetElementTarget(node, 'node-1');
    root.appendChild(node);

    expect(queryWidgetElementTarget(root, 'node-1')).toBe(node);
    expect(queryWidgetElementTarget(root, 'missing-node')).toBeNull();
  });

  it('finds shape elements by id', (): void => {
    const elements: WidgetElement[] = [createShapeElement('node-1')];

    expect(findElementTreeNode(elements, 'node-1')?.element?.name).toBe('rect');
    expect(findElementTreeNode(elements, 'missing-node')).toBeNull();
  });

  it('finds nested shape elements by id', (): void => {
    const elements: WidgetElement[] = [
      {
        ...createShapeElement('group-1'),
        name: 'group',
        children: [createShapeElement('child-1')]
      }
    ];

    expect(findElementTreeNode(elements, 'child-1')?.element?.name).toBe('rect');
  });

  it('creates reusable transform strings', (): void => {
    expect(createWidgetElementCssTransform({ x: 10, y: 20 }, 0)).toBe('translate(10px, 20px)');
    expect(createWidgetElementCssTransform({ x: 10, y: 20 }, 90)).toBe('translate(10px, 20px) rotate(90deg)');
  });
});
