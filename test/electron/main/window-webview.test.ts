/**
 * @file window-webview.test.ts
 * @description Electron WebView 新窗口请求处理测试。
 */
import { describe, expect, it, vi } from 'vitest';
import { createWindowOpenHandler } from '../../../electron/main/window.mts';

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: vi.fn()
}));

vi.mock('../../../electron/main/modules/webview/ipc.mjs', () => ({
  normalizeAttachedWebviewUrl: (url: string): string => url,
  sanitizeAttachedWebPreferences: (preferences: Record<string, unknown>): Record<string, unknown> => preferences
}));

/** 避免测试数据中的脚本协议字面量触发 no-script-url。 */
const SCRIPT_SCHEME_URL = ['javascript', 'alert(1)'].join(':');

describe('webview window open handler', (): void => {
  it.each(['https://example.com/path', 'http://example.com/path'])('forwards supported URL %s and denies the native window', (url: string): void => {
    const send = vi.fn<(targetUrl: string) => void>();
    const handler = createWindowOpenHandler(send);

    expect(handler({ url })).toEqual({ action: 'deny' });
    expect(send).toHaveBeenCalledWith(url);
  });

  it.each([SCRIPT_SCHEME_URL, 'file:///tmp/example.html', 'not a url'])('rejects unsupported URL %s without forwarding it', (url: string): void => {
    const send = vi.fn<(targetUrl: string) => void>();
    const handler = createWindowOpenHandler(send);

    expect(handler({ url })).toEqual({ action: 'deny' });
    expect(send).not.toHaveBeenCalled();
  });
});
