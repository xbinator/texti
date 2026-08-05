/**
 * @file widgetGeometry.ts
 * @description BWidget Widget坐标、几何和 DOM 查询工具。
 */
import type { WidgetRenderEvaluationOptions } from '../renderOptions';
import type { WidgetElement, WidgetPoint, WidgetShapeElement, WidgetSize, WidgetViewport } from '../types';
import { WIDGET_MAX_ZOOM, WIDGET_MIN_ZOOM, WIDGET_VIEWBOX_SIZE } from '../constants/viewport';
import { getWidgetElementSchema } from '../elements';
import { flattenWidgetElementTree, type WidgetRenderTreeNode } from './widgetTree';

/** Widget节点 DOM 查询选择器。 */
const WIDGET_ELEMENT_TARGET_SELECTOR = '.b-widget-node';
/** 适配内容视口默认留白。 */
const DEFAULT_WIDGET_VIEWPORT_PADDING = 80;
/** Widget节点 DOM 与元素 ID 的内部映射。 */
const widgetElementIdByTarget = new WeakMap<Element, string>();

/**
 * 浏览器矩形信息。
 */
interface WidgetClientRect {
  /** 左侧浏览器坐标 */
  left: number;
  /** 顶部浏览器坐标 */
  top: number;
  /** 渲染宽度 */
  width: number;
  /** 渲染高度 */
  height: number;
}

/**
 * 浏览器坐标在Widget中的投影信息。
 */
export interface WidgetCanvasPointProjection {
  /** 投影后的Widget坐标 */
  boardPoint: WidgetPoint;
  /** 坐标在Widget渲染区域中的比例 */
  viewportRatio: WidgetPoint;
  /** 当前Widget渲染尺寸 */
  viewportSize: WidgetSize;
}

/**
 * Widget内容边界。
 */
interface WidgetContentBounds {
  /** 左侧边界 */
  minX: number;
  /** 顶部边界 */
  minY: number;
  /** 右侧边界 */
  maxX: number;
  /** 底部边界 */
  maxY: number;
}

/**
 * 可见元素及其渲染尺寸。
 */
interface WidgetVisibleElement {
  /** Widget元素 */
  element: WidgetElement;
  /** 渲染尺寸 */
  renderSize: WidgetSize;
}

/**
 * Widget内容适配视口选项。
 */
export interface WidgetViewportFitOptions {
  /** 内容周围留白 */
  padding?: number;
  /** 适配时允许使用的最大缩放比例 */
  maxZoom?: number;
}

/**
 * 根据缩放比例计算 viewBox 尺寸。
 * @param zoom - 缩放比例
 * @returns viewBox 尺寸
 */
function getWidgetViewBoxSize(zoom: number): WidgetSize {
  return {
    width: WIDGET_VIEWBOX_SIZE.width / zoom,
    height: WIDGET_VIEWBOX_SIZE.height / zoom
  };
}

/**
 * 根据渲染尺寸和缩放比例计算动态 viewBox 尺寸。
 * @param zoom - 缩放比例
 * @param viewportSize - Widget渲染尺寸
 * @returns viewBox 尺寸
 */
export function getWidgetResponsiveViewBoxSize(zoom: number, viewportSize: WidgetSize): WidgetSize {
  if (!viewportSize.width || !viewportSize.height) {
    return getWidgetViewBoxSize(zoom);
  }

  return {
    width: viewportSize.width / zoom,
    height: viewportSize.height / zoom
  };
}

/**
 * 按尺寸来源解析单轴渲染尺寸。
 * @param source - 尺寸来源
 * @param modelValue - 模型尺寸
 * @param contentValue - 内容尺寸
 * @returns 渲染尺寸
 */
function resolveWidgetRenderSizeValue(source: 'model' | 'content' | 'model-min-content', modelValue: number, contentValue: number): number {
  if (source === 'content') {
    return contentValue;
  }

  if (source === 'model-min-content') {
    return Math.max(modelValue, contentValue);
  }

  return modelValue;
}

/**
 * 读取形状渲染时使用的有效尺寸。
 * @param element - 形状元素
 * @param options - Widget 渲染求值选项
 * @returns 渲染尺寸
 */
export function getWidgetShapeRenderSize(element: WidgetShapeElement, options: WidgetRenderEvaluationOptions = {}): WidgetSize {
  const renderSize = getWidgetElementSchema(element.name)?.renderSize;
  if (!renderSize) {
    return element.size;
  }

  const contentSize = renderSize.measureContent(element, options);

  return {
    width: resolveWidgetRenderSizeValue(renderSize.width, element.size.width, contentSize.width),
    height: resolveWidgetRenderSizeValue(renderSize.height, element.size.height, contentSize.height)
  };
}

/**
 * 根据元素列表计算内容边界。
 * @param elements - Widget元素列表
 * @returns 内容边界，无可见元素时返回 null
 */
function getWidgetContentBounds(elements: WidgetElement[]): WidgetContentBounds | null {
  const visibleElements = flattenWidgetElementTree(elements)
    .map(
      (item: WidgetRenderTreeNode): WidgetVisibleElement => ({
        element: { ...item.element, position: item.absolutePosition },
        renderSize: getWidgetShapeRenderSize(item.element)
      })
    )
    .filter((item: WidgetVisibleElement): boolean => item.renderSize.width > 0 && item.renderSize.height > 0);
  if (!visibleElements.length) {
    return null;
  }

  return visibleElements.reduce<WidgetContentBounds>(
    (bounds: WidgetContentBounds, item: WidgetVisibleElement): WidgetContentBounds => ({
      minX: Math.min(bounds.minX, item.element.position.x),
      minY: Math.min(bounds.minY, item.element.position.y),
      maxX: Math.max(bounds.maxX, item.element.position.x + item.renderSize.width),
      maxY: Math.max(bounds.maxY, item.element.position.y + item.renderSize.height)
    }),
    {
      minX: visibleElements[0].element.position.x,
      minY: visibleElements[0].element.position.y,
      maxX: visibleElements[0].element.position.x + visibleElements[0].renderSize.width,
      maxY: visibleElements[0].element.position.y + visibleElements[0].renderSize.height
    }
  );
}

/**
 * 限制内容适配缩放比例。
 * @param zoom - 根据内容尺寸计算出的缩放比例
 * @param maxZoom - 调用方允许的最大缩放比例
 * @returns 限制在全局上下限内的缩放比例
 */
function clampFitZoom(zoom: number, maxZoom: number): number {
  const boundedMaxZoom = Math.min(WIDGET_MAX_ZOOM, Math.max(WIDGET_MIN_ZOOM, maxZoom));

  return Number(Math.max(WIDGET_MIN_ZOOM, Math.min(boundedMaxZoom, zoom)).toFixed(2));
}

/**
 * 创建能够完整展示现有内容的视口。
 * @param elements - Widget元素列表
 * @param viewportSize - Widget渲染尺寸
 * @param options - 内容适配选项
 * @returns 适配内容的视口，无内容时返回 null
 */
export function createWidgetViewportForElements(
  elements: WidgetElement[],
  viewportSize: WidgetSize,
  options: WidgetViewportFitOptions = {}
): WidgetViewport | null {
  const bounds = getWidgetContentBounds(elements);
  if (!bounds) {
    return null;
  }

  const padding = options.padding ?? DEFAULT_WIDGET_VIEWPORT_PADDING;
  const maxZoom = options.maxZoom ?? 1;
  const size = viewportSize.width && viewportSize.height ? viewportSize : WIDGET_VIEWBOX_SIZE;
  const contentWidth = bounds.maxX - bounds.minX + padding * 2;
  const contentHeight = bounds.maxY - bounds.minY + padding * 2;
  const fitZoom = Math.min(size.width / contentWidth, size.height / contentHeight);

  return {
    center: {
      x: Number(((bounds.minX + bounds.maxX) / 2).toFixed(2)),
      y: Number(((bounds.minY + bounds.maxY) / 2).toFixed(2))
    },
    zoom: clampFitZoom(fitZoom, maxZoom)
  };
}

/**
 * 将浏览器像素位移换算为Widget坐标位移。
 * @param delta - 浏览器像素位移
 * @param viewportSize - Widget渲染尺寸
 * @param zoom - 当前缩放比例
 * @returns Widget坐标位移，无法读取尺寸时返回 null
 */
export function clientDeltaToWidgetDelta(delta: WidgetPoint, viewportSize: WidgetSize, zoom: number): WidgetPoint | null {
  if (!viewportSize.width || !viewportSize.height) {
    return null;
  }

  const viewBoxSize = getWidgetResponsiveViewBoxSize(zoom, viewportSize);

  return {
    x: (delta.x * viewBoxSize.width) / viewportSize.width,
    y: (delta.y * viewBoxSize.height) / viewportSize.height
  };
}

/**
 * 将浏览器坐标投影到Widget坐标系。
 * @param clientPoint - 浏览器坐标
 * @param rect - Widget渲染矩形
 * @param viewport - 当前视口
 * @returns Widget投影信息，无法读取尺寸时返回 null
 */
export function projectClientPointToWidgetBoard(
  clientPoint: WidgetPoint,
  rect: WidgetClientRect,
  viewport: WidgetViewport
): WidgetCanvasPointProjection | null {
  if (!rect.width || !rect.height) {
    return null;
  }

  const viewportSize = {
    width: rect.width,
    height: rect.height
  };
  const viewBoxSize = getWidgetResponsiveViewBoxSize(viewport.zoom, viewportSize);
  const xRatio = (clientPoint.x - rect.left) / rect.width;
  const yRatio = (clientPoint.y - rect.top) / rect.height;

  return {
    boardPoint: {
      x: viewport.center.x - viewBoxSize.width / 2 + xRatio * viewBoxSize.width,
      y: viewport.center.y - viewBoxSize.height / 2 + yRatio * viewBoxSize.height
    },
    viewportRatio: {
      x: xRatio,
      y: yRatio
    },
    viewportSize
  };
}

/**
 * 读取 DOM 目标绑定的Widget元素 ID。
 * @param target - DOM 目标
 * @returns 元素 ID
 */
export function getWidgetElementId(target?: Element | null): string | null {
  return target ? widgetElementIdByTarget.get(target) ?? null : null;
}

/**
 * 注册 Widget 节点 DOM 与元素 ID 的映射。
 * @param target - Widget节点 DOM
 * @param id - Widget元素 ID
 */
export function registerWidgetElementTarget(target: Element, id: string): void {
  widgetElementIdByTarget.set(target, id);
}

/**
 * 移除 Widget 节点 DOM 与元素 ID 的映射。
 * @param target - Widget节点 DOM
 */
export function unregisterWidgetElementTarget(target: Element): void {
  widgetElementIdByTarget.delete(target);
}

/**
 * 通过元素 ID 查询 DOM target。
 * @param root - 查询根节点
 * @param id - 元素 ID
 * @returns DOM target
 */
export function queryWidgetElementTarget(root: ParentNode | null | undefined, id: string): Element | null {
  return (
    Array.from(root?.querySelectorAll(WIDGET_ELEMENT_TARGET_SELECTOR) ?? []).find((target: Element): boolean => widgetElementIdByTarget.get(target) === id) ??
    null
  );
}

/**
 * 创建 HTML 元素 transform 字符串。
 * @param position - 元素位置
 * @param rotation - 旋转角度
 * @returns CSS transform 属性值
 */
export function createWidgetElementCssTransform(position: WidgetPoint, rotation: number): string {
  const translate = `translate(${position.x}px, ${position.y}px)`;

  return rotation ? `${translate} rotate(${rotation}deg)` : translate;
}
