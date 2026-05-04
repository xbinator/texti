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
 * 顶层块节点在文档中的位置信息。
 */
interface TopLevelBlockInfo {
  /** 顶层块节点 */
  node: ProseMirrorNode;
  /** 顶层块节点在文档中的起始位置 */
  pos: number;
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
 * 统计 token 原始文本实际覆盖的源码行数，不包含仅用于分隔块的尾随空行。
 * @param raw - token 原始 Markdown 文本
 * @returns token 覆盖的源码行数
 */
function getCoveredLineCount(raw: string): number {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/\n+$/g, '');
  if (!normalized) {
    return 1;
  }

  return normalized.split('\n').length;
}

/**
 * 统计 token 在源码中实际消耗的物理行数，包含尾随换行带来的跨行移动。
 * @param raw - token 原始 Markdown 文本
 * @returns 下一个 block token 应从多少行后开始
 */
function getConsumedLineCount(raw: string): number {
  const normalized = raw.replace(/\r\n/g, '\n');
  if (!normalized) {
    return 0;
  }

  const newlineMatches = normalized.match(/\n/g);
  const newlineCount = newlineMatches ? newlineMatches.length : 0;

  return normalized.endsWith('\n') ? Math.max(1, newlineCount) : newlineCount + 1;
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
 * 构建顶层 Markdown token 的源码行号范围列表，包含对独立空行的行号推进。
 * @param markdown - 原始 Markdown 文本
 * @returns 顶层非 space token 的源码行号范围列表
 */
function getTopLevelMarkdownTokenLineRanges(markdown: string): SourceLineRange[] {
  const tokens = marked.lexer(markdown);
  const tracker = createSourceLineTracker();
  const ranges: SourceLineRange[] = [];

  tokens.forEach((token) => {
    if (token.type === 'space') {
      consumeSourceLineToken(tracker, token.raw || '');
      return;
    }

    const raw = typeof token.raw === 'string' ? token.raw : '';
    if (!raw) {
      return;
    }

    ranges.push(captureSourceLineRange(tracker, raw));
  });

  return ranges;
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

  const topLevelBlocks = getTopLevelBlocks(doc);
  const tokenRanges = getTopLevelMarkdownTokenLineRanges(markdown);
  const alignedCount = Math.min(topLevelBlocks.length, tokenRanges.length);

  let startLine = Number.POSITIVE_INFINITY;
  let endLine = 0;

  topLevelBlocks.slice(0, alignedCount).forEach(({ node, pos }, index) => {
    const range = tokenRanges[index];
    if (!range) {
      return;
    }

    const preciseRange = getPreciseSelectionLineRangeFromBaseRange(node, pos, from, to, range);
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
