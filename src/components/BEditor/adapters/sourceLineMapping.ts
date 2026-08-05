/**
 * @file sourceLineMapping.ts
 * @description Markdown 源码行号映射工具，负责在解析阶段记录块节点的真实行号，并在选区侧聚合行号范围。
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Token, Tokens } from 'marked';
import { Lexer, marked } from 'marked';
import { renderInlineText, type MarkdownInlineToken } from '../utils/markdownInlineSemantics';

/**
 * 节点上保存的源码行号属性。
 */
export interface SourceLineAttributes {
  /** 节点在 Markdown 源文件中的起始行号（1-based） */
  sourceLineStart?: number | null;
  /** 节点在 Markdown 源文件中的结束行号（1-based） */
  sourceLineEnd?: number | null;
}

/**
 * Markdown 源文件中的行号范围。
 */
export interface SourceLineRange {
  /** 起始行号（1-based） */
  startLine: number;
  /** 结束行号（1-based） */
  endLine: number;
}

/**
 * 源码行号范围映射到 ProseMirror 位置的结果。
 */
export interface LineRangeMappingResult {
  /** ProseMirror 文档起始位置 */
  from: number;
  /** ProseMirror 文档结束位置 */
  to: number;
  /** 是否精确覆盖目标源码行范围 */
  exact: boolean;
}

/**
 * 顶层块节点在文档中的位置信息。
 */
interface TopLevelBlockInfo {
  /** 顶层块节点 */
  node: ProseMirrorNode;
  /** 顶层块节点在文档中的起始位置 */
  pos: number;
}

/**
 * Markdown 列表项源码行信息。
 */
interface ListLineInfo extends SourceLineRange {
  /** 去除列表标记后的可比较文本 */
  text: string;
}

/**
 * ProseMirror 文本块范围信息。
 */
interface TextBlockRange {
  /** ProseMirror 起始位置 */
  from: number;
  /** ProseMirror 结束位置 */
  to: number;
  /** 可比较文本 */
  text: string;
}

/**
 * Markdown 物理行及其 Rich 可见文本。
 */
interface MarkdownTextLine {
  /** 1-based 物理源码行号 */
  sourceLine: number;
  /** 当前物理行在 Rich 文档中的可见文本 */
  text: string;
}

/**
 * 顶层 Markdown token 的源码行号与匹配信息。
 */
interface TopLevelMarkdownTokenInfo extends SourceLineRange {
  /** token 类型 */
  type: string;
  /** token 原始 Markdown 文本 */
  raw: string;
  /** token 纯文本内容 */
  text: string;
  /** token 中可与 Rich 文本逐行对齐的物理源码行 */
  contentLines: MarkdownTextLine[];
}

/**
 * 已对齐的顶层块与 Markdown token。
 */
interface AlignedTopLevelBlock {
  /** ProseMirror 顶层块信息 */
  blockInfo: TopLevelBlockInfo;
  /** Markdown token 行号与内容信息 */
  tokenInfo: TopLevelMarkdownTokenInfo;
}

/**
 * ProseMirror 文本行及其绝对位置。
 */
interface RichTextLine {
  /** 当前文本行起始位置 */
  from: number;
  /** 当前文本行结束位置 */
  to: number;
  /** 当前文本行可见文本 */
  text: string;
}

/**
 * 已按顺序对齐的 Markdown 与 Rich 文本行。
 */
interface AlignedTextLine {
  /** Markdown 物理文本行 */
  source: MarkdownTextLine;
  /** ProseMirror 文本行 */
  rich: RichTextLine;
}

/**
 * marked 容器 token 的递归结构。
 */
interface ContainerMarkdownToken extends MarkdownInlineToken {
  /** 列表项集合 */
  items?: Array<{
    /** 列表项内的块 token */
    tokens?: ContainerMarkdownToken[];
  }>;
  /** 容器内的块或行内 token */
  tokens?: ContainerMarkdownToken[];
}

/**
 * 容器内部表格的物理行修正结果。
 */
interface NestedTableLines {
  /** 表格结构覆盖的源码范围 */
  ranges: SourceLineRange[];
  /** 表格单元格对应的可见文本行 */
  lines: MarkdownTextLine[];
}

/**
 * 归一化用于匹配 Markdown token 与 Rich 块节点的文本。
 * @param text - 原始文本
 * @returns 可比较的文本
 */
function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 解析期的源码行号游标。
 */
export interface SourceLineTracker {
  /** 当前待分配的起始行号（1-based） */
  currentLine: number;
  /** 是否已经捕获过非空白 block token */
  hasCapturedContent: boolean;
}

/**
 * 创建新的源码行号游标。
 * @returns 初始位于第 1 行的游标
 */
export function createSourceLineTracker(): SourceLineTracker {
  return { currentLine: 1, hasCapturedContent: false };
}

/**
 * 将游标重置到 Markdown 源文件首行。
 * @param tracker - 当前源码行号游标
 */
export function resetSourceLineTracker(tracker: SourceLineTracker): void {
  tracker.currentLine = 1;
  tracker.hasCapturedContent = false;
}

/**
 * 统计字符串中换行符的数量（\r\n 和 \n 均计为一次换行）。
 * 使用 indexOf 替代正则，避免 4102 次 token 解析时的正则开销。
 * @param s - 待统计的字符串
 * @returns 换行符数量
 */
function countNewlines(s: string): number {
  let count = 0;
  let pos = s.indexOf('\n');
  while (pos !== -1) {
    count++;
    pos = s.indexOf('\n', pos + 1);
  }
  return count;
}

/**
 * 统计 token 原始文本实际覆盖的源码行数，不包含仅用于分隔块的尾随空行。
 * @param raw - token 原始 Markdown 文本
 * @returns token 覆盖的源码行数
 */
function getCoveredLineCount(raw: string): number {
  let end = raw.length;
  while (end > 0 && (raw[end - 1] === '\n' || raw[end - 1] === '\r')) {
    end--;
  }
  if (end === 0) {
    return 1;
  }

  // 换行统计只查找 `\n`，因此 CRLF 本身已经天然只计一次，不能再次抵消前置 `\r`。
  return countNewlines(raw.slice(0, end)) + 1;
}

/**
 * 统计 token 在源码中实际消耗的物理行数，包含尾随换行带来的跨行移动。
 * @param raw - token 原始 Markdown 文本
 * @returns 下一个 block token 应从多少行后开始
 */
function getConsumedLineCount(raw: string): number {
  if (!raw) {
    return 0;
  }

  const newlineCount = countNewlines(raw);
  const endsWithNewline = raw[raw.length - 1] === '\n' || (raw[raw.length - 1] === '\r' && raw[raw.length - 2] !== '\n');

  return endsWithNewline ? Math.max(1, newlineCount) : newlineCount + 1;
}

/**
 * 为当前 block token 分配源码行号，并推动游标到下一个 block token 的起点。
 * @param tracker - 当前源码行号游标
 * @param raw - token 原始 Markdown 文本
 * @returns 当前 token 对应的源码行号范围
 */
export function captureSourceLineRange(tracker: SourceLineTracker, raw: string): SourceLineRange {
  const startLine = tracker.currentLine;
  const coveredLineCount = getCoveredLineCount(raw);
  const consumedLineCount = getConsumedLineCount(raw);

  tracker.currentLine += consumedLineCount;
  tracker.hasCapturedContent = true;

  return {
    startLine,
    endLine: startLine + coveredLineCount - 1
  };
}

/**
 * 计算独立空白 token 对后续块起始行号的推进量。
 * @param raw - 空白 token 原始 Markdown 文本
 * @returns 需要推进的源码行数
 */
function getSpaceLineAdvance(raw: string, isLeading: boolean): number {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized) {
    return 0;
  }

  const newlineMatches = normalized.match(/\n/g);
  const newlineCount = newlineMatches ? newlineMatches.length : 0;

  if (newlineCount <= 0) {
    return 0;
  }

  // 文档开头的每个换行都位于首个内容块之前；块间 space 的首个换行已由前一块推进到下一行。
  return isLeading ? newlineCount : Math.max(1, newlineCount - 1);
}

/**
 * 消费不产出节点的 Markdown token 所占用的源码行数，例如独立空行 token。
 * @param tracker - 当前源码行号游标
 * @param raw - token 原始 Markdown 文本
 */
export function consumeSourceLineToken(tracker: SourceLineTracker, raw: string): void {
  tracker.currentLine += getSpaceLineAdvance(raw, !tracker.hasCapturedContent);
}

/**
 * 从节点 attrs 中读取合法的源码行号范围。
 * @param node - 当前 ProseMirror 节点
 * @returns 命中时返回源码行号范围，否则返回 null
 */
export function getNodeSourceLineRange(node: ProseMirrorNode): SourceLineRange | null {
  const attrs = node.attrs as SourceLineAttributes | undefined;
  const startLine = attrs?.sourceLineStart;
  const endLine = attrs?.sourceLineEnd;

  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine === undefined ||
    startLine === null ||
    endLine === undefined ||
    endLine === null
  ) {
    return null;
  }

  if (startLine <= 0 || endLine < startLine) {
    return null;
  }

  return { startLine, endLine };
}

/**
 * 判断节点是否为 Markdown 空行生成的隐式空段落。
 * @param node - 当前节点
 * @returns 命中时返回 true
 */
function isImplicitBlankParagraph(node: ProseMirrorNode): boolean {
  return node.type.name === 'paragraph' && node.textContent.length === 0 && getNodeSourceLineRange(node) === null;
}

/**
 * 统计文本中已跨过的换行次数，用于把块内偏移换算成源码行偏移。
 * @param text - 选区前的块内文本
 * @returns 换行数量
 */
function countLineBreaks(text: string): number {
  const newlineMatches = text.match(/\r?\n/g);
  return newlineMatches ? newlineMatches.length : 0;
}

/**
 * 基于给定的块级行号范围，计算选区与单个块节点交集后的精确行号范围。
 * @param node - 命中的块节点
 * @param pos - 块节点在文档中的起始位置
 * @param from - 整体选区起点
 * @param to - 整体选区终点
 * @param blockRange - 当前块的基准行号范围
 * @returns 命中时返回精确行号范围，否则返回 null
 */
function getPreciseSelectionLineRangeFromBaseRange(
  node: ProseMirrorNode,
  pos: number,
  from: number,
  to: number,
  blockRange: SourceLineRange
): SourceLineRange | null {
  const contentStart = pos + 1;
  const contentEnd = pos + node.content.size + 1;
  const selectionStart = Math.max(from, contentStart);
  const selectionEnd = Math.min(to, contentEnd);

  if (selectionStart >= selectionEnd) {
    return null;
  }

  const localStart = Math.max(0, selectionStart - contentStart);
  const localEnd = Math.max(localStart, selectionEnd - contentStart);
  const textBeforeStart = node.textBetween(0, localStart, '\n', '\n');
  const textBeforeEnd = node.textBetween(0, localEnd, '\n', '\n');
  const startLine = Math.min(blockRange.endLine, blockRange.startLine + countLineBreaks(textBeforeStart));
  const endLine = Math.min(blockRange.endLine, blockRange.startLine + countLineBreaks(textBeforeEnd));

  return { startLine, endLine };
}

/**
 * 计算选区与单个块节点交集后的精确源码行号范围。
 * @param node - 命中的块节点
 * @param pos - 块节点在文档中的起始位置
 * @param from - 整体选区起点
 * @param to - 整体选区终点
 * @returns 命中时返回精确源码行号范围，否则返回 null
 */
function getPreciseBlockSelectionSourceLineRange(node: ProseMirrorNode, pos: number, from: number, to: number): SourceLineRange | null {
  const blockRange = getNodeSourceLineRange(node);
  if (!blockRange) {
    return null;
  }

  return getPreciseSelectionLineRangeFromBaseRange(node, pos, from, to, blockRange);
}

/**
 * 将块内相对行号转换为文本偏移范围。
 * @param text - 块节点的纯文本内容
 * @param startLineOffset - 相对起始行号偏移（0-based）
 * @param endLineOffset - 相对结束行号偏移（0-based）
 * @returns 文本偏移范围
 */
function getLineOffsetsInText(text: string, startLineOffset: number, endLineOffset: number): { from: number; to: number } {
  const lines = text.split('\n');
  let cursor = 0;
  let from = 0;
  let to = text.length;

  lines.forEach((line, index) => {
    if (index === startLineOffset) {
      from = cursor;
    }

    cursor += line.length;

    if (index === endLineOffset) {
      to = cursor;
    }

    if (index < lines.length - 1) {
      cursor += 1;
    }
  });

  return { from, to };
}

/**
 * 根据源码行号范围，在单个块节点中反向定位 ProseMirror 位置。
 * @param node - 目标块节点
 * @param pos - 目标块节点在文档中的起始位置
 * @param startLine - 目标源码起始行号（1-based）
 * @param endLine - 目标源码结束行号（1-based）
 * @returns 块内命中的 ProseMirror 位置范围；未命中时返回 null
 */
function mapBlockSourceLineRangeToOffsets(
  node: ProseMirrorNode,
  pos: number,
  startLine: number,
  endLine: number,
  blockRange: SourceLineRange
): LineRangeMappingResult | null {
  if (blockRange.startLine > endLine || blockRange.endLine < startLine) {
    return null;
  }

  const contentStart = pos + 1;
  const contentEnd = pos + node.content.size + 1;
  const text = node.textBetween(0, node.content.size, '\n', '\n');

  if (!text) {
    return {
      from: contentStart,
      to: contentEnd,
      exact: false
    };
  }

  const relativeStartLine = Math.max(startLine, blockRange.startLine) - blockRange.startLine;
  const relativeEndLine = Math.min(endLine, blockRange.endLine) - blockRange.startLine;
  const offsets = getLineOffsetsInText(text, relativeStartLine, relativeEndLine);

  return {
    from: contentStart + offsets.from,
    to: Math.max(contentStart + offsets.from, contentStart + offsets.to),
    exact: true
  };
}

/**
 * 将一段 Markdown 行内源码转换为一个或多个 Rich 可见文本片段。
 * `<br>` 会在同一物理源码行内产生多个 Rich 文本行，因此返回数组。
 * @param line - 单行 Markdown 源码
 * @returns Rich 可见文本片段
 */
function renderSourceLine(line: string, decodeEntities = true): string[] {
  const rendered = renderInlineText(Lexer.lexInline(line), { decodeEntities });
  return rendered.split('\n');
}

/**
 * 移除引用、列表和任务列表的容器标记。
 * @param line - 容器内部的原始物理行
 * @returns 可继续进行行内语义解析的正文
 */
function stripContainerPrefix(line: string): string {
  let content = line;

  // 一个顶层 blockquote token 可能包含多层引用，逐层去掉每一层引用标记。
  while (/^\s{0,3}>/.test(content)) {
    content = content.replace(/^\s{0,3}>\s?/, '');
  }

  // 列表 token 内既可能是直接列表项，也可能是嵌套列表项。
  content = content.replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '');
  return content.trimStart();
}

/**
 * 将一行源码正文追加为可对齐的 Markdown 文本行。
 * @param lines - 当前已收集的文本行
 * @param sourceLine - 当前 1-based 物理行号
 * @param content - 去除块级标记后的行内 Markdown
 */
function appendSourceText(lines: MarkdownTextLine[], sourceLine: number, content: string, decodeEntities = true): void {
  renderSourceLine(content, decodeEntities).forEach((text) => {
    if (normalizeComparableText(text)) {
      lines.push({ sourceLine, text });
    }
  });
}

/**
 * 去除 Rich 行内批注的属性包装。
 * token 逐个渲染后仍需在物理行级别执行一次，以覆盖跨多个 inline token 的批注正文。
 * @param text - 当前物理行聚合文本
 * @returns Rich 文档可见文本
 */
function stripCommentMarkup(text: string): string {
  return text.replace(/\[([^\]]*)\]\{comment="[^"]*"(?:\s+id="[^"]*")?\}/g, '$1');
}

/**
 * 保留 marked 完整上下文，将顶层 inline token 逐个映射到真实物理行。
 * 这既保留引用定义解析结果，也能区分源码换行与同一行内的 `<br>`。
 * @param tokens - 顶层 token 已解析的 inline token
 * @param startLine - 顶层 token 起始物理行
 * @returns 按 Rich 文本行顺序排列的 Markdown 文本行
 */
function getInlineTextLines(tokens: readonly MarkdownInlineToken[], startLine: number, decodeEntities = true): MarkdownTextLine[] {
  const lines: MarkdownTextLine[] = [];
  let sourceLine = startLine;
  let currentText = '';

  /** 把当前聚合文本写入对应物理行。 */
  function flushInlineText(): void {
    const text = stripCommentMarkup(currentText);
    if (normalizeComparableText(text)) {
      lines.push({ sourceLine, text });
    }
    currentText = '';
  }

  tokens.forEach((token) => {
    const raw = typeof token.raw === 'string' ? token.raw : '';
    const rawBreakCount = countNewlines(raw);
    const renderedParts = renderInlineText([token], { decodeEntities }).split('\n');
    let consumedRawBreaks = 0;

    renderedParts.forEach((part, partIndex) => {
      currentText += part;
      if (partIndex >= renderedParts.length - 1) {
        return;
      }

      flushInlineText();
      if (consumedRawBreaks < rawBreakCount) {
        sourceLine += 1;
        consumedRawBreaks += 1;
      }
    });

    // 被语义渲染完全移除的 token 仍可能跨物理行，必须继续推进源码坐标。
    if (consumedRawBreaks < rawBreakCount) {
      flushInlineText();
      sourceLine += rawBreakCount - consumedRawBreaks;
    }
  });

  flushInlineText();
  return lines;
}

/**
 * 将表格单元格内的 Rich 文本行追加到同一物理源码行。
 * @param lines - 已收集表格文本行
 * @param sourceLine - 单元格所在物理行
 * @param text - 单元格 Rich 可见文本
 */
function appendTableCell(lines: MarkdownTextLine[], sourceLine: number, text: string): void {
  text.split('\n').forEach((textPart) => {
    if (normalizeComparableText(textPart)) {
      lines.push({ sourceLine, text: textPart });
    }
  });
}

/**
 * 构建 Markdown 表格每个单元格对应的物理源码行。
 * @param token - marked 表格 token
 * @param startLine - 表格 token 起始物理行
 * @returns 按 Rich 单元格顺序排列的文本行
 */
function getTableTextLines(token: Tokens.Table, startLine: number): MarkdownTextLine[] {
  const lines: MarkdownTextLine[] = [];

  token.header.forEach((cell) => {
    const text = renderInlineText(cell.tokens, { decodeEntities: false });
    appendTableCell(lines, startLine, text);
  });

  token.rows.forEach((row, rowIndex) => {
    row.forEach((cell) => {
      const text = renderInlineText(cell.tokens, { decodeEntities: false });
      // Markdown 表格第 2 行固定为对齐分隔行，正文从第 3 行开始。
      appendTableCell(lines, startLine + rowIndex + 2, text);
    });
  });

  return lines;
}

/**
 * 判断 marked token 是否包含完整表格结构。
 * @param token - 待判断顶层 token
 * @returns 可安全读取表头和正文行时返回 true
 */
function isTableToken(token: Token): token is Tokens.Table {
  return token.type === 'table' && 'header' in token && Array.isArray(token.header) && 'rows' in token && Array.isArray(token.rows);
}

/**
 * 递归收集容器 AST 内的 marked 表格 token。
 * @param token - 当前容器 token
 * @returns 按文档顺序排列的表格 token
 */
function collectContainerTables(token: ContainerMarkdownToken): Tokens.Table[] {
  if (token.type === 'table' && 'header' in token && Array.isArray(token.header) && 'rows' in token && Array.isArray(token.rows)) {
    return [token as unknown as Tokens.Table];
  }

  const itemTables = (token.items ?? []).flatMap((item) => (item.tokens ?? []).flatMap((itemToken) => collectContainerTables(itemToken)));
  const childTables = (token.tokens ?? []).flatMap((childToken) => collectContainerTables(childToken));
  return [...itemTables, ...childTables];
}

/**
 * 恢复 blockquote/list 内表格的单元格级物理行。
 * marked 顶层容器保留了单元格语义，但原始行带容器前缀，因此使用去前缀副本定位表格起止行。
 * @param token - 顶层容器 token
 * @param rawLines - 顶层容器原始物理行
 * @param startLine - 顶层容器起始物理行
 * @returns 嵌套表格范围和单元格文本行
 */
function getNestedTableLines(token: ContainerMarkdownToken, rawLines: string[], startLine: number): NestedTableLines {
  const sanitizedMarkdown = rawLines.map((line) => stripContainerPrefix(line)).join('\n');
  const sanitizedTokens = marked.lexer(sanitizedMarkdown);
  const originalTables = collectContainerTables(token);
  const tracker = createSourceLineTracker();
  const ranges: SourceLineRange[] = [];
  const lines: MarkdownTextLine[] = [];
  let tableIndex = 0;

  sanitizedTokens.forEach((sanitizedToken) => {
    const raw = typeof sanitizedToken.raw === 'string' ? sanitizedToken.raw : '';
    if (sanitizedToken.type === 'space') {
      consumeSourceLineToken(tracker, raw);
      return;
    }
    if (!raw) {
      return;
    }

    const localRange = captureSourceLineRange(tracker, raw);
    if (!isTableToken(sanitizedToken)) {
      return;
    }

    const tableToken = originalTables[tableIndex] ?? sanitizedToken;
    const globalRange = {
      startLine: startLine + localRange.startLine - 1,
      endLine: startLine + localRange.endLine - 1
    };
    ranges.push(globalRange);
    lines.push(...getTableTextLines(tableToken, globalRange.startLine));
    tableIndex += 1;
  });

  return { ranges, lines };
}

/**
 * 从 marked 容器 AST 中提取 Rich 解析器实际生成的可见文本行。
 * @param token - 当前容器或块 token
 * @returns 按 Rich 文档顺序排列的语义文本
 */
function collectContainerText(token: ContainerMarkdownToken): string[] {
  if (token.type === 'table' && 'header' in token && Array.isArray(token.header) && 'rows' in token && Array.isArray(token.rows)) {
    return getTableTextLines(token as unknown as Tokens.Table, 1).map(({ text }) => text);
  }

  if ((token.type === 'paragraph' || token.type === 'heading' || token.type === 'text') && Array.isArray(token.tokens)) {
    return getInlineTextLines(token.tokens, 1, false).map(({ text }) => text);
  }

  if (token.type === 'code' && typeof token.text === 'string') {
    return token.text.split(/\r?\n/).filter((text) => normalizeComparableText(text));
  }

  if (token.type === 'list' && Array.isArray(token.items)) {
    return token.items.flatMap((item) => (item.tokens ?? []).flatMap((itemToken) => collectContainerText(itemToken)));
  }

  if (Array.isArray(token.tokens)) {
    return token.tokens.flatMap((childToken) => collectContainerText(childToken));
  }

  let text = '';
  if (typeof token.text === 'string') {
    text = token.text;
  } else if (typeof token.raw === 'string') {
    text = token.raw;
  }
  return normalizeComparableText(text) ? [text] : [];
}

/**
 * 用 marked 容器 AST 的语义文本修正逐物理行解析结果。
 * @param lines - 已定位物理行的启发式结果
 * @param token - 顶层容器 token
 * @returns 物理行与 Rich 语义均已对齐的文本行
 */
function applyContainerText(lines: MarkdownTextLine[], token: ContainerMarkdownToken): MarkdownTextLine[] {
  const semanticLines = collectContainerText(token);
  if (semanticLines.length !== lines.length) {
    return lines;
  }

  return lines.map((line, index) => ({ ...line, text: semanticLines[index] ?? line.text }));
}

/**
 * 判断 code token 是否使用围栏语法，并返回围栏字符与长度。
 * @param firstLine - code token 第一行
 * @returns 围栏描述；缩进代码块返回 null
 */
function getCodeFence(firstLine: string): { character: '`' | '~'; length: number } | null {
  const match = /^\s{0,3}(`{3,}|~{3,})/.exec(firstLine);
  const fence = match?.[1];
  if (!fence) {
    return null;
  }

  return {
    character: fence[0] as '`' | '~',
    length: fence.length
  };
}

/**
 * 判断物理行是否为给定 code token 的结束围栏。
 * @param line - 待判断物理行
 * @param fence - 开始围栏描述
 * @returns 是否为合法结束围栏
 */
function isClosingCodeFence(line: string, fence: { character: '`' | '~'; length: number }): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] !== fence.character) {
    return false;
  }

  return trimmed.split('').every((character) => character === fence.character) && trimmed.length >= fence.length;
}

/**
 * 构建顶层 Markdown token 内可与 ProseMirror 逐行对齐的文本。
 * @param token - marked 顶层 token
 * @param tokenRange - token 的真实物理行范围
 * @returns token 内按文档顺序排列的可见文本行
 */
function getTokenContentLines(token: Token, tokenRange: SourceLineRange): MarkdownTextLine[] {
  if (isTableToken(token)) {
    return getTableTextLines(token, tokenRange.startLine);
  }

  if (token.type === 'hr') {
    return [];
  }

  if ((token.type === 'paragraph' || token.type === 'heading') && Array.isArray(token.tokens)) {
    return getInlineTextLines(token.tokens, tokenRange.startLine);
  }

  const raw = typeof token.raw === 'string' ? token.raw.replace(/\r\n/g, '\n').replace(/\n$/, '') : '';
  const rawLines = raw.split('\n');
  const lines: MarkdownTextLine[] = [];

  if (token.type === 'code') {
    const fence = getCodeFence(rawLines[0] ?? '');
    const contentStart = fence ? 1 : 0;
    const hasClosingFence = fence ? isClosingCodeFence(rawLines[rawLines.length - 1] ?? '', fence) : false;
    const contentEnd = hasClosingFence ? rawLines.length - 1 : rawLines.length;

    for (let index = contentStart; index < contentEnd; index += 1) {
      const content = fence ? rawLines[index] ?? '' : (rawLines[index] ?? '').replace(/^(?: {4}|\t)/, '');
      if (content) {
        lines.push({ sourceLine: tokenRange.startLine + index, text: content });
      }
    }
    return lines;
  }

  rawLines.forEach((rawLine, index) => {
    let content = rawLine;

    if (token.type === 'blockquote' || token.type === 'list') {
      content = stripContainerPrefix(content);
    }

    if (token.type === 'heading') {
      if (index > 0 && /^\s*(?:=+|-+)\s*$/.test(content)) {
        return;
      }
      content = content.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, '');
    }

    appendSourceText(lines, tokenRange.startLine + index, content, token.type !== 'blockquote' && token.type !== 'list');
  });

  if (token.type !== 'blockquote' && token.type !== 'list') {
    return lines;
  }

  const nestedTables = getNestedTableLines(token, rawLines, tokenRange.startLine);
  const nonTableLines = lines.filter(({ sourceLine }) => !nestedTables.ranges.some((range) => sourceLine >= range.startLine && sourceLine <= range.endLine));
  const correctedLines = [...nonTableLines, ...nestedTables.lines].sort((left, right) => left.sourceLine - right.sourceLine);
  return applyContainerText(correctedLines, token);
}

/**
 * 读取 Markdown token 的 Rich 可见文本。
 * @param contentLines - token 内已经按物理行拆分的可见文本
 * @returns 用于顶层结构对齐的语义文本
 */
function getTokenText(contentLines: MarkdownTextLine[]): string {
  return contentLines.map((line) => line.text).join('\n');
}

/**
 * 构建顶层 Markdown token 信息列表，包含对独立空行的行号推进。
 * @param markdown - 原始 Markdown 文本
 * @returns 顶层非 space token 信息列表
 */
function getMarkdownTokens(markdown: string): TopLevelMarkdownTokenInfo[] {
  const tokens = marked.lexer(markdown);
  const tracker = createSourceLineTracker();
  const tokenInfos: TopLevelMarkdownTokenInfo[] = [];

  tokens.forEach((token) => {
    if (token.type === 'space') {
      consumeSourceLineToken(tracker, token.raw || '');
      return;
    }

    const raw = typeof token.raw === 'string' ? token.raw : '';
    if (!raw) {
      return;
    }

    const tokenRange = captureSourceLineRange(tracker, raw);
    const contentLines = getTokenContentLines(token, tokenRange);

    tokenInfos.push({
      ...tokenRange,
      type: token.type,
      raw,
      text: getTokenText(contentLines),
      contentLines
    });
  });

  return tokenInfos;
}

/**
 * 提取文档顶层块节点及其位置，供源码 token 顺序映射使用。
 * @param doc - 当前 ProseMirror 文档
 * @returns 顶层块节点信息列表
 */
function getTopLevelBlocks(doc: ProseMirrorNode): TopLevelBlockInfo[] {
  const blocks: TopLevelBlockInfo[] = [];

  doc.forEach((node, offset) => {
    if (!node.isBlock) {
      return;
    }

    blocks.push({ node, pos: offset });
  });

  return blocks;
}

/**
 * 判断 ProseMirror 节点是否为列表容器。
 * @param node - ProseMirror 节点
 * @returns 是否为列表节点
 */
function isListNode(node: ProseMirrorNode): boolean {
  return ['bulletList', 'orderedList', 'taskList'].includes(node.type.name);
}

/**
 * 判断 token 的逐行可见文本是否与 Rich 块文本一致。
 * hardBreak 没有 textContent，因此同时接受“保留行间空格”和“直接拼接”两种合法表示。
 * @param tokenInfo - Markdown token 信息
 * @param nodeText - Rich 块 textContent
 * @returns 是否为同一可见文本
 */
function matchesTokenText(tokenInfo: TopLevelMarkdownTokenInfo, nodeText: string): boolean {
  const normalizedNodeText = normalizeComparableText(nodeText);
  const joinedText = tokenInfo.contentLines.map(({ text }) => text).join('');

  return normalizeComparableText(tokenInfo.text) === normalizedNodeText || normalizeComparableText(joinedText) === normalizedNodeText;
}

/**
 * 去除代码块中没有可见文本的空行，保留其余行的原始空白。
 * 空行由逐行映射单独处理，不能阻止顶层 code token 与 Rich codeBlock 对齐。
 * @param text - 代码块文本
 * @returns 用于顶层结构对齐的代码文本
 */
function normalizeCodeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .join('\n')
    .trim();
}

/**
 * 判断 Markdown token 是否与 ProseMirror 顶层块表示同一个结构。
 * @param tokenInfo - Markdown token 信息
 * @param node - ProseMirror 顶层块节点
 * @returns 是否匹配
 */
function matchTokenBlock(tokenInfo: TopLevelMarkdownTokenInfo, node: ProseMirrorNode): boolean {
  if (tokenInfo.type === 'heading') {
    return node.type.name === 'heading' && matchesTokenText(tokenInfo, node.textContent);
  }

  if (tokenInfo.type === 'code') {
    return node.type.name === 'codeBlock' && normalizeCodeText(tokenInfo.text) === normalizeCodeText(node.textContent);
  }

  if (tokenInfo.type === 'hr') {
    return node.type.name === 'horizontalRule';
  }

  if (tokenInfo.type === 'table') {
    return node.type.name === 'table';
  }

  if (tokenInfo.type === 'blockquote') {
    return node.type.name === 'blockquote';
  }

  if (tokenInfo.type === 'list') {
    return isListNode(node);
  }

  if (tokenInfo.type === 'paragraph') {
    return node.type.name === 'paragraph' && matchesTokenText(tokenInfo, node.textContent);
  }

  if (tokenInfo.type === 'html' || tokenInfo.type === 'def') {
    return (
      node.type.name === 'paragraph' &&
      (matchesTokenText(tokenInfo, node.textContent) || normalizeComparableText(tokenInfo.raw) === normalizeComparableText(node.textContent))
    );
  }

  return false;
}

/**
 * 将顶层 Markdown token 与 rich 顶层块按顺序贪心对齐。
 * marked 会把某些 mixed list 拆成多个顶层 list token，rich 文档则可能合并成更少的块，因此不能按数组索引直连。
 * @param topLevelBlocks - ProseMirror 顶层块列表
 * @param tokenInfos - Markdown 顶层 token 信息列表
 * @returns 已对齐的顶层块与 token 列表
 */
function alignTopLevelBlocks(topLevelBlocks: TopLevelBlockInfo[], tokenInfos: TopLevelMarkdownTokenInfo[]): AlignedTopLevelBlock[] {
  const alignedBlocks: AlignedTopLevelBlock[] = [];
  let tokenIndex = 0;

  topLevelBlocks.forEach((blockInfo) => {
    for (let index = tokenIndex; index < tokenInfos.length; index += 1) {
      const tokenInfo = tokenInfos[index];
      if (!tokenInfo || !matchTokenBlock(tokenInfo, blockInfo.node)) {
        continue;
      }

      alignedBlocks.push({ blockInfo, tokenInfo });
      tokenIndex = index + 1;
      return;
    }
  });

  return alignedBlocks;
}

/**
 * 将一个 ProseMirror textblock 拆为可定位的可见文本行。
 * @param node - 当前 textblock 节点
 * @param pos - 当前 textblock 在文档中的起始位置
 * @returns 按文档顺序排列的文本行
 */
function splitRichTextblock(node: ProseMirrorNode, pos: number): RichTextLine[] {
  const lines: RichTextLine[] = [];
  const contentStart = pos + 1;
  let lineFrom = contentStart;
  let lineTo = contentStart;
  let lineText = '';

  /** 将当前非空文本行写入结果。 */
  function flushRichTextLine(): void {
    if (normalizeComparableText(lineText)) {
      lines.push({ from: lineFrom, to: lineTo, text: lineText });
    }
    lineText = '';
  }

  node.forEach((child, offset) => {
    const childPos = contentStart + offset;

    if (child.isText && typeof child.text === 'string') {
      let segmentStart = 0;
      let newlineIndex = child.text.indexOf('\n');

      while (newlineIndex >= 0) {
        lineText += child.text.slice(segmentStart, newlineIndex);
        lineTo = childPos + newlineIndex;
        flushRichTextLine();
        lineFrom = childPos + newlineIndex + 1;
        segmentStart = newlineIndex + 1;
        newlineIndex = child.text.indexOf('\n', segmentStart);
      }

      lineText += child.text.slice(segmentStart);
      lineTo = childPos + child.nodeSize;
      return;
    }

    if (child.type.name === 'hardBreak') {
      lineTo = childPos;
      flushRichTextLine();
      lineFrom = childPos + child.nodeSize;
      lineTo = lineFrom;
      return;
    }

    // 图片等行内原子节点没有 textContent，但位置仍必须计入当前行的可选范围。
    lineTo = childPos + child.nodeSize;
  });

  flushRichTextLine();
  return lines;
}

/**
 * 收集一个顶层 Rich 块子树中的所有 textblock 文本行。
 * @param blockInfo - 顶层 Rich 块信息
 * @returns 按文档顺序排列的文本行
 */
function getRichTextLines(blockInfo: TopLevelBlockInfo): RichTextLine[] {
  const { node, pos } = blockInfo;
  if (node.isTextblock) {
    return splitRichTextblock(node, pos);
  }

  const lines: RichTextLine[] = [];
  node.descendants((child, childPos): boolean => {
    if (!child.isTextblock) {
      return true;
    }

    lines.push(...splitRichTextblock(child, pos + childPos + 1));
    return false;
  });
  return lines;
}

/**
 * 按文本和出现顺序对齐 Markdown 物理行与 Rich 文本行。
 * @param sourceLines - Markdown 物理文本行
 * @param richLines - ProseMirror 文本行
 * @returns 可证明为同一可见文本的行对
 */
function alignTextLines(sourceLines: MarkdownTextLine[], richLines: RichTextLine[]): AlignedTextLine[] {
  const alignedLines: AlignedTextLine[] = [];
  let sourceIndex = 0;

  richLines.forEach((rich) => {
    const richText = normalizeComparableText(rich.text);
    for (let index = sourceIndex; index < sourceLines.length; index += 1) {
      const source = sourceLines[index];
      if (!source || normalizeComparableText(source.text) !== richText) {
        continue;
      }

      alignedLines.push({ source, rich });
      sourceIndex = index + 1;
      return;
    }
  });

  return alignedLines;
}

/**
 * 使用逐文本行对齐计算 Rich 选区的真实物理源码行。
 * @param blockInfo - 已对齐的顶层 Rich 块
 * @param tokenInfo - 已对齐的顶层 Markdown token
 * @param from - Rich 选区起点
 * @param to - Rich 选区终点
 * @returns 精确物理行范围；无法证明对齐时返回 null
 */
function mapSelectionTextLines(blockInfo: TopLevelBlockInfo, tokenInfo: TopLevelMarkdownTokenInfo, from: number, to: number): SourceLineRange | null {
  const alignedLines = alignTextLines(tokenInfo.contentLines, getRichTextLines(blockInfo));
  const selectedLines = alignedLines.filter(({ rich }) => from < rich.to && to > rich.from);
  if (selectedLines.length === 0) {
    return null;
  }

  return {
    startLine: Math.min(...selectedLines.map(({ source }) => source.sourceLine)),
    endLine: Math.max(...selectedLines.map(({ source }) => source.sourceLine))
  };
}

/**
 * 使用逐文本行对齐把物理源码行反向映射到 Rich 文本位置。
 * @param blockInfo - 已对齐的顶层 Rich 块
 * @param tokenInfo - 已对齐的顶层 Markdown token
 * @param startLine - 目标源码起始行
 * @param endLine - 目标源码结束行
 * @returns 精确 Rich 文本范围；目标行无可见文本时返回 null
 */
function mapSourceTextLines(
  blockInfo: TopLevelBlockInfo,
  tokenInfo: TopLevelMarkdownTokenInfo,
  startLine: number,
  endLine: number
): LineRangeMappingResult | null {
  const targetSourceLines = tokenInfo.contentLines.filter(({ sourceLine }) => sourceLine >= startLine && sourceLine <= endLine);
  if (targetSourceLines.length === 0) {
    return null;
  }

  const alignedLines = alignTextLines(tokenInfo.contentLines, getRichTextLines(blockInfo));
  const mappedLines = alignedLines.filter(({ source }) => source.sourceLine >= startLine && source.sourceLine <= endLine);
  if (mappedLines.length === 0) {
    return null;
  }

  return {
    from: Math.min(...mappedLines.map(({ rich }) => rich.from)),
    to: Math.max(...mappedLines.map(({ rich }) => rich.to)),
    exact: mappedLines.length === targetSourceLines.length
  };
}

/**
 * 判断两个源码行号范围是否相交。
 * @param range - 已知源码行号范围
 * @param startLine - 目标起始行
 * @param endLine - 目标结束行
 * @returns 是否相交
 */
function isLineRangeOverlapping(range: SourceLineRange, startLine: number, endLine: number): boolean {
  return range.startLine <= endLine && range.endLine >= startLine;
}

/**
 * 从源码列表行中提取可与 rich 段落匹配的文本。
 * @param line - Markdown 源码列表行
 * @returns 可比较文本；非列表项返回 null
 */
function extractListLineText(line: string): string | null {
  const taskMatch = /^\s*(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s+(.*)$/.exec(line);
  if (taskMatch?.[1]) {
    return normalizeComparableText(taskMatch[1]);
  }

  const listMatch = /^\s*(?:[-+*]|\d+[.)])\s+(.*)$/.exec(line);
  if (listMatch?.[1]) {
    return normalizeComparableText(listMatch[1]);
  }

  return null;
}

/**
 * 从 Markdown list token 中提取每个物理列表项行。
 * @param tokenInfo - Markdown list token 信息
 * @returns 列表项源码行信息
 */
function getListLineInfos(tokenInfo: TopLevelMarkdownTokenInfo): ListLineInfo[] {
  return tokenInfo.raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((line, index): ListLineInfo[] => {
      const text = extractListLineText(line);
      if (!text) {
        return [];
      }

      const lineNumber = tokenInfo.startLine + index;
      return [{ startLine: lineNumber, endLine: lineNumber, text }];
    });
}

/**
 * 提取列表子树中可选中的段落文本范围。
 * @param blockInfo - 顶层列表块信息
 * @returns 段落文本范围列表
 */
function getListTextBlockRanges(blockInfo: TopLevelBlockInfo): TextBlockRange[] {
  const ranges: TextBlockRange[] = [];

  blockInfo.node.descendants((node, pos) => {
    if (node.type.name !== 'paragraph' || !node.textContent) {
      return;
    }

    const paragraphPos = blockInfo.pos + pos + 1;
    ranges.push({
      from: paragraphPos + 1,
      to: paragraphPos + node.content.size + 1,
      text: normalizeComparableText(node.textContent)
    });
  });

  return ranges;
}

/**
 * 根据 Markdown list token 的真实源码行号反向定位 rich 列表项文本。
 * @param blockInfo - 顶层列表块信息
 * @param tokenInfo - Markdown list token 信息
 * @param startLine - 目标起始行
 * @param endLine - 目标结束行
 * @returns 命中的 ProseMirror 范围；未命中时返回 null
 */
function mapListTokenLineRangeToOffsets(
  blockInfo: TopLevelBlockInfo,
  tokenInfo: TopLevelMarkdownTokenInfo,
  startLine: number,
  endLine: number
): LineRangeMappingResult | null {
  if (tokenInfo.type !== 'list' || !isListNode(blockInfo.node) || !isLineRangeOverlapping(tokenInfo, startLine, endLine)) {
    return null;
  }

  const selectedLines = getListLineInfos(tokenInfo).filter((lineInfo) => isLineRangeOverlapping(lineInfo, startLine, endLine));
  const textRanges = getListTextBlockRanges(blockInfo);
  let textRangeIndex = 0;
  let matchedCount = 0;
  let mappedRange: LineRangeMappingResult | null = null;

  for (const lineInfo of selectedLines) {
    for (let index = textRangeIndex; index < textRanges.length; index += 1) {
      const textRange = textRanges[index];
      if (!textRange || textRange.text !== lineInfo.text) {
        continue;
      }

      if (!mappedRange) {
        mappedRange = { from: textRange.from, to: textRange.to, exact: true };
      } else {
        mappedRange = {
          from: Math.min(mappedRange.from, textRange.from),
          to: Math.max(mappedRange.to, textRange.to),
          exact: mappedRange.exact
        };
      }
      textRangeIndex = index + 1;
      matchedCount += 1;
      break;
    }
  }

  if (!mappedRange) {
    return null;
  }

  return {
    from: mappedRange.from,
    to: mappedRange.to,
    exact: matchedCount === selectedLines.length
  };
}

/**
 * 聚合多个块节点命中的 ProseMirror 范围。
 * @param current - 当前已聚合的范围
 * @param next - 新命中的范围
 * @returns 合并后的范围
 */
function mergeMappedLineRange(current: LineRangeMappingResult | null, next: LineRangeMappingResult | null): LineRangeMappingResult | null {
  if (!next) {
    return current;
  }

  if (!current) {
    return next;
  }

  return {
    from: Math.min(current.from, next.from),
    to: Math.max(current.to, next.to),
    exact: current.exact && next.exact
  };
}

/**
 * 基于顶层 Markdown token 的真实行号，修正一个顶层块子树内所有带 attrs 的块节点范围。
 * 这样即使导入阶段忽略了 space token，也能恢复空行后的真实源码行号。
 * @param blockInfo - 顶层块节点及其位置
 * @param tokenRange - 对齐后的顶层 Markdown token 行号范围
 * @param startLine - 目标源码起始行号
 * @param endLine - 目标源码结束行号
 * @returns 命中的 ProseMirror 范围；未命中时返回 null
 */
function mapTopLevelBlockSourceLineRangeToOffsets(
  blockInfo: TopLevelBlockInfo,
  tokenRange: TopLevelMarkdownTokenInfo,
  startLine: number,
  endLine: number
): LineRangeMappingResult | null {
  const textLineRange = mapSourceTextLines(blockInfo, tokenRange, startLine, endLine);
  if (textLineRange) {
    return textLineRange;
  }

  // 目标物理行有可见文本却无法与 Rich 文本证明对齐时失败关闭，禁止继续用 attrs 猜测位置。
  const hasTargetText = tokenRange.contentLines.some(({ sourceLine }) => sourceLine >= startLine && sourceLine <= endLine);
  if (hasTargetText) {
    return null;
  }

  const listRange = mapListTokenLineRangeToOffsets(blockInfo, tokenRange, startLine, endLine);
  if (listRange) {
    return listRange;
  }

  const { node, pos } = blockInfo;
  let subtreeDelta: number | null = null;
  let mappedRange: LineRangeMappingResult | null = null;

  /**
   * 使用同一个顶层块子树内的统一 delta 修正块节点源码行号。
   * @param blockNode - 当前块节点
   * @param blockPos - 当前块节点在文档中的绝对位置
   */
  function visitBlockNode(blockNode: ProseMirrorNode, blockPos: number): void {
    const rawRange = getNodeSourceLineRange(blockNode);
    if (!rawRange) {
      return;
    }

    if (subtreeDelta === null) {
      subtreeDelta = tokenRange.startLine - rawRange.startLine;
    }

    const adjustedRange: SourceLineRange = {
      startLine: rawRange.startLine + subtreeDelta,
      endLine: rawRange.endLine + subtreeDelta
    };

    mappedRange = mergeMappedLineRange(mappedRange, mapBlockSourceLineRangeToOffsets(blockNode, blockPos, startLine, endLine, adjustedRange));
  }

  visitBlockNode(node, pos);

  node.descendants((childNode, childPos) => {
    if (!childNode.isBlock) {
      return;
    }

    visitBlockNode(childNode, pos + childPos + 1);
  });

  return mappedRange;
}

/**
 * 基于原始 Markdown 顶层 token 顺序，计算当前选区的真实源码行号范围。
 * 适用于节点 attrs 尚未覆盖所有块类型或空白分隔被忽略的场景。
 * @param doc - 当前 ProseMirror 文档
 * @param from - 选区起点
 * @param to - 选区终点
 * @param markdown - 当前文档原始 Markdown 文本
 * @returns 聚合后的源码行号范围；无法稳定对齐时返回 null
 */
export function getSelectionSourceLineRangeFromMarkdown(doc: ProseMirrorNode, from: number, to: number, markdown: string): SourceLineRange | null {
  if (!markdown.trim()) {
    return null;
  }

  const alignedBlocks = alignTopLevelBlocks(getTopLevelBlocks(doc), getMarkdownTokens(markdown));

  let startLine = Number.POSITIVE_INFINITY;
  let endLine = 0;

  alignedBlocks.forEach(({ blockInfo, tokenInfo }) => {
    const preciseRange = mapSelectionTextLines(blockInfo, tokenInfo, from, to);
    if (!preciseRange) {
      return;
    }

    startLine = Math.min(startLine, preciseRange.startLine);
    endLine = Math.max(endLine, preciseRange.endLine);
  });

  if (!Number.isFinite(startLine) || endLine <= 0) {
    return null;
  }

  return { startLine, endLine };
}

/**
 * 从当前选区覆盖到的块节点中聚合真实源码行号。
 * @param doc - 当前 ProseMirror 文档
 * @param from - 选区起点
 * @param to - 选区终点
 * @returns 聚合后的源码行号范围；未命中任何带源码坐标的节点时返回 null
 */
export function getSelectionSourceLineRange(doc: ProseMirrorNode, from: number, to: number): SourceLineRange | null {
  if (from >= to) {
    return null;
  }

  let startLine = Number.POSITIVE_INFINITY;
  let endLine = 0;
  let blankLineOffset = 0;

  doc.descendants((node, pos) => {
    if (!node.isBlock) {
      return;
    }

    if (isImplicitBlankParagraph(node)) {
      blankLineOffset++;
      return;
    }

    const range = getPreciseBlockSelectionSourceLineRange(node, pos, from, to);
    if (!range) {
      return;
    }

    startLine = Math.min(startLine, range.startLine + blankLineOffset);
    endLine = Math.max(endLine, range.endLine + blankLineOffset);
  });

  if (!Number.isFinite(startLine) || endLine <= 0) {
    return null;
  }

  return { startLine, endLine };
}

/**
 * 根据源码行号范围，在 ProseMirror 文档中反向查找对应的位置范围。
 * @param doc - 当前 ProseMirror 文档
 * @param startLine - 源码起始行号（1-based）
 * @param endLine - 源码结束行号（1-based）
 * @returns 映射结果；无法定位时返回 null
 */
export function mapSourceLineRangeToProseMirrorRange(
  doc: ProseMirrorNode,
  startLine: number,
  endLine: number,
  markdown?: string
): LineRangeMappingResult | null {
  if (typeof markdown === 'string' && markdown.trim()) {
    const tokenInfos = getMarkdownTokens(markdown);
    const alignedBlocks = alignTopLevelBlocks(getTopLevelBlocks(doc), tokenInfos);
    const alignedTokenInfos = new Set(alignedBlocks.map(({ tokenInfo }) => tokenInfo));
    const mappedRange = alignedBlocks.reduce<LineRangeMappingResult | null>(
      (currentRange, { blockInfo, tokenInfo }) =>
        mergeMappedLineRange(currentRange, mapTopLevelBlockSourceLineRangeToOffsets(blockInfo, tokenInfo, startLine, endLine)),
      null
    );

    if (mappedRange) {
      // 目标范围包含未对齐 token 的可见文本时，只能返回部分范围，不能声称精确命中。
      const hasUnalignedText = tokenInfos.some(
        (tokenInfo) => !alignedTokenInfos.has(tokenInfo) && tokenInfo.contentLines.some(({ sourceLine }) => sourceLine >= startLine && sourceLine <= endLine)
      );

      return hasUnalignedText ? { ...mappedRange, exact: false } : mappedRange;
    }

    // 非空 Markdown 存在时失败关闭，禁止再混用可能遗漏空行或围栏的 parser attrs 坐标。
    return null;
  }

  let mappedFrom: number | null = null;
  let mappedTo: number | null = null;
  let isExact = true;
  let blankLineOffset = 0;

  doc.descendants((node, pos) => {
    if (!node.isBlock) {
      return;
    }

    if (isImplicitBlankParagraph(node)) {
      blankLineOffset++;
      return;
    }

    const rawRange = getNodeSourceLineRange(node);
    if (!rawRange) {
      return;
    }

    const adjustedRange: SourceLineRange = {
      startLine: rawRange.startLine + blankLineOffset,
      endLine: rawRange.endLine + blankLineOffset
    };

    const mappedRange = mapBlockSourceLineRangeToOffsets(node, pos, startLine, endLine, adjustedRange);
    if (!mappedRange) {
      return;
    }

    mappedFrom = mappedFrom === null ? mappedRange.from : Math.min(mappedFrom, mappedRange.from);
    mappedTo = mappedTo === null ? mappedRange.to : Math.max(mappedTo, mappedRange.to);
    isExact = isExact && mappedRange.exact;
  });

  if (mappedFrom === null || mappedTo === null) {
    return null;
  }

  return {
    from: mappedFrom,
    to: mappedTo,
    exact: isExact
  };
}
