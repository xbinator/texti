/**
 * @file useWebView.test.ts
 * @description 验证 useWebView composable
 */

import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// 模拟 electronAPI
const mockWebview = {
  create: vi.fn(),
  destroy: vi.fn(),
  navigate: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
  reload: vi.fn(),
  stop: vi.fn(),
  setBounds: vi.fn(),
  show: vi.fn(),
  hide: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onStateChanged: vi.fn(() => () => {}),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onTitleUpdated: vi.fn(() => () => {}),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onNavigationStateChanged: vi.fn(() => () => {}),
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  onOpenInNewTab: vi.fn(() => () => {})
};

vi.stubGlobal('window', {
  electronAPI: {
    webview: mockWebview
  }
});

describe('useWebView', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it('should call create with correct tabId and url', async () => {
    const { useWebView } = await import('@/views/webview/hooks/useWebView');

    const tabId = 'test-tab-1';
    const url = 'https://example.com';
    const webview = useWebView(tabId);

    await webview.create(url);

    expect(mockWebview.create).toHaveBeenCalledWith(tabId, url);
  });

  it('should call destroy with correct tabId', async () => {
    const { useWebView } = await import('@/views/webview/hooks/useWebView');

    const tabId = 'test-tab-1';
    const webview = useWebView(tabId);

    await webview.destroy();

    expect(mockWebview.destroy).toHaveBeenCalledWith(tabId);
  });

  it('should call navigate with correct tabId and url', async () => {
    const { useWebView } = await import('@/views/webview/hooks/useWebView');

    const tabId = 'test-tab-1';
    const url = 'https://example.com';
    const webview = useWebView(tabId);

    await webview.navigate(url);

    expect(mockWebview.navigate).toHaveBeenCalledWith(tabId, url);
  });

  it('should call goBack with correct tabId', async () => {
    const { useWebView } = await import('@/views/webview/hooks/useWebView');

    const tabId = 'test-tab-1';
    const webview = useWebView(tabId);

    await webview.goBack();

    expect(mockWebview.goBack).toHaveBeenCalledWith(tabId);
  });

  it('should call goForward with correct tabId', async () => {
    const { useWebView } = await import('@/views/webview/hooks/useWebView');

    const tabId = 'test-tab-1';
    const webview = useWebView(tabId);

    await webview.goForward();

    expect(mockWebview.goForward).toHaveBeenCalledWith(tabId);
  });

  it('should call reload with correct tabId', async () => {
    const { useWebView } = await import('@/views/webview/hooks/useWebView');

    const tabId = 'test-tab-1';
    const webview = useWebView(tabId);

    await webview.reload();

    expect(mockWebview.reload).toHaveBeenCalledWith(tabId);
  });

  it('should call stop with correct tabId', async () => {
    const { useWebView } = await import('@/views/webview/hooks/useWebView');

    const tabId = 'test-tab-1';
    const webview = useWebView(tabId);

    await webview.stop();

    expect(mockWebview.stop).toHaveBeenCalledWith(tabId);
  });

  it('should call setBounds with correct tabId and bounds', async () => {
    const { useWebView } = await import('@/views/webview/hooks/useWebView');

    const tabId = 'test-tab-1';
    const bounds = { x: 0, y: 0, width: 800, height: 600 };
    const webview = useWebView(tabId);

    await webview.setBounds(bounds);

    expect(mockWebview.setBounds).toHaveBeenCalledWith(tabId, bounds);
  });

  it('should call show with correct tabId', async () => {
    const { useWebView } = await import('@/views/webview/hooks/useWebView');

    const tabId = 'test-tab-1';
    const webview = useWebView(tabId);

    await webview.show();

    expect(mockWebview.show).toHaveBeenCalledWith(tabId);
  });

  it('should call hide with correct tabId', async () => {
    const { useWebView } = await import('@/views/webview/hooks/useWebView');

    const tabId = 'test-tab-1';
    const webview = useWebView(tabId);

    await webview.hide();

    expect(mockWebview.hide).toHaveBeenCalledWith(tabId);
  });
});
