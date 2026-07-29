/**
 * @file use-webview-new-tab.test.ts
 * @description WebView 新标签页应用级导航 Hook 测试。
 * @vitest-environment jsdom
 */
import { defineComponent } from 'vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebviewNewTab } from '@/hooks/useWebviewNewTab';

/**
 * WebView 标签页路由位置。
 */
interface WebviewRouteLocation {
  /** 路由名称 */
  name: 'webview-web';
  /** 路由查询参数 */
  query: {
    /** 编码后的目标 URL */
    url: string;
  };
}

const electronAvailable = vi.hoisted(() => ({ value: true }));
const unregisterMock = vi.hoisted(() => vi.fn<() => void>());
const onOpenInNewTabMock = vi.hoisted(() => vi.fn<(callback: (url: string) => void) => () => void>(() => unregisterMock));
const routerPushMock = vi.hoisted(() => vi.fn<(location: WebviewRouteLocation) => Promise<void>>().mockResolvedValue(undefined));

vi.mock('@/shared/platform/electron-api', () => ({
  hasElectronAPI: (): boolean => electronAvailable.value,
  getElectronAPI: () => ({
    webview: {
      onOpenInNewTab: onOpenInNewTabMock
    }
  })
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: routerPushMock
  })
}));

/**
 * WebView 新标签页 Hook 测试宿主。
 */
const TestHost = defineComponent({
  name: 'TestHost',
  setup() {
    useWebviewNewTab();
    return () => null;
  }
});

describe('useWebviewNewTab', (): void => {
  beforeEach((): void => {
    electronAvailable.value = true;
    unregisterMock.mockClear();
    onOpenInNewTabMock.mockClear();
    routerPushMock.mockClear();
  });

  it('opens forwarded URLs as application WebView tabs and unregisters on dispose', (): void => {
    const wrapper = mount(TestHost);
    const callback = onOpenInNewTabMock.mock.calls[0]?.[0];
    const targetUrl = 'https://example.com/path?query=value';

    expect(callback).toBeDefined();
    callback?.(targetUrl);
    expect(routerPushMock).toHaveBeenCalledWith({
      name: 'webview-web',
      query: { url: encodeURIComponent(targetUrl) }
    });

    wrapper.unmount();
    expect(unregisterMock).toHaveBeenCalledTimes(1);
  });

  it('does not register outside Electron', (): void => {
    electronAvailable.value = false;

    const wrapper = mount(TestHost);

    expect(onOpenInNewTabMock).not.toHaveBeenCalled();
    wrapper.unmount();
  });
});
