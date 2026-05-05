/**
 * @file sourceEditorDrawSelection.ts
 * @description Source 模式自定义 selection 绘制扩展。
 * 用 ViewPlugin + Decoration.mark() 替代 CodeMirror 原生 selection 的视觉渲染，
 * 与 AI 选区高亮统一到同一装饰层体系，并提供 suppression 机制用于 AI 面板打开时临时隐藏普通选区。
 */
import type { Extension } from '@codemirror/state';
import { StateEffect } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/**
 * 自定义 selection decoration 的 CSS class。
 */
const SELECTION_CLASS = 'cm-custom-selection';

/**
 * 控制"普通 selection 绘制是否被抑制"的 StateEffect。
 * true → 隐藏普通 selection 装饰；false → 恢复绘制。
 */
const setSelectionDrawSuppressedEffect = StateEffect.define<boolean>();

/**
 * 根据当前 view 的 selection 状态计算 decoration set。
 * 遍历所有 selection ranges，为非空 range 生成 mark decoration。
 * @param view - CodeMirror EditorView 实例
 * @returns 包含所有非空选区 decoration 的 DecorationSet
 */
function computeSelectionDecorations(view: EditorView): DecorationSet {
  const decorations = [...view.state.selection.ranges]
    .filter((range) => !range.empty)
    .sort((left, right) => left.from - right.from)
    .map((range) => Decoration.mark({ class: SELECTION_CLASS }).range(range.from, range.to));

  if (decorations.length === 0) {
    return Decoration.none;
  }
  return Decoration.set(decorations);
}

/**
 * 抑制普通 selection 的自定义绘制（视觉层隐藏，保留真实选区和复制能力）。
 * @param view - CodeMirror EditorView 实例
 */
export function suppressSourceEditorSelectionDraw(view: EditorView): void {
  view.dispatch({
    effects: setSelectionDrawSuppressedEffect.of(true)
  });
}

/**
 * 恢复普通 selection 的自定义绘制。
 * @param view - CodeMirror EditorView 实例
 */
export function restoreSourceEditorSelectionDraw(view: EditorView): void {
  view.dispatch({
    effects: setSelectionDrawSuppressedEffect.of(false)
  });
}

/**
 * 自定义 selection 绘制 ViewPlugin。
 * 监听 selection 变化与 suppression effect，动态计算 decoration set。
 */
const customSelectionPlugin = ViewPlugin.fromClass(
  class {
    /** 当前 decoration set */
    decorations: DecorationSet;

    /** 是否处于抑制状态（隐藏普通 selection 装饰） */
    suppressed: boolean;

    constructor(view: EditorView) {
      this.suppressed = false;
      this.decorations = computeSelectionDecorations(view);
    }

    update(update: ViewUpdate): void {
      let suppressionChanged = false;

      for (const transaction of update.transactions) {
        for (const effect of transaction.effects) {
          if (effect.is(setSelectionDrawSuppressedEffect)) {
            // 仅在值实际变化时标记变更，避免重复 suppress 触发无意义重算
            if (this.suppressed !== effect.value) {
              this.suppressed = effect.value;
              suppressionChanged = true;
            }
          }
        }
      }

      if (suppressionChanged || update.selectionSet || update.docChanged) {
        this.decorations = this.suppressed ? Decoration.none : computeSelectionDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations
  }
);

/**
 * 自定义 selection 主题。
 * 隐藏 CodeMirror 原生 selection 视觉，让 decoration 成为唯一可见的 selection 表示。
 */
const customSelectionTheme = EditorView.theme({
  // 隐藏 CodeMirror 原生 selection 背景
  '& .cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'transparent !important',
    color: 'inherit !important'
  },
  // 隐藏 ::selection 伪元素（Firefox 需使用 backgroundColor 长写）
  '& .cm-content ::selection, & .cm-line::selection, & .cm-line *::selection': {
    backgroundColor: 'transparent !important',
    color: 'inherit !important'
  },
  // 自定义 selection decoration 样式，与 AI 高亮保持一致的 box-shadow 方案
  '& .cm-custom-selection': {
    background: 'var(--selection-bg)',
    boxShadow: '0 0.2em 0 0 var(--selection-bg), 0 -0.2em 0 0 var(--selection-bg)',
    WebkitBoxDecorationBreak: 'clone',
    boxDecorationBreak: 'clone'
  }
});

/**
 * 创建 Source 模式自定义 selection 绘制扩展。
 * 包含 ViewPlugin、suppression effect 处理和主题覆盖。
 * @returns CodeMirror Extension 数组
 */
export function createSourceEditorDrawSelectionExtension(): Extension[] {
  return [customSelectionPlugin, customSelectionTheme];
}
