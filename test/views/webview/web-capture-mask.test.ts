/**
 * @file web-capture-mask.test.ts
 * @description 验证 WebView 页面入口将截图能力交给 useScreenshot。
 * @vitest-environment jsdom
 */
import type { VueWrapper } from '@vue/test-utils';
import type { WebviewTag } from 'electron';
import { nextTick, type Ref } from 'vue';
import { shallowMount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebviewElementSelection, WebviewPageState } from '@/views/webview/shared/types';
import WebviewPage from '@/views/webview/web/index.vue';
import { TIBIS_WEBVIEW_HOST_CHANNEL } from '../../../shared/webview/host-bridge';

/**
 * 测试用 WebView 元素最小能力集合。
 */
interface TestWebviewElement extends HTMLElement {
  /** 是否可后退。 */
  canGoBack: () => boolean;
  /** 是否可前进。 */
  canGoForward: () => boolean;
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
  /** 执行页面脚本。 */
  executeJavaScript: (script: string) => Promise<unknown>;
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

const hostLayerHolder = vi.hoisted<{ value: HTMLDivElement | null }>(() => ({ value: null }));
const screenshotOptionsHolder = vi.hoisted<{ value: TestUseScreenshotOptions | null }>(() => ({ value: null }));
const screenshotCapturingHolder = vi.hoisted<{ value: boolean }>(() => ({ value: false }));
const captureSelectedElementScreenshotMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const executeJavaScriptMockHolder = vi.hoisted<{ value: ReturnType<typeof vi.fn<(script: string) => Promise<unknown>>> | null }>(() => ({ value: null }));

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
  useChatContext: vi.fn()
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
    screenshotOptionsHolder.value = options;
    return {
      isCapturing: screenshotCapturingHolder,
      captureViewportScreenshot: vi.fn().mockResolvedValue(undefined),
      captureFullPageScreenshot: vi.fn().mockResolvedValue(undefined),
      captureSelectedElementScreenshot: captureSelectedElementScreenshotMock
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
    hostLayerHolder.value = hostLayer;
    return hostLayer;
  },
  ensureHostedWebviewElement: (hostLayer: HTMLElement) => {
    const element = document.createElement('webview') as TestWebviewElement;
    element.canGoBack = vi.fn(() => false);
    element.canGoForward = vi.fn(() => false);
    element.loadURL = vi.fn();
    element.goBack = vi.fn();
    element.goForward = vi.fn();
    element.reload = vi.fn();
    element.stop = vi.fn();
    element.setUserAgent = vi.fn();
    const executeJavaScriptMock = vi.fn<(script: string) => Promise<unknown>>(() => Promise.resolve(null));
    element.executeJavaScript = executeJavaScriptMock;
    executeJavaScriptMockHolder.value = executeJavaScriptMock;
    hostLayer.appendChild(element);
    return element;
  }
}));

/**
 * 挂载 WebView 页面。
 * @returns Vue Test Utils 包装器
 */
function mountWebviewPage(): VueWrapper {
  return shallowMount(WebviewPage, {
    global: {
      stubs: {
        AddressBar: true,
        BPanelSplitter: {
          name: 'BPanelSplitter',
          template: '<div><slot /></div>'
        },
        DeviceToolbar: true,
        InspectorPanel: true
      }
    }
  });
}

/**
 * 创建测试用元素选择结果。
 * @returns 元素选择结果
 */
function createElementSelection(): WebviewElementSelection {
  return {
    tagName: 'DIV',
    id: 'target',
    className: 'target-card',
    text: '目标元素',
    selector: 'div#target',
    attributes: [],
    ancestors: [],
    computedStyles: {},
    rect: {
      x: 12,
      y: 24,
      pageX: 12,
      pageY: 24,
      width: 120,
      height: 36
    }
  };
}

/**
 * 发送 WebView ipc-message 事件。
 * @param element - WebView 元素
 * @param payload - IPC 消息负载
 */
function dispatchHostMessage(element: Element, payload: unknown): void {
  const event = new Event('ipc-message') as Event & { channel: string; args: unknown[] };
  Object.defineProperty(event, 'channel', { value: TIBIS_WEBVIEW_HOST_CHANNEL });
  Object.defineProperty(event, 'args', { value: [payload] });
  element.dispatchEvent(event);
}

describe('webview screenshot wiring', () => {
  beforeEach((): void => {
    hostLayerHolder.value = null;
    screenshotOptionsHolder.value = null;
    screenshotCapturingHolder.value = false;
    executeJavaScriptMockHolder.value = null;
    captureSelectedElementScreenshotMock.mockClear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 0;
    });
  });

  afterEach((): void => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('style');
    document.body.innerHTML = '';
  });

  it('lets useScreenshot own the hosted capture mask', (): void => {
    const wrapper = mountWebviewPage();
    const screenshotOptions = screenshotOptionsHolder.value;

    expect(screenshotOptions?.webviewElementRef.value).toBe(hostLayerHolder.value?.querySelector('webview'));
    expect(screenshotOptions?.onCaptureMaskVisibleChange).toBeUndefined();

    wrapper.unmount();
  });

  it('opens the inspector on the first selected element and respects manual close', async (): Promise<void> => {
    const wrapper = mountWebviewPage();
    const webviewElement = hostLayerHolder.value?.querySelector('webview');
    const selection = createElementSelection();

    if (!webviewElement) {
      throw new Error('webview element should exist');
    }

    dispatchHostMessage(webviewElement, { kind: 'element-picker-selection', selection });
    await nextTick();

    expect(wrapper.findComponent({ name: 'InspectorPanel' }).exists()).toBe(true);

    wrapper.findComponent({ name: 'InspectorPanel' }).vm.$emit('close');
    await nextTick();
    dispatchHostMessage(webviewElement, { kind: 'element-picker-selection', selection: { ...selection, selector: 'div#target-2' } });
    await nextTick();

    expect(wrapper.findComponent({ name: 'InspectorPanel' }).exists()).toBe(false);

    wrapper.unmount();
  });

  it('stops element selection when the inspector is closed', async (): Promise<void> => {
    const wrapper = mountWebviewPage();
    const webviewElement = hostLayerHolder.value?.querySelector('webview');
    const executeJavaScriptMock = executeJavaScriptMockHolder.value;
    const selection = createElementSelection();

    if (!webviewElement || !executeJavaScriptMock) {
      throw new Error('webview element should be ready');
    }

    executeJavaScriptMock.mockImplementationOnce(
      () =>
        new Promise((): void => {
          // 保持元素选择脚本挂起，用于模拟真实的持续选择模式。
        })
    );
    wrapper.findComponent({ name: 'AddressBar' }).vm.$emit('select-element');
    await nextTick();
    await Promise.resolve();
    executeJavaScriptMock.mockClear();

    dispatchHostMessage(webviewElement, { kind: 'element-picker-selection', selection });
    await nextTick();

    wrapper.findComponent({ name: 'InspectorPanel' }).vm.$emit('close');
    await nextTick();
    await Promise.resolve();

    expect(executeJavaScriptMock).toHaveBeenCalledTimes(1);
    expect(executeJavaScriptMock.mock.calls.at(-1)?.[0]).toContain('__tibisElementPickerCleanup');

    wrapper.unmount();
  });

  it('stops active element selection when the page unmounts', async (): Promise<void> => {
    const wrapper = mountWebviewPage();
    const executeJavaScriptMock = executeJavaScriptMockHolder.value;

    if (!executeJavaScriptMock) {
      throw new Error('executeJavaScript mock should exist');
    }

    executeJavaScriptMock.mockImplementationOnce(
      () =>
        new Promise((): void => {
          // 保持元素选择脚本挂起，用于模拟离开页面时仍处于持续选择模式。
        })
    );
    wrapper.findComponent({ name: 'AddressBar' }).vm.$emit('select-element');
    await nextTick();
    await Promise.resolve();
    executeJavaScriptMock.mockClear();

    wrapper.unmount();
    await Promise.resolve();

    expect(executeJavaScriptMock).toHaveBeenCalledTimes(1);
    expect(executeJavaScriptMock.mock.calls.at(-1)?.[0]).toContain('__tibisElementPickerCleanup');
  });

  it('uses theme colors for the element picker highlight without a floating toolbar', async (): Promise<void> => {
    document.documentElement.style.setProperty('--color-primary', '#123456');
    document.documentElement.style.setProperty('--color-primary-bg', 'rgb(18 52 86 / 10%)');
    document.documentElement.style.setProperty('--color-primary-border', '#789abc');

    const wrapper = mountWebviewPage();
    const executeJavaScriptMock = executeJavaScriptMockHolder.value;

    if (!executeJavaScriptMock) {
      throw new Error('executeJavaScript mock should exist');
    }

    wrapper.findComponent({ name: 'AddressBar' }).vm.$emit('select-element');
    await nextTick();
    await Promise.resolve();

    const [script] = executeJavaScriptMock.mock.calls[0] ?? [];

    if (typeof script !== 'string') {
      throw new Error('element picker script should be generated');
    }

    expect(script.match(/border:2px solid #789abc;/g) ?? []).toHaveLength(2);
    expect(script).toContain('background:rgb(18 52 86 / 10%);');
    expect(script).toContain('background:transparent;');
    expect(script).not.toContain('.tibis-element-picker-toolbar');
    expect(script).not.toContain('data-tibis-element-picker-action');

    wrapper.unmount();
  });

  it('captures the selected element when the address bar action is emitted', async (): Promise<void> => {
    const wrapper = mountWebviewPage();
    const webviewElement = hostLayerHolder.value?.querySelector('webview');
    const selection = createElementSelection();

    if (!webviewElement) {
      throw new Error('webview element should exist');
    }

    dispatchHostMessage(webviewElement, { kind: 'element-picker-selection', selection });
    await nextTick();
    wrapper.findComponent({ name: 'AddressBar' }).vm.$emit('capture-selected-element-screenshot');
    await nextTick();

    expect(captureSelectedElementScreenshotMock).toHaveBeenCalledWith(expect.objectContaining({ selector: 'div#target' }));

    wrapper.unmount();
  });

  it('captures the selected element when the inspector action is emitted', async (): Promise<void> => {
    const wrapper = mountWebviewPage();
    const webviewElement = hostLayerHolder.value?.querySelector('webview');
    const selection = createElementSelection();

    if (!webviewElement) {
      throw new Error('webview element should exist');
    }

    dispatchHostMessage(webviewElement, { kind: 'element-picker-selection', selection });
    await nextTick();
    wrapper.findComponent({ name: 'InspectorPanel' }).vm.$emit('capture-selected-element-screenshot', selection);
    await nextTick();

    expect(captureSelectedElementScreenshotMock).toHaveBeenCalledWith(expect.objectContaining({ selector: 'div#target' }));

    wrapper.unmount();
  });

  it('ignores repeated address bar selected element screenshot clicks while a screenshot is running', async (): Promise<void> => {
    const wrapper = mountWebviewPage();
    const webviewElement = hostLayerHolder.value?.querySelector('webview');
    const selection = createElementSelection();

    if (!webviewElement) {
      throw new Error('webview element should exist');
    }

    captureSelectedElementScreenshotMock.mockImplementation((): Promise<void> => {
      screenshotCapturingHolder.value = true;
      return new Promise((): void => {
        // 保持截图任务挂起，用于验证后续点击会被进行中状态拦截。
      });
    });

    dispatchHostMessage(webviewElement, { kind: 'element-picker-selection', selection });
    await nextTick();
    wrapper.findComponent({ name: 'AddressBar' }).vm.$emit('capture-selected-element-screenshot');
    await nextTick();
    wrapper.findComponent({ name: 'AddressBar' }).vm.$emit('capture-selected-element-screenshot');
    await nextTick();

    expect(captureSelectedElementScreenshotMock).toHaveBeenCalledTimes(1);

    wrapper.unmount();
  });
});
