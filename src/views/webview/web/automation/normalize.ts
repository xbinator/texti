/**
 * @file normalize.ts
 * @description WebView 自动化快照与操作结果规范化工具。
 */
import type { ActiveWebviewSnapshotElement } from './types';
import type { AIToolExecutionError } from 'types/ai';
import type { WebviewElementSelection } from '@/views/webview/shared/types';
import type {
  WebviewAgentElement,
  WebviewOperateResult,
  WebviewOperateScrollResult,
  WebviewPageHeading,
  WebviewPageLink,
  WebviewPageSnapshot,
  WebviewPageTruncation,
  WebviewSelectedElementSnapshot,
  WebviewViewportElement,
  WebviewViewportRect,
  WebviewViewportSnapshot,
  WebviewViewportTopLayer
} from '@/views/webview/web/types';
import {
  WEBVIEW_PAGE_CONTENT_LIMIT,
  WEBVIEW_PAGE_ELEMENT_LIMIT,
  WEBVIEW_PAGE_HEADING_LIMIT,
  WEBVIEW_PAGE_LINK_LIMIT,
  WEBVIEW_PAGE_OPERATION_TIMEOUT_MS,
  WEBVIEW_PAGE_SELECTED_TEXT_LIMIT,
  WEBVIEW_PAGE_SNAPSHOT_TIMEOUT_MS,
  WEBVIEW_PAGE_TEXT_LIMIT
} from './constants';

/** 私有字区通常被 iconfont 用作图标编码，不应作为可读文本展示。 */
const PRIVATE_USE_ICON_GLYPH_PATTERN = /[\uE000-\uF8FF]/g;

/**
 * 页面脚本原始快照，允许旧脚本缺省 BrowserState 三段式字段。
 */
export type RawWebviewPageSnapshot = Omit<WebviewPageSnapshot, 'capturedAt' | 'truncated' | 'header' | 'content' | 'footer' | 'summary'> &
  Partial<Pick<WebviewPageSnapshot, 'header' | 'content' | 'footer' | 'summary'>>;

/**
 * WebView 操作可稳定透传给 ChatRuntime 的错误码。
 */
export type WebviewOperationErrorCode = Extract<
  AIToolExecutionError['code'],
  | 'EDITOR_UNAVAILABLE'
  | 'STALE_SNAPSHOT'
  | 'PAGE_LOADING'
  | 'ELEMENT_NOT_FOUND'
  | 'ACTION_NOT_SUPPORTED'
  | 'OPTION_AMBIGUOUS'
  | 'SCROLL_TARGET_NOT_FOUND'
  | 'BRIDGE_TIMEOUT'
  | 'INVALID_INPUT'
  | 'EXECUTION_FAILED'
>;

/** WebView 操作错误对象。 */
export type WebviewOperationError = Error & { code: WebviewOperationErrorCode };

/** WebView 操作错误消息映射。 */
const WEBVIEW_OPERATION_ERROR_MESSAGES: Record<WebviewOperationErrorCode, string> = {
  EDITOR_UNAVAILABLE: '当前页面尚未准备好操作，请稍后重试',
  STALE_SNAPSHOT: '网页快照已过期，请重新读取当前网页',
  PAGE_LOADING: '页面正在导航，请等待加载完成后重试',
  ELEMENT_NOT_FOUND: '未找到快照中的目标元素，请重新读取当前网页',
  ACTION_NOT_SUPPORTED: '目标元素不支持该网页操作',
  OPTION_AMBIGUOUS: '存在多个同名选项，请重新读取网页后选择更明确的目标',
  SCROLL_TARGET_NOT_FOUND: '目标元素没有可滚动容器',
  BRIDGE_TIMEOUT: '网页操作超时，请稍后重试',
  INVALID_INPUT: '网页操作参数无效',
  EXECUTION_FAILED: '网页操作失败'
};

/**
 * 判断值是否为 WebView 操作错误码。
 * @param value - 待判断值
 * @returns 是否为操作错误码
 */
function isWebviewOperationErrorCode(value: unknown): value is WebviewOperationErrorCode {
  return typeof value === 'string' && value in WEBVIEW_OPERATION_ERROR_MESSAGES;
}

/**
 * 创建带稳定错误码的 WebView 操作错误。
 * @param code - 操作错误码
 * @param message - 可选错误说明
 * @returns 操作错误
 */
export function createWebviewOperationError(code: WebviewOperationErrorCode, message?: string): WebviewOperationError {
  const error = new Error(message || WEBVIEW_OPERATION_ERROR_MESSAGES[code]) as WebviewOperationError;
  error.code = code;
  return error;
}

/**
 * 从页面脚本错误消息中提取稳定错误码。
 * @param message - 原始错误消息
 * @returns 操作错误码或 undefined
 */
function readWebviewOperationErrorCodeFromMessage(message: string): WebviewOperationErrorCode | undefined {
  const trimmedMessage = message.trim();
  if (isWebviewOperationErrorCode(trimmedMessage)) return trimmedMessage;

  const suffix = trimmedMessage.split(':').at(-1)?.trim();
  return isWebviewOperationErrorCode(suffix) ? suffix : undefined;
}

/**
 * 判断值是否为页面标题数组。
 * @param value - 待判断的值
 * @returns 是否为页面标题数组
 */
function isHeadingArray(value: unknown): value is WebviewPageHeading[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const heading = item as Partial<WebviewPageHeading>;
      return typeof heading.level === 'number' && typeof heading.text === 'string';
    })
  );
}

/**
 * 判断值是否为页面链接数组。
 * @param value - 待判断的值
 * @returns 是否为页面链接数组
 */
function isLinkArray(value: unknown): value is WebviewPageLink[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (!item || typeof item !== 'object') {
        return false;
      }

      const link = item as Partial<WebviewPageLink>;
      return typeof link.text === 'string' && typeof link.href === 'string';
    })
  );
}

/**
 * 判断值是否为字符串数组。
 * @param value - 待判断值
 * @returns 是否为字符串数组
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * 判断值是否为 WebView 命中测试目标摘要。
 * @param value - 待判断值
 * @returns 是否为 WebView 命中测试目标摘要
 */
function isAgentHitTarget(value: unknown): value is NonNullable<WebviewAgentElement['hitTarget']> {
  if (!value || typeof value !== 'object') return false;

  const target = value as Partial<NonNullable<WebviewAgentElement['hitTarget']>>;
  return typeof target.tagName === 'string' && typeof target.label === 'string' && typeof target.insideTarget === 'boolean';
}

/**
 * 判断值是否为 WebView Agent 元素数组。
 * @param value - 待判断值
 * @returns 是否为可交互元素数组
 */
function isAgentElementArray(value: unknown): value is WebviewAgentElement[] {
  return (
    Array.isArray(value) &&
    value.every((item) => {
      if (!item || typeof item !== 'object') return false;

      const element = item as Partial<WebviewAgentElement>;
      return (
        typeof element.index === 'number' &&
        typeof element.tagName === 'string' &&
        typeof element.text === 'string' &&
        typeof element.label === 'string' &&
        (element.roleHint === undefined || typeof element.roleHint === 'string') &&
        (element.fingerprint === undefined || typeof element.fingerprint === 'string') &&
        typeof element.disabled === 'boolean' &&
        typeof element.isNew === 'boolean' &&
        (element.clickableScore === undefined || typeof element.clickableScore === 'number') &&
        (element.reasons === undefined || isStringArray(element.reasons)) &&
        (element.semanticPath === undefined || isStringArray(element.semanticPath)) &&
        (element.hitTarget === undefined || isAgentHitTarget(element.hitTarget)) &&
        Array.isArray(element.actions)
      );
    })
  );
}

/**
 * 判断值是否为视口矩形。
 * @param value - 待判断值
 * @returns 是否为视口矩形
 */
function isViewportRect(value: unknown): value is WebviewViewportRect {
  if (!value || typeof value !== 'object') return false;

  const rect = value as Partial<WebviewViewportRect>;
  return typeof rect.x === 'number' && typeof rect.y === 'number' && typeof rect.width === 'number' && typeof rect.height === 'number';
}

/**
 * 判断值是否为视口可交互元素。
 * @param value - 待判断值
 * @returns 是否为视口可交互元素
 */
function isViewportElement(value: unknown): value is WebviewViewportElement {
  if (!value || typeof value !== 'object') return false;

  const element = value as Partial<WebviewViewportElement>;
  return (
    typeof element.index === 'number' &&
    typeof element.tagName === 'string' &&
    typeof element.label === 'string' &&
    (element.roleHint === undefined || typeof element.roleHint === 'string') &&
    Array.isArray(element.actions) &&
    isViewportRect(element.rect) &&
    typeof element.visibleRatio === 'number' &&
    typeof element.covered === 'boolean' &&
    (element.layer === 'page' || element.layer === 'top' || element.layer === 'background') &&
    typeof element.primary === 'boolean' &&
    (element.clickableScore === undefined || typeof element.clickableScore === 'number') &&
    (element.reasons === undefined || isStringArray(element.reasons)) &&
    (element.semanticPath === undefined || isStringArray(element.semanticPath)) &&
    (element.hitTarget === undefined || isAgentHitTarget(element.hitTarget))
  );
}

/**
 * 判断值是否为顶层浮层摘要。
 * @param value - 待判断值
 * @returns 是否为顶层浮层摘要
 */
function isViewportTopLayer(value: unknown): value is WebviewViewportTopLayer {
  if (!value || typeof value !== 'object') return false;

  const layer = value as Partial<WebviewViewportTopLayer>;
  return (
    (layer.kind === 'dialog' || layer.kind === 'panel') &&
    typeof layer.label === 'string' &&
    typeof layer.text === 'string' &&
    isViewportRect(layer.rect) &&
    Array.isArray(layer.elementIndexes) &&
    layer.elementIndexes.every((index) => typeof index === 'number') &&
    (layer.primaryActionIndex === undefined || typeof layer.primaryActionIndex === 'number') &&
    typeof layer.dimmed === 'boolean'
  );
}

/**
 * 判断值是否为视口摘要。
 * @param value - 待判断值
 * @returns 是否为视口摘要
 */
function isViewportSnapshot(value: unknown): value is WebviewViewportSnapshot {
  if (!value || typeof value !== 'object') return false;

  const viewport = value as Partial<WebviewViewportSnapshot>;
  return (
    typeof viewport.width === 'number' &&
    typeof viewport.height === 'number' &&
    typeof viewport.scrollX === 'number' &&
    typeof viewport.scrollY === 'number' &&
    (viewport.topLayer === undefined || isViewportTopLayer(viewport.topLayer)) &&
    Array.isArray(viewport.elements) &&
    viewport.elements.every(isViewportElement)
  );
}

/**
 * 裁剪字符串并返回截断标记。
 * @param value - 原始字符串
 * @param limit - 最大长度
 * @returns 裁剪结果
 */
function truncateText(value: string, limit: number): { value: string; truncated: boolean } {
  if (value.length <= limit) {
    return { value, truncated: false };
  }

  return { value: value.slice(0, limit), truncated: true };
}

/**
 * 规范化视口矩形。
 * @param rect - 页面脚本返回的矩形
 * @returns 裁剪后的视口矩形
 */
function normalizeViewportRect(rect: WebviewViewportRect): WebviewViewportRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

/**
 * 规范化顶层浮层摘要。
 * @param layer - 页面脚本返回的浮层摘要
 * @returns 裁剪后的顶层浮层摘要
 */
function normalizeViewportTopLayer(layer: WebviewViewportTopLayer): WebviewViewportTopLayer {
  return {
    kind: layer.kind,
    label: truncateText(layer.label, 160).value,
    text: truncateText(layer.text, 1000).value,
    rect: normalizeViewportRect(layer.rect),
    elementIndexes: layer.elementIndexes.slice(0, WEBVIEW_PAGE_ELEMENT_LIMIT),
    ...(typeof layer.primaryActionIndex === 'number' ? { primaryActionIndex: layer.primaryActionIndex } : {}),
    dimmed: layer.dimmed
  };
}

/**
 * 规范化视口可交互元素。
 * @param element - 页面脚本返回的视口元素
 * @returns 裁剪后的视口元素
 */
function normalizeViewportElement(element: WebviewViewportElement): WebviewViewportElement {
  return {
    index: element.index,
    tagName: truncateText(element.tagName, 40).value,
    label: truncateText(element.label, 300).value,
    ...(element.roleHint ? { roleHint: truncateText(element.roleHint, 80).value } : {}),
    actions: element.actions.filter((action) => action === 'click' || action === 'input' || action === 'select' || action === 'press' || action === 'scroll'),
    rect: normalizeViewportRect(element.rect),
    visibleRatio: Math.max(0, Math.min(1, Number(element.visibleRatio.toFixed(3)))),
    covered: element.covered,
    layer: element.layer,
    primary: element.primary,
    ...(typeof element.clickableScore === 'number' ? { clickableScore: Math.max(0, Math.min(1, Number(element.clickableScore.toFixed(3)))) } : {}),
    ...(element.reasons ? { reasons: element.reasons.map((reason) => truncateText(reason, 80).value).slice(0, 12) } : {}),
    ...(element.semanticPath ? { semanticPath: element.semanticPath.map((item) => truncateText(item, 120).value).slice(0, 6) } : {}),
    ...(element.hitTarget
      ? {
          hitTarget: {
            tagName: truncateText(element.hitTarget.tagName, 40).value,
            label: truncateText(element.hitTarget.label, 300).value,
            insideTarget: element.hitTarget.insideTarget
          }
        }
      : {})
  };
}

/**
 * 规范化视口视觉摘要。
 * @param viewport - 页面脚本返回的视口摘要
 * @returns 裁剪后的视口摘要
 */
function normalizeViewportSnapshot(viewport: WebviewViewportSnapshot | undefined): WebviewViewportSnapshot | undefined {
  if (!viewport) return undefined;

  return {
    width: Math.round(viewport.width),
    height: Math.round(viewport.height),
    scrollX: Math.round(viewport.scrollX),
    scrollY: Math.round(viewport.scrollY),
    ...(viewport.topLayer ? { topLayer: normalizeViewportTopLayer(viewport.topLayer) } : {}),
    elements: viewport.elements.slice(0, WEBVIEW_PAGE_ELEMENT_LIMIT).map(normalizeViewportElement)
  };
}

/**
 * 规范化选中元素矩形。
 * @param rect - 元素选择器返回的矩形
 * @returns 裁剪后的选中元素矩形
 */
function normalizeSelectedElementRect(rect: WebviewElementSelection['rect']): WebviewSelectedElementSnapshot['rect'] {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    ...(typeof rect.pageX === 'number' ? { pageX: Math.round(rect.pageX) } : {}),
    ...(typeof rect.pageY === 'number' ? { pageY: Math.round(rect.pageY) } : {}),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

/**
 * 计算两个视口矩形的重叠比例。
 * @param first - 第一个矩形
 * @param second - 第二个矩形
 * @returns 以较小矩形为基准的重叠比例
 */
function getViewportRectOverlapRatio(first: WebviewViewportRect, second: WebviewViewportRect): number {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  const overlapArea = Math.max(right - left, 0) * Math.max(bottom - top, 0);
  const firstArea = Math.max(first.width * first.height, 1);
  const secondArea = Math.max(second.width * second.height, 1);
  return overlapArea / Math.min(firstArea, secondArea);
}

/**
 * 规范化用于选中元素匹配的文本。
 * @param value - 原始文本
 * @returns 去除图标字形后的可读文本
 */
function normalizeSelectedElementMatchText(value: string): string {
  return value.replace(PRIVATE_USE_ICON_GLYPH_PATTERN, '').replace(/\s+/g, ' ').trim();
}

/**
 * 计算选中元素与可操作元素的匹配分数。
 * @param selection - 用户选中元素
 * @param element - 快照可操作元素
 * @returns 匹配分数
 */
function scoreSelectedElementMatch(selection: WebviewElementSelection, element: WebviewAgentElement): number {
  let score = 0;
  const selectedText = normalizeSelectedElementMatchText(selection.text);
  const elementLabel = normalizeSelectedElementMatchText(element.label || element.text);

  if (selection.tagName.toUpperCase() === element.tagName.toUpperCase()) {
    score += 20;
  }

  if (selectedText && elementLabel) {
    if (selectedText === elementLabel) {
      score += 40;
    } else if (selectedText.includes(elementLabel) || elementLabel.includes(selectedText)) {
      score += 20;
    }
  }

  if (element.rect) {
    const selectedRect = normalizeSelectedElementRect(selection.rect);
    const xClose = Math.abs(selectedRect.x - element.rect.x) <= 4;
    const yClose = Math.abs(selectedRect.y - element.rect.y) <= 4;
    const widthClose = Math.abs(selectedRect.width - element.rect.width) <= 4;
    const heightClose = Math.abs(selectedRect.height - element.rect.height) <= 4;
    if (xClose && yClose && widthClose && heightClose) {
      score += 50;
    } else if (getViewportRectOverlapRatio(selectedRect, element.rect) >= 0.6) {
      score += 30;
    }
  }

  return score;
}

/**
 * 查找用户选中元素对应的快照可操作元素。
 * @param selection - 用户选中元素
 * @param elements - 快照可操作元素列表
 * @returns 匹配到的可操作元素
 */
function findSelectedElementMatch(selection: WebviewElementSelection, elements: WebviewAgentElement[] | undefined): WebviewAgentElement | null {
  const scoredElements = (elements ?? [])
    .map((element) => ({ element, score: scoreSelectedElementMatch(selection, element) }))
    .filter((item) => item.score >= 40)
    .sort((first, second) => second.score - first.score);

  return scoredElements[0]?.element ?? null;
}

/**
 * 创建 AI 工具可读的用户选中元素摘要。
 * @param selection - 用户选中元素
 * @param elements - 当前快照可操作元素列表
 * @returns 用户选中元素摘要
 */
export function createSelectedElementSnapshot(
  selection: WebviewElementSelection | null,
  elements: WebviewAgentElement[] | undefined
): WebviewSelectedElementSnapshot | undefined {
  if (!selection) return undefined;

  const matchedElement = findSelectedElementMatch(selection, elements);
  return {
    tagName: truncateText(selection.tagName, 40).value,
    id: truncateText(selection.id, 120).value,
    className: truncateText(selection.className, 240).value,
    text: truncateText(selection.text, 500).value,
    ...(selection.glyph ? { glyph: truncateText(selection.glyph, 80).value } : {}),
    selector: truncateText(selection.selector, 500).value,
    attributes: selection.attributes.slice(0, 40).map((attribute) => ({
      name: truncateText(attribute.name, 120).value,
      value: truncateText(attribute.value, 500).value
    })),
    ancestors: selection.ancestors.slice(0, 20).map((ancestor) => ({
      tagName: truncateText(ancestor.tagName, 40).value,
      selector: truncateText(ancestor.selector, 500).value
    })),
    computedStyles: Object.fromEntries(Object.entries(selection.computedStyles).map(([key, value]) => [key, truncateText(value, 240).value])),
    rect: normalizeSelectedElementRect(selection.rect),
    ...(matchedElement ? { matchedIndex: matchedElement.index, matchedLabel: matchedElement.label, matchedActions: matchedElement.actions } : {})
  };
}

/**
 * 规范化可交互元素。
 * @param elements - 页面脚本返回的元素列表
 * @returns 裁剪后的元素列表
 */
function normalizeAgentElements(elements: WebviewAgentElement[] | undefined): WebviewAgentElement[] {
  return (elements ?? []).slice(0, WEBVIEW_PAGE_ELEMENT_LIMIT).map((element) => ({
    index: element.index,
    tagName: element.tagName,
    ...(element.role ? { role: truncateText(element.role, 80).value } : {}),
    text: truncateText(element.text, 300).value,
    label: truncateText(element.label, 300).value,
    ...(element.roleHint ? { roleHint: truncateText(element.roleHint, 80).value } : {}),
    ...(element.fingerprint ? { fingerprint: truncateText(element.fingerprint, 500).value } : {}),
    ...(element.placeholder ? { placeholder: truncateText(element.placeholder, 300).value } : {}),
    ...(element.href ? { href: element.href } : {}),
    ...(element.valuePreview ? { valuePreview: truncateText(element.valuePreview, 300).value } : {}),
    disabled: element.disabled,
    ...(typeof element.checked === 'boolean' ? { checked: element.checked } : {}),
    ...(typeof element.selected === 'boolean' ? { selected: element.selected } : {}),
    isNew: element.isNew,
    ...(element.rect ? { rect: normalizeViewportRect(element.rect) } : {}),
    ...(typeof element.visibleRatio === 'number' ? { visibleRatio: Math.max(0, Math.min(1, Number(element.visibleRatio.toFixed(3)))) } : {}),
    ...(typeof element.covered === 'boolean' ? { covered: element.covered } : {}),
    ...(element.layer ? { layer: element.layer } : {}),
    ...(typeof element.primary === 'boolean' ? { primary: element.primary } : {}),
    ...(typeof element.clickableScore === 'number' ? { clickableScore: Math.max(0, Math.min(1, Number(element.clickableScore.toFixed(3)))) } : {}),
    ...(element.reasons ? { reasons: element.reasons.map((reason) => truncateText(reason, 80).value).slice(0, 12) } : {}),
    ...(element.semanticPath ? { semanticPath: element.semanticPath.map((item) => truncateText(item, 120).value).slice(0, 6) } : {}),
    ...(element.hitTarget
      ? {
          hitTarget: {
            tagName: truncateText(element.hitTarget.tagName, 40).value,
            label: truncateText(element.hitTarget.label, 300).value,
            insideTarget: element.hitTarget.insideTarget
          }
        }
      : {}),
    actions: element.actions.filter((action) => action === 'click' || action === 'input' || action === 'select' || action === 'press' || action === 'scroll')
  }));
}

/**
 * 提取当前快照可用于后续操作校验的元素身份信息。
 * @param elements - 快照元素列表
 * @returns 元素身份信息
 */
export function createActiveSnapshotElements(elements: WebviewAgentElement[] | undefined): ActiveWebviewSnapshotElement[] {
  return (elements ?? []).map((element) => ({
    index: element.index,
    tagName: element.tagName,
    label: element.label,
    ...(element.fingerprint ? { fingerprint: element.fingerprint } : {})
  }));
}

/**
 * 创建给模型优先阅读的 BrowserState 风格摘要。
 * @param snapshot - 已规范化的页面快照字段
 * @returns BrowserState 风格摘要文本
 */
function createWebviewPageSummary(snapshot: { url: string; title: string; header: string; content: string; footer: string }): string {
  const title = snapshot.title || 'Untitled Page';
  const currentPage = snapshot.url ? `Current Page: [${title}](${snapshot.url})` : `Current Page: ${title}`;
  return [
    currentPage,
    snapshot.header,
    '',
    'Interactive elements from top layer of the current page:',
    snapshot.content || '<EMPTY>',
    '',
    snapshot.footer,
    '',
    'Rules:',
    '- Use [N] as the element handle for operate_webpage.',
    '- Do not use navigate for page-visible links or text; use [N] with click.',
    '- Treat [N] as a handle from the latest snapshotId, not as a stable position across reads.',
    '- If the footer says more content exists above or below, use operate_webpage scroll and read again.'
  ]
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n');
}

/**
 * 创建返回给 AI 的页面快照，剥离仅供内部校验使用的元素指纹。
 * @param snapshot - renderer 内部页面快照
 * @returns 对外网页快照
 */
export function createPublicWebviewPageSnapshot(snapshot: WebviewPageSnapshot): WebviewPageSnapshot {
  const elements = snapshot.elements?.map((element) => {
    const publicElement: WebviewAgentElement = { ...element };
    delete publicElement.fingerprint;
    return publicElement;
  });

  return { ...snapshot, ...(elements ? { elements } : {}) };
}

/**
 * 判断值是否为未裁剪的页面快照。
 * @param value - 待判断的值
 * @returns 是否为页面快照
 */
export function isWebviewPageSnapshot(value: unknown): value is RawWebviewPageSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<WebviewPageSnapshot>;
  return (
    typeof snapshot.url === 'string' &&
    typeof snapshot.title === 'string' &&
    (snapshot.summary === undefined || typeof snapshot.summary === 'string') &&
    (snapshot.header === undefined || typeof snapshot.header === 'string') &&
    (snapshot.content === undefined || typeof snapshot.content === 'string') &&
    (snapshot.footer === undefined || typeof snapshot.footer === 'string') &&
    typeof snapshot.text === 'string' &&
    typeof snapshot.selectedText === 'string' &&
    isHeadingArray(snapshot.headings) &&
    isLinkArray(snapshot.links) &&
    (snapshot.viewport === undefined || isViewportSnapshot(snapshot.viewport)) &&
    (snapshot.elements === undefined || isAgentElementArray(snapshot.elements))
  );
}

/**
 * 规范化 WebView 页面快照。
 * @param value - 页面脚本返回值
 * @returns 带截断标记的页面快照
 */
export function normalizeWebviewPageSnapshot(value: RawWebviewPageSnapshot): WebviewPageSnapshot {
  const text = truncateText(value.text, WEBVIEW_PAGE_TEXT_LIMIT);
  const content = truncateText(value.content || '', WEBVIEW_PAGE_CONTENT_LIMIT);
  const selectedText = truncateText(value.selectedText, WEBVIEW_PAGE_SELECTED_TEXT_LIMIT);
  const headings = value.headings.slice(0, WEBVIEW_PAGE_HEADING_LIMIT).map((heading) => ({
    level: heading.level,
    text: truncateText(heading.text, 300).value
  }));
  const links = value.links.slice(0, WEBVIEW_PAGE_LINK_LIMIT).map((link) => ({
    text: truncateText(link.text, 300).value,
    href: link.href
  }));
  const truncated: WebviewPageTruncation = {
    text: text.truncated,
    content: content.truncated,
    headings: value.headings.length > WEBVIEW_PAGE_HEADING_LIMIT,
    links: value.links.length > WEBVIEW_PAGE_LINK_LIMIT,
    selectedText: selectedText.truncated
  };

  const baseSnapshot = {
    url: value.url,
    title: value.title,
    header: value.header || '',
    content: content.value,
    footer: value.footer || ''
  };

  return {
    ...baseSnapshot,
    summary: value.summary || createWebviewPageSummary(baseSnapshot),
    text: text.value,
    selectedText: selectedText.value,
    headings,
    links,
    capturedAt: Date.now(),
    truncated,
    ...(value.snapshotId ? { snapshotId: value.snapshotId } : {}),
    ...(typeof value.loading === 'boolean' ? { loading: value.loading } : {}),
    ...(value.scroll ? { scroll: value.scroll } : {}),
    ...(value.viewport ? { viewport: normalizeViewportSnapshot(value.viewport) } : {}),
    elements: normalizeAgentElements(value.elements)
  };
}

/**
 * 为页面读取 Promise 添加超时保护。
 * @param promise - 页面读取 Promise
 * @returns 带超时保护的 Promise
 */
export function withWebviewPageReadTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer: ReturnType<typeof globalThis.setTimeout> = globalThis.setTimeout(() => reject(new Error('页面读取超时')), WEBVIEW_PAGE_SNAPSHOT_TIMEOUT_MS);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => globalThis.clearTimeout(timer));
  });
}

/**
 * 为页面操作 Promise 添加超时保护。
 * @param promise - 页面操作 Promise
 * @returns 带超时保护的 Promise
 */
export function withWebviewPageOperationTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer: ReturnType<typeof globalThis.setTimeout> = globalThis.setTimeout(
      () => reject(createWebviewOperationError('BRIDGE_TIMEOUT')),
      WEBVIEW_PAGE_OPERATION_TIMEOUT_MS
    );
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => globalThis.clearTimeout(timer));
  });
}

/**
 * 判断值是否为 WebView 滚动坐标。
 * @param value - 待判断值
 * @returns 是否为滚动坐标
 */
function isWebviewOperateScrollPosition(value: unknown): value is WebviewOperateScrollResult['before'] {
  if (!value || typeof value !== 'object') return false;

  const position = value as Partial<WebviewOperateScrollResult['before']>;
  return typeof position.x === 'number' && typeof position.y === 'number';
}

/**
 * 判断值是否为 WebView 滚动操作结果。
 * @param value - 待判断值
 * @returns 是否为滚动操作结果
 */
function isWebviewOperateScrollResult(value: unknown): value is WebviewOperateScrollResult {
  if (!value || typeof value !== 'object') return false;

  const scroll = value as Partial<WebviewOperateScrollResult>;
  return (
    (scroll.targetType === 'window' || scroll.targetType === 'element') &&
    isWebviewOperateScrollPosition(scroll.before) &&
    isWebviewOperateScrollPosition(scroll.after) &&
    typeof scroll.changed === 'boolean'
  );
}

/**
 * 判断值是否为 WebView 操作结果。
 * @param value - 待判断值
 * @returns 是否为 WebView 操作结果
 */
export function isWebviewOperateResult(value: unknown): value is WebviewOperateResult {
  if (!value || typeof value !== 'object') return false;

  const result = value as Partial<WebviewOperateResult>;
  return (
    typeof result.ok === 'boolean' &&
    typeof result.action === 'string' &&
    (result.target === null || (typeof result.target === 'object' && result.target !== null)) &&
    typeof result.message === 'string' &&
    (result.scroll === undefined || isWebviewOperateScrollResult(result.scroll)) &&
    typeof result.navigationStarted === 'boolean' &&
    typeof result.pageChanged === 'boolean' &&
    typeof result.shouldReadAgain === 'boolean'
  );
}

/**
 * 归一化页面读取错误，避免把底层安全策略错误直接暴露给模型。
 * @param error - 原始错误
 * @returns 归一化后的错误
 */
export function normalizeWebviewPageReadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error || '读取当前网页失败');
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes('content security policy') ||
    lowerMessage.includes('script-src') ||
    lowerMessage.includes('refused to execute') ||
    lowerMessage.includes('csp')
  ) {
    return new Error('页面安全策略阻止读取当前网页内容');
  }

  return error instanceof Error ? error : new Error(message);
}

/**
 * 归一化 WebView 操作错误，确保 ChatRuntime bridge 能透传稳定错误码。
 * @param error - 原始错误
 * @returns 带稳定错误码的操作错误
 */
export function normalizeWebviewPageOperationError(error: unknown): WebviewOperationError {
  if (error instanceof Error && 'code' in error && isWebviewOperationErrorCode((error as { code?: unknown }).code)) {
    return error as WebviewOperationError;
  }

  const message = error instanceof Error ? error.message : String(error || WEBVIEW_OPERATION_ERROR_MESSAGES.EXECUTION_FAILED);
  const code = readWebviewOperationErrorCodeFromMessage(message) ?? 'EXECUTION_FAILED';
  return createWebviewOperationError(code, code === 'EXECUTION_FAILED' ? message : undefined);
}
