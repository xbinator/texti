/**
 * @file elementPicker.ts
 * @description 构建 WebView 页面元素选择器脚本并解析元素选择器宿主消息。
 */
import { TIBIS_WEBVIEW_HOST_CHANNEL } from '@@/shared/webview/host-bridge';
import type { WebviewElementSelection, WebviewElementToolbarActionType } from '@/views/webview/shared/types';

/**
 * WebView 页面元素选择器主题。
 */
export interface WebviewElementPickerTheme {
  /** 高亮边框色 */
  color: string;
  /** 高亮背景色 */
  background: string;
  /** 高亮描边色 */
  border?: string;
  /** 工具条文字色 */
  toolbarText?: string;
  /** 工具条背景色 */
  toolbarBackground?: string;
  /** 工具条按钮悬停文字色 */
  toolbarHoverText?: string;
  /** 工具条阴影 */
  toolbarShadow?: string;
  /** 高亮边框宽度 */
  borderWidth?: string;
  /** 选区面层圆角 */
  surfaceRadius?: string;
  /** 工具条控件圆角 */
  controlRadius?: string;
}

/**
 * 默认 WebView 页面元素选择器主题。
 */
export const DEFAULT_ELEMENT_PICKER_THEME: WebviewElementPickerTheme = {
  color: '#2563eb',
  background: 'rgba(37,99,235,.12)'
};

/**
 * WebView ipc-message 事件的最小消息结构。
 */
export interface WebviewIpcMessageEvent {
  /** WebView preload 发送的通道。 */
  channel: string;
  /** WebView preload 发送的参数列表。 */
  args: unknown[];
}

/**
 * WebView 页面上报的元素选择消息。
 */
export interface WebviewElementSelectionHostMessage {
  /** 页面脚本生成的消息 ID，用于多通道去重。 */
  messageId?: string;
  /** 消息类型。 */
  kind: 'element-picker-selection';
  /** 选中元素。 */
  selection: unknown;
}

/**
 * WebView 页面上报的元素工具条动作消息。
 */
export interface WebviewElementActionHostMessage {
  /** 页面脚本生成的消息 ID，用于多通道去重。 */
  messageId?: string;
  /** 消息类型。 */
  kind: 'element-picker-action';
  /** 动作类型。 */
  actionType: unknown;
}

/**
 * WebView 页面上报给宿主的元素选择器消息。
 */
export type WebviewElementHostMessage = WebviewElementSelectionHostMessage | WebviewElementActionHostMessage;

/**
 * 页面元素选择脚本需要读取的精选计算样式。
 */
const ELEMENT_PICKER_STYLE_PROPERTIES = [
  'display',
  'position',
  'box-sizing',
  'opacity',
  'width',
  'height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'color',
  'background',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-color',
  'border-radius',
  'z-index',
  'overflow',
  'transform'
];

/**
 * 私有字区通常被 iconfont 用作图标编码，不应作为可读文本展示。
 */
const PRIVATE_USE_ICON_GLYPH_PATTERN = /[\uE000-\uF8FF]/g;

/**
 * 判断事件是否包含 WebView preload 转发的宿主消息。
 * @param event - 待判断的事件对象
 * @returns 是否包含可解析的宿主消息
 */
export function isWebviewIpcMessageEvent(event: Event | WebviewIpcMessageEvent): event is WebviewIpcMessageEvent {
  return 'channel' in event && event.channel === TIBIS_WEBVIEW_HOST_CHANNEL && 'args' in event && Array.isArray(event.args);
}

/**
 * 判断值是否为元素工具条动作类型。
 * @param value - 待判断的值
 * @returns 是否为已支持的工具条动作类型
 */
export function isWebviewElementToolbarActionType(value: unknown): value is WebviewElementToolbarActionType {
  return value === 'capture-selected-element-screenshot';
}

/**
 * 判断值是否为 WebView 元素选择器宿主消息。
 * @param value - 待判断的值
 * @returns 是否为 WebView 元素选择器宿主消息
 */
export function isWebviewElementHostMessage(value: unknown): value is WebviewElementHostMessage {
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    return false;
  }

  const { kind } = value as { kind?: unknown };
  return kind === 'element-picker-selection' || kind === 'element-picker-action';
}

/**
 * 构建注入到页面内的 DOM 元素选择脚本。
 * @param theme - 元素选择器主题
 * @returns 可通过 `executeJavaScript` 执行的脚本
 */
export function createElementSelectionScript(theme: WebviewElementPickerTheme = DEFAULT_ELEMENT_PICKER_THEME): string {
  const pickerColor = theme.color || DEFAULT_ELEMENT_PICKER_THEME.color;
  const pickerBackground = theme.background || DEFAULT_ELEMENT_PICKER_THEME.background;
  const pickerBorder = theme.border || pickerColor;
  const toolbarText = theme.toolbarText || '#fff';
  const toolbarBackground = theme.toolbarBackground || pickerColor;
  const toolbarHoverText = theme.toolbarHoverText || 'rgba(255,255,255,.72)';
  const toolbarShadow = theme.toolbarShadow || 'none';
  const pickerBorderWidth = theme.borderWidth || '2px';
  const surfaceRadius = theme.surfaceRadius || '4px';
  const controlRadius = theme.controlRadius || '3px';
  const borderStyle = JSON.stringify(`border:${pickerBorderWidth} solid ${pickerBorder};`);
  const backgroundStyle = JSON.stringify(`background:${pickerBackground};`);
  const surfaceRadiusStyle = JSON.stringify(`border-radius:${surfaceRadius};`);
  const controlRadiusStyle = JSON.stringify(`border-radius:${controlRadius};`);
  const toolbarTextStyle = JSON.stringify(`color:${toolbarText};`);
  const toolbarBackgroundStyle = JSON.stringify(`background:${toolbarBackground};`);
  const toolbarHoverTextStyle = JSON.stringify(`color:${toolbarHoverText};`);
  const toolbarShadowStyle = JSON.stringify(`box-shadow:${toolbarShadow};`);
  const hostMessageChannel = JSON.stringify(TIBIS_WEBVIEW_HOST_CHANNEL);
  const styleProperties = JSON.stringify(ELEMENT_PICKER_STYLE_PROPERTIES);

  return `
(() => new Promise((resolve) => {
  const existingCleanup = window.__tibisElementPickerCleanup;
  if (typeof existingCleanup === 'function') {
    existingCleanup();
  }
  window.__tibisElementPickerHostMessages = [];

  const style = document.createElement('style');
  style.textContent = [
    '.tibis-element-picker-highlight{',
    'position:fixed;',
    'z-index:2147483647;',
    'pointer-events:none;',
    ${borderStyle},
    ${backgroundStyle},
    'box-sizing:border-box;',
    ${surfaceRadiusStyle},
    '}',
    '.tibis-element-picker-selected{',
    'position:fixed;',
    'z-index:2147483646;',
    'pointer-events:none;',
    ${borderStyle},
    'background:transparent;',
    'box-sizing:border-box;',
    ${surfaceRadiusStyle},
    '}',
    '.tibis-element-picker-toolbar{',
    'position:absolute;',
    'z-index:2147483647;',
    'display:flex;',
    'gap:2px;',
    'align-items:flex-end;',
    'max-width:calc(100vw - 8px);',
    'font:12px/18px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;',
    ${toolbarTextStyle},
    'box-sizing:border-box;',
    'pointer-events:auto;',
    'animation:tibis-element-picker-toolbar-enter 120ms ease-out;',
    '}',
    '.tibis-element-picker-toolbar[hidden]{',
    'display:none;',
    '}',
    '.tibis-element-picker-toolbar__tag{',
    'display:inline-flex;',
    'flex:0 0 auto;',
    'align-items:center;',
    'height:20px;',
    'max-width:120px;',
    'padding:0 8px;',
    'overflow:hidden;',
    'box-sizing:border-box;',
    'font-size:12px;',
    'font-weight:500;',
    'line-height:20px;',
    'text-overflow:ellipsis;',
    'text-transform:lowercase;',
    'white-space:nowrap;',
    ${toolbarBackgroundStyle},
    ${toolbarShadowStyle},
    ${controlRadiusStyle},
    '}',
    '.tibis-element-picker-toolbar__actions{',
    'display:flex;',
    'flex:0 0 auto;',
    'height:20px;',
    'gap:1px;',
    'align-items:center;',
    'padding:0 1px;',
    'box-sizing:border-box;',
    ${toolbarBackgroundStyle},
    ${toolbarShadowStyle},
    ${controlRadiusStyle},
    '}',
    '.tibis-element-picker-toolbar__action{',
    'display:inline-flex;',
    'align-items:center;',
    'justify-content:center;',
    'width:20px;',
    'min-width:20px;',
    'height:18px;',
    'padding:0;',
    'font:inherit;',
    'font-size:12px;',
    'font-weight:500;',
    'line-height:1;',
    'color:inherit;',
    'box-sizing:border-box;',
    'cursor:pointer;',
    'background:transparent;',
    'border:0;',
    ${controlRadiusStyle},
    'transition:color 120ms ease,transform 120ms ease;',
    '}',
    '.tibis-element-picker-toolbar__action:active{',
    'transform:scale(.92);',
    '}',
    '.tibis-element-picker-toolbar__action-icon{',
    'display:block;',
    'width:14px;',
    'height:14px;',
    'font-size:14px;',
    'stroke:currentColor;',
    'stroke-width:2;',
    'fill:none;',
    'stroke-linecap:round;',
    'stroke-linejoin:round;',
    '}',
    '.tibis-element-picker-toolbar__action:hover{',
    ${toolbarHoverTextStyle},
    '}',
    '.tibis-element-picker-toolbar__action:focus-visible{',
    'outline:2px solid currentColor;',
    'outline-offset:1px;',
    '}',
    '.tibis-element-picker-toolbar__action-label{',
    'position:absolute;',
    'width:1px;',
    'height:1px;',
    'padding:0;',
    'margin:-1px;',
    'overflow:hidden;',
    'clip:rect(0,0,0,0);',
    'white-space:nowrap;',
    'border:0;',
    '}',
    '@keyframes tibis-element-picker-toolbar-enter{',
    'from{',
    'opacity:0;',
    'transform:translateY(2px);',
    '}',
    'to{',
    'opacity:1;',
    'transform:translateY(0);',
    '}',
    '}'
  ].join('');
  document.documentElement.appendChild(style);

  const highlight = document.createElement('div');
  highlight.className = 'tibis-element-picker-highlight';
  highlight.hidden = true;
  document.documentElement.appendChild(highlight);

  const selectedHighlight = document.createElement('div');
  selectedHighlight.className = 'tibis-element-picker-selected';
  selectedHighlight.hidden = true;
  document.documentElement.appendChild(selectedHighlight);

  const selectedToolbar = document.createElement('div');
  selectedToolbar.className = 'tibis-element-picker-toolbar';
  selectedToolbar.hidden = true;
  document.documentElement.appendChild(selectedToolbar);

  const toolbarActions = [
    {
      type: 'capture-selected-element-screenshot',
      label: '截图',
      title: '截取选中元素',
      icon: 'screenshot'
    }
  ];

  let activeHoverElement = null;
  let activeSelectedElement = null;
  let hostMessageId = 0;

  const escapeCss = (value) => {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
  };

  const buildClassSelector = (element) => {
    const classes = Array.from(element.classList).slice(0, 3).map((className) => '.' + escapeCss(className)).join('');
    return element.tagName.toLowerCase() + classes;
  };

  const buildSimpleSelector = (element) => {
    if (element.id) {
      return element.tagName.toLowerCase() + '#' + escapeCss(element.id);
    }

    return buildClassSelector(element);
  };

  const buildSelectorSegment = (element) => {
    const simpleSelector = buildSimpleSelector(element);
    if (!element.parentElement) {
      return simpleSelector;
    }

    const sameTagSiblings = Array.from(element.parentElement.children).filter((child) => child.tagName === element.tagName);
    const siblingIndex = sameTagSiblings.indexOf(element) + 1;
    if (element.id) {
      const sameSimpleSiblings = Array.from(element.parentElement.children).filter((child) => child.matches(simpleSelector));
      if (sameSimpleSiblings.length <= 1) {
        return simpleSelector;
      }

      return buildClassSelector(element) + ':nth-of-type(' + siblingIndex + ')';
    }

    return simpleSelector + ':nth-of-type(' + siblingIndex + ')';
  };

  const buildSelector = (element) => {
    const segments = [];
    let current = element;

    while (current && current instanceof Element) {
      segments.unshift(buildSelectorSegment(current));
      const candidate = segments.join(' > ');

      try {
        if (document.querySelectorAll(candidate).length === 1) {
          return candidate;
        }
      } catch {
        return buildSimpleSelector(element);
      }

      if (current === document.documentElement) {
        return candidate;
      }

      current = current.parentElement;
    }

    return buildSimpleSelector(element);
  };

  const cleanup = () => {
    document.removeEventListener('mousemove', handleMouseMove, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeydown, true);
    selectedToolbar.removeEventListener('click', handleToolbarClick);
    window.removeEventListener('scroll', handleScrollOrResize, true);
    window.removeEventListener('resize', handleScrollOrResize, true);
    highlight.remove();
    selectedHighlight.remove();
    selectedToolbar.remove();
    style.remove();
    delete window.__tibisElementPickerCleanup;
  };

  const readAttributes = (element) => Array.from(element.attributes).map((attribute) => ({
    name: attribute.name,
    value: attribute.value
  }));

  const readAncestors = (element) => {
    const ancestors = [];
    let current = element.parentElement;
    while (current) {
      ancestors.unshift({
        tagName: current.tagName,
        selector: buildSelector(current)
      });
      current = current.parentElement;
    }
    return ancestors;
  };

  const readComputedStyles = (element) => {
    const styles = window.getComputedStyle(element);
    return ${styleProperties}.reduce((result, propertyName) => {
      result[propertyName] = styles.getPropertyValue(propertyName);
      return result;
    }, {});
  };

  const readRawText = (element) => String(element.innerText || element.textContent || '');

  const normalizeReadableText = (value) => String(value || '').replace(/[\\uE000-\\uF8FF]/g, '').replace(/\\s+/g, ' ').trim();

  const readElementGlyph = (element) => {
    const glyphs = readRawText(element).match(/[\\uE000-\\uF8FF]/g);
    return glyphs ? glyphs.join('') : '';
  };

  const readElementLabel = (element) => {
    const directLabel = normalizeReadableText(
      element.getAttribute('aria-label') ||
      element.getAttribute('title') ||
      element.getAttribute('alt') ||
      element.getAttribute('value')
    );
    if (directLabel) {
      return directLabel;
    }

    const labeledAncestor = element.closest('[aria-label],[title],button,a,[role="button"],[role="link"]');
    if (labeledAncestor && labeledAncestor !== element) {
      return normalizeReadableText(
        labeledAncestor.getAttribute('aria-label') ||
        labeledAncestor.getAttribute('title') ||
        labeledAncestor.innerText ||
        labeledAncestor.textContent
      );
    }

    return '';
  };

  const readElementText = (element) => {
    const visibleText = normalizeReadableText(element.innerText || element.textContent);
    if (visibleText) {
      return visibleText.slice(0, 200);
    }

    return readElementLabel(element).slice(0, 200);
  };

  const readElement = (element) => {
    const rect = element.getBoundingClientRect();
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
    const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    return {
      tagName: element.tagName,
      id: element.id || '',
      className: element.className || '',
      text: readElementText(element),
      glyph: readElementGlyph(element),
      selector: buildSelector(element),
      attributes: readAttributes(element),
      ancestors: readAncestors(element),
      computedStyles: readComputedStyles(element),
      rect: {
        x: rect.x,
        y: rect.y,
        pageX: scrollLeft + rect.x,
        pageY: scrollTop + rect.y,
        width: rect.width,
        height: rect.height
      }
    };
  };

  const syncLayerPosition = (layer, element) => {
    if (!element.isConnected) {
      layer.hidden = true;
      return;
    }

    const rect = element.getBoundingClientRect();
    layer.hidden = false;
    layer.style.left = rect.left + 'px';
    layer.style.top = rect.top + 'px';
    layer.style.width = rect.width + 'px';
    layer.style.height = rect.height + 'px';
  };

  function syncHighlight(element) {
    syncLayerPosition(highlight, element);
  }

  function syncSelectedHighlight(element) {
    syncLayerPosition(selectedHighlight, element);
    syncToolbarPosition(element);
  }

  function isPickerLayer(target) {
    return target === highlight || target === selectedHighlight || selectedToolbar.contains(target);
  }

  function renderSelectedToolbar(element) {
    selectedToolbar.replaceChildren();

    const tag = document.createElement('span');
    tag.className = 'tibis-element-picker-toolbar__tag';
    tag.textContent = element.tagName.toLowerCase();
    selectedToolbar.appendChild(tag);

    const actions = document.createElement('div');
    actions.className = 'tibis-element-picker-toolbar__actions';
    toolbarActions.forEach((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tibis-element-picker-toolbar__action';
      button.dataset.tibisElementPickerAction = action.type;
      button.title = action.title;
      button.setAttribute('aria-label', action.title);

      button.appendChild(createToolbarActionIcon(action.icon));

      const label = document.createElement('span');
      label.className = 'tibis-element-picker-toolbar__action-label';
      label.textContent = action.label;
      button.appendChild(label);
      actions.appendChild(button);
    });
    selectedToolbar.appendChild(actions);
  }

  function createToolbarActionIcon(icon) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'tibis-element-picker-toolbar__action-icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');

    if (icon === 'screenshot') {
      const body = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      body.setAttribute('d', 'M5 8h3l1.5-2h5L16 8h3v9H5z');
      svg.appendChild(body);

      const lens = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      lens.setAttribute('cx', '12');
      lens.setAttribute('cy', '12.5');
      lens.setAttribute('r', '2.5');
      svg.appendChild(lens);
      return svg;
    }

    const fallback = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fallback.setAttribute('cx', '12');
    fallback.setAttribute('cy', '12');
    fallback.setAttribute('r', '4');
    svg.appendChild(fallback);
    return svg;
  }

  function syncToolbarPosition(element) {
    if (!element.isConnected) {
      selectedToolbar.hidden = true;
      return;
    }

    renderSelectedToolbar(element);
    selectedToolbar.hidden = false;

    const rect = element.getBoundingClientRect();
    const toolbarRect = selectedToolbar.getBoundingClientRect();
    const toolbarWidth = toolbarRect.width || selectedToolbar.offsetWidth || 128;
    const toolbarHeight = toolbarRect.height || selectedToolbar.offsetHeight || 20;
    const toolbarGap = 1;
    const scrollLeft = window.scrollX || document.documentElement.scrollLeft || document.body.scrollLeft || 0;
    const scrollTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
    const selectionTop = rect.top + scrollTop;
    const selectionRight = rect.right + scrollLeft;
    const selectionBottom = rect.bottom + scrollTop;
    const preferredTop = selectionTop - toolbarHeight - toolbarGap;
    const top = preferredTop >= 0 ? preferredTop : selectionBottom + toolbarGap;
    const left = selectionRight - toolbarWidth;

    selectedToolbar.style.left = Math.round(left) + 'px';
    selectedToolbar.style.top = Math.round(top) + 'px';
  }

  function emitSelectedElement(element) {
    const selectedElement = readElement(element);
    postHostMessage({ kind: 'element-picker-selection', selection: selectedElement });
    return selectedElement;
  }

  function emitToolbarAction(type) {
    postHostMessage({ kind: 'element-picker-action', actionType: type });
  }

  function createHostMessage(payload) {
    hostMessageId += 1;
    return Object.assign({ messageId: 'element-picker-' + hostMessageId }, payload);
  }

  function queueHostMessage(payload) {
    if (!Array.isArray(window.__tibisElementPickerHostMessages)) {
      window.__tibisElementPickerHostMessages = [];
    }

    window.__tibisElementPickerHostMessages.push(payload);
  }

  function postHostMessage(message) {
    const payload = createHostMessage(message);
    queueHostMessage(payload);

    const bridge = window.__tibisWebviewHost;
    if (!bridge || typeof bridge.postMessage !== 'function') {
      return;
    }

    bridge.postMessage(${hostMessageChannel}, payload);
  }

  function handleToolbarClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest('[data-tibis-element-picker-action]');
    if (!(button instanceof HTMLElement)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    emitToolbarAction(button.dataset.tibisElementPickerAction || '');
  }

  function handleMouseMove(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || isPickerLayer(target)) {
      return;
    }

    activeHoverElement = target;
    syncHighlight(target);
  }

  function handleMouseOut(event) {
    if (event.relatedTarget) {
      return;
    }

    highlight.hidden = true;
    activeHoverElement = null;
  }

  function handleClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || isPickerLayer(target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    activeSelectedElement = target;
    syncSelectedHighlight(target);
    emitSelectedElement(target);
  }

  function handleScrollOrResize() {
    if (activeHoverElement) {
      syncHighlight(activeHoverElement);
    }
    if (activeSelectedElement) {
      syncSelectedHighlight(activeSelectedElement);
    }
  }

  function handleKeydown(event) {
    if (event.key !== 'Escape') {
      return;
    }

    event.preventDefault();
    cleanup();
    resolve(null);
  }

  window.__tibisElementPickerCleanup = () => {
    cleanup();
    resolve(null);
  };
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('mouseout', handleMouseOut, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeydown, true);
  selectedToolbar.addEventListener('click', handleToolbarClick);
  window.addEventListener('scroll', handleScrollOrResize, true);
  window.addEventListener('resize', handleScrollOrResize, true);
}))();
`;
}

/**
 * 构建读取页面内元素选择器消息队列的脚本。
 * @returns 可通过 `executeJavaScript` 执行的脚本
 */
export function createDrainElementSelectionMessagesScript(): string {
  return `
(() => {
  const queue = window.__tibisElementPickerHostMessages;
  if (!Array.isArray(queue) || queue.length === 0) {
    return [];
  }

  return queue.splice(0, queue.length);
})();
`;
}

/**
 * 构建停止 DOM 元素选择模式的页面脚本。
 * @returns 可通过 `executeJavaScript` 执行的脚本
 */
export function createStopElementSelectionScript(): string {
  return `
(() => {
  const cleanup = window.__tibisElementPickerCleanup;
  if (typeof cleanup === 'function') {
    cleanup();
  }
  return null;
})();
`;
}

/**
 * 判断执行脚本返回值是否为元素选择结果。
 * @param value - 待判断的脚本返回值
 * @returns 是否为元素选择结果
 */
export function isElementSelection(value: unknown): value is WebviewElementSelection {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const selection = value as Partial<WebviewElementSelection>;
  return (
    typeof selection.tagName === 'string' &&
    typeof selection.selector === 'string' &&
    Array.isArray(selection.attributes) &&
    Array.isArray(selection.ancestors) &&
    Boolean(selection.computedStyles) &&
    typeof selection.computedStyles === 'object'
  );
}

/**
 * 清理元素可读文本，避免 iconfont 私有字区字符污染 DOM 检查结果。
 * @param value - 页面脚本读取到的原始文本
 * @returns 去除图标字形后的可读文本
 */
function sanitizeElementReadableText(value: string): string {
  return value.replace(PRIVATE_USE_ICON_GLYPH_PATTERN, '').replace(/\s+/g, ' ').trim();
}

/**
 * 提取元素中的 iconfont 私有字区字符。
 * @param value - 页面脚本读取到的原始文本
 * @returns 私有字区字符拼接结果
 */
function extractElementGlyph(value: string): string {
  return Array.from(value.matchAll(PRIVATE_USE_ICON_GLYPH_PATTERN))
    .map((match) => match[0])
    .join('');
}

/**
 * 规范化元素选择结果。
 * @param selection - 页面脚本或 WebView 宿主消息回传的元素选择结果
 * @returns 规范化后的元素选择结果
 */
export function normalizeElementSelection(selection: WebviewElementSelection): WebviewElementSelection {
  const glyph = selection.glyph || extractElementGlyph(selection.text);
  return {
    ...selection,
    glyph: glyph || undefined,
    text: sanitizeElementReadableText(selection.text)
  };
}
