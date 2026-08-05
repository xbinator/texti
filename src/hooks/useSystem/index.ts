/**
 * @file index.ts
 * @description 系统级事件监听与处理（文件打开、WebView 新标签页路由），支持注册多个处理器，可扩展。
 */
import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useNavigate } from '@/hooks/useNavigate';
import { getElectronAPI, hasElectronAPI } from '@/shared/platform/electron-api';

/**
 * 文件打开处理器类型。
 * 处理器返回值会被忽略，支持同步或异步函数。
 * @param filePath - 系统传入的文件绝对路径
 */
type FileOpenHandler = (filePath: string) => unknown;

/**
 * 模块级处理器注册表，支持跨组件扩展。
 * 其它模块可通过 onSystemOpenFile() 注册额外的处理器。
 */
const handlers: FileOpenHandler[] = [];

/**
 * 注册系统文件打开处理器。
 * 多个处理器会按注册顺序依次执行。
 * @param handler - 文件路径处理函数
 * @returns 取消注册的函数
 */
export function onSystemOpenFile(handler: FileOpenHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
    }
  };
}

/**
 * 引导系统级事件监听。
 * 应在 App.vue 根组件中调用一次，负责绑定 Electron IPC 事件（文件打开、WebView 新窗口请求）并在组件卸载时清理。
 */
export function useSystem(): void {
  let unregisterOpenFileListener: (() => void) | undefined;
  let unregisterWebviewNewTabListener: (() => void) | undefined;

  // 注册默认处理器：将系统传入的文件路径在编辑器中打开
  const { openFileByPath } = useNavigate();
  const router = useRouter();
  onSystemOpenFile((filePath: string) => openFileByPath(filePath));

  onMounted(() => {
    // 非 Electron 环境（如纯 Web 降级）不注册任何系统级监听
    if (!hasElectronAPI()) {
      return;
    }

    const electronApi = getElectronAPI();

    // 系统文件打开事件：依次调用已注册处理器（macOS "打开方式" 等）
    unregisterOpenFileListener = electronApi.onOpenFile((filePath: string) => {
      handlers.forEach((handler) => {
        handler(filePath);
      });
    });

    // WebView 远程页面新窗口请求：导航为应用内 webview-web 标签页。
    // 主进程已校验仅放行 HTTP/HTTPS URL，此处直接路由，无需再次校验。
    unregisterWebviewNewTabListener = electronApi.webview.onOpenInNewTab((url: string): void => {
      router.push({ name: 'webview-web', query: { url: encodeURIComponent(url) } });
    });
  });

  onUnmounted(() => {
    unregisterOpenFileListener?.();
    unregisterWebviewNewTabListener?.();
  });
}
