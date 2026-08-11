/**
 * @file types.ts
 * @description BMessage 组件属性、消息节点与渲染上下文类型定义。
 */
/* eslint-disable no-use-before-define -- 消息节点是递归 AST，BlockNode 与 InlineNode 需要相互引用。 */
import type { InjectionKey } from 'vue';
import type { ImagePreviewItem } from '@/hooks/useImagePreview';

/**
 * BMessage 组件属性。
 */
export interface BMessageProps {
  /** 用于无正文诊断的消息或 Part 稳定标识。 */
  messageId?: string;
  /** 累积的文本内容（父组件负责拼接 chunk） */
  content?: string;
  /** 流式状态 */
  loading?: boolean;
  /** 内容类型：markdown 渲染富文本，text 渲染纯文本 */
  type?: MessageNodeRenderMode;
  /** 高度 */
  height?: number | string;
  /** 最大高度 */
  maxHeight?: number | string;
}

/**
 * 消息节点渲染模式。
 */
export type MessageNodeRenderMode = 'markdown' | 'text';

/**
 * 消息节点基础字段。
 */
export interface MessageNodeBase {
  /** 稳定节点 ID，用作 Vue key */
  id: string;
  /** 原始源码文本，便于生成稳定 ID 与调试 */
  raw: string;
}

/**
 * 段落块节点。
 */
export interface ParagraphBlockNode extends MessageNodeBase {
  /** 节点类型 */
  type: 'paragraph';
  /** 段落行内子节点 */
  children: InlineNode[];
}

/**
 * 标题块节点。
 */
export interface HeadingBlockNode extends MessageNodeBase {
  /** 节点类型 */
  type: 'heading';
  /** 标题级别，范围 1-6 */
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  /** 标题行内子节点 */
  children: InlineNode[];
}

/**
 * 列表项节点。
 */
export interface ListItemNode {
  /** 列表项稳定 ID */
  id: string;
  /** 原始源码文本 */
  raw: string;
  /** 是否为任务列表项 */
  task: boolean;
  /** 任务列表项是否已选中 */
  checked?: boolean;
  /** 列表项内的块级子节点 */
  children: BlockNode[];
}

/**
 * 列表块节点。
 */
export interface ListBlockNode extends MessageNodeBase {
  /** 节点类型 */
  type: 'list';
  /** 是否为有序列表 */
  ordered: boolean;
  /** 有序列表起始编号 */
  start: number | '';
  /** 列表项 */
  items: ListItemNode[];
}

/**
 * 引用块节点。
 */
export interface BlockquoteBlockNode extends MessageNodeBase {
  /** 节点类型 */
  type: 'blockquote';
  /** 引用内块级子节点 */
  children: BlockNode[];
}

/**
 * 代码块节点。
 */
export interface CodeBlockNode extends MessageNodeBase {
  /** 节点类型 */
  type: 'code';
  /** 代码语言 */
  lang?: string;
  /** 代码内容 */
  text: string;
  /** 围栏代码块是否已闭合，非围栏代码块视为已完成 */
  complete: boolean;
}

/**
 * 数学公式块节点。
 */
export interface MathBlockNode extends MessageNodeBase {
  /** 节点类型 */
  type: 'math';
  /** 公式内容 */
  text: string;
}

/**
 * 表格单元格节点。
 */
export interface TableCellNode {
  /** 单元格稳定 ID */
  id: string;
  /** 对齐方式 */
  align: 'center' | 'left' | 'right' | null;
  /** 单元格行内子节点 */
  children: InlineNode[];
}

/**
 * 表格块节点。
 */
export interface TableBlockNode extends MessageNodeBase {
  /** 节点类型 */
  type: 'table';
  /** 表头单元格 */
  header: TableCellNode[];
  /** 表体行 */
  rows: TableCellNode[][];
}

/**
 * 分割线块节点。
 */
export interface HrBlockNode extends MessageNodeBase {
  /** 节点类型 */
  type: 'hr';
}

/**
 * 结构化组件块节点。
 */
export interface ComponentBlockNode extends MessageNodeBase {
  /** 节点类型 */
  type: 'component';
  /** 组件名称 */
  componentName: string;
  /** 组件数据 */
  data?: unknown;
}

/**
 * 块级光标节点。
 */
export interface CursorBlockNode extends MessageNodeBase {
  /** 节点类型 */
  type: 'cursor';
}

/**
 * 块级消息节点。
 */
export type BlockNode =
  | ParagraphBlockNode
  | HeadingBlockNode
  | ListBlockNode
  | BlockquoteBlockNode
  | CodeBlockNode
  | MathBlockNode
  | TableBlockNode
  | HrBlockNode
  | ComponentBlockNode
  | CursorBlockNode;

/**
 * 文本行内节点。
 */
export interface TextInlineNode {
  /** 节点类型 */
  type: 'text';
  /** 文本内容 */
  text: string;
}

/**
 * 加粗行内节点。
 */
export interface StrongInlineNode {
  /** 节点类型 */
  type: 'strong';
  /** 子节点 */
  children: InlineNode[];
}

/**
 * 斜体行内节点。
 */
export interface EmInlineNode {
  /** 节点类型 */
  type: 'em';
  /** 子节点 */
  children: InlineNode[];
}

/**
 * 删除线行内节点。
 */
export interface DelInlineNode {
  /** 节点类型 */
  type: 'del';
  /** 子节点 */
  children: InlineNode[];
}

/**
 * 高亮行内节点。
 */
export interface MarkInlineNode {
  /** 节点类型 */
  type: 'mark';
  /** 子节点 */
  children: InlineNode[];
}

/**
 * 上标行内节点。
 */
export interface SupInlineNode {
  /** 节点类型 */
  type: 'sup';
  /** 子节点 */
  children: InlineNode[];
}

/**
 * 下标行内节点。
 */
export interface SubInlineNode {
  /** 节点类型 */
  type: 'sub';
  /** 子节点 */
  children: InlineNode[];
}

/**
 * 行内代码节点。
 */
export interface CodeInlineNode {
  /** 节点类型 */
  type: 'code';
  /** 代码内容 */
  text: string;
}

/**
 * 行内数学公式节点。
 */
export interface MathInlineNode {
  /** 节点类型 */
  type: 'math';
  /** 公式内容 */
  text: string;
}

/**
 * 链接行内节点。
 */
export interface LinkInlineNode {
  /** 节点类型 */
  type: 'link';
  /** 链接地址 */
  href: string;
  /** 链接标题 */
  title?: string | null;
  /** 链接文本子节点 */
  children: InlineNode[];
}

/**
 * 图片行内节点。
 */
export interface ImageInlineNode {
  /** 节点类型 */
  type: 'image';
  /** 图片地址 */
  src: string;
  /** 替代文本 */
  alt: string;
  /** 图片标题 */
  title?: string | null;
  /** 图片在当前消息图片列表中的索引 */
  imageIndex: number;
}

/**
 * 换行行内节点。
 */
export interface BreakInlineNode {
  /** 节点类型 */
  type: 'break';
}

/**
 * 行内光标节点。
 */
export interface CursorInlineNode {
  /** 节点类型 */
  type: 'cursor';
}

/**
 * 安全 HTML 行内标签名。
 */
export type SafeHtmlInlineTag = 'abbr' | 'kbd' | 'mark' | 'small' | 'sub' | 'sup' | 'u';

/**
 * 安全 HTML 行内节点。
 */
export interface HtmlInlineNode {
  /** 节点类型 */
  type: 'htmlInline';
  /** 白名单内的 HTML 标签名 */
  tag: SafeHtmlInlineTag;
  /** 安全标题属性，主要用于 abbr */
  title?: string;
  /** 子节点 */
  children: InlineNode[];
}

/**
 * 行内消息节点。
 */
export type InlineNode =
  | TextInlineNode
  | StrongInlineNode
  | EmInlineNode
  | DelInlineNode
  | MarkInlineNode
  | SupInlineNode
  | SubInlineNode
  | CodeInlineNode
  | MathInlineNode
  | LinkInlineNode
  | ImageInlineNode
  | BreakInlineNode
  | HtmlInlineNode
  | CursorInlineNode;

/**
 * 消息节点解析选项。
 */
export interface ParseMessageNodesOptions {
  /** 原始消息内容 */
  content: string;
  /** 渲染模式 */
  mode: MessageNodeRenderMode;
  /** 是否处于流式状态 */
  loading: boolean;
}

/**
 * 消息节点解析结果。
 */
export interface ParseMessageNodesResult {
  /** 块级节点列表 */
  blocks: BlockNode[];
  /** 当前消息中的图片预览条目 */
  images: ImagePreviewItem[];
}

/**
 * 消息节点渲染上下文。
 */
export interface MessageNodeRenderContext {
  /** 当前消息中的图片预览条目 */
  images: ImagePreviewItem[];
  /** 打开指定图片预览 */
  previewImageAt: (index: number) => Promise<void>;
  /** 处理链接点击 */
  navigateLink: (event: MouseEvent) => void;
}

/**
 * 消息节点渲染上下文注入 key。
 */
export const MESSAGE_NODE_RENDER_CONTEXT_KEY: InjectionKey<MessageNodeRenderContext> = Symbol('MESSAGE_NODE_RENDER_CONTEXT_KEY');
