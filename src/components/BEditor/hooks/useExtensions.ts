import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeViewProps } from '@tiptap/vue-3';
import type { Component, Ref } from 'vue';
import {
  Extension,
  Mark,
  mergeAttributes,
  Node as TiptapNode,
  type AnyExtension,
  type JSONContent,
  type MarkdownParseHelpers,
  type MarkdownParseResult,
  type MarkdownToken,
  type Editor
} from '@tiptap/core';
import _Code from '@tiptap/extension-code';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Color } from '@tiptap/extension-color';
import { Heading as BaseHeading } from '@tiptap/extension-heading';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { ListItem as BaseListItem } from '@tiptap/extension-list';
import { BlockMath, InlineMath, Mathematics } from '@tiptap/extension-mathematics';
import { Paragraph as BaseParagraph } from '@tiptap/extension-paragraph';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Strike } from '@tiptap/extension-strike';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import { Typography } from '@tiptap/extension-typography';
import { Underline } from '@tiptap/extension-underline';
import { Markdown } from '@tiptap/markdown';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { common, createLowlight } from 'lowlight';
import { captureSourceLineRange, createSourceLineTracker, resetSourceLineTracker } from '../adapters/sourceLineMapping';
import CodeBlockView from '../components/CodeBlock.vue';
import FrontMatterBlockView from '../components/FrontMatterBlock.vue';
import ImageBlockView from '../components/ImageBlock.vue';
import MathBlockView from '../components/MathBlock.vue';
import TableView from '../components/TableView.vue';
import { AISelectionHighlight } from '../extensions/aiRangeHighlight';
import { Search, type SearchScrollContext } from '../extensions/editorSearch';
import { InlineCommentMark } from '../extensions/inlineCommentMark';
import { RichInlineCompletion } from '../extensions/richInlineCompletion';
import { parseFrontMatterData, parseFrontMatterYaml, serializeFrontMatterData, serializeFrontMatterYaml, type FrontMatterData } from '../hooks/useFrontMatter';
import { getReferenceLinkRaw, INLINE_HTML_MARK_TAGS, INLINE_HTML_SUPPORTED_TAGS, isExplicitLinkToken } from '../utils/markdownInlineSemantics';
import { registerRichCodeBlockLowlightAliases } from '../utils/richCodeBlockLowlight';

const lowlight = createLowlight(common);
registerRichCodeBlockLowlightAliases(lowlight);
const FRONT_MATTER_BOUNDARY_PLUGIN_KEY = new PluginKey('b-editor-front-matter-boundary');

/**
 * Rich 编辑器默认空内容占位文案。
 */
export const RICH_EDITOR_DEFAULT_PLACEHOLDER = '请输入内容';

/**
 * Rich 编辑器占位文案解析上下文。
 */
export interface RichEditorPlaceholderContext {
  /** 当前空块节点 */
  node: {
    /** 当前节点类型 */
    type?: {
      /** 当前节点类型名称 */
      name?: string;
    };
    /** 当前节点属性 */
    attrs?: Record<string, unknown>;
  };
}

/**
 * 根据当前空块类型解析 Rich 编辑器占位文案。
 * @param context - 当前占位文案解析上下文
 * @returns 当前空块应展示的占位文案
 */
export function resolveRichEditorPlaceholder(context: RichEditorPlaceholderContext): string {
  const { node } = context;

  // 空代码块已有独立 NodeView 外壳，避免显示文档级占位文案。
  if (node.type?.name === 'codeBlock') {
    return '';
  }

  if (node.type?.name === 'heading') {
    const level = Number(node.attrs?.level);
    if (Number.isInteger(level) && level >= 1 && level <= 6) {
      return `H${level}`;
    }
  }

  return RICH_EDITOR_DEFAULT_PLACEHOLDER;
}

interface UseEditorExtensionsResult {
  assignHeadingIds: (editor: Editor, headingOptions?: { silent?: boolean }) => void;
  editorExtensions: AnyExtension[];
  resetSourceLineTracker: () => void;
  resetHeadingIndex: () => void;
  setHeadingIndex: (count: number) => void;
}

interface UseExtensionsOptions {
  onSearchMatchFocus?: (context: SearchScrollContext) => void;
}

/**
 * Front Matter Markdown token。
 */
interface FrontMatterMarkdownToken extends MarkdownToken {
  /** YAML 原文 */
  text?: string;
}

/**
 * Front Matter 节点属性。
 */
interface FrontMatterNodeAttributes {
  /** 结构化 Front Matter 数据 */
  data: FrontMatterData;
  /** YAML 原文，解析失败时保留 */
  raw: string | null;
  /** 是否存在 YAML 解析错误 */
  parseError: boolean;
}

/**
 * Markdown 表格单元格的水平对齐方式。
 */
type MarkdownTableAlignment = 'left' | 'right' | 'center' | null;

/**
 * Markdown 表格解析 token 中的单元格结构。
 */
interface MarkdownTableTokenCell {
  /** 解析器提取出的纯文本内容 */
  text?: string;
  /** 单元格内联 token 列表 */
  tokens?: MarkdownToken[];
}

/**
 * Markdown 表格 token 的最小结构。
 */
interface MarkdownTableTokenData extends MarkdownToken {
  /** 表头单元格列表 */
  header?: MarkdownTableTokenCell[];
  /** 表体行列表 */
  rows?: MarkdownTableTokenCell[][];
  /** 每列对齐方式 */
  align?: Array<string | null | undefined>;
}

/**
 * 表格节点中用于判断“内容是否未变化”的快照结构。
 */
interface MarkdownTableSignatureCell {
  /** 单元格类型 */
  type: 'tableCell' | 'tableHeader';
  /** 单元格对齐方式 */
  align: MarkdownTableAlignment;
  /** 单元格 Markdown 内容 */
  text: string;
}

/**
 * Markdown 行内 HTML 标签解析结果。
 */
interface ParsedInlineHtmlTag {
  /** 标签类型 */
  kind: 'open' | 'close' | 'selfClosing';
  /** 标准化后的标签名 */
  tag: string;
  /** 原始属性字符串 */
  attributes: string;
}

/**
 * 用于给 Markdown 行内内容补充的 Tiptap mark。
 */
interface InlineMarkdownMark {
  /** mark 类型 */
  type: string;
  /** mark 属性 */
  attrs?: Record<string, string | null>;
}

/**
 * 判断值是否为 Front Matter 数据对象。
 * @param value - 待判断的值
 * @returns 是普通对象时返回 true
 */
function isFrontMatterData(value: unknown): value is FrontMatterData {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * 读取节点上的 Front Matter 数据。
 * @param node - 当前 JSON 节点
 * @returns Front Matter 数据
 */
function getFrontMatterDataFromNode(node: JSONContent): FrontMatterData {
  const data = node.attrs?.data;
  return isFrontMatterData(data) ? data : {};
}

/**
 * 读取节点上的 Front Matter YAML 原文。
 * @param node - 当前 JSON 节点
 * @returns YAML 原文，不存在时返回 null
 */
function getFrontMatterRawFromNode(node: JSONContent): string | null {
  const raw = node.attrs?.raw;
  return typeof raw === 'string' ? raw : null;
}

/**
 * 判断 Front Matter 节点是否携带解析错误。
 * @param node - 当前 JSON 节点
 * @returns 存在解析错误时返回 true
 */
function hasFrontMatterParseError(node: JSONContent): boolean {
  return node.attrs?.parseError === true;
}

/**
 * 用原始 YAML 重建 Front Matter Markdown 块。
 * @param raw - YAML 原文
 * @returns Front Matter Markdown 块
 */
function serializeRawFrontMatter(raw: string): string {
  return raw.endsWith('\n') ? `---\n${raw}---` : `---\n${raw}\n---`;
}

/**
 * 从 YAML 原文创建 Front Matter 节点属性。
 * @param raw - YAML 原文
 * @returns Front Matter 节点属性
 */
function createFrontMatterNodeAttributes(raw: string): FrontMatterNodeAttributes {
  const result = parseFrontMatterYaml(raw);
  return {
    data: result.data,
    parseError: result.parseError,
    raw: result.parseError ? result.raw : null
  };
}

/**
 * 查找顶层 Front Matter 节点位置。
 * @param doc - 当前 ProseMirror 文档
 * @returns Front Matter 顶层索引，不存在时返回 -1
 */
function getTopLevelFrontMatterIndex(doc: ProseMirrorNode): number {
  let frontMatterIndex = -1;

  doc.forEach((node: ProseMirrorNode, _offset: number, index: number): void => {
    if (frontMatterIndex >= 0) {
      return;
    }

    if (node.type.name === 'frontMatter') {
      frontMatterIndex = index;
    }
  });

  return frontMatterIndex;
}

/**
 * 判断文档是否满足 Front Matter 必须置顶的约束。
 * @param doc - 当前 ProseMirror 文档
 * @returns Front Matter 不存在或位于第一个顶层块时返回 true
 */
function keepsFrontMatterAtDocumentStart(doc: ProseMirrorNode): boolean {
  const frontMatterIndex = getTopLevelFrontMatterIndex(doc);
  return frontMatterIndex < 0 || frontMatterIndex === 0;
}

/**
 * 创建 Front Matter 节点扩展。
 * @param withNodeView - 是否挂载 Vue NodeView
 * @returns Front Matter Tiptap 扩展
 */
function createFrontMatterExtension(withNodeView: boolean): AnyExtension {
  const extension = TiptapNode.create({
    name: 'frontMatter',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: false,
    addAttributes() {
      return {
        data: {
          default: {},
          parseHTML: (element: HTMLElement) => parseFrontMatterData(element.getAttribute('data-yaml') ?? ''),
          renderHTML: (attributes) => {
            const raw = typeof attributes.raw === 'string' ? attributes.raw : '';
            if (attributes.parseError === true) {
              return {
                'data-parse-error': 'true',
                'data-yaml': raw
              };
            }

            const data = isFrontMatterData(attributes.data) ? attributes.data : {};
            return { 'data-yaml': serializeFrontMatterYaml(data) };
          }
        },
        raw: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-yaml'),
          renderHTML: () => ({})
        },
        parseError: {
          default: false,
          parseHTML: (element: HTMLElement) =>
            parseFrontMatterYaml(element.getAttribute('data-yaml') ?? '').parseError || element.getAttribute('data-parse-error') === 'true',
          renderHTML: () => ({})
        }
      };
    },
    parseHTML() {
      return [
        {
          tag: 'section[data-type="front-matter"]'
        }
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return ['section', mergeAttributes(HTMLAttributes, { 'data-type': 'front-matter' })];
    },
    parseMarkdown: (token: FrontMatterMarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult =>
      helpers.createNode('frontMatter', createFrontMatterNodeAttributes(token.text ?? '')),
    renderMarkdown: (node: JSONContent): string => {
      if (hasFrontMatterParseError(node)) {
        return serializeRawFrontMatter(getFrontMatterRawFromNode(node) ?? '');
      }

      return serializeFrontMatterData(getFrontMatterDataFromNode(node));
    },
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: FRONT_MATTER_BOUNDARY_PLUGIN_KEY,
          filterTransaction: (transaction): boolean => {
            if (!transaction.docChanged) {
              return true;
            }

            return keepsFrontMatterAtDocumentStart(transaction.doc);
          }
        })
      ];
    },
    markdownTokenizer: {
      name: 'frontMatter',
      level: 'block',
      start: (source: string): number => (source.startsWith('---') ? 0 : -1),
      tokenize: (source: string, tokens: MarkdownToken[]): FrontMatterMarkdownToken | undefined => {
        if (tokens.length > 0 || !source.startsWith('---')) {
          return undefined;
        }

        const match = /^---[ \t]*\r?\n(?:---[ \t]*(?:\r?\n|$)|([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$))/.exec(source);
        if (!match) {
          return undefined;
        }

        return {
          type: 'frontMatter',
          raw: match[0],
          text: match[1] ?? ''
        };
      }
    }
  });

  if (!withNodeView) {
    return extension;
  }

  return extension.extend({
    addNodeView: () => VueNodeViewRenderer(FrontMatterBlockView as unknown as Component<NodeViewProps>)
  });
}

/**
 * htmlInline mark 支持的属性。
 */
interface HtmlInlineMarkAttributes {
  /** 需要渲染的安全行内标签 */
  tag?: string | null;
  /** abbr 标签的 title 属性 */
  title?: string | null;
}

/**
 * 生成普通段落节点。
 * @param content - 段落行内内容
 * @returns Tiptap JSON 段落节点
 */
function createParagraphNode(content: JSONContent[] = []): JSONContent {
  return {
    type: 'paragraph',
    content
  };
}

/**
 * 转义 Markdown 导出时的 HTML 属性值。
 * @param value - 原始属性值
 * @returns 可安全写入双引号属性的文本
 */
function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * 提取行内 HTML 标签属性。
 * @param attributes - 原始属性文本
 * @param name - 属性名
 * @returns 命中时返回属性值，否则返回 null
 */
function getInlineHtmlAttribute(attributes: string, name: string): string | null {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'i');
  const match = pattern.exec(attributes);

  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

/**
 * 解析 marked 产生的行内 HTML token。
 * @param token - 当前 Markdown token
 * @returns 支持的 HTML 标签描述，非标签或不支持时返回 null
 */
function parseInlineHtmlToken(token: MarkdownToken): ParsedInlineHtmlTag | null {
  if (token.type !== 'html') {
    return null;
  }

  let raw = '';
  if (typeof token.raw === 'string') {
    raw = token.raw;
  } else if (typeof token.text === 'string') {
    raw = token.text;
  }
  const match = /^<\s*(\/)?\s*([a-zA-Z][\w-]*)([^>]*)>$/.exec(raw.trim());

  if (!match) {
    return null;
  }

  const tag = match[2]?.toLowerCase() ?? '';
  if (!INLINE_HTML_SUPPORTED_TAGS.has(tag)) {
    return null;
  }

  const attributes = match[3] ?? '';
  const isClosing = Boolean(match[1]);
  const isSelfClosing = /\/\s*$/.test(attributes) || tag === 'br';

  if (isClosing) {
    return { kind: 'close', tag, attributes };
  }

  return { kind: isSelfClosing ? 'selfClosing' : 'open', tag, attributes };
}

/**
 * 将行内 HTML 标签映射为 Tiptap mark。
 * @param tag - HTML 标签名
 * @param attributes - 原始属性文本
 * @returns 可应用到文本节点的 mark，无法映射时返回 null
 */
function createInlineHtmlMark(tag: string, attributes: string): InlineMarkdownMark | null {
  if (tag === 'u') {
    return { type: 'underline' };
  }

  if (tag === 'mark') {
    return { type: 'highlight' };
  }

  if (!INLINE_HTML_MARK_TAGS.has(tag)) {
    return null;
  }

  const title = tag === 'abbr' ? getInlineHtmlAttribute(attributes, 'title') : null;
  return title ? { type: 'htmlInline', attrs: { tag, title } } : { type: 'htmlInline', attrs: { tag } };
}

/**
 * 给 JSONContent 文本子树追加 mark。
 * @param content - 原始行内 JSON 节点
 * @param marks - 需要追加的 mark 列表
 * @returns 带有附加 mark 的新节点列表
 */
function applyInlineMarkdownMarks(content: JSONContent[], marks: InlineMarkdownMark[]): JSONContent[] {
  if (marks.length === 0) {
    return content;
  }

  return content.map((node) => {
    if (node.type === 'text') {
      return {
        ...node,
        marks: [...(Array.isArray(node.marks) ? node.marks : []), ...marks]
      };
    }

    if (Array.isArray(node.content)) {
      return {
        ...node,
        content: applyInlineMarkdownMarks(node.content, marks)
      };
    }

    return node;
  });
}

/**
 * 查找行内 HTML 开始标签的匹配结束标签。
 * @param tokens - 当前行内 token 列表
 * @param startIndex - 开始标签下标
 * @param tag - 标签名
 * @returns 匹配结束标签下标，不存在时返回 -1
 */
function findInlineHtmlClosingIndex(tokens: MarkdownToken[], startIndex: number, tag: string): number {
  let depth = 0;

  for (let index = startIndex; index < tokens.length; index += 1) {
    const htmlTag = parseInlineHtmlToken(tokens[index] as MarkdownToken);
    if (!htmlTag || htmlTag.tag !== tag || htmlTag.kind === 'selfClosing') {
      continue;
    }

    if (htmlTag.kind === 'open') {
      depth += 1;
      continue;
    }

    depth -= 1;
    if (depth === 0) {
      return index;
    }
  }

  return -1;
}

/**
 * 行内批注 token 组解析结果。
 */
interface InlineCommentTokenGroup {
  /** 解析后的 JSON 行内节点 */
  content: JSONContent[];
  /** 已消费到的 token 下标 */
  endIndex: number;
}

/**
 * 行内批注结束片段解析结果。
 */
interface InlineCommentClosingMatch {
  /** 结束片段前仍属于批注正文的文本 */
  before: string;
  /** 批注正文 */
  comment: string;
  /** 批注 ID */
  id: string;
  /** 结束片段后剩余的普通文本 */
  after: string;
}

/**
 * 行内批注包装边界。
 */
interface InlineCommentBoundary {
  /** 批注起始 token 下标 */
  openingTokenIndex: number;
  /** 批注起始 token 内的 `[` 偏移量 */
  openingOffset: number;
  /** 批注结束 token 下标 */
  closingTokenIndex: number;
  /** 批注结束片段解析结果 */
  closing: InlineCommentClosingMatch;
}

/**
 * 生成行内批注 ID。
 * @returns 批注唯一标识
 */
function generateInlineCommentId(): string {
  return `comment-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 读取 marked token 的文本载荷。
 * @param token - marked token
 * @returns token 文本
 */
function getInlineTokenText(token: MarkdownToken): string {
  if (typeof token.text === 'string') {
    return token.text;
  }

  return typeof token.raw === 'string' ? token.raw : '';
}

/**
 * 克隆一个文本 token，用于拆分批注边界前后的普通文本。
 * @param token - 原始 token
 * @param text - 新文本内容
 * @returns 拆分后的文本 token
 */
function cloneInlineTextToken(token: MarkdownToken, text: string): MarkdownToken {
  return {
    ...token,
    type: 'text',
    raw: text,
    text
  };
}

/**
 * 解析行内批注结束片段。
 * @param text - 待解析文本
 * @returns 命中时返回批注属性与边界文本
 */
function parseInlineCommentClosing(text: string): InlineCommentClosingMatch | null {
  const match = /^([\s\S]*?)\]\{comment="([^"]*?)"(?:\s+id="([^"]*?)")?\}([\s\S]*)$/.exec(text);
  if (!match) {
    return null;
  }

  return {
    before: match[1] ?? '',
    comment: match[2] ?? '',
    id: match[3] || generateInlineCommentId(),
    after: match[4] ?? ''
  };
}

/**
 * 查找批注结束片段前最近的 `[`，作为当前批注的真实起点。
 * 普通文本中可能先出现 `[`，不能让它吞并后面真正的 `[text]{comment}`。
 * @param tokens - 当前行内 token 列表
 * @param startIndex - 起始 token 下标
 * @returns 批注边界；未找到完整边界时返回 null
 */
function findInlineCommentBoundary(tokens: MarkdownToken[], startIndex: number): InlineCommentBoundary | null {
  for (let closingTokenIndex = startIndex; closingTokenIndex < tokens.length; closingTokenIndex += 1) {
    const closingToken = tokens[closingTokenIndex] as MarkdownToken;
    const closing = parseInlineCommentClosing(getInlineTokenText(closingToken));
    if (!closing) {
      continue;
    }

    for (let openingTokenIndex = closingTokenIndex; openingTokenIndex >= startIndex; openingTokenIndex -= 1) {
      const openingToken = tokens[openingTokenIndex] as MarkdownToken;
      const openingSearchText = openingTokenIndex === closingTokenIndex ? closing.before : getInlineTokenText(openingToken);
      const openingOffset = openingSearchText.lastIndexOf('[');
      if (openingOffset < 0) {
        continue;
      }

      return {
        openingTokenIndex,
        openingOffset,
        closingTokenIndex,
        closing
      };
    }
  }

  return null;
}

/**
 * 尝试从 marked 已拆分的 token 序列中恢复 `[text]{comment="..."}` 批注包装。
 * marked 会先解析批注内部的 bold/code 等语法，导致自定义 tokenizer 无法独占整段文本；
 * 因此这里在项目统一的 inline token 入口按边界重新组合，并保留内部 Markdown marks。
 * @param tokens - 当前行内 token 列表
 * @param startIndex - 起始 token 下标
 * @param activeMarks - 外层 HTML 标签累积的 mark
 * @param parseTokens - 当前 inline 解析入口，用于递归解析普通片段和批注正文
 * @returns 命中时返回批注节点与消费位置
 */
function consumeInlineCommentTokenGroup(
  tokens: MarkdownToken[],
  startIndex: number,
  activeMarks: InlineMarkdownMark[],
  parseTokens: (nextTokens: MarkdownToken[], nextActiveMarks: InlineMarkdownMark[]) => JSONContent[]
): InlineCommentTokenGroup | null {
  const boundary = findInlineCommentBoundary(tokens, startIndex);
  if (!boundary) {
    return null;
  }

  const openingToken = tokens[boundary.openingTokenIndex] as MarkdownToken;
  const closingToken = tokens[boundary.closingTokenIndex] as MarkdownToken;
  const openingText = getInlineTokenText(openingToken);
  const prefixTokens: MarkdownToken[] = tokens.slice(startIndex, boundary.openingTokenIndex);
  const openingPrefixText = openingText.slice(0, boundary.openingOffset);

  if (openingPrefixText) {
    prefixTokens.push(cloneInlineTextToken(openingToken, openingPrefixText));
  }

  const firstInnerText =
    boundary.openingTokenIndex === boundary.closingTokenIndex
      ? boundary.closing.before.slice(boundary.openingOffset + 1)
      : openingText.slice(boundary.openingOffset + 1);
  const innerTokens: MarkdownToken[] = firstInnerText ? [cloneInlineTextToken(openingToken, firstInnerText)] : [];

  if (boundary.openingTokenIndex < boundary.closingTokenIndex) {
    innerTokens.push(...tokens.slice(boundary.openingTokenIndex + 1, boundary.closingTokenIndex));
    if (boundary.closing.before) {
      innerTokens.push(cloneInlineTextToken(closingToken, boundary.closing.before));
    }
  }

  const suffixTokens = boundary.closing.after ? [cloneInlineTextToken(closingToken, boundary.closing.after)] : [];
  const prefixContent = prefixTokens.length > 0 ? parseTokens(prefixTokens, activeMarks) : [];
  const innerContent = parseTokens(innerTokens, activeMarks);
  const commentContent = applyInlineMarkdownMarks(innerContent, [
    { type: 'inlineComment', attrs: { comment: boundary.closing.comment, id: boundary.closing.id } }
  ]);
  const suffixContent = suffixTokens.length > 0 ? parseTokens(suffixTokens, activeMarks) : [];

  return {
    content: [...prefixContent, ...commentContent, ...suffixContent],
    endIndex: boundary.closingTokenIndex
  };
}

/**
 * 解析行内 token，并保留安全 HTML 标签的富文本语义。
 * @param tokens - marked 行内 token 列表
 * @param helpers - Tiptap Markdown 解析辅助函数
 * @param activeMarks - 外层 HTML 标签累积的 mark
 * @returns Tiptap JSON 行内节点列表
 */
function parseInlineTokensWithHtmlMarks(tokens: MarkdownToken[], helpers: MarkdownParseHelpers, activeMarks: InlineMarkdownMark[] = []): JSONContent[] {
  const content: JSONContent[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as MarkdownToken;
    const commentGroup = consumeInlineCommentTokenGroup(tokens, index, activeMarks, (nextTokens, nextActiveMarks) =>
      parseInlineTokensWithHtmlMarks(nextTokens, helpers, nextActiveMarks)
    );
    if (commentGroup) {
      content.push(...commentGroup.content);
      index = commentGroup.endIndex;
      continue;
    }

    const htmlTag = parseInlineHtmlToken(token);

    if (htmlTag?.kind === 'selfClosing' && htmlTag.tag === 'br') {
      content.push(helpers.createNode('hardBreak'));
      continue;
    }

    if (htmlTag?.kind === 'open') {
      const closingIndex = findInlineHtmlClosingIndex(tokens, index, htmlTag.tag);
      const mark = createInlineHtmlMark(htmlTag.tag, htmlTag.attributes);

      if (closingIndex > index && mark) {
        content.push(...parseInlineTokensWithHtmlMarks(tokens.slice(index + 1, closingIndex), helpers, [...activeMarks, mark]));
        index = closingIndex;
        continue;
      }
    }

    const raw = getReferenceLinkRaw(token);
    const parsed = raw ? [helpers.createTextNode(raw)] : helpers.parseInline([token]);
    content.push(...applyInlineMarkdownMarks(parsed, activeMarks));
  }

  return content;
}

const MarkdownStrike = Strike.extend({
  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
    const raw = typeof token.raw === 'string' ? token.raw : '';
    if (!raw.startsWith('~~')) {
      return helpers.createTextNode(raw);
    }

    return helpers.applyMark('strike', helpers.parseInline(token.tokens || []));
  }
}) as unknown as AnyExtension;

/**
 * 将 Tiptap 扩展集合统一适配为当前入口使用的 AnyExtension[]。
 * pnpm 下不同 Tiptap 子包可能解析到不同 patch 版本，扩展运行时协议一致但类型私有字段不完全兼容。
 * @param extensions - Tiptap 扩展集合
 * @returns 当前模块统一使用的扩展集合类型
 */
function toAnyExtensions(extensions: readonly unknown[]): AnyExtension[] {
  return extensions as AnyExtension[];
}

const HtmlInline = Mark.create({
  name: 'htmlInline',
  addAttributes() {
    return {
      tag: {
        default: 'span',
        renderHTML: () => ({})
      },
      title: {
        default: null,
        renderHTML: (attributes: HtmlInlineMarkAttributes): Record<string, string> => {
          const tag = typeof attributes.tag === 'string' ? attributes.tag : '';
          const title = typeof attributes.title === 'string' ? attributes.title : '';
          return tag === 'abbr' && title ? { title } : {};
        }
      }
    };
  },
  parseHTML() {
    return Array.from(INLINE_HTML_MARK_TAGS).map((tag) => ({
      tag,
      getAttrs: (element: HTMLElement): HtmlInlineMarkAttributes => ({
        tag,
        title: tag === 'abbr' ? element.getAttribute('title') : null
      })
    }));
  },
  renderHTML({ mark, HTMLAttributes }) {
    const attrs = mark.attrs as HtmlInlineMarkAttributes;
    const tag = typeof attrs.tag === 'string' && INLINE_HTML_MARK_TAGS.has(attrs.tag) ? attrs.tag : 'span';

    return [tag, HTMLAttributes, 0];
  },
  renderMarkdown(node: JSONContent, helpers): string {
    const attrs = node.attrs as HtmlInlineMarkAttributes | undefined;
    const tag = typeof attrs?.tag === 'string' && INLINE_HTML_MARK_TAGS.has(attrs.tag) ? attrs.tag : 'span';
    const title = tag === 'abbr' && typeof attrs?.title === 'string' && attrs.title ? ` title="${escapeHtmlAttribute(attrs.title)}"` : '';

    return `<${tag}${title}>${helpers.renderChildren(node)}</${tag}>`;
  }
});

function parseInlinePreservingReferenceLinks(tokens: MarkdownToken[] | undefined, helpers: MarkdownParseHelpers): JSONContent[] {
  if (!tokens?.length) {
    return [];
  }

  return parseInlineTokensWithHtmlMarks(tokens, helpers);
}

function parseInlineOrText(tokens: MarkdownToken[] | undefined, text: string | undefined, helpers: MarkdownParseHelpers): JSONContent[] {
  const content = parseInlinePreservingReferenceLinks(tokens, helpers);

  if (content.length) {
    return content;
  }

  return text ? [helpers.createTextNode(text)] : [];
}

/**
 * 判断段落是否仅承载一条原始 HTML 注释文本。
 * @param node - 当前待序列化的段落节点
 * @returns 命中时返回原始注释文本，否则返回 null
 */
function getRawHtmlCommentFromParagraph(node: JSONContent): string | null {
  const content = Array.isArray(node.content) ? node.content : [];

  if (content.length !== 1) {
    return null;
  }

  const [textNode] = content;

  if (textNode.type !== 'text' || (Array.isArray(textNode.marks) && textNode.marks.length > 0) || typeof textNode.text !== 'string') {
    return null;
  }

  return /^<!--[\s\S]*?-->$/.test(textNode.text.trim()) ? textNode.text : null;
}

/**
 * 规范化表格单元格对齐方式，过滤掉无效值。
 * @param value - 待规范化的对齐值
 * @returns 合法对齐方式，不合法时返回 null
 */
function normalizeMarkdownTableAlignment(value: string | null | undefined): MarkdownTableAlignment {
  if (value === 'left' || value === 'right' || value === 'center') {
    return value;
  }

  return null;
}

/**
 * 计算 Markdown 文本在等宽字体下的近似显示宽度。
 * @param text - 单元格文本
 * @returns 近似宽度，中文等宽字符按 2 处理
 */
function getMarkdownDisplayWidth(text: string): number {
  return Array.from(text).reduce(
    (width, char) => width + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(char) ? 2 : 1),
    0
  );
}

/**
 * 压平表格单元格中的块级内容，便于生成稳定签名和回退 Markdown。
 * @param value - 单元格文本
 * @returns 去掉多余换行后的单行 Markdown 文本
 */
function normalizeMarkdownTableCellText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\n+/g, ' ').trim();
}

/**
 * 递归提取 JSONContent 中的纯文本内容，用于构建结构签名。
 * @param content - 待提取的 JSONContent 列表
 * @returns 拼接后的纯文本
 */
function getTextFromJsonContent(content: JSONContent[]): string {
  return content
    .map((item) => {
      if (typeof item.text === 'string') {
        return item.text;
      }

      const childContent = Array.isArray(item.content) ? item.content : [];
      return getTextFromJsonContent(childContent);
    })
    .join('');
}

/**
 * 提取表格单元格的 Markdown 文本。
 * @param cellNode - 当前表格单元格节点
 * @param helpers - Markdown 渲染辅助函数
 * @returns 单元格对应的 Markdown 文本
 */
function renderMarkdownTableCellText(cellNode: JSONContent, helpers: { renderChildren: (content: JSONContent | JSONContent[]) => string }): string {
  const content = Array.isArray(cellNode.content) ? cellNode.content : [];

  if (content.length === 0) {
    return '';
  }

  return normalizeMarkdownTableCellText(content.map((childNode) => helpers.renderChildren(childNode)).join('<br>'));
}

/**
 * 基于解析 token 构建表格签名，用于判断表格是否仍保持导入时原样。
 * @param token - Markdown 表格 token
 * @param helpers - Markdown 解析辅助函数
 * @returns 可持久化的签名字符串
 */
function buildMarkdownTableSignatureFromToken(token: MarkdownTableTokenData, helpers: MarkdownParseHelpers): string {
  const signatureRows: MarkdownTableSignatureCell[][] = [];
  const alignments = Array.isArray(token.align) ? token.align : [];

  if (token.header) {
    signatureRows.push(
      token.header.map((cell, index) => ({
        type: 'tableHeader',
        align: normalizeMarkdownTableAlignment(alignments[index]),
        text: normalizeMarkdownTableCellText(getTextFromJsonContent(parseInlineOrText(cell.tokens, cell.text, helpers)))
      }))
    );
  }

  token.rows?.forEach((row) => {
    signatureRows.push(
      row.map((cell, index) => ({
        type: 'tableCell',
        align: normalizeMarkdownTableAlignment(alignments[index]),
        text: normalizeMarkdownTableCellText(getTextFromJsonContent(parseInlineOrText(cell.tokens, cell.text, helpers)))
      }))
    );
  });

  return JSON.stringify(signatureRows);
}

/**
 * 基于当前表格节点构建签名，用于和导入时签名比对。
 * @param node - 表格节点
 * @returns 当前表格的签名字符串
 */
function buildMarkdownTableSignatureFromNode(node: JSONContent): string {
  const rows = Array.isArray(node.content) ? node.content : [];

  return JSON.stringify(
    rows.map((rowNode) => {
      const cells = Array.isArray(rowNode.content) ? rowNode.content : [];

      return cells.map((cellNode) => ({
        type: cellNode.type === 'tableHeader' ? 'tableHeader' : 'tableCell',
        align: normalizeMarkdownTableAlignment(typeof cellNode.attrs?.align === 'string' ? cellNode.attrs.align : null),
        text: normalizeMarkdownTableCellText(getTextFromJsonContent(Array.isArray(cellNode.content) ? cellNode.content : []))
      }));
    })
  );
}

/**
 * 转义表格单元格中的保留字符，避免生成非法 Markdown。
 * @param value - 原始单元格文本
 * @returns 可安全写回表格的 Markdown 文本
 */
function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/**
 * 生成紧凑格式的 Markdown 分隔行单元格。
 * @param width - 列内容宽度
 * @param align - 列对齐方式
 * @returns 分隔行单元格文本
 */
function createMarkdownTableDividerCell(width: number, align: MarkdownTableAlignment): string {
  const dashCount = Math.max(3, width + 2);

  if (align === 'left') {
    return `:${'-'.repeat(Math.max(2, dashCount - 1))}`;
  }

  if (align === 'right') {
    return `${'-'.repeat(Math.max(2, dashCount - 1))}:`;
  }

  if (align === 'center') {
    return `:${'-'.repeat(Math.max(1, dashCount - 2))}:`;
  }

  return '-'.repeat(dashCount);
}

/**
 * 在表格内容变化后生成稳定的紧凑 Markdown 表格文本。
 * @param node - 表格节点
 * @param helpers - Markdown 渲染辅助函数
 * @returns 渲染后的 Markdown 表格
 */
function renderMarkdownTableFallback(node: JSONContent, helpers: { renderChildren: (content: JSONContent | JSONContent[]) => string }): string {
  const rows = Array.isArray(node.content) ? node.content : [];

  if (rows.length === 0) {
    return '';
  }

  const normalizedRows = rows.map((rowNode) => {
    const cells = Array.isArray(rowNode.content) ? rowNode.content : [];

    return cells.map((cellNode) => ({
      text: escapeMarkdownTableCell(renderMarkdownTableCellText(cellNode, helpers)),
      align: normalizeMarkdownTableAlignment(typeof cellNode.attrs?.align === 'string' ? cellNode.attrs.align : null)
    }));
  });

  const columnCount = normalizedRows.reduce((maxCount, currentRow) => Math.max(maxCount, currentRow.length), 0);

  if (columnCount === 0) {
    return '';
  }

  const headerRow = normalizedRows[0] ?? [];
  const headerTexts = Array.from({ length: columnCount }, (_value, index) => headerRow[index]?.text ?? '');
  const dividerWidths = headerTexts.map((text) => getMarkdownDisplayWidth(text));
  const alignments = Array.from({ length: columnCount }, (_value, index) => normalizedRows.find((row) => row[index]?.align)?.[index]?.align ?? null);

  const dividerRow = alignments.map((align, index) => createMarkdownTableDividerCell(dividerWidths[index] ?? 0, align));
  const bodyRows = normalizedRows.slice(1);

  return [
    `| ${headerTexts.join(' | ')} |`,
    `|${dividerRow.join('|')}|`,
    ...bodyRows.map((row) => `| ${Array.from({ length: columnCount }, (_value, index) => row[index]?.text ?? '').join(' | ')} |`)
  ].join('\n');
}

export function useExtensions(editorInstanceId: Ref<string>, options: UseExtensionsOptions = {}): UseEditorExtensionsResult {
  let headingIndex = 0;
  const sourceLineTracker = createSourceLineTracker();

  function resetHeadingIndex(): void {
    headingIndex = 0;
  }

  /**
   * 为支持源码引用的块节点生成统一的源码行号属性定义。
   * @param parentAttributes - 原节点已有 attrs 定义
   * @returns 合并后的 attrs 定义
   */
  function createSourceLineAttributes(parentAttributes: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...parentAttributes,
      sourceLineStart: {
        default: null,
        renderHTML: () => ({})
      },
      sourceLineEnd: {
        default: null,
        renderHTML: () => ({})
      }
    };
  }

  /**
   * 从当前 Markdown token 中提取源码行号 attrs。
   * @param token - 当前 Markdown token
   * @returns 可直接挂到块节点上的源码行号 attrs
   */
  function createSourceLineNodeAttrs(token: MarkdownToken): { sourceLineStart: number; sourceLineEnd: number } | {} {
    if (typeof token.raw !== 'string' || !token.raw) {
      return {};
    }

    const range = captureSourceLineRange(sourceLineTracker, token.raw);

    return {
      sourceLineStart: range.startLine,
      sourceLineEnd: range.endLine
    };
  }

  function getHeadingId(index: number): string {
    return `${editorInstanceId.value}-heading-${index}`;
  }

  const Code = _Code.extend({ excludes: '' });

  const RuntimeBlockMath = BlockMath.extend({
    addNodeView: () => VueNodeViewRenderer(MathBlockView as unknown as Component<NodeViewProps>)
  });

  const HtmlComment = Extension.create({
    name: 'htmlComment',
    markdownTokenName: 'html',
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      let raw = '';

      if (typeof token.raw === 'string') {
        raw = token.raw;
      } else if (typeof token.text === 'string') {
        raw = token.text;
      }

      const normalized = raw.replace(/\r?\n$/, '');

      if (!/^<!--[\s\S]*?-->$/.test(normalized.trim())) {
        return [];
      }

      return helpers.createNode('paragraph', createSourceLineNodeAttrs(token), [helpers.createTextNode(normalized)]);
    }
  });

  const LinkDefinitionAsText = Extension.create({
    name: 'linkDefinitionAsText',
    markdownTokenName: 'def',
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const raw = typeof token.raw === 'string' ? token.raw.trim() : '';

      if (!/^\[[^\]]+\]:\s+\S+/.test(raw)) {
        return [];
      }

      return helpers.createNode('paragraph', createSourceLineNodeAttrs(token), [helpers.createTextNode(raw)]);
    }
  });

  const CodeBlock = CodeBlockLowlight.extend({
    addAttributes() {
      return createSourceLineAttributes(this.parent?.() ?? {});
    },
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const language = typeof token.lang === 'string' && token.lang ? token.lang : null;
      const text = typeof token.text === 'string' ? token.text : '';

      return helpers.createNode('codeBlock', { ...createSourceLineNodeAttrs(token), language }, text ? [helpers.createTextNode(text)] : []);
    },
    addNodeView: () => VueNodeViewRenderer(CodeBlockView as unknown as Component<NodeViewProps>)
  }).configure({ lowlight, defaultLanguage: 'plaintext' });

  const Heading = BaseHeading.extend({
    addAttributes() {
      return createSourceLineAttributes({
        ...(this.parent?.() ?? {}),
        id: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute('id'),
          renderHTML: (attributes: Record<string, unknown>) => (attributes.id ? { id: attributes.id } : {})
        }
      });
    },
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const content = parseInlinePreservingReferenceLinks(token.tokens, helpers);
      const id = getHeadingId(headingIndex++);
      const sourceLineAttrs = createSourceLineNodeAttrs(token);

      if (content.length) {
        return helpers.createNode('heading', { ...sourceLineAttrs, level: token.depth || 1, id }, content);
      }

      const text = typeof token.text === 'string' ? token.text.trim() : '';

      return helpers.createNode('heading', { ...sourceLineAttrs, level: token.depth || 1, id }, text ? [helpers.createTextNode(text)] : []);
    },
    addKeyboardShortcuts() {
      return this.parent?.() ?? {};
    },
    onCreate() {
      const { editor } = this;
      editor.on('beforeCreate', () => {
        resetHeadingIndex();
      });
    }
  }).configure({ levels: [1, 2, 3, 4, 5, 6] });

  const Paragraph = BaseParagraph.extend({
    addAttributes() {
      return createSourceLineAttributes(this.parent?.() ?? {});
    },
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const content = parseInlinePreservingReferenceLinks(token.tokens, helpers);
      const sourceLineAttrs = createSourceLineNodeAttrs(token);

      if (content.length) {
        return helpers.createNode('paragraph', sourceLineAttrs, content);
      }

      const text = typeof token.text === 'string' ? token.text : '';

      return helpers.createNode('paragraph', sourceLineAttrs, text ? [helpers.createTextNode(text)] : []);
    },
    renderMarkdown: (node: JSONContent, helpers): string => {
      const rawHtmlComment = getRawHtmlCommentFromParagraph(node);

      if (rawHtmlComment) {
        return rawHtmlComment;
      }

      const content = Array.isArray(node.content) ? node.content : [];

      if (content.length === 0) {
        return '';
      }

      return helpers.renderChildren(content);
    }
  });

  const ListItem = BaseListItem.extend({
    addAttributes() {
      return createSourceLineAttributes(this.parent?.() ?? {});
    },
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      if (token.type !== 'list_item') {
        return [];
      }

      const parseBlockChildren = helpers.parseBlockChildren ?? helpers.parseChildren;
      let contentNodes: JSONContent[] = [];

      if (token.tokens && token.tokens.length > 0) {
        const hasParagraphTokens = token.tokens.some((itemToken) => itemToken.type === 'paragraph');

        // 优先保留 list_item 的块级上下文，避免把普通列表项拆成顶层 heading。
        if (hasParagraphTokens) {
          contentNodes = parseBlockChildren(token.tokens);
        } else {
          const [firstToken, ...remainingTokens] = token.tokens;

          if (firstToken?.type === 'text' && firstToken.tokens && firstToken.tokens.length > 0) {
            contentNodes = [
              helpers.createNode('paragraph', createSourceLineNodeAttrs(firstToken), parseInlinePreservingReferenceLinks(firstToken.tokens, helpers))
            ];

            if (remainingTokens.length > 0) {
              contentNodes.push(...parseBlockChildren(remainingTokens));
            }
          } else {
            contentNodes = parseBlockChildren(token.tokens);
          }
        }
      }

      if (contentNodes.length === 0) {
        contentNodes = [createParagraphNode()];
      }

      return { type: 'listItem', content: contentNodes };
    }
  });

  const MarkdownTable = Table.extend({
    addAttributes() {
      return createSourceLineAttributes({
        ...(this.parent?.() ?? {}),
        markdownRaw: {
          default: null,
          renderHTML: () => ({})
        },
        markdownSignature: {
          default: null,
          renderHTML: () => ({})
        }
      });
    },
    addNodeView: () => VueNodeViewRenderer(TableView as unknown as Component<NodeViewProps>),
    parseMarkdown: (token: MarkdownTableTokenData, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const rows: JSONContent[] = [];
      const alignments = Array.isArray(token.align) ? token.align : [];

      if (token.header) {
        const headerCells = token.header.map((cell, index) =>
          helpers.createNode(
            'tableHeader',
            normalizeMarkdownTableAlignment(alignments[index]) ? { align: normalizeMarkdownTableAlignment(alignments[index]) } : {},
            [helpers.createNode('paragraph', {}, parseInlineOrText(cell.tokens, cell.text, helpers))]
          )
        );

        rows.push(helpers.createNode('tableRow', {}, headerCells));
      }

      if (token.rows) {
        token.rows.forEach((row) => {
          const bodyCells = row.map((cell, index) =>
            helpers.createNode(
              'tableCell',
              normalizeMarkdownTableAlignment(alignments[index]) ? { align: normalizeMarkdownTableAlignment(alignments[index]) } : {},
              [helpers.createNode('paragraph', {}, parseInlineOrText(cell.tokens, cell.text, helpers))]
            )
          );

          rows.push(helpers.createNode('tableRow', {}, bodyCells));
        });
      }

      return helpers.createNode(
        'table',
        {
          ...createSourceLineNodeAttrs(token),
          markdownRaw: typeof token.raw === 'string' ? token.raw.replace(/\r\n/g, '\n').replace(/\n+$/, '') : null,
          markdownSignature: buildMarkdownTableSignatureFromToken(token, helpers)
        },
        rows
      );
    },
    renderMarkdown: (node: JSONContent, helpers): string => {
      const rawMarkdown = typeof node.attrs?.markdownRaw === 'string' ? node.attrs.markdownRaw : null;
      const importedSignature = typeof node.attrs?.markdownSignature === 'string' ? node.attrs.markdownSignature : null;

      if (rawMarkdown && importedSignature === buildMarkdownTableSignatureFromNode(node)) {
        return rawMarkdown.trimEnd();
      }

      return renderMarkdownTableFallback(node, helpers);
    }
  });

  const MarkdownLink = Link.extend({
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      if (!isExplicitLinkToken(token)) {
        return helpers.createTextNode(typeof token.raw === 'string' ? token.raw : token.text ?? '');
      }

      const content = helpers.parseInline(token.tokens || []);
      const href = typeof token.href === 'string' ? token.href : '';
      const title = typeof token.title === 'string' ? token.title : undefined;

      if (content.length) {
        return { mark: 'link', content, attrs: { href, title } };
      }

      const text = typeof token.text === 'string' ? token.text : '';
      return { mark: 'link', content: text ? [helpers.createTextNode(text)] : [], attrs: { href, title } };
    }
  });

  const FrontMatter = createFrontMatterExtension(true);

  const editorExtensions = toAnyExtensions([
    StarterKit.configure({
      code: false,
      codeBlock: false,
      heading: false,
      link: false,
      listItem: false,
      paragraph: false,
      strike: false,
      underline: false,
      // 禁用拖拽光标（拖拽时的蓝色插入线）
      dropcursor: false
    }),
    Placeholder.configure({ emptyEditorClass: 'is-editor-empty', placeholder: resolveRichEditorPlaceholder }),
    Markdown,
    FrontMatter,
    HtmlComment,
    LinkDefinitionAsText,
    AISelectionHighlight,
    InlineCommentMark,
    Heading,
    Paragraph,
    Code,
    CodeBlock,
    ListItem,
    MarkdownTable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Search.configure({
      onMatchFocus: options.onSearchMatchFocus ?? null
    }),
    Image.extend({
      addNodeView: () => VueNodeViewRenderer(ImageBlockView as unknown as Component<NodeViewProps>)
    }).configure({
      inline: false,
      allowBase64: true,
      HTMLAttributes: {
        class: 'editor-image'
      }
    }),
    TaskList,
    TaskItem.configure({
      nested: true
    }),
    Highlight.configure({
      multicolor: true
    }),
    MarkdownStrike,
    TextStyle,
    Color,
    HtmlInline,
    Typography,
    Underline,
    MarkdownLink.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'editor-link'
      }
    }),
    RuntimeBlockMath.configure({
      katexOptions: {
        throwOnError: false
      }
    }),
    InlineMath.configure({
      katexOptions: {
        throwOnError: false
      }
    }),
    RichInlineCompletion
  ]);

  function assignHeadingIds(editor: Editor, headingOptions?: { silent?: boolean }): void {
    const { state, view } = editor;
    const { tr } = state;
    let index = 0;
    let needsUpdate = false;

    state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const expectedId = getHeadingId(index);
        if (node.attrs.id !== expectedId) {
          needsUpdate = true;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: expectedId });
        }
        index++;
      }
    });

    if (needsUpdate) {
      if (headingOptions?.silent) {
        tr.setMeta('preventUpdate', true).setMeta('addToHistory', false);
      }
      view.dispatch(tr);
    }
  }

  return {
    assignHeadingIds,
    editorExtensions,
    resetSourceLineTracker: () => resetSourceLineTracker(sourceLineTracker),
    resetHeadingIndex,
    setHeadingIndex: (count: number): void => {
      headingIndex = count;
    }
  };
}

// ========================================================================
//  Rich Load Schema Extensions (方案 B Worker 预解析用)
//  所有 node/mark schema + Markdown parse/render，不含 Vue NodeView/DOM
// ========================================================================

/**
 * Schema 扩展组的返回结果
 */
interface RichMarkdownSchemaResult {
  /** 仅包含 schema+parse 的扩展集合 */
  extensions: AnyExtension[];
  /** 标题 ID 分配函数 */
  assignHeadingIds: (editor: Editor, headingOptions?: { silent?: boolean }) => void;
  /** 重置标题索引 */
  resetHeadingIndex: () => void;
  /** 获取当前标题索引（即已分配的标题数量） */
  getHeadingIndex: () => number;
}

/**
 * 创建仅包含 node/mark schema + Markdown parse/render 的扩展集合。
 * 不含 Vue NodeView、不含 DOM/Window 引用、不含运行时 Plugin。
 * 可在 Worker 中使用，也供主线程 editor 使用。
 *
 * @param editorInstanceId - 编辑器实例 ID
 * @param sourceLineTracker - 源码行号追踪器实例
 */
export function createRichMarkdownSchemaExtensions(
  editorInstanceId: string,
  sourceLineTracker: ReturnType<typeof createSourceLineTracker>
): RichMarkdownSchemaResult {
  let headingIndex = 0;

  function getHeadingId(index: number): string {
    return `${editorInstanceId}-heading-${index}`;
  }

  function resetHeadingIndex(): void {
    headingIndex = 0;
  }

  function createSourceLineAttributes(parentAttributes: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...parentAttributes,
      sourceLineStart: {
        default: null,
        renderHTML: () => ({})
      },
      sourceLineEnd: {
        default: null,
        renderHTML: () => ({})
      }
    };
  }

  function createSourceLineNodeAttrs(token: MarkdownToken): { sourceLineStart: number; sourceLineEnd: number } | {} {
    if (typeof token.raw !== 'string' || !token.raw) {
      return {};
    }

    const range = captureSourceLineRange(sourceLineTracker, token.raw);

    return {
      sourceLineStart: range.startLine,
      sourceLineEnd: range.endLine
    };
  }

  const Code = _Code.extend({ excludes: '' });

  const HtmlComment = Extension.create({
    name: 'htmlComment',
    markdownTokenName: 'html',
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      let raw = '';

      if (typeof token.raw === 'string') {
        raw = token.raw;
      } else if (typeof token.text === 'string') {
        raw = token.text;
      }

      const normalized = raw.replace(/\r?\n$/, '');

      if (!/^<!--[\s\S]*?-->$/.test(normalized.trim())) {
        return [];
      }

      return helpers.createNode('paragraph', createSourceLineNodeAttrs(token), [helpers.createTextNode(normalized)]);
    }
  });

  const LinkDefinitionAsText = Extension.create({
    name: 'linkDefinitionAsText',
    markdownTokenName: 'def',
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const raw = typeof token.raw === 'string' ? token.raw.trim() : '';

      if (!/^\[[^\]]+\]:\s+\S+/.test(raw)) {
        return [];
      }

      return helpers.createNode('paragraph', createSourceLineNodeAttrs(token), [helpers.createTextNode(raw)]);
    }
  });

  // CodeBlock（仅 schema + parseMarkdown，不含 VueNodeView——运行时由 createRichEditorRuntimeOnlyExtensions 补）
  const CodeBlock = CodeBlockLowlight.extend({
    addAttributes() {
      return createSourceLineAttributes(this.parent?.() ?? {});
    },
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const language = typeof token.lang === 'string' && token.lang ? token.lang : null;
      const text = typeof token.text === 'string' ? token.text : '';

      return helpers.createNode('codeBlock', { ...createSourceLineNodeAttrs(token), language }, text ? [helpers.createTextNode(text)] : []);
    }
  }).configure({ lowlight, defaultLanguage: 'plaintext' });

  const Heading = BaseHeading.extend({
    addAttributes() {
      return createSourceLineAttributes({
        ...(this.parent?.() ?? {}),
        id: {
          default: null,
          parseHTML: (element: HTMLElement) => element.getAttribute('id'),
          renderHTML: (attributes: Record<string, unknown>) => (attributes.id ? { id: attributes.id } : {})
        }
      });
    },
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const content = parseInlinePreservingReferenceLinks(token.tokens, helpers);
      const id = getHeadingId(headingIndex++);
      const sourceLineAttrs = createSourceLineNodeAttrs(token);

      if (content.length) {
        return helpers.createNode('heading', { ...sourceLineAttrs, level: token.depth || 1, id }, content);
      }

      const text = typeof token.text === 'string' ? token.text.trim() : '';

      return helpers.createNode('heading', { ...sourceLineAttrs, level: token.depth || 1, id }, text ? [helpers.createTextNode(text)] : []);
    },
    addKeyboardShortcuts() {
      return this.parent?.() ?? {};
    }
  }).configure({ levels: [1, 2, 3, 4, 5, 6] });

  const Paragraph = BaseParagraph.extend({
    addAttributes() {
      return createSourceLineAttributes(this.parent?.() ?? {});
    },
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const content = parseInlinePreservingReferenceLinks(token.tokens, helpers);
      const sourceLineAttrs = createSourceLineNodeAttrs(token);

      if (content.length) {
        return helpers.createNode('paragraph', sourceLineAttrs, content);
      }

      const text = typeof token.text === 'string' ? token.text : '';

      return helpers.createNode('paragraph', sourceLineAttrs, text ? [helpers.createTextNode(text)] : []);
    },
    renderMarkdown: (node: JSONContent, helpers): string => {
      const rawHtmlComment = getRawHtmlCommentFromParagraph(node);

      if (rawHtmlComment) {
        return rawHtmlComment;
      }

      const content = Array.isArray(node.content) ? node.content : [];

      if (content.length === 0) {
        return '';
      }

      return helpers.renderChildren(content);
    }
  });

  const ListItem = BaseListItem.extend({
    addAttributes() {
      return createSourceLineAttributes(this.parent?.() ?? {});
    },
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      if (token.type !== 'list_item') {
        return [];
      }

      const parseBlockChildren = helpers.parseBlockChildren ?? helpers.parseChildren;
      let contentNodes: JSONContent[] = [];

      if (token.tokens && token.tokens.length > 0) {
        const hasParagraphTokens = token.tokens.some((itemToken) => itemToken.type === 'paragraph');

        if (hasParagraphTokens) {
          contentNodes = parseBlockChildren(token.tokens);
        } else {
          const [firstToken, ...remainingTokens] = token.tokens;

          if (firstToken?.type === 'text' && firstToken.tokens && firstToken.tokens.length > 0) {
            contentNodes = [
              helpers.createNode('paragraph', createSourceLineNodeAttrs(firstToken), parseInlinePreservingReferenceLinks(firstToken.tokens, helpers))
            ];

            if (remainingTokens.length > 0) {
              contentNodes.push(...parseBlockChildren(remainingTokens));
            }
          } else {
            contentNodes = parseBlockChildren(token.tokens);
          }
        }
      }

      if (contentNodes.length === 0) {
        contentNodes = [createParagraphNode()];
      }

      return { type: 'listItem', content: contentNodes };
    }
  });

  // MarkdownTable（仅 schema + parseMarkdown，不含 VueNodeView——运行时由 createRichEditorRuntimeOnlyExtensions 补）
  const MarkdownTable = Table.extend({
    addAttributes() {
      return createSourceLineAttributes({
        ...(this.parent?.() ?? {}),
        markdownRaw: {
          default: null,
          renderHTML: () => ({})
        },
        markdownSignature: {
          default: null,
          renderHTML: () => ({})
        }
      });
    },
    parseMarkdown: (token: MarkdownTableTokenData, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const rows: JSONContent[] = [];
      const alignments = Array.isArray(token.align) ? token.align : [];

      if (token.header) {
        const headerCells = token.header.map((cell, index) =>
          helpers.createNode(
            'tableHeader',
            normalizeMarkdownTableAlignment(alignments[index]) ? { align: normalizeMarkdownTableAlignment(alignments[index]) } : {},
            [helpers.createNode('paragraph', {}, parseInlineOrText(cell.tokens, cell.text, helpers))]
          )
        );

        rows.push(helpers.createNode('tableRow', {}, headerCells));
      }

      if (token.rows) {
        token.rows.forEach((row) => {
          const bodyCells = row.map((cell, index) =>
            helpers.createNode(
              'tableCell',
              normalizeMarkdownTableAlignment(alignments[index]) ? { align: normalizeMarkdownTableAlignment(alignments[index]) } : {},
              [helpers.createNode('paragraph', {}, parseInlineOrText(cell.tokens, cell.text, helpers))]
            )
          );

          rows.push(helpers.createNode('tableRow', {}, bodyCells));
        });
      }

      return helpers.createNode(
        'table',
        {
          ...createSourceLineNodeAttrs(token),
          markdownRaw: typeof token.raw === 'string' ? token.raw.replace(/\r\n/g, '\n').replace(/\n+$/, '') : null,
          markdownSignature: buildMarkdownTableSignatureFromToken(token, helpers)
        },
        rows
      );
    },
    renderMarkdown: (node: JSONContent, helpers): string => {
      const rawMarkdown = typeof node.attrs?.markdownRaw === 'string' ? node.attrs.markdownRaw : null;
      const importedSignature = typeof node.attrs?.markdownSignature === 'string' ? node.attrs.markdownSignature : null;

      if (rawMarkdown && importedSignature === buildMarkdownTableSignatureFromNode(node)) {
        return rawMarkdown.trimEnd();
      }

      return renderMarkdownTableFallback(node, helpers);
    }
  });

  const MarkdownLink = Link.extend({
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      if (!isExplicitLinkToken(token)) {
        return helpers.createTextNode(typeof token.raw === 'string' ? token.raw : token.text ?? '');
      }

      const content = helpers.parseInline(token.tokens || []);
      const href = typeof token.href === 'string' ? token.href : '';
      const title = typeof token.title === 'string' ? token.title : undefined;

      if (content.length) {
        return { mark: 'link', content, attrs: { href, title } };
      }

      const text = typeof token.text === 'string' ? token.text : '';
      return { mark: 'link', content: text ? [helpers.createTextNode(text)] : [], attrs: { href, title } };
    }
  });

  const FrontMatter = createFrontMatterExtension(false);

  const extensions = toAnyExtensions([
    StarterKit.configure({
      code: false,
      codeBlock: false,
      heading: false,
      link: false,
      listItem: false,
      paragraph: false,
      strike: false,
      underline: false,
      dropcursor: false
    }),
    Markdown,
    FrontMatter,
    HtmlComment,
    LinkDefinitionAsText,
    Heading,
    Paragraph,
    Code,
    CodeBlock,
    ListItem,
    MarkdownTable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Image.extend({
      addNodeView: () => VueNodeViewRenderer(ImageBlockView as unknown as Component<NodeViewProps>)
    }).configure({
      inline: false,
      allowBase64: true,
      HTMLAttributes: {
        class: 'editor-image'
      }
    }),
    TaskList,
    TaskItem.configure({
      nested: true
    }),
    Highlight.configure({
      multicolor: true
    }),
    MarkdownStrike,
    TextStyle,
    Color,
    HtmlInline,
    Typography,
    Underline,
    MarkdownLink.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'editor-link'
      }
    }),
    Mathematics.configure({
      katexOptions: {
        throwOnError: false
      }
    })
  ]);

  function assignHeadingIds(editor: Editor, headingOptions?: { silent?: boolean }): void {
    const { state, view } = editor;
    const { tr } = state;
    let index = 0;
    let needsUpdate = false;

    state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const expectedId = getHeadingId(index);
        if (node.attrs.id !== expectedId) {
          needsUpdate = true;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: expectedId });
        }
        index++;
      }
    });

    if (needsUpdate) {
      if (headingOptions?.silent) {
        tr.setMeta('preventUpdate', true).setMeta('addToHistory', false);
      }
      view.dispatch(tr);
    }
  }

  return {
    extensions,
    assignHeadingIds,
    resetHeadingIndex,
    getHeadingIndex: () => headingIndex
  };
}

/**
 * 创建运行时扩展集合（含 Vue NodeView、Plugin、Placeholder 等主线程专用扩展）。
 * 仅主线程使用。
 *
 * @param editorInstanceId - 编辑器实例 ID
 * @param options - 运行时扩展配置选项
 */
export function createRichEditorRuntimeOnlyExtensions(
  _editorInstanceId: string,
  options?: { onSearchMatchFocus?: (context: SearchScrollContext) => void }
): AnyExtension[] {
  return toAnyExtensions([
    Placeholder.configure({ emptyEditorClass: 'is-editor-empty', placeholder: resolveRichEditorPlaceholder }),
    AISelectionHighlight,
    InlineCommentMark,
    Search.configure({
      onMatchFocus: options?.onSearchMatchFocus ?? null
    })
  ]);
}
