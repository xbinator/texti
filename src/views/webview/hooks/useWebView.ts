/**
 * WebView Composable
 * @description 封装 WebView 的 IPC 通信逻辑，提供响应式的 WebView 状态管理
 */
import type { WebViewState, WebViewBounds } from '../types';
import { ref, onMounted, onUnmounted, type Ref } from 'vue';

/**
 * 创建 WebView 控制 hook
 * @param tabId - Tab ID，可以是 Ref 或 string
 * @returns WebView 控制器对象
 */
export function useWebView(tabId: Ref<string> | string) {
  // 解析 tabId 值
  const tabIdValue = typeof tabId === 'string' ? tabId : tabId.value;

  /** WebView 状态（响应式） */
  const state = ref<Partial<WebViewState>>({});

  /**
   * 创建 WebContentsView 实例
   * @param url - 初始加载 URL
   */
  const create = (url: string) => {
    state.value.url = url;

    window.electronAPI!.webview.create(tabIdValue, url);
  };

  /** 销毁 WebContentsView 实例 */
  const destroy = () => window.electronAPI!.webview.destroy(tabIdValue);

  /**
   * 导航到指定 URL
   * @param url - 目标 URL
   */
  const navigate = (url: string) => {
    state.value.url = url;

    window.electronAPI!.webview.navigate(tabIdValue, url);
  };

  /** 后退到上一页 */
  const goBack = () => window.electronAPI!.webview.goBack(tabIdValue);

  /** 前进到下一页 */
  const goForward = () => window.electronAPI!.webview.goForward(tabIdValue);

  /** 刷新当前页面 */
  const reload = () => window.electronAPI!.webview.reload(tabIdValue);

  /** 停止当前加载 */
  const stop = () => window.electronAPI!.webview.stop(tabIdValue);

  /**
   * 设置 WebContentsView 尺寸和位置
   * @param bounds - WebViewBounds { x, y, width, height }
   */
  const setBounds = (bounds: WebViewBounds) => window.electronAPI!.webview.setBounds(tabIdValue, bounds);

  /** 显示 WebContentsView（设置可见 bounds） */
  const show = () => window.electronAPI!.webview.show(tabIdValue);

  /** 隐藏 WebContentsView（设置 zero bounds） */
  const hide = () => window.electronAPI!.webview.hide(tabIdValue);

  // 事件取消订阅函数
  let unsubState: (() => void) | null = null;
  let unsubTitle: (() => void) | null = null;
  let unsubNav: (() => void) | null = null;
  let unsubOpenInNewTab: (() => void) | null = null;

  /**
   * 设置 IPC 事件监听
   * - state-changed: 加载状态变化
   * - title-updated: 页面标题更新
   * - navigation-state-changed: 导航状态变化
   */
  const setupListeners = () => {
    // 监听加载状态变化
    unsubState = window.electronAPI!.webview.onStateChanged((id, s) => {
      if (id !== tabIdValue) return;

      state.value.isLoading = s.isLoading;
      state.value.loadProgress = s.loadProgress;
      if (s.url) state.value.url = s.url;
    });

    // 监听页面标题更新
    unsubTitle = window.electronAPI!.webview.onTitleUpdated((id, title) => {
      if (id !== tabIdValue) return;

      state.value.title = title;
    });

    // 监听导航状态变化（是否可前进/后退）
    unsubNav = window.electronAPI!.webview.onNavigationStateChanged((id, canGoBack, canGoForward) => {
      if (id !== tabIdValue) return;

      state.value.canGoBack = canGoBack;
      state.value.canGoForward = canGoForward;
    });
  };

  /**
   * 注册"在新标签页打开"事件监听
   * @param callback - 打开新标签页的回调函数
   * @returns 取消订阅函数
   */
  const onOpenInNewTab = (callback: (url: string) => void) => {
    unsubOpenInNewTab = window.electronAPI!.webview.onOpenInNewTab((url) => {
      callback(url);
    });
    return () => unsubOpenInNewTab?.();
  };

  /** 清理所有事件监听 */
  const cleanupListeners = () => {
    unsubState?.();
    unsubTitle?.();
    unsubNav?.();
    unsubOpenInNewTab?.();
  };

  // 组件挂载时设置监听
  onMounted(() => {
    setupListeners();
  });

  // 组件卸载时清理监听
  onUnmounted(() => {
    cleanupListeners();
  });

  return {
    state,
    create,
    destroy,
    navigate,
    goBack,
    goForward,
    reload,
    stop,
    setBounds,
    show,
    hide,
    onOpenInNewTab
  };
}
