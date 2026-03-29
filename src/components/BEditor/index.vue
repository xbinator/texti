<template>
  <div ref="layoutRef" class="b-editor-layout">
    <BEditorSidebar
      v-if="showSidebar"
      :title="editorTitle"
      :content="bodyContentForSidebar"
      :anchor-id-prefix="editorInstanceId"
      :active-id="activeAnchorId"
      class="b-editor-sidebar"
      @change="handleChangeAnchor"
    />

    <BScrollbar class="b-editor-scrollbar" @click="handleScrollbarClick" @scroll="handleEditorScroll">
      <div class="b-editor-container">
        <textarea ref="textarea" v-model="editorTitle" class="b-editor-title" placeholder="请输入标题"></textarea>

        <FrontMatterCard
          v-if="hasFrontMatter"
          :data="frontMatterData"
          @click.stop
          @update="handleFrontMatterUpdate"
          @update-field="handleFrontMatterFieldUpdate"
          @remove-field="handleFrontMatterFieldRemove"
          @add-field="handleFrontMatterFieldAdd"
        />

        <EditorContent :editor="editorInstance" class="b-editor-content" />
      </div>
    </BScrollbar>
  </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core';
import { computed, ref, toRef, watch } from 'vue';
import { useEditor, EditorContent } from '@tiptap/vue-3';
import { useWindowSize, useTextareaAutosize } from '@vueuse/core';
import FrontMatterCard from './components/FrontMatterCard.vue';
import { useAnchors } from './hooks/useAnchors';
import { useContent } from './hooks/useContent';
import { useExtensions } from './hooks/useExtensions';
import { useFrontMatter } from './hooks/useFrontMatter';

const MIN_WIDTH_FOR_SIDEBAR = 1360;
let editorInstanceCounter = 0;

const { width } = useWindowSize();
const layoutRef = ref<HTMLElement | null>(null);
const showSidebar = ref(true);
const editorInstanceId = `b-editor-${editorInstanceCounter++}`;

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
const { activeAnchorId, handleChangeAnchor, handleEditorScroll } = useAnchors(layoutRef);
const { editorExtensions, resetHeadingIndex, assignHeadingIds } = useExtensions(editorInstanceId);
const editorInstanceRef = ref<Editor>();

const {
  bodyContent,
  frontMatterData,
  hasFrontMatter,
  updateFrontMatter,
  updateFrontMatterField,
  removeFrontMatterField,
  addFrontMatterField,
  reconstructContent
} = useFrontMatter(editorContent);

const bodyContentForSidebar = computed(() => bodyContent.value);

function syncToExternal(): void {
  editorContent.value = reconstructContent();
}

const { setEditorContent, onPaste, onEditorUpdate } = useContent({
  assignHeadingIds,
  editable: toRef(props, 'editable'),
  editorContent: bodyContent,
  getEditorInstance: () => editorInstanceRef.value,
  resetHeadingIndex,
  onContentChange: syncToExternal
});

const editorInstance = useEditor({
  content: bodyContent.value ?? '',
  extensions: editorExtensions,
  editable: props.editable,
  editorProps: { attributes: { spellcheck: 'false' }, handlePaste: onPaste },
  onUpdate: onEditorUpdate
});

watch(
  editorInstance,
  (instance) => {
    editorInstanceRef.value = instance;
  },
  { immediate: true }
);

watch(bodyContent, (content) => {
  const instance = editorInstanceRef.value;
  if (!instance) return;

  const currentContent = instance.getMarkdown();
  if (currentContent === content) return;

  setEditorContent(content ?? '', false);
});

function handleFrontMatterUpdate(data: Record<string, unknown>): void {
  updateFrontMatter(data);
  syncToExternal();
}

function handleFrontMatterFieldUpdate(key: string, value: unknown): void {
  updateFrontMatterField(key, value);
  syncToExternal();
}

function handleFrontMatterFieldRemove(key: string): void {
  removeFrontMatterField(key);
  syncToExternal();
}

function handleFrontMatterFieldAdd(key: string, value: unknown): void {
  addFrontMatterField(key, value);
  syncToExternal();
}

function handleScrollbarClick(event: MouseEvent): void {
  if ((event.target as HTMLElement).tagName === 'TEXTAREA') return;

  const instance = editorInstance.value;
  if (instance) {
    instance.commands.focus();
  }
}

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
    border-collapse: separate;
    border-spacing: 0;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    overflow: hidden;

    th {
      padding: 0.5em 0.75em;
      font-weight: 600;
      vertical-align: top;
      color: #2e2e2e;
      text-align: left;
      background-color: #f5f5f5;
      border-bottom: 1px solid #e0e0e0;
      border-right: 1px solid #e0e0e0;

      &:last-child {
        border-right: none;
      }
    }

    td {
      padding: 0.5em 0.75em;
      vertical-align: top;
      color: #2e2e2e;
      text-align: left;
      background-color: #fff;
      border-bottom: 1px solid #e0e0e0;
      border-right: 1px solid #e0e0e0;

      &:last-child {
        border-right: none;
      }
    }

    tr:last-child td {
      border-bottom: none;
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
