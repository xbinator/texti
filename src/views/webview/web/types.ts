/**
 * @file types.ts
 * @description WebView 页面快照、操作输入与 Chat 上下文领域类型。
 */

/**
 * WebView 页面标题节点。
 */
export interface WebviewPageHeading {
  /** 标题层级，1 到 6。 */
  level: number;
  /** 标题文本。 */
  text: string;
}

/**
 * WebView 页面链接。
 */
export interface WebviewPageLink {
  /** 链接文本。 */
  text: string;
  /** 解析后的链接地址。 */
  href: string;
}

/**
 * WebView 选中元素属性。
 */
export interface WebviewSelectedElementAttribute {
  /** 属性名。 */
  name: string;
  /** 属性值。 */
  value: string;
}

/**
 * WebView 选中元素祖先节点。
 */
export interface WebviewSelectedElementAncestor {
  /** 元素标签名。 */
  tagName: string;
  /** 祖先节点选择器。 */
  selector: string;
}

/**
 * WebView 页面字段截断标记。
 */
export interface WebviewPageTruncation {
  /** 正文是否被截断。 */
  text: boolean;
  /** 简化 DOM 内容是否被截断。 */
  content: boolean;
  /** 标题列表是否被截断。 */
  headings: boolean;
  /** 链接列表是否被截断。 */
  links: boolean;
  /** 选中文本是否被截断。 */
  selectedText: boolean;
}

/**
 * WebView 页面滚动状态。
 */
export interface WebviewPageScrollState {
  /** 横向滚动位置。 */
  x: number;
  /** 纵向滚动位置。 */
  y: number;
  /** 视口宽度。 */
  viewportWidth: number;
  /** 视口高度。 */
  viewportHeight: number;
  /** 页面可滚动宽度。 */
  scrollWidth: number;
  /** 页面可滚动高度。 */
  scrollHeight: number;
  /** 是否处于顶部。 */
  atTop: boolean;
  /** 是否处于底部。 */
  atBottom: boolean;
}

/**
 * WebView 视口内矩形。
 */
export interface WebviewViewportRect {
  /** 相对当前视口左侧的 X 坐标。 */
  x: number;
  /** 相对当前视口顶部的 Y 坐标。 */
  y: number;
  /** 元素宽度。 */
  width: number;
  /** 元素高度。 */
  height: number;
}

/**
 * WebView Agent 元素动作。
 */
export type WebviewAgentElementAction = 'click' | 'input' | 'select' | 'press' | 'scroll';

/**
 * WebView 用户手动选中的元素摘要。
 */
export interface WebviewSelectedElementSnapshot {
  /** 元素标签名。 */
  tagName: string;
  /** 元素 ID。 */
  id: string;
  /** 元素 className。 */
  className: string;
  /** 元素可读文本。 */
  text: string;
  /** 元素中的图标字体私有字区字符。 */
  glyph?: string;
  /** 可复用的 CSS 选择器。 */
  selector: string;
  /** 元素属性列表。 */
  attributes: WebviewSelectedElementAttribute[];
  /** 当前元素的祖先层级。 */
  ancestors: WebviewSelectedElementAncestor[];
  /** 精选计算样式。 */
  computedStyles: Record<string, string>;
  /** 元素相对当前视口的矩形。 */
  rect: WebviewViewportRect & { pageX?: number; pageY?: number };
  /** 若该元素匹配当前可操作元素列表，则为对应 index。 */
  matchedIndex?: number;
  /** 匹配到的可操作元素标签。 */
  matchedLabel?: string;
  /** 匹配到的可操作元素动作。 */
  matchedActions?: WebviewAgentElementAction[];
}

/**
 * WebView 可交互元素所在视觉层。
 */
export type WebviewViewportElementLayer = 'page' | 'top' | 'background';

/**
 * WebView 可模拟的按键。
 */
export type WebviewPressKey = 'Enter' | 'Tab' | 'Escape' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

/**
 * WebView 命中测试目标摘要。
 */
export interface WebviewAgentHitTarget {
  /** 命中的元素标签名。 */
  tagName: string;
  /** 命中元素的可读标签。 */
  label: string;
  /** 命中元素是否位于当前可操作元素内部。 */
  insideTarget: boolean;
}

/**
 * WebView Agent 可交互元素。
 */
export interface WebviewAgentElement {
  /** 本次快照内元素索引。 */
  index: number;
  /** 元素标签名。 */
  tagName: string;
  /** ARIA role。 */
  role?: string;
  /** 元素可读文本。 */
  text: string;
  /** 模型可读标签。 */
  label: string;
  /** 推断出的交互角色提示。 */
  roleHint?: string;
  /** 元素身份指纹，用于操作前识别过期快照。 */
  fingerprint?: string;
  /** 输入占位符。 */
  placeholder?: string;
  /** 链接地址。 */
  href?: string;
  /** 非敏感值预览。 */
  valuePreview?: string;
  /** 是否禁用。 */
  disabled: boolean;
  /** 是否选中。 */
  checked?: boolean;
  /** 是否被选择。 */
  selected?: boolean;
  /** 是否为本轮新出现元素。 */
  isNew: boolean;
  /** 元素相对当前视口的矩形。 */
  rect?: WebviewViewportRect;
  /** 元素在当前视口内可见面积比例。 */
  visibleRatio?: number;
  /** 元素是否被顶层浮层遮挡。 */
  covered?: boolean;
  /** 元素所在视觉层。 */
  layer?: WebviewViewportElementLayer;
  /** 是否为当前顶层上下文的主操作。 */
  primary?: boolean;
  /** 可点击/可操作置信分，0 到 1。 */
  clickableScore?: number;
  /** 推断该元素可操作的原因。 */
  reasons?: string[];
  /** 当前元素所在的语义路径。 */
  semanticPath?: string[];
  /** 当前元素中心点命中测试结果。 */
  hitTarget?: WebviewAgentHitTarget;
  /** 支持的动作列表。 */
  actions: WebviewAgentElementAction[];
}

/**
 * WebView 当前视口内可交互元素摘要。
 */
export interface WebviewViewportElement {
  /** 本次快照内元素索引。 */
  index: number;
  /** 元素标签名。 */
  tagName: string;
  /** 模型可读标签。 */
  label: string;
  /** 推断出的交互角色提示。 */
  roleHint?: string;
  /** 支持的动作列表。 */
  actions: WebviewAgentElementAction[];
  /** 元素相对当前视口的矩形。 */
  rect: WebviewViewportRect;
  /** 元素在当前视口内可见面积比例。 */
  visibleRatio: number;
  /** 元素是否被顶层浮层遮挡。 */
  covered: boolean;
  /** 元素所在视觉层。 */
  layer: WebviewViewportElementLayer;
  /** 是否为当前顶层上下文的主操作。 */
  primary: boolean;
  /** 可点击/可操作置信分，0 到 1。 */
  clickableScore?: number;
  /** 推断该元素可操作的原因。 */
  reasons?: string[];
  /** 当前元素所在的语义路径。 */
  semanticPath?: string[];
  /** 当前元素中心点命中测试结果。 */
  hitTarget?: WebviewAgentHitTarget;
}

/**
 * WebView 顶层浮层摘要。
 */
export interface WebviewViewportTopLayer {
  /** 浮层类型。 */
  kind: 'dialog' | 'panel';
  /** 浮层可读标题。 */
  label: string;
  /** 浮层可读文本。 */
  text: string;
  /** 浮层相对当前视口的矩形。 */
  rect: WebviewViewportRect;
  /** 浮层内可交互元素索引。 */
  elementIndexes: number[];
  /** 浮层内主操作元素索引。 */
  primaryActionIndex?: number;
  /** 页面背景是否存在遮罩。 */
  dimmed: boolean;
}

/**
 * WebView 当前视口视觉摘要。
 */
export interface WebviewViewportSnapshot {
  /** 视口宽度。 */
  width: number;
  /** 视口高度。 */
  height: number;
  /** 页面横向滚动位置。 */
  scrollX: number;
  /** 页面纵向滚动位置。 */
  scrollY: number;
  /** 当前顶层浮层。 */
  topLayer?: WebviewViewportTopLayer;
  /** 当前视口内可交互元素摘要。 */
  elements: WebviewViewportElement[];
}

/**
 * WebView 页面快照。
 */
export interface WebviewPageSnapshot {
  /** 页面地址。 */
  url: string;
  /** 页面标题。 */
  title: string;
  /** 给模型优先阅读的 BrowserState 风格摘要。 */
  summary: string;
  /** 页面视口与滚动位置提示。 */
  header: string;
  /** LLM 可读的简化 DOM 结构。 */
  content: string;
  /** 页面底部与剩余滚动提示。 */
  footer: string;
  /** 可见正文。 */
  text: string;
  /** 当前页面选中文本。 */
  selectedText: string;
  /** 页面标题结构。 */
  headings: WebviewPageHeading[];
  /** 页面链接列表。 */
  links: WebviewPageLink[];
  /** 快照采集时间戳。 */
  capturedAt: number;
  /** 各字段截断状态。 */
  truncated: WebviewPageTruncation;
  /** 页面 Agent 观察快照 ID。 */
  snapshotId?: string;
  /** 页面是否正在加载。 */
  loading?: boolean;
  /** 页面滚动信息。 */
  scroll?: WebviewPageScrollState;
  /** 当前视口视觉摘要。 */
  viewport?: WebviewViewportSnapshot;
  /** 用户手动选择的页面元素摘要。 */
  selectedElement?: WebviewSelectedElementSnapshot;
  /** 当前可交互元素列表。 */
  elements?: WebviewAgentElement[];
}

/**
 * WebView 操作动作。
 */
export type WebviewOperateAction =
  | { type: 'click'; index: number }
  | { type: 'input'; index: number; text: string; clear?: boolean }
  | { type: 'select'; index: number; optionText: string }
  | { type: 'press'; index: number; key: WebviewPressKey }
  | { type: 'scroll'; index?: number; direction: 'up' | 'down' | 'left' | 'right'; pixels?: number }
  | { type: 'navigate'; url: string }
  | { type: 'wait'; seconds?: number };

/**
 * WebView 操作输入。
 */
export interface WebviewOperateInput {
  /** read_current_webpage 返回的观察快照 ID，非 navigate 动作必填。 */
  snapshotId?: string;
  /** 要执行的操作。 */
  action: WebviewOperateAction;
}

/**
 * WebView 滚动位置。
 */
export interface WebviewOperateScrollPosition {
  /** 水平滚动偏移。 */
  x: number;
  /** 垂直滚动偏移。 */
  y: number;
}

/**
 * WebView 滚动操作结果。
 */
export interface WebviewOperateScrollResult {
  /** 实际滚动目标类型。 */
  targetType: 'window' | 'element';
  /** 滚动前位置。 */
  before: WebviewOperateScrollPosition;
  /** 滚动后位置。 */
  after: WebviewOperateScrollPosition;
  /** 位置是否发生变化。 */
  changed: boolean;
}

/**
 * WebView 操作结果。
 */
export interface WebviewOperateResult {
  /** 操作是否完成。 */
  ok: boolean;
  /** 实际执行的动作类型。 */
  action: WebviewOperateAction['type'];
  /** 被操作目标摘要。 */
  target: { index: number; label: string; tagName: string } | null;
  /** 给模型看的结果说明。 */
  message: string;
  /** 滚动动作的实际滚动结果。 */
  scroll?: WebviewOperateScrollResult;
  /** 操作是否触发导航。 */
  navigationStarted: boolean;
  /** 页面是否可能发生变化。 */
  pageChanged: boolean;
  /** 是否建议重新读取网页。 */
  shouldReadAgain: boolean;
}

/**
 * WebView 工具上下文。
 */
export interface WebviewToolContext {
  /**
   * 读取当前网页快照。
   * @param signal - Runtime 中断信号
   * @returns 当前网页快照
   */
  readPageSnapshot(signal?: AbortSignal): Promise<WebviewPageSnapshot>;
  /**
   * 操作当前网页。
   * @param input - 网页操作输入
   * @param signal - Runtime 中断信号
   * @returns 网页操作结果
   */
  operatePage(input: WebviewOperateInput, signal?: AbortSignal): Promise<WebviewOperateResult>;
}
