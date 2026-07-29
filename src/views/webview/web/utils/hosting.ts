/**
 * @file hosting.ts
 * @description 管理 `<webview>` 标签页宿主层与 DOM 节点。
 */
import type { WebviewTag } from 'electron';

/**
 * 宿主层节点 ID。
 */
export const WEBVIEW_HOST_LAYER_ID = 'tibis-webview-host-layer';

/**
 * 宿主层 ID 中保留的路由可读片段最大长度。
 */
const WEBVIEW_HOST_LAYER_SLUG_LIMIT = 24;

/**
 * WebView 统一圆角半径。
 */
export const WEBVIEW_BORDER_RADIUS_PX = 8;

/**
 * WebView 宿主层裁剪边距。
 */
export interface WebviewHostClipInsets {
  /** 顶部裁剪 */
  top: number;
  /** 右侧裁剪 */
  right: number;
  /** 底部裁剪 */
  bottom: number;
  /** 左侧裁剪 */
  left: number;
}

/**
 * WebView 宿主层显示范围。
 */
export interface WebviewHostBounds {
  /** 左上角 x 坐标 */
  x: number;
  /** 左上角 y 坐标 */
  y: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /** 可选裁剪范围 */
  clip?: WebviewHostClipInsets;
}

/**
 * 创建宿主层 ID 中便于调试的路由片段。
 * @param hostKey - 标签页隔离 key
 * @returns 可放入 DOM id 的短路由片段
 */
function createWebviewHostLayerSlug(hostKey: string): string {
  const routePath = hostKey.split('?')[0] || 'webview';
  const normalized = routePath
    .replace(/^\/+/, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return (normalized || 'webview').slice(0, WEBVIEW_HOST_LAYER_SLUG_LIMIT).replace(/-+$/g, '') || 'webview';
}

/**
 * 创建宿主层 ID 中用于区分完整 hostKey 的稳定哈希。
 * @param hostKey - 标签页隔离 key
 * @returns base36 短哈希
 */
function createWebviewHostLayerHash(hostKey: string): string {
  let hash = 0;
  for (let index = 0; index < hostKey.length; index += 1) {
    hash = Math.imul(hash, 31) + hostKey.charCodeAt(index);
  }

  return (hash >>> 0).toString(36);
}

/**
 * 解析指定标签页对应的宿主层 ID。
 * @param hostKey - 标签页隔离 key，不传时使用默认宿主层 ID
 * @returns 宿主层 DOM id
 */
function resolveWebviewHostLayerId(hostKey?: string): string {
  if (!hostKey) {
    return WEBVIEW_HOST_LAYER_ID;
  }

  const slug = createWebviewHostLayerSlug(hostKey);
  const hash = createWebviewHostLayerHash(hostKey);
  return `${WEBVIEW_HOST_LAYER_ID}-${slug}-${hash}`;
}

/**
 * 同步宿主层基础布局样式。
 * @param hostLayer - 标签页宿主层
 */
function applyWebviewHostLayerStyle(hostLayer: HTMLElement): void {
  hostLayer.style.position = 'fixed';
  hostLayer.style.left = '0';
  hostLayer.style.top = '0';
  hostLayer.style.width = hostLayer.style.width || '0';
  hostLayer.style.height = hostLayer.style.height || '0';
  hostLayer.style.flexDirection = 'column';
  hostLayer.style.alignItems = 'stretch';
  hostLayer.style.overflow = 'hidden';
  hostLayer.style.pointerEvents = hostLayer.style.pointerEvents || 'none';
  hostLayer.style.clipPath = hostLayer.style.clipPath || '';
  hostLayer.style.borderRadius = `${WEBVIEW_BORDER_RADIUS_PX}px`;
}

/**
 * 配置真实 `<webview>` 的基础属性与布局样式。
 * @param webviewElement - 真实 `<webview>` 节点
 */
function configureHostedWebviewElement(webviewElement: HTMLElement): void {
  webviewElement.setAttribute('allowpopups', '');
  webviewElement.style.display = 'flex';
  webviewElement.style.flex = '1 1 auto';
  webviewElement.style.width = '100%';
  webviewElement.style.height = '100%';
  webviewElement.style.minWidth = '0';
  webviewElement.style.minHeight = '0';
  webviewElement.style.border = '0';
  webviewElement.style.borderRadius = `${WEBVIEW_BORDER_RADIUS_PX}px`;
}

/**
 * 隐藏宿主层但不销毁内部 `<webview>`。
 * @param hostLayer - 标签页宿主层
 */
export function hideWebviewHostLayer(hostLayer: HTMLElement): void {
  hostLayer.style.display = 'none';
  hostLayer.style.pointerEvents = 'none';
}

/**
 * 隐藏同文档下其它 WebView 宿主层，避免多个标签页内容互相遮挡。
 * @param activeHostLayer - 当前需要显示的宿主层
 */
function hideInactiveWebviewHostLayers(activeHostLayer: HTMLElement): void {
  const hostLayers = activeHostLayer.ownerDocument.querySelectorAll<HTMLElement>(`[id^="${WEBVIEW_HOST_LAYER_ID}"]`);

  hostLayers.forEach((hostLayer) => {
    if (hostLayer === activeHostLayer) {
      return;
    }

    hideWebviewHostLayer(hostLayer);
  });
}

/**
 * 确保文档中存在指定标签页的 `<webview>` 宿主层。
 * @param doc - 目标文档对象
 * @param hostKey - 标签页隔离 key
 * @returns 宿主层元素
 */
export function ensureWebviewHostLayer(doc: Document, hostKey?: string): HTMLDivElement {
  const hostLayerId = resolveWebviewHostLayerId(hostKey);
  const existing = doc.getElementById(hostLayerId);
  if (existing instanceof HTMLDivElement) {
    applyWebviewHostLayerStyle(existing);
    return existing;
  }

  const hostLayer = doc.createElement('div');
  hostLayer.id = hostLayerId;
  hostLayer.style.display = 'none';
  applyWebviewHostLayerStyle(hostLayer);
  doc.body.appendChild(hostLayer);
  return hostLayer;
}

/**
 * 确保宿主层里存在当前标签页专属的 `<webview>` 节点。
 * @param hostLayer - 标签页宿主层
 * @returns `<webview>` 元素
 */
export function ensureHostedWebviewElement(hostLayer: HTMLElement): WebviewTag {
  const existing = hostLayer.querySelector('webview');
  if (existing instanceof HTMLElement) {
    configureHostedWebviewElement(existing);
    return existing as WebviewTag;
  }

  const webviewElement = document.createElement('webview') as WebviewTag;
  webviewElement.className = 'webview-content__element';
  configureHostedWebviewElement(webviewElement);
  hostLayer.appendChild(webviewElement);
  return webviewElement;
}

/**
 * 显示宿主层并同步位置尺寸。
 * @param hostLayer - 标签页宿主层
 * @param bounds - 目标位置和尺寸
 */
export function showWebviewHostLayer(hostLayer: HTMLElement, bounds: WebviewHostBounds): void {
  hideInactiveWebviewHostLayers(hostLayer);
  hostLayer.style.display = 'flex';
  hostLayer.style.pointerEvents = 'auto';
  hostLayer.style.left = `${Math.round(bounds.x)}px`;
  hostLayer.style.top = `${Math.round(bounds.y)}px`;
  hostLayer.style.width = `${Math.round(bounds.width)}px`;
  hostLayer.style.height = `${Math.round(bounds.height)}px`;
  hostLayer.style.background = '#fff';

  const { clip } = bounds;
  if (clip && (clip.top || clip.right || clip.bottom || clip.left)) {
    hostLayer.style.clipPath = `inset(${Math.round(clip.top)}px ${Math.round(clip.right)}px ${Math.round(clip.bottom)}px ${Math.round(clip.left)}px)`;
  } else {
    hostLayer.style.clipPath = 'none';
  }
}
