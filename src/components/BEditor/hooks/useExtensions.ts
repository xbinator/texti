import type { AnyExtension, JSONContent, MarkdownParseHelpers, MarkdownParseResult, MarkdownToken, Editor } from '@tiptap/core';
import { Ref } from 'vue';
import _Code from '@tiptap/extension-code';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Color } from '@tiptap/extension-color';
import { Heading as BaseHeading } from '@tiptap/extension-heading';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { Link } from '@tiptap/extension-link';
import { ListItem as BaseListItem } from '@tiptap/extension-list';
import { Paragraph as BaseParagraph } from '@tiptap/extension-paragraph';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Strike } from '@tiptap/extension-strike';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import { Typography } from '@tiptap/extension-typography';
import { Underline } from '@tiptap/extension-underline';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { VueNodeViewRenderer } from '@tiptap/vue-3';
import { common, createLowlight } from 'lowlight';
import CodeBlockView from '../components/CodeBlock.vue';
import { Search, type SearchScrollContext } from '../extensions/Search';

const lowlight = createLowlight(common);

interface UseBEditorExtensionsResult {
  assignHeadingIds: (editor: Editor) => void;
  editorExtensions: AnyExtension[];
  resetHeadingIndex: () => void;
}

interface UseExtensionsOptions {
  onSearchMatchFocus?: (context: SearchScrollContext) => void;
}

function createParagraphNode(content: JSONContent[] = []): JSONContent {
  return {
    type: 'paragraph',
    content
  };
}

function parseInlineOrText(tokens: MarkdownToken[] | undefined, text: string | undefined, helpers: MarkdownParseHelpers): JSONContent[] {
  const content = helpers.parseInline(tokens || []);

  if (content.length) {
    return content;
  }

  return text ? [helpers.createTextNode(text)] : [];
}

export function useExtensions(editorInstanceId: Ref<string>, options: UseExtensionsOptions = {}): UseBEditorExtensionsResult {
  let headingIndex = 0;

  function resetHeadingIndex(): void {
    headingIndex = 0;
  }

  function getHeadingId(index: number): string {
    return `${editorInstanceId.value}-heading-${index}`;
  }

  const Code = _Code.extend({ excludes: '' });

  const CodeBlock = CodeBlockLowlight.extend({
    addNodeView: () => VueNodeViewRenderer(CodeBlockView)
  }).configure({ lowlight });

  const Heading = BaseHeading.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        id: {
          default: null,
          parseHTML: (element) => element.getAttribute('id'),
          renderHTML: (attributes) => (attributes.id ? { id: attributes.id } : {})
        }
      };
    },
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const content = helpers.parseInline(token.tokens || []);
      const id = getHeadingId(headingIndex++);

      if (content.length) {
        return helpers.createNode('heading', { level: token.depth || 1, id }, content);
      }

      const text = typeof token.text === 'string' ? token.text.trim() : '';

      return helpers.createNode('heading', { level: token.depth || 1, id }, text ? [helpers.createTextNode(text)] : []);
    },
    addKeyboardShortcuts() {
      return this.parent?.() ?? {};
    },
    onCreate() {
      const { editor } = this;
      editor.on('beforeCreate', () => {
        resetHeadingIndex();
      });
    }
  }).configure({ levels: [1, 2, 3, 4, 5, 6] });

  const Paragraph = BaseParagraph.extend({
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const content = helpers.parseInline(token.tokens || []);

      if (content.length) {
        return helpers.createNode('paragraph', undefined, content);
      }

      const text = typeof token.text === 'string' ? token.text : '';

      return helpers.createNode('paragraph', undefined, text ? [helpers.createTextNode(text)] : []);
    }
  });

  const ListItem = BaseListItem.extend({
    parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
      const parseBlockChildren = helpers.parseBlockChildren ?? helpers.parseChildren;
      let contentNodes: JSONContent[] = [];
      let inlineBuffer: JSONContent[] = [];

      function flushInlineBuffer(forceEmpty = false): void {
        if (inlineBuffer.length > 0 || forceEmpty) {
          contentNodes.push(createParagraphNode(inlineBuffer));
          inlineBuffer = [];
        }
      }

      if (token.tokens && token.tokens.length > 0) {
        token.tokens.forEach((itemToken) => {
          if (itemToken.type === 'space') {
            return;
          }

          if (itemToken.type === 'text' && itemToken.tokens && itemToken.tokens.length > 0) {
            inlineBuffer.push(...helpers.parseInline(itemToken.tokens));
            return;
          }

          const parsedNodes = parseBlockChildren([itemToken]);

          if (!parsedNodes.length) {
            return;
          }

          const inlineNodes = parsedNodes.filter((node) => node.type === 'text');
          if (inlineNodes.length === parsedNodes.length) {
            inlineBuffer.push(...inlineNodes);
            return;
          }

          if (contentNodes.length === 0) {
            flushInlineBuffer(true);
          } else {
            flushInlineBuffer();
          }

          contentNodes.push(...parsedNodes);
        });
      }

      if (inlineBuffer.length > 0) {
        flushInlineBuffer(contentNodes.length === 0);
      }

      if (contentNodes.length === 0) {
        contentNodes = [createParagraphNode()];
      }

      if (contentNodes[0]?.type !== 'paragraph') {
        contentNodes = [createParagraphNode(), ...contentNodes];
      }

      return { type: 'listItem', content: contentNodes };
    }
  });

  const MarkdownTable = Table.extend({
    parseMarkdown: (
      token: MarkdownToken & {
        header?: Array<{ text?: string; tokens?: MarkdownToken[] }>;
        rows?: Array<Array<{ text?: string; tokens?: MarkdownToken[] }>>;
      },
      helpers: MarkdownParseHelpers
    ): MarkdownParseResult => {
      const rows: JSONContent[] = [];

      if (token.header) {
        const headerCells = token.header.map((cell) =>
          helpers.createNode('tableHeader', {}, [helpers.createNode('paragraph', {}, parseInlineOrText(cell.tokens, cell.text, helpers))])
        );

        rows.push(helpers.createNode('tableRow', {}, headerCells));
      }

      if (token.rows) {
        token.rows.forEach((row) => {
          const bodyCells = row.map((cell) =>
            helpers.createNode('tableCell', {}, [helpers.createNode('paragraph', {}, parseInlineOrText(cell.tokens, cell.text, helpers))])
          );

          rows.push(helpers.createNode('tableRow', {}, bodyCells));
        });
      }

      return helpers.createNode('table', undefined, rows);
    }
  });

  const editorExtensions = [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      heading: false,
      listItem: false,
      paragraph: false,
      strike: false
    }),
    Placeholder.configure({ emptyEditorClass: 'is-editor-empty', placeholder: '请输入内容' }),
    Markdown,
    Heading,
    Paragraph,
    Code,
    CodeBlock,
    ListItem,
    MarkdownTable.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Search.configure({
      onMatchFocus: options.onSearchMatchFocus ?? null
    }),
    Image.configure({
      inline: false,
      allowBase64: true,
      HTMLAttributes: {
        class: 'editor-image'
      }
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: 'editor-link',
        rel: 'noopener noreferrer',
        target: '_blank'
      }
    }),
    TaskList,
    TaskItem.configure({
      nested: true
    }),
    Highlight.configure({
      multicolor: true
    }),
    Underline,
    Strike,
    TextStyle,
    Color,
    Typography
  ];

  function assignHeadingIds(editor: Editor): void {
    const { state, view } = editor;
    const { tr } = state;
    let index = 0;
    let needsUpdate = false;

    state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const expectedId = getHeadingId(index);
        if (node.attrs.id !== expectedId) {
          needsUpdate = true;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, id: expectedId });
        }
        index++;
      }
    });

    if (needsUpdate) {
      view.dispatch(tr);
    }
  }

  return {
    assignHeadingIds,
    editorExtensions,
    resetHeadingIndex
  };
}
