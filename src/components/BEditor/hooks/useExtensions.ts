import type { NodeViewProps } from '@tiptap/vue-3';
import type { Component, Ref } from 'vue';
import {
  Extension,
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
import { Mathematics } from '@tiptap/extension-mathematics';
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
import StarterKit from '@tiptap/starter-kit';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { common, createLowlight } from 'lowlight';
import CodeBlockView from '../components/CodeBlock.vue';
import { AISelectionHighlight } from '../extensions/AISelectionHighlight';
import { Search, type SearchScrollContext } from '../extensions/Search';

const lowlight = createLowlight(common);

interface UseBEditorExtensionsResult {
  assignHeadingIds: (editor: Editor) => void;
  editorExtensions: AnyExtension[];
  resetHeadingIndex: () => void;
}

interface UseExtensionsOptions {
  onSearchMatchFocus?: (context: SearchScrollContext) => void;
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

function createParagraphNode(content: JSONContent[] = []): JSONContent {
  return {
    type: 'paragraph',
    content
  };
}

function getReferenceStyleLinkRaw(token: MarkdownToken): string | null {
  if (token.type !== 'link' || typeof token.raw !== 'string') {
    return null;
  }

  const raw = token.raw.trim();
  return /^\[[^\]]+\]\[[^\]]+\]$/.test(raw) ? raw : null;
}

function parseInlinePreservingReferenceLinks(tokens: MarkdownToken[] | undefined, helpers: MarkdownParseHelpers): JSONContent[] {
  if (!tokens?.length) {
    return [];
  }

  return tokens.flatMap((token) => {
    const raw = getReferenceStyleLinkRaw(token);

    if (raw) {
      return [helpers.createTextNode(raw)];
    }

    return helpers.parseInline([token]);
  });
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
 * @param helpers - Markdown 渲染辅助函数
 * @returns 当前表格的签名字符串
 */
function buildMarkdownTableSignatureFromNode(node: JSONContent, helpers: { renderChildren: (content: JSONContent | JSONContent[]) => string }): string {
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

export function useExtensions(editorInstanceId: Ref<string>, options: UseExtensionsOptions = {}): UseBEditorExtensionsResult {
  let headingIndex = 0;

  function resetHeadingIndex(): void {
    headingIndex = 0;
  }

  function getHeadingId(index: number): string {
    return `${editorInstanceId.value}-heading-${index}`;
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

      return helpers.createNode('paragraph', undefined, [helpers.createTextNode(normalized)]);
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

      return helpers.createNode('paragraph', undefined, [helpers.createTextNode(raw)]);
    }
  });

  const CodeBlock = CodeBlockLowlight.extend({
    addNodeView: () => VueNodeViewRenderer(CodeBlockView as unknown as Component<NodeViewProps>)
  }).configure({ lowlight });

  const Heading = BaseHeading.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        id: {
          default: null,
          parseHTML: (element) => element.getAttribute('id'),
          renderHTML: (attributes) => (attributes.id ? { id: attributes.id } : {})
        }
      };
    },
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const content = parseInlinePreservingReferenceLinks(token.tokens, helpers);
      const id = getHeadingId(headingIndex++);

      if (content.length) {
        return helpers.createNode('heading', { level: token.depth || 1, id }, content);
      }

      const text = typeof token.text === 'string' ? token.text.trim() : '';

      return helpers.createNode('heading', { level: token.depth || 1, id }, text ? [helpers.createTextNode(text)] : []);
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
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const content = parseInlinePreservingReferenceLinks(token.tokens, helpers);

      if (content.length) {
        return helpers.createNode('paragraph', undefined, content);
      }

      const text = typeof token.text === 'string' ? token.text : '';

      return helpers.createNode('paragraph', undefined, text ? [helpers.createTextNode(text)] : []);
    },
    renderMarkdown: (node: JSONContent, helpers, context): string => {
      const rawHtmlComment = getRawHtmlCommentFromParagraph(node);

      if (rawHtmlComment) {
        return rawHtmlComment;
      }

      const content = Array.isArray(node.content) ? node.content : [];

      if (content.length === 0) {
        const previousContent = Array.isArray(context?.previousNode?.content) ? context.previousNode.content : [];
        return context?.previousNode?.type === 'paragraph' && previousContent.length === 0 ? '&nbsp;' : '';
      }

      return helpers.renderChildren(content);
    }
  });

  const ListItem = BaseListItem.extend({
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
            contentNodes = [createParagraphNode(parseInlinePreservingReferenceLinks(firstToken.tokens, helpers))];

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
      return {
        ...this.parent?.(),
        markdownRaw: {
          default: null,
          renderHTML: () => ({})
        },
        markdownSignature: {
          default: null,
          renderHTML: () => ({})
        }
      };
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
          markdownRaw: typeof token.raw === 'string' ? token.raw.replace(/\r\n/g, '\n').replace(/\n+$/, '') : null,
          markdownSignature: buildMarkdownTableSignatureFromToken(token, helpers)
        },
        rows
      );
    },
    renderMarkdown: (node: JSONContent, helpers): string => {
      const rawMarkdown = typeof node.attrs?.markdownRaw === 'string' ? node.attrs.markdownRaw : null;
      const importedSignature = typeof node.attrs?.markdownSignature === 'string' ? node.attrs.markdownSignature : null;

      if (rawMarkdown && importedSignature === buildMarkdownTableSignatureFromNode(node, helpers)) {
        return rawMarkdown.trimEnd();
      }

      return renderMarkdownTableFallback(node, helpers);
    }
  });

  const MarkdownLink = Link.extend({
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
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

  const editorExtensions = [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      heading: false,
      link: false,
      listItem: false,
      paragraph: false,
      trailingNode: {
        notAfter: ['table']
      },
      strike: false,
      underline: false,
      // 禁用拖拽光标（拖拽时的蓝色插入线）
      dropcursor: false,
      // 禁用间隙光标
      gapcursor: false
    }),
    Placeholder.configure({ emptyEditorClass: 'is-editor-empty', placeholder: '请输入内容' }),
    Markdown,
    HtmlComment,
    LinkDefinitionAsText,
    AISelectionHighlight,
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
    Image.configure({
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
    Strike,
    TextStyle,
    Color,
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
  ];

  function assignHeadingIds(editor: Editor): void {
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
      view.dispatch(tr);
    }
  }

  return {
    assignHeadingIds,
    editorExtensions,
    resetHeadingIndex
  };
}
