/**
 * @file types.ts
 * @description WebView 页面共享类型定义。
 */
import type { Ref } from 'vue';

/**
 * WebView 页面状态。
 */
export interface WebviewPageState {
  /** 当前地址 */
  url: string;
  /** 页面标题 */
  title: string;
  /** 页面 favicon URL */
  favicon: string;
  /** 是否正在加载 */
  isLoading: boolean;
  /** 是否正在选择页面 DOM 元素 */
  isElementSelecting: boolean;
  /** 是否启用 touch 事件模拟 */
  isTouchSimulationEnabled: boolean;
  /** 是否可以后退 */
  canGoBack: boolean;
  /** 是否可以前进 */
  canGoForward: boolean;
  /** 近似加载进度 */
  loadProgress: number;
}

/**
 * WebView Agent 活动阶段。
 */
export type WebviewAgentActivityPhase = 'idle' | 'reading' | 'operating' | 'success' | 'error';

/**
 * WebView Agent 当前活动状态。
 */
export interface WebviewAgentActivity {
  /** 当前活动阶段 */
  phase: WebviewAgentActivityPhase;
  /** 展示给用户的状态文案 */
  label: string;
  /** 活动开始时间 */
  startedAt: number;
  /** 活动完成时间 */
  finishedAt?: number;
}

/**
 * WebView 元素属性。
 */
export interface WebviewElementAttribute {
  /** 属性名 */
  name: string;
  /** 属性值 */
  value: string;
}

/**
 * WebView 元素层级节点。
 */
export interface WebviewElementAncestor {
  /** 元素标签名 */
  tagName: string;
  /** 层级节点选择器 */
  selector: string;
}

/**
 * WebView 元素选择结果。
 */
export interface WebviewElementSelection {
  /** 元素标签名 */
  tagName: string;
  /** 元素 ID */
  id: string;
  /** 元素 className */
  className: string;
  /** 元素可读文本 */
  text: string;
  /** 元素中的图标字体私有字区字符 */
  glyph?: string;
  /** 可复用的 CSS 选择器 */
  selector: string;
  /** 元素属性列表 */
  attributes: WebviewElementAttribute[];
  /** 当前元素的祖先层级 */
  ancestors: WebviewElementAncestor[];
  /** 精选计算样式 */
  computedStyles: Record<string, string>;
  /** 元素视口矩形 */
  rect: {
    /** 横向位置 */
    x: number;
    /** 纵向位置 */
    y: number;
    /** 元素在页面中的横向位置 */
    pageX?: number;
    /** 元素在页面中的纵向位置 */
    pageY?: number;
    /** 宽度 */
    width: number;
    /** 高度 */
    height: number;
  };
}

/**
 * 跨实现共享的最小控制接口。
 */
export interface WebviewController {
  /** 响应式页面状态 */
  state: Ref<WebviewPageState>;
  /** 初始化或创建 WebView */
  create(initialUrl: string): Promise<void> | void;
  /** 导航到目标地址 */
  navigate(url: string): Promise<void> | void;
  /** 后退 */
  goBack(): Promise<void> | void;
  /** 前进 */
  goForward(): Promise<void> | void;
  /** 刷新 */
  reload(): Promise<void> | void;
  /** 停止加载 */
  stop(): Promise<void> | void;
  /** 打开当前页面开发者工具 */
  openDevTools?(): Promise<void> | void;
}

/**
 * WebView 标题同步参数。
 */
export interface WebviewTabTitleOptions {
  /** 当前页面完整路由 */
  routeFullPath: string;
  /** 当前页面标题 */
  title: Ref<string>;
}
