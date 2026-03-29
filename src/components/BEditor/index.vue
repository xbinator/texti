<template>
  <div class="b-editor-layout">
    <BEditorSidebar
      v-if="showSidebar"
      :title="editorTitle"
      :content="editorContent"
      :active-id="activeAnchorId"
      class="b-editor-sidebar"
      @change="handleChangeAnchor"
    />

    <BScrollbar class="b-editor-scrollbar" @click="handleScrollbarClick" @scroll="handleEditorScroll">
      <div class="b-editor-container">
        <textarea ref="textarea" v-model="editorTitle" class="b-editor-title" placeholder="请输入标题"></textarea>

        <EditorContent :editor="editorInstance" class="b-editor-content" />
      </div>
    </BScrollbar>
  </div>
</template>

<script setup lang="ts">
import type { JSONContent, MarkdownParseHelpers, MarkdownParseResult, MarkdownToken, Editor } from '@tiptap/core';
import { ref, watch } from 'vue';
import _Code from '@tiptap/extension-code';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Heading as BaseHeading } from '@tiptap/extension-heading';
import { ListItem as BaseListItem } from '@tiptap/extension-list';
import { Paragraph as BaseParagraph } from '@tiptap/extension-paragraph';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { useEditor, EditorContent, VueNodeViewRenderer } from '@tiptap/vue-3';
import { useWindowSize, useTextareaAutosize, useThrottleFn } from '@vueuse/core';
import { common, createLowlight } from 'lowlight';
import _CodeBlock from './components/CodeBlock.vue';

const lowlight = createLowlight(common);

const MIN_WIDTH_FOR_SIDEBAR = 1360; // 800 + 280 * 2

const { width } = useWindowSize();
const showSidebar = ref(true);
const activeAnchorId = ref<string>('');

watch(width, (newWidth) => (showSidebar.value = newWidth >= MIN_WIDTH_FOR_SIDEBAR), { immediate: true });

interface Props {
  editable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editable: true
});

const editorContent = defineModel<string>();

const editorTitle = defineModel<string>('title', { default: '' });
// @ts-ignore
const { textarea } = useTextareaAutosize({ input: editorTitle });

const Code = _Code.extend({ excludes: '' });

const CodeBlock = CodeBlockLowlight.extend({ addNodeView: () => VueNodeViewRenderer(_CodeBlock) }).configure({ lowlight });

let headingIndex = 0;

function resetHeadingIndex(): void {
  headingIndex = 0;
}

const Heading = BaseHeading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('id'),
        renderHTML: (attributes) => {
          if (!attributes.id) {
            return {};
          }
          return { id: attributes.id };
        }
      }
    };
  },
  parseMarkdown: (token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult => {
    const content = helpers.parseInline(token.tokens || []);
    const id = `heading-${headingIndex++}`;

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

    if (token.tokens && token.tokens.length > 0) {
      const hasParagraphToken = token.tokens.some((item) => item.type === 'paragraph');
      const firstToken = token.tokens[0];

      if (hasParagraphToken) {
        contentNodes = parseBlockChildren(token.tokens);
      } else if (firstToken?.type === 'text' && firstToken.tokens && firstToken.tokens.length > 0) {
        contentNodes = [{ type: 'paragraph', content: helpers.parseInline(firstToken.tokens) }];

        if (token.tokens.length > 1) {
          const remainingTokens = token.tokens.slice(1);
          contentNodes.push(...parseBlockChildren(remainingTokens));
        }
      } else {
        contentNodes = parseBlockChildren(token.tokens);
      }
    }

    if (contentNodes.length === 0) {
      contentNodes = [{ type: 'paragraph', content: [] }];
    }

    return { type: 'listItem', content: contentNodes };
  }
});

function parseInlineOrText(tokens: MarkdownToken[] | undefined, text: string | undefined, helpers: MarkdownParseHelpers) {
  const content = helpers.parseInline(tokens || []);

  if (content.length) return content;

  return text ? [helpers.createTextNode(text)] : [];
}

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

const TableExtensions = [MarkdownTable.configure({ resizable: false }), TableRow, TableHeader, TableCell];

const editorExtensions = [
  StarterKit.configure({ code: false, codeBlock: false, heading: false, listItem: false, paragraph: false }),
  Placeholder.configure({ emptyEditorClass: 'is-editor-empty', placeholder: '请输入内容' }),
  Markdown,
  Heading,
  Paragraph,
  Code,
  CodeBlock,
  ListItem,
  ...TableExtensions
];

function assignHeadingIds(editor: Editor): void {
  const { state, view } = editor;
  const { tr } = state;
  let index = 0;
  let needsUpdate = false;

  state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const expectedId = `heading-${index}`;
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

function setEditorContent(text: string, emitUpdate = true) {
  // eslint-disable-next-line no-use-before-define
  const instance = editorInstance.value;
  if (!instance) return;

  headingIndex = 0;
  instance.commands.setContent(text, { emitUpdate, contentType: 'markdown' });
}

const editorInstance = useEditor({
  content: editorContent.value ?? '',
  extensions: editorExtensions,
  editable: props.editable,
  editorProps: {
    attributes: { spellcheck: 'false' },
    handlePaste(_view, event) {
      const instance = editorInstance.value;
      if (!instance) return false;

      const text = event.clipboardData?.getData('text/plain') || '';

      // 只在当前内容为空时，将粘贴内容按 Markdown 解析并整体渲染
      if (!text.trim()) return false;
      if (instance.state.doc.textContent.trim().length > 0) return false;

      event.preventDefault();
      setEditorContent(text);

      return true;
    }
  },

  onUpdate: ({ editor }) => {
    assignHeadingIds(editor);
    editorContent.value = editor.getMarkdown();
  }
});

function handleScrollbarClick(event: MouseEvent): void {
  if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;

  const instance = editorInstance.value;
  if (instance) {
    instance.commands.focus();
  }
}

function handleChangeAnchor(record: { id: string; level: number; text: string }) {
  activeAnchorId.value = record.id;

  if (!record.id) {
    const container = document.querySelector('.b-editor-scrollbar .scrollbar__wrap');
    if (container) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }

  const element = document.getElementById(record.id);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const HEADING_SELECTOR = '.b-editor-content h1, .b-editor-content h2, .b-editor-content h3, .b-editor-content h4, .b-editor-content h5, .b-editor-content h6';

const updateActiveAnchor = useThrottleFn(() => {
  const container = document.querySelector('.b-editor-scrollbar .scrollbar__wrap') as HTMLDivElement;
  if (!container) return;

  if (container.scrollTop < 50) {
    activeAnchorId.value = '';
    return;
  }

  const headings = document.querySelectorAll(HEADING_SELECTOR);
  if (!headings.length) return;

  let currentId = '';
  const containerRect = container.getBoundingClientRect();
  const threshold = containerRect.top + 100;

  headings.forEach((heading) => {
    const rect = heading.getBoundingClientRect();
    if (rect.top <= threshold) {
      currentId = heading.id;
    }
  });

  if (currentId !== activeAnchorId.value) {
    activeAnchorId.value = currentId;
  }
}, 100);

function handleEditorScroll() {
  updateActiveAnchor();
}

watch(
  () => editorContent.value,
  (content) => {
    const instance = editorInstance.value;
    if (!instance) return;

    const _content = instance.getMarkdown();
    if (_content === content) return;

    setEditorContent(content ?? '', false);
  }
);

defineExpose({ setContent: (text: string) => setEditorContent(text, false) });
</script>

<style lang="less">
.b-editor-layout {
  position: relative;
  display: flex;
  height: 100%;
}

.b-editor-sidebar {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 10;
}

.b-editor-scrollbar {
  flex: 1;
  overflow: hidden;
}

.b-editor-container {
  max-width: 800px;
  margin: 0 auto;
}

.b-editor-title {
  display: block;
  width: 100%;
  padding: 20px 40px 0;
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: #2e2e2e;
  cursor: text;
  resize: none;
  outline: none;
  background: transparent;
  border: none;

  &::placeholder {
    font-weight: 600;
    color: #bfbfbf;
  }
}

.b-editor-content {
  height: 100%;
  min-height: 100%;

  .ProseMirror {
    min-height: 100%;
    padding: 20px 40px 90px;
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: #2e2e2e;
    caret-color: #2e2e2e;
    outline: none;

    > *:first-child {
      margin-top: 0;
    }

    > .is-editor-empty:first-child::before {
      float: left;
      height: 0;
      color: #bfbfbf;
      pointer-events: none;
      content: attr(data-placeholder);
    }
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-weight: 600;
    color: #2e2e2e;
  }

  h1 {
    padding-bottom: 0.3em;
    margin: 1.5em 0 0.75em;
    font-size: 24px;
    border-bottom: 1px solid #e0e0e0;
  }

  h2 {
    padding-bottom: 0.2em;
    margin: 1.25em 0 0.625em;
    font-size: 20px;
    border-bottom: 1px solid #e0e0e0;
  }

  h3 {
    margin: 1em 0 0.5em;
    font-size: 16px;
  }

  h4 {
    margin: 0.875em 0 0.4375em;
    font-size: 14px;
  }

  h5 {
    margin: 0.75em 0 0.375em;
    font-size: 12px;
    text-transform: uppercase;
  }

  h6 {
    margin: 0.625em 0 0.3125em;
    font-size: 11px;
    text-transform: uppercase;
  }

  p {
    min-height: 1em;
    margin: 0.75em 0;
  }

  ul,
  ol {
    padding-left: 1.75em;
    margin: 0.75em 0;
  }

  ul > li {
    list-style: disc;
  }

  ol > li {
    list-style: decimal;
  }

  ul ul {
    list-style: circle;
  }

  ul ul ul {
    list-style: square;
  }

  ol ol {
    list-style: lower-alpha;
  }

  ol ol ol {
    list-style: lower-roman;
  }

  li {
    margin: 0.25em 0;

    &::marker {
      color: #6b7280;
    }

    > p {
      margin: 0.25em 0;
    }
  }

  li > ul,
  li > ol {
    margin: 0.25em 0;
  }

  blockquote {
    padding: 0.5em 1em 0.5em 1.25em;
    margin: 0.75em 0;
    color: #585858;
    background-color: #f5f5f5;
    border-left: 4px solid #d0d0d0;
    border-radius: 0 4px 4px 0;
  }

  code {
    padding: 0.125em 0.25em;
    font-family: Menlo, Monaco, 'Courier New', monospace;
    font-size: 0.85em;
    color: #e83e8c;
    background-color: #f1f1f1;
    border-radius: 3px;
  }

  pre {
    margin: 0.75em 0;
    background-color: transparent;
    border: 0;
    border-radius: 0;

    code {
      padding: 0;
      font-family: 'Fira Code', 'Fira Mono', Consolas, Monaco, 'Courier New', monospace;
      font-size: 0.9em;
      line-height: 1.6;
      color: #24292f;
      background-color: transparent;

      .hljs-keyword {
        color: #cf222e;
      }

      .hljs-string {
        color: #0a3069;
      }

      .hljs-number {
        color: #0550ae;
      }

      .hljs-comment {
        font-style: italic;
        color: #6e7781;
      }

      .hljs-function {
        color: #8250df;
      }

      .hljs-title {
        color: #8250df;
      }

      .hljs-params {
        color: #24292f;
      }

      .hljs-variable {
        color: #953800;
      }

      .hljs-operator {
        color: #0550ae;
      }

      .hljs-tag {
        color: #116329;
      }

      .hljs-attr {
        color: #0550ae;
      }

      .hljs-value {
        color: #0a3069;
      }

      .hljs-property {
        color: #953800;
      }

      .hljs-built_in {
        color: #8250df;
      }

      .hljs-class {
        color: #8250df;
      }

      .hljs-constant {
        color: #0550ae;
      }
    }
  }

  hr {
    margin: 1.5em 0;
    border: none;
    border-top: 1px solid #e0e0e0;
  }

  a {
    font-weight: 500;
    color: #1761d2;
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  img {
    max-width: 100%;
    margin: 0.75em 0;
    border-radius: 4px;
    box-shadow: 0 1px 3px rgb(0 0 0 / 10%);
  }

  table {
    width: 100%;
    margin: 0.75em 0;
    border-collapse: collapse;
    border: 1px solid #e0e0e0;
    border-radius: 4px;

    th {
      padding: 0.5em 0.75em;
      font-weight: 600;
      vertical-align: top;
      color: #2e2e2e;
      text-align: left;
      background-color: #f5f5f5;
      border: 1px solid #e0e0e0;
    }

    td {
      padding: 0.5em 0.75em;
      vertical-align: top;
      color: #2e2e2e;
      text-align: left;
      background-color: #fff;
      border: 1px solid #e0e0e0;
    }

    tr:hover td {
      background-color: #f9f9f9;
    }
  }

  .tableWrapper {
    width: 100%;
    margin: 0.75em 0;
    overflow-x: auto;
  }

  .tableWrapper table {
    margin: 0;
  }

  .tableWrapper th,
  .tableWrapper td {
    min-width: 120px;
  }

  .tableWrapper th p,
  .tableWrapper td p {
    min-height: auto;
    margin: 0;
    color: inherit;
  }
}
</style>
