<template>
  <div class="rich-editor-pane" @click="handleLinkClick">
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
    <CurrentBlockMenu :editor="props.editor" />
    <!-- 选择工具栏 -->
    <SelectionToolbar
      :editor="props.editor"
      :file-path="props.filePath"
      :file-name="props.fileName"
      @ai-input-toggle="handleAIInputToggle"
      @selection-reference-insert="handleSelectionReferenceInsert"
      @selection-reference-clear="handleSelectionReferenceClear"
    />
    <!-- 选择 AI 输入框 -->
    <SelectionAIInput v-model:visible="aiInputVisible" :editor="props.editor" :selection-range="selectionRange" />
    <!-- 编辑器内容 -->
    <EditorContent :key="editorId" :editor="props.editor ?? undefined" class="b-editor-content" />
  </div>
</template>

<script setup lang="ts">
import type { FrontMatterData } from '../hooks/useFrontMatter';
import type { SelectionRange } from '../types';
import type { Editor } from '@tiptap/vue-3';
import { onBeforeUnmount, ref, watch } from 'vue';
import { EditorContent } from '@tiptap/vue-3';
import { native } from '@/shared/platform';
import { clearAISelectionHighlight, setAISelectionHighlight } from '../extensions/AISelectionHighlight';
import CurrentBlockMenu from './CurrentBlockMenu.vue';
import FrontMatterCard from './FrontMatterCard.vue';
import SelectionAIInput from './SelectionAIInput.vue';
import SelectionToolbar from './SelectionToolbar.vue';

interface Props {
  // Editor Instance
  editor?: Editor | null;
  // Editor ID
  editorId?: string;
  // 文件路径
  filePath?: string | null;
  // 文件名
  fileName?: string;
  // 是否显示 Front Matter 卡片
  shouldShowFrontMatterCard?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editor: null,
  editorId: '',
  filePath: null,
  fileName: '',
  shouldShowFrontMatterCard: false
});

const frontMatterData = defineModel<FrontMatterData>('frontMatterData', { default: () => ({}) });

const aiInputVisible = ref(false);
const selectionRange = ref<SelectionRange>({ from: 0, to: 0, text: '' });

// ---- Editor Commands ----

const undo = () => props.editor?.commands.undo();
const redo = () => props.editor?.commands.redo();
const canUndo = () => Boolean(props.editor?.can().undo());
const canRedo = () => Boolean(props.editor?.can().redo());
const focusEditor = () => props.editor?.commands.focus();
const focusEditorAtStart = () => props.editor?.commands.focus('start');

// ---- AI Input ----

/**
 * 仅在内容变化时更新选区缓存，避免触发不必要的响应式循环。
 * @param nextSelectionRange - 最新选区
 */
function updateSelectionRange(nextSelectionRange: SelectionRange): void {
  const currentSelectionRange = selectionRange.value;
  if (
    currentSelectionRange.from === nextSelectionRange.from &&
    currentSelectionRange.to === nextSelectionRange.to &&
    currentSelectionRange.text === nextSelectionRange.text
  ) {
    return;
  }

  selectionRange.value = nextSelectionRange;
}

/**
 * 从编辑器状态中读取当前选区，并同步到本地缓存。
 * @returns 当前有效选区；无文本选区时返回 null
 */
function getCurrentSelectionRange(): SelectionRange | null {
  const { editor } = props;
  const selection = editor?.state.selection;
  if (!editor || !selection || selection.from === selection.to) {
    return null;
  }

  const nextSelectionRange = {
    from: selection.from,
    to: selection.to,
    text: editor.state.doc.textBetween(selection.from, selection.to, '')
  };

  updateSelectionRange(nextSelectionRange);

  return nextSelectionRange;
}

/**
 * 将真实选区持续映射到自定义 decoration，高亮统一走同一套视觉层。
 */
function syncSelectionHighlight(): void {
  const { editor } = props;
  if (!editor) {
    return;
  }

  const nextSelectionRange = getCurrentSelectionRange();
  if (nextSelectionRange) {
    setAISelectionHighlight(editor, nextSelectionRange);
    return;
  }

  if (!aiInputVisible.value) {
    clearAISelectionHighlight(editor);
  }
}

/**
 * 缓存并恢复当前选区，供“插入对话”在编辑器失焦后继续保持可见。
 * @param nextSelectionRange - 当前需要保留的选区
 */
function handleSelectionReferenceInsert(nextSelectionRange: SelectionRange): void {
  updateSelectionRange({ ...nextSelectionRange });

  // “插入对话”只需要保留视觉高亮，不应恢复真实选区；
  // 这里同步写入装饰高亮，避免跨帧切换造成原生选区与装饰高亮来回闪动。
  setAISelectionHighlight(props.editor, nextSelectionRange);
}

/**
 * 控制选区 AI 面板显隐，并同步记录关联的选区范围。
 * @param value - 是否显示 AI 面板
 * @param nextSelectionRange - 需要绑定的选区范围
 */
function handleAIInputToggle(value: boolean, nextSelectionRange?: SelectionRange): void {
  if (nextSelectionRange) {
    updateSelectionRange({ ...nextSelectionRange });
  }
  aiInputVisible.value = value;
}

/**
 * 在工具栏真正隐藏后清理“插入对话”留下的临时选区高亮。
 */
function handleSelectionReferenceClear(): void {
  clearAISelectionHighlight(props.editor);
}

/**
 * 监听编辑器选区与焦点变化，统一维护自定义选区高亮。
 * @param editor - 当前编辑器实例
 * @returns 解绑函数
 */
function bindSelectionHighlight(editor: Editor | null | undefined): (() => void) | undefined {
  if (!editor) {
    return undefined;
  }

  editor.on('selectionUpdate', syncSelectionHighlight);
  editor.on('focus', syncSelectionHighlight);
  editor.on('blur', syncSelectionHighlight);
  syncSelectionHighlight();

  return () => {
    editor.off('selectionUpdate', syncSelectionHighlight);
    editor.off('focus', syncSelectionHighlight);
    editor.off('blur', syncSelectionHighlight);
    clearAISelectionHighlight(editor);
  };
}

let cleanupSelectionHighlight: (() => void) | undefined;

watch(
  () => props.editor,
  (editor) => {
    cleanupSelectionHighlight?.();
    cleanupSelectionHighlight = bindSelectionHighlight(editor);
  },
  { immediate: true }
);

watch(aiInputVisible, (isVisible) => {
  if (!props.editor) {
    return;
  }

  if (isVisible && selectionRange.value.from !== selectionRange.value.to) {
    setAISelectionHighlight(props.editor, {
      from: selectionRange.value.from,
      to: selectionRange.value.to
    });
    return;
  }

  syncSelectionHighlight();
});

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

async function handleLinkClick(event: MouseEvent): Promise<void> {
  const { target } = event;
  if (!(target instanceof Element)) {
    return;
  }

  const anchor = target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement) || !anchor.href) {
    return;
  }

  event.preventDefault();
  await native.openExternal(anchor.href);
}

onBeforeUnmount(() => {
  cleanupSelectionHighlight?.();
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
      border-radius: 2px;
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
