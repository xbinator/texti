<template>
  <div class="b-editor-layout">
    <BEditorSidebar v-if="showSidebar" :content="content" class="b-editor-sidebar" />

    <BScrollbar class="b-editor-scrollbar" @click="handleScrollbarClick">
      <EditorContent :editor="editorInstance" class="b-editor-content" />
    </BScrollbar>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { useWindowSize } from '@vueuse/core';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

const MIN_WIDTH_FOR_SIDEBAR = 1360; // 800 + 280 * 2

const { width } = useWindowSize();
const showSidebar = ref(true);

watch(width, (newWidth) => (showSidebar.value = newWidth >= MIN_WIDTH_FOR_SIDEBAR), { immediate: true });

interface Props {
  editable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editable: true
});

const content = defineModel<string>();

function setEditorContent(text: string, emitUpdate = true) {
  // eslint-disable-next-line no-use-before-define
  const instance = editorInstance.value;
  if (!instance) return;

  // contentType: 'markdown' 保持 Markdown 格式
  // preserveWhitespace: 'full' 保持所有空格
  instance.commands.setContent(text, { emitUpdate, parseOptions: { preserveWhitespace: 'full' }, contentType: 'markdown' });
}

const editorInstance = useEditor({
  content: content.value ?? '',
  extensions: [StarterKit, Markdown, CodeBlockLowlight.configure({ lowlight })],
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
    content.value = editor.getMarkdown();
  }
});

function addHeadingIds() {
  nextTick(() => {
    const editorElement = editorInstance.value?.view.dom;
    if (!editorElement) return;

    const headings = editorElement.querySelectorAll('h1, h2, h3, h4, h5, h6');
    headings.forEach((heading, index) => {
      if (!heading.id) {
        heading.id = `heading-${index}`;
      }
    });
  });
}

watch(
  () => editorInstance.value?.getHTML(),
  () => {
    addHeadingIds();
  },
  { immediate: true }
);

watch(content, (newContent) => {
  const instance = editorInstance.value;
  if (!instance) return;

  const current = instance.getMarkdown();

  if (newContent !== current) {
    setEditorContent(newContent ?? '', false);
  }
});

function handleScrollbarClick() {
  const instance = editorInstance.value;
  if (instance) {
    instance.commands.focus();
  }
}
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

.b-editor-content {
  max-width: 800px;
  height: 100%;
  min-height: 100%;
  margin: 0 auto;

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
    padding-left: 1.5em;
    margin: 0.75em 0;
  }

  li {
    margin: 0.25em 0;

    > p {
      margin: 0.25em 0;
    }
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
    padding: 1em;
    margin: 0.75em 0;
    overflow-x: auto;
    background-color: #f5f5f5;
    border: 1px solid #e0e0e0;
    border-radius: 4px;

    code {
      padding: 0;
      font-family: 'Fira Code', 'Fira Mono', Consolas, Monaco, 'Courier New', monospace;
      font-size: 0.9em;
      line-height: 1.6;
      color: #2e2e2e;
      background-color: transparent;

      .hljs-keyword {
        color: #c678dd;
      }

      .hljs-string {
        color: #98c379;
      }

      .hljs-number {
        color: #d19a66;
      }

      .hljs-comment {
        font-style: italic;
        color: #5c6370;
      }

      .hljs-function {
        color: #61afef;
      }

      .hljs-title {
        color: #e5c07b;
      }

      .hljs-params {
        color: #d19a66;
      }

      .hljs-variable {
        color: #e06c75;
      }

      .hljs-operator {
        color: #56b6c2;
      }

      .hljs-tag {
        color: #e06c75;
      }

      .hljs-attr {
        color: #d19a66;
      }

      .hljs-value {
        color: #98c379;
      }

      .hljs-property {
        color: #e06c75;
      }

      .hljs-built_in {
        color: #e5c07b;
      }

      .hljs-class {
        color: #e5c07b;
      }

      .hljs-constant {
        color: #d19a66;
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
    overflow: hidden;
    border-collapse: collapse;
    border: 1px solid #e0e0e0;
    border-radius: 4px;

    th {
      padding: 0.5em 0.75em;
      font-weight: 600;
      color: #2e2e2e;
      text-align: left;
      background-color: #f5f5f5;
      border: 1px solid #e0e0e0;
    }

    td {
      padding: 0.5em 0.75em;
      color: #2e2e2e;
      text-align: left;
      border: 1px solid #e0e0e0;
    }

    tr:hover td {
      background-color: #f9f9f9;
    }
  }
}
</style>
