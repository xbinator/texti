/**
 * @file widget-runtime-layout.test.ts
 * @description 验证 BWidget 运行态内容边界布局计算。
 */
import type { WidgetRenderContext } from 'types/widget';
import { describe, expect, it } from 'vitest';
import type { WidgetElement, WidgetPoint, WidgetSize } from '@/components/BWidget/types';
import { createDefaultWidgetElementLoopConfig } from '@/components/BWidget/utils/widgetLoop';
import {
  createWidgetRuntimeLayout,
  createWidgetRuntimeLayoutFromRenderElements,
  type WidgetRuntimeElementLayout
} from '@/components/BWidget/utils/widgetRuntime/layout';

/**
 * 创建矩形测试元素。
 * @param id - 元素 ID
 * @param position - 元素位置
 * @param size - 元素尺寸
 * @param rotation - 旋转角度
 * @returns 测试元素
 */
function createRectElement(id: string, position: WidgetPoint, size: WidgetSize, rotation = 0): WidgetElement {
  return {
    id,
    name: 'rect',
    label: '矩形',
    icon: 'lucide:square',
    title: id,
    position,
    size,
    rotation,
    style: {},
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {}
  };
}

/**
 * 创建文本测试元素。
 * @param content - 文本模板
 * @returns 测试元素
 */
function createTextElement(content: string): WidgetElement {
  return {
    id: 'text-1',
    name: 'text',
    label: '文本',
    icon: 'lucide:type',
    title: '天气文本',
    position: { x: 0, y: 0 },
    size: { width: 30, height: 12 },
    rotation: 0,
    style: {
      fontSize: 10
    },
    loop: createDefaultWidgetElementLoopConfig(),
    metadata: {
      content
    }
  };
}

describe('createWidgetRuntimeLayout', (): void => {
  it('uses rendered node bounds as the content container bounds', (): void => {
    const layout = createWidgetRuntimeLayout(
      [createRectElement('rect-1', { x: -20, y: 10 }, { width: 100, height: 40 }), createRectElement('rect-2', { x: 90, y: 30 }, { width: 40, height: 50 })],
      undefined,
      16
    );

    expect(layout.bounds).toEqual({
      minX: -20,
      minY: 10,
      maxX: 130,
      maxY: 80,
      width: 150,
      height: 70
    });
    expect(layout.contentSize).toEqual({
      width: 182,
      height: 102
    });
    expect(layout.offset).toEqual({
      x: 36,
      y: 6
    });
    const elementPositions = layout.elements.map((item: WidgetRuntimeElementLayout): { id: string; position: WidgetPoint } => ({
      id: item.element.id,
      position: item.position
    }));

    expect(elementPositions).toEqual([
      {
        id: 'rect-1',
        position: { x: 16, y: 16 }
      },
      {
        id: 'rect-2',
        position: { x: 126, y: 36 }
      }
    ]);
  });

  it('keeps rotated nodes inside the content bounds', (): void => {
    const layout = createWidgetRuntimeLayout([createRectElement('rect-1', { x: 0, y: 0 }, { width: 40, height: 20 }, 90)], undefined, 10);

    expect(layout.bounds).toEqual({
      minX: 10,
      minY: -10,
      maxX: 30,
      maxY: 30,
      width: 20,
      height: 40
    });
    expect(layout.contentSize).toEqual({
      width: 40,
      height: 60
    });
    expect(layout.offset).toEqual({
      x: 0,
      y: 20
    });
    expect(layout.elements[0].position).toEqual({
      x: 0,
      y: 20
    });
  });

  it('uses render context when measuring dynamic text nodes', (): void => {
    const compactContext: WidgetRenderContext = {
      input: {
        city: '沪'
      },
      output: undefined,
      data: {}
    };
    const expandedContext: WidgetRenderContext = {
      input: {
        city: '上海浦东新区'
      },
      output: undefined,
      data: {}
    };
    const compactLayout = createWidgetRuntimeLayout([createTextElement('{{ $input.city }}')], compactContext);
    const expandedLayout = createWidgetRuntimeLayout([createTextElement('{{ $input.city }}')], expandedContext);

    expect(expandedLayout.bounds.height).toBeGreaterThan(compactLayout.bounds.height);
  });

  it('uses each render element context when measuring dynamic text nodes', (): void => {
    const firstText = createTextElement('{{ item.name }}');
    const secondText = {
      ...createTextElement('{{ item.name }}'),
      id: 'text-2',
      position: { x: 40, y: 0 }
    };
    const layout = createWidgetRuntimeLayoutFromRenderElements(
      [
        {
          element: firstText,
          renderContext: {
            input: {},
            output: undefined,
            data: {},
            locals: {
              item: {
                name: '短'
              }
            }
          }
        },
        {
          element: secondText,
          renderContext: {
            input: {},
            output: undefined,
            data: {},
            locals: {
              item: {
                name: '这是一个需要换行的长文本'
              }
            }
          }
        }
      ],
      16
    );

    expect(layout.elements[1].renderSize.height).toBeGreaterThan(layout.elements[0].renderSize.height);
    expect(layout.bounds.height).toBe(layout.elements[1].renderSize.height);
  });

  it('returns a minimal empty layout when there are no visible nodes', (): void => {
    const layout = createWidgetRuntimeLayout([], undefined, 16);

    expect(layout.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0
    });
    expect(layout.contentSize).toEqual({
      width: 1,
      height: 1
    });
    expect(layout.offset).toEqual({
      x: 0,
      y: 0
    });
    expect(layout.elements).toEqual([]);
  });
});
