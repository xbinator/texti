/**
 * @file web-agent-activity.test.ts
 * @description 验证 WebView 页面展示 Agent 活动视觉反馈。
 * @vitest-environment jsdom
 */
import type { VueWrapper } from '@vue/test-utils';
import type { WebviewTag } from 'electron';
import { nextTick, type Ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebviewPageState } from '@/views/webview/shared/types';
import WebviewPage from '@/views/webview/web/index.vue';
import type { WebviewToolContext } from '@/views/webview/web/types';

/**
 * 测试用 WebView 元素最小能力集合。
 */
interface TestWebviewElement extends HTMLElement {
  /** 是否可后退。 */
  canGoBack: () => boolean;
  /** 是否可前进。 */
  canGoForward: () => boolean;
  /** 执行页面脚本。 */
  executeJavaScript: (script: string) => Promise<unknown>;
  /** 加载目标 URL。 */
  loadURL: (url: string) => void;
  /** 后退。 */
  goBack: () => void;
  /** 前进。 */
  goForward: () => void;
  /** 刷新。 */
  reload: () => void;
  /** 停止加载。 */
  stop: () => void;
  /** 设置 User-Agent。 */
  setUserAgent: (userAgent: string) => void;
}

/**
 * 测试用截图 Hook 入参。
 */
interface TestUseScreenshotOptions {
  /** 当前 WebView 元素引用 */
  webviewElementRef: Ref<WebviewTag | null>;
  /** 当前页面状态 */
  webviewState: Ref<Pick<WebviewPageState, 'title' | 'url'>>;
  /** 截图遮罩显隐回调 */
  onCaptureMaskVisibleChange?: (visible: boolean) => void | Promise<void>;
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

const registeredContextHolder = vi.hoisted<{ value: WebviewToolContext | null }>(() => ({ value: null }));
const executeJavaScriptMock = vi.hoisted(() => vi.fn<(_script: string) => Promise<unknown>>());

vi.mock('vue-router', () => ({
  useRoute: () => ({
    fullPath: '/webview?url=https%3A%2F%2Fexample.com',
    query: {
      url: 'https%3A%2F%2Fexample.com'
    }
  })
}));

vi.mock('@/stores/workspace/recent', () => ({
  useRecentStore: () => ({
    addWebviewRecord: vi.fn().mockResolvedValue(undefined)
  })
}));

vi.mock('@/views/webview/web/hooks/useChatContext', () => ({
  useChatContext: vi.fn((options: { context: WebviewToolContext }): void => {
    registeredContextHolder.value = options.context;
  })
}));

vi.mock('@/shared/platform', () => ({
  native: {
    openExternal: vi.fn()
  }
}));

vi.mock('@/views/webview/shared/hooks/useTabTitle', () => ({
  useTabTitle: vi.fn()
}));

vi.mock('@/views/webview/web/hooks/useScreenshot.ts', () => ({
  useScreenshot: (options: TestUseScreenshotOptions) => {
    const isCapturing = { value: options.webviewElementRef.value !== null && false };

    return {
      isCapturing,
      captureViewportScreenshot: vi.fn().mockResolvedValue(undefined),
      captureFullPageScreenshot: vi.fn().mockResolvedValue(undefined),
      captureSelectedElementScreenshot: vi.fn().mockResolvedValue(undefined)
    };
  }
}));

vi.mock('@/views/webview/web/components/AddressBar.vue', () => ({
  default: {
    name: 'AddressBar',
    template: '<div />'
  }
}));

vi.mock('@/views/webview/web/components/DeviceToolbar.vue', () => ({
  default: {
    name: 'DeviceToolbar',
    template: '<div />'
  }
}));

vi.mock('@/views/webview/web/components/InspectorPanel.vue', () => ({
  default: {
    name: 'InspectorPanel',
    template: '<div />'
  }
}));

vi.mock('@/views/webview/web/hooks/useHostLayer.ts', () => ({
  useHostLayer: () => ({
    requestSyncHostLayerBounds: vi.fn()
  })
}));

vi.mock('@/views/webview/web/utils/hosting', () => ({
  ensureWebviewHostLayer: () => {
    const hostLayer = document.createElement('div');
    document.body.appendChild(hostLayer);
    return hostLayer;
  },
  ensureHostedWebviewElement: () => {
    const element = document.createElement('webview') as TestWebviewElement;
    element.canGoBack = vi.fn(() => false);
    element.canGoForward = vi.fn(() => false);
    element.executeJavaScript = executeJavaScriptMock;
    element.loadURL = vi.fn();
    element.goBack = vi.fn();
    element.goForward = vi.fn();
    element.reload = vi.fn();
    element.stop = vi.fn();
    element.setUserAgent = vi.fn();
    return element;
  }
}));

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
 * @returns 原始快照对象
 */
function createRawPageSnapshot(): unknown {
  return {
    url: 'https://example.com',
    title: 'Example',
    text: 'Hello',
    selectedText: '',
    headings: [],
    links: [],
    snapshotId: 'snap-1',
    loading: false,
    elements: []
  };
}

/**
 * 挂载 WebView 页面。
 * @returns Vue Test Utils 包装器
 */
function mountWebviewPage(): VueWrapper {
  return shallowMount(WebviewPage, {
    global: {
      stubs: {
        AddressBar: true,
        BPanelSplitter: true,
        DeviceToolbar: true,
        InspectorPanel: true,
        Teleport: false
      }
    }
  });
}

/**
 * 从真实 Teleport 目标或测试 wrapper 中查找 Agent 反馈层。
 * @param wrapper - Vue Test Utils 包装器
 * @param selector - CSS 选择器
 * @returns 匹配元素
 */
function findAgentActivityElement(wrapper: VueWrapper, selector: string): Element | null {
  return document.body.querySelector(selector) ?? wrapper.element.querySelector(selector);
}

describe('webview agent activity overlay', () => {
  beforeEach((): void => {
    registeredContextHolder.value = null;
    executeJavaScriptMock.mockReset();
  });

  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('renders a theme activity overlay while reading the current webpage', async (): Promise<void> => {
    const deferredSnapshot = createDeferred<unknown>();
    executeJavaScriptMock.mockReturnValue(deferredSnapshot.promise);
    const wrapper = mountWebviewPage();
    const context = registeredContextHolder.value;
    if (!context) {
      throw new Error('webview tool context should be registered');
    }

    const readPromise = context.readPageSnapshot();
    await nextTick();

    const readingOverlay = findAgentActivityElement(wrapper, '.webview-agent-activity--reading');
    expect(readingOverlay).not.toBeNull();
    expect(readingOverlay?.textContent).toContain('正在读取网页');

    deferredSnapshot.resolve(createRawPageSnapshot());
    await readPromise;
    await nextTick();

    const successOverlay = findAgentActivityElement(wrapper, '.webview-agent-activity--success');
    expect(successOverlay?.textContent).toContain('读取完成');

    wrapper.unmount();
  });
});
