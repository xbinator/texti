/**
 * @file useWebviewNewTab.ts
 * @description 将 WebView 新窗口请求路由为 Tibis 应用标签页。
 */
import { onScopeDispose } from 'vue';
import { useRouter } from 'vue-router';
import { getElectronAPI, hasElectronAPI } from '@/shared/platform/electron-api';

/**
 * 注册 WebView 新标签页导航监听。
 */
export function useWebviewNewTab(): void {
  if (!hasElectronAPI()) {
    return;
  }

  const router = useRouter();
  const unregister = getElectronAPI().webview.onOpenInNewTab((url: string): void => {
    router.push({
      name: 'webview-web',
      query: { url: encodeURIComponent(url) }
    });
  });

  onScopeDispose(unregister);
}
