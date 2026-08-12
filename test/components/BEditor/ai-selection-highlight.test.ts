/**
 * @file ai-selection-highlight.test.ts
 * @description BEditor Rich 模式 AI 选区高亮装饰回归测试。
 * @vitest-environment jsdom
 */
import type { Node as PMNode } from '@tiptap/pm/model';
import { Editor } from '@tiptap/core';
import { Schema } from '@tiptap/pm/model';
import { EditorState, Plugin } from '@tiptap/pm/state';
import { tableNodes } from '@tiptap/pm/tables';
import { EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  AISelectionHighlight,
  createAISelectionDecorationSet,
  ensureAIInlineCSSHighlightStyle,
  setAISelectionHighlight
} from '@/components/BEditor/extensions/aiRangeHighlight';

const tableInlineHighlightStyleId = 'b-markdown-ai-selection-highlight-style';

/**
 * ProseMirror Decoration 运行时持有的装饰类型信息。
 */
interface RuntimeDecorationInfo {
  /** 装饰类型，包含运行时类型名与属性。 */
  type: {
    /** 运行时构造函数。 */
    constructor: { name: string };
    /** Decoration attrs。 */
    attrs: Record<string, string>;
  };
}

/**
 * 测试用 CSS Custom Highlight 注册表。
 */
interface TestHighlightRegistry {
  /** 注册 highlight */
  set: ReturnType<typeof vi.fn<(name: string, highlight: object) => void>>;
  /** 删除 highlight */
  delete: ReturnType<typeof vi.fn<(name: string) => boolean>>;
}

/**
 * 安装测试用 CSS Custom Highlight runtime。
 * @returns 测试注册表
 */
function installCSSHighlightRuntime(): TestHighlightRegistry {
  const registry: TestHighlightRegistry = {
    set: vi.fn<(name: string, highlight: object) => void>(),
    delete: vi.fn<(name: string) => boolean>(() => true)
  };

  class TestHighlight {
    /** 注册的 DOM Range 列表 */
    ranges: Range[];

    /**
     * 创建测试 Highlight。
     * @param ranges - DOM Range 列表
     */
    constructor(...ranges: Range[]) {
      this.ranges = ranges;
    }
  }

  Object.defineProperty(globalThis, 'CSS', {
    configurable: true,
    value: {
      highlights: registry
    }
  });
  Object.defineProperty(globalThis, 'Highlight', {
    configurable: true,
    value: TestHighlight
  });

  return registry;
}

/**
 * 读取 Decoration 的运行时类型信息。
 * @param decoration - ProseMirror decoration
 * @returns Decoration 运行时类型信息
 */
function getRuntimeDecorationInfo(decoration: unknown): RuntimeDecorationInfo {
  return decoration as RuntimeDecorationInfo;
}

/**
 * 查找指定文本在 ProseMirror 文档中的起始位置。
 * @param doc - ProseMirror 文档节点
 * @param text - 需要查找的文本
 * @returns 文本起始位置，未命中时返回 -1
 */
function findTextStartPosition(doc: PMNode, text: string): number {
  let result = -1;

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) {
      return true;
    }

    const textIndex = node.text.indexOf(text);
    if (textIndex < 0) {
      return true;
    }

    result = pos + textIndex;
    return false;
  });

  return result;
}

/**
 * 创建用于高亮装饰测试的简单 ProseMirror 文档。
 * @returns ProseMirror 文档节点
 */
function createDoc(): PMNode {
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

  return schema.node('doc', null, [schema.node('paragraph', null, schema.text('hello'))]);
}

/**
 * 创建包含行内 code mark 的 ProseMirror 文档。
 * @param text - code mark 包裹的文本内容
 * @returns ProseMirror 文档节点
 */
function createInlineCodeDoc(text: string): PMNode {
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
    marks: {
      code: {
        parseDOM: [{ tag: 'code' }],
        toDOM: () => ['code', 0]
      }
    }
  });

  return schema.node('doc', null, [schema.node('paragraph', null, schema.text(text, [schema.marks.code.create()]))]);
}

/**
 * 创建包含表格的 ProseMirror 文档。
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
  const row = schema.nodes.table_row.create(null, [createCell('A1'), createCell('A2')]);
  const table = schema.nodes.table.create(null, [row]);

  return schema.node('doc', null, [table]);
}

describe('createAISelectionDecorationSet', (): void => {
  let editorView: EditorView | null = null;
  const originalCSSDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'CSS');
  const originalHighlightDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Highlight');

  afterEach((): void => {
    editorView?.destroy();
    editorView = null;
    document.getElementById(tableInlineHighlightStyleId)?.remove();

    if (originalCSSDescriptor) {
      Object.defineProperty(globalThis, 'CSS', originalCSSDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'CSS');
    }

    if (originalHighlightDescriptor) {
      Object.defineProperty(globalThis, 'Highlight', originalHighlightDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'Highlight');
    }
  });

  it('uses inline decorations for normal rich text selections', (): void => {
    const doc = createDoc();
    const decorations = createAISelectionDecorationSet(doc, { from: 1, to: 4 });
    const [decoration] = decorations.find();
    const decorationInfo = getRuntimeDecorationInfo(decoration);

    expect(decorationInfo.type.constructor.name).toBe('InlineType');
    expect(decorationInfo.type.attrs).toEqual({ class: 'ai-selection-highlight' });
  });

  it('keeps normal rich text selections out of inline decoration spans when CSS Custom Highlight is available', (): void => {
    installCSSHighlightRuntime();
    const doc = createDoc();
    const decorations = createAISelectionDecorationSet(doc, { from: 1, to: 4 });

    expect(decorations.find()).toHaveLength(0);
  });

  it('registers normal rich text ranges with CSS Custom Highlight runtime', (): void => {
    const registry = installCSSHighlightRuntime();
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: [StarterKit, AISelectionHighlight],
      content: '<p>hello</p>'
    });

    setAISelectionHighlight(editor, { from: 1, to: 4 });

    expect(registry.set).toHaveBeenCalledWith(
      'b-markdown-ai-selection-highlight',
      expect.objectContaining({
        ranges: [expect.any(Range)]
      })
    );
    editor.destroy();
    element.remove();
  });

  it('marks inline code selection when it starts at the code mark boundary', (): void => {
    const doc = createInlineCodeDoc('packages/core');
    const decorations = createAISelectionDecorationSet(doc, { from: 1, to: 9 });
    const [decoration] = decorations.find();
    const decorationInfo = getRuntimeDecorationInfo(decoration);

    expect(decorationInfo.type.attrs.class).toContain('ai-selection-highlight');
    expect(decorationInfo.type.attrs.class).toContain('ai-selection-highlight--code-start');
    expect(decorationInfo.type.attrs.class).not.toContain('ai-selection-highlight--code-end');
  });

  it('does not mark inline code start padding when selection begins inside the code mark', (): void => {
    const doc = createInlineCodeDoc('packages/core');
    const decorations = createAISelectionDecorationSet(doc, { from: 2, to: 9 });
    const [decoration] = decorations.find();
    const decorationInfo = getRuntimeDecorationInfo(decoration);

    expect(decorationInfo.type.attrs.class).toBe('ai-selection-highlight');
  });

  it('marks inline code selection when it ends at the code mark boundary', (): void => {
    const doc = createInlineCodeDoc('packages/core');
    const decorations = createAISelectionDecorationSet(doc, { from: 9, to: 14 });
    const [decoration] = decorations.find();
    const decorationInfo = getRuntimeDecorationInfo(decoration);

    expect(decorationInfo.type.attrs.class).toContain('ai-selection-highlight');
    expect(decorationInfo.type.attrs.class).not.toContain('ai-selection-highlight--code-start');
    expect(decorationInfo.type.attrs.class).toContain('ai-selection-highlight--code-end');
  });

  it('uses node decorations when table selections need container highlighting', (): void => {
    const doc = createDoc();
    const decorations = createAISelectionDecorationSet(doc, { from: 0, to: doc.content.size, highlightKind: 'node' });
    const [decoration] = decorations.find();
    const decorationInfo = getRuntimeDecorationInfo(decoration);

    expect(decorationInfo.type.constructor.name).toBe('NodeType');
    expect(decorationInfo.type.attrs).toEqual({ class: 'ai-selection-highlight' });
  });

  it('adds table container decorations when Ctrl+A full-document selection includes a table', (): void => {
    const doc = createTableDoc();
    const decorations = createAISelectionDecorationSet(doc, { from: 0, to: doc.content.size });
    const decorationTypes = decorations.find().map((decoration) => getRuntimeDecorationInfo(decoration).type.constructor.name);

    expect(decorationTypes).toContain('NodeType');
  });

  it('does not add inline text decorations inside a table that is already highlighted as a container', (): void => {
    const doc = createTableDoc();
    const decorations = createAISelectionDecorationSet(doc, { from: 0, to: doc.content.size });
    const decorationTypes = decorations.find().map((decoration) => getRuntimeDecorationInfo(decoration).type.constructor.name);

    expect(decorationTypes).toEqual(['NodeType']);
  });

  it('does not create inline decoration spans for partial table text highlights', (): void => {
    const doc = createTableDoc();
    const textStart = findTextStartPosition(doc, 'A1');
    const decorations = createAISelectionDecorationSet(doc, { from: textStart, to: textStart + 1 });
    const decorationTypes = decorations.find().map((decoration) => getRuntimeDecorationInfo(decoration).type.constructor.name);

    expect(textStart).toBeGreaterThanOrEqual(0);
    expect(decorationTypes).toEqual([]);
  });

  it('keeps partial table text highlight out of the rendered DOM flow', (): void => {
    const doc = createTableDoc();
    const textStart = findTextStartPosition(doc, 'A1');
    const decorations = createAISelectionDecorationSet(doc, { from: textStart, to: textStart + 1 });
    const root = document.createElement('div');

    editorView = new EditorView(root, {
      state: EditorState.create({
        doc,
        plugins: [
          new Plugin({
            props: {
              decorations: () => decorations
            }
          })
        ]
      })
    });

    const paragraph = root.querySelector('td p');

    expect(paragraph?.innerHTML).toBe('A1');
  });

  it('injects rich inline custom highlight styles once at runtime', (): void => {
    const style = ensureAIInlineCSSHighlightStyle();
    const duplicateStyle = ensureAIInlineCSSHighlightStyle();
    const injectedStyles = document.head.querySelectorAll(`#${tableInlineHighlightStyleId}`);

    expect(style).toBeInstanceOf(HTMLStyleElement);
    expect(duplicateStyle).toBe(style);
    expect(injectedStyles).toHaveLength(1);
    expect(style?.textContent).toContain('.b-markdown-rich__content .ProseMirror::highlight(b-markdown-ai-selection-highlight)');
    expect(style?.textContent).toContain('background: var(--selection-bg);');
  });
});
