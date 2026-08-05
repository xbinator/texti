/**
 * @file web-recent-record.test.ts
 * @description 验证 WebView 页面只在首次导航完成时写入最近记录。
 * @vitest-environment jsdom
 */
import type { VueWrapper } from '@vue/test-utils';
import { shallowMount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebviewPage from '@/views/webview/web/index.vue';

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
}

const addWebviewRecordMock = vi.hoisted(() =>
  vi.fn<(_url: string, _title: string, _options?: { favicon?: string }) => Promise<void>>().mockResolvedValue(undefined)
);
const webviewElementHolder = vi.hoisted<{ value: TestWebviewElement | null }>(() => ({ value: null }));

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
    addWebviewRecord: addWebviewRecordMock
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
  ensureWebviewHostLayer: () => document.createElement('div'),
  ensureHostedWebviewElement: () => {
    const element = document.createElement('webview') as TestWebviewElement;
    element.canGoBack = vi.fn(() => false);
    element.canGoForward = vi.fn(() => false);
    element.loadURL = vi.fn();
    element.goBack = vi.fn();
    element.goForward = vi.fn();
    element.reload = vi.fn();
    element.stop = vi.fn();
    element.setUserAgent = vi.fn();
    webviewElementHolder.value = element;
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
        BPanelSplitter: true,
        DeviceToolbar: true,
        InspectorPanel: true
      }
    }
  });
}

/**
 * 创建带 url 字段的导航事件。
 * @param url - 导航后的地址
 * @returns WebView 导航事件
 */
function createNavigateEvent(url: string): Event {
  const event = new Event('did-navigate');
  Object.defineProperty(event, 'url', { value: url });
  return event;
}

/**
 * 创建带 title 字段的页面标题事件。
 * @param title - 页面标题
 * @returns WebView 标题事件
 */
function createTitleEvent(title: string): Event {
  const event = new Event('page-title-updated');
  Object.defineProperty(event, 'title', { value: title });
  return event;
}

/**
 * 创建带 favicons 字段的页面 favicon 事件。
 * @param favicons - 页面 favicon URL 列表
 * @returns WebView favicon 事件
 */
function createFaviconEvent(favicons: string[]): Event {
  const event = new Event('page-favicon-updated');
  Object.defineProperty(event, 'favicons', { value: favicons });
  return event;
}

describe('webview recent record', () => {
  beforeEach((): void => {
    vi.useFakeTimers();
    addWebviewRecordMock.mockClear();
    webviewElementHolder.value = null;
  });

  afterEach((): void => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('writes recent record only for the first completed navigation', async (): Promise<void> => {
    const wrapper = mountWebviewPage();
    const element = webviewElementHolder.value;

    expect(element).not.toBeNull();

    element?.dispatchEvent(createNavigateEvent('https://example.com'));
    await vi.advanceTimersByTimeAsync(350);

    element?.dispatchEvent(createNavigateEvent('https://example.com/page-a'));
    await vi.advanceTimersByTimeAsync(350);

    element?.dispatchEvent(createNavigateEvent('https://example.com/page-b'));
    await vi.advanceTimersByTimeAsync(350);

    expect(addWebviewRecordMock).toHaveBeenCalledTimes(1);
    expect(addWebviewRecordMock).toHaveBeenCalledWith('https://example.com', 'https://example.com', undefined);

    wrapper.unmount();
  });

  it('writes the page favicon together with the latest title', async (): Promise<void> => {
    const wrapper = mountWebviewPage();
    const element = webviewElementHolder.value;

    expect(element).not.toBeNull();

    element?.dispatchEvent(createNavigateEvent('https://example.com'));
    element?.dispatchEvent(createTitleEvent('Example Domain'));
    element?.dispatchEvent(createFaviconEvent(['https://example.com/favicon.ico']));
    await vi.advanceTimersByTimeAsync(350);

    expect(addWebviewRecordMock).toHaveBeenCalledTimes(1);
    expect(addWebviewRecordMock).toHaveBeenCalledWith('https://example.com', 'Example Domain', { favicon: 'https://example.com/favicon.ico' });

    wrapper.unmount();
  });
});
