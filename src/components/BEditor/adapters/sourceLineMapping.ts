/**
 * @file sourceLineMapping.ts
 * @description Markdown 源码行号映射工具，负责在解析阶段记录块节点的真实行号，并在选区侧聚合行号范围。
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { marked } from 'marked';

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
 * 顶层 Markdown token 的源码行号与匹配信息。
 */
interface TopLevelMarkdownTokenInfo extends SourceLineRange {
  /** token 类型 */
  type: string;
  /** token 原始 Markdown 文本 */
  raw: string;
  /** token 纯文本内容 */
  text: string;
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
 * 解析期的源码行号游标。
 */
export interface SourceLineTracker {
  /** 当前待分配的起始行号（1-based） */
  currentLine: number;
}

/**
 * 创建新的源码行号游标。
 * @returns 初始位于第 1 行的游标
 */
export function createSourceLineTracker(): SourceLineTracker {
  return { currentLine: 1 };
}

/**
 * 将游标重置到 Markdown 源文件首行。
 * @param tracker - 当前源码行号游标
 */
export function resetSourceLineTracker(tracker: SourceLineTracker): void {
  tracker.currentLine = 1;
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

  let count = 1;
  for (let i = 0; i < end; i++) {
    if (raw[i] === '\n') {
      count++;
      if (i > 0 && raw[i - 1] === '\r') {
        count--;
      }
    }
  }
  return count;
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
function getSpaceLineAdvance(raw: string): number {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized) {
    return 0;
  }

  const newlineMatches = normalized.match(/\n/g);
  const newlineCount = newlineMatches ? newlineMatches.length : 0;

  if (newlineCount <= 0) {
    return 0;
  }

  return Math.max(1, newlineCount - 1);
}

/**
 * 消费不产出节点的 Markdown token 所占用的源码行数，例如独立空行 token。
 * @param tracker - 当前源码行号游标
 * @param raw - token 原始 Markdown 文本
 */
export function consumeSourceLineToken(tracker: SourceLineTracker, raw: string): void {
  tracker.currentLine += getSpaceLineAdvance(raw);
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
 * 读取 Markdown token 的纯文本内容。
 * @param token - marked 顶层 token
 * @returns token 纯文本内容
 */
function getTokenText(token: ReturnType<typeof marked.lexer>[number]): string {
  return 'text' in token && typeof token.text === 'string' ? token.text : '';
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

    tokenInfos.push({
      ...captureSourceLineRange(tracker, raw),
      type: token.type,
      raw,
      text: getTokenText(token)
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
 * 归一化用于匹配 Markdown token 与 rich 块节点的文本。
 * @param text - 原始文本
 * @returns 可比较的文本
 */
function normalizeComparableText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
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
 * 判断 Markdown token 是否与 ProseMirror 顶层块表示同一个结构。
 * @param tokenInfo - Markdown token 信息
 * @param node - ProseMirror 顶层块节点
 * @returns 是否匹配
 */
function matchTokenBlock(tokenInfo: TopLevelMarkdownTokenInfo, node: ProseMirrorNode): boolean {
  if (tokenInfo.type === 'heading') {
    return node.type.name === 'heading' && normalizeComparableText(tokenInfo.text) === normalizeComparableText(node.textContent);
  }

  if (tokenInfo.type === 'code') {
    return node.type.name === 'codeBlock' && tokenInfo.text.trim() === node.textContent.trim();
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
    return node.type.name === 'paragraph' && normalizeComparableText(tokenInfo.text) === normalizeComparableText(node.textContent);
  }

  if (tokenInfo.type === 'html' || tokenInfo.type === 'def') {
    return (
      node.type.name === 'paragraph' &&
      (normalizeComparableText(tokenInfo.text) === normalizeComparableText(node.textContent) ||
        normalizeComparableText(tokenInfo.raw) === normalizeComparableText(node.textContent))
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
    const { node, pos } = blockInfo;
    const preciseRange = getPreciseSelectionLineRangeFromBaseRange(node, pos, from, to, tokenInfo);
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
    let mappedRange: LineRangeMappingResult | null = null;
    let hasOverlappingMarkdownToken = false;
    const alignedBlocks = alignTopLevelBlocks(getTopLevelBlocks(doc), getMarkdownTokens(markdown));

    alignedBlocks.forEach(({ blockInfo, tokenInfo }) => {
      if (isLineRangeOverlapping(tokenInfo, startLine, endLine)) {
        hasOverlappingMarkdownToken = true;
      }

      mappedRange = mergeMappedLineRange(mappedRange, mapTopLevelBlockSourceLineRangeToOffsets(blockInfo, tokenInfo, startLine, endLine));
    });

    if (mappedRange) {
      return mappedRange;
    }

    if (hasOverlappingMarkdownToken) {
      return null;
    }
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
