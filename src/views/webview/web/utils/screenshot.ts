/**
 * @file screenshot.ts
 * @description WebView 截图辅助函数。
 */

/**
 * 页面截屏尺寸信息。
 */
export interface WebviewPageCaptureMetrics {
  /** 当前页面总高度（CSS 像素） */
  contentHeight: number;
  /** 当前视口宽度（CSS 像素） */
  viewportWidth: number;
  /** 当前视口高度（CSS 像素） */
  viewportHeight: number;
  /** 页面最大可滚动距离 */
  maxScrollTop: number;
  /** 当前滚动位置 */
  scrollTop: number;
}

/**
 * 单次截屏切片信息。
 */
export interface WebviewPageCaptureSlice {
  /** 在最终长图中的纵向起点 */
  offsetY: number;
  /** 当前切片需要保留的高度 */
  height: number;
  /** 采样前需要滚动到的页面位置 */
  scrollTop: number;
  /** 从当前采样图中裁剪的纵向起点 */
  sourceY: number;
  /** 当前切片是否保留 fixed 元素 */
  captureFixedElements: boolean;
}

/**
 * fixed 元素的布局角色。
 */
export type WebviewFixedElementRole = 'top' | 'bottom' | 'other';

/**
 * 页面内 fixed 元素的可视区域信息。
 */
export interface WebviewFixedElementSnapshot {
  /** 元素唯一标识 */
  id: string;
  /** fixed 元素所属角色 */
  role: WebviewFixedElementRole;
  /** 元素在视口中的顶部位置 */
  top: number;
  /** 元素在视口中的左侧位置 */
  left: number;
  /** 元素宽度 */
  width: number;
  /** 元素高度 */
  height: number;
}

/**
 * 单个 fixed 覆盖片段。
 */
export interface WebviewFixedElementOverlay {
  /** 截图源区域的横向起点 */
  sourceX: number;
  /** 截图源区域的纵向起点 */
  sourceY: number;
  /** 覆盖区域宽度 */
  width: number;
  /** 覆盖区域高度 */
  height: number;
  /** 在最终长图中的横向位置 */
  targetX: number;
  /** 在最终长图中的纵向位置 */
  targetY: number;
}

/**
 * 某个滚动位置下需要采样的 fixed 覆盖分组。
 */
export interface WebviewFixedElementOverlayCapture {
  /** 采样前需要滚动到的位置 */
  scrollTop: number;
  /** 当前采样需要显示的 fixed 角色 */
  roles: WebviewFixedElementRole[];
  /** 从当前截图中裁出的覆盖区域 */
  overlays: WebviewFixedElementOverlay[];
}

/**
 * 元素截图滚动目标：页面本身。
 */
export interface WebviewElementWindowScrollTarget {
  /** 滚动目标类型 */
  type: 'window';
}

/**
 * 元素截图滚动目标：页面内部滚动容器。
 */
export interface WebviewElementContainerScrollTarget {
  /** 滚动目标类型 */
  type: 'element';
  /** 临时标记值，用于跨脚本定位同一个滚动容器 */
  marker: string;
}

/**
 * 元素截图滚动目标。
 */
export type WebviewElementScrollTarget = WebviewElementWindowScrollTarget | WebviewElementContainerScrollTarget;

/**
 * 页面元素在当前视口中的可截图区域。
 */
export interface WebviewElementCaptureRect {
  /** 元素在滚动目标内容中的横向位置 */
  pageX: number;
  /** 元素在滚动目标内容中的纵向位置 */
  pageY: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** 滚动目标可见区域在 WebView 截图中的横向位置 */
  viewportX: number;
  /** 滚动目标可见区域在 WebView 截图中的纵向位置 */
  viewportY: number;
  /** 滚动目标可见区域宽度 */
  viewportWidth: number;
  /** 滚动目标可见区域高度 */
  viewportHeight: number;
  /** WebView 当前可截图视口宽度 */
  captureViewportWidth: number;
  /** WebView 当前可截图视口高度 */
  captureViewportHeight: number;
  /** 滚动目标最大横向可滚动距离 */
  maxScrollLeft: number;
  /** 滚动目标最大纵向可滚动距离 */
  maxScrollTop: number;
  /** 截图前横向滚动位置 */
  scrollLeft: number;
  /** 截图前纵向滚动位置 */
  scrollTop: number;
  /** 执行截图采样时需要滚动的目标 */
  scrollTarget: WebviewElementScrollTarget;
  /** 是否为 fixed/sticky 等绑定在当前视口位置的目标 */
  isViewportAnchored?: boolean;
}

/**
 * 页面元素截图所需的页面与视口指标。
 */
export type WebviewElementCaptureMetrics = Pick<
  WebviewElementCaptureRect,
  | 'viewportX'
  | 'viewportY'
  | 'viewportWidth'
  | 'viewportHeight'
  | 'captureViewportWidth'
  | 'captureViewportHeight'
  | 'maxScrollLeft'
  | 'maxScrollTop'
  | 'scrollLeft'
  | 'scrollTop'
  | 'scrollTarget'
>;

/** 用于在元素截图期间标记内部滚动容器的属性名。 */
const ELEMENT_CAPTURE_SCROLL_CONTAINER_ATTRIBUTE = 'data-tibis-element-capture-scroll-container';
/** 用于在元素截图期间标记临时隐藏遮挡层的属性名。 */
const ELEMENT_CAPTURE_OBSTRUCTION_ATTRIBUTE = 'data-tibis-element-capture-obstruction-hidden';
/** 用于保存遮挡层原始 visibility 的属性名。 */
const ELEMENT_CAPTURE_OBSTRUCTION_VISIBILITY_ATTRIBUTE = 'data-tibis-element-capture-obstruction-visibility';
/** 用于保存遮挡层原始 visibility 优先级的属性名。 */
const ELEMENT_CAPTURE_OBSTRUCTION_PRIORITY_ATTRIBUTE = 'data-tibis-element-capture-obstruction-priority';

/**
 * 判断值是否为有限数字。
 * @param value - 待校验的值
 * @returns 是否为有限数字
 */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 判断值是否为元素截图滚动目标。
 * @param value - 待校验的值
 * @returns 是否为合法的滚动目标
 */
function isWebviewElementScrollTarget(value: unknown): value is WebviewElementScrollTarget {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const target = value as { type?: unknown; marker?: unknown };
  if (target.type === 'window') {
    return true;
  }

  if (target.type === 'element') {
    return typeof target.marker === 'string' && target.marker.length > 0;
  }

  return false;
}

/**
 * 判断值是否为页面截屏尺寸信息。
 * @param value - 待校验的值
 * @returns 是否为合法的尺寸信息
 */
export function isWebviewPageCaptureMetrics(value: unknown): value is WebviewPageCaptureMetrics {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const metrics = value as Partial<WebviewPageCaptureMetrics>;
  return [metrics.contentHeight, metrics.viewportWidth, metrics.viewportHeight, metrics.maxScrollTop, metrics.scrollTop].every((item) => isFiniteNumber(item));
}

/**
 * 判断值是否为元素截图区域。
 * @param value - 待校验的值
 * @returns 是否为合法的元素截图区域
 */
export function isWebviewElementCaptureRect(value: unknown): value is WebviewElementCaptureRect {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const rect = value as Partial<WebviewElementCaptureRect>;
  return (
    [
      rect.pageX,
      rect.pageY,
      rect.width,
      rect.height,
      rect.viewportX,
      rect.viewportY,
      rect.viewportWidth,
      rect.viewportHeight,
      rect.captureViewportWidth,
      rect.captureViewportHeight,
      rect.maxScrollLeft,
      rect.maxScrollTop,
      rect.scrollLeft,
      rect.scrollTop
    ].every((item) => isFiniteNumber(item)) && isWebviewElementScrollTarget(rect.scrollTarget)
  );
}

/**
 * 判断值是否为元素截图指标。
 * @param value - 待校验的值
 * @returns 是否为合法的元素截图指标
 */
export function isWebviewElementCaptureMetrics(value: unknown): value is WebviewElementCaptureMetrics {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const metrics = value as Partial<WebviewElementCaptureMetrics>;
  return (
    [
      metrics.viewportX,
      metrics.viewportY,
      metrics.viewportWidth,
      metrics.viewportHeight,
      metrics.captureViewportWidth,
      metrics.captureViewportHeight,
      metrics.maxScrollLeft,
      metrics.maxScrollTop,
      metrics.scrollLeft,
      metrics.scrollTop
    ].every((item) => isFiniteNumber(item)) && isWebviewElementScrollTarget(metrics.scrollTarget)
  );
}

/**
 * 构建用于读取页面截屏尺寸信息的脚本。
 * @returns 可执行脚本文本
 */
export function createPageCaptureMetricsScript(): string {
  return `
(() => {
  const doc = document.documentElement;
  const body = document.body;
  const contentHeight = Math.max(
    doc?.scrollHeight || 0,
    body?.scrollHeight || 0,
    doc?.offsetHeight || 0,
    body?.offsetHeight || 0,
    window.innerHeight || 0
  );
  const viewportWidth = Math.max(window.innerWidth || 0, doc?.clientWidth || 0);
  const viewportHeight = Math.max(window.innerHeight || 0, doc?.clientHeight || 0);
  const scrollTop = Math.max(window.scrollY || 0, doc?.scrollTop || 0, body?.scrollTop || 0);
  const maxScrollTop = Math.max(contentHeight - viewportHeight, 0);

  return {
    contentHeight,
    viewportWidth,
    viewportHeight,
    maxScrollTop,
    scrollTop
  };
})();
  `;
}

/**
 * 构建读取选中元素当前可视区域的脚本。
 * @param selector - 元素选择器
 * @returns 可执行脚本文本
 */
export function createElementCaptureRectScript(selector: string): string {
  return `
(() => {
  const element = document.querySelector(${JSON.stringify(selector)});
  if (!(element instanceof Element)) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const doc = document.documentElement;
  const body = document.body;
  const markerAttribute = ${JSON.stringify(ELEMENT_CAPTURE_SCROLL_CONTAINER_ATTRIBUTE)};
  const captureViewportWidth = Math.max(window.innerWidth || 0, doc?.clientWidth || 0);
  const captureViewportHeight = Math.max(window.innerHeight || 0, doc?.clientHeight || 0);
  const scrollLeft = Math.max(window.scrollX || 0, doc?.scrollLeft || 0, body?.scrollLeft || 0);
  const scrollTop = Math.max(window.scrollY || 0, doc?.scrollTop || 0, body?.scrollTop || 0);

	  function parseStickyInset(value) {
	    if (!value || value === 'auto') {
	      return null;
	    }

	    const parsed = Number.parseFloat(value);
	    return Number.isFinite(parsed) ? parsed : null;
	  }

	  function isStickyPinned(element, style) {
	    const elementRect = element.getBoundingClientRect();
	    const top = parseStickyInset(style.top);
	    const bottom = parseStickyInset(style.bottom);
	    const left = parseStickyInset(style.left);
	    const right = parseStickyInset(style.right);
	    const isPinnedTop = top !== null && Math.abs(elementRect.top - top) <= 1;
	    const isPinnedBottom = bottom !== null && Math.abs(captureViewportHeight - elementRect.bottom - bottom) <= 1;
	    const isPinnedLeft = left !== null && Math.abs(elementRect.left - left) <= 1;
	    const isPinnedRight = right !== null && Math.abs(captureViewportWidth - elementRect.right - right) <= 1;

	    return isPinnedTop || isPinnedBottom || isPinnedLeft || isPinnedRight;
	  }

	  function isViewportAnchoredElement(element) {
	    const style = window.getComputedStyle(element);
	    if (style.position === 'fixed') {
	      return true;
	    }

	    return style.position === 'sticky' && isStickyPinned(element, style);
	  }

	  function findViewportAnchoredAncestor(startElement) {
	    let current = startElement;
	    while (current && current instanceof HTMLElement && current !== body && current !== doc) {
	      if (isViewportAnchoredElement(current)) {
	        return current;
	      }

      current = current.parentElement;
    }

    return null;
  }

  function isScrollableElement(candidate) {
    if (!(candidate instanceof HTMLElement) || candidate === body || candidate === doc) {
      return false;
    }

    const style = window.getComputedStyle(candidate);
    const canScrollX = /(auto|scroll|overlay)/.test(style.overflowX || '') && candidate.scrollWidth > candidate.clientWidth + 1;
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY || '') && candidate.scrollHeight > candidate.clientHeight + 1;

    return canScrollX || canScrollY;
  }

  function findScrollableAncestor(startElement) {
    let current = startElement.parentElement;
    while (current) {
      if (isScrollableElement(current)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function markScrollContainer(scrollContainer) {
    const existingMarker = scrollContainer.getAttribute(markerAttribute);
    if (existingMarker) {
      return existingMarker;
    }

    const marker = 'tibis-scroll-container-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    scrollContainer.setAttribute(markerAttribute, marker);
    return marker;
  }

  const viewportAnchoredElement = findViewportAnchoredAncestor(element);
  if (viewportAnchoredElement) {
    return {
      pageX: rect.left,
      pageY: rect.top,
      width: rect.width,
      height: rect.height,
      viewportX: 0,
      viewportY: 0,
      viewportWidth: captureViewportWidth,
      viewportHeight: captureViewportHeight,
      captureViewportWidth,
      captureViewportHeight,
      maxScrollLeft: 0,
      maxScrollTop: 0,
      scrollLeft,
      scrollTop,
      scrollTarget: {
        type: 'window'
      },
      isViewportAnchored: true
    };
  }

  const scrollContainer = findScrollableAncestor(element);
  if (scrollContainer) {
    const containerRect = scrollContainer.getBoundingClientRect();
    const viewportWidth = Math.max(scrollContainer.clientWidth || 0, containerRect.width || 0);
    const viewportHeight = Math.max(scrollContainer.clientHeight || 0, containerRect.height || 0);

    return {
      pageX: scrollContainer.scrollLeft + rect.left - containerRect.left,
      pageY: scrollContainer.scrollTop + rect.top - containerRect.top,
      width: rect.width,
      height: rect.height,
      viewportX: containerRect.left,
      viewportY: containerRect.top,
      viewportWidth,
      viewportHeight,
      captureViewportWidth,
      captureViewportHeight,
      maxScrollLeft: Math.max((scrollContainer.scrollWidth || 0) - viewportWidth, 0),
      maxScrollTop: Math.max((scrollContainer.scrollHeight || 0) - viewportHeight, 0),
      scrollLeft: scrollContainer.scrollLeft || 0,
      scrollTop: scrollContainer.scrollTop || 0,
      scrollTarget: {
        type: 'element',
        marker: markScrollContainer(scrollContainer)
      },
      isViewportAnchored: false
    };
  }

  const contentWidth = Math.max(
    doc?.scrollWidth || 0,
    body?.scrollWidth || 0,
    doc?.offsetWidth || 0,
    body?.offsetWidth || 0,
    captureViewportWidth
  );
  const contentHeight = Math.max(
    doc?.scrollHeight || 0,
    body?.scrollHeight || 0,
    doc?.offsetHeight || 0,
    body?.offsetHeight || 0,
    captureViewportHeight
  );

  return {
    pageX: scrollLeft + rect.left,
    pageY: scrollTop + rect.top,
    width: rect.width,
    height: rect.height,
    viewportX: 0,
    viewportY: 0,
    viewportWidth: captureViewportWidth,
    viewportHeight: captureViewportHeight,
    captureViewportWidth,
    captureViewportHeight,
    maxScrollLeft: Math.max(contentWidth - captureViewportWidth, 0),
    maxScrollTop: Math.max(contentHeight - captureViewportHeight, 0),
    scrollLeft,
    scrollTop,
    scrollTarget: {
      type: 'window'
    },
    isViewportAnchored: false
  };
})();
`;
}

/**
 * 构建读取元素截图页面指标的脚本。
 * @returns 可执行脚本文本
 */
export function createElementCaptureMetricsScript(): string {
  return `
(() => {
  const doc = document.documentElement;
  const body = document.body;
  const contentWidth = Math.max(
    doc?.scrollWidth || 0,
    body?.scrollWidth || 0,
    doc?.offsetWidth || 0,
    body?.offsetWidth || 0,
    window.innerWidth || 0
  );
  const contentHeight = Math.max(
    doc?.scrollHeight || 0,
    body?.scrollHeight || 0,
    doc?.offsetHeight || 0,
    body?.offsetHeight || 0,
    window.innerHeight || 0
  );
  const viewportWidth = Math.max(window.innerWidth || 0, doc?.clientWidth || 0);
  const viewportHeight = Math.max(window.innerHeight || 0, doc?.clientHeight || 0);
  const scrollLeft = Math.max(window.scrollX || 0, doc?.scrollLeft || 0, body?.scrollLeft || 0);
  const scrollTop = Math.max(window.scrollY || 0, doc?.scrollTop || 0, body?.scrollTop || 0);

  return {
    viewportX: 0,
    viewportY: 0,
    viewportWidth,
    viewportHeight,
    captureViewportWidth: viewportWidth,
    captureViewportHeight: viewportHeight,
    maxScrollLeft: Math.max(contentWidth - viewportWidth, 0),
    maxScrollTop: Math.max(contentHeight - viewportHeight, 0),
    scrollLeft,
    scrollTop,
    scrollTarget: {
      type: 'window'
    },
    isViewportAnchored: false
  };
})();
`;
}

/**
 * 构建控制元素选择器高亮层显隐的脚本。
 * @param visible - 是否恢复原始显隐状态
 * @returns 可执行脚本文本
 */
export function createElementPickerLayerVisibilityScript(visible: boolean): string {
  return `
(() => new Promise((resolve) => {
	  const layerSelector = '.tibis-element-picker-highlight,.tibis-element-picker-selected';
  const previousHiddenAttribute = 'data-tibis-capture-previous-hidden';

  function hideElementPickerLayer(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    if (!element.hasAttribute(previousHiddenAttribute)) {
      element.setAttribute(previousHiddenAttribute, element.hidden ? 'true' : 'false');
    }
    element.hidden = true;
  }

  function restoreElementPickerLayer(element) {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const previousHidden = element.getAttribute(previousHiddenAttribute);
    if (previousHidden === null) {
      return;
    }

    element.hidden = previousHidden === 'true';
    element.removeAttribute(previousHiddenAttribute);
  }

  const handler = ${visible ? 'restoreElementPickerLayer' : 'hideElementPickerLayer'};
  document.querySelectorAll(layerSelector).forEach((element) => handler(element));
  requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve(null));
  });
}))();
`;
}

/**
 * 构建控制元素截图遮挡层显隐的脚本。
 * @param selector - 当前选中元素选择器
 * @param visible - 是否恢复原始显隐状态
 * @param captureRect - 当前切片在 WebView 视口中的裁剪区域
 * @returns 可执行脚本文本
 */
export function createElementCaptureObstructionVisibilityScript(
  selector: string,
  visible: boolean,
  captureRect: { x: number; y: number; width: number; height: number }
): string {
  const normalizedRect = {
    x: Math.max(0, Math.floor(captureRect.x)),
    y: Math.max(0, Math.floor(captureRect.y)),
    width: Math.max(1, Math.ceil(captureRect.width)),
    height: Math.max(1, Math.ceil(captureRect.height))
  };

  return `
(() => new Promise((resolve) => {
  const selectedSelector = ${JSON.stringify(selector)};
  const captureRect = ${JSON.stringify(normalizedRect)};
  const hiddenAttribute = ${JSON.stringify(ELEMENT_CAPTURE_OBSTRUCTION_ATTRIBUTE)};
  const visibilityAttribute = ${JSON.stringify(ELEMENT_CAPTURE_OBSTRUCTION_VISIBILITY_ATTRIBUTE)};
  const priorityAttribute = ${JSON.stringify(ELEMENT_CAPTURE_OBSTRUCTION_PRIORITY_ATTRIBUTE)};
  const targetElement = document.querySelector(selectedSelector);

  function intersectsCaptureRect(element) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return false;
    }

    return (
      rect.left < captureRect.x + captureRect.width &&
      rect.right > captureRect.x &&
      rect.top < captureRect.y + captureRect.height &&
      rect.bottom > captureRect.y
    );
  }

  function isRelatedToTarget(element) {
    if (!(targetElement instanceof Element)) {
      return false;
    }

    return element === targetElement || element.contains(targetElement) || targetElement.contains(element);
  }

  function shouldHideElement(element) {
    if (!(element instanceof HTMLElement) || isRelatedToTarget(element)) {
      return false;
    }

    const style = window.getComputedStyle(element);
    if (style.position !== 'fixed' && style.position !== 'sticky') {
      return false;
    }

    return intersectsCaptureRect(element);
  }

  function hideElementCaptureObstruction(element) {
    if (!(element instanceof HTMLElement) || !shouldHideElement(element)) {
      return;
    }

    if (!element.hasAttribute(hiddenAttribute)) {
      element.setAttribute(hiddenAttribute, 'true');
      element.setAttribute(visibilityAttribute, element.style.getPropertyValue('visibility'));
      element.setAttribute(priorityAttribute, element.style.getPropertyPriority('visibility'));
    }

    element.style.setProperty('visibility', 'hidden', 'important');
  }

  function restoreElementCaptureObstruction(element) {
    if (!(element instanceof HTMLElement) || !element.hasAttribute(hiddenAttribute)) {
      return;
    }

    const previousVisibility = element.getAttribute(visibilityAttribute) || '';
    const previousPriority = element.getAttribute(priorityAttribute) || '';
    element.style.setProperty('visibility', previousVisibility, previousPriority);
    element.removeAttribute(hiddenAttribute);
    element.removeAttribute(visibilityAttribute);
    element.removeAttribute(priorityAttribute);
  }

  const handler = ${visible ? 'restoreElementCaptureObstruction' : 'hideElementCaptureObstruction'};
  const candidates = ${visible ? "Array.from(document.querySelectorAll('[' + hiddenAttribute + ']'))" : "Array.from(document.querySelectorAll('*'))"};
  candidates.forEach((element) => handler(element));
  requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve(null));
  });
}))();
`;
}

/**
 * 构建滚动页面后等待两帧再返回的脚本。
 * @param scrollTop - 目标滚动位置
 * @returns 可执行脚本文本
 */
export function createPageScrollScript(scrollTop: number, scrollLeft = 0): string {
  const normalizedScrollTop = Math.max(0, Math.floor(scrollTop));
  const normalizedScrollLeft = Math.max(0, Math.floor(scrollLeft));

  return `
(() => new Promise((resolve) => {
  window.scrollTo(${normalizedScrollLeft}, ${normalizedScrollTop});
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      resolve({
        scrollLeft: window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0,
        scrollTop: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
      });
    });
  });
}))();
`;
}

/**
 * 构建滚动元素截图目标后等待两帧再返回的脚本。
 * @param scrollTarget - 需要滚动的目标
 * @param scrollTop - 目标纵向滚动位置
 * @param scrollLeft - 目标横向滚动位置
 * @returns 可执行脚本文本
 */
export function createElementCaptureScrollScript(scrollTarget: WebviewElementScrollTarget, scrollTop: number, scrollLeft = 0): string {
  const normalizedScrollTop = Math.max(0, Math.floor(scrollTop));
  const normalizedScrollLeft = Math.max(0, Math.floor(scrollLeft));

  return `
(() => new Promise((resolve, reject) => {
  const target = ${JSON.stringify(scrollTarget)};
  const markerAttribute = ${JSON.stringify(ELEMENT_CAPTURE_SCROLL_CONTAINER_ATTRIBUTE)};

  function resolveAfterFrames(getPosition) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve(getPosition()));
    });
  }

  if (target.type === 'element') {
    const scrollContainer = Array.from(document.querySelectorAll('[' + markerAttribute + ']'))
      .find((candidate) => candidate.getAttribute(markerAttribute) === target.marker);

    if (!(scrollContainer instanceof HTMLElement)) {
      reject(new Error('读取内部滚动容器失败'));
      return;
    }

    scrollContainer.scrollLeft = ${normalizedScrollLeft};
    scrollContainer.scrollTop = ${normalizedScrollTop};
    resolveAfterFrames(() => ({
      scrollLeft: scrollContainer.scrollLeft || 0,
      scrollTop: scrollContainer.scrollTop || 0
    }));
    return;
  }

  window.scrollTo(${normalizedScrollLeft}, ${normalizedScrollTop});
  resolveAfterFrames(() => ({
    scrollLeft: window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0,
    scrollTop: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0
  }));
}))();
`;
}

/**
 * 构建清理元素截图临时滚动容器标记的脚本。
 * @param scrollTarget - 截图期间使用的滚动目标
 * @returns 可执行脚本文本
 */
export function createElementCaptureCleanupScript(scrollTarget: WebviewElementScrollTarget): string {
  const marker = scrollTarget.type === 'element' ? scrollTarget.marker : '';

  return `
(() => {
  const markerAttribute = ${JSON.stringify(ELEMENT_CAPTURE_SCROLL_CONTAINER_ATTRIBUTE)};
  const marker = ${JSON.stringify(marker)};
  if (!marker) {
    return null;
  }

  Array.from(document.querySelectorAll('[' + markerAttribute + ']')).forEach((element) => {
    if (element.getAttribute(markerAttribute) === marker) {
      element.removeAttribute(markerAttribute);
    }
  });

  return null;
})();
`;
}

/**
 * 按页面总高度和视口高度构建长截屏切片信息。
 * @param metrics - 页面尺寸信息
 * @returns 按顺序采样的切片列表
 */
export function buildPageCaptureSlices(metrics: WebviewPageCaptureMetrics): WebviewPageCaptureSlice[] {
  const normalizedViewportHeight = Math.max(1, Math.floor(metrics.viewportHeight));
  const normalizedContentHeight = Math.max(1, Math.floor(metrics.contentHeight));
  const normalizedMaxScrollTop = Math.max(0, Math.floor(metrics.maxScrollTop));
  const slices: WebviewPageCaptureSlice[] = [];

  for (let offsetY = 0; offsetY < normalizedContentHeight; offsetY += normalizedViewportHeight) {
    const height = Math.min(normalizedViewportHeight, normalizedContentHeight - offsetY);
    const scrollTop = Math.min(offsetY, normalizedMaxScrollTop);
    const sourceY = Math.max(offsetY - scrollTop, 0);

    slices.push({
      offsetY,
      height,
      scrollTop,
      sourceY,
      captureFixedElements: offsetY === 0
    });
  }

  return slices;
}

/**
 * 判断值是否为 fixed 元素快照数组。
 * @param value - 待判断的值
 * @returns 是否为合法快照数组
 */
export function isWebviewFixedElementSnapshotArray(value: unknown): value is WebviewFixedElementSnapshot[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const snapshot = item as Partial<WebviewFixedElementSnapshot>;
      return (
        typeof snapshot.id === 'string' &&
        ['top', 'bottom', 'other'].includes(snapshot.role || '') &&
        typeof snapshot.top === 'number' &&
        typeof snapshot.left === 'number' &&
        typeof snapshot.width === 'number' &&
        typeof snapshot.height === 'number'
      );
    })
  );
}

/**
 * 追加某个滚动位置下的 fixed 覆盖采样项。
 * @param captureMap - 采样分组映射
 * @param scrollTop - 采样滚动位置
 * @param element - 当前元素观测值
 */
function appendOverlayCapture(captureMap: Map<number, WebviewFixedElementOverlayCapture>, scrollTop: number, element: WebviewFixedElementSnapshot): void {
  const overlay: WebviewFixedElementOverlay = {
    sourceX: Math.max(0, element.left),
    sourceY: Math.max(0, element.top),
    width: Math.max(1, element.width),
    height: Math.max(1, element.height),
    targetX: Math.max(0, element.left),
    targetY: Math.max(0, scrollTop + element.top)
  };

  const currentCapture = captureMap.get(scrollTop);
  if (currentCapture) {
    if (!currentCapture.roles.includes(element.role)) {
      currentCapture.roles.push(element.role);
    }
    currentCapture.overlays.push(overlay);
    return;
  }

  captureMap.set(scrollTop, {
    scrollTop,
    roles: [element.role],
    overlays: [overlay]
  });
}

/**
 * 按锚点位置构建 fixed 元素覆盖采样计划。
 * @param metrics - 页面尺寸信息
 * @param observationsBySlice - 各切片可见的定位元素快照
 * @param scrollTops - 各切片对应的滚动位置
 * @returns 采样分组
 */
export function buildFixedElementOverlayCaptures(
  metrics: WebviewPageCaptureMetrics,
  observationsBySlice: WebviewFixedElementSnapshot[][],
  scrollTops: number[]
): WebviewFixedElementOverlayCapture[] {
  const captureMap = new Map<number, WebviewFixedElementOverlayCapture>();
  const lastSliceIndex = Math.max(0, observationsBySlice.length - 1);
  const firstSliceObservations = observationsBySlice[0] || [];
  const lastSliceObservations = observationsBySlice[lastSliceIndex] || [];

  firstSliceObservations.forEach((element) => {
    if (element.role !== 'top') {
      return;
    }

    appendOverlayCapture(captureMap, 0, element);
  });

  lastSliceObservations.forEach((element) => {
    if (element.role !== 'bottom') {
      return;
    }

    appendOverlayCapture(captureMap, scrollTops[lastSliceIndex] ?? metrics.maxScrollTop, element);
  });

  return Array.from(captureMap.values()).sort((left, right) => left.scrollTop - right.scrollTop);
}

/** 用于标记 full-page 截图中 fixed 元素的属性名。 */
const FULL_PAGE_CAPTURE_FIXED_ATTRIBUTE = 'data-tibis-full-page-fixed';
/** 用于标记 full-page 截图中 sticky 元素的属性名。 */
const FULL_PAGE_CAPTURE_STICKY_ATTRIBUTE = 'data-tibis-full-page-sticky';
/** 用于标记定位层唯一标识的属性名。 */
const FULL_PAGE_CAPTURE_OVERLAY_ID_ATTRIBUTE = 'data-tibis-full-page-overlay-id';
/** 用于控制 fixed 元素显隐的样式节点 ID。 */
const FULL_PAGE_CAPTURE_STYLE_ID = '__tibis_full_page_capture_fixed_style__';
/** 用于在 full-page 截图期间隐藏所有滚动条的样式节点 ID。 */
const FULL_PAGE_CAPTURE_SCROLLBAR_STYLE_ID = '__tibis_full_page_capture_scrollbar_style__';

/**
 * 构建 full-page 截图前的 fixed 元素标记脚本。
 * @returns 可执行脚本文本
 */
export function createFixedElementCaptureSetupScript(): string {
  return `
(() => {
  const marker = ${JSON.stringify(FULL_PAGE_CAPTURE_FIXED_ATTRIBUTE)};
  const stickyMarker = ${JSON.stringify(FULL_PAGE_CAPTURE_STICKY_ATTRIBUTE)};
  const overlayIdMarker = ${JSON.stringify(FULL_PAGE_CAPTURE_OVERLAY_ID_ATTRIBUTE)};
  const styleId = ${JSON.stringify(FULL_PAGE_CAPTURE_STYLE_ID)};
  const scrollbarStyleId = ${JSON.stringify(FULL_PAGE_CAPTURE_SCROLLBAR_STYLE_ID)};
  const elements = Array.from(document.querySelectorAll('*'));
  const existingIndexes = elements
    .map((element) => Number.parseInt(element.getAttribute(overlayIdMarker) || '', 10))
    .filter((value) => Number.isFinite(value));
  let overlayIndex = existingIndexes.length ? Math.max(...existingIndexes) : 0;

  elements.forEach((element) => {
    if (!(element instanceof HTMLElement)) {
      return;
    }

    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }

    const computedStyle = window.getComputedStyle(element);
    if (computedStyle.position !== 'fixed' && computedStyle.position !== 'sticky') {
      return;
    }

    if (!element.hasAttribute(overlayIdMarker)) {
      overlayIndex += 1;
      element.setAttribute(overlayIdMarker, String(overlayIndex));
    }

    if (computedStyle.position === 'sticky') {
      element.setAttribute(stickyMarker, 'true');
      return;
    }

    element.setAttribute(marker, 'true');
  });

  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    document.documentElement.appendChild(style);
  }

  if (!document.getElementById(scrollbarStyleId)) {
    const scrollbarStyle = document.createElement('style');
    scrollbarStyle.id = scrollbarStyleId;
    scrollbarStyle.textContent = [
      'html, body, * { scrollbar-width: none !important; }',
      'html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }'
    ].join('\\n');
    document.documentElement.appendChild(scrollbarStyle);
  }

  return null;
})();
`;
}

/**
 * 构建读取当前视口中已标记定位元素的脚本。
 * @returns 可执行脚本文本
 */
export function createVisiblePositionedElementSnapshotScript(): string {
  return `
(() => {
  const fixedMarker = ${JSON.stringify(FULL_PAGE_CAPTURE_FIXED_ATTRIBUTE)};
  const stickyMarker = ${JSON.stringify(FULL_PAGE_CAPTURE_STICKY_ATTRIBUTE)};
  const overlayIdMarker = ${JSON.stringify(FULL_PAGE_CAPTURE_OVERLAY_ID_ATTRIBUTE)};

  return Array.from(document.querySelectorAll('[' + overlayIdMarker + ']'))
    .filter((element) => element instanceof HTMLElement)
    .map((element) => {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) {
        return null;
      }

      if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
        return null;
      }

      const computedStyle = window.getComputedStyle(element);
      const role = (() => {
        if (computedStyle.bottom !== 'auto' && rect.bottom >= window.innerHeight - 1) {
          return 'bottom';
        }

        if (computedStyle.top !== 'auto' && rect.top <= 1) {
          return 'top';
        }

        return 'other';
      })();

      if (!element.hasAttribute(fixedMarker) && !element.hasAttribute(stickyMarker)) {
        return null;
      }

      return {
        id: element.getAttribute(overlayIdMarker) || '',
        role,
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      };
    })
    .filter(Boolean);
})();
`;
}

/**
 * 构建切换 fixed 元素显隐的脚本。
 * @param visible - 是否显示 fixed 元素，或指定显示哪些 fixed 角色
 * @returns 可执行脚本文本
 */
export function createFixedElementVisibilityScript(visible: boolean | WebviewFixedElementRole[]): string {
  const stickyRule = `[${FULL_PAGE_CAPTURE_STICKY_ATTRIBUTE}="true"] { position: relative !important; top: auto !important; bottom: auto !important; }`;
  const fixedHiddenRule = [
    `[${FULL_PAGE_CAPTURE_FIXED_ATTRIBUTE}="true"] {`,
    'visibility: hidden !important;',
    'transition: none !important;',
    'animation: none !important;',
    '}'
  ].join(' ');
  let cssText = '';

  if (Array.isArray(visible)) {
    if (!visible.length) {
      cssText = [fixedHiddenRule, stickyRule].join('\n');
    }
  } else if (!visible) {
    cssText = [fixedHiddenRule, stickyRule].join('\n');
  }

  return `
(() => new Promise((resolve) => {
  const styleId = ${JSON.stringify(FULL_PAGE_CAPTURE_STYLE_ID)};
  const style = document.getElementById(styleId);
  if (!(style instanceof HTMLStyleElement)) {
    resolve(null);
    return;
  }

  style.textContent = ${JSON.stringify(cssText)};
  requestAnimationFrame(() => {
    requestAnimationFrame(() => resolve(null));
  });
}))();
`;
}

/**
 * 构建清理 fixed 元素标记与样式的脚本。
 * @returns 可执行脚本文本
 */
export function createFixedElementCaptureCleanupScript(): string {
  return `
(() => {
  const marker = ${JSON.stringify(FULL_PAGE_CAPTURE_FIXED_ATTRIBUTE)};
  const stickyMarker = ${JSON.stringify(FULL_PAGE_CAPTURE_STICKY_ATTRIBUTE)};
  const overlayIdMarker = ${JSON.stringify(FULL_PAGE_CAPTURE_OVERLAY_ID_ATTRIBUTE)};
  const styleId = ${JSON.stringify(FULL_PAGE_CAPTURE_STYLE_ID)};
  const scrollbarStyleId = ${JSON.stringify(FULL_PAGE_CAPTURE_SCROLLBAR_STYLE_ID)};

  document.querySelectorAll('[' + marker + '="true"]').forEach((element) => {
    if (element instanceof HTMLElement) {
      element.removeAttribute(marker);
      element.removeAttribute(overlayIdMarker);
    }
  });

  document.querySelectorAll('[' + stickyMarker + '="true"]').forEach((element) => {
    if (element instanceof HTMLElement) {
      element.removeAttribute(stickyMarker);
      element.removeAttribute(overlayIdMarker);
    }
  });

  document.getElementById(styleId)?.remove();
  document.getElementById(scrollbarStyleId)?.remove();
  return null;
})();
`;
}

/**
 * 从 PNG 二进制内容创建 Blob。
 * @param bytes - PNG ArrayBuffer
 * @returns 可用于预览或下载的 PNG Blob
 */
export function createPngBlob(bytes: ArrayBuffer): Blob {
  return new Blob([bytes], { type: 'image/png' });
}
