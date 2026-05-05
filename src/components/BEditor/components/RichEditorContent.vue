<template>
  <div ref="overlayRootRef" class="rich-editor-pane" @click="navigate.onLink">
    <!-- Front Matter 卡片 -->
    <FrontMatterCard
      v-if="shouldShowFrontMatterCard"
      :data="frontMatterData"
      @click.stop
      @update="handleFrontMatterUpdate"
      @update-field="handleFrontMatterFieldUpdate"
      @remove-field="handleFrontMatterFieldRemove"
      @add-field="handleFrontMatterFieldAdd"
    />

    <!-- 当前选中块菜单 -->
    <CurrentBlockMenu :editor="editor" />

    <!-- Rich 模式选区工具栏宿主 -->
    <SelectionToolbarRich
      v-if="editor && adapter"
      ref="toolbarHostRef"
      :editor="editor"
      :visible="assistant.toolbarVisible.value"
      :format-buttons="formatButtons"
      @ai="onToolbarAI"
      @reference="assistant.insertReference()"
    />

    <!-- 选择 AI 输入框 -->
    <SelectionAIInput
      :visible="assistant.aiInputVisible.value"
      :adapter="adapter"
      :selection-range="assistant.cachedSelectionRange.value"
      :position="assistant.panelPosition.value"
      @update:visible="onAIInputVisibleChange"
      @apply="assistant.applyAIResult($event)"
      @streaming-change="assistant.setStreaming($event)"
    />

    <!-- 编辑器内容 -->
    <EditorContent :key="editorState?.id" :editor="editor ?? undefined" class="b-editor-content" />
  </div>
</template>

<script setup lang="ts">
import type { SelectionAssistantAdapter, SelectionToolbarAction } from '../adapters/selectionAssistant';
import type { FrontMatterData } from '../hooks/useFrontMatter';
import type { EditorState } from '../types';
import type { Editor } from '@tiptap/vue-3';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { EditorContent } from '@tiptap/vue-3';
import { useEventListener } from '@vueuse/core';
import { useNavigate } from '@/hooks/useNavigate';
import { createRichSelectionAssistantAdapter } from '../adapters/richSelectionAssistant';
import { useSelectionAssistant } from '../hooks/useSelectionAssistant';
import CurrentBlockMenu from './CurrentBlockMenu.vue';
import FrontMatterCard from './FrontMatterCard.vue';
import SelectionAIInput from './SelectionAIInput.vue';
import SelectionToolbarRich from './SelectionToolbarRich.vue';

interface Props {
  /** Tiptap Editor 实例 */
  editor?: Editor | null;
  /** 编辑器文件状态 */
  editorState?: EditorState;
  /** 是否显示 Front Matter 卡片 */
  shouldShowFrontMatterCard?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editor: null,
  editorState: () => ({ content: '', name: '', path: '', id: '', ext: '' }),
  shouldShowFrontMatterCard: false
});

const navigate = useNavigate();

const frontMatterData = defineModel<FrontMatterData>('frontMatterData', { default: () => ({}) });

// ---- Adapter & Orchestration ----

const overlayRootRef = ref<HTMLElement | null>(null);
const toolbarHostRef = ref<InstanceType<typeof SelectionToolbarRich> | null>(null);
const adapter = shallowRef<SelectionAssistantAdapter | null>(null);

const assistant = useSelectionAssistant({
  adapter: () => adapter.value,
  isEditable: () => true
});

// 监听 editor + overlayRoot 就绪后创建 adapter
watch(
  [() => props.editor, overlayRootRef, () => props.editorState],
  ([editor, root, editorState]) => {
    if (editor && root) {
      adapter.value = createRichSelectionAssistantAdapter(editor, {
        editorState: editorState || { content: '', name: '', path: '', id: '', ext: '' },
        overlayRoot: root
      });
    } else {
      adapter.value = null;
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  adapter.value?.dispose?.();
  adapter.value = null;
});

// ---- Format Buttons ----

/** Rich 模式格式按钮列表 */
const formatButtons = computed(() => [
  { command: 'bold' as SelectionToolbarAction, icon: 'lucide:bold' },
  { command: 'italic' as SelectionToolbarAction, icon: 'lucide:italic' },
  { command: 'underline' as SelectionToolbarAction, icon: 'lucide:underline' },
  { command: 'strike' as SelectionToolbarAction, icon: 'lucide:strikethrough' },
  { command: 'code' as SelectionToolbarAction, icon: 'lucide:code' }
]);

// ---- Toolbar Actions ----

/**
 * 点击"AI 助手"按钮，先通过 host 主动隐藏工具栏，再打开 AI 面板。
 */
function onToolbarAI(): void {
  toolbarHostRef.value?.suppress();
  assistant.openAIInput();
}

/**
 * 同步 AI 面板显隐到统一编排层。
 * @param visible - 面板是否可见
 */
function onAIInputVisibleChange(visible: boolean): void {
  if (!visible) {
    assistant.closeAIInput();
  }
}

// ---- Editor Commands ----

const undo = () => props.editor?.commands.undo();
const redo = () => props.editor?.commands.redo();
const canUndo = () => Boolean(props.editor?.can().undo());
const canRedo = () => Boolean(props.editor?.can().redo());
const focusEditor = () => props.editor?.commands.focus();
const focusEditorAtStart = () => props.editor?.commands.focus('start');

// ---- Front Matter ----
function handleFrontMatterUpdate(data: FrontMatterData): void {
  frontMatterData.value = { ...data };
}

function handleFrontMatterFieldUpdate(key: string, value: unknown): void {
  frontMatterData.value = { ...frontMatterData.value, [key]: value };
}

function handleFrontMatterFieldRemove(key: string): void {
  const rest = Object.fromEntries(Object.entries(frontMatterData.value).filter(([k]) => k !== key));
  frontMatterData.value = rest;
}

function handleFrontMatterFieldAdd(key: string, value: unknown): void {
  if (key in frontMatterData.value) return;
  frontMatterData.value = { ...frontMatterData.value, [key]: value };
}

useEventListener(window, 'resize', () => {
  assistant.recomputeAllPositions();
});

defineExpose({ undo, redo, canUndo, canRedo, focusEditor, focusEditorAtStart });
</script>

<style lang="less">
@import url('@/assets/styles/markdown.less');

.rich-editor-pane {
  position: relative;
}

.b-editor-content {
  height: 100%;
  min-height: 100%;

  .ProseMirror {
    min-height: 100%;
    margin: 0;
    line-height: 1.74;
    color: var(--editor-text);
    caret-color: var(--editor-caret);
    outline: none;

    &::selection {
      background: transparent;
    }

    *::selection {
      background: transparent;
    }

    > *:first-child {
      margin-top: 0;
    }

    .search-match {
      background: var(--editor-search-highlight);
      border-radius: 2px;
    }

    .search-match-current {
      color: #000;
      background: var(--editor-search-active);
      box-shadow: var(--editor-search-active-border);
    }

    .ai-selection-highlight {
      color: var(--selection-color);
      background: var(--selection-bg);
      box-shadow: 0 0.2em 0 0 var(--selection-bg), 0 -0.2em 0 0 var(--selection-bg);
      -webkit-box-decoration-break: clone;
      box-decoration-break: clone;
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
    margin: 1.5em 0 0.75em;
    font-size: 24px;
  }

  h2 {
    margin: 1.25em 0 0.625em;
    font-size: 20px;
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

  ul[data-type='taskList'] {
    padding: 0;
    margin-left: 0;
    list-style: none;

    li {
      display: flex;
      align-items: center;

      > label {
        flex: 0 0 auto;
        margin-right: 0.5rem;
        user-select: none;
      }

      > div {
        flex: 1 1 auto;
      }
    }

    input[type='checkbox'] {
      cursor: pointer;
    }
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
      .code-highlight();
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
    cursor: pointer;

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
