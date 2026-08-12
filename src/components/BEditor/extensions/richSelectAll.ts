/**
 * @file richSelectAll.ts
 * @description Rich 编辑器逐级全选快捷键逻辑。
 */

import type { SourceLineRange } from '../adapters/sourceLineMapping';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import type { EditorState, Selection, Transaction } from '@tiptap/pm/state';
import { AllSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, findTable, TableMap } from '@tiptap/pm/tables';
import { getSelectionSourceLineRange } from '../adapters/sourceLineMapping';

/**
 * 执行 Rich 全选快捷键所需的最小编辑器能力。
 */
export interface RichSelectAllKeyboardEditor {
  /** 当前编辑器状态。 */
  state: EditorState;
  /** ProseMirror 编辑器视图。 */
  view: {
    /** 派发选择事务。 */
    dispatch: (transaction: Transaction) => void;
  };
}

/**
 * 可选中文档范围。
 */
interface SelectableRange {
  /** 选区起始位置。 */
  from: number;
  /** 选区结束位置。 */
  to: number;
}

/**
 * 当前表格上下文。
 */
interface TableSelectionContext {
  /** 表格节点查询结果。 */
  table: NonNullable<ReturnType<typeof findTable>>;
  /** 表格映射。 */
  map: TableMap;
}

/**
 * 判断当前选区是否已经覆盖指定范围。
 * @param selection - 当前 ProseMirror 选区
 * @param range - 目标范围
 * @returns 选区范围完全一致时返回 true
 */
function isSameRange(selection: Selection, range: SelectableRange): boolean {
  return selection.from === range.from && selection.to === range.to;
}

/**
 * 判断当前文本选区是否跨越了多行内容。
 * @param state - 当前编辑器状态
 * @param selection - 当前 ProseMirror 选区
 * @returns 选区文本包含块分隔或换行节点时返回 true
 */
function hasTextLineBreak(state: EditorState, selection: Selection): boolean {
  if (selection.empty || !(selection instanceof TextSelection)) {
    return false;
  }

  const selectedText = state.doc.textBetween(selection.from, selection.to, '\n', '\n');
  return selectedText.includes('\n');
}

/**
 * 获取当前文本选区覆盖的 Markdown 源码行号范围。
 * @param state - 当前编辑器状态
 * @param selection - 当前 ProseMirror 选区
 * @returns 源码行号范围；无法解析或非文本选区时返回 null
 */
function getSelectedLineRange(state: EditorState, selection: Selection): SourceLineRange | null {
  if (selection.empty || !(selection instanceof TextSelection)) {
    return null;
  }

  return getSelectionSourceLineRange(state.doc, selection.from, selection.to);
}

/**
 * 查找光标所在的最近文本块内容范围。
 * @param $pos - 当前解析位置
 * @returns 文本块内容范围；不存在时返回 null
 */
function findCurrentTextBlockRange($pos: ResolvedPos): SelectableRange | null {
  for (let { depth } = $pos; depth > 0; depth--) {
    const node = $pos.node(depth);

    if (node.isTextblock) {
      return {
        from: $pos.start(depth),
        to: $pos.end(depth)
      };
    }
  }

  return null;
}

/**
 * 读取当前选区所在的表格上下文。
 * @param selection - 当前 ProseMirror 选区
 * @returns 表格上下文；不在表格中时返回 null
 */
function getTableSelectionContext(selection: Selection): TableSelectionContext | null {
  const table = findTable(selection instanceof CellSelection ? selection.$anchorCell : selection.$from);
  if (!table) {
    return null;
  }

  return {
    table,
    map: TableMap.get(table.node)
  };
}

/**
 * 判断单元格选区是否覆盖整张表。
 * @param selection - 当前单元格选区
 * @param table - 当前表格上下文
 * @returns 选区覆盖整张表时返回 true
 */
function isWholeTableSelection(selection: CellSelection, table: TableSelectionContext): boolean {
  const rect = table.map.rectBetween(selection.$anchorCell.pos - table.table.start, selection.$headCell.pos - table.table.start);

  return rect.left === 0 && rect.top === 0 && rect.right === table.map.width && rect.bottom === table.map.height;
}

/**
 * 计算当前光标所在单元格的位置。
 * @param $pos - 当前解析位置
 * @returns 单元格起始位置；不在单元格中时返回 null
 */
function getCurrentCellPosition($pos: ResolvedPos): number | null {
  for (let { depth } = $pos; depth > 0; depth--) {
    const { tableRole } = $pos.node(depth).type.spec;

    if (tableRole === 'cell' || tableRole === 'header_cell') {
      return $pos.before(depth);
    }
  }

  return null;
}

/**
 * 创建选中当前文本块内容的事务。
 * @param state - 当前编辑器状态
 * @param range - 目标文本块范围
 * @returns 设置文本选区后的事务
 */
function createTextBlockSelectionTransaction(state: EditorState, range: SelectableRange): Transaction {
  return state.tr.setSelection(TextSelection.create(state.doc, range.from, range.to));
}

/**
 * 创建选中当前单元格的事务。
 * @param state - 当前编辑器状态
 * @returns 设置单元格选区后的事务；无法定位时返回 null
 */
function createCurrentCellSelectionTransaction(state: EditorState): Transaction | null {
  const cellPosition = getCurrentCellPosition(state.selection.$from);
  if (cellPosition === null) {
    return null;
  }

  return state.tr.setSelection(CellSelection.create(state.doc, cellPosition));
}

/**
 * 创建选中整张表的事务。
 * @param doc - 当前文档
 * @param table - 当前表格上下文
 * @param transaction - 当前事务
 * @returns 设置整表单元格选区后的事务
 */
function createWholeTableSelectionTransaction(doc: PMNode, table: TableSelectionContext, transaction: Transaction): Transaction {
  const firstCellPosition = table.table.start + table.map.map[0];
  const lastCellPosition = table.table.start + table.map.map[table.map.map.length - 1];

  return transaction.setSelection(CellSelection.create(doc, firstCellPosition, lastCellPosition));
}

/**
 * 创建选中全文的事务。
 * @param state - 当前编辑器状态
 * @returns 设置全文选区后的事务
 */
function createWholeDocumentSelectionTransaction(state: EditorState): Transaction {
  return state.tr.setSelection(new AllSelection(state.doc));
}

/**
 * 根据当前选区创建下一层全选事务。
 * 普通文本按「当前块 → 全文」扩大；表格内按「当前块 → 当前单元格 → 整表 → 全文」扩大。
 * @param state - 当前编辑器状态
 * @returns 下一层全选事务；已是全文选区时返回 null
 */
export function createRichSelectAllTransaction(state: EditorState): Transaction | null {
  const { selection } = state;
  if (selection instanceof AllSelection) {
    return null;
  }

  const sourceLineRange = getSelectedLineRange(state, selection);
  const isMultiLineSelection = (sourceLineRange ? sourceLineRange.endLine > sourceLineRange.startLine : false) || hasTextLineBreak(state, selection);
  if (isMultiLineSelection) {
    return createWholeDocumentSelectionTransaction(state);
  }

  const table = getTableSelectionContext(selection);
  if (table && selection instanceof CellSelection) {
    return isWholeTableSelection(selection, table)
      ? createWholeDocumentSelectionTransaction(state)
      : createWholeTableSelectionTransaction(state.doc, table, state.tr);
  }

  const textBlockRange = findCurrentTextBlockRange(selection.$from);
  if (!textBlockRange) {
    return createWholeDocumentSelectionTransaction(state);
  }

  if (table) {
    return isSameRange(selection, textBlockRange) ? createCurrentCellSelectionTransaction(state) : createTextBlockSelectionTransaction(state, textBlockRange);
  }

  if (sourceLineRange && sourceLineRange.startLine === sourceLineRange.endLine && !isSameRange(selection, textBlockRange)) {
    return createTextBlockSelectionTransaction(state, textBlockRange);
  }

  return isSameRange(selection, textBlockRange) ? createWholeDocumentSelectionTransaction(state) : createTextBlockSelectionTransaction(state, textBlockRange);
}

/**
 * 处理 Rich 编辑器全选快捷键事件。
 * @param editor - Rich 编辑器实例
 * @param event - 键盘事件
 * @returns 已处理事件时返回 true
 */
export function handleRichSelectAllKeyboardEvent(editor: RichSelectAllKeyboardEditor, event: KeyboardEvent): boolean {
  const key = event.key.toLowerCase();
  const isSelectAll = (event.ctrlKey || event.metaKey) && key === 'a' && !event.shiftKey && !event.altKey;
  if (!isSelectAll) {
    return false;
  }

  const transaction = createRichSelectAllTransaction(editor.state);
  if (!transaction) {
    return false;
  }

  event.preventDefault();
  editor.view.dispatch(transaction.scrollIntoView());
  return true;
}
