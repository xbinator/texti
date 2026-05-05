/**
 * @file selectionAssistant.ts
 * @description 选区工具适配器协议，定义 rich/source 双模式统一的选区交互接口。
 */
import type { EditorState } from '../types';

/**
 * 选区范围信息。
 */
export interface SelectionAssistantRange {
  from: number;
  to: number;
  text: string;
  /** 选区快照生成时的文档版本，用于校验范围是否仍然可信 */
  docVersion?: number;
  /** 可选的快照标识，用于跨阶段追踪同一轮 AI / 引用流程 */
  snapshotId?: string;
}

/**
 * 矩形区域信息。
 */
export interface SelectionAssistantRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * 浮层定位信息。
 */
export interface SelectionAssistantPosition {
  /** 相对当前编辑器浮层容器的锚点矩形，默认基于当前选区末行 */
  anchorRect: SelectionAssistantRect;
  /** 当前选区末行的视觉高度，用于面板与工具栏的纵向间距计算 */
  lineHeight: number;
  /** 可选的容器矩形，供宿主做 viewport clamp 或溢出处理 */
  containerRect?: SelectionAssistantRect;
}

/**
 * 聊天引用上下文。
 */
export interface SelectionReferencePayload {
  id: string;
  ext: string;
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  renderStartLine: number;
  renderEndLine: number;
}

/**
 * 工具栏支持的动作类型。
 */
export type SelectionToolbarAction = 'ai' | 'reference' | 'bold' | 'italic' | 'underline' | 'strike' | 'code';

/**
 * 选区工具能力声明。
 */
export interface SelectionAssistantCapabilities {
  actions: Partial<Record<SelectionToolbarAction, boolean>>;
}

/**
 * 适配器构建所需的编辑器上下文。
 */
export interface SelectionAssistantContext {
  /** BEditor 自定义文件上下文 */
  editorState: EditorState;
  /** 宿主注入的浮层根容器；adapter 返回的所有定位信息都必须相对该容器 */
  overlayRoot: HTMLElement;
}

/**
 * 选区工具适配器协议。
 */
export interface SelectionAssistantAdapter {
  dispose?(): void;
  getCapabilities(): SelectionAssistantCapabilities;
  isEditable(): boolean;
  getSelection(): SelectionAssistantRange | null;
  /** 在 AI 内容应用前恢复缓存选区，不等同于任意时刻覆写当前选区 */
  restoreSelection(range: SelectionAssistantRange): void;
  /** 判断缓存选区是否仍然有效；失效时编排层需阻止应用并提示重新选择 */
  isRangeStillValid?(range: SelectionAssistantRange): boolean;
  /**
   * 清理原生选中态，让视觉层退回到 adapter 的高亮实现。
   * 若未实现，编排层默认不主动清理原生选区，只依赖宿主自身行为。
   */
  clearNativeSelection?(): void;
  /** 供 AI 输入面板使用，锚点默认基于当前选区末行 */
  getPanelPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null;
  /** 供选区工具栏使用，锚点默认基于当前选区首行 */
  getToolbarPosition(range: SelectionAssistantRange): SelectionAssistantPosition | null;
  showSelectionHighlight(range: SelectionAssistantRange): void;
  clearSelectionHighlight(): void;
  /**
   * 允许抛出异常；由编排层统一捕获并决定 UI 反馈。
   * 建议至少区分"可重试"和"不可重试"两类失败。
   */
  applyGeneratedContent(range: SelectionAssistantRange, content: string): Promise<void>;
  buildSelectionReference(range: SelectionAssistantRange): SelectionReferencePayload | null;
  bindSelectionEvents(handlers: {
    onSelectionChange: () => void;
    onFocus: () => void;
    /** 仅供编排层同步高亮与显隐，不承载 rich 模式的 BubbleMenu 恢复策略 */
    onBlur: (event?: FocusEvent) => void;
    onPointerDownInsideEditor?: (event: PointerEvent) => void;
    onPointerDownOutsideEditor?: (event: PointerEvent) => void;
    onEscape?: () => void;
  }): () => void;
}
