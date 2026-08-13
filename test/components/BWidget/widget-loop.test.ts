/**
 * @file widget-loop.test.ts
 * @description 验证 BWidget 循环数据配置读取、数组路径收集和运行态元素展开。
 */
import type { WidgetRenderContext } from 'types/widget';
import { describe, expect, it } from 'vitest';
import type { BSmartValue } from '@/components/BSmart/types';
import { createLiteralValue, createVariableValue } from '@/components/BSmart/utils/value';
import type { WidgetElement, WidgetElementLoopConfig, WidgetSchemaObject } from '@/components/BWidget/types';
import { getWidgetShapeRenderSize } from '@/components/BWidget/utils/widgetGeometry';
import {
  collectWidgetLoopDataSourceOptions,
  createDefaultWidgetElementLoopConfig,
  createWidgetLoopRenderElements,
  normalizeWidgetElementLoopConfig,
  type WidgetLoopRenderContext
} from '@/components/BWidget/utils/widgetLoop';

/**
 * 创建测试循环配置。
 * @param source - 结构化数据源
 * @returns 循环配置
 */
function createLoopConfig(source: BSmartValue<string> = createVariableValue('products')): WidgetElementLoopConfig {
  return {
    enabled: true,
    source,
    autoColumns: false,
    columns: 2,
    columnGap: 12,
    rowGap: 10,
    itemName: 'item',
    indexName: 'index'
  };
}

/**
 * 创建测试元素。
 * @param id - 元素 ID
 * @param position - 元素位置
 * @param size - 元素尺寸
 * @param metadata - 元素元数据
 * @returns Widget 元素
 */
function createElement(
  id: string,
  position: WidgetElement['position'],
  size: WidgetElement['size'],
  metadata: WidgetElement['metadata'] = {},
  loop: WidgetElementLoopConfig = createDefaultWidgetElementLoopConfig()
): WidgetElement {
  return {
    id,
    name: 'rect',
    label: '矩形',
    icon: 'lucide:square',
    title: id,
    position,
    size,
    rotation: 0,
    style: {},
    metadata,
    loop
  };
}

/**
 * 创建测试组合元素。
 * @param id - 元素 ID
 * @param position - 元素位置
 * @param size - 元素尺寸
 * @param metadata - 元素元数据
 * @param children - 子元素
 * @returns Widget 组合元素
 */
function createGroupElement(
  id: string,
  position: WidgetElement['position'],
  size: WidgetElement['size'],
  metadata: WidgetElement['metadata'],
  children: WidgetElement[],
  loop: WidgetElementLoopConfig = createDefaultWidgetElementLoopConfig()
): WidgetElement {
  return {
    ...createElement(id, position, size, metadata, loop),
    name: 'group',
    label: '组合',
    icon: 'lucide:group',
    children
  };
}

/**
 * 创建测试文本元素。
 * @param id - 元素 ID
 * @param position - 元素位置
 * @param size - 元素尺寸
 * @param content - 文本模板内容
 * @param metadata - 元素元数据
 * @returns Widget 文本元素
 */
function createTextElement(
  id: string,
  position: WidgetElement['position'],
  size: WidgetElement['size'],
  content: string,
  metadata: WidgetElement['metadata'] = {}
): WidgetElement {
  return {
    ...createElement(id, position, size, metadata),
    name: 'text',
    label: '文本',
    icon: 'lucide:type',
    style: {
      fontSize: 10
    },
    metadata: {
      ...metadata,
      content
    }
  };
}

/**
 * 创建测试渲染上下文。
 * @returns 渲染上下文
 */
function createRenderContext(): WidgetRenderContext {
  return {
    input: {
      items: [{ name: '入参 A' }, { name: '入参 B' }]
    },
    output: undefined,
    data: {
      products: [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
    }
  };
}

/**
 * 创建测试入参 schema。
 * @returns 入参 schema
 */
function createInputSchema(): WidgetSchemaObject {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description: '入参列表',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        }
      },
      order: {
        type: 'object',
        properties: {
          lines: {
            type: 'array',
            description: '订单行',
            items: { type: 'string' }
          }
        }
      }
    }
  };
}

/**
 * 创建测试 data schema。
 * @returns data schema
 */
function createDataSchema(): WidgetSchemaObject {
  return {
    type: 'object',
    properties: {
      products: {
        type: 'array',
        description: '商品列表',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' }
          }
        }
      },
      status: { type: 'string' }
    }
  };
}

describe('widgetLoop', (): void => {
  it('creates empty editable loop variable names in default config', (): void => {
    const config = createDefaultWidgetElementLoopConfig();

    expect(config.itemName).toBe('');
    expect(config.indexName).toBe('');
    expect(config.source).toEqual(createLiteralValue(''));
  });

  it('keeps auto loop columns switch during normalization', (): void => {
    const config = normalizeWidgetElementLoopConfig({
      ...createLoopConfig(),
      autoColumns: true,
      columns: 3
    });

    expect(config.autoColumns).toBe(true);
    expect(config.columns).toBe(3);
  });

  it('collects array paths from input and data schemas', (): void => {
    expect(collectWidgetLoopDataSourceOptions(createInputSchema(), createDataSchema()).map((item) => item.value)).toEqual([
      '$input.items',
      '$input.order.lines',
      'products'
    ]);
  });

  it('expands a single element into grid render elements and removes the template', (): void => {
    const loopElement = createElement('text-1', { x: 10, y: 20 }, { width: 100, height: 52 }, {}, createLoopConfig());
    const result = createWidgetLoopRenderElements([loopElement], createRenderContext());

    expect(result.map((item) => item.element.id)).toEqual(['text-1__loop_0', 'text-1__loop_1', 'text-1__loop_2']);
    expect(result.map((item) => item.element.position)).toEqual([
      { x: 10, y: 20 },
      { x: 122, y: 20 },
      { x: 10, y: 82 }
    ]);
    expect(result[0].renderContext.locals).toEqual({ item: { name: 'A' }, index: 0 });
  });

  it('fits auto loop columns inside the available right boundary', (): void => {
    const loopElement = createElement(
      'text-1',
      { x: 10, y: 20 },
      { width: 100, height: 52 },
      {},
      {
        ...createLoopConfig(),
        autoColumns: true,
        columns: 2,
        columnGap: 10
      }
    );
    const result = createWidgetLoopRenderElements([loopElement], createRenderContext(), { autoColumnsRightX: 330 });

    expect(result.map((item) => item.element.position)).toEqual([
      { x: 10, y: 20 },
      { x: 120, y: 20 },
      { x: 230, y: 20 }
    ]);
  });

  it('uses item and index as runtime variable names when config names are empty', (): void => {
    const loopConfig = {
      ...createDefaultWidgetElementLoopConfig(),
      enabled: true,
      source: createVariableValue('products'),
      columns: 2
    };
    const loopElement = createElement('text-1', { x: 10, y: 20 }, { width: 100, height: 52 }, {}, loopConfig);
    const result = createWidgetLoopRenderElements([loopElement], createRenderContext());

    expect(result[0].renderContext.locals).toEqual({ item: { name: 'A' }, index: 0 });
  });

  it('uses rotated visual bounds when calculating loop grid offsets', (): void => {
    const loopElement = createElement('rect-1', { x: 0, y: 0 }, { width: 100, height: 50 }, {}, createLoopConfig());
    loopElement.rotation = 90;
    const result = createWidgetLoopRenderElements([loopElement], createRenderContext());

    expect(result.map((item) => item.element.position).slice(0, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 62, y: 0 }
    ]);
  });

  it('measures loop template bounds with each iteration locals', (): void => {
    const loopConfig = createLoopConfig();
    const longName = '这是一个需要多行换行的超级长文本';
    const loopElement = createTextElement('text-1', { x: 10, y: 20 }, { width: 30, height: 12 }, '{{ item.name }}', {
      content: '{{ item.name }}'
    });
    loopElement.loop = loopConfig;
    const renderContext: WidgetRenderContext = {
      input: {},
      output: undefined,
      data: {
        products: [{ name: '短' }, { name: longName }, { name: '尾' }]
      }
    };
    const longItemContext: WidgetLoopRenderContext = {
      ...renderContext,
      locals: {
        item: {
          name: longName
        },
        index: 1
      }
    };
    const expectedCellHeight = getWidgetShapeRenderSize(loopElement, {
      renderContext: longItemContext,
      renderOptions: { mode: 'runtime' }
    }).height;
    const result = createWidgetLoopRenderElements([loopElement], renderContext);

    expect(expectedCellHeight).toBeGreaterThan(loopElement.size.height);
    expect(result[2].element.position.y).toBeCloseTo(loopElement.position.y + expectedCellHeight + loopConfig.rowGap);
  });

  it('expands a group subtree from group bounds and shares iteration locals', (): void => {
    const groupOwner = createGroupElement(
      'card-group',
      { x: 20, y: 10 },
      { width: 120, height: 60 },
      {},
      [createElement('card-bg', { x: 0, y: 0 }, { width: 120, height: 60 }), createElement('card-title', { x: 4, y: 8 }, { width: 40, height: 20 })],
      createLoopConfig()
    );
    const result = createWidgetLoopRenderElements([groupOwner], createRenderContext());

    expect(result.map((item) => item.element.id)).toEqual([
      'card-group__loop_0',
      'card-bg__loop_0',
      'card-title__loop_0',
      'card-group__loop_1',
      'card-bg__loop_1',
      'card-title__loop_1',
      'card-group__loop_2',
      'card-bg__loop_2',
      'card-title__loop_2'
    ]);
    expect(result[2].element.position).toEqual({ x: 24, y: 18 });
    expect(result[5].element.position).toEqual({ x: 156, y: 18 });
    expect(result[0].renderContext.locals).toBe(result[1].renderContext.locals);
    expect(result[1].renderContext.locals).toBe(result[2].renderContext.locals);
    expect(result[3].renderContext.locals).not.toBe(result[0].renderContext.locals);
  });

  it('expands child loops inside each parent group loop iteration', (): void => {
    const firstCategory = {
      name: '饮品',
      products: [{ name: '拿铁' }, { name: '美式' }]
    };
    const secondCategory = {
      name: '甜点',
      products: [{ name: '蛋糕' }]
    };
    const outerLoopConfig: WidgetElementLoopConfig = {
      ...createLoopConfig(createVariableValue('$input.items')),
      itemName: 'category',
      indexName: 'categoryIndex'
    };
    const innerLoopConfig: WidgetElementLoopConfig = {
      ...createLoopConfig(createVariableValue('category.products')),
      columns: 1,
      itemName: 'product',
      indexName: 'productIndex'
    };
    const groupOwner = createGroupElement(
      'category-group',
      { x: 20, y: 10 },
      { width: 120, height: 60 },
      {},
      [
        {
          ...createTextElement('product-title', { x: 4, y: 8 }, { width: 40, height: 20 }, '{{ category.name }} {{ product.name }}'),
          loop: innerLoopConfig
        }
      ],
      outerLoopConfig
    );
    const result = createWidgetLoopRenderElements([groupOwner], {
      input: {
        items: [firstCategory, secondCategory]
      },
      output: undefined,
      data: {}
    });
    const productRenderElements = result.filter((item): boolean => item.element.id.startsWith('product-title__loop_'));

    expect(result.filter((item): boolean => item.element.id.startsWith('category-group__loop_'))).toHaveLength(2);
    expect(productRenderElements).toHaveLength(3);
    expect(new Set(result.map((item): string => item.element.id)).size).toBe(result.length);
    expect(productRenderElements.map((item) => item.renderContext.locals)).toEqual([
      {
        category: firstCategory,
        categoryIndex: 0,
        product: firstCategory.products[0],
        productIndex: 0
      },
      {
        category: firstCategory,
        categoryIndex: 0,
        product: firstCategory.products[1],
        productIndex: 1
      },
      {
        category: secondCategory,
        categoryIndex: 1,
        product: secondCategory.products[0],
        productIndex: 0
      }
    ]);
  });

  it('keeps expanded loop nodes in the original layer order slot', (): void => {
    const belowElement = createElement('below', { x: 0, y: 0 }, { width: 20, height: 20 });
    const loopElement = createElement('loop', { x: 10, y: 10 }, { width: 20, height: 20 }, {}, createLoopConfig());
    const aboveElement = createElement('above', { x: 20, y: 20 }, { width: 20, height: 20 });
    const result = createWidgetLoopRenderElements([belowElement, loopElement, aboveElement], createRenderContext());

    expect(result.map((item) => item.element.id)).toEqual(['below', 'loop__loop_0', 'loop__loop_1', 'loop__loop_2', 'above']);
  });

  it('does not render loop templates when the source is missing or not an array', (): void => {
    const loopElement = createElement('text-1', { x: 10, y: 20 }, { width: 100, height: 52 }, {}, createLoopConfig(createVariableValue('missing.items')));

    expect(createWidgetLoopRenderElements([loopElement], createRenderContext())).toEqual([]);
  });

  it('falls back to normal rendering when loop is enabled but source is empty', (): void => {
    const loopConfig: WidgetElementLoopConfig = {
      ...createDefaultWidgetElementLoopConfig(),
      enabled: true,
      source: createLiteralValue('')
    };
    const loopElement = createElement('text-1', { x: 10, y: 20 }, { width: 100, height: 52 }, {}, loopConfig);

    const result = createWidgetLoopRenderElements([loopElement], createRenderContext());

    expect(result.map((item) => item.element.id)).toEqual(['text-1']);
    expect(result[0].element.position).toEqual({ x: 10, y: 20 });
  });

  it('does not execute a literal string as a loop expression', (): void => {
    const loopElement = createElement(
      'text-1',
      { x: 10, y: 20 },
      { width: 100, height: 52 },
      {},
      createLoopConfig(createLiteralValue('products'))
    );

    expect(createWidgetLoopRenderElements([loopElement], createRenderContext()).map((item) => item.element.id)).toEqual(['text-1']);
  });

  it('does not normalize a historical primitive source into a variable reference', (): void => {
    const config = normalizeWidgetElementLoopConfig({ source: 'products' as unknown as BSmartValue<string> });

    expect(config.source).toEqual(createLiteralValue(''));
  });
});
