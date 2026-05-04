/**
 * @file sourceLineMapping.ts
 * @description Markdown 源码行号映射工具，负责在解析阶段记录块节点的真实行号，并在选区侧聚合行号范围。
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

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

  doc.nodesBetween(from, to, (node) => {
    if (!node.isBlock) {
      return;
    }

    const range = getNodeSourceLineRange(node);
    if (!range) {
      return;
    }

    startLine = Math.min(startLine, range.startLine);
    endLine = Math.max(endLine, range.endLine);
  });

  if (!Number.isFinite(startLine) || endLine <= 0) {
    return null;
  }

  return { startLine, endLine };
}
