/**
 * @file useScreenshot.ts
 * @description 封装 WebView 视图截图与完整页面长截屏能力。
 */
import type { WebviewTag } from 'electron';
import type { WebViewProtocolScreenshotClip } from 'types/webview';
import { getCurrentInstance, nextTick, onBeforeUnmount, ref, type Ref } from 'vue';
import { message } from 'ant-design-vue';
import { native } from '@/shared/platform';
import type { WebviewElementSelection, WebviewPageState } from '@/views/webview/shared/types';
import { buildElementCaptureSegments, drawElementCaptureSegment } from '@/views/webview/web/utils/elementCapture';
import {
  buildFixedElementOverlayCaptures,
  buildPageCaptureSlices,
  createElementCaptureCleanupScript,
  createElementCaptureMetricsScript,
  createElementCaptureObstructionVisibilityScript,
  createElementCaptureRectScript,
  createElementCaptureScrollScript,
  createElementPickerLayerVisibilityScript,
  createFixedElementCaptureCleanupScript,
  createFixedElementCaptureSetupScript,
  createFixedElementVisibilityScript,
  createPageCaptureMetricsScript,
  createPageScrollScript,
  createPngBlob,
  createVisiblePositionedElementSnapshotScript,
  isWebviewElementCaptureMetrics,
  isWebviewElementCaptureRect,
  isWebviewFixedElementSnapshotArray,
  isWebviewPageCaptureMetrics,
  type WebviewElementCaptureRect,
  type WebviewFixedElementOverlayCapture,
  type WebviewFixedElementSnapshot,
  type WebviewPageCaptureMetrics,
  type WebviewPageCaptureSlice
} from '../utils/screenshot';

/**
 * 截图 Hook 所需的最小页面状态。
 */
type ScreenshotState = Pick<WebviewPageState, 'title' | 'url'>;

/**
 * 截图遮罩显隐回调。
 */
type CaptureMaskVisibleChange = (visible: boolean) => void | Promise<void>;

/** 截图遮罩延迟显示时间，避免短任务闪烁。 */
const CAPTURE_MASK_DELAY_MS = 180;

/**
 * 创建截图 Hook 时需要注入的依赖。
 */
export interface UseScreenshotOptions {
  /** 当前 `<webview>` 元素引用 */
  webviewElementRef: Ref<WebviewTag | null>;
  /** 当前页面标题与地址 */
  webviewState: Ref<ScreenshotState>;
  /** 长截图期间切换宿主层遮罩；不传时默认挂载到 `<webview>` 宿主层 */
  onCaptureMaskVisibleChange?: CaptureMaskVisibleChange;
}

/**
 * 渲染后的截图切片。
 */
interface RenderedCaptureSlice {
  /** 原始切片信息 */
  slice: WebviewPageCaptureSlice;
  /** 可绘制图片 */
  image: HTMLImageElement;
}

/**
 * WebView 原生截图裁剪区域。
 */
interface WebviewCapturePageRect {
  /** WebView 截图中的横向起点 */
  x: number;
  /** WebView 截图中的纵向起点 */
  y: number;
  /** 裁剪宽度 */
  width: number;
  /** 裁剪高度 */
  height: number;
}

/**
 * 选中元素截图过程配置。
 */
interface CaptureSelectedElementPngOptions {
  /** 长截图期间是否显示宿主层遮罩 */
  onCaptureMaskVisibleChange?: CaptureMaskVisibleChange;
}

/**
 * 延迟截图遮罩会话。
 */
interface DelayedCaptureMaskSession {
  /** 结束遮罩会话，并在已显示时隐藏遮罩 */
  stop: () => Promise<void>;
}

/**
 * 截图帧准备配置。
 */
interface CaptureFramePreparationOptions {
  /** 当前选中元素选择器 */
  selector?: string;
  /** 需要隐藏遮挡层的截图区域 */
  obstructionRect?: WebviewCapturePageRect;
}

/**
 * 带 Electron WebContents ID 读取能力的 `<webview>`。
 */
type WebviewTagWithWebContentsId = WebviewTag & {
  /** 获取当前 `<webview>` 对应的 Electron WebContents ID */
  getWebContentsId?: () => number;
};

/**
 * 获取可执行截图脚本的 `<webview>` 实例。
 * @param webviewElementRef - `<webview>` 元素引用
 * @returns 已就绪的 `<webview>` 实例
 */
function getReadyWebviewElement(webviewElementRef: Ref<WebviewTag | null>): WebviewTag {
  const instance = webviewElementRef.value;
  if (!instance) {
    throw new Error('当前页面尚未准备好，请稍后重试');
  }

  if (typeof instance.executeJavaScript !== 'function' || typeof instance.capturePage !== 'function') {
    throw new Error('当前环境暂不支持 WebView 截图');
  }

  return instance;
}

/**
 * 读取当前页面的截屏尺寸信息。
 * @param element - `<webview>` 实例
 * @returns 页面截屏尺寸信息
 */
async function readPageCaptureMetrics(element: WebviewTag): Promise<WebviewPageCaptureMetrics> {
  const metrics = (await element.executeJavaScript(createPageCaptureMetricsScript())) as unknown;

  if (!isWebviewPageCaptureMetrics(metrics)) {
    throw new Error('读取页面尺寸信息失败');
  }

  return metrics;
}

/**
 * 判断选择结果是否包含选择时缓存的页面坐标。
 * @param selection - 当前选中元素
 * @returns 是否包含可用于 fallback 的页面坐标
 */
function hasCachedElementPageRect(
  selection: WebviewElementSelection
): selection is WebviewElementSelection & { rect: WebviewElementSelection['rect'] & { pageX: number; pageY: number } } {
  return (
    typeof selection.rect.pageX === 'number' &&
    Number.isFinite(selection.rect.pageX) &&
    typeof selection.rect.pageY === 'number' &&
    Number.isFinite(selection.rect.pageY)
  );
}

/**
 * 读取元素截图所需的页面指标。
 * @param element - `<webview>` 实例
 * @returns 页面与视口指标
 */
async function readElementCaptureMetrics(element: WebviewTag): Promise<Omit<WebviewElementCaptureRect, 'pageX' | 'pageY' | 'width' | 'height'>> {
  const metrics = (await element.executeJavaScript(createElementCaptureMetricsScript())) as unknown;

  if (!isWebviewElementCaptureMetrics(metrics)) {
    throw new Error('读取页面截图指标失败');
  }

  return metrics;
}

/**
 * 从选择时缓存的页面坐标恢复元素截图区域。
 * @param element - `<webview>` 实例
 * @param selection - 当前选中元素
 * @returns 元素当前可截图区域
 */
async function readCachedElementCaptureRect(element: WebviewTag, selection: WebviewElementSelection): Promise<WebviewElementCaptureRect> {
  if (!hasCachedElementPageRect(selection)) {
    throw new Error('读取选中元素位置失败');
  }

  const metrics = await readElementCaptureMetrics(element);
  return {
    pageX: selection.rect.pageX,
    pageY: selection.rect.pageY,
    width: selection.rect.width,
    height: selection.rect.height,
    ...metrics
  };
}

/**
 * 将元素截图区域裁剪到页面实际可截图边界内。
 * @param rect - 元素完整截图区域
 * @returns 页面实际可采样的元素区域
 */
function clampElementCaptureRect(rect: WebviewElementCaptureRect): WebviewElementCaptureRect {
  if (rect.isViewportAnchored) {
    const visibleLeft = Math.max(0, rect.pageX);
    const visibleTop = Math.max(0, rect.pageY);
    const visibleRight = Math.min(rect.captureViewportWidth, rect.pageX + rect.width);
    const visibleBottom = Math.min(rect.captureViewportHeight, rect.pageY + rect.height);
    const width = Math.max(0, visibleRight - visibleLeft);
    const height = Math.max(0, visibleBottom - visibleTop);

    if (width <= 0 || height <= 0) {
      throw new Error('选中的元素不在当前页面可截图范围内');
    }

    return {
      ...rect,
      pageX: visibleLeft,
      pageY: visibleTop,
      width,
      height
    };
  }

  const maxCapturableX = rect.maxScrollLeft + rect.viewportWidth;
  const maxCapturableY = rect.maxScrollTop + rect.viewportHeight;
  const width = Math.max(0, Math.min(rect.width, maxCapturableX - rect.pageX));
  const height = Math.max(0, Math.min(rect.height, maxCapturableY - rect.pageY));

  if (width <= 0 || height <= 0) {
    throw new Error('选中的元素不在当前页面可截图范围内');
  }

  return {
    ...rect,
    width,
    height
  };
}

/**
 * 计算无需滚动即可直接裁剪的 WebView 截图区域。
 * @param rect - 元素可截图区域
 * @returns 原生截图裁剪区域，不完整可见时返回 null
 */
function buildDirectVisibleElementCaptureRect(rect: WebviewElementCaptureRect): WebviewCapturePageRect | null {
  const sourceX = rect.isViewportAnchored ? rect.viewportX + rect.pageX : rect.viewportX + rect.pageX - rect.scrollLeft;
  const sourceY = rect.isViewportAnchored ? rect.viewportY + rect.pageY : rect.viewportY + rect.pageY - rect.scrollTop;
  const sourceRight = sourceX + rect.width;
  const sourceBottom = sourceY + rect.height;
  const viewportLeft = rect.viewportX;
  const viewportTop = rect.viewportY;
  const viewportRight = rect.viewportX + rect.viewportWidth;
  const viewportBottom = rect.viewportY + rect.viewportHeight;
  const isFullyVisible =
    sourceX >= viewportLeft &&
    sourceY >= viewportTop &&
    sourceRight <= viewportRight &&
    sourceBottom <= viewportBottom &&
    sourceX >= 0 &&
    sourceY >= 0 &&
    sourceRight <= rect.captureViewportWidth &&
    sourceBottom <= rect.captureViewportHeight;

  if (!isFullyVisible) {
    return null;
  }

  const x = Math.max(0, Math.floor(sourceX));
  const y = Math.max(0, Math.floor(sourceY));
  const width = Math.max(1, Math.ceil(sourceRight) - x);
  const height = Math.max(1, Math.ceil(sourceBottom) - y);

  return { x, y, width, height };
}

/**
 * 读取 `<webview>` 的 Electron WebContents ID。
 * @param element - `<webview>` 实例
 * @returns WebContents ID，不可用时返回 null
 */
function readWebviewWebContentsId(element: WebviewTag): number | null {
  const idReader = (element as WebviewTagWithWebContentsId).getWebContentsId;
  if (typeof idReader !== 'function') {
    return null;
  }

  const webContentsId = idReader.call(element);
  if (!Number.isFinite(webContentsId) || webContentsId <= 0) {
    return null;
  }

  return webContentsId;
}

/**
 * 构建协议层选中元素截图区域。
 * @param rect - 元素可截图区域
 * @returns 协议截图区域，不适合协议截图时返回 null
 */
function buildProtocolElementScreenshotClip(rect: WebviewElementCaptureRect): WebViewProtocolScreenshotClip | null {
  if (rect.isViewportAnchored || rect.scrollTarget.type !== 'window') {
    return null;
  }

  const maxCapturableX = rect.maxScrollLeft + rect.viewportWidth;
  const maxCapturableY = rect.maxScrollTop + rect.viewportHeight;
  const left = Math.max(0, rect.pageX);
  const top = Math.max(0, rect.pageY);
  const right = Math.min(maxCapturableX, rect.pageX + rect.width);
  const bottom = Math.min(maxCapturableY, rect.pageY + rect.height);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: left,
    y: top,
    width,
    height,
    scale: 1
  };
}

/**
 * 尝试通过主进程协议层截取选中元素，避免滚动当前 WebView。
 * @param element - `<webview>` 实例
 * @param rect - 元素可截图区域
 * @returns PNG 图片二进制；不可用或失败时返回 null
 */
async function captureSelectedElementProtocolPng(element: WebviewTag, rect: WebviewElementCaptureRect): Promise<ArrayBuffer | null> {
  const clip = buildProtocolElementScreenshotClip(rect);
  const webContentsId = readWebviewWebContentsId(element);
  if (!clip || !webContentsId || typeof native.captureWebviewScreenshot !== 'function') {
    return null;
  }

  let pickerLayerHidden = false;
  try {
    await element.executeJavaScript(createElementPickerLayerVisibilityScript(false));
    pickerLayerHidden = true;
    return await native.captureWebviewScreenshot({
      webContentsId,
      clip
    });
  } catch (error: unknown) {
    console.warn('Protocol selected element screenshot failed, fallback to stitched capture.', error);
    return null;
  } finally {
    if (pickerLayerHidden) {
      await element.executeJavaScript(createElementPickerLayerVisibilityScript(true)).catch(console.error);
    }
  }
}

/**
 * 读取选中元素当前可截图区域。
 * @param element - `<webview>` 实例
 * @param selection - 当前选中元素
 * @returns 元素当前可截图区域
 */
async function readSelectedElementCaptureRect(element: WebviewTag, selection: WebviewElementSelection): Promise<WebviewElementCaptureRect> {
  const rect = (await element.executeJavaScript(createElementCaptureRectScript(selection.selector))) as unknown;

  if (!isWebviewElementCaptureRect(rect)) {
    return readCachedElementCaptureRect(element, selection);
  }

  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('选中的元素不在当前视图中');
  }

  return rect;
}

/**
 * 将二进制视图转为独立 ArrayBuffer。
 * @param value - 二进制视图
 * @returns 可安全传输的 ArrayBuffer
 */
function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

/**
 * 将 PNG 字节加载为可绘制图片。
 * @param pngBytes - PNG 二进制内容
 * @returns 图片元素
 */
async function loadPngImage(pngBytes: ArrayBuffer): Promise<HTMLImageElement> {
  const blob = createPngBlob(pngBytes);
  const url = URL.createObjectURL(blob);

  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('加载截图切片失败'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 将 fixed 元素覆盖区域绘制回最终长图。
 * @param context - 目标画布上下文
 * @param image - 当前滚动位置下的截图
 * @param overlays - 需要绘制的覆盖区域
 * @param scale - CSS 像素到截图像素的缩放比例
 */
function drawFixedElementOverlays(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  overlays: WebviewFixedElementOverlayCapture['overlays'],
  scale: number
): void {
  overlays.forEach((overlay) => {
    const sourceX = Math.round(overlay.sourceX * scale);
    const sourceY = Math.round(overlay.sourceY * scale);
    const drawWidth = Math.max(1, Math.round(overlay.width * scale));
    const drawHeight = Math.max(1, Math.round(overlay.height * scale));
    const targetX = Math.round(overlay.targetX * scale);
    const targetY = Math.round(overlay.targetY * scale);

    context.drawImage(image, sourceX, sourceY, drawWidth, drawHeight, targetX, targetY, drawWidth, drawHeight);
  });
}

/**
 * 将 Canvas 内容导出为 PNG 二进制。
 * @param canvas - 目标画布
 * @returns PNG ArrayBuffer
 */
async function exportCanvasAsPng(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) {
        resolve(value);
        return;
      }

      reject(new Error('导出截图失败'));
    }, 'image/png');
  });

  return blob.arrayBuffer();
}

/**
 * 准备截图帧，统一等待选择框和遮挡层状态完成刷新。
 * @param element - `<webview>` 实例
 * @param options - 截图帧准备配置
 */
async function prepareCaptureFrame(element: WebviewTag, options: CaptureFramePreparationOptions = {}): Promise<void> {
  if (options.selector && options.obstructionRect) {
    await element.executeJavaScript(createElementCaptureObstructionVisibilityScript(options.selector, false, options.obstructionRect));
  }

  await element.executeJavaScript(createElementPickerLayerVisibilityScript(false));
}

/**
 * 应用截图遮罩基础样式。
 * @param maskElement - 截图遮罩元素
 */
function applyWebviewCaptureMaskStyle(maskElement: HTMLDivElement): void {
  maskElement.className = 'webview-capture-mask';
  maskElement.textContent = '正在截图...';
  maskElement.style.position = 'absolute';
  maskElement.style.inset = '0';
  maskElement.style.zIndex = '2';
  maskElement.style.display = 'flex';
  maskElement.style.alignItems = 'center';
  maskElement.style.justifyContent = 'center';
  maskElement.style.color = 'var(--text-secondary)';
  maskElement.style.fontSize = '13px';
  maskElement.style.fontWeight = '500';
  maskElement.style.background = 'rgba(255, 255, 255, 0.82)';
  maskElement.style.backdropFilter = 'blur(2px)';
  maskElement.style.pointerEvents = 'auto';
}

/**
 * 等待宿主遮罩完成一次绘制。
 */
function waitForWebviewCaptureMaskPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

/**
 * 启动延迟截图遮罩，短任务完成前不会显示遮罩。
 * @param onCaptureMaskVisibleChange - 遮罩显隐回调
 * @returns 延迟遮罩会话
 */
function startDelayedCaptureMask(onCaptureMaskVisibleChange: CaptureMaskVisibleChange | undefined): DelayedCaptureMaskSession {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let isMaskVisible = false;
  let showTask: Promise<void> | null = null;

  if (onCaptureMaskVisibleChange) {
    timeoutId = setTimeout(() => {
      timeoutId = null;
      isMaskVisible = true;
      showTask = Promise.resolve(onCaptureMaskVisibleChange(true)).catch((error: unknown) => {
        isMaskVisible = false;
        console.error(error);
      });
    }, CAPTURE_MASK_DELAY_MS);
  }

  return {
    async stop(): Promise<void> {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
        return;
      }

      if (showTask) {
        await showTask;
      }

      if (onCaptureMaskVisibleChange && isMaskVisible) {
        isMaskVisible = false;
        await onCaptureMaskVisibleChange(false);
      }
    }
  };
}

/**
 * 采样并拼接选中元素完整截图。
 * @param element - `<webview>` 实例
 * @param rect - 选中元素完整页面区域
 * @param selector - 当前选中元素选择器
 * @returns 选中元素截图 PNG
 */
async function captureSelectedElementPng(
  element: WebviewTag,
  rect: WebviewElementCaptureRect,
  selector: string,
  options: CaptureSelectedElementPngOptions = {}
): Promise<ArrayBuffer> {
  let captureRect = rect;
  let canvas: HTMLCanvasElement | null = null;
  let context: CanvasRenderingContext2D | null = null;
  let scaleX = 1;
  let scaleY = 1;
  let captureMaskSession: DelayedCaptureMaskSession | null = null;
  let hasScrolledForStitching = false;

  try {
    captureRect = clampElementCaptureRect(rect);
    const directCaptureRect = buildDirectVisibleElementCaptureRect(captureRect);
    if (directCaptureRect) {
      // 完整可见的元素直接使用 WebView 原生裁剪，避免为了截图滚动页面。
      await prepareCaptureFrame(element, { selector, obstructionRect: directCaptureRect });
      const capturedImage = await element.capturePage(directCaptureRect);
      return toArrayBuffer(capturedImage.toPNG());
    }

    const protocolPng = await captureSelectedElementProtocolPng(element, captureRect);
    if (protocolPng) {
      return protocolPng;
    }

    const segments = buildElementCaptureSegments(captureRect);
    captureMaskSession = startDelayedCaptureMask(options.onCaptureMaskVisibleChange);
    hasScrolledForStitching = true;

    for (const segment of segments) {
      // 选中元素可能跨多个视口，必须按切片顺序滚动、截图、绘制。
      // eslint-disable-next-line no-await-in-loop
      await element.executeJavaScript(createElementCaptureScrollScript(captureRect.scrollTarget, segment.scrollTop, segment.scrollLeft));
      // 隐藏与选中元素无关的 fixed/sticky 遮挡层，避免截到顶部导航等覆盖物。
      // eslint-disable-next-line no-await-in-loop
      await prepareCaptureFrame(element, {
        selector,
        obstructionRect: {
          x: segment.sourceX,
          y: segment.sourceY,
          width: segment.width,
          height: segment.height
        }
      });
      // eslint-disable-next-line no-await-in-loop
      const capturedImage = await element.capturePage();
      const pngBytes = toArrayBuffer(capturedImage.toPNG());
      // eslint-disable-next-line no-await-in-loop
      const image = await loadPngImage(pngBytes);

      if (!canvas) {
        scaleX = image.width / Math.max(captureRect.captureViewportWidth, 1);
        scaleY = image.height / Math.max(captureRect.captureViewportHeight, 1);
        canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(captureRect.width * scaleX));
        canvas.height = Math.max(1, Math.round(captureRect.height * scaleY));
        context = canvas.getContext('2d');
        if (!context) {
          throw new Error('创建选中元素截图画布失败');
        }
      }

      if (!context) {
        throw new Error('创建选中元素截图画布失败');
      }

      drawElementCaptureSegment(context, image, segment, scaleX, scaleY);
    }
  } finally {
    if (hasScrolledForStitching || rect.scrollTarget.type === 'element') {
      await element.executeJavaScript(createElementCaptureScrollScript(rect.scrollTarget, rect.scrollTop, rect.scrollLeft)).catch(console.error);
    }
    await element
      .executeJavaScript(
        createElementCaptureObstructionVisibilityScript(selector, true, { x: 0, y: 0, width: rect.captureViewportWidth, height: rect.captureViewportHeight })
      )
      .catch(console.error);
    await element.executeJavaScript(createElementPickerLayerVisibilityScript(true)).catch(console.error);
    await element.executeJavaScript(createElementCaptureCleanupScript(rect.scrollTarget)).catch(console.error);
    if (captureMaskSession) {
      await captureMaskSession.stop().catch(console.error);
    }
  }

  if (!canvas) {
    throw new Error('当前页面没有可截取的选中元素');
  }

  return exportCanvasAsPng(canvas);
}

/**
 * 采样并拼接完整页面长截屏。
 * @param element - `<webview>` 实例
 * @returns 拼接后的 PNG 二进制
 */
async function captureFullPagePng(element: WebviewTag): Promise<ArrayBuffer> {
  const metrics = await readPageCaptureMetrics(element);
  const slices = buildPageCaptureSlices(metrics);
  const renderedSlices: RenderedCaptureSlice[] = [];
  const positionedObservationsBySlice: WebviewFixedElementSnapshot[][] = [];
  let fixedOverlayCaptures: WebviewFixedElementOverlayCapture[] = [];
  let pngBuffer: ArrayBuffer | null = null;

  try {
    await element.executeJavaScript(createFixedElementCaptureSetupScript());

    for (const slice of slices) {
      // 长截屏需要串行滚动与采样，避免并发截图读到错位视口。
      // eslint-disable-next-line no-await-in-loop
      await element.executeJavaScript(createPageScrollScript(slice.scrollTop));
      // 先恢复定位层原始状态，确保读取的是这一屏真实可见的吸附元素。
      // eslint-disable-next-line no-await-in-loop
      await element.executeJavaScript(createFixedElementVisibilityScript(true));
      // 当前切片可能在滚动后显示或创建新的定位层，需要在读取快照前补充标记。
      // eslint-disable-next-line no-await-in-loop
      await element.executeJavaScript(createFixedElementCaptureSetupScript());
      // 先读取当前屏幕中真正吸附住的定位元素，再决定后续是否保留。
      // eslint-disable-next-line no-await-in-loop
      const visiblePositionedElementsRaw = (await element.executeJavaScript(createVisiblePositionedElementSnapshotScript())) as unknown;
      if (!isWebviewFixedElementSnapshotArray(visiblePositionedElementsRaw)) {
        throw new Error('读取定位元素信息失败');
      }
      positionedObservationsBySlice.push(visiblePositionedElementsRaw);
      // 基础长图统一隐藏定位层，最后再按保留规则覆盖回去。
      // eslint-disable-next-line no-await-in-loop
      await element.executeJavaScript(createFixedElementVisibilityScript(false));
      // eslint-disable-next-line no-await-in-loop
      const capturedImage = await element.capturePage();
      const pngBytes = toArrayBuffer(capturedImage.toPNG());
      // eslint-disable-next-line no-await-in-loop
      const image = await loadPngImage(pngBytes);

      renderedSlices.push({ slice, image });
    }

    fixedOverlayCaptures = buildFixedElementOverlayCaptures(
      metrics,
      positionedObservationsBySlice,
      slices.map((slice) => slice.scrollTop)
    );

    const firstSlice = renderedSlices[0];
    if (!firstSlice) {
      throw new Error('当前页面没有可截取的内容');
    }

    const scale = firstSlice.image.width / Math.max(metrics.viewportWidth, 1);
    const canvas = document.createElement('canvas');
    canvas.width = firstSlice.image.width;
    canvas.height = Math.max(1, Math.round(metrics.contentHeight * scale));

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('创建截图画布失败');
    }

    renderedSlices.forEach(({ slice, image }) => {
      const sourceY = Math.round(slice.sourceY * scale);
      const drawHeight = Math.max(1, Math.round(slice.height * scale));
      const targetY = Math.round(slice.offsetY * scale);

      context.drawImage(image, 0, sourceY, image.width, drawHeight, 0, targetY, image.width, drawHeight);
    });

    for (const capture of fixedOverlayCaptures) {
      // 按锚点滚动到对应位置，再进行一次覆盖采样。
      // eslint-disable-next-line no-await-in-loop
      await element.executeJavaScript(createPageScrollScript(capture.scrollTop));
      // eslint-disable-next-line no-await-in-loop
      await element.executeJavaScript(createFixedElementVisibilityScript(true));
      // eslint-disable-next-line no-await-in-loop
      const capturedImage = await element.capturePage();
      const pngBytes = toArrayBuffer(capturedImage.toPNG());
      // eslint-disable-next-line no-await-in-loop
      const image = await loadPngImage(pngBytes);

      drawFixedElementOverlays(context, image, capture.overlays, scale);
    }

    pngBuffer = await exportCanvasAsPng(canvas);
  } finally {
    await element.executeJavaScript(createFixedElementCaptureCleanupScript()).catch(console.error);
    await element.executeJavaScript(createPageScrollScript(metrics.scrollTop)).catch(console.error);
  }

  if (!pngBuffer) {
    throw new Error('导出完整页面截图失败');
  }

  return pngBuffer;
}

/**
 * 创建 WebView 截图控制器。
 * @param options - Hook 依赖
 * @returns 截图方法
 */
export function useScreenshot(options: UseScreenshotOptions): {
  isCapturing: Ref<boolean>;
  captureViewportScreenshot: () => Promise<void>;
  captureFullPageScreenshot: () => Promise<void>;
  captureSelectedElementScreenshot: (selection: WebviewElementSelection | null) => Promise<void>;
} {
  const isCapturing = ref(false);
  let webviewCaptureMaskElement: HTMLDivElement | null = null;

  /**
   * 获取当前 WebView 所在的宿主层。
   * @returns 宿主层元素，不存在时返回 null
   */
  function getWebviewHostLayer(): HTMLElement | null {
    const hostLayer = options.webviewElementRef.value?.parentElement;
    return hostLayer instanceof HTMLElement ? hostLayer : null;
  }

  /**
   * 确保当前宿主层存在截图遮罩。
   * @returns 截图遮罩元素，不存在宿主层时返回 null
   */
  function ensureWebviewCaptureMaskElement(): HTMLDivElement | null {
    const hostLayer = getWebviewHostLayer();
    if (!hostLayer) {
      return null;
    }

    if (webviewCaptureMaskElement?.isConnected) {
      return webviewCaptureMaskElement;
    }

    const maskElement = document.createElement('div');
    applyWebviewCaptureMaskStyle(maskElement);
    maskElement.hidden = true;
    hostLayer.appendChild(maskElement);
    webviewCaptureMaskElement = maskElement;
    return maskElement;
  }

  /**
   * 切换默认宿主层截图遮罩。
   * @param visible - 是否显示遮罩
   */
  async function setHostedCaptureMaskVisible(visible: boolean): Promise<void> {
    const maskElement = ensureWebviewCaptureMaskElement();
    if (!maskElement) {
      return;
    }

    maskElement.hidden = !visible;
    if (visible) {
      await nextTick();
      await waitForWebviewCaptureMaskPaint();
    }
  }

  /**
   * 清理默认宿主层截图遮罩。
   */
  function cleanupHostedCaptureMask(): void {
    webviewCaptureMaskElement?.remove();
    webviewCaptureMaskElement = null;
  }

  const onCaptureMaskVisibleChange = options.onCaptureMaskVisibleChange ?? setHostedCaptureMaskVisible;

  if (getCurrentInstance()) {
    onBeforeUnmount(cleanupHostedCaptureMask);
  }

  /**
   * 串行执行截图任务，避免重复点击导致状态恢复互相覆盖。
   * @param task - 截图任务
   */
  async function runCaptureTask(task: () => Promise<void>): Promise<void> {
    if (isCapturing.value) {
      return;
    }

    isCapturing.value = true;
    try {
      await task();
    } finally {
      isCapturing.value = false;
    }
  }

  /**
   * 截取当前视图并复制为剪贴板 PNG。
   */
  async function captureViewportScreenshot(): Promise<void> {
    await runCaptureTask(async (): Promise<void> => {
      try {
        const element = getReadyWebviewElement(options.webviewElementRef);
        const image = await element.capturePage();
        await native.copyImageToClipboard(toArrayBuffer(image.toPNG()));

        message.success('截图已保存到剪贴板');
      } catch (error: unknown) {
        message.error(error instanceof Error ? error.message : '截取当前视图失败');
      }
    });
  }

  /**
   * 截取完整页面长图并复制为剪贴板 PNG。
   */
  async function captureFullPageScreenshot(): Promise<void> {
    await runCaptureTask(async (): Promise<void> => {
      const captureMaskSession = startDelayedCaptureMask(onCaptureMaskVisibleChange);
      try {
        const element = getReadyWebviewElement(options.webviewElementRef);
        const pngBuffer = await captureFullPagePng(element);
        await native.copyImageToClipboard(pngBuffer);

        message.success('截图已保存到剪贴板');
      } catch (error: unknown) {
        message.error(error instanceof Error ? error.message : '截取完整页面失败');
      } finally {
        await captureMaskSession.stop().catch(console.error);
      }
    });
  }

  /**
   * 截取当前选中的页面元素并复制为剪贴板 PNG。
   * @param selection - 当前选中的页面元素
   */
  async function captureSelectedElementScreenshot(selection: WebviewElementSelection | null): Promise<void> {
    await runCaptureTask(async (): Promise<void> => {
      try {
        if (!selection) {
          throw new Error('请先选择页面元素');
        }

        const element = getReadyWebviewElement(options.webviewElementRef);
        const rect = await readSelectedElementCaptureRect(element, selection);
        const pngBuffer = await captureSelectedElementPng(element, rect, selection.selector, {
          onCaptureMaskVisibleChange
        });
        await native.copyImageToClipboard(pngBuffer);

        message.success('截图已保存到剪贴板');
      } catch (error: unknown) {
        message.error(error instanceof Error ? error.message : '截取选中元素失败');
      }
    });
  }

  return {
    isCapturing,
    captureViewportScreenshot,
    captureFullPageScreenshot,
    captureSelectedElementScreenshot
  };
}
