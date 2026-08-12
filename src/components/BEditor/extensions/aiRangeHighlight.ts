/**
 * @file aiRangeHighlight.ts
 * @description BEditor Rich 模式 AI 选区高亮装饰与 CSS Custom Highlight 同步。
 */
import type { DecorationRange } from './editorDecorations';
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView as PMEditorView } from '@tiptap/pm/view';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

interface AISelectionRange extends DecorationRange {
  highlightKind?: 'inline' | 'node';
}

interface AISelectionHighlightState {
  decorations: DecorationSet;
  range: AISelectionRange | null;
}

interface AISelectionHighlightMeta {
  range?: AISelectionRange | null;
}

const aiSelectionHighlightPluginKey = new PluginKey<AISelectionHighlightState>('b-markdown-ai-selection-highlight');
const baseHighlightClassName = 'ai-selection-highlight';
const codeStartHighlightClassName = 'ai-selection-highlight--code-start';
const codeEndHighlightClassName = 'ai-selection-highlight--code-end';
const aiInlineHighlightName = 'b-markdown-ai-selection-highlight';
const aiInlineHighlightStyleId = 'b-markdown-ai-selection-highlight-style';
const aiInlineHighlightStyleContent = [
  `.b-markdown-rich__content .ProseMirror::highlight(${aiInlineHighlightName}) {`,
  '  background: var(--selection-bg);',
  '}'
].join('\n');

/** CSS Custom Highlight 实例。 */
type CSSHighlightLike = object;

/**
 * CSS Custom Highlight 构造器。
 */
interface CSSHighlightConstructorLike {
  /**
   * 创建 Custom Highlight。
   * @param ranges - 需要高亮的 DOM Range
   * @returns Custom Highlight 实例
   */
  new (...ranges: Range[]): CSSHighlightLike;
}

/**
 * CSS Custom Highlight 注册表。
 */
interface CSSHighlightRegistryLike {
  /**
   * 注册指定名称的 Custom Highlight。
   * @param name - highlight 名称
   * @param highlight - highlight 实例
   */
  set(name: string, highlight: CSSHighlightLike): void;
  /**
   * 删除指定名称的 Custom Highlight。
   * @param name - highlight 名称
   * @returns 是否删除成功
   */
  delete(name: string): boolean;
}

/**
 * 支持 CSS Custom Highlight 的 CSS 对象。
 */
interface CSSWithHighlights {
  /** CSS Custom Highlight 注册表 */
  highlights?: CSSHighlightRegistryLike;
}

/**
 * 支持 CSS Custom Highlight 的全局对象。
 */
interface GlobalWithHighlights {
  /** CSS 对象 */
  CSS?: CSSWithHighlights;
  /** Highlight 构造器 */
  Highlight?: CSSHighlightConstructorLike;
}

/**
 * 当前节点是否为 Rich 表格节点。
 * @param node - ProseMirror 节点
 * @returns 节点是否为 table
 */
function isTableNode(node: PMNode): boolean {
  return node.type.name === 'table';
}

/**
 * 收集当前选区与 Rich 表格相交但未完整覆盖表格的范围。
 * @param doc - 当前 ProseMirror 文档
 * @param range - 当前高亮范围
 * @returns 表格内局部高亮范围
 */
function collectPartialTableRanges(doc: PMNode, range: AISelectionRange): DecorationRange[] {
  if (range.highlightKind === 'node') {
    return [];
  }

  const ranges: DecorationRange[] = [];

  doc.descendants((node, pos) => {
    if (!isTableNode(node)) {
      return true;
    }

    const tableFrom = pos;
    const tableTo = pos + node.nodeSize;
    const from = Math.max(range.from, tableFrom);
    const to = Math.min(range.to, tableTo);
    const isFullyCoveredTable = range.from <= tableFrom && range.to >= tableTo;

    if (from < to && !isFullyCoveredTable) {
      ranges.push({ from, to });
    }

    return false;
  });

  return ranges;
}

/**
 * 合并并排序需要跳过 inline decoration 的范围。
 * @param ranges - 原始范围列表
 * @returns 合并后的范围列表
 */
function mergeDecorationRanges(ranges: DecorationRange[]): DecorationRange[] {
  const sortedRanges = [...ranges].sort((left, right) => left.from - right.from);
  const mergedRanges: DecorationRange[] = [];

  sortedRanges.forEach((range) => {
    const previousRange = mergedRanges.at(-1);
    if (!previousRange || range.from > previousRange.to) {
      mergedRanges.push({ ...range });
      return;
    }

    previousRange.to = Math.max(previousRange.to, range.to);
  });

  return mergedRanges;
}

/**
 * 当前节点是否带有 Rich 行内 code mark。
 * @param node - ProseMirror 节点
 * @returns 节点是否带有 code mark
 */
function hasCodeMark(node: PMNode): boolean {
  return node.marks.some((mark) => mark.type.name === 'code');
}

/**
 * 指定文档字符位置是否位于行内 code mark 文本中。
 * @param doc - 当前 ProseMirror 文档
 * @param position - 需要检查的文档位置
 * @returns 该位置对应字符是否带有 code mark
 */
function hasCodeMarkAt(doc: PMNode, position: number): boolean {
  if (position < 0 || position >= doc.content.size) {
    return false;
  }

  let result = false;
  doc.nodesBetween(position, position + 1, (node, pos) => {
    if (!node.isText || pos > position || pos + node.nodeSize <= position) {
      return true;
    }

    result = hasCodeMark(node);
    return false;
  });

  return result;
}

/**
 * 创建 AI 高亮 className。
 * @param doc - 当前 ProseMirror 文档
 * @param from - 高亮起点
 * @param to - 高亮终点
 * @param isCodeMarked - 当前高亮片段是否位于行内 code mark 内
 * @returns 高亮 className
 */
function createHighlightClassName(doc: PMNode, from: number, to: number, isCodeMarked: boolean): string {
  const classNames = [baseHighlightClassName];

  if (isCodeMarked && !hasCodeMarkAt(doc, from - 1)) {
    classNames.push(codeStartHighlightClassName);
  }

  if (isCodeMarked && !hasCodeMarkAt(doc, to)) {
    classNames.push(codeEndHighlightClassName);
  }

  return classNames.join(' ');
}

/**
 * 创建普通 inline 范围内需要同步高亮的表格容器装饰。
 * @param doc - 当前 ProseMirror 文档
 * @param range - 当前高亮范围
 * @returns table node decorations
 */
function createTableContainerDecorations(doc: PMNode, range: AISelectionRange): Decoration[] {
  const decorations: Decoration[] = [];

  doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!isTableNode(node)) {
      return true;
    }

    const tableTo = pos + node.nodeSize;
    if (pos >= range.from && tableTo <= range.to) {
      decorations.push(Decoration.node(pos, tableTo, { class: 'ai-selection-highlight' }));
    }

    return false;
  });

  return decorations;
}

/**
 * 创建普通 inline 文本高亮，并跳过已经用 node decoration 高亮的表格容器。
 * @param doc - 当前 ProseMirror 文档
 * @param range - 当前高亮范围
 * @param skippedRanges - 不应创建 inline decoration 的范围
 * @returns inline decorations
 */
function createInlineDecorationsOutsideTables(doc: PMNode, range: AISelectionRange, skippedRanges: DecorationRange[]): Decoration[] {
  const decorations: Decoration[] = [];
  let cursor = range.from;

  /**
   * 追加普通 inline 高亮，并在 code mark 边界处加上 padding 补偿所需的修饰类。
   * @param from - 高亮起点
   * @param to - 高亮终点
   */
  function pushInlineDecorations(from: number, to: number): void {
    let segmentCursor = from;

    doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText || !hasCodeMark(node)) {
        return true;
      }

      const codeFrom = Math.max(from, pos);
      const codeTo = Math.min(to, pos + node.nodeSize);
      if (segmentCursor < codeFrom) {
        decorations.push(Decoration.inline(segmentCursor, codeFrom, { class: baseHighlightClassName }));
      }

      decorations.push(Decoration.inline(codeFrom, codeTo, { class: createHighlightClassName(doc, codeFrom, codeTo, true) }));
      segmentCursor = codeTo;
      return false;
    });

    if (segmentCursor < to) {
      decorations.push(Decoration.inline(segmentCursor, to, { class: baseHighlightClassName }));
    }
  }

  mergeDecorationRanges(skippedRanges).forEach((skippedRange) => {
    if (cursor < skippedRange.from) {
      pushInlineDecorations(cursor, skippedRange.from);
    }
    cursor = Math.max(cursor, skippedRange.to);
  });

  if (cursor < range.to) {
    pushInlineDecorations(cursor, range.to);
  }

  return decorations;
}

/**
 * 获取 CSS Custom Highlight runtime。
 * @returns Custom Highlight runtime，不支持时返回 null
 */
function getCSSHighlightRuntime(): { HighlightConstructor: CSSHighlightConstructorLike; registry: CSSHighlightRegistryLike } | null {
  const globalObject = globalThis as typeof globalThis & GlobalWithHighlights;
  const registry = globalObject.CSS?.highlights;
  const HighlightConstructor = globalObject.Highlight;

  if (!registry || !HighlightConstructor) {
    return null;
  }

  return { HighlightConstructor, registry };
}

/**
 * 注入 Rich 内联 CSS Custom Highlight 样式。
 * 该选择器需要保持 `::highlight()` 原始语义，因此放在运行时 style 中避开构建期 CSS minifier 校验。
 * @returns 已注入的 style 元素，非 DOM 环境返回 null
 */
export function ensureAIInlineCSSHighlightStyle(): HTMLStyleElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const existingElement = document.getElementById(aiInlineHighlightStyleId);
  if (existingElement instanceof HTMLStyleElement) {
    if (existingElement.textContent !== aiInlineHighlightStyleContent) {
      existingElement.textContent = aiInlineHighlightStyleContent;
    }

    return existingElement;
  }

  existingElement?.remove();

  const style = document.createElement('style');
  style.id = aiInlineHighlightStyleId;
  style.textContent = aiInlineHighlightStyleContent;
  document.head.appendChild(style);
  return style;
}

/**
 * 清理 Rich 内联 CSS Custom Highlight。
 */
function clearAIInlineCSSHighlight(): void {
  getCSSHighlightRuntime()?.registry.delete(aiInlineHighlightName);
}

/**
 * 将 ProseMirror 位置转换为 DOM Range。
 * @param view - ProseMirror 编辑器视图
 * @param range - ProseMirror 范围
 * @returns DOM Range，转换失败时返回 null
 */
function createDOMRangeFromEditorRange(view: PMEditorView, range: DecorationRange): Range | null {
  const domRange = document.createRange();
  const start = view.domAtPos(range.from);
  const end = view.domAtPos(range.to);

  try {
    domRange.setStart(start.node, start.offset);
    domRange.setEnd(end.node, end.offset);
  } catch {
    return null;
  }

  return domRange.collapsed ? null : domRange;
}

/**
 * 创建用于 CSS Custom Highlight 的内联范围。
 * 完整覆盖的表格由 node decoration 负责，因此从内联高亮范围中跳过。
 * @param doc - 当前 ProseMirror 文档
 * @param range - 当前高亮范围
 * @returns CSS Custom Highlight 范围列表
 */
function createAIInlineCSSHighlightRanges(doc: PMNode, range: AISelectionRange): DecorationRange[] {
  if (range.highlightKind === 'node') {
    return [];
  }

  const skippedRanges = createTableContainerDecorations(doc, range).map((decoration) => ({ from: decoration.from, to: decoration.to }));
  const ranges: DecorationRange[] = [];
  let cursor = range.from;

  mergeDecorationRanges(skippedRanges).forEach((skippedRange) => {
    if (cursor < skippedRange.from) {
      ranges.push({ from: cursor, to: skippedRange.from });
    }
    cursor = Math.max(cursor, skippedRange.to);
  });

  if (cursor < range.to) {
    ranges.push({ from: cursor, to: range.to });
  }

  return ranges;
}

/**
 * 同步 Rich 内联选区到 CSS Custom Highlight，避免插入额外 inline DOM。
 * @param view - ProseMirror 编辑器视图
 */
function syncAIInlineCSSHighlight(view: PMEditorView): void {
  const runtime = getCSSHighlightRuntime();
  if (!runtime) {
    return;
  }

  const pluginState = aiSelectionHighlightPluginKey.getState(view.state);
  if (!pluginState?.range) {
    clearAIInlineCSSHighlight();
    return;
  }

  const domRanges = createAIInlineCSSHighlightRanges(view.state.doc, pluginState.range)
    .map((range) => createDOMRangeFromEditorRange(view, range))
    .filter((range): range is Range => range !== null);

  if (domRanges.length === 0) {
    clearAIInlineCSSHighlight();
    return;
  }

  ensureAIInlineCSSHighlightStyle();
  runtime.registry.set(aiInlineHighlightName, new runtime.HighlightConstructor(...domRanges));
}

/**
 * 创建应跳过 inline decoration 的表格范围。
 * @param tableDecorations - 表格容器 decorations
 * @param tableInlineRanges - 表格内局部高亮范围
 * @returns 需要跳过 inline decoration 的范围
 */
function createSkippedTableRanges(tableDecorations: Decoration[], tableInlineRanges: DecorationRange[]): DecorationRange[] {
  return [...tableDecorations.map((decoration) => ({ from: decoration.from, to: decoration.to })), ...tableInlineRanges];
}

/**
 * 创建 AI 选区高亮装饰。
 * 普通文本使用 inline decoration，table 容器选区使用 node decoration。
 * @param doc - 当前 ProseMirror 文档
 * @param range - 高亮范围
 * @returns ProseMirror decoration set
 */
export function createAISelectionDecorationSet(doc: PMNode, range: AISelectionRange | null): DecorationSet {
  if (!range || range.from === range.to) {
    return DecorationSet.create(doc, []);
  }

  if (range.highlightKind === 'node') {
    return DecorationSet.create(doc, [Decoration.node(range.from, range.to, { class: baseHighlightClassName })]);
  }

  const tableDecorations = createTableContainerDecorations(doc, range);
  const tableInlineRanges = collectPartialTableRanges(doc, range);

  if (getCSSHighlightRuntime()) {
    return DecorationSet.create(doc, tableDecorations);
  }

  const inlineDecorations = createInlineDecorationsOutsideTables(doc, range, createSkippedTableRanges(tableDecorations, tableInlineRanges));

  return DecorationSet.create(doc, [...inlineDecorations, ...tableDecorations]);
}

function createHighlightState(doc: PMNode, range: AISelectionRange | null = null): AISelectionHighlightState {
  return {
    decorations: createAISelectionDecorationSet(doc, range),
    range
  };
}

/**
 * 判断两个高亮范围是否等价。
 * @param left - 左侧高亮范围
 * @param right - 右侧高亮范围
 * @returns 范围完全一致时返回 true
 */
function isSameRange(left: AISelectionRange | null, right: AISelectionRange | null): boolean {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.from === right.from && left.to === right.to && (left.highlightKind ?? 'inline') === (right.highlightKind ?? 'inline');
}

export function setAISelectionHighlight(editor: Editor | null | undefined, range: AISelectionRange): void {
  if (!editor) return;

  const currentRange = aiSelectionHighlightPluginKey.getState(editor.state)?.range ?? null;
  if (isSameRange(currentRange, range)) return;

  editor.view.dispatch(editor.state.tr.setMeta(aiSelectionHighlightPluginKey, { range }));
}

export function clearAISelectionHighlight(editor: Editor | null | undefined): void {
  if (!editor) return;

  const currentRange = aiSelectionHighlightPluginKey.getState(editor.state)?.range ?? null;
  if (!currentRange) return;

  editor.view.dispatch(editor.state.tr.setMeta(aiSelectionHighlightPluginKey, { range: null }));
}

export const AISelectionHighlight = Extension.create({
  name: 'aiSelectionHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<AISelectionHighlightState>({
        key: aiSelectionHighlightPluginKey,
        state: {
          init: (_, state) => createHighlightState(state.doc),
          apply(tr, pluginState, _oldState, newState) {
            const meta = tr.getMeta(aiSelectionHighlightPluginKey) as AISelectionHighlightMeta | undefined;

            if (meta && 'range' in meta) {
              return createHighlightState(newState.doc, meta.range ?? null);
            }

            if (tr.docChanged && pluginState.range) {
              const mappedFrom = tr.mapping.map(pluginState.range.from);
              const mappedTo = tr.mapping.map(pluginState.range.to);

              return createHighlightState(newState.doc, { ...pluginState.range, from: mappedFrom, to: mappedTo });
            }

            return pluginState;
          }
        },
        props: {
          decorations(state) {
            return aiSelectionHighlightPluginKey.getState(state)?.decorations ?? DecorationSet.create(state.doc, []);
          }
        },
        view(view) {
          syncAIInlineCSSHighlight(view);

          return {
            update(nextView: PMEditorView): void {
              syncAIInlineCSSHighlight(nextView);
            },
            destroy(): void {
              clearAIInlineCSSHighlight();
            }
          };
        }
      })
    ];
  }
});
