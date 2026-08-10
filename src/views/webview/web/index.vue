<template>
  <div class="webview-shell">
    <AddressBar
      :url="webview.state.value.url"
      :can-go-back="webview.state.value.canGoBack"
      :can-go-forward="webview.state.value.canGoForward"
      :is-loading="webview.state.value.isLoading"
      :is-element-selecting="webview.state.value.isElementSelecting"
      :is-device-toolbar-visible="deviceMode.isToolbarVisible.value"
      :is-inspector-open="isInspectorOpen"
      :has-selected-element="Boolean(webview.selectedElement)"
      :is-screenshot-capturing="screenshot.isCapturing.value"
      @go-back="webview.goBack"
      @go-forward="webview.goForward"
      @reload="webview.reload"
      @stop="webview.stop"
      @submit-url="handleSubmitUrl"
      @open-in-browser="openInBrowser"
      @open-dev-tools="webview.openDevTools"
      @select-element="handleStartElementSelection"
      @toggle-device-toolbar="deviceMode.toggleToolbarVisible"
      @toggle-inspector="toggleInspector"
      @capture-viewport-screenshot="screenshot.captureViewportScreenshot"
      @capture-full-page-screenshot="screenshot.captureFullPageScreenshot"
      @capture-selected-element-screenshot="handleCaptureSelectedElementScreenshot"
      @clear-cache="cacheControl.clearCache"
    />

    <DeviceToolbar v-if="deviceMode.isToolbarVisible.value" :active-preset="deviceMode.activePreset.value" @select-preset="handleSelectDevicePreset" />

    <div class="webview-main">
      <div ref="webviewContentRef" class="webview-content" :class="{ 'webview-content--framed': isDeviceFramed }" @scroll="requestSyncHostLayerBounds">
        <div ref="webviewContainerRef" class="webview-viewport" :style="viewportStyle"></div>
      </div>

      <BPanelSplitter v-if="isInspectorOpen" v-model:size="domPanelWidth" :min-width="280" :max-width="480" :closable="false">
        <InspectorPanel
          :selection="webview.selectedElement"
          @capture-selected-element-screenshot="handleCaptureSelectedElementScreenshot"
          @close="handleCloseDomInspector"
        />
      </BPanelSplitter>
    </div>

    <Teleport v-if="webviewHostLayerRef" :to="webviewHostLayerRef">
      <div v-if="isAgentActivityVisible" class="webview-agent-activity" :class="agentActivityClass" role="status" aria-live="polite">
        <div class="webview-agent-activity__badge">
          <span class="webview-agent-activity__dot"></span>
          <span class="webview-agent-activity__label">{{ agentActivity.label }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
/**
 * @file index.vue
 * @description `<webview>` 标签页面入口。
 */
import type { PageFaviconUpdatedEvent, PageTitleUpdatedEvent, WebviewTag } from 'electron';
import { computed, nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from 'vue';
import { useRoute } from 'vue-router';
import { debounce } from 'lodash-es';
import { native } from '@/shared/platform';
import { useRecentStore } from '@/stores/workspace/recent';
import { resolveRuntimeThemeColors } from '@/theme';
import { useTabTitle } from '@/views/webview/shared/hooks/useTabTitle';
import type { WebviewElementSelection } from '@/views/webview/shared/types';
import { normalizeWebviewUrl } from '@/views/webview/shared/utils/url';
import AddressBar from './components/AddressBar.vue';
import DeviceToolbar from './components/DeviceToolbar.vue';
import InspectorPanel from './components/InspectorPanel.vue';
import { useCacheControl } from './hooks/useCacheControl.ts';
import { useChatContext, type WebviewChatPageEnvironment } from './hooks/useChatContext';
import { useDeviceMode, type WebviewDevicePresetKey } from './hooks/useDeviceMode.ts';
import { useHostLayer } from './hooks/useHostLayer.ts';
import { useScreenshot } from './hooks/useScreenshot.ts';
import { useWebView, type WebviewElementPickerTheme } from './hooks/useWebView.ts';
import { ensureHostedWebviewElement, ensureWebviewHostLayer } from './utils/hosting';

const route = useRoute();
const webviewContentRef = ref<HTMLElement | null>(null);
const webviewContainerRef = ref<HTMLElement | null>(null);
const webviewElementRef = ref<WebviewTag | null>(null);
const webviewHostLayerRef = ref<HTMLElement | null>(null);

const routeFullPath = route.fullPath;
const initialUrl = normalizeWebviewUrl(decodeURIComponent((route.query.url as string) || ''));

const webview = useWebView(webviewElementRef);
const deviceMode = useDeviceMode();
const cacheControl = useCacheControl(webviewElementRef);
const chatResourceId = ref<string>(routeFullPath);
const chatContextAvailable = computed<boolean>((): boolean => Boolean(webviewElementRef.value));
const chatPageEnvironment = computed<WebviewChatPageEnvironment>((): WebviewChatPageEnvironment => {
  const { url, title } = webview.state.value;
  const selectedText = webview.selectedElement?.text;
  return selectedText ? { url, title, selectedText } : { url, title };
});

useChatContext({
  resourceId: chatResourceId,
  available: chatContextAvailable,
  page: chatPageEnvironment,
  context: {
    readPageSnapshot: webview.readPageSnapshot,
    operatePage: webview.operatePage
  }
});

/**
 * 读取当前主题 CSS 变量。
 * @param style - 当前根元素计算样式
 * @param name - CSS 变量名
 * @param fallback - 变量不存在时的兜底值
 * @returns CSS 变量值
 */
function readThemeVariable(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const value = style.getPropertyValue(name).trim();
  return value || fallback;
}

/** DOM 检查看板宽度 */
const domPanelWidth = ref(360);

/** CSS 查看器是否打开，null 表示用户尚未决定（首次选中元素时自动打开） */
const isInspectorOpen = ref<boolean | null>(null);

const isDeviceFramed = computed(() => deviceMode.isToolbarVisible.value);

const activeUserAgent = computed(() => (deviceMode.isToolbarVisible.value ? deviceMode.activePreset.value.userAgent : ''));

const agentActivity = computed(() => webview.agentActivity.value);

const isAgentActivityVisible = computed(() => agentActivity.value.phase !== 'idle');

const agentActivityClass = computed(() => `webview-agent-activity--${agentActivity.value.phase}`);

const viewportStyle = computed<CSSProperties>(() => {
  if (!isDeviceFramed.value) {
    return {};
  }

  const { width, height } = deviceMode.activePreset.value;
  return { width: `${width}px`, height: `${height}px` };
});

// ---- 宿主层同步（RAF + resize + scroll 统一管理）----
const { requestSyncHostLayerBounds } = useHostLayer(routeFullPath, webviewContainerRef, webviewContentRef, webviewElementRef);

// ---- Wheel 转发（早返回简化）----

const screenshot = useScreenshot({
  webviewElementRef,
  webviewState: webview.state
});

/**
 * 在设备视口被宿主层覆盖时转发滚轮到外层滚动容器。
 * @param event - 滚轮事件
 */
function handleHostedWheel(event: WheelEvent): void {
  const scroller = webviewContentRef.value;
  if (!isDeviceFramed.value || !scroller) {
    return;
  }

  const { scrollLeft, scrollTop } = scroller;
  scroller.scrollBy({ left: event.deltaX, top: event.deltaY, behavior: 'auto' });

  if (scroller.scrollLeft !== scrollLeft || scroller.scrollTop !== scrollTop) {
    event.preventDefault();
    requestSyncHostLayerBounds();
  }
}

/**
 * 接收通用 DOM 事件并转发有效滚轮事件。
 * @param event - DOM 事件
 */
function handleHostedWheelEvent(event: Event): void {
  if (!(event instanceof WheelEvent) || !isDeviceFramed.value) {
    return;
  }

  handleHostedWheel(event);
}

const recentStore = useRecentStore();
const RECENT_RECORD_WRITE_DELAY_MS = 300;
let recentWebviewRecordUrl = '';
let lastRecentWebviewPayload = '';

/**
 * 将当前 webview 页面写入最近记录。
 * debounce 避免重定向链、标题和 favicon 连续事件产生重复写入。
 */
const writeRecentWebviewRecord = debounce(() => {
  const { url, title, favicon } = webview.state.value;
  if (!url) return;

  if (!recentWebviewRecordUrl) {
    recentWebviewRecordUrl = url;
  }
  if (url !== recentWebviewRecordUrl) {
    return;
  }

  const normalizedTitle = title || url;
  const normalizedFavicon = favicon || undefined;
  const payload = [url, normalizedTitle, normalizedFavicon ?? ''].join('\0');
  if (payload === lastRecentWebviewPayload) {
    return;
  }

  lastRecentWebviewPayload = payload;
  recentStore.addWebviewRecord(url, normalizedTitle, normalizedFavicon ? { favicon: normalizedFavicon } : undefined).catch(console.error);
}, RECENT_RECORD_WRITE_DELAY_MS);

/**
 * 导航完成事件处理，触发记录写入。
 */
function handleDidNavigateRecord(): void {
  writeRecentWebviewRecord();
}

/**
 * 页面标题更新事件处理，同步状态后刷新最近记录标题。
 * @param event - 页面标题更新事件
 */
function handlePageTitleUpdated(event: PageTitleUpdatedEvent): void {
  webview.handleTitleUpdated(event);
  writeRecentWebviewRecord();
}

/**
 * 页面 favicon 更新事件处理，同步状态后刷新最近记录图标。
 * @param event - 页面 favicon 更新事件
 */
function handlePageFaviconUpdated(event: PageFaviconUpdatedEvent): void {
  webview.handleFaviconUpdated(event);
  writeRecentWebviewRecord();
}

/**
 * `<webview>` 事件绑定映射表，用于统一绑定与解绑。
 */
const webviewEventMap: Array<{ name: string; handler: EventListener | ((event: Event) => void); useCapture?: boolean }> = [
  { name: 'did-start-loading', handler: webview.handleDidStartLoading as EventListener },
  { name: 'did-start-navigation', handler: webview.handleDidStartNavigation as EventListener },
  { name: 'dom-ready', handler: webview.handleDomReady as EventListener },
  { name: 'did-navigate', handler: webview.handleDidNavigate as EventListener },
  { name: 'did-navigate-in-page', handler: webview.handleDidNavigate as EventListener },
  { name: 'page-title-updated', handler: handlePageTitleUpdated as EventListener },
  { name: 'page-favicon-updated', handler: handlePageFaviconUpdated as EventListener },
  { name: 'did-stop-loading', handler: webview.handleDidStopLoading as EventListener },
  { name: 'ipc-message', handler: webview.handleIpcMessage },
  { name: 'wheel', handler: handleHostedWheelEvent },
  { name: 'did-navigate', handler: handleDidNavigateRecord },
  { name: 'did-navigate-in-page', handler: handleDidNavigateRecord }
];

/**
 * 绑定 `<webview>` 事件。
 * @param element - `<webview>` 元素
 */
function bindWebviewEvents(element: WebviewTag): void {
  webviewEventMap.forEach(({ name, handler, useCapture }) => {
    element.addEventListener(name, handler, useCapture);
  });
}

/**
 * 解绑 `<webview>` 事件。
 * @param element - `<webview>` 元素
 */
function unbindWebviewEvents(element: WebviewTag): void {
  webviewEventMap.forEach(({ name, handler, useCapture }) => {
    element.removeEventListener(name, handler, useCapture);
  });
}

/**
 * 在系统浏览器中打开当前 URL。
 */
async function openInBrowser(): Promise<void> {
  await native.openExternal(webview.state.value.url);
}

/**
 * 处理地址栏提交的 URL。
 * @param value - 用户输入的 URL
 */
function handleSubmitUrl(value: string): void {
  webview.navigate(normalizeWebviewUrl(value));
}

/**
 * 切换到指定设备尺寸预设。
 * @param presetKey - 设备尺寸预设标识
 */
function handleSelectDevicePreset(presetKey: WebviewDevicePresetKey): void {
  deviceMode.selectPreset(presetKey);
}

/**
 * 读取当前应用主题中的元素选择器高亮色。
 * @returns 页面元素选择器主题
 */
function resolveElementPickerTheme(): WebviewElementPickerTheme {
  const colors = resolveRuntimeThemeColors();
  const style = getComputedStyle(document.documentElement);

  return {
    color: colors.primary,
    background: colors.primaryBg,
    border: colors.primaryBorder,
    borderWidth: readThemeVariable(style, '--overlay-border-width', '2px'),
    surfaceRadius: readThemeVariable(style, '--surface-radius', '4px')
  };
}

/**
 * 切换页面 DOM 元素持续选择模式。
 */
function handleStartElementSelection(): void {
  const action = webview.state.value.isElementSelecting ? webview.stopElementSelection() : webview.startElementSelection(resolveElementPickerTheme());

  action.catch((err: unknown) => console.error('Element selection error:', err));
}

/**
 * 关闭 DOM 检查看板并停止元素选择模式。
 */
function handleCloseDomInspector(): void {
  isInspectorOpen.value = false;
  if (!webview.state.value.isElementSelecting) {
    return;
  }

  webview.stopElementSelection().catch((err: unknown) => console.error('Element selection error:', err));
}

/**
 * 切换 CSS 查看器面板。
 * null 视为关闭状态，切换后打开；非 null 取反。
 */
function toggleInspector(): void {
  isInspectorOpen.value = isInspectorOpen.value === null ? true : !isInspectorOpen.value;
}

/**
 * 按当前选中 DOM 元素截图。
 * @param selection - 需要截图的选中元素，缺省使用当前选中元素
 */
function handleCaptureSelectedElementScreenshot(selection: WebviewElementSelection | null = webview.selectedElement): void {
  if (screenshot.isCapturing.value) {
    return;
  }

  screenshot.captureSelectedElementScreenshot(selection).catch(console.error);
}

/**
 * 监听宿主拒绝附加 `<webview>` 的事件。
 */
const offAttachRejected = window.electronAPI?.webview.onAttachRejected((payload) => {
  if (payload.src === webview.state.value.url) {
    webview.handleAttachRejected(payload);
  }
});

/**
 * 创建并缓存 `<webview>` 元素，只创建一次。
 * `<webview>` 与当前标签页宿主层始终挂在 `document.body` 下，不跟随页面 DOM 重挂载。
 * @returns `<webview>` 元素
 */
function ensureWebviewElement(): WebviewTag {
  if (webviewElementRef.value) {
    return webviewElementRef.value;
  }

  const hostLayer = ensureWebviewHostLayer(document, routeFullPath);
  webviewHostLayerRef.value = hostLayer;
  const element = ensureHostedWebviewElement(hostLayer);
  bindWebviewEvents(element);
  webviewElementRef.value = element;
  webview.create(initialUrl);
  webview.setUserAgent(activeUserAgent.value);
  webview.attachInitialUrl(initialUrl);
  return element;
}

ensureWebviewElement();

useTabTitle({
  routeFullPath,
  title: computed(() => webview.state.value.title)
});

// ---- Watches（合并 toolbar + preset 变化触发视口同步）----
watch([deviceMode.isToolbarVisible, deviceMode.activePreset], () => nextTick(requestSyncHostLayerBounds).catch(console.error));

/**
 * 监听选中元素变化，首次选中时自动打开 DOM 检查看板。
 * 用户手动关闭后 isInspectorOpen 为 false，不再自动打开。
 */
watch(webview.selectedElementRef, (value) => {
  if (value && isInspectorOpen.value === null) {
    isInspectorOpen.value = true;
  }
});

watch(deviceMode.touchSimulationEnabled, (enabled) => {
  webview.setTouchSimulationEnabled(enabled).catch(console.error);
});

watch(activeUserAgent, (userAgent) => {
  webview.setUserAgent(userAgent);
});

onBeforeUnmount(() => {
  writeRecentWebviewRecord.cancel();
  if (webview.state.value.isElementSelecting) {
    webview.stopElementSelection().catch((err: unknown) => console.error('Element selection error:', err));
  }

  const element = webviewElementRef.value;
  if (element) {
    unbindWebviewEvents(element);
    element.parentElement?.remove();
    webviewElementRef.value = null;
    webviewHostLayerRef.value = null;
  }
  offAttachRejected?.();
});
</script>

<style scoped>
.webview-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);
}

.webview-main {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.webview-content {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: stretch;
  justify-content: stretch;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.webview-content--framed {
  flex-direction: row;
  align-items: flex-start;
  justify-content: center;
  padding: 16px;
}

.webview-viewport {
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-primary);
  border: 0;
  border-radius: var(--surface-radius);
}

.webview-content--framed .webview-viewport {
  flex: 0 0 auto;
  max-width: 100%;
  height: auto;
}

.webview-agent-activity {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 12px;
  pointer-events: none;
  border-radius: inherit;

  --webview-agent-ring-shadow: 0 0 0 var(--overlay-border-width)
      color-mix(in srgb, var(--color-warning-border, var(--color-warning, var(--color-primary))) 48%, transparent),
    0 0 22px color-mix(in srgb, var(--color-warning, var(--color-primary)) 42%, transparent);
  --webview-agent-dot-shadow: 0 0 0 calc(var(--overlay-border-width) * 2) color-mix(in srgb, var(--color-warning, var(--color-primary)) 18%, transparent);
}

.webview-agent-activity::before {
  position: absolute;
  inset: 0;
  content: '';
  border: var(--overlay-border-width) solid var(--color-warning, var(--color-primary));
  border-radius: inherit;
  box-shadow: var(--webview-agent-ring-shadow);
  animation: webview-agent-activity-breathe 1.6s ease-in-out infinite;
}

.webview-agent-activity__badge {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 7px;
  align-items: center;
  max-width: min(320px, 100%);
  padding: 6px 10px;
  overflow: hidden;
  font-size: 12px;
  line-height: 18px;
  color: var(--color-warning, var(--color-primary));
  background: color-mix(in srgb, var(--color-warning-bg, var(--color-primary-bg)) 82%, var(--bg-primary));
  border: var(--overlay-border-width) solid color-mix(in srgb, var(--color-warning-border, var(--color-warning, var(--color-primary))) 78%, transparent);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-lg);
  backdrop-filter: blur(10px);
}

.webview-agent-activity__dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  background: var(--color-warning, var(--color-primary));
  border-radius: var(--radius-full);
  box-shadow: var(--webview-agent-dot-shadow);
  animation: webview-agent-activity-dot 1.2s ease-in-out infinite;
}

.webview-agent-activity__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.webview-agent-activity--success::before {
  border-color: var(--color-success, var(--color-primary));

  --webview-agent-ring-shadow: 0 0 0 var(--overlay-border-width) color-mix(in srgb, var(--color-success, var(--color-primary)) 48%, transparent),
    0 0 22px color-mix(in srgb, var(--color-success, var(--color-primary)) 42%, transparent);

  animation-duration: 900ms;
}

.webview-agent-activity--success .webview-agent-activity__badge {
  color: var(--color-success, var(--color-primary));
  background: color-mix(in srgb, var(--color-success-bg, var(--color-primary-bg)) 82%, var(--bg-primary));
  border-color: color-mix(in srgb, var(--color-success, var(--color-primary)) 78%, transparent);
}

.webview-agent-activity--success .webview-agent-activity__dot {
  background: var(--color-success, var(--color-primary));

  --webview-agent-dot-shadow: 0 0 0 calc(var(--overlay-border-width) * 2) color-mix(in srgb, var(--color-success, var(--color-primary)) 18%, transparent);

  animation-duration: 900ms;
}

.webview-agent-activity--error::before {
  border-color: var(--color-error, var(--color-danger));

  --webview-agent-ring-shadow: 0 0 0 var(--overlay-border-width)
      color-mix(in srgb, var(--color-danger, var(--color-error, var(--color-primary))) 48%, transparent),
    0 0 22px color-mix(in srgb, var(--color-error, var(--color-danger)) 42%, transparent);
}

.webview-agent-activity--error .webview-agent-activity__badge {
  color: var(--color-error, var(--color-danger));
  background: color-mix(in srgb, var(--color-error-bg, var(--color-primary-bg)) 82%, var(--bg-primary));
  border-color: color-mix(in srgb, var(--color-danger, var(--color-error, var(--color-primary))) 78%, transparent);
}

.webview-agent-activity--error .webview-agent-activity__dot {
  background: var(--color-error, var(--color-danger));

  --webview-agent-dot-shadow: 0 0 0 calc(var(--overlay-border-width) * 2) color-mix(in srgb, var(--color-error, var(--color-danger)) 18%, transparent);
}

@keyframes webview-agent-activity-breathe {
  0%,
  100% {
    opacity: 0.62;
  }

  50% {
    opacity: 1;
  }
}

@keyframes webview-agent-activity-dot {
  0%,
  100% {
    opacity: 0.62;
    transform: scale(0.85);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .webview-agent-activity::before,
  .webview-agent-activity__dot {
    animation: none;
  }
}
</style>
