/**
 * @file web-use-webview.test.ts
 * @description 验证 WebView 标签控制器行为。
 * @vitest-environment jsdom
 */
import { Script, createContext } from 'node:vm';
import type { DidNavigateEvent, DidStartNavigationEvent, PageFaviconUpdatedEvent, WebviewTag } from 'electron';
import { effectScope, ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElementSelectionScript, normalizeWebviewPageSnapshot, useWebView } from '@/views/webview/web/hooks/useWebView';
import { TIBIS_WEBVIEW_HOST_CHANNEL } from '../../../shared/webview/host-bridge';

/**
 * 测试环境中注入的元素选择清理函数。
 */
interface WindowWithElementPickerCleanup extends Window {
  /** 清理页面元素选择器 */
  __tibisElementPickerCleanup?: () => void;
  /** WebView preload 暴露给页面脚本的宿主消息桥 */
  __tibisWebviewHost?: {
    /** 向宿主页面发送消息 */
    postMessage: (channel: string, payload: unknown) => void;
  };
}

/**
 * 测试用开发者工具方法集合。
 */
interface TestDevToolsWebview {
  /** 打开开发者工具。 */
  openDevTools: () => void;
  /** 关闭开发者工具。 */
  closeDevTools: () => void;
  /** 开发者工具是否已打开。 */
  isDevToolsOpened: () => boolean;
}

/**
 * 测试中手动推进的 Promise。
 */
interface Deferred<T> {
  /** Promise 实例。 */
  promise: Promise<T>;
  /** 将 Promise 标记为成功。 */
  resolve: (value: T | PromiseLike<T>) => void;
  /** 将 Promise 标记为失败。 */
  reject: (reason?: unknown) => void;
}

/**
 * 测试用 WebView 宿主消息。
 */
interface TestWebviewHostMessage {
  /** 消息通道。 */
  channel: string;
  /** 消息负载。 */
  payload: unknown;
}

/** 原始 scrollIntoView 实现，测试后恢复。 */
const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView;

/**
 * 创建可观测 catch 绑定的 loadURL 结果。
 * @returns loadURL 结果与 catch spy
 */
function createCatchableLoadResult(): { promise: Promise<void>; catchSpy: ReturnType<typeof vi.fn<(_handler: (error: unknown) => void) => Promise<void>>> } {
  const catchSpy = vi.fn<(_handler: (error: unknown) => void) => Promise<void>>(() => Promise.resolve());
  return { promise: { catch: catchSpy } as unknown as Promise<void>, catchSpy };
}

/**
 * 创建测试用 WebView 元素。
 * @param isOpened - 开发者工具是否已打开
 * @returns 带开发者工具方法的 WebView 元素
 */
function createDevToolsWebview(isOpened: boolean): WebviewTag & TestDevToolsWebview {
  const element = document.createElement('webview') as unknown as WebviewTag & TestDevToolsWebview;
  element.openDevTools = vi.fn();
  element.closeDevTools = vi.fn();
  element.isDevToolsOpened = vi.fn(() => isOpened);
  return element;
}

/**
 * 创建可执行脚本的 WebView 测试替身。
 * @param results - executeJavaScript 依次产出的结果
 * @returns WebView 测试替身
 */
function createScriptableWebview(results: unknown[]): WebviewTag {
  const element = document.createElement('webview') as unknown as WebviewTag;
  const pendingResults = [...results];
  element.executeJavaScript = vi.fn().mockImplementation((): Promise<unknown> => {
    const nextResult = pendingResults.shift() ?? null;
    if (nextResult instanceof Error) {
      return Promise.reject(nextResult);
    }

    return Promise.resolve(nextResult);
  });
  return element;
}

/**
 * 创建测试中可手动完成的 Promise。
 * @returns Promise 与 resolve/reject 控制函数
 */
function createDeferred<T>(): Deferred<T> {
  let resolveDeferred: Deferred<T>['resolve'] | undefined;
  let rejectDeferred: Deferred<T>['reject'] | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  if (!resolveDeferred || !rejectDeferred) {
    throw new Error('deferred promise should initialize callbacks');
  }

  return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

/**
 * 创建测试用原始网页快照。
 * @param snapshotId - 快照 ID
 * @returns 原始快照对象
 */
function createRawPageSnapshot(snapshotId = 'snap-1'): unknown {
  return {
    url: 'https://example.com',
    title: 'Example',
    text: 'Hello',
    selectedText: '',
    headings: [],
    links: [],
    snapshotId,
    loading: false,
    scroll: {
      x: 0,
      y: 0,
      viewportWidth: 800,
      viewportHeight: 600,
      scrollWidth: 800,
      scrollHeight: 1200,
      atTop: true,
      atBottom: false
    },
    elements: [{ index: 1, tagName: 'BUTTON', text: 'Search', label: 'Search', disabled: false, isNew: true, actions: ['click'] }]
  };
}

/**
 * 创建第二次调用会执行页面脚本的 WebView 测试替身。
 * @param snapshot - 第一次读取快照的数据
 * @returns WebView 测试替身
 */
function createPageOperationExecutingWebview(snapshot: unknown): WebviewTag {
  const element = document.createElement('webview') as unknown as WebviewTag;
  let callCount = 0;
  element.executeJavaScript = vi.fn((script: string): Promise<unknown> => {
    callCount += 1;
    if (callCount === 1) return Promise.resolve(snapshot);

    const scriptContext = createContext({
      window,
      document,
      console,
      Error,
      Event: window.Event,
      HTMLAnchorElement: window.HTMLAnchorElement,
      HTMLFormElement: window.HTMLFormElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLElement: window.HTMLElement,
      HTMLSelectElement: window.HTMLSelectElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      InputEvent: window.InputEvent,
      KeyboardEvent: window.KeyboardEvent,
      MouseEvent: window.MouseEvent,
      PointerEvent: window.PointerEvent,
      Promise
    });
    return new Script(script).runInContext(scriptContext) as Promise<unknown>;
  });
  return element;
}

/**
 * 创建会在 jsdom 页面中执行脚本的 WebView 测试替身。
 * @returns WebView 测试替身
 */
function createPageScriptExecutingWebview(): WebviewTag {
  const element = document.createElement('webview') as unknown as WebviewTag;
  element.executeJavaScript = vi.fn((script: string): Promise<unknown> => {
    const scriptContext = createContext({
      window,
      document,
      console,
      location: window.location,
      Error,
      Event: window.Event,
      HTMLAnchorElement: window.HTMLAnchorElement,
      HTMLInputElement: window.HTMLInputElement,
      HTMLElement: window.HTMLElement,
      HTMLOptionElement: window.HTMLOptionElement,
      HTMLSelectElement: window.HTMLSelectElement,
      HTMLTextAreaElement: window.HTMLTextAreaElement,
      InputEvent: window.InputEvent,
      MouseEvent: window.MouseEvent,
      PointerEvent: window.PointerEvent,
      Promise
    });
    return Promise.resolve(new Script(script).runInContext(scriptContext));
  });
  return element;
}

/**
 * 创建会在指定 VM 上下文中执行脚本的 WebView 测试替身。
 * @param scriptContext - 页面脚本执行上下文
 * @returns WebView 测试替身
 */
function createVmScriptExecutingWebview(scriptContext: ReturnType<typeof createContext>): WebviewTag {
  const element = document.createElement('webview') as unknown as WebviewTag;
  element.executeJavaScript = vi.fn((script: string): Promise<unknown> => Promise.resolve(new Script(script).runInContext(scriptContext)));
  return element;
}

/**
 * 创建 WebView favicon 更新事件。
 * @param favicons - favicon URL 列表
 * @returns favicon 更新事件
 */
function createFaviconUpdatedEvent(favicons: string[]): PageFaviconUpdatedEvent {
  const event = new Event('page-favicon-updated') as PageFaviconUpdatedEvent;
  Object.defineProperty(event, 'favicons', { value: favicons });
  return event;
}

/**
 * 设置元素在 jsdom 中的视口矩形。
 * @param element - 目标元素
 * @param rect - 视口矩形
 */
function installElementRect(element: HTMLElement, rect: { x: number; y: number; width: number; height: number }): void {
  element.getBoundingClientRect = vi.fn(
    (): DOMRect =>
      ({
        x: rect.x,
        y: rect.y,
        top: rect.y,
        left: rect.x,
        right: rect.x + rect.width,
        bottom: rect.y + rect.height,
        width: rect.width,
        height: rect.height,
        toJSON: () => ({})
      } as DOMRect)
  );
}

/**
 * 设置元素在 jsdom 中可见。
 * @param element - 目标元素
 */
function installVisibleRect(element: HTMLElement): void {
  installElementRect(element, { x: 0, y: 0, width: 120, height: 32 });
}

/**
 * 给 jsdom 元素安装可滚动尺寸和 scrollBy 行为。
 * @param element - 目标元素
 * @param metrics - 滚动尺寸
 */
function installScrollableElementMetrics(
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; clientWidth: number; scrollWidth: number }
): void {
  let scrollTop = 0;
  let scrollLeft = 0;
  Object.defineProperties(element, {
    clientHeight: { configurable: true, get: () => metrics.clientHeight },
    scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
    clientWidth: { configurable: true, get: () => metrics.clientWidth },
    scrollWidth: { configurable: true, get: () => metrics.scrollWidth },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(value, Math.max(metrics.scrollHeight - metrics.clientHeight, 0)));
      }
    },
    scrollLeft: {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = Math.max(0, Math.min(value, Math.max(metrics.scrollWidth - metrics.clientWidth, 0)));
      }
    },
    scrollBy: {
      configurable: true,
      value: (options: ScrollToOptions): void => {
        element.scrollTop += Number(options.top || 0);
        element.scrollLeft += Number(options.left || 0);
      }
    }
  });
}

/**
 * 安装测试用 WebView 宿主消息桥。
 * @returns 已收集的宿主消息列表
 */
function installWebviewHostBridge(): TestWebviewHostMessage[] {
  const messages: TestWebviewHostMessage[] = [];
  (window as WindowWithElementPickerCleanup).__tibisWebviewHost = {
    postMessage: (channel: string, payload: unknown): void => {
      messages.push({ channel, payload });
    }
  };
  return messages;
}

/**
 * 判断值是否为元素选择宿主消息。
 * @param entry - 宿主消息
 * @returns 是否为元素选择宿主消息
 */
function isSelectionHostMessage(
  entry: TestWebviewHostMessage
): entry is TestWebviewHostMessage & { payload: { kind: string; selection?: { selector?: string; text?: string } } } {
  return (
    entry.channel === TIBIS_WEBVIEW_HOST_CHANNEL &&
    typeof entry.payload === 'object' &&
    entry.payload !== null &&
    'kind' in entry.payload &&
    entry.payload.kind === 'element-picker-selection'
  );
}

/**
 * 读取最近一次元素选择消息。
 * @param messages - WebView 宿主消息列表
 * @returns 元素选择消息负载
 */
function readLastSelectionMessage(messages: TestWebviewHostMessage[]): { kind: string; selection?: { selector?: string; text?: string } } {
  const message = messages.findLast(isSelectionHostMessage);
  if (!message) {
    throw new Error('selection host message should be posted');
  }

  return message.payload;
}

describe('useWebView', () => {
  afterEach((): void => {
    (window as WindowWithElementPickerCleanup).__tibisElementPickerCleanup?.();
    delete (window as WindowWithElementPickerCleanup).__tibisWebviewHost;
    document.body.innerHTML = '';
    document.documentElement.scrollLeft = 0;
    document.documentElement.scrollTop = 0;
    document.body.scrollLeft = 0;
    document.body.scrollTop = 0;
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: originalScrollIntoView
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('reopens devtools when debug action is triggered after devtools was already opened', (): void => {
    const element = createDevToolsWebview(true);
    const controller = useWebView(ref<WebviewTag | null>(element));
    const { openDevTools } = controller;

    if (typeof openDevTools !== 'function') {
      throw new Error('openDevTools should be available on web webview controller');
    }

    openDevTools();

    expect(element.closeDevTools).toHaveBeenCalledTimes(1);
    expect(element.openDevTools).toHaveBeenCalledTimes(1);
  });

  it('stores the first favicon URL from page favicon updates', (): void => {
    const controller = useWebView(ref<WebviewTag | null>(null));

    controller.handleFaviconUpdated(createFaviconUpdatedEvent(['', 'https://example.com/favicon.ico']));

    expect(controller.state.value.favicon).toBe('https://example.com/favicon.ico');
  });

  it('builds a unique selector for repeated sibling elements', (): void => {
    document.body.innerHTML = `
      <ul class="article-list">
        <li class="article-item"><span>第一条</span></li>
        <li class="article-item"><span>第七条</span></li>
      </ul>
    `;
    const hostMessages = installWebviewHostBridge();
    const secondItem = document.querySelectorAll('.article-item')[1];

    if (!(secondItem instanceof HTMLElement)) {
      throw new Error('second item should exist');
    }

    const scriptContext = createContext({
      window,
      document,
      console,
      Element: window.Element,
      HTMLElement: window.HTMLElement,
      Promise,
      requestAnimationFrame: window.requestAnimationFrame.bind(window)
    });
    new Script(createElementSelectionScript()).runInContext(scriptContext);
    secondItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    (window as WindowWithElementPickerCleanup).__tibisElementPickerCleanup?.();

    const { selection } = readLastSelectionMessage(hostMessages);

    expect(selection?.selector).not.toBe('li.article-item');
    expect(document.querySelector(selection?.selector ?? '')).toBe(secondItem);
  });

  it('keeps building selector path when duplicate ids are present', (): void => {
    document.body.innerHTML = `
      <section class="article-section">
        <article id="article-card" class="article-item"><span>第一条</span></article>
      </section>
      <section class="article-section">
        <article id="article-card" class="article-item"><span>第七条</span></article>
      </section>
    `;
    const hostMessages = installWebviewHostBridge();
    const seventhItem = document.querySelectorAll('#article-card')[1];

    if (!(seventhItem instanceof HTMLElement)) {
      throw new Error('seventh item should exist');
    }

    const scriptContext = createContext({
      window,
      document,
      console,
      Element: window.Element,
      HTMLElement: window.HTMLElement,
      Promise,
      requestAnimationFrame: window.requestAnimationFrame.bind(window)
    });
    new Script(createElementSelectionScript()).runInContext(scriptContext);
    seventhItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    (window as WindowWithElementPickerCleanup).__tibisElementPickerCleanup?.();

    const { selection } = readLastSelectionMessage(hostMessages);

    expect(selection?.selector).not.toBe('article#article-card');
    expect(document.querySelector(selection?.selector ?? '')).toBe(seventhItem);
  });

  it('adds sibling position when duplicate ids share the same parent', (): void => {
    document.body.innerHTML = `
      <section class="article-section">
        <article id="article-card" class="article-item"><span>第一条</span></article>
        <article id="article-card" class="article-item"><span>第七条</span></article>
      </section>
    `;
    const hostMessages = installWebviewHostBridge();
    const seventhItem = document.querySelectorAll('#article-card')[1];

    if (!(seventhItem instanceof HTMLElement)) {
      throw new Error('seventh item should exist');
    }

    const scriptContext = createContext({
      window,
      document,
      console,
      Element: window.Element,
      HTMLElement: window.HTMLElement,
      Promise,
      requestAnimationFrame: window.requestAnimationFrame.bind(window)
    });
    new Script(createElementSelectionScript()).runInContext(scriptContext);
    seventhItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    (window as WindowWithElementPickerCleanup).__tibisElementPickerCleanup?.();

    const { selection } = readLastSelectionMessage(hostMessages);

    expect(selection?.selector).toContain(':nth-of-type(2)');
    expect(document.querySelector(selection?.selector ?? '')).toBe(seventhItem);
  });

  it('prefers selected element visible text over ancestor accessible labels', (): void => {
    document.body.innerHTML = `
      <section class="plan-row" aria-label="4 / 7">
        <div class="plan-column-title">较去年人数变化</div>
      </section>
    `;
    const hostMessages = installWebviewHostBridge();
    const columnTitle = document.querySelector('.plan-column-title');

    if (!(columnTitle instanceof HTMLElement)) {
      throw new Error('column title should exist');
    }

    const scriptContext = createContext({
      window,
      document,
      console,
      Element: window.Element,
      HTMLElement: window.HTMLElement,
      Promise,
      requestAnimationFrame: window.requestAnimationFrame.bind(window)
    });
    new Script(createElementSelectionScript()).runInContext(scriptContext);
    columnTitle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    (window as WindowWithElementPickerCleanup).__tibisElementPickerCleanup?.();

    const { selection } = readLastSelectionMessage(hostMessages);

    expect(selection?.text).toBe('较去年人数变化');
  });

  it('keeps selected element highlight without rendering the removed floating toolbar', (): void => {
    document.body.innerHTML = `
      <section class="article-section">
        <article class="article-item"><span>第七条</span></article>
      </section>
    `;
    const item = document.querySelector('.article-item');
    const hostMessages = installWebviewHostBridge();

    if (!(item instanceof HTMLElement)) {
      throw new Error('item should exist');
    }

    installElementRect(item, { x: 200, y: 80, width: 260, height: 48 });

    const scriptContext = createContext({
      window,
      document,
      console,
      Element: window.Element,
      HTMLElement: window.HTMLElement,
      Promise,
      requestAnimationFrame: window.requestAnimationFrame.bind(window)
    });
    new Script(
      createElementSelectionScript({
        color: '#123456',
        background: '#eaf2ff',
        border: '#789abc',
        borderWidth: '2px',
        surfaceRadius: '0px'
      })
    ).runInContext(scriptContext);
    item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const selectedHighlight = document.querySelector('.tibis-element-picker-selected');
    const toolbar = document.querySelector('.tibis-element-picker-toolbar');
    const tagName = document.querySelector('.tibis-element-picker-toolbar__tag');
    const captureButton = document.querySelector('[data-tibis-element-picker-action="capture-selected-element-screenshot"]');
    const pickerStyle = Array.from(document.querySelectorAll('style'))
      .map((style) => style.textContent ?? '')
      .find((content) => content.includes('.tibis-element-picker-selected'));
    (window as WindowWithElementPickerCleanup).__tibisElementPickerCleanup?.();

    expect(selectedHighlight).toBeInstanceOf(HTMLElement);
    expect((selectedHighlight as HTMLElement).style.left).toBe('200px');
    expect((selectedHighlight as HTMLElement).style.top).toBe('80px');
    expect(toolbar).toBeNull();
    expect(tagName).toBeNull();
    expect(captureButton).toBeNull();
    expect(pickerStyle).toContain('.tibis-element-picker-selected{position:fixed;');
    expect(pickerStyle).not.toContain('.tibis-element-picker-toolbar');
    expect(
      hostMessages.some(
        (entry) =>
          entry.channel === TIBIS_WEBVIEW_HOST_CHANNEL &&
          typeof entry.payload === 'object' &&
          entry.payload !== null &&
          'kind' in entry.payload &&
          entry.payload.kind === 'element-picker-action'
      )
    ).toBe(false);
  });

  it('drains selected element messages when the preload bridge is unavailable', async (): Promise<void> => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="primary-button">主操作</button>';
    const button = document.querySelector('#primary-button');

    if (!(button instanceof HTMLElement)) {
      throw new Error('button should exist');
    }

    installElementRect(button, { x: 20, y: 30, width: 120, height: 40 });

    const scriptContext = createContext({
      window,
      document,
      console,
      Element: window.Element,
      HTMLElement: window.HTMLElement,
      Promise,
      requestAnimationFrame: window.requestAnimationFrame.bind(window)
    });
    const webviewElement = createVmScriptExecutingWebview(scriptContext);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const selectionTask = controller.startElementSelection();

    await Promise.resolve();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(160);

    expect(controller.selectedElement?.selector).toBe('button#primary-button');
    expect(document.querySelector('.tibis-element-picker-toolbar')).toBeNull();

    await controller.stopElementSelection();
    await selectionTask;
  });

  it('normalizes webpage agent snapshot fields', (): void => {
    const snapshot = normalizeWebviewPageSnapshot({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      scroll: {
        x: 0,
        y: 0,
        viewportWidth: 800,
        viewportHeight: 600,
        scrollWidth: 800,
        scrollHeight: 1200,
        atTop: true,
        atBottom: false
      },
      elements: [{ index: 1, tagName: 'BUTTON', text: 'Search', label: 'Search', disabled: false, isNew: true, actions: ['click'] }]
    });

    expect(snapshot.snapshotId).toBe('snap-1');
    expect(snapshot.scroll).toMatchObject({ viewportWidth: 800, scrollHeight: 1200 });
    expect(snapshot.elements?.[0]).toMatchObject({ index: 1, label: 'Search', actions: ['click'] });
  });

  it('shows webpage agent read activity while a snapshot is pending', async (): Promise<void> => {
    const deferredSnapshot = createDeferred<unknown>();
    const webviewElement = createScriptableWebview([]);
    webviewElement.executeJavaScript = vi.fn(() => deferredSnapshot.promise);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));

    const readPromise = controller.readPageSnapshot();

    expect(controller.agentActivity.value).toMatchObject({ phase: 'reading', label: '正在读取网页' });

    deferredSnapshot.resolve(createRawPageSnapshot());
    await expect(readPromise).resolves.toMatchObject({ snapshotId: 'snap-1' });
    expect(controller.agentActivity.value).toMatchObject({ phase: 'success', label: '读取完成' });
  });

  it('rejects page operations while a snapshot read is pending', async (): Promise<void> => {
    const deferredSnapshot = createDeferred<unknown>();
    const webviewElement = createScriptableWebview([deferredSnapshot.promise]);
    webviewElement.loadURL = vi.fn();
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));

    const readPromise = controller.readPageSnapshot();
    const navigation = controller.operatePage({ action: { type: 'navigate', url: 'https://example.org' } });
    deferredSnapshot.resolve(createRawPageSnapshot());

    await expect(navigation).rejects.toMatchObject({ code: 'PAGE_LOADING' });
    await expect(readPromise).resolves.toMatchObject({ snapshotId: 'snap-1' });
    expect(webviewElement.loadURL).not.toHaveBeenCalled();
  });

  it('rejects a late snapshot read after main-frame navigation invalidates it', async (): Promise<void> => {
    const deferredSnapshot = createDeferred<unknown>();
    const webviewElement = createScriptableWebview([deferredSnapshot.promise]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));

    const readPromise = controller.readPageSnapshot();
    controller.handleDidStartNavigation({ url: 'https://example.org', isMainFrame: true, isInPlace: false } as DidStartNavigationEvent);
    deferredSnapshot.resolve(createRawPageSnapshot());

    await expect(readPromise).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
  });

  it('clears internal activity and picker timers when the owning scope stops', async (): Promise<void> => {
    vi.useFakeTimers();
    const deferredSelection = createDeferred<unknown>();
    const webviewElement = createScriptableWebview([createRawPageSnapshot()]);
    webviewElement.executeJavaScript = vi.fn().mockImplementation((): Promise<unknown> => {
      if (webviewElement.executeJavaScript && vi.mocked(webviewElement.executeJavaScript).mock.calls.length === 1) {
        return Promise.resolve(createRawPageSnapshot());
      }

      return deferredSelection.promise;
    });
    const scope = effectScope();
    const controller = scope.run(() => useWebView(ref<WebviewTag | null>(webviewElement)));
    if (!controller) throw new Error('webview controller should be created inside the effect scope');

    await controller.readPageSnapshot();
    const selectionTask = controller.startElementSelection();

    expect(vi.getTimerCount()).toBe(2);
    scope.stop();
    expect(vi.getTimerCount()).toBe(0);

    deferredSelection.resolve(null);
    await selectionTask;
  });

  it('shows webpage agent operation activity while an operation is pending', async (): Promise<void> => {
    const deferredOperation = createDeferred<unknown>();
    const webviewElement = createScriptableWebview([createRawPageSnapshot()]);
    webviewElement.executeJavaScript = vi.fn().mockImplementation((): Promise<unknown> => {
      if (webviewElement.executeJavaScript && vi.mocked(webviewElement.executeJavaScript).mock.calls.length === 1) {
        return Promise.resolve(createRawPageSnapshot());
      }

      return deferredOperation.promise;
    });
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    const operationPromise = controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } });

    expect(controller.agentActivity.value).toMatchObject({ phase: 'operating', label: '正在操作网页' });

    deferredOperation.resolve({
      ok: true,
      action: 'click',
      target: { index: 1, label: 'Search', tagName: 'BUTTON' },
      message: 'clicked',
      navigationStarted: false,
      pageChanged: true,
      shouldReadAgain: true
    });
    await expect(operationPromise).resolves.toMatchObject({ ok: true, action: 'click' });
    expect(controller.agentActivity.value).toMatchObject({ phase: 'success', label: '操作完成' });
  });

  it('keeps webpage agent operation errors visible after rejected scripts', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([createRawPageSnapshot(), new Error('Error: OPTION_AMBIGUOUS')]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    await expect(
      controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'select', index: 1, optionText: 'Other' } })
    ).rejects.toMatchObject({
      code: 'OPTION_AMBIGUOUS'
    });

    expect(controller.agentActivity.value).toMatchObject({ phase: 'error', label: '操作失败' });
  });

  it('exposes only meaningful webpage element actions in snapshots', async (): Promise<void> => {
    document.body.innerHTML = `
      <div id="decorative" tabindex="0">Decorative</div>
      <button>Save</button>
      <section id="page-scroller" style="overflow-y: auto;">
        <span id="row" tabindex="0">Row</span>
      </section>
    `;
    const decorative = document.querySelector('#decorative');
    const button = document.querySelector('button');
    const pageScroller = document.querySelector('#page-scroller');
    const row = document.querySelector('#row');
    if (!(decorative instanceof HTMLElement) || !(button instanceof HTMLElement) || !(pageScroller instanceof HTMLElement) || !(row instanceof HTMLElement)) {
      throw new Error('snapshot action test elements should exist');
    }

    installVisibleRect(decorative);
    installVisibleRect(button);
    installVisibleRect(row);
    installScrollableElementMetrics(pageScroller, { clientHeight: 100, scrollHeight: 900, clientWidth: 300, scrollWidth: 300 });
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.map((element) => ({ label: element.label, actions: element.actions }))).toEqual([
      { label: 'Save', actions: ['click'] },
      { label: 'Row', actions: ['scroll'] }
    ]);
  });

  it('exposes non-semantic clickable webpage elements in snapshots', async (): Promise<void> => {
    document.body.innerHTML = `
      <section>
        <div id="service-card" class="service-card" data-cy="service-card" style="cursor: pointer;">服务卡片</div>
        <span id="plain-text">普通文本</span>
      </section>
    `;
    const section = document.querySelector('section');
    const card = document.querySelector('#service-card');
    const plainText = document.querySelector('#plain-text');
    if (!(section instanceof HTMLElement) || !(card instanceof HTMLElement) || !(plainText instanceof HTMLElement)) {
      throw new Error('non-semantic clickable snapshot elements should exist');
    }

    installVisibleRect(section);
    installVisibleRect(card);
    installVisibleRect(plainText);
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.map((element) => ({ label: element.label, actions: element.actions }))).toEqual([{ label: '服务卡片', actions: ['click'] }]);
    expect(snapshot.content).toContain('[1]<div');
    expect(snapshot.content).toContain('class="service-card"');
    expect(snapshot.content).toContain('data-cy="service-card"');
    expect(snapshot.content).toContain('服务卡片 />');
  });

  it('indexes expanded interactive webpage signals', async (): Promise<void> => {
    document.body.innerHTML = `
      <main>
        <div id="grab-entry" style="cursor: grab;">拖拽入口</div>
        <div id="switch-entry" role="switch" aria-checked="false">开关入口</div>
        <div id="keyboard-entry" onkeydown="return true">键盘入口</div>
      </main>
    `;
    const interactiveElements = Array.from(document.querySelectorAll<HTMLElement>('#grab-entry,#switch-entry,#keyboard-entry'));
    if (interactiveElements.length !== 3) {
      throw new Error('expanded interactive signal elements should exist');
    }

    interactiveElements.forEach((element) => installVisibleRect(element));
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.map((element) => ({ label: element.label, actions: element.actions }))).toEqual([
      { label: '拖拽入口', actions: ['click'] },
      { label: '开关入口', actions: ['click'] },
      { label: '键盘入口', actions: ['click', 'press'] }
    ]);
  });

  it('filters disabled hidden and nested accessory webpage targets', async (): Promise<void> => {
    document.body.innerHTML = `
      <main>
        <button disabled>禁用入口</button>
        <button aria-disabled="true">禁用 ARIA</button>
        <button hidden>隐藏入口</button>
        <button id="parent-button">
          父级入口
          <span class="clickable">附属文本</span>
        </button>
      </main>
    `;
    const elements = Array.from(document.querySelectorAll<HTMLElement>('button,span'));
    if (elements.length !== 5) {
      throw new Error('filtered interactive elements should exist');
    }

    elements.forEach((element) => installVisibleRect(element));
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.map((element) => ({ tagName: element.tagName, label: element.label, actions: element.actions }))).toEqual([
      { tagName: 'BUTTON', label: '父级入口 附属文本', actions: ['click'] }
    ]);
  });

  it('uses multi-point hit testing for partially covered webpage targets', async (): Promise<void> => {
    document.body.innerHTML = `
      <main>
        <div id="covered-entry" style="cursor: pointer;">部分可点入口</div>
        <div id="overlay">遮挡层</div>
      </main>
    `;
    const entry = document.querySelector('#covered-entry');
    const overlay = document.querySelector('#overlay');
    if (!(entry instanceof HTMLElement) || !(overlay instanceof HTMLElement)) {
      throw new Error('multi-point hit test elements should exist');
    }

    installElementRect(entry, { x: 20, y: 20, width: 100, height: 40 });
    installElementRect(overlay, { x: 45, y: 25, width: 50, height: 30 });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn((x: number, y: number) => {
        if (x >= 45 && x <= 95 && y >= 25 && y <= 55) {
          return [overlay, document.body, document.documentElement];
        }

        return [entry, document.body, document.documentElement];
      })
    });
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.[0]).toMatchObject({
      label: '部分可点入口',
      actions: ['click'],
      reasons: expect.arrayContaining(['hit-test-pass']),
      hitTarget: { tagName: 'DIV', label: '部分可点入口', insideTarget: true }
    });
  });

  it('indexes clickable children inside webpage links as direct targets', async (): Promise<void> => {
    document.body.innerHTML = `
      <main>
        <a href="/details">
          <span id="link-child">链接子入口</span>
        </a>
      </main>
    `;
    const link = document.querySelector('a');
    const linkChild = document.querySelector('#link-child');
    if (!(link instanceof HTMLElement) || !(linkChild instanceof HTMLElement)) {
      throw new Error('link child interactive elements should exist');
    }

    installVisibleRect(link);
    installVisibleRect(linkChild);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [linkChild, link, document.body, document.documentElement])
    });
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.some((element) => element.tagName === 'SPAN' && element.label === '链接子入口' && element.actions.includes('click'))).toBe(true);
  });

  it('indexes scrollable webpage containers as direct operation targets', async (): Promise<void> => {
    document.body.innerHTML = `
      <main>
        <section id="result-list" aria-label="结果列表" style="overflow-y: auto;">
          <button>第一项</button>
        </section>
      </main>
    `;
    const main = document.querySelector('main');
    const resultList = document.querySelector('#result-list');
    const firstItem = document.querySelector('button');
    if (!(main instanceof HTMLElement) || !(resultList instanceof HTMLElement) || !(firstItem instanceof HTMLElement)) {
      throw new Error('scrollable container snapshot elements should exist');
    }

    installVisibleRect(main);
    installVisibleRect(resultList);
    installScrollableElementMetrics(resultList, { clientHeight: 120, scrollHeight: 900, clientWidth: 320, scrollWidth: 320 });
    installVisibleRect(firstItem);
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.find((element) => element.label === '结果列表')).toMatchObject({
      tagName: 'SECTION',
      actions: ['scroll']
    });
    expect(snapshot.content).toContain('[1]<section');
    expect(snapshot.content).toContain('data-scrollable');
  });

  it('adds clickability metadata for Vue-style delegated cards', async (): Promise<void> => {
    document.body.innerHTML = `
      <main aria-label="示例首页">
        <section aria-label="常用区域">
          <div id="service-entry" class="van-grid-item service-entry" style="cursor: pointer;">
            <i class="entry-icon"></i>
            <span>服务入口</span>
          </div>
        </section>
      </main>
    `;
    const main = document.querySelector('main');
    const section = document.querySelector('section');
    const entry = document.querySelector('#service-entry');
    const icon = document.querySelector('.entry-icon');
    const label = document.querySelector('span');
    if (
      !(main instanceof HTMLElement) ||
      !(section instanceof HTMLElement) ||
      !(entry instanceof HTMLElement) ||
      !(icon instanceof HTMLElement) ||
      !(label instanceof HTMLElement)
    ) {
      throw new Error('delegated card snapshot elements should exist');
    }

    installVisibleRect(main);
    installVisibleRect(section);
    installVisibleRect(entry);
    installVisibleRect(icon);
    installVisibleRect(label);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [label, entry, section, main, document.body, document.documentElement])
    });
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.[0]).toMatchObject({
      label: '服务入口',
      roleHint: 'service-entry',
      actions: ['click'],
      semanticPath: ['示例首页', '常用区域'],
      reasons: expect.arrayContaining(['pointer-cursor', 'clickable-class', 'hit-test-pass']),
      clickableScore: expect.any(Number),
      hitTarget: { tagName: 'SPAN', label: '服务入口', insideTarget: true }
    });
    expect(snapshot.viewport?.elements[0]).toMatchObject({
      index: 1,
      label: '服务入口',
      roleHint: 'service-entry',
      clickableScore: expect.any(Number)
    });
  });

  it('treats compact navigation text as a clickable candidate', async (): Promise<void> => {
    document.body.innerHTML = `
      <header aria-label="顶部导航">
        <span id="account-entry">账号入口</span>
      </header>
    `;
    const header = document.querySelector('header');
    const accountEntry = document.querySelector('#account-entry');
    if (!(header instanceof HTMLElement) || !(accountEntry instanceof HTMLElement)) {
      throw new Error('navigation text snapshot elements should exist');
    }

    installVisibleRect(header);
    installVisibleRect(accountEntry);
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [accountEntry, header, document.body, document.documentElement])
    });
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.[0]).toMatchObject({
      label: '账号入口',
      roleHint: 'clickable',
      actions: ['click'],
      semanticPath: ['顶部导航'],
      reasons: expect.arrayContaining(['compact-navigation-text', 'hit-test-pass'])
    });
  });

  it('treats compact top utility text as a clickable candidate without semantic containers', async (): Promise<void> => {
    document.body.innerHTML = `
      <div id="utility-row">
        <span id="account-entry">账号入口</span>
        <span id="help-entry">帮助中心</span>
      </div>
      <main>
        <h1>示例页面</h1>
      </main>
    `;
    const utilityRow = document.querySelector('#utility-row');
    const accountEntry = document.querySelector('#account-entry');
    const helpEntry = document.querySelector('#help-entry');
    if (!(utilityRow instanceof HTMLElement) || !(accountEntry instanceof HTMLElement) || !(helpEntry instanceof HTMLElement)) {
      throw new Error('top utility text snapshot elements should exist');
    }

    installElementRect(utilityRow, { x: 0, y: 0, width: 1024, height: 40 });
    installElementRect(accountEntry, { x: 820, y: 8, width: 72, height: 24 });
    installElementRect(helpEntry, { x: 910, y: 8, width: 72, height: 24 });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [accountEntry, utilityRow, document.body, document.documentElement])
    });
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.find((element) => element.label === '账号入口')).toMatchObject({
      roleHint: 'clickable',
      actions: ['click'],
      reasons: expect.arrayContaining(['compact-topbar-text', 'hit-test-pass'])
    });
  });

  it('does not merge child tab labels into one container summary line', async (): Promise<void> => {
    document.body.innerHTML = `
      <section aria-label="切换区域">
        <div class="tab">
          <span>方式一</span>
          <span>方式二</span>
        </div>
      </section>
    `;
    const section = document.querySelector('section');
    const tab = document.querySelector('.tab');
    const first = document.querySelector('.tab span:first-child');
    const second = document.querySelector('.tab span:last-child');
    if (!(section instanceof HTMLElement) || !(tab instanceof HTMLElement) || !(first instanceof HTMLElement) || !(second instanceof HTMLElement)) {
      throw new Error('tab summary test elements should exist');
    }

    installVisibleRect(section);
    installVisibleRect(tab);
    installVisibleRect(first);
    installVisibleRect(second);
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.content).not.toContain('<div class="tab">方式一 方式二</div>');
    expect(snapshot.content).toContain('<div class="tab"></div>');
    expect(snapshot.content).toContain('<span>方式一</span>');
    expect(snapshot.content).toContain('<span>方式二</span>');
  });

  it('returns simplified DOM browser state in webpage snapshots', async (): Promise<void> => {
    document.body.innerHTML = `
      <main id="sample-page">
        <h1>示例页面</h1>
        <form aria-label="筛选表单">
          <input name="keyword" placeholder="关键词" value="示例值" />
          <button type="submit" aria-label="筛选">筛选</button>
        </form>
        <div role="menuitem" aria-haspopup="menu">扩展入口</div>
      </main>
    `;
    const visibleElements = Array.from(document.querySelectorAll<HTMLElement>('main,h1,form,input,button,[role="menuitem"]'));
    visibleElements.forEach((element) => installVisibleRect(element));
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();
    const summary = (snapshot as { summary?: string }).summary ?? '';

    expect(snapshot.header).toContain('Page info:');
    expect(summary).toContain('Current Page:');
    expect(summary).toContain('Interactive elements from top layer of the current page');
    expect(summary).toContain('Use [N] as the element handle for operate_current_webpage.');
    expect(summary).toContain('Do not use navigate for page-visible links or text; use [N] with click.');
    expect(summary).toContain('[End of page]');
    expect(snapshot.content).toContain('<h1>示例页面</h1>');
    expect(snapshot.content).toContain('[1]<input name="keyword" value="示例值" placeholder="关键词" />');
    expect(snapshot.content).toContain('[2]<button type="submit" aria-label="筛选">筛选 />');
    expect(snapshot.content).toContain('[3]<div role="menuitem" aria-haspopup="menu">扩展入口 />');
    expect(snapshot.footer.length).toBeGreaterThan(0);
    expect(snapshot.truncated.content).toBe(false);
  });

  it('marks newly discovered webpage elements in page-agent content', async (): Promise<void> => {
    document.body.innerHTML = '<main><button id="first">已有入口</button></main>';
    const first = document.querySelector('#first');
    if (!(first instanceof HTMLElement)) {
      throw new Error('initial new-element marker button should exist');
    }

    installVisibleRect(first);
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    await controller.readPageSnapshot();

    const second = document.createElement('button');
    second.id = 'second';
    second.textContent = '新增入口';
    document.querySelector('main')?.appendChild(second);
    installVisibleRect(second);

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.find((element) => element.label === '新增入口')).toMatchObject({
      isNew: true,
      actions: ['click']
    });
    expect(snapshot.content).toContain('*[2]<button');
  });

  it('returns open shadow DOM elements in webpage snapshots', async (): Promise<void> => {
    document.body.innerHTML = '<booking-dialog></booking-dialog>';
    const host = document.querySelector('booking-dialog');
    if (!(host instanceof HTMLElement)) {
      throw new Error('shadow DOM host should exist');
    }

    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<section><h2>提示信息</h2><button>主操作</button></section>';
    const confirmButton = shadowRoot.querySelector('button');
    if (!(confirmButton instanceof HTMLElement)) {
      throw new Error('shadow DOM button should exist');
    }

    installVisibleRect(host);
    installVisibleRect(confirmButton);
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.map((element) => ({ label: element.label, actions: element.actions }))).toEqual([{ label: '主操作', actions: ['click'] }]);
    expect(snapshot.content).toContain('<booking-dialog>');
    expect(snapshot.content).toContain('#shadow-root');
    expect(snapshot.content).toContain('[1]<button>主操作 />');
  });

  it('includes the manually selected element in webpage snapshots', async (): Promise<void> => {
    const selectedElement = {
      tagName: 'BUTTON',
      id: 'primary-button',
      className: 'primary-action',
      text: '主操作',
      selector: 'button#primary-button',
      attributes: [{ name: 'id', value: 'primary-button' }],
      ancestors: [{ tagName: 'SECTION', selector: 'section.dialog' }],
      computedStyles: { display: 'block', position: 'static' },
      rect: { x: 20, y: 30, pageX: 20, pageY: 30, width: 120, height: 40 }
    };
    const webviewElement = createScriptableWebview([
      selectedElement,
      {
        url: 'https://example.com',
        title: 'Example',
        text: '主操作',
        selectedText: '',
        headings: [],
        links: [],
        snapshotId: 'snap-1',
        loading: false,
        elements: [
          {
            index: 1,
            tagName: 'BUTTON',
            text: '主操作',
            label: '主操作',
            disabled: false,
            isNew: false,
            actions: ['click'],
            rect: { x: 20, y: 30, width: 120, height: 40 },
            visibleRatio: 1,
            covered: false,
            layer: 'page',
            primary: false
          }
        ]
      }
    ]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));

    await controller.startElementSelection();
    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.selectedElement).toMatchObject({
      selector: 'button#primary-button',
      text: '主操作',
      matchedIndex: 1,
      matchedLabel: '主操作',
      matchedActions: ['click']
    });
  });

  it('returns viewport top layer context for visible dialogs', async (): Promise<void> => {
    document.body.innerHTML = `
      <main>
        <button id="background-button">背景按钮</button>
      </main>
      <div id="mask" style="position: fixed; inset: 0; background: rgba(0, 0, 0, 0.55);"></div>
      <section id="info-dialog" role="dialog" aria-modal="true" style="position: fixed; background: #fff;">
        <h2>提示信息</h2>
        <p>说明内容位于当前浮层中</p>
        <button>次要项</button>
        <button>主操作</button>
      </section>
    `;
    const registerButton = document.querySelector('#background-button');
    const mask = document.querySelector('#mask');
    const dialog = document.querySelector('#info-dialog');
    const cancelButton = document.querySelector('#info-dialog button:first-of-type');
    const confirmButton = document.querySelector('#info-dialog button:last-of-type');
    if (
      !(registerButton instanceof HTMLElement) ||
      !(mask instanceof HTMLElement) ||
      !(dialog instanceof HTMLElement) ||
      !(cancelButton instanceof HTMLElement) ||
      !(confirmButton instanceof HTMLElement)
    ) {
      throw new Error('dialog viewport test elements should exist');
    }

    installElementRect(registerButton, { x: 112, y: 620, width: 130, height: 88 });
    installElementRect(mask, { x: 0, y: 0, width: 1024, height: 768 });
    installElementRect(dialog, { x: 120, y: 180, width: 760, height: 360 });
    installElementRect(cancelButton, { x: 180, y: 470, width: 260, height: 72 });
    installElementRect(confirmButton, { x: 520, y: 470, width: 260, height: 72 });
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.viewport?.topLayer).toMatchObject({
      kind: 'dialog',
      label: '提示信息',
      elementIndexes: [2, 3],
      primaryActionIndex: 3,
      dimmed: true
    });
    expect(snapshot.viewport?.elements).toEqual([
      expect.objectContaining({ index: 1, label: '背景按钮', covered: true, layer: 'background', primary: false }),
      expect.objectContaining({ index: 2, label: '次要项', covered: false, layer: 'top', primary: false }),
      expect.objectContaining({ index: 3, label: '主操作', covered: false, layer: 'top', primary: true })
    ]);
    expect(snapshot.elements?.[2]).toMatchObject({ index: 3, label: '主操作', primary: true, layer: 'top' });
  });

  it('does not treat compact fixed toolbars as top layer dialogs', async (): Promise<void> => {
    document.body.innerHTML = `
      <header id="fixed-toolbar" style="position: fixed; top: 0; left: 0; width: 100%; height: 48px; background: #fff;">
        <button>工具入口</button>
      </header>
      <main>
        <button>内容入口</button>
      </main>
    `;
    const toolbar = document.querySelector('#fixed-toolbar');
    const toolbarButton = document.querySelector('#fixed-toolbar button');
    const contentButton = document.querySelector('main button');
    if (!(toolbar instanceof HTMLElement) || !(toolbarButton instanceof HTMLElement) || !(contentButton instanceof HTMLElement)) {
      throw new Error('fixed toolbar test elements should exist');
    }

    installElementRect(toolbar, { x: 0, y: 0, width: 1024, height: 48 });
    installElementRect(toolbarButton, { x: 24, y: 8, width: 96, height: 32 });
    installElementRect(contentButton, { x: 32, y: 120, width: 120, height: 36 });
    const controller = useWebView(ref<WebviewTag | null>(createPageScriptExecutingWebview()));

    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.viewport?.topLayer).toBeUndefined();
    expect(snapshot.viewport?.elements.find((element) => element.label === '工具入口')).toMatchObject({ layer: 'page', covered: false, primary: false });
    expect(snapshot.viewport?.elements.find((element) => element.label === '内容入口')).toMatchObject({ layer: 'page', covered: false, primary: false });
  });

  it('clicks non-semantic clickable webpage elements by index', async (): Promise<void> => {
    document.body.innerHTML = '<div id="submit-card" style="cursor: pointer;">卡片入口</div>';
    const card = document.querySelector('#submit-card');
    if (!(card instanceof HTMLElement)) {
      throw new Error('non-semantic clickable operation element should exist');
    }

    let clickCount = 0;
    card.addEventListener('click', () => {
      clickCount += 1;
    });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    installVisibleRect(card);
    const webviewElement = createPageOperationExecutingWebview({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      elements: [{ index: 1, tagName: 'DIV', text: '卡片入口', label: '卡片入口', disabled: false, isNew: false, actions: ['click'] }]
    });
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    const result = await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } });

    expect(clickCount).toBe(1);
    expect(result).toMatchObject({ ok: true, action: 'click', target: { index: 1, label: '卡片入口', tagName: 'DIV' } });
  });

  it('operates elements resolved by the shared flat DOM collector', async (): Promise<void> => {
    document.body.innerHTML = `
      <main>
        <div id="delegated-card" class="service-entry" style="cursor: pointer;">
          <span>共享索引入口</span>
        </div>
      </main>
    `;
    const card = document.querySelector('#delegated-card');
    const label = document.querySelector('span');
    if (!(card instanceof HTMLElement) || !(label instanceof HTMLElement)) {
      throw new Error('shared collector operation elements should exist');
    }

    let clickCount = 0;
    card.addEventListener('click', () => {
      clickCount += 1;
    });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [label, card, document.body, document.documentElement])
    });
    installVisibleRect(card);
    installVisibleRect(label);
    const webviewElement = createPageScriptExecutingWebview();
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));

    const snapshot = await controller.readPageSnapshot();
    const target = snapshot.elements?.find((element) => element.label === '共享索引入口');
    if (!target) {
      throw new Error('shared collector target should exist');
    }
    const result = await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: target.index } });

    expect(clickCount).toBe(1);
    expect(result).toMatchObject({ ok: true, action: 'click', target: { index: target.index, label: '共享索引入口', tagName: 'DIV' } });
  });

  it('clicks the deepest hit-tested child inside an indexed card', async (): Promise<void> => {
    document.body.innerHTML = '<div id="submit-card" style="cursor: pointer;"><span id="submit-label">操作入口</span></div>';
    const card = document.querySelector('#submit-card');
    const label = document.querySelector('#submit-label');
    if (!(card instanceof HTMLElement) || !(label instanceof HTMLElement)) {
      throw new Error('hit-tested clickable card elements should exist');
    }

    let cardClickCount = 0;
    let labelPointerDownCount = 0;
    card.addEventListener('click', () => {
      cardClickCount += 1;
    });
    label.addEventListener('pointerdown', () => {
      labelPointerDownCount += 1;
    });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    Object.defineProperty(document, 'elementsFromPoint', {
      configurable: true,
      value: vi.fn(() => [label, card, document.body, document.documentElement])
    });
    installElementRect(card, { x: 40, y: 80, width: 180, height: 44 });
    installElementRect(label, { x: 60, y: 92, width: 120, height: 20 });
    const webviewElement = createPageOperationExecutingWebview({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      elements: [{ index: 1, tagName: 'DIV', text: '操作入口', label: '操作入口', disabled: false, isNew: false, actions: ['click'] }]
    });
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    const result = await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } });

    expect(labelPointerDownCount).toBe(1);
    expect(cardClickCount).toBe(1);
    expect(result).toMatchObject({ ok: true, action: 'click', target: { index: 1, label: '操作入口', tagName: 'DIV' } });
  });

  it('clicks open shadow DOM elements by index', async (): Promise<void> => {
    document.body.innerHTML = '<booking-dialog></booking-dialog>';
    const host = document.querySelector('booking-dialog');
    if (!(host instanceof HTMLElement)) {
      throw new Error('shadow DOM operation host should exist');
    }

    const shadowRoot = host.attachShadow({ mode: 'open' });
    shadowRoot.innerHTML = '<button>主操作</button>';
    const confirmButton = shadowRoot.querySelector('button');
    if (!(confirmButton instanceof HTMLElement)) {
      throw new Error('shadow DOM operation button should exist');
    }

    let clickCount = 0;
    confirmButton.addEventListener('click', () => {
      clickCount += 1;
    });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    installVisibleRect(host);
    installVisibleRect(confirmButton);
    const webviewElement = createPageOperationExecutingWebview({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      elements: [{ index: 1, tagName: 'BUTTON', text: '主操作', label: '主操作', disabled: false, isNew: false, actions: ['click'] }]
    });
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    const result = await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } });

    expect(clickCount).toBe(1);
    expect(result).toMatchObject({ ok: true, action: 'click', target: { index: 1, label: '主操作', tagName: 'BUTTON' } });
  });

  it('operates the current page using the active snapshot', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([
      {
        url: 'https://example.com',
        title: 'Example',
        text: 'Hello',
        selectedText: '',
        headings: [],
        links: [],
        snapshotId: 'snap-1',
        loading: false,
        scroll: {
          x: 0,
          y: 0,
          viewportWidth: 800,
          viewportHeight: 600,
          scrollWidth: 800,
          scrollHeight: 1200,
          atTop: true,
          atBottom: false
        },
        elements: [{ index: 1, tagName: 'BUTTON', text: 'Search', label: 'Search', disabled: false, isNew: true, actions: ['click'] }]
      },
      {
        ok: true,
        action: 'click',
        target: { index: 1, label: 'Search', tagName: 'BUTTON' },
        message: 'clicked',
        navigationStarted: false,
        pageChanged: true,
        shouldReadAgain: true
      }
    ]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    const result = await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } });

    expect(result).toMatchObject({ ok: true, action: 'click', shouldReadAgain: true });
    expect(webviewElement.executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it('requires a fresh snapshot after every page operation', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([
      createRawPageSnapshot(),
      {
        ok: true,
        action: 'click',
        target: { index: 1, label: 'Search', tagName: 'BUTTON' },
        message: 'clicked',
        navigationStarted: false,
        pageChanged: true,
        shouldReadAgain: true
      }
    ]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();
    const operation = { snapshotId: snapshot.snapshotId ?? '', action: { type: 'click' as const, index: 1 } };

    await expect(controller.operatePage(operation)).resolves.toMatchObject({ ok: true, action: 'click' });
    await expect(controller.operatePage(operation)).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
    expect(webviewElement.executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it('consumes the active snapshot before concurrent page operations can reuse it', async (): Promise<void> => {
    const operationDeferred = createDeferred<unknown>();
    const webviewElement = createScriptableWebview([createRawPageSnapshot(), operationDeferred.promise, operationDeferred.promise]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();
    const operation = { snapshotId: snapshot.snapshotId ?? '', action: { type: 'click' as const, index: 1 } };

    const firstOperation = controller.operatePage(operation);
    const secondOperation = controller.operatePage(operation);
    operationDeferred.resolve({
      ok: true,
      action: 'click',
      target: { index: 1, label: 'Search', tagName: 'BUTTON' },
      message: 'clicked',
      navigationStarted: false,
      pageChanged: true,
      shouldReadAgain: true
    });

    await expect(firstOperation).resolves.toMatchObject({ ok: true, action: 'click' });
    await expect(secondOperation).rejects.toMatchObject({ code: 'STALE_SNAPSHOT' });
    expect(webviewElement.executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it('blocks snapshot reads until the current page operation settles', async (): Promise<void> => {
    const operationDeferred = createDeferred<unknown>();
    const webviewElement = createScriptableWebview([createRawPageSnapshot(), operationDeferred.promise, createRawPageSnapshot('snap-2')]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    const operation = controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } });
    const overlappingRead = controller.readPageSnapshot();
    operationDeferred.resolve({
      ok: true,
      action: 'click',
      target: { index: 1, label: 'Search', tagName: 'BUTTON' },
      message: 'clicked',
      navigationStarted: false,
      pageChanged: true,
      shouldReadAgain: true
    });

    await expect(operation).resolves.toMatchObject({ ok: true, action: 'click' });
    await expect(overlappingRead).rejects.toMatchObject({ code: 'PAGE_LOADING' });
    await expect(controller.readPageSnapshot()).resolves.toMatchObject({ snapshotId: 'snap-2' });
    expect(webviewElement.executeJavaScript).toHaveBeenCalledTimes(3);
  });

  it('keeps reads blocked after caller abort until the page operation itself settles', async (): Promise<void> => {
    const operationDeferred = createDeferred<unknown>();
    const webviewElement = createScriptableWebview([createRawPageSnapshot(), operationDeferred.promise, createRawPageSnapshot('snap-2')]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();
    const abortController = new AbortController();

    const operation = controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } }, abortController.signal);
    abortController.abort();

    await expect(operation).rejects.toMatchObject({ code: 'RUNTIME_INTERRUPTED' });
    await expect(controller.readPageSnapshot()).rejects.toMatchObject({ code: 'PAGE_LOADING' });

    operationDeferred.resolve({
      ok: true,
      action: 'click',
      target: { index: 1, label: 'Search', tagName: 'BUTTON' },
      message: 'clicked',
      navigationStarted: false,
      pageChanged: true,
      shouldReadAgain: true
    });
    await new Promise<void>((resolve): void => {
      window.setTimeout(resolve, 0);
    });

    await expect(controller.readPageSnapshot()).resolves.toMatchObject({ snapshotId: 'snap-2' });
  });

  it('rejects navigation while another page operation is pending', async (): Promise<void> => {
    const operationDeferred = createDeferred<unknown>();
    const webviewElement = createScriptableWebview([createRawPageSnapshot(), operationDeferred.promise]);
    webviewElement.loadURL = vi.fn();
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    const operation = controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } });
    const overlappingNavigation = controller.operatePage({ action: { type: 'navigate', url: 'https://example.org' } });
    operationDeferred.resolve({
      ok: true,
      action: 'click',
      target: { index: 1, label: 'Search', tagName: 'BUTTON' },
      message: 'clicked',
      navigationStarted: false,
      pageChanged: true,
      shouldReadAgain: true
    });

    await expect(operation).resolves.toMatchObject({ ok: true, action: 'click' });
    await expect(overlappingNavigation).rejects.toMatchObject({ code: 'PAGE_LOADING' });
    expect(webviewElement.loadURL).not.toHaveBeenCalled();
  });

  it('keeps the active snapshot usable after the former time-only expiry window', async (): Promise<void> => {
    const performanceNow = vi.spyOn(globalThis.performance, 'now').mockReturnValue(0);
    const webviewElement = createScriptableWebview([
      {
        url: 'https://example.com',
        title: 'Example',
        text: 'Hello',
        selectedText: '',
        headings: [],
        links: [],
        snapshotId: 'snap-1',
        loading: false,
        elements: [{ index: 1, tagName: 'BUTTON', text: 'Search', label: 'Search', disabled: false, isNew: true, actions: ['click'] }]
      },
      {
        ok: true,
        action: 'click',
        target: { index: 1, label: 'Search', tagName: 'BUTTON' },
        message: 'clicked',
        navigationStarted: false,
        pageChanged: true,
        shouldReadAgain: true
      }
    ]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    performanceNow.mockReturnValue(61_000);
    const result = await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } });

    expect(result).toMatchObject({ ok: true, action: 'click', shouldReadAgain: true });
    expect(webviewElement.executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it('reports page loading instead of stale snapshot during transient same-page loading', async (): Promise<void> => {
    document.body.innerHTML = '<button>临时入口</button>';
    const button = document.querySelector('button');
    if (!(button instanceof HTMLElement)) {
      throw new Error('transient loading button should exist');
    }

    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    installVisibleRect(button);
    const webviewElement = createPageOperationExecutingWebview({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      elements: [{ index: 1, tagName: 'BUTTON', text: '临时入口', label: '临时入口', disabled: false, isNew: false, actions: ['click'] }]
    });
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    controller.handleDidStartLoading();

    await expect(controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } })).rejects.toMatchObject({
      code: 'PAGE_LOADING'
    });
  });

  it('keeps the active snapshot after transient same-page loading stops', async (): Promise<void> => {
    document.body.innerHTML = '<button>恢复入口</button>';
    const button = document.querySelector('button');
    if (!(button instanceof HTMLElement)) {
      throw new Error('recovered loading button should exist');
    }

    let clickCount = 0;
    button.addEventListener('click', () => {
      clickCount += 1;
    });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    installVisibleRect(button);
    const webviewElement = createPageOperationExecutingWebview({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      elements: [{ index: 1, tagName: 'BUTTON', text: '恢复入口', label: '恢复入口', disabled: false, isNew: false, actions: ['click'] }]
    });
    webviewElement.canGoBack = vi.fn(() => false);
    webviewElement.canGoForward = vi.fn(() => false);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    controller.handleDidStartLoading();
    controller.handleDidStopLoading();
    const result = await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } });

    expect(clickCount).toBe(1);
    expect(result).toMatchObject({ ok: true, action: 'click', target: { index: 1, label: '恢复入口', tagName: 'BUTTON' } });
  });

  it('keeps the active snapshot after same-url navigation events', async (): Promise<void> => {
    document.body.innerHTML = '<button>同页入口</button>';
    const button = document.querySelector('button');
    if (!(button instanceof HTMLElement)) {
      throw new Error('same-url navigation button should exist');
    }

    let clickCount = 0;
    button.addEventListener('click', () => {
      clickCount += 1;
    });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    installVisibleRect(button);
    const webviewElement = createPageOperationExecutingWebview({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      elements: [{ index: 1, tagName: 'BUTTON', text: '同页入口', label: '同页入口', disabled: false, isNew: false, actions: ['click'] }]
    });
    webviewElement.canGoBack = vi.fn(() => false);
    webviewElement.canGoForward = vi.fn(() => false);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    controller.handleDidNavigate({ url: 'https://example.com' } as DidNavigateEvent);
    const result = await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } });

    expect(clickCount).toBe(1);
    expect(result).toMatchObject({ ok: true, action: 'click', target: { index: 1, label: '同页入口', tagName: 'BUTTON' } });
  });

  it('invalidates the active snapshot when a main-frame document navigation starts', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([createRawPageSnapshot()]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    controller.handleDidStartNavigation({ url: 'https://example.com', isMainFrame: true, isInPlace: false } as DidStartNavigationEvent);

    expect(controller.state.value.isLoading).toBe(true);
    await expect(controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT'
    });
    expect(webviewElement.executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it('preserves the active snapshot for in-page and subframe navigation starts', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([
      createRawPageSnapshot(),
      {
        ok: true,
        action: 'click',
        target: { index: 1, label: 'Search', tagName: 'BUTTON' },
        message: 'clicked',
        navigationStarted: false,
        pageChanged: true,
        shouldReadAgain: true
      }
    ]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    controller.handleDidStartNavigation({ url: 'https://example.com#details', isMainFrame: true, isInPlace: true } as DidStartNavigationEvent);
    controller.handleDidStartNavigation({ url: 'https://frame.example.com', isMainFrame: false, isInPlace: false } as DidStartNavigationEvent);

    await expect(controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } })).resolves.toMatchObject({
      ok: true,
      action: 'click'
    });
  });

  it('handles aborted loadURL promises when navigating from the address bar', (): void => {
    const webviewElement = createScriptableWebview([]);
    const loadResult = createCatchableLoadResult();
    webviewElement.loadURL = vi.fn<(_url: string) => Promise<void>>(() => loadResult.promise);
    webviewElement.canGoBack = vi.fn(() => false);
    webviewElement.canGoForward = vi.fn(() => false);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    controller.handleDomReady();

    controller.navigate('https://example.com/');

    expect(webviewElement.loadURL).toHaveBeenCalledWith('https://example.com/');
    expect(loadResult.catchSpy).toHaveBeenCalledTimes(1);
    expect(() => loadResult.catchSpy.mock.calls[0]?.[0](new Error("ERR_ABORTED (-3) loading 'https://example.com/'"))).not.toThrow();
  });

  it('navigates the current WebView without requiring an active snapshot', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([]);
    const loadResult = createCatchableLoadResult();
    webviewElement.loadURL = vi.fn<(_url: string) => Promise<void>>(() => loadResult.promise);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));

    const result = await controller.operatePage({ action: { type: 'navigate', url: 'example.org' } });

    expect(webviewElement.loadURL).toHaveBeenCalledWith('https://example.org/');
    expect(loadResult.catchSpy).toHaveBeenCalledTimes(1);
    expect(webviewElement.executeJavaScript).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, action: 'navigate', pageChanged: true, shouldReadAgain: true });
  });

  it('prevents an immediate stale-page read after programmatic navigation starts', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([createRawPageSnapshot()]);
    webviewElement.loadURL = vi.fn();
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));

    await controller.operatePage({ action: { type: 'navigate', url: 'https://example.org' } });
    const immediateRead = controller.readPageSnapshot();

    await expect(immediateRead).rejects.toMatchObject({ code: 'PAGE_LOADING' });
    expect(controller.state.value.isLoading).toBe(true);
    expect(webviewElement.executeJavaScript).not.toHaveBeenCalled();
  });

  it('does not start webpage reads or navigation after the runtime is interrupted', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([]);
    webviewElement.loadURL = vi.fn<(_url: string) => Promise<void>>(() => Promise.resolve());
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const abortController = new AbortController();
    abortController.abort();

    await expect(controller.readPageSnapshot(abortController.signal)).rejects.toMatchObject({ code: 'RUNTIME_INTERRUPTED' });
    await expect(controller.operatePage({ action: { type: 'navigate', url: 'example.org' } }, abortController.signal)).rejects.toMatchObject({
      code: 'RUNTIME_INTERRUPTED'
    });

    expect(webviewElement.executeJavaScript).not.toHaveBeenCalled();
    expect(webviewElement.loadURL).not.toHaveBeenCalled();
  });

  it('rejects operation when the active snapshot becomes stale', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([
      {
        url: 'https://example.com',
        title: 'Example',
        text: 'Hello',
        selectedText: '',
        headings: [],
        links: [],
        snapshotId: 'snap-1',
        loading: false,
        elements: []
      }
    ]);
    webviewElement.canGoBack = vi.fn(() => false);
    webviewElement.canGoForward = vi.fn(() => false);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    controller.handleDidNavigate({ url: 'https://example.org' } as DidNavigateEvent);
    await expect(controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT'
    });
  });

  it('rejects operation when the indexed element no longer matches the snapshot fingerprint', async (): Promise<void> => {
    document.body.innerHTML = '<button>New button</button>';
    const button = document.querySelector('button');
    if (!(button instanceof HTMLElement)) {
      throw new Error('button should exist');
    }

    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    installVisibleRect(button);
    const webviewElement = createPageOperationExecutingWebview({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      elements: [
        {
          index: 1,
          tagName: 'BUTTON',
          text: 'Old button',
          label: 'Old button',
          fingerprint: 'BUTTON|Old button',
          disabled: false,
          isNew: false,
          actions: ['click']
        }
      ]
    });
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    expect(snapshot.elements?.[0].fingerprint).toBeUndefined();
    await expect(controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'click', index: 1 } })).rejects.toMatchObject({
      code: 'STALE_SNAPSHOT'
    });
  });

  it('normalizes page operation error codes from rejected scripts', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([
      {
        url: 'https://example.com',
        title: 'Example',
        text: 'Hello',
        selectedText: '',
        headings: [],
        links: [],
        snapshotId: 'snap-1',
        loading: false,
        elements: [{ index: 1, tagName: 'SELECT', text: 'Other', label: 'Other', disabled: false, isNew: false, actions: ['select'] }]
      },
      new Error('Error: OPTION_AMBIGUOUS')
    ]);
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    await expect(
      controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'select', index: 1, optionText: 'Other' } })
    ).rejects.toMatchObject({
      code: 'OPTION_AMBIGUOUS'
    });
  });

  it('navigates the current WebView through operatePage without executing page JavaScript', async (): Promise<void> => {
    const webviewElement = createScriptableWebview([
      {
        url: 'https://example.com',
        title: 'Example',
        text: 'Hello',
        selectedText: '',
        headings: [],
        links: [],
        snapshotId: 'snap-1',
        loading: false,
        elements: []
      }
    ]);
    webviewElement.loadURL = vi.fn();
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    const result = await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'navigate', url: 'example.org' } });

    expect(webviewElement.loadURL).toHaveBeenCalledWith('https://example.org/');
    expect(webviewElement.executeJavaScript).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, action: 'navigate', pageChanged: true, shouldReadAgain: true });
  });

  it('presses Enter on an indexed input and submits the owning form', async (): Promise<void> => {
    document.body.innerHTML = `
      <form id="entry-form">
        <input name="keyword" placeholder="输入内容" />
      </form>
    `;
    const input = document.querySelector('input');
    const form = document.querySelector('form');
    if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) {
      throw new Error('press test form should exist');
    }

    const observedKeys: string[] = [];
    let submitCount = 0;
    input.addEventListener('keydown', (event) => observedKeys.push(`down:${event.key}`));
    input.addEventListener('keypress', (event) => observedKeys.push(`press:${event.key}`));
    input.addEventListener('keyup', (event) => observedKeys.push(`up:${event.key}`));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitCount += 1;
    });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    installVisibleRect(form);
    installVisibleRect(input);
    const webviewElement = createPageOperationExecutingWebview({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      elements: [{ index: 1, tagName: 'INPUT', text: '', label: '输入内容', disabled: false, isNew: false, actions: ['input'] }]
    });
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    const result = await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'press', index: 1, key: 'Enter' } });

    expect(observedKeys).toEqual(['down:Enter', 'press:Enter', 'up:Enter']);
    expect(submitCount).toBe(1);
    expect(result).toMatchObject({ ok: true, action: 'press', pageChanged: true, shouldReadAgain: true });
  });

  it('scrolls the ancestor that can move in the requested direction', async (): Promise<void> => {
    document.body.innerHTML = `
      <section id="page-scroller" style="overflow-y: auto;">
        <div id="horizontal-scroller" style="overflow-x: auto;">
          <button>More</button>
        </div>
      </section>
    `;
    const pageScroller = document.querySelector('#page-scroller');
    const horizontalScroller = document.querySelector('#horizontal-scroller');
    const button = document.querySelector('button');
    if (!(pageScroller instanceof HTMLElement) || !(horizontalScroller instanceof HTMLElement) || !(button instanceof HTMLElement)) {
      throw new Error('scroll test elements should exist');
    }

    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    installVisibleRect(button);
    installScrollableElementMetrics(pageScroller, { clientHeight: 100, scrollHeight: 900, clientWidth: 300, scrollWidth: 300 });
    installScrollableElementMetrics(horizontalScroller, { clientHeight: 100, scrollHeight: 100, clientWidth: 100, scrollWidth: 600 });
    const webviewElement = createPageOperationExecutingWebview({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      elements: [{ index: 1, tagName: 'BUTTON', text: 'More', label: 'More', disabled: false, isNew: false, actions: ['scroll'] }]
    });
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    const result = await controller.operatePage({
      snapshotId: snapshot.snapshotId ?? '',
      action: { type: 'scroll', index: 1, direction: 'down', pixels: 120 }
    });

    expect(pageScroller.scrollTop).toBe(120);
    expect(horizontalScroller.scrollTop).toBe(0);
    expect(result).toMatchObject({
      scroll: {
        targetType: 'element',
        before: { x: 0, y: 0 },
        after: { x: 0, y: 120 },
        changed: true
      }
    });
  });

  it('falls back to page scrolling when indexed element has no scrollable ancestor', async (): Promise<void> => {
    document.body.innerHTML = '<button>More</button>';
    const button = document.querySelector('button');
    if (!(button instanceof HTMLElement)) {
      throw new Error('button should exist');
    }

    const scrollBy = vi.fn<(_options: ScrollToOptions) => void>();
    Object.defineProperty(window, 'scrollBy', { configurable: true, writable: true, value: scrollBy });
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: vi.fn() });
    installVisibleRect(button);
    const webviewElement = createPageOperationExecutingWebview({
      url: 'https://example.com',
      title: 'Example',
      text: 'Hello',
      selectedText: '',
      headings: [],
      links: [],
      snapshotId: 'snap-1',
      loading: false,
      elements: [{ index: 1, tagName: 'BUTTON', text: 'More', label: 'More', disabled: false, isNew: false, actions: ['scroll'] }]
    });
    const controller = useWebView(ref<WebviewTag | null>(webviewElement));
    const snapshot = await controller.readPageSnapshot();

    await controller.operatePage({ snapshotId: snapshot.snapshotId ?? '', action: { type: 'scroll', index: 1, direction: 'down', pixels: 140 } });

    expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 140, behavior: 'auto' });
  });
});
