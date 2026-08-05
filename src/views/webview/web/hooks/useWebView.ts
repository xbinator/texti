/**
 * @file useWebView.ts
 * @description 封装 `<webview>` 标签页面状态与导航控制。
 */
import type { DidNavigateEvent, PageFaviconUpdatedEvent, PageTitleUpdatedEvent, WebviewTag } from 'electron';
import { ref, type Ref } from 'vue';
import type {
  WebviewAgentActivity,
  WebviewAgentActivityPhase,
  WebviewController,
  WebviewElementSelection,
  WebviewPageState
} from '@/views/webview/shared/types';
import { normalizeWebviewUrl } from '@/views/webview/shared/utils/url';
import {
  createActiveSnapshotElements,
  createPublicWebviewPageSnapshot,
  createSelectedElementSnapshot,
  createWebviewOperationError,
  isWebviewOperateResult,
  isWebviewPageSnapshot,
  normalizeWebviewPageOperationError,
  normalizeWebviewPageReadError,
  normalizeWebviewPageSnapshot,
  withWebviewAbort,
  withWebviewPageOperationTimeout,
  withWebviewPageReadTimeout
} from '@/views/webview/web/automation/normalize';
import { createPageOperationScript } from '@/views/webview/web/automation/operationScript';
import { createPageSnapshotScript } from '@/views/webview/web/automation/snapshotScript';
import type { ActiveWebviewSnapshotElement } from '@/views/webview/web/automation/types';
import type { WebviewOperateInput, WebviewOperateResult, WebviewPageSnapshot } from '@/views/webview/web/types';
import {
  DEFAULT_ELEMENT_PICKER_THEME,
  createDrainElementSelectionMessagesScript,
  createElementSelectionScript,
  createStopElementSelectionScript,
  isElementSelection,
  isWebviewElementHostMessage,
  isWebviewIpcMessageEvent,
  normalizeElementSelection,
  type WebviewElementHostMessage,
  type WebviewElementPickerTheme,
  type WebviewIpcMessageEvent
} from '@/views/webview/web/utils/elementPicker';

export {
  WEBVIEW_PAGE_CONTENT_LIMIT,
  WEBVIEW_PAGE_ELEMENT_LIMIT,
  WEBVIEW_PAGE_HEADING_LIMIT,
  WEBVIEW_PAGE_LINK_LIMIT,
  WEBVIEW_PAGE_OPERATION_TIMEOUT_MS,
  WEBVIEW_PAGE_SELECTED_TEXT_LIMIT,
  WEBVIEW_PAGE_SNAPSHOT_TIMEOUT_MS,
  WEBVIEW_PAGE_TEXT_LIMIT
} from '@/views/webview/web/automation/constants';

export { normalizeWebviewPageSnapshot } from '@/views/webview/web/automation/normalize';

export { createElementSelectionScript } from '@/views/webview/web/utils/elementPicker';

export type { WebviewElementPickerTheme, WebviewIpcMessageEvent } from '@/views/webview/web/utils/elementPicker';

/**
 * 默认 WebView 页面状态。
 */
const DEFAULT_STATE: WebviewPageState = {
  url: '',
  title: '',
  favicon: '',
  isLoading: false,
  isElementSelecting: false,
  isTouchSimulationEnabled: false,
  canGoBack: false,
  canGoForward: false,
  loadProgress: 0
};

/**
 * 默认 WebView Agent 活动状态。
 */
const DEFAULT_AGENT_ACTIVITY: WebviewAgentActivity = {
  phase: 'idle',
  label: '',
  startedAt: 0
};

/**
 * Agent 活动完成后保留视觉反馈的时长。
 */
const AGENT_ACTIVITY_CLEAR_DELAY_MS = 900;

/**
 * 元素选择器队列兜底通道的轮询间隔。
 */
const ELEMENT_PICKER_MESSAGE_DRAIN_INTERVAL_MS = 120;

/**
 * 当前有效 WebView Agent 快照。
 */
interface ActiveWebviewSnapshot {
  /** 快照 ID。 */
  id: string;
  /** 快照采集时页面地址。 */
  url: string;
  /** 快照中的元素身份信息。 */
  elements: ActiveWebviewSnapshotElement[];
}

/**
 * 判断错误是否为 Electron 导航被主动中断。
 * @param error - 原始加载错误
 * @returns 是否为可忽略的导航中断
 */
function isWebviewLoadAbortError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('ERR_ABORTED') || message.includes('(-3)');
}

/**
 * 处理 `<webview>.loadURL` 的异步加载错误。
 * @param error - 原始加载错误
 * @param url - 目标地址
 */
function handleWebviewLoadError(error: unknown, url: string): void {
  if (isWebviewLoadAbortError(error)) {
    return;
  }

  console.error(`Failed to load WebView URL ${url}:`, error);
}

/**
 * 读取 favicon 更新事件中的第一个有效 URL。
 * @param favicons - WebView 上报的 favicon URL 列表
 * @returns 第一个有效 favicon URL，缺失时返回空字符串
 */
function readFirstFavicon(favicons: string[]): string {
  return favicons.find((favicon) => favicon.trim())?.trim() ?? '';
}

/**
 * 判断值是否支持 Promise catch。
 * @param value - 待判断值
 * @returns 是否为可捕获加载结果
 */
function isCatchableLoadResult(value: unknown): value is { catch: (onRejected: (error: unknown) => void) => unknown } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return typeof (value as { catch?: unknown }).catch === 'function';
}

/**
 * 安全加载 WebView 地址，避免导航中断成为未捕获 Promise。
 * @param instance - WebView 实例
 * @param url - 目标地址
 */
function loadWebviewUrl(instance: WebviewTag, url: string): void {
  const { loadURL } = instance;
  if (typeof loadURL === 'function') {
    const loadResult: unknown = loadURL.call(instance, url);
    if (isCatchableLoadResult(loadResult)) {
      loadResult.catch((error: unknown) => handleWebviewLoadError(error, url));
    }
    return;
  }

  instance.setAttribute('src', url);
}

/**
 * 构建注入到页面内的 touch 事件模拟脚本。
 * @param enabled - 是否启用 touch 事件模拟
 * @returns 可通过 `executeJavaScript` 执行的脚本
 */
function createTouchSimulationScript(enabled: boolean): string {
  return `
(() => {
  const cleanupExisting = window.__tibisTouchSimulationCleanup;
  if (typeof cleanupExisting === 'function') {
    cleanupExisting();
  }

  if (!${enabled ? 'true' : 'false'}) {
    return null;
  }

  let activeTarget = null;

  const createTouchLike = (event) => ({
    identifier: 1,
    target: event.target,
    clientX: event.clientX,
    clientY: event.clientY,
    screenX: event.screenX,
    screenY: event.screenY,
    pageX: event.pageX,
    pageY: event.pageY,
    radiusX: 1,
    radiusY: 1,
    rotationAngle: 0,
    force: event.buttons ? 1 : 0
  });

  const dispatchTouchEvent = (mouseEvent, eventType) => {
    const target = activeTarget || mouseEvent.target;
    if (!(target instanceof EventTarget)) {
      return;
    }

    const touch = createTouchLike(mouseEvent);
    const event = new Event(eventType, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      touches: { value: eventType === 'touchend' ? [] : [touch] },
      targetTouches: { value: eventType === 'touchend' ? [] : [touch] },
      changedTouches: { value: [touch] },
      altKey: { value: mouseEvent.altKey },
      ctrlKey: { value: mouseEvent.ctrlKey },
      metaKey: { value: mouseEvent.metaKey },
      shiftKey: { value: mouseEvent.shiftKey }
    });
    target.dispatchEvent(event);
  };

  const handleMouseDown = (event) => {
    activeTarget = event.target;
    dispatchTouchEvent(event, 'touchstart');
  };

  const handleMouseMove = (event) => {
    if (!activeTarget || !event.buttons) {
      return;
    }

    dispatchTouchEvent(event, 'touchmove');
  };

  const handleMouseUp = (event) => {
    if (!activeTarget) {
      return;
    }

    dispatchTouchEvent(event, 'touchend');
    activeTarget = null;
  };

  try {
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 1 });
    Object.defineProperty(window, 'ontouchstart', { configurable: true, value: null });
  } catch (error) {
    console.warn('Tibis touch simulation environment patch failed', error);
  }

  window.addEventListener('mousedown', handleMouseDown, true);
  window.addEventListener('mousemove', handleMouseMove, true);
  window.addEventListener('mouseup', handleMouseUp, true);
  window.__tibisTouchSimulationCleanup = () => {
    window.removeEventListener('mousedown', handleMouseDown, true);
    window.removeEventListener('mousemove', handleMouseMove, true);
    window.removeEventListener('mouseup', handleMouseUp, true);
    delete window.__tibisTouchSimulationCleanup;
  };
  return null;
})();
`;
}

/**
 * 创建 `<webview>` 标签控制器。
 * @param webviewRef - `<webview>` 实例引用
 * @returns `<webview>` 控制器与事件处理器
 */
export function useWebView(webviewRef: Ref<WebviewTag | null>) {
  const state = ref<WebviewPageState>({ ...DEFAULT_STATE });
  const selectedElement = ref<WebviewElementSelection | null>(null);
  const agentActivity = ref<WebviewAgentActivity>({ ...DEFAULT_AGENT_ACTIVITY });
  let initialUrlAttached = false;
  let isDomReady = false;
  let pendingUserAgent = '';
  let pendingPageSnapshotRead: Promise<WebviewPageSnapshot> | null = null;
  let activeSnapshot: ActiveWebviewSnapshot | null = null;
  let agentActivityClearTimer: number | null = null;
  let elementPickerMessageDrainTimer: number | null = null;
  let isElementPickerMessageDraining = false;
  const handledElementPickerMessageIds = new Set<string>();

  /**
   * 读取 renderer 本地单调时间。
   * @returns 当前单调时间
   */
  function nowMs(): number {
    return globalThis.performance?.now?.() ?? Date.now();
  }

  /**
   * 创建页面快照 ID。
   * @returns 页面快照 ID
   */
  function createSnapshotId(): string {
    return `webview-snapshot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * 清理延迟隐藏 Agent 活动状态的定时器。
   */
  function clearAgentActivityTimer(): void {
    if (agentActivityClearTimer === null) {
      return;
    }

    window.clearTimeout(agentActivityClearTimer);
    agentActivityClearTimer = null;
  }

  /**
   * 读取元素选择器消息 ID。
   * @param payload - 元素选择器宿主消息
   * @returns 消息 ID，缺失时返回 null
   */
  function readElementPickerMessageId(payload: WebviewElementHostMessage): string | null {
    return typeof payload.messageId === 'string' ? payload.messageId : null;
  }

  /**
   * 判断元素选择器消息是否已经处理过。
   * @param payload - 元素选择器宿主消息
   * @returns 是否已处理
   */
  function isElementPickerMessageHandled(payload: WebviewElementHostMessage): boolean {
    const messageId = readElementPickerMessageId(payload);
    return Boolean(messageId && handledElementPickerMessageIds.has(messageId));
  }

  /**
   * 记录元素选择器消息已处理。
   * @param payload - 元素选择器宿主消息
   */
  function markElementPickerMessageHandled(payload: WebviewElementHostMessage): void {
    const messageId = readElementPickerMessageId(payload);
    if (!messageId) {
      return;
    }

    handledElementPickerMessageIds.add(messageId);
    if (handledElementPickerMessageIds.size > 500) {
      handledElementPickerMessageIds.clear();
    }
  }

  /**
   * 处理元素选择器宿主消息。
   * @param payload - 原始宿主消息
   */
  function handleElementPickerHostMessage(payload: unknown): void {
    if (!isWebviewElementHostMessage(payload) || isElementPickerMessageHandled(payload)) {
      return;
    }

    markElementPickerMessageHandled(payload);
    if (isElementSelection(payload.selection)) {
      selectedElement.value = normalizeElementSelection(payload.selection);
    }
  }

  /**
   * 停止元素选择器消息队列轮询。
   */
  function stopElementPickerMessageDrain(): void {
    if (elementPickerMessageDrainTimer === null) {
      return;
    }

    window.clearInterval(elementPickerMessageDrainTimer);
    elementPickerMessageDrainTimer = null;
  }

  /**
   * 从页面内消息队列读取元素选择器消息。
   * @param instance - `<webview>` 实例
   */
  async function drainElementPickerHostMessages(instance: WebviewTag): Promise<void> {
    const { executeJavaScript } = instance;
    if (isElementPickerMessageDraining || typeof executeJavaScript !== 'function') {
      return;
    }

    isElementPickerMessageDraining = true;
    try {
      const messages = (await executeJavaScript.call(instance, createDrainElementSelectionMessagesScript())) as unknown;
      if (Array.isArray(messages)) {
        messages.forEach((message) => handleElementPickerHostMessage(message));
      }
    } catch (error) {
      console.error('Failed to drain WebView element picker messages:', error);
    } finally {
      isElementPickerMessageDraining = false;
    }
  }

  /**
   * 启动元素选择器消息队列轮询兜底。
   * @param instance - `<webview>` 实例
   */
  function startElementPickerMessageDrain(instance: WebviewTag): void {
    stopElementPickerMessageDrain();
    handledElementPickerMessageIds.clear();
    elementPickerMessageDrainTimer = window.setInterval(() => {
      drainElementPickerHostMessages(instance).catch((error: unknown) => {
        console.error('Failed to schedule WebView element picker message drain:', error);
      });
    }, ELEMENT_PICKER_MESSAGE_DRAIN_INTERVAL_MS);
  }

  /**
   * 开始展示 Agent 活动反馈。
   * @param phase - 活动阶段
   * @param label - 状态文案
   */
  function startAgentActivity(phase: Extract<WebviewAgentActivityPhase, 'reading' | 'operating'>, label: string): void {
    clearAgentActivityTimer();
    agentActivity.value = {
      phase,
      label,
      startedAt: nowMs()
    };
  }

  /**
   * 完成 Agent 活动反馈，并短暂保留完成状态。
   * @param phase - 完成阶段
   * @param label - 状态文案
   */
  function finishAgentActivity(phase: Extract<WebviewAgentActivityPhase, 'success' | 'error'>, label: string): void {
    const finishedAt = nowMs();
    agentActivity.value = {
      phase,
      label,
      startedAt: agentActivity.value.startedAt || finishedAt,
      finishedAt
    };
    clearAgentActivityTimer();
    agentActivityClearTimer = window.setTimeout(() => {
      agentActivity.value = { ...DEFAULT_AGENT_ACTIVITY };
      agentActivityClearTimer = null;
    }, AGENT_ACTIVITY_CLEAR_DELAY_MS);
  }

  /**
   * 首次把初始 URL 附着到 `<webview>` 实例。
   * 同一个实例重复激活时不应再次触发加载。
   * @param initialUrl - 初始 URL
   */
  function attachInitialUrl(initialUrl: string): void {
    if (initialUrlAttached || !initialUrl) {
      return;
    }

    webviewRef.value?.setAttribute('src', initialUrl);
    initialUrlAttached = true;
  }

  /**
   * 从当前 `<webview>` 实例同步导航状态。
   */
  function syncNavigationState(): void {
    const instance = webviewRef.value;
    if (!instance) {
      return;
    }

    state.value.canGoBack = instance.canGoBack();
    state.value.canGoForward = instance.canGoForward();
  }

  /**
   * 初始化 `<webview>` 地址。
   * @param initialUrl - 初始 URL
   */
  function create(initialUrl: string): void {
    state.value.url = initialUrl;
  }

  /**
   * 导航到新地址。
   * @param url - 目标 URL
   */
  function navigate(url: string): void {
    state.value.url = url;
    if (!webviewRef.value) {
      return;
    }

    if (isDomReady) {
      loadWebviewUrl(webviewRef.value, url);
      return;
    }

    webviewRef.value.setAttribute('src', url);
  }

  /**
   * 后退。
   */
  function goBack(): void {
    webviewRef.value?.goBack();
    syncNavigationState();
  }

  /**
   * 前进。
   */
  function goForward(): void {
    webviewRef.value?.goForward();
    syncNavigationState();
  }

  /**
   * 刷新当前页面。
   */
  function reload(): void {
    webviewRef.value?.reload();
  }

  /**
   * 停止当前加载。
   */
  function stop(): void {
    webviewRef.value?.stop();
  }

  /**
   * 打开当前 `<webview>` 页面开发者工具。
   */
  function openDevTools(): void {
    const instance = webviewRef.value;
    const open = instance?.openDevTools;
    if (!instance || typeof open !== 'function') {
      return;
    }

    const isOpened = instance.isDevToolsOpened;
    const close = instance.closeDevTools;
    if (typeof isOpened === 'function' && isOpened.call(instance) && typeof close === 'function') {
      close.call(instance);
    }

    open.call(instance);
  }

  /**
   * 读取当前网页快照。
   * @param signal - Runtime 中断信号
   * @returns 当前网页快照
   */
  async function readPageSnapshot(signal?: AbortSignal): Promise<WebviewPageSnapshot> {
    if (signal?.aborted) {
      throw createWebviewOperationError('RUNTIME_INTERRUPTED');
    }
    if (state.value.isLoading) {
      throw new Error('当前页面正在导航，请稍后重试');
    }

    if (pendingPageSnapshotRead) {
      return withWebviewAbort(pendingPageSnapshotRead, signal);
    }

    const instance = webviewRef.value;
    const executeJavaScript = instance?.executeJavaScript;
    if (!instance || typeof executeJavaScript !== 'function') {
      throw new Error('当前页面尚未准备好读取，请稍后重试');
    }

    startAgentActivity('reading', '正在读取网页');
    let rawRead: Promise<unknown>;
    try {
      rawRead = executeJavaScript.call(instance, createPageSnapshotScript()) as Promise<unknown>;
    } catch (error: unknown) {
      finishAgentActivity('error', '读取失败');
      throw normalizeWebviewPageReadError(error);
    }

    pendingPageSnapshotRead = withWebviewPageReadTimeout(
      rawRead.then((value: unknown) => {
        if (!isWebviewPageSnapshot(value)) {
          throw new Error('页面快照格式无效');
        }

        const snapshotId = typeof value.snapshotId === 'string' && value.snapshotId ? value.snapshotId : createSnapshotId();
        const snapshot = normalizeWebviewPageSnapshot({ ...value, snapshotId });
        const selectedElementSnapshot = createSelectedElementSnapshot(selectedElement.value, snapshot.elements);
        const snapshotWithSelection = selectedElementSnapshot ? { ...snapshot, selectedElement: selectedElementSnapshot } : snapshot;
        activeSnapshot = { id: snapshotId, url: snapshot.url, elements: createActiveSnapshotElements(snapshot.elements) };
        return createPublicWebviewPageSnapshot(snapshotWithSelection);
      })
    )
      .then((snapshot: WebviewPageSnapshot) => {
        finishAgentActivity('success', '读取完成');
        return snapshot;
      })
      .catch((error: unknown) => {
        finishAgentActivity('error', '读取失败');
        throw normalizeWebviewPageReadError(error);
      })
      .finally(() => {
        pendingPageSnapshotRead = null;
      });

    return withWebviewAbort(pendingPageSnapshotRead, signal);
  }

  /**
   * 操作当前网页。
   * @param input - WebView 操作输入
   * @param signal - Runtime 中断信号
   * @returns WebView 操作结果
   */
  async function operatePage(input: WebviewOperateInput, signal?: AbortSignal): Promise<WebviewOperateResult> {
    if (signal?.aborted) {
      throw createWebviewOperationError('RUNTIME_INTERRUPTED');
    }
    const instance = webviewRef.value;
    const executeJavaScript = instance?.executeJavaScript;
    if (!instance || typeof executeJavaScript !== 'function') {
      throw createWebviewOperationError('EDITOR_UNAVAILABLE');
    }

    if (input.action.type === 'navigate') {
      startAgentActivity('operating', '正在操作网页');
      try {
        const targetUrl = normalizeWebviewUrl(input.action.url);
        state.value.url = targetUrl;
        activeSnapshot = null;
        loadWebviewUrl(instance, targetUrl);

        const result: WebviewOperateResult = {
          ok: true,
          action: 'navigate',
          target: null,
          message: `navigating to ${targetUrl}`,
          navigationStarted: true,
          pageChanged: true,
          shouldReadAgain: true
        };
        finishAgentActivity('success', '操作完成');
        return result;
      } catch {
        finishAgentActivity('error', '操作失败');
        throw createWebviewOperationError('INVALID_INPUT', '网页地址无效，仅支持 http/https');
      }
    }

    if (!input.snapshotId || !activeSnapshot || activeSnapshot.id !== input.snapshotId) {
      throw createWebviewOperationError('STALE_SNAPSHOT');
    }

    if (state.value.url && state.value.url !== activeSnapshot.url) {
      throw createWebviewOperationError('STALE_SNAPSHOT');
    }

    if (state.value.isLoading && input.action.type !== 'wait') {
      throw createWebviewOperationError('PAGE_LOADING');
    }

    startAgentActivity('operating', '正在操作网页');
    try {
      const rawOperation = executeJavaScript.call(instance, createPageOperationScript(input, activeSnapshot.elements)) as Promise<unknown>;
      const result = await withWebviewAbort(withWebviewPageOperationTimeout(rawOperation), signal);
      if (!isWebviewOperateResult(result)) {
        throw createWebviewOperationError('EXECUTION_FAILED', '页面操作结果格式无效');
      }

      finishAgentActivity('success', '操作完成');
      return result;
    } catch (error) {
      finishAgentActivity('error', '操作失败');
      throw normalizeWebviewPageOperationError(error);
    }
  }

  /**
   * 应用 touch 事件模拟状态到当前页面。
   * @param enabled - 是否启用 touch 事件模拟
   */
  async function applyTouchSimulation(enabled: boolean): Promise<void> {
    const instance = webviewRef.value;
    const executeJavaScript = instance?.executeJavaScript;
    if (!instance || typeof executeJavaScript !== 'function') {
      return;
    }

    await executeJavaScript.call(instance, createTouchSimulationScript(enabled));
  }

  /**
   * 设置 touch 事件模拟状态。
   * @param enabled - 是否启用 touch 事件模拟
   */
  async function setTouchSimulationEnabled(enabled: boolean): Promise<void> {
    state.value.isTouchSimulationEnabled = enabled;
    await applyTouchSimulation(enabled);
  }

  /**
   * 设置当前 `<webview>` 的 User-Agent，空字符串表示恢复默认 UA。
   * `dom-ready` 前通过 `setAttribute` 设置 HTML 属性，`dom-ready` 后通过 API 动态设置。
   * @param userAgent - 目标 User-Agent
   */
  function setUserAgent(userAgent: string): void {
    const instance = webviewRef.value;
    if (!instance) {
      return;
    }

    if (!userAgent) {
      instance.removeAttribute('useragent');
    }

    pendingUserAgent = userAgent;

    if (!isDomReady) {
      instance.setAttribute('useragent', userAgent);
      return;
    }

    instance.setUserAgent(userAgent);
  }

  /**
   * 开启页面 DOM 元素持续选择模式。
   * @param theme - 元素选择器主题
   */
  async function startElementSelection(theme: WebviewElementPickerTheme = DEFAULT_ELEMENT_PICKER_THEME): Promise<void> {
    const instance = webviewRef.value;
    if (!instance || state.value.isElementSelecting) {
      return;
    }

    state.value.isElementSelecting = true;
    startElementPickerMessageDrain(instance);
    try {
      const result = await instance.executeJavaScript(createElementSelectionScript(theme));
      if (isElementSelection(result)) {
        selectedElement.value = normalizeElementSelection(result);
      }
    } finally {
      stopElementPickerMessageDrain();
      state.value.isElementSelecting = false;
    }
  }

  /**
   * 停止页面 DOM 元素持续选择模式。
   */
  async function stopElementSelection(): Promise<void> {
    const instance = webviewRef.value;
    const executeJavaScript = instance?.executeJavaScript;
    stopElementPickerMessageDrain();
    state.value.isElementSelecting = false;
    if (!instance || typeof executeJavaScript !== 'function') {
      return;
    }

    await executeJavaScript.call(instance, createStopElementSelectionScript());
  }

  /**
   * 清空当前 DOM 检查结果。
   */
  function clearSelectedElement(): void {
    selectedElement.value = null;
  }

  /**
   * 处理 WebView preload 转发的 DOM 元素选择器消息。
   * @param event - WebView ipc-message 事件
   */
  function handleIpcMessage(event: Event | WebviewIpcMessageEvent): void {
    if (!isWebviewIpcMessageEvent(event)) {
      return;
    }

    const [payload] = event.args;
    handleElementPickerHostMessage(payload);
  }

  /**
   * 处理开始加载事件。
   */
  function handleDidStartLoading(): void {
    state.value.isLoading = true;
    state.value.isElementSelecting = false;
    state.value.loadProgress = 0.1;
    state.value.favicon = '';
    selectedElement.value = null;
  }

  /**
   * 处理 DOM 就绪事件。
   */
  function handleDomReady(): void {
    isDomReady = true;
    state.value.loadProgress = 0.7;
    syncNavigationState();
    applyTouchSimulation(state.value.isTouchSimulationEnabled).catch((error: unknown) => {
      console.error('Failed to apply webview touch simulation after DOM ready:', error);
    });
    if (pendingUserAgent) {
      webviewRef.value?.setUserAgent(pendingUserAgent);
    }
  }

  /**
   * 处理导航事件。
   * @param event - 导航事件
   */
  function handleDidNavigate(event: DidNavigateEvent): void {
    const shouldInvalidateSnapshot = !activeSnapshot || activeSnapshot.url !== event.url;
    state.value.url = event.url;
    if (shouldInvalidateSnapshot) {
      activeSnapshot = null;
      selectedElement.value = null;
    }
    syncNavigationState();
  }

  /**
   * 处理标题更新事件。
   * @param event - 标题事件
   */
  function handleTitleUpdated(event: PageTitleUpdatedEvent): void {
    state.value.title = event.title;
  }

  /**
   * 处理页面 favicon 更新事件。
   * @param event - favicon 更新事件
   */
  function handleFaviconUpdated(event: PageFaviconUpdatedEvent): void {
    const favicon = readFirstFavicon(event.favicons);
    if (!favicon) {
      return;
    }

    state.value.favicon = favicon;
  }

  /**
   * 处理停止加载事件。
   */
  function handleDidStopLoading(): void {
    state.value.isLoading = false;
    state.value.loadProgress = 1;
    syncNavigationState();
  }

  /**
   * 处理宿主拒绝附加 `<webview>` 的事件。
   * @param payload - 拒绝信息
   */
  function handleAttachRejected(payload: { src: string; reason: string }): void {
    state.value.isLoading = false;
    console.error(`Webview attach rejected for ${payload.src}: ${payload.reason}`);
  }

  const controller: WebviewController = {
    state,
    create,
    navigate,
    goBack,
    goForward,
    reload,
    stop,
    openDevTools
  };

  return {
    ...controller,
    get selectedElement() {
      return selectedElement.value;
    },
    selectedElementRef: selectedElement,
    agentActivity,

    attachInitialUrl,
    handleDidStartLoading,
    handleDomReady,
    handleDidNavigate,
    handleTitleUpdated,
    handleFaviconUpdated,
    handleDidStopLoading,
    handleAttachRejected,
    handleIpcMessage,
    startElementSelection,
    stopElementSelection,
    clearSelectedElement,
    readPageSnapshot,
    operatePage,
    setTouchSimulationEnabled,
    setUserAgent
  };
}

/**
 * 兼容旧测试与旧调用方的 `<webview>` 控制器命名。
 */
export const useTagWebView = useWebView;
