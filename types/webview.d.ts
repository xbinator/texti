/**
 * @file webview.d.ts
 * @description WebView 相关类型定义，供前端和 Electron 主进程共享
 */

/**
 * WebView 状态
 */
export interface WebViewState {
  /** 当前加载的 URL */
  url: string;
  /** 页面标题 */
  title: string;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 是否可以后退 */
  canGoBack: boolean;
  /** 是否可以前进 */
  canGoForward: boolean;
  /** 加载进度 0-1 */
  loadProgress: number;
}

/**
 * WebView 边界矩形（用于 setBounds）
 */
export interface WebViewBounds {
  /** 左上角 x 坐标 */
  x: number;
  /** 左上角 y 坐标 */
  y: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}
