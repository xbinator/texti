/**
 * @file sourceSelectAll.ts
 * @description Source 编辑器逐级全选快捷键逻辑。
 */

import type { SelectionRange } from '@codemirror/state';
import type { EditorView, KeyBinding } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';

/**
 * 可选中文本范围。
 */
interface SelectableRange {
  /** 选区起始位置。 */
  from: number;
  /** 选区结束位置。 */
  to: number;
}

/**
 * 判断当前选区是否已经覆盖指定范围。
 * @param selection - 当前 CodeMirror 选区
 * @param range - 目标范围
 * @returns 选区范围完全一致时返回 true
 */
function isSameRange(selection: SelectionRange, range: SelectableRange): boolean {
  return selection.from === range.from && selection.to === range.to;
}

/**
 * 判断当前选区是否跨越多个源码物理行。
 * @param view - 当前 CodeMirror 视图
 * @param selection - 当前 CodeMirror 选区
 * @returns 选区跨物理行时返回 true
 */
function isCrossLineSelection(view: EditorView, selection: SelectionRange): boolean {
  if (selection.empty) {
    return false;
  }

  const startLine = view.state.doc.lineAt(selection.from);
  const endLine = view.state.doc.lineAt(selection.to);
  return startLine.number !== endLine.number;
}

/**
 * 获取当前选区起点所在物理行的内容范围。
 * @param view - 当前 CodeMirror 视图
 * @param selection - 当前 CodeMirror 选区
 * @returns 当前物理行范围
 */
function getCurrentLineRange(view: EditorView, selection: SelectionRange): SelectableRange {
  const line = view.state.doc.lineAt(selection.from);

  return {
    from: line.from,
    to: line.to
  };
}

/**
 * 设置 Source 编辑器选区。
 * @param view - 当前 CodeMirror 视图
 * @param range - 目标选区范围
 */
function setSourceSelection(view: EditorView, range: SelectableRange): void {
  view.dispatch({
    selection: EditorSelection.range(range.from, range.to),
    scrollIntoView: true
  });
}

/**
 * 处理 Source 编辑器全选命令。
 * 普通源码按「当前物理行 → 全文」扩大；已有跨物理行选区时直接全文。
 * @param view - 当前 CodeMirror 视图
 * @returns 已处理命令时返回 true
 */
export function handleSourceSelectAllCommand(view: EditorView): boolean {
  if (view.state.doc.length === 0) {
    return false;
  }

  const selection = view.state.selection.main;
  const documentRange = { from: 0, to: view.state.doc.length };
  if (isSameRange(selection, documentRange)) {
    return false;
  }

  if (isCrossLineSelection(view, selection)) {
    setSourceSelection(view, documentRange);
    return true;
  }

  const currentLineRange = getCurrentLineRange(view, selection);
  setSourceSelection(view, isSameRange(selection, currentLineRange) ? documentRange : currentLineRange);
  return true;
}

/**
 * 创建 Source 编辑器逐级全选快捷键绑定。
 * @returns CodeMirror key binding 列表
 */
export function createSourceSelectAllKeymap(): readonly KeyBinding[] {
  return [
    {
      key: 'Mod-a',
      run: handleSourceSelectAllCommand
    }
  ];
}
