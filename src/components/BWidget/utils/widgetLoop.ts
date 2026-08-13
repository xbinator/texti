/**
 * @file widgetLoop.ts
 * @description BWidget 循环数据配置与运行态展开工具。
 */
import type { WidgetElement, WidgetElementLoopConfig, WidgetPoint, WidgetSchemaObject, WidgetSchemaProperty, WidgetSize } from '../types';
import type { WidgetRenderContext } from 'types/widget';
import { cloneDeep } from 'lodash-es';
import type { BSmartValue } from '@/components/BSmart/types';
import { createLiteralValue, createVariableValue, isLiteralValue, isVariableValue } from '@/components/BSmart/utils/value';
import { formatWidgetBindingPath, isWidgetBindingPathSegmentAllowed, resolveWidgetSmartValue } from './widgetBindings';
import { createWidgetRuntimeLayoutFromRenderElements } from './widgetRuntime/layout';
import { readWidgetElementChildren } from './widgetTree';

/** 默认循环迭代项变量名。 */
const DEFAULT_WIDGET_LOOP_ITEM_NAME = 'item';
/** 默认循环索引变量名。 */
const DEFAULT_WIDGET_LOOP_INDEX_NAME = 'index';
/** 默认循环列数。 */
const DEFAULT_WIDGET_LOOP_COLUMNS = 1;
/** 默认循环列间距。 */
const DEFAULT_WIDGET_LOOP_COLUMN_GAP = 12;
/** 默认循环行间距。 */
const DEFAULT_WIDGET_LOOP_ROW_GAP = 12;

/**
 * 循环数据源选项。
 */
export interface WidgetLoopDataSourceOption {
  /** 数据源显示标签 */
  label: string;
  /** 数据源绑定路径 */
  value: string;
}

/**
 * Widget局部循环渲染上下文。
 */
export interface WidgetLoopRenderContext extends WidgetRenderContext {
  /** 当前临时元素局部变量根 */
  locals?: Record<string, unknown>;
}

/**
 * Widget循环展开后的运行态元素。
 */
export interface WidgetLoopRenderElement {
  /** 运行态元素 */
  element: WidgetElement;
  /** 元素渲染上下文 */
  renderContext: WidgetLoopRenderContext;
}

/**
 * Widget循环展开选项。
 */
export interface CreateWidgetLoopRenderElementsOptions {
  /** 自适应列数可使用的画布右边界坐标 */
  autoColumnsRightX?: number;
}

/**
 * Widget循环运行态变量名。
 */
export interface WidgetElementLoopVariableNames {
  /** 有效迭代项变量名 */
  itemName: string;
  /** 有效索引变量名 */
  indexName: string;
}

/**
 * 循环模板边界。
 */
interface WidgetLoopTemplateBounds {
  /** 左侧边界 */
  minX: number;
  /** 顶部边界 */
  minY: number;
  /** 边界宽度 */
  width: number;
  /** 边界高度 */
  height: number;
}

/**
 * 循环模板目标。
 */
interface WidgetLoopTemplateTarget {
  /** 循环配置 */
  config: WidgetElementLoopConfig;
  /** 模板元素树根 */
  element: WidgetElement;
  /** 模板元素树根在画布中的绝对坐标 */
  absolutePosition: WidgetPoint;
  /** 自适应列数可使用的画布右边界坐标 */
  autoColumnsRightX?: number;
}

/**
 * 循环单次迭代目标。
 */
interface WidgetLoopIterationTarget {
  /** 当前索引 */
  itemIndex: number;
  /** 当前迭代展开后的模板元素 */
  renderElements: WidgetLoopRenderElement[];
  /** 当前迭代下模板元素视觉边界 */
  bounds: WidgetLoopTemplateBounds;
}

/**
 * 创建默认循环配置。
 * @returns 默认循环配置
 */
export function createDefaultWidgetElementLoopConfig(): WidgetElementLoopConfig {
  return {
    enabled: false,
    source: createLiteralValue(''),
    autoColumns: false,
    columns: DEFAULT_WIDGET_LOOP_COLUMNS,
    columnGap: DEFAULT_WIDGET_LOOP_COLUMN_GAP,
    rowGap: DEFAULT_WIDGET_LOOP_ROW_GAP,
    itemName: '',
    indexName: ''
  };
}

/**
 * 判断未知值是否为记录。
 * @param value - 待判断值
 * @returns 是否为记录
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 规范化非负数值。
 * @param value - 原始值
 * @param fallback - 回退值
 * @returns 非负数值
 */
function normalizeNonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : fallback;
}

/**
 * 规范化正整数。
 * @param value - 原始值
 * @param fallback - 回退值
 * @returns 正整数
 */
function normalizePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

/**
 * 规范化循环变量名。
 * @param value - 原始变量名
 * @param fallback - 回退变量名
 * @returns 可用变量名
 */
function normalizeLoopVariableName(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/**
 * 规整循环数据源，历史字符串值不再兼容。
 * @param value - 原始循环数据源
 * @returns 合法的结构化数据源
 */
function normalizeLoopSource(value: unknown): BSmartValue<string> {
  if (isVariableValue(value)) {
    return createVariableValue(value.value);
  }

  if (isLiteralValue(value) && typeof value.value === 'string') {
    return createLiteralValue(value.value);
  }

  return createLiteralValue('');
}

/**
 * 读取循环配置实际参与绑定解析的变量名。
 * @param config - 循环配置
 * @returns 有效变量名
 */
export function resolveWidgetElementLoopVariableNames(config: WidgetElementLoopConfig): WidgetElementLoopVariableNames {
  return {
    itemName: normalizeLoopVariableName(config.itemName, DEFAULT_WIDGET_LOOP_ITEM_NAME),
    indexName: normalizeLoopVariableName(config.indexName, DEFAULT_WIDGET_LOOP_INDEX_NAME)
  };
}

/**
 * 归一化Widget元素循环配置。
 * @param config - 原始循环配置
 * @returns 循环配置
 */
export function normalizeWidgetElementLoopConfig(config: Partial<WidgetElementLoopConfig> | undefined): WidgetElementLoopConfig {
  const defaultConfig = createDefaultWidgetElementLoopConfig();

  if (!isRecord(config)) {
    return defaultConfig;
  }

  const rawColumns = config.columns as unknown;

  return {
    enabled: config.enabled === true,
    source: normalizeLoopSource(config.source),
    autoColumns: config.autoColumns === true || rawColumns === 'auto',
    columns: normalizePositiveInteger(rawColumns, defaultConfig.columns),
    columnGap: normalizeNonNegativeNumber(config.columnGap, defaultConfig.columnGap),
    rowGap: normalizeNonNegativeNumber(config.rowGap, defaultConfig.rowGap),
    itemName: normalizeLoopVariableName(config.itemName, defaultConfig.itemName),
    indexName: normalizeLoopVariableName(config.indexName, defaultConfig.indexName)
  };
}

/**
 * 从 schema 属性中收集数组路径。
 * @param root - 绑定根
 * @param properties - schema 属性集合
 * @param parentSegments - 父级路径
 * @returns 数组路径选项
 */
function collectArraySchemaPaths(
  root: 'input' | 'data',
  properties: Record<string, WidgetSchemaProperty> | undefined,
  parentSegments: string[] = []
): WidgetLoopDataSourceOption[] {
  if (!properties) {
    return [];
  }

  return Object.entries(properties).flatMap(([key, property]: [string, WidgetSchemaProperty]): WidgetLoopDataSourceOption[] => {
    if (!isWidgetBindingPathSegmentAllowed(key)) {
      return [];
    }

    const segments = [...parentSegments, key];
    const value = formatWidgetBindingPath(root, segments);
    const currentOption = property.type === 'array' ? [{ label: property.description || value, value }] : [];
    const childOptions = property.type === 'object' ? collectArraySchemaPaths(root, property.properties, segments) : [];

    return [...currentOption, ...childOptions];
  });
}

/**
 * 收集Widget循环数据源选项。
 * @param inputSchema - 入参 schema
 * @param dataSchema - data schema
 * @returns 数据源选项
 */
export function collectWidgetLoopDataSourceOptions(inputSchema: WidgetSchemaObject, dataSchema: WidgetSchemaObject): WidgetLoopDataSourceOption[] {
  return [...collectArraySchemaPaths('input', inputSchema.properties), ...collectArraySchemaPaths('data', dataSchema.properties)];
}

/**
 * 读取上下文中已有的局部变量。
 * @param renderContext - 渲染上下文
 * @returns 局部变量根
 */
function readLoopRenderContextLocals(renderContext: WidgetRenderContext): Record<string, unknown> | undefined {
  const contextWithLocals = renderContext as WidgetLoopRenderContext;

  return contextWithLocals.locals;
}

/**
 * 按结构化数据源读取渲染上下文中的数组。
 * @param renderContext - 渲染上下文
 * @param source - 结构化数据源
 * @returns 数组数据
 */
function readLoopSourceItems(renderContext: WidgetRenderContext, source: BSmartValue<string>): unknown[] {
  const currentValue = resolveWidgetSmartValue(source, {
    renderContext,
    renderOptions: { mode: 'runtime' }
  });

  return Array.isArray(currentValue) ? currentValue : [];
}

/**
 * 判断循环配置是否引用了有效变量路径。
 * @param source - 结构化循环数据源
 * @returns 是否应进入循环展开逻辑
 */
function hasLoopSource(source: BSmartValue<string>): boolean {
  return isVariableValue(source) && Boolean(source.value.trim());
}

/**
 * 创建模板元素边界。
 * @param renderElements - 模板渲染元素
 * @returns 模板边界
 */
function createLoopTemplateBounds(renderElements: WidgetLoopRenderElement[]): WidgetLoopTemplateBounds {
  const layout = createWidgetRuntimeLayoutFromRenderElements(renderElements, 0);

  return {
    minX: layout.bounds.minX,
    minY: layout.bounds.minY,
    width: layout.bounds.width,
    height: layout.bounds.height
  };
}

/**
 * 创建不携带子树的运行态循环元素。
 * @param element - 原始元素
 * @param position - 运行态绝对坐标
 * @returns 运行态循环元素
 */
function createFlatLoopRenderElement(element: WidgetElement, position: WidgetPoint): WidgetElement {
  const nextElement = cloneDeep(element);

  nextElement.position = position;
  delete nextElement.children;

  return nextElement;
}

/**
 * 创建循环目标在单次迭代中的模板渲染元素。
 * @param target - 循环模板目标
 * @param renderContext - 单次迭代渲染上下文
 * @returns 模板渲染元素
 */
function createLoopTemplateRenderElements(target: WidgetLoopTemplateTarget, renderContext: WidgetLoopRenderContext): WidgetLoopRenderElement[] {
  return [
    {
      element: createFlatLoopRenderElement(target.element, target.absolutePosition),
      renderContext
    },
    ...readWidgetElementChildren(target.element).flatMap((child: WidgetElement): WidgetLoopRenderElement[] =>
      // eslint-disable-next-line no-use-before-define -- 循环模板展开需要递归消费子树中的内层循环。
      createElementLoopRenderElements(child, renderContext, target.absolutePosition)
    )
  ];
}

/**
 * 创建单次循环迭代局部上下文。
 * @param config - 循环配置
 * @param item - 当前迭代项
 * @param index - 当前索引
 * @returns 局部上下文
 */
function createLoopLocals(config: WidgetElementLoopConfig, item: unknown, index: number): Record<string, unknown> {
  const variableNames = resolveWidgetElementLoopVariableNames(config);

  return {
    [variableNames.itemName]: item,
    [variableNames.indexName]: index
  };
}

/**
 * 创建单次循环迭代渲染上下文。
 * @param config - 循环配置
 * @param renderContext - 上级渲染上下文
 * @param item - 当前迭代项
 * @param index - 当前索引
 * @returns 当前迭代渲染上下文
 */
function createLoopRenderContext(config: WidgetElementLoopConfig, renderContext: WidgetRenderContext, item: unknown, index: number): WidgetLoopRenderContext {
  const loopLocals = createLoopLocals(config, item, index);
  const parentLocals = readLoopRenderContextLocals(renderContext);

  return {
    ...renderContext,
    locals: parentLocals ? { ...parentLocals, ...loopLocals } : loopLocals
  };
}

/**
 * 创建临时元素 ID。
 * @param elementId - 原元素 ID
 * @param index - 循环索引
 * @returns 临时元素 ID
 */
function createLoopElementId(elementId: string, index: number): string {
  return `${elementId}__loop_${index}`;
}

/**
 * 创建循环迭代目标列表。
 * @param target - 循环模板目标
 * @param renderContext - 渲染上下文
 * @param items - 循环数据
 * @returns 循环迭代目标列表
 */
function createLoopIterationTargets(target: WidgetLoopTemplateTarget, renderContext: WidgetRenderContext, items: unknown[]): WidgetLoopIterationTarget[] {
  return items.map((item: unknown, itemIndex: number): WidgetLoopIterationTarget => {
    const itemRenderContext = createLoopRenderContext(target.config, renderContext, item, itemIndex);
    const renderElements = createLoopTemplateRenderElements(target, itemRenderContext);

    return {
      itemIndex,
      renderElements,
      bounds: createLoopTemplateBounds(renderElements)
    };
  });
}

/**
 * 创建循环网格单元格尺寸。
 * @param iterations - 循环迭代目标列表
 * @returns 网格单元格尺寸
 */
function createLoopCellSize(iterations: WidgetLoopIterationTarget[]): WidgetSize {
  return iterations.reduce<WidgetSize>(
    (currentSize: WidgetSize, iteration: WidgetLoopIterationTarget): WidgetSize => ({
      width: Math.max(currentSize.width, iteration.bounds.width),
      height: Math.max(currentSize.height, iteration.bounds.height)
    }),
    { width: 0, height: 0 }
  );
}

/**
 * 读取自适应列数可用右边界。
 * @param target - 循环模板目标
 * @returns 可用右边界坐标
 */
function readLoopAutoColumnsRightX(target: WidgetLoopTemplateTarget): number {
  return typeof target.autoColumnsRightX === 'number' && Number.isFinite(target.autoColumnsRightX)
    ? target.autoColumnsRightX
    : target.absolutePosition.x + target.element.size.width;
}

/**
 * 读取循环网格起始横坐标。
 * @param iterations - 循环迭代目标列表
 * @returns 起始横坐标
 */
function readLoopGridMinX(iterations: WidgetLoopIterationTarget[]): number {
  return Math.min(...iterations.map((iteration: WidgetLoopIterationTarget): number => iteration.bounds.minX));
}

/**
 * 解析运行态实际列数。
 * @param target - 循环模板目标
 * @param iterations - 循环迭代目标列表
 * @param cellSize - 循环单元格尺寸
 * @returns 实际列数
 */
function resolveLoopRenderColumns(target: WidgetLoopTemplateTarget, iterations: WidgetLoopIterationTarget[], cellSize: WidgetSize): number {
  if (!target.config.autoColumns) {
    return Math.max(1, target.config.columns);
  }

  const availableWidth = Math.max(cellSize.width, readLoopAutoColumnsRightX(target) - readLoopGridMinX(iterations));
  const columnStride = cellSize.width + target.config.columnGap;
  if (columnStride <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor((availableWidth + target.config.columnGap) / columnStride));
}

/**
 * 展开单个循环模板目标。
 * @param target - 循环模板目标
 * @param renderContext - 渲染上下文
 * @returns 运行态元素
 */
function expandLoopTemplateTarget(target: WidgetLoopTemplateTarget, renderContext: WidgetRenderContext): WidgetLoopRenderElement[] {
  const items = readLoopSourceItems(renderContext, target.config.source);
  if (items.length === 0) {
    return [];
  }

  const iterations = createLoopIterationTargets(target, renderContext, items);
  const cellSize = createLoopCellSize(iterations);
  const columns = resolveLoopRenderColumns(target, iterations, cellSize);

  return iterations.flatMap((iteration: WidgetLoopIterationTarget): WidgetLoopRenderElement[] => {
    const { bounds, itemIndex, renderElements } = iteration;
    const column = itemIndex % columns;
    const row = Math.floor(itemIndex / columns);
    const cellOrigin: WidgetPoint = {
      x: bounds.minX + column * (cellSize.width + target.config.columnGap),
      y: bounds.minY + row * (cellSize.height + target.config.rowGap)
    };

    return renderElements.map(
      (renderElement: WidgetLoopRenderElement): WidgetLoopRenderElement => ({
        element: {
          ...cloneDeep(renderElement.element),
          id: createLoopElementId(renderElement.element.id, itemIndex),
          position: {
            x: renderElement.element.position.x - bounds.minX + cellOrigin.x,
            y: renderElement.element.position.y - bounds.minY + cellOrigin.y
          }
        },
        renderContext: renderElement.renderContext
      })
    );
  });
}

/**
 * 创建单个元素节点的运行态循环展开元素。
 * @param element - 当前元素
 * @param renderContext - 渲染上下文
 * @param parentAbsolutePosition - 父级绝对坐标
 * @returns 运行态元素
 */
function createElementLoopRenderElements(
  element: WidgetElement,
  renderContext: WidgetRenderContext,
  parentAbsolutePosition: WidgetPoint,
  autoColumnsRightX?: number
): WidgetLoopRenderElement[] {
  const absolutePosition = {
    x: parentAbsolutePosition.x + element.position.x,
    y: parentAbsolutePosition.y + element.position.y
  };
  const loopConfig = element.loop;

  // 循环启用且配置了数据源才走展开逻辑，否则按普通元素渲染一次，避免空 source 导致元素整体消失。
  if (loopConfig.enabled && hasLoopSource(loopConfig.source)) {
    return expandLoopTemplateTarget({ config: loopConfig, element, absolutePosition, autoColumnsRightX }, renderContext);
  }

  const childAutoColumnsRightX = absolutePosition.x + element.size.width;

  return [
    {
      element: createFlatLoopRenderElement(element, absolutePosition),
      renderContext
    },
    ...readWidgetElementChildren(element).flatMap((child: WidgetElement): WidgetLoopRenderElement[] =>
      createElementLoopRenderElements(child, renderContext, absolutePosition, childAutoColumnsRightX)
    )
  ];
}

/**
 * 创建运行态循环展开元素。
 * @param elements - Widget元素
 * @param renderContext - 渲染上下文
 * @param options - 循环展开选项
 * @returns 运行态元素
 */
export function createWidgetLoopRenderElements(
  elements: WidgetElement[],
  renderContext: WidgetRenderContext,
  options: CreateWidgetLoopRenderElementsOptions = {}
): WidgetLoopRenderElement[] {
  return elements.flatMap((element: WidgetElement): WidgetLoopRenderElement[] =>
    createElementLoopRenderElements(element, renderContext, { x: 0, y: 0 }, options.autoColumnsRightX)
  );
}
