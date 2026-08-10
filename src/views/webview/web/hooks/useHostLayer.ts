/**
 * @file useHostLayer.ts
 * @description 管理 `<webview>` 宿主层与占位容器的位置/尺寸同步，封装 RAF 调度与生命周期绑定。
 */
import type { WebviewTag } from 'electron';
import { onActivated, onDeactivated, onMounted, onUnmounted, type Ref } from 'vue';
import { useEventListener, useResizeObserver } from '@vueuse/core';
import { ensureWebviewHostLayer, hideWebviewHostLayer, showWebviewHostLayer } from '../utils/hosting';
import { resolveVisibleWebviewBounds } from '../utils/viewportBounds';

/** WebView 宿主层同步控制器。 */
export interface HostLayerController {
  /** 立即同步宿主层范围。 */
  syncHostLayerBounds: () => void;
  /** 请求下一帧同步宿主层范围。 */
  requestSyncHostLayerBounds: () => void;
  /** 取消待执行同步帧。 */
  cancelSync: () => void;
}

/**
 * 创建宿主层同步控制器，将占位容器的可见区域映射到 body 上的宿主层。
 * @param routeFullPath - 路由完整路径，用于区分不同标签页的宿主层
 * @param webviewContainerRef - 占位视口容器引用
 * @param webviewContentRef - 外层滚动容器引用
 * @param webviewElementRef - `<webview>` 元素引用
 * @returns 同步方法与取消方法
 */
export function useHostLayer(
  routeFullPath: string,
  webviewContainerRef: Ref<HTMLElement | null>,
  webviewContentRef: Ref<HTMLElement | null>,
  webviewElementRef: Ref<WebviewTag | null>
): HostLayerController {
  let frame: number | null = null;

  /**
   * 根据占位容器同步宿主层位置和尺寸。
   */
  function syncHostLayerBounds(): void {
    frame = null;
    const container = webviewContainerRef.value;
    const scrollFrame = webviewContentRef.value;
    const hostLayer = ensureWebviewHostLayer(document, routeFullPath);

    if (!container || !scrollFrame) {
      hideWebviewHostLayer(hostLayer);
      return;
    }

    const visibleBounds = resolveVisibleWebviewBounds(container.getBoundingClientRect(), scrollFrame.getBoundingClientRect());

    if (!visibleBounds) {
      hideWebviewHostLayer(hostLayer);
      return;
    }

    const { x, y, offsetX, offsetY, width, height, contentWidth, contentHeight } = visibleBounds;

    showWebviewHostLayer(hostLayer, {
      x: x - offsetX,
      y: y - offsetY,
      width: contentWidth,
      height: contentHeight,
      clip: {
        top: offsetY,
        right: contentWidth - offsetX - width,
        bottom: contentHeight - offsetY - height,
        left: offsetX
      }
    });

    const el = webviewElementRef.value;
    if (el) {
      el.style.width = `${Math.round(contentWidth)}px`;
      el.style.height = `${Math.round(contentHeight)}px`;
      el.style.transform = 'translate(0px, 0px)';
    }
  }

  /**
   * 请求在下一帧同步宿主层范围，合并连续 resize 与滚动触发。
   */
  function requestSyncHostLayerBounds(): void {
    if (frame !== null) {
      cancelAnimationFrame(frame);
    }
    frame = requestAnimationFrame(syncHostLayerBounds);
  }

  /**
   * 取消待执行的同步帧。
   */
  function cancelSync(): void {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  }

  /** 停用宿主层并取消尚未执行的同步帧。 */
  function deactivateHostLayer(): void {
    cancelSync();
    hideWebviewHostLayer(ensureWebviewHostLayer(document, routeFullPath));
  }

  onMounted(requestSyncHostLayerBounds);
  onActivated(requestSyncHostLayerBounds);
  onDeactivated(deactivateHostLayer);
  onUnmounted(cancelSync);

  useResizeObserver(webviewContainerRef, requestSyncHostLayerBounds);
  useResizeObserver(webviewContentRef, requestSyncHostLayerBounds);
  useEventListener(window, 'resize', requestSyncHostLayerBounds);

  return { syncHostLayerBounds, requestSyncHostLayerBounds, cancelSync };
}
