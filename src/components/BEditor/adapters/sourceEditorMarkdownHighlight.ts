/* eslint-disable no-cond-assign */
/**
 * @file sourceEditorMarkdownHighlight.ts
 * @description Markdown 符号高亮扩展，为 CodeMirror 编辑器提供 Markdown 语法符号的可视化高亮
 */

import type { Extension } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { flatten, sortBy } from 'lodash-es';

/**
 * Markdown 高亮范围
 * @description 表示一个需要高亮的文本区间
 */
export interface MarkdownHighlightRange {
  /** CSS 类名 */
  className: string;
  /** 起始位置 */
  from: number;
  /** 结束位置 */
  to: number;
}

/**
 * 代码块范围（内部使用）
 * @description 表示 fenced code block 的内容区间
 */
interface CodeBlockRange {
  from: number;
  to: number;
}

/**
 * 行内代码范围（内部使用）
 * @description 表示行内代码的内容区间
 */
interface InlineCodeRange {
  from: number;
  to: number;
}

/**
 * 代码围栏状态（内部使用）
 * @description 用于追踪代码块的嵌套状态
 */
interface FenceState {
  /** 围栏字符 (` 或 ~) */
  char: string;
  /** 围栏长度 */
  length: number;
  /** 代码块内容起始位置 */
  pos: number;
}

/**
 * 获取行尾位置
 * @param content - 文档内容
 * @param pos - 起始位置
 * @returns 行尾位置（不包含换行符）
 */
function getLineEnd(content: string, pos: number): number {
  const newlineIndex = content.indexOf('\n', pos);
  return newlineIndex === -1 ? content.length : newlineIndex;
}

/**
 * 获取代码块范围
 * @description 解析 fenced code block，返回代码块内容区间数组
 * @param content - 文档内容
 * @returns 代码块范围数组
 */
function getCodeBlockRanges(content: string): CodeBlockRange[] {
  const ranges: CodeBlockRange[] = [];
  const fenceRegex = /^( {0,3})(`{3,}|~{3,})/gm;
  const fenceStack: FenceState[] = [];

  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(content)) !== null) {
    const fenceChar = match[2][0];
    const fenceLength = match[2].length;
    const fenceStart = match.index;
    const lineEnd = getLineEnd(content, fenceStart);

    if (fenceStack.length === 0) {
      // 开启新的代码块
      fenceStack.push({ char: fenceChar, length: fenceLength, pos: lineEnd + 1 });
    } else {
      const lastFence = fenceStack[fenceStack.length - 1];
      // 检查是否为匹配的闭合围栏
      if (fenceChar === lastFence.char && fenceLength >= lastFence.length) {
        ranges.push({ from: lastFence.pos, to: fenceStart });
        fenceStack.pop();
      } else {
        // 嵌套或不同类型的围栏
        fenceStack.push({ char: fenceChar, length: fenceLength, pos: lineEnd + 1 });
      }
    }
  }

  return ranges;
}

/**
 * 获取行内代码范围
 * @description 解析行内代码，返回内容区间数组，排除代码块内的反引号
 * @param content - 文档内容
 * @param excludeRanges - 需要排除的代码块范围
 * @returns 行内代码范围数组
 */
function getInlineCodeRanges(content: string, excludeRanges: CodeBlockRange[]): InlineCodeRange[] {
  const ranges: InlineCodeRange[] = [];
  const backtickRegex = /`+/g;

  let match: RegExpExecArray | null;
  while ((match = backtickRegex.exec(content)) !== null) {
    const start = match.index;
    const backticks = match[0];
    // 构建匹配结束标记的正则
    const endPattern = new RegExp(`(^|[^\\\`])${backticks.replace(/`/g, '\\`')}([^\\\`]|$)`);
    const afterStart = start + backticks.length;
    const searchStr = content.slice(afterStart);
    const endMatch = searchStr.search(endPattern);

    if (endMatch !== -1) {
      const endPos = afterStart + endMatch + 1;
      const range: InlineCodeRange = { from: start, to: endPos };

      // 排除代码块内的反引号
      const isInExcluded = excludeRanges.some((excluded) => range.from >= excluded.from && range.to <= excluded.to);

      if (!isInExcluded) {
        ranges.push(range);
      }
    }
  }

  return ranges;
}

/**
 * 检查位置是否在指定范围内
 * @param pos - 待检查的位置
 * @param ranges - 范围数组
 * @returns 是否在范围内
 */
function isInRanges(pos: number, ranges: { from: number; to: number }[]): boolean {
  return ranges.some((range) => pos >= range.from && pos < range.to);
}

/**
 * 创建排除检查函数
 * @description 生成一个函数用于检查位置是否在代码块或行内代码内
 * @param excludeRanges - 代码块范围
 * @param inlineCodeRanges - 行内代码范围
 * @returns 排除检查函数
 */
function createExclusionChecker(excludeRanges: CodeBlockRange[], inlineCodeRanges: InlineCodeRange[]): (pos: number) => boolean {
  return (pos: number): boolean => isInRanges(pos, excludeRanges) || isInRanges(pos, inlineCodeRanges);
}

/**
 * 获取标题标记范围
 * @description 匹配 ATX 风格标题的 # 标记
 * @param content - 文档内容
 * @param excludeRanges - 需要排除的代码块范围
 * @returns 高亮范围数组
 */
function getHeadingRanges(content: string, excludeRanges: CodeBlockRange[]): MarkdownHighlightRange[] {
  const ranges: MarkdownHighlightRange[] = [];
  const regex = /^( {0,3})(#{1,6})([ \t]|$)/gm;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (isInRanges(match.index, excludeRanges)) continue;

    const indent = match[1].length;
    const hashStart = match.index + indent;
    const hashEnd = hashStart + match[2].length;

    ranges.push({ className: 'md-heading-marker', from: hashStart, to: hashEnd });
  }

  return ranges;
}

/**
 * 获取引用标记范围
 * @description 匹配块引用的 > 标记，支持嵌套引用
 * @param content - 文档内容
 * @param excludeRanges - 需要排除的代码块范围
 * @returns 高亮范围数组
 */
function getBlockquoteRanges(content: string, excludeRanges: CodeBlockRange[]): MarkdownHighlightRange[] {
  const lines = content.split('\n');
  let pos = 0;
  const ranges: MarkdownHighlightRange[] = [];

  for (const line of lines) {
    if (!isInRanges(pos, excludeRanges)) {
      const match = line.match(/^( {0,3})(> {0,1})+/);
      if (match) {
        const markerText = match[0];
        const indentLen = match[1].length;
        // 遍历标记文本，找出所有 > 字符的位置
        for (let markerPos = indentLen; markerPos < markerText.length; markerPos++) {
          if (markerText[markerPos] === '>') {
            ranges.push({ className: 'md-blockquote-marker', from: pos + markerPos, to: pos + markerPos + 1 });
          }
        }
      }
    }
    pos += line.length + 1; // +1 for newline
  }

  return ranges;
}

/**
 * 获取列表标记范围
 * @description 匹配无序列表、有序列表和任务列表的标记
 * @param content - 文档内容
 * @param excludeRanges - 需要排除的代码块范围
 * @returns 高亮范围数组
 */
function getListMarkerRanges(content: string, excludeRanges: CodeBlockRange[]): MarkdownHighlightRange[] {
  const lines = content.split('\n');
  let pos = 0;
  const ranges: MarkdownHighlightRange[] = [];

  // 正则定义
  const unorderedRegex = /^([ \t]*)([-*+])([ \t]+)/;
  const orderedRegex = /^([ \t]*)(\d{1,9})([.)])([ \t]+)/;
  const taskRegex = /^([ \t]*)([-*+])([ \t]+)(\[)([ xX])(\])([ \t]+)/;

  for (const line of lines) {
    if (!isInRanges(pos, excludeRanges)) {
      // 优先匹配任务列表
      const taskMatch = line.match(taskRegex);
      if (taskMatch) {
        const indentLen = taskMatch[1].length;
        const markerStart = pos + indentLen;
        ranges.push({ className: 'md-list-marker', from: markerStart, to: markerStart + 1 });

        // 任务列表括号和状态
        const bracketStart = pos + taskMatch[1].length + taskMatch[2].length + taskMatch[3].length;
        ranges.push({ className: 'md-task-bracket', from: bracketStart, to: bracketStart + 1 });
        ranges.push({
          className: taskMatch[5].toLowerCase() === 'x' ? 'md-task-checked' : 'md-task-unchecked',
          from: bracketStart + 1,
          to: bracketStart + 2
        });
        ranges.push({ className: 'md-task-bracket', from: bracketStart + 2, to: bracketStart + 3 });
      } else {
        // 匹配无序列表
        const unorderedMatch = line.match(unorderedRegex);
        if (unorderedMatch) {
          const indentLen = unorderedMatch[1].length;
          const markerStart = pos + indentLen;
          ranges.push({ className: 'md-list-marker', from: markerStart, to: markerStart + 1 });
        } else {
          // 匹配有序列表
          const orderedMatch = line.match(orderedRegex);
          if (orderedMatch) {
            const indentLen = orderedMatch[1].length;
            const numStart = pos + indentLen;
            const numEnd = numStart + orderedMatch[2].length;
            ranges.push({ className: 'md-list-number', from: numStart, to: numEnd });
            ranges.push({ className: 'md-list-marker', from: numEnd, to: numEnd + 1 });
          }
        }
      }
    }
    pos += line.length + 1;
  }

  return ranges;
}

/**
 * 获取分隔线范围
 * @description 匹配由 -、*、_ 组成的水平分隔线
 * @param content - 文档内容
 * @param excludeRanges - 需要排除的代码块范围
 * @returns 高亮范围数组
 */
function getHrRanges(content: string, excludeRanges: CodeBlockRange[]): MarkdownHighlightRange[] {
  const ranges: MarkdownHighlightRange[] = [];
  const regex = /^( {0,3})([-*_])([ \t]*\2[ \t]*\2[ \t]*\2+)[ \t]*$/gm;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    if (isInRanges(match.index, excludeRanges)) continue;
    ranges.push({ className: 'md-hr', from: match.index, to: match.index + match[0].length });
  }

  return ranges;
}

/**
 * 处理强调匹配结果
 * @description 为匹配到的强调符号添加高亮范围
 * @param match - 正则匹配结果
 * @param className - CSS 类名
 * @param ranges - 高亮范围数组（会被修改）
 * @param isExcluded - 排除检查函数
 */
function processEmphasisMatch(match: RegExpExecArray, className: string, ranges: MarkdownHighlightRange[], isExcluded: (pos: number) => boolean): void {
  const fullMatch = match[0];
  const markerLen = (fullMatch.match(/^[*_~]+/) || [''])[0].length;
  const start = match.index;
  const end = start + fullMatch.length;

  if (isExcluded(start)) return;

  // 添加开始和结束标记的高亮
  ranges.push({ className, from: start, to: start + markerLen });
  ranges.push({ className, from: end - markerLen, to: end });
}

/**
 * 获取强调符号范围
 * @description 匹配粗体、斜体、删除线标记
 * @param content - 文档内容
 * @param excludeRanges - 需要排除的代码块范围
 * @param inlineCodeRanges - 需要排除的行内代码范围
 * @returns 高亮范围数组
 */
function getEmphasisRanges(content: string, excludeRanges: CodeBlockRange[], inlineCodeRanges: InlineCodeRange[]): MarkdownHighlightRange[] {
  const ranges: MarkdownHighlightRange[] = [];
  const isExcluded = createExclusionChecker(excludeRanges, inlineCodeRanges);

  // 定义强调符号的正则表达式
  const emphasisPatterns: { regex: RegExp; className: string }[] = [
    { regex: /(?<!\*)\*{2}([^\s*]|\*[^\s*]|[^\s*]\*|[^\s*][^]*?[^\s*])\*{2}(?!\*)/g, className: 'md-bold' },
    { regex: /(?<!_)_{2}([^\s_]|_[^\s_]|[^\s_]_|[^\s_][^]*?[^\s_])_{2}(?!_)/g, className: 'md-bold' },
    { regex: /(?<!\*)\*([^\s*][^]*?[^\s*]|[^\s*])\*(?!\*)/g, className: 'md-italic' },
    { regex: /(?<!_)_([^\s_][^]*?[^\s_]|[^\s_])_(?!_)/g, className: 'md-italic' },
    { regex: /~~([^\s~][^]*?[^\s~]|[^\s~])~~/g, className: 'md-strikethrough' }
  ];

  for (const { regex, className } of emphasisPatterns) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
      processEmphasisMatch(match, className, ranges, isExcluded);
    }
  }

  return ranges;
}

/**
 * 获取行内代码标记范围
 * @description 为行内代码的反引号添加高亮
 * @param content - 文档内容
 * @param inlineCodeRanges - 行内代码范围
 * @returns 高亮范围数组
 */
function getInlineCodeMarkerRanges(content: string, inlineCodeRanges: InlineCodeRange[]): MarkdownHighlightRange[] {
  const ranges: MarkdownHighlightRange[] = [];

  for (const range of inlineCodeRanges) {
    const codeContent = content.slice(range.from, range.to);
    const backtickMatch = codeContent.match(/^(`+)/);

    if (backtickMatch) {
      const openLen = backtickMatch[1].length;
      // 开始标记
      ranges.push({ className: 'md-code-marker', from: range.from, to: range.from + openLen });

      // 结束标记
      const closeMatch = codeContent.slice(openLen).match(/(`+)$/);
      if (closeMatch) {
        const closeLen = closeMatch[1].length;
        ranges.push({ className: 'md-code-marker', from: range.to - closeLen, to: range.to });
      }
    }
  }

  return ranges;
}

/**
 * 获取链接和图片语法范围
 * @description 匹配行内链接、引用链接和图片语法
 * @param content - 文档内容
 * @param excludeRanges - 需要排除的代码块范围
 * @param inlineCodeRanges - 需要排除的行内代码范围
 * @returns 高亮范围数组
 */
function getLinkImageRanges(content: string, excludeRanges: CodeBlockRange[], inlineCodeRanges: InlineCodeRange[]): MarkdownHighlightRange[] {
  const ranges: MarkdownHighlightRange[] = [];
  const isExcluded = createExclusionChecker(excludeRanges, inlineCodeRanges);

  // 图片语法: ![alt](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  // 行内链接: [text](url)
  const linkRegex = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;
  // 引用链接: [text][ref]
  const refLinkRegex = /(?<!!)\[([^\]]+)\]\[([^\]]*)\]/g;

  let match: RegExpExecArray | null;

  // 处理图片语法
  while ((match = imageRegex.exec(content)) !== null) {
    if (isExcluded(match.index)) continue;

    const start = match.index;
    ranges.push({ className: 'md-image-marker', from: start, to: start + 1 });
    ranges.push({ className: 'md-link-bracket', from: start + 1, to: start + 2 });

    const textEnd = start + 2 + match[1].length;
    ranges.push({ className: 'md-link-bracket', from: textEnd, to: textEnd + 1 });
    ranges.push({ className: 'md-link-paren', from: textEnd + 1, to: textEnd + 2 });

    const urlEnd = textEnd + 2 + match[2].length;
    ranges.push({ className: 'md-link-paren', from: urlEnd, to: urlEnd + 1 });
  }

  // 处理行内链接
  while ((match = linkRegex.exec(content)) !== null) {
    if (isExcluded(match.index)) continue;

    const start = match.index;
    ranges.push({ className: 'md-link-bracket', from: start, to: start + 1 });

    const textEnd = start + 1 + match[1].length;
    ranges.push({ className: 'md-link-bracket', from: textEnd, to: textEnd + 1 });
    ranges.push({ className: 'md-link-paren', from: textEnd + 1, to: textEnd + 2 });

    const urlEnd = textEnd + 2 + match[2].length;
    ranges.push({ className: 'md-link-paren', from: urlEnd, to: urlEnd + 1 });
  }

  // 处理引用链接
  while ((match = refLinkRegex.exec(content)) !== null) {
    if (isExcluded(match.index)) continue;

    const start = match.index;
    ranges.push({ className: 'md-link-bracket', from: start, to: start + 1 });

    const textEnd = start + 1 + match[1].length;
    ranges.push({ className: 'md-link-bracket', from: textEnd, to: textEnd + 1 });
    ranges.push({ className: 'md-link-bracket', from: textEnd + 1, to: textEnd + 2 });

    const refEnd = textEnd + 2 + match[2].length;
    ranges.push({ className: 'md-link-bracket', from: refEnd, to: refEnd + 1 });
  }

  return ranges;
}

/**
 * 获取表格语法范围
 * @description 匹配表格中的 | 和对齐标记 :
 * @param content - 文档内容
 * @param excludeRanges - 需要排除的代码块范围
 * @param inlineCodeRanges - 需要排除的行内代码范围
 * @returns 高亮范围数组
 */
function getTableRanges(content: string, excludeRanges: CodeBlockRange[], inlineCodeRanges: InlineCodeRange[]): MarkdownHighlightRange[] {
  const lines = content.split('\n');
  let pos = 0;
  const ranges: MarkdownHighlightRange[] = [];
  const isExcluded = createExclusionChecker(excludeRanges, inlineCodeRanges);

  for (const line of lines) {
    if (line.includes('|') && !isExcluded(pos)) {
      for (let i = 0; i < line.length; i++) {
        // 匹配管道符
        if (line[i] === '|') {
          ranges.push({ className: 'md-table-pipe', from: pos + i, to: pos + i + 1 });
        }
        // 匹配左对齐标记 |:
        if (line[i] === ':' && i > 0 && line[i - 1] === '|') {
          ranges.push({ className: 'md-table-align', from: pos + i, to: pos + i + 1 });
        }
        // 匹配右对齐标记 :|
        if (line[i] === ':' && i < line.length - 1 && line[i + 1] === '|') {
          ranges.push({ className: 'md-table-align', from: pos + i, to: pos + i + 1 });
        }
      }
    }
    pos += line.length + 1;
  }

  return ranges;
}

/**
 * 获取转义字符范围
 * @description 匹配 Markdown 转义字符 \
 * @param content - 文档内容
 * @param excludeRanges - 需要排除的代码块范围
 * @param inlineCodeRanges - 需要排除的行内代码范围
 * @returns 高亮范围数组
 */
function getEscapeRanges(content: string, excludeRanges: CodeBlockRange[], inlineCodeRanges: InlineCodeRange[]): MarkdownHighlightRange[] {
  const ranges: MarkdownHighlightRange[] = [];
  const escapeRegex = /\\[\\`*_{}[\]()#+\-.!]/g;
  const isExcluded = createExclusionChecker(excludeRanges, inlineCodeRanges);

  let match: RegExpExecArray | null;
  while ((match = escapeRegex.exec(content)) !== null) {
    if (isExcluded(match.index)) continue;
    ranges.push({ className: 'md-escape', from: match.index, to: match.index + 2 });
  }

  return ranges;
}

/**
 * 获取代码围栏标记范围
 * @description 匹配代码块的围栏标记和语言标识
 * @param content - 文档内容
 * @param excludeRanges - 需要排除的代码块范围
 * @returns 高亮范围数组
 */
function getCodeFenceMarkerRanges(content: string, excludeRanges: CodeBlockRange[]): MarkdownHighlightRange[] {
  const ranges: MarkdownHighlightRange[] = [];
  const fenceRegex = /^( {0,3})(`{3,}|~{3,})([^`\n]*)$/gm;

  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(content)) !== null) {
    if (isInRanges(match.index, excludeRanges)) continue;

    const indent = match[1].length;
    const fenceStart = match.index + indent;
    const fenceEnd = fenceStart + match[2].length;

    // 围栏标记
    ranges.push({ className: 'md-code-fence', from: fenceStart, to: fenceEnd });

    // 语言标识
    const info = match[3];
    if (info && info.trim()) {
      const infoStart = fenceEnd;
      const infoEnd = infoStart + info.length;
      ranges.push({ className: 'md-code-info', from: infoStart, to: infoEnd });
    }
  }

  return ranges;
}

/**
 * 获取所有 Markdown 高亮范围
 * @description 解析文档内容，返回所有需要高亮的符号范围
 * @param content - 文档内容
 * @returns 排序后的高亮范围数组
 */
export function getMarkdownHighlightRanges(content: string): MarkdownHighlightRange[] {
  // 1. 首先获取代码块范围，用于排除其他解析
  const codeBlockRanges = getCodeBlockRanges(content);

  // 2. 获取行内代码范围
  const inlineCodeRanges = getInlineCodeRanges(content, codeBlockRanges);

  // 3. 收集所有高亮范围
  const allRanges = flatten([
    getCodeFenceMarkerRanges(content, codeBlockRanges),
    getHeadingRanges(content, codeBlockRanges),
    getBlockquoteRanges(content, codeBlockRanges),
    getListMarkerRanges(content, codeBlockRanges),
    getHrRanges(content, codeBlockRanges),
    getEmphasisRanges(content, codeBlockRanges, inlineCodeRanges),
    getInlineCodeMarkerRanges(content, inlineCodeRanges),
    getLinkImageRanges(content, codeBlockRanges, inlineCodeRanges),
    getTableRanges(content, codeBlockRanges, inlineCodeRanges),
    getEscapeRanges(content, codeBlockRanges, inlineCodeRanges)
  ]);

  // 4. 按起始位置排序
  return sortBy(allRanges, ['from']);
}

/**
 * 创建高亮装饰
 * @param className - CSS 类名
 * @returns CodeMirror 装饰对象
 */
function createHighlightDecoration(className: string): ReturnType<typeof Decoration.mark> {
  return Decoration.mark({ class: className });
}

/**
 * 创建 Markdown 高亮装饰集合
 * @description 将高亮范围转换为 CodeMirror 装饰集合
 * @param content - 文档内容
 * @returns 装饰集合
 */
function createMarkdownHighlightDecorations(content: string): DecorationSet {
  const builder = new RangeSetBuilder<ReturnType<typeof Decoration.mark>>();
  const ranges = getMarkdownHighlightRanges(content);

  for (const range of ranges) {
    if (range.from >= range.to) continue;
    builder.add(range.from, range.to, createHighlightDecoration(range.className));
  }

  return builder.finish();
}

/**
 * 创建 Markdown 符号高亮扩展
 * @description 为 CodeMirror 编辑器提供 Markdown 语法符号高亮功能
 * @returns CodeMirror 扩展
 */
export function createSourceEditorMarkdownHighlightExtension(): Extension {
  return ViewPlugin.fromClass(
    class MarkdownHighlightPlugin {
      /** 装饰集合 */
      decorations: DecorationSet;

      /**
       * 构造函数
       * @param view - EditorView 实例
       */
      constructor(view: EditorView) {
        this.decorations = createMarkdownHighlightDecorations(view.state.doc.toString());
      }

      /**
       * 更新处理
       * @param update - ViewUpdate 对象
       */
      update(update: ViewUpdate): void {
        if (update.docChanged) {
          this.decorations = createMarkdownHighlightDecorations(update.state.doc.toString());
        }
      }
    },
    {
      decorations: (plugin) => plugin.decorations
    }
  );
}
