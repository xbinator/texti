/**
 * @file rich-selection-assistant.test.ts
 * @description BEditor Rich 模式选区工具适配器回归测试。
 * @vitest-environment jsdom
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Editor as TiptapEditor } from '@tiptap/vue-3';
import { Schema } from '@tiptap/pm/model';
import { AllSelection, EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { CellSelection, tableNodes } from '@tiptap/pm/tables';
import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  createRichSelectionAssistantAdapter,
  getRichSelectionCapabilities,
  resolveRichSelectionRange
} from '@/components/BEditor/adapters/richSelectionAssistant';
import type { SelectionAssistantRange } from '@/components/BEditor/adapters/selectionAssistant';
import type { EditorState as BEditorState } from '@/components/BEditor/types';

/**
 * TipTap 链式命令的最小测试替身。
 */
interface RichEditorChainStub {
  /** 聚焦编辑器并继续链式调用。 */
  focus: Mock<() => RichEditorChainStub>;
  /** 在指定范围插入内容并继续链式调用。 */
  insertContentAt: Mock<(range: { from: number; to: number }, content: string, options?: { contentType?: string }) => RichEditorChainStub>;
  /** 执行链式命令。 */
  run: Mock<() => boolean>;
}

/**
 * 创建包含两个段落的 ProseMirror 测试文档。
 * @returns ProseMirror 文档节点
 */
function createTestDoc(): PMNode {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: {
        content: 'text*',
        group: 'block',
        parseDOM: [{ tag: 'p' }],
        toDOM: () => ['p', 0]
      },
      text: { group: 'inline' }
    },
    marks: {}
  });

  return schema.node('doc', null, [schema.node('paragraph', null, schema.text('第一段')), schema.node('paragraph', null, schema.text('第二段'))]);
}

/**
 * 创建带有解析器回退行号的 ProseMirror 测试文档。
 * @returns 段落属性行号固定为 59 的文档节点
 */
function createSourceLineDoc(): PMNode {
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: {
        content: 'text*',
        group: 'block',
        attrs: {
          sourceLineStart: { default: null },
          sourceLineEnd: { default: null }
        },
        parseDOM: [{ tag: 'p' }],
        toDOM: () => ['p', 0]
      },
      text: { group: 'inline' }
    },
    marks: {}
  });
  const paragraph = schema.node('paragraph', { sourceLineStart: 59, sourceLineEnd: 59 }, schema.text('目标文本'));

  return schema.node('doc', null, [paragraph]);
}

/**
 * 创建包含 2x2 表格的 ProseMirror 测试文档。
 * @returns ProseMirror 表格文档节点
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
 * 构造 Rich 选区适配器测试上下文。
 * @returns TipTap 命令替身与 Rich 选区适配器。
 */
function createAdapterHarness(): {
  chain: RichEditorChainStub;
  adapter: ReturnType<typeof createRichSelectionAssistantAdapter>;
} {
  const chain: RichEditorChainStub = {
    focus: vi.fn<() => RichEditorChainStub>(),
    insertContentAt: vi.fn<(range: { from: number; to: number }, content: string, options?: { contentType?: string }) => RichEditorChainStub>(),
    run: vi.fn<() => boolean>()
  };

  chain.focus.mockReturnValue(chain);
  chain.insertContentAt.mockReturnValue(chain);
  chain.run.mockReturnValue(true);

  const editor = {
    chain: vi.fn<() => RichEditorChainStub>().mockReturnValue(chain)
  } as unknown as TiptapEditor;

  const editorState: BEditorState = {
    content: 'old',
    name: 'note.md',
    path: '/tmp/note.md',
    id: 'rich-selection-test',
    ext: 'md'
  };
  const adapter = createRichSelectionAssistantAdapter(editor, {
    editorState,
    overlayRoot: document.createElement('div')
  });

  adapter.restoreSelection = vi.fn<(range: SelectionAssistantRange) => void>();

  return { chain, adapter };
}

/**
 * 创建仅用于构造文件引用的 Rich 选区适配器。
 * @param doc - ProseMirror 测试文档
 * @param content - 适配器可见的 Markdown 原文
 * @returns Rich 选区适配器
 */
function createReferenceAdapter(doc: PMNode, content: string): ReturnType<typeof createRichSelectionAssistantAdapter> {
  const editor = {
    state: EditorState.create({ doc })
  } as unknown as TiptapEditor;
  const editorState: BEditorState = {
    content,
    name: 'note.md',
    path: '/tmp/note.md',
    id: 'rich-reference-test',
    ext: 'md'
  };

  return createRichSelectionAssistantAdapter(editor, {
    editorState,
    overlayRoot: document.createElement('div')
  });
}

describe('resolveRichSelectionRange', (): void => {
  it('keeps Ctrl+A AllSelection as a selectable range so AI highlight can cover the full document', (): void => {
    const doc = createTestDoc();
    const state = EditorState.create({ doc, selection: new AllSelection(doc) });
    const range = resolveRichSelectionRange(state.selection, doc);

    expect(range).toEqual({
      from: 0,
      to: doc.content.size,
      text: '第一段第二段',
      docVersion: doc.nodeSize
    });
  });

  it('keeps normal text selections available for the rich selection toolbar', (): void => {
    const doc = createTestDoc();
    const selection = TextSelection.create(doc, 1, 4);
    const range = resolveRichSelectionRange(selection, doc);

    expect(range).toEqual({
      from: 1,
      to: 4,
      text: '第一段',
      docVersion: doc.nodeSize
    });
  });

  it('still ignores non-text node selections', (): void => {
    const doc = createTestDoc();
    const selection = NodeSelection.create(doc, 0);
    const range = resolveRichSelectionRange(selection, doc);

    expect(range).toBeNull();
  });

  it('resolves table cell selections to the whole table container range', (): void => {
    const doc = createTableDoc();
    const selection = CellSelection.create(doc, 2, 22);
    const range = resolveRichSelectionRange(selection, doc);

    expect(range).toEqual({
      from: 0,
      to: doc.content.size,
      text: 'A1A2B1B2',
      docVersion: doc.nodeSize,
      highlightKind: 'node'
    });
  });

  it('does not treat a single dragged table cell as the whole table container selection', (): void => {
    const doc = createTableDoc();
    const selection = CellSelection.create(doc, 2);
    const range = resolveRichSelectionRange(selection, doc);

    expect(range).toBeNull();
  });
});

describe('getRichSelectionCapabilities', (): void => {
  it('keeps text format actions available for normal text selections', (): void => {
    const capabilities = getRichSelectionCapabilities({ from: 1, to: 4, text: '第一段', docVersion: 10 });

    expect(capabilities.actions.bold).toBe(true);
    expect(capabilities.actions.italic).toBe(true);
    expect(capabilities.actions.underline).toBe(true);
    expect(capabilities.actions.strike).toBe(true);
    expect(capabilities.actions.code).toBe(true);
    expect(capabilities.actions.link).toBe(true);
  });

  it('disables text format actions for table container selections', (): void => {
    const capabilities = getRichSelectionCapabilities({ from: 0, to: 10, text: 'A1A2', docVersion: 12, highlightKind: 'node' });

    expect(capabilities.actions.ai).toBe(true);
    expect(capabilities.actions.reference).toBe(true);
    expect(capabilities.actions.comment).toBe(true);
    expect(capabilities.actions.bold).toBe(false);
    expect(capabilities.actions.italic).toBe(false);
    expect(capabilities.actions.underline).toBe(false);
    expect(capabilities.actions.strike).toBe(false);
    expect(capabilities.actions.code).toBe(false);
    expect(capabilities.actions.link).toBe(false);
  });
});

describe('createRichSelectionAssistantAdapter', (): void => {
  it('applies AI generated content as Markdown in rich mode', async (): Promise<void> => {
    const { adapter, chain } = createAdapterHarness();
    const range: SelectionAssistantRange = {
      from: 1,
      to: 4,
      text: 'old',
      docVersion: 5
    };

    await adapter.applyGeneratedContent(range, '### Title\n\n**bold**');

    expect(chain.insertContentAt).toHaveBeenCalledWith({ from: 1, to: 4 }, '### Title\n\n**bold**', { contentType: 'markdown' });
  });

  it('does not use parser attribute lines when non-empty source Markdown cannot be aligned', (): void => {
    const adapter = createReferenceAdapter(createSourceLineDoc(), '# 不同内容');
    const payload = adapter.buildSelectionReference({ from: 1, to: 5, text: '目标文本', docVersion: 8 });

    expect(payload).toMatchObject({ startLine: 0, endLine: 0 });
  });

  it('uses parser attribute lines when source Markdown is unavailable', (): void => {
    const adapter = createReferenceAdapter(createSourceLineDoc(), '');
    const payload = adapter.buildSelectionReference({ from: 1, to: 5, text: '目标文本', docVersion: 8 });

    expect(payload).toMatchObject({ startLine: 59, endLine: 59 });
  });
});
