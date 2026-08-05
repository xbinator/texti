/**
 * @file types.ts
 * @description WebView 自动化引擎扁平 DOM 树的可序列化类型。
 */
import type { WebviewAgentElementAction, WebviewViewportElementLayer, WebviewViewportRect } from '@/views/webview/web/types';

/**
 * 页面 DOM 节点滚动距离。
 */
export interface EngineScrollData {
  /** 距离顶部可滚动像素。 */
  top: number;
  /** 距离右侧可滚动像素。 */
  right: number;
  /** 距离底部可滚动像素。 */
  bottom: number;
  /** 距离左侧可滚动像素。 */
  left: number;
}

/**
 * 页面 DOM 节点扩展信息。
 */
export interface EngineNodeExtra {
  /** 节点是否可滚动。 */
  scrollable?: boolean;
  /** 节点滚动距离。 */
  scrollData?: EngineScrollData;
}

/**
 * 页面 DOM 文本节点。
 */
export interface EngineTextNode {
  /** 节点类型。 */
  type: 'TEXT_NODE';
  /** 节点文本。 */
  text: string;
  /** 是否可见。 */
  isVisible: boolean;
}

/**
 * 页面 DOM 元素节点。
 */
export interface EngineElementNode {
  /** 节点类型。 */
  type: 'ELEMENT_NODE';
  /** 元素标签名。 */
  tagName: string;
  /** 元素属性。 */
  attributes: Record<string, string>;
  /** 子节点 ID。 */
  children: string[];
  /** 是否可见。 */
  isVisible: boolean;
  /** 是否处于命中测试顶层。 */
  isTopElement: boolean;
  /** 是否在视口内。 */
  isInViewport: boolean;
  /** 是否为可交互元素。 */
  isInteractive: boolean;
  /** 本次快照内高亮索引。 */
  highlightIndex?: number;
  /** 是否为新出现元素。 */
  isNew: boolean;
  /** 元素可读文本。 */
  text: string;
  /** 元素可读标签。 */
  label: string;
  /** 元素身份指纹。 */
  fingerprint: string;
  /** 元素角色提示。 */
  roleHint?: string;
  /** 元素支持动作。 */
  actions: WebviewAgentElementAction[];
  /** 元素相对视口矩形。 */
  rect?: WebviewViewportRect;
  /** 元素可见比例。 */
  visibleRatio?: number;
  /** 元素视觉层。 */
  layer?: WebviewViewportElementLayer;
  /** 是否被顶层浮层覆盖。 */
  covered?: boolean;
  /** 是否为顶层主操作。 */
  primary?: boolean;
  /** 可操作置信分。 */
  clickableScore?: number;
  /** 可操作原因。 */
  reasons?: string[];
  /** 语义路径。 */
  semanticPath?: string[];
  /** 扩展数据。 */
  extra?: EngineNodeExtra;
  /** 是否包含开放 shadow root。 */
  shadowRoot?: boolean;
}

/**
 * 页面 DOM 节点。
 */
export type EngineNode = EngineTextNode | EngineElementNode;

/**
 * 页面扁平 DOM 树。
 */
export interface EngineFlatTree {
  /** 根节点 ID。 */
  rootId: string;
  /** 节点表。 */
  map: Record<string, EngineNode>;
}
