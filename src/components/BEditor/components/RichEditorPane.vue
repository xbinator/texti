<template>
  <div class="rich-editor-pane">
    <FrontMatterCard
      v-if="shouldShowFrontMatterCard"
      :data="frontMatterData"
      @click.stop
      @update="handleFrontMatterUpdate"
      @update-field="handleFrontMatterFieldUpdate"
      @remove-field="handleFrontMatterFieldRemove"
      @add-field="handleFrontMatterFieldAdd"
    />

    <CurrentBlockMenu :editor="props.editor" />
    <EditorContent :key="editorId" :editor="props.editor ?? undefined" class="b-editor-content" />
  </div>
</template>

<script setup lang="ts">
import type { FrontMatterData } from '../hooks/useFrontMatter';
import type { Editor } from '@tiptap/vue-3';
import { EditorContent } from '@tiptap/vue-3';
import CurrentBlockMenu from './CurrentBlockMenu.vue';
import FrontMatterCard from './FrontMatterCard.vue';

interface Props {
  editor?: Editor | null;
  editorId?: string;
  shouldShowFrontMatterCard?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editor: null,
  editorId: '',
  shouldShowFrontMatterCard: false
});

const frontMatterData = defineModel<FrontMatterData>('frontMatterData', { default: () => ({}) });

function handleFrontMatterUpdate(data: FrontMatterData): void {
  frontMatterData.value = { ...data };
}

function handleFrontMatterFieldUpdate(key: string, value: unknown): void {
  frontMatterData.value = {
    ...frontMatterData.value,
    [key]: value
  };
}

function handleFrontMatterFieldRemove(key: string): void {
  const nextData: FrontMatterData = { ...frontMatterData.value };
  delete nextData[key];
  frontMatterData.value = nextData;
}

function handleFrontMatterFieldAdd(key: string, value: unknown): void {
  if (frontMatterData.value[key] !== undefined) {
    return;
  }

  frontMatterData.value = {
    ...frontMatterData.value,
    [key]: value
  };
}

function undo(): void {
  props.editor?.commands.undo();
}

function redo(): void {
  props.editor?.commands.redo();
}

function canUndo(): boolean {
  const can = props.editor?.can();
  return Boolean(can?.undo());
}

function canRedo(): boolean {
  const can = props.editor?.can();
  return Boolean(can?.redo());
}

function focusEditor(): void {
  props.editor?.commands.focus();
}

function focusEditorAtStart(): void {
  props.editor?.commands.focus('start');
}

defineExpose({ undo, redo, canUndo, canRedo, focusEditor, focusEditorAtStart });
</script>

<style lang="less">
.rich-editor-pane {
  position: relative;
}

.b-editor-content {
  height: 100%;
  min-height: 100%;

  .ProseMirror {
    min-height: 100%;
    padding: 20px 40px 90px;
    margin: 0;
    font-size: 14px;
    line-height: 1.74;
    color: var(--editor-text);
    caret-color: var(--editor-caret);
    outline: none;

    > *:first-child {
      margin-top: 0;
    }

    .search-match {
      background: var(--editor-search-highlight);
      border-radius: 2px;
    }

    .search-match-current {
      background: var(--editor-search-active);
      box-shadow: var(--editor-search-active-border);
    }

    .is-editor-empty:first-child::before {
      float: left;
      height: 0;
      font-size: 14px;
      line-height: 1.74;
      color: var(--editor-placeholder);
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
    color: var(--editor-text);
  }

  h1 {
    padding-bottom: 0.3em;
    margin: 1.5em 0 0.75em;
    font-size: 24px;
    border-bottom: 1px solid var(--editor-heading-border);
  }

  h2 {
    padding-bottom: 0.2em;
    margin: 1.25em 0 0.625em;
    font-size: 20px;
    border-bottom: 1px solid var(--editor-heading-border);
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
      color: var(--text-tertiary);
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
    color: var(--editor-blockquote-text);
    background-color: var(--editor-blockquote-bg);
    border-left: 4px solid var(--editor-blockquote-border);
    border-radius: 0 4px 4px 0;
  }

  code {
    padding: 0.125em 0.25em;
    font-family: Menlo, Monaco, 'Courier New', monospace;
    font-size: 0.85em;
    color: var(--color-error);
    background-color: var(--bg-disabled);
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
      color: var(--code-text);
      background-color: transparent;

      .hljs-keyword {
        color: var(--code-keyword);
      }

      .hljs-string {
        color: var(--code-string);
      }

      .hljs-number {
        color: var(--code-number);
      }

      .hljs-comment {
        font-style: italic;
        color: var(--code-comment);
      }

      .hljs-function {
        color: var(--code-function);
      }

      .hljs-title {
        color: var(--code-function);
      }

      .hljs-params {
        color: var(--code-text);
      }

      .hljs-variable {
        color: var(--code-variable);
      }

      .hljs-operator {
        color: var(--code-number);
      }

      .hljs-tag {
        color: var(--code-tag);
      }

      .hljs-attr {
        color: var(--code-attr-name);
      }

      .hljs-value {
        color: var(--code-attr-value);
      }

      .hljs-property {
        color: var(--code-variable);
      }

      .hljs-built_in {
        color: var(--code-builtin);
      }

      .hljs-class {
        color: var(--code-class);
      }

      .hljs-constant {
        color: var(--code-constant);
      }
    }
  }

  hr {
    margin: 1.5em 0;
    border: none;
    border-top: 1px solid var(--editor-hr);
  }

  a {
    font-weight: 500;
    color: var(--editor-link);
    text-decoration: none;

    &:hover {
      text-decoration: underline;
    }
  }

  img {
    max-width: 100%;
    margin: 0.75em 0;
    border-radius: 4px;
    box-shadow: var(--shadow-md);
  }

  table {
    width: 100%;
    margin: 0.75em 0;
    overflow: hidden;
    border-spacing: 0;
    border-collapse: separate;
    border: 1px solid var(--editor-table-border);
    border-radius: 8px;

    th {
      padding: 0.5em 0.75em;
      font-weight: 600;
      vertical-align: top;
      color: var(--editor-text);
      text-align: left;
      background-color: var(--editor-table-header-bg);
      border-right: 1px solid var(--editor-table-border);
      border-bottom: 1px solid var(--editor-table-border);

      &:last-child {
        border-right: none;
      }
    }

    td {
      padding: 0.5em 0.75em;
      vertical-align: top;
      color: var(--editor-text);
      text-align: left;
      background-color: var(--bg-primary);
      border-right: 1px solid var(--editor-table-border);
      border-bottom: 1px solid var(--editor-table-border);

      &:last-child {
        border-right: none;
      }
    }

    tr:last-child td {
      border-bottom: none;
    }

    tr:hover td {
      background-color: var(--editor-table-even-bg);
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
