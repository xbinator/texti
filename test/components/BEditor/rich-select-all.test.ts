/**
 * @file rich-select-all.test.ts
 * @description BEditor Rich 模式逐级全选快捷键测试。
 * @vitest-environment jsdom
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Selection } from '@tiptap/pm/state';
import { Schema } from '@tiptap/pm/model';
import { AllSelection, EditorState, TextSelection } from '@tiptap/pm/state';
import { CellSelection, selectedRect, tableNodes } from '@tiptap/pm/tables';
import { describe, expect, it, vi } from 'vitest';
import { createRichSelectAllTransaction, handleRichSelectAllKeyboardEvent } from '@/components/BEditor/extensions/richSelectAll';

/**
 * 文本节点在文档中的范围。
 */
interface TextRange {
  /** 文本起始位置。 */
  from: number;
  /** 文本结束位置。 */
  to: number;
}

/**
 * 用于模拟截图中单个 Markdown 物理行视觉折行的长列表项。
 */
const WRAPPED_LIST_ITEM_TEXT = [
  'packages/frontend/src/views/linkers/components/nodes 这个节点是否可以迁移到 packages/linker/src 这里，而且开始节点，',
  '飞书节点，结束节点，可以文件夹形式存在，节点文件夹要 4 个文件，',
  'node.vue panel.vue interface.ts default.ts'
].join('');

/**
 * 创建包含两个段落的测试文档。
 * @returns ProseMirror 文档节点
 */
function createParagraphDoc(): PMNode {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: {
        attrs: {
          sourceLineStart: { default: null },
          sourceLineEnd: { default: null }
        },
        content: 'text*',
        group: 'block',
        parseDOM: [{ tag: 'p' }],
        toDOM: () => ['p', 0]
      },
      text: { group: 'inline' }
    },
    marks: {}
  });

  return schema.node('doc', null, [
    schema.node('paragraph', { sourceLineStart: 1, sourceLineEnd: 1 }, schema.text('第一段')),
    schema.node('paragraph', { sourceLineStart: 2, sourceLineEnd: 2 }, schema.text('第二段'))
  ]);
}

/**
 * 创建包含源码行号属性的有序列表文档。
 * @returns ProseMirror 文档节点
 */
function createOrderedListDoc(): PMNode {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      orderedList: {
        attrs: { order: { default: 1 } },
        content: 'listItem+',
        group: 'block',
        parseDOM: [{ tag: 'ol' }],
        toDOM: () => ['ol', 0]
      },
      listItem: {
        content: 'paragraph block*',
        parseDOM: [{ tag: 'li' }],
        toDOM: () => ['li', 0]
      },
      paragraph: {
        attrs: {
          sourceLineStart: { default: null },
          sourceLineEnd: { default: null }
        },
        content: 'text*',
        group: 'block',
        parseDOM: [{ tag: 'p' }],
        toDOM: () => ['p', 0]
      },
      text: { group: 'inline' }
    },
    marks: {}
  });

  const createListItem = (text: string, line: number): PMNode =>
    schema.node('listItem', null, [schema.node('paragraph', { sourceLineStart: line, sourceLineEnd: line }, schema.text(text))]);

  const list = schema.node('orderedList', { order: 1 }, [
    createListItem('packages/backend/src/common 这个移除，新增 src/guards 文件夹存放守卫相关文件', 1),
    createListItem('飞书相关的迁移到 packages/backend/src/externals/feishu 这里', 2),
    createListItem('packages/backend/src/configs/linker-runtime.config.ts 这个也是飞书相关的迁移到 /externals/feishu 这里', 3),
    createListItem('packages/backend/src/modules/linker-executions 和 packages/backend/src/modules/linker-runtime 迁移到 /externals 里面新增 linker 文件夹', 4),
    createListItem('packages/linker-sandbox 这个沙箱是否可以迁移到 packages/backend/src/externals/sandbox，做一个通用沙箱。而不是单独的个性化的', 5),
    createListItem('packages/frontend/src/views/linkers/components/nodes 我希望做一个通用的公共模块，而不是每个节点都是写重复的代码', 6),
    createListItem(WRAPPED_LIST_ITEM_TEXT, 7)
  ]);

  return schema.node('doc', null, [list]);
}

/**
 * 创建包含 2x2 表格的测试文档。
 * @returns ProseMirror 文档节点
 */
function createTableDoc(): PMNode {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      text: { group: 'inline' },
      paragraph: {
        content: 'text*',
        group: 'block',
        parseDOM: [{ tag: 'p' }],
        toDOM: () => ['p', 0]
      },
      ...tableNodes({ tableGroup: 'block', cellContent: 'paragraph+', cellAttributes: {} })
    },
    marks: {}
  });

  const createParagraph = (text: string): PMNode => schema.node('paragraph', null, schema.text(text));
  const createCell = (text: string): PMNode => schema.nodes.table_cell.create(null, createParagraph(text));
  const firstRow = schema.nodes.table_row.create(null, [createCell('A1'), createCell('A2')]);
  const secondRow = schema.nodes.table_row.create(null, [createCell('B1'), createCell('B2')]);
  const table = schema.nodes.table.create(null, [firstRow, secondRow]);

  return schema.node('doc', null, [table]);
}

/**
 * 查找指定文本在文档中的位置。
 * @param doc - ProseMirror 文档节点
 * @param text - 需要查找的文本
 * @returns 文本范围
 */
function findTextRange(doc: PMNode, text: string): TextRange {
  let range: TextRange | null = null;

  doc.descendants((node: PMNode, pos: number): boolean => {
    if (node.isText && node.text === text) {
      range = { from: pos, to: pos + node.nodeSize };
      return false;
    }

    return true;
  });

  if (!range) {
    throw new Error(`未找到文本：${text}`);
  }

  return range;
}

/**
 * 对当前状态执行一次 Rich 全选扩大动作。
 * @param state - 当前编辑器状态
 * @returns 应用选择事务后的新状态
 */
function applySelectAll(state: EditorState): EditorState {
  const transaction = createRichSelectAllTransaction(state);
  if (!transaction) {
    throw new Error('未创建全选事务');
  }

  return state.apply(transaction);
}

/**
 * 断言当前选区是指定文本范围。
 * @param selection - 当前选区
 * @param range - 期望文本范围
 */
function expectTextSelection(selection: Selection, range: TextRange): void {
  expect(selection).toBeInstanceOf(TextSelection);
  expect(selection.from).toBe(range.from);
  expect(selection.to).toBe(range.to);
}

/**
 * 创建最小 Rich 编辑器键盘事件测试替身。
 * @param state - 当前编辑器状态
 * @returns 可记录 dispatch 的编辑器替身
 */
function createEditorHarness(state: EditorState): {
  /** Rich 编辑器替身。 */
  editor: Parameters<typeof handleRichSelectAllKeyboardEvent>[0];
  /** dispatch 调用列表。 */
  dispatchedTransactions: ReturnType<typeof vi.fn>;
} {
  const dispatchedTransactions = vi.fn();
  const editor = {
    state,
    view: {
      dispatch: dispatchedTransactions
    }
  } as Parameters<typeof handleRichSelectAllKeyboardEvent>[0];

  return { editor, dispatchedTransactions };
}

describe('createRichSelectAllTransaction', (): void => {
  it('bubbles from current block to full document outside tables', (): void => {
    const doc = createParagraphDoc();
    const firstParagraph = findTextRange(doc, '第一段');
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, firstParagraph.from + 1)
    });

    state = applySelectAll(state);
    expectTextSelection(state.selection, firstParagraph);

    state = applySelectAll(state);
    expect(state.selection).toBeInstanceOf(AllSelection);
    expect(state.selection.from).toBe(0);
    expect(state.selection.to).toBe(doc.content.size);
  });

  it('promotes multi-line text selections directly to the full document outside tables', (): void => {
    const doc = createParagraphDoc();
    const firstParagraph = findTextRange(doc, '第一段');
    const secondParagraph = findTextRange(doc, '第二段');
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, firstParagraph.from, secondParagraph.to)
    });

    const nextState = applySelectAll(state);

    expect(nextState.selection).toBeInstanceOf(AllSelection);
    expect(nextState.selection.from).toBe(0);
    expect(nextState.selection.to).toBe(doc.content.size);
  });

  it('promotes source-lined selections ending at the next block start directly to the full document', (): void => {
    const doc = createParagraphDoc();
    const firstParagraph = findTextRange(doc, '第一段');
    const secondParagraph = findTextRange(doc, '第二段');
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, firstParagraph.from, secondParagraph.from)
    });

    const nextState = applySelectAll(state);

    expect(nextState.selection).toBeInstanceOf(AllSelection);
    expect(nextState.selection.from).toBe(0);
    expect(nextState.selection.to).toBe(doc.content.size);
  });

  it('keeps wrapped single source-line selections expandable from current item to full document', (): void => {
    const doc = createOrderedListDoc();
    const currentLine = findTextRange(doc, WRAPPED_LIST_ITEM_TEXT);
    const partialRange = {
      from: currentLine.to - 'interface.ts default.ts'.length,
      to: currentLine.to
    };
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, partialRange.from, partialRange.to)
    });

    state = applySelectAll(state);
    expectTextSelection(state.selection, currentLine);

    state = applySelectAll(state);
    expect(state.selection).toBeInstanceOf(AllSelection);
    expect(state.selection.from).toBe(0);
    expect(state.selection.to).toBe(doc.content.size);
  });

  it('bubbles from current block to current cell to whole table to full document inside tables', (): void => {
    const doc = createTableDoc();
    const firstCellText = findTextRange(doc, 'A1');
    let state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, firstCellText.from + 1)
    });

    state = applySelectAll(state);
    expectTextSelection(state.selection, firstCellText);

    state = applySelectAll(state);
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect(selectedRect(state)).toMatchObject({ left: 0, right: 1, top: 0, bottom: 1 });

    state = applySelectAll(state);
    expect(state.selection).toBeInstanceOf(CellSelection);
    expect(selectedRect(state)).toMatchObject({ left: 0, right: 2, top: 0, bottom: 2 });

    state = applySelectAll(state);
    expect(state.selection).toBeInstanceOf(AllSelection);
    expect(state.selection.from).toBe(0);
    expect(state.selection.to).toBe(doc.content.size);
  });
});

describe('handleRichSelectAllKeyboardEvent', (): void => {
  it('prevents native select-all and dispatches the next rich selection transaction', (): void => {
    const doc = createParagraphDoc();
    const firstParagraph = findTextRange(doc, '第一段');
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, firstParagraph.from + 1)
    });
    const { editor, dispatchedTransactions } = createEditorHarness(state);
    const event = new KeyboardEvent('keydown', { key: 'a', metaKey: true, bubbles: true, cancelable: true });

    const handled = handleRichSelectAllKeyboardEvent(editor, event);

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(dispatchedTransactions).toHaveBeenCalledTimes(1);
    expect(state.apply(dispatchedTransactions.mock.calls[0][0]).selection).toMatchObject({
      from: firstParagraph.from,
      to: firstParagraph.to
    });
  });
});
