<template>
  <div :class="name" @focusout="handleEditorFocusOut">
    <div ref="overlayRootRef" :class="bem('host')">
      <div ref="editorViewHostRef" class="b-markdown-source__codemirror"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file PaneSourceEditor.vue
 * @description Source 模式 CodeMirror 编辑器窗格，集成选区工具适配器。
 */
import type { SelectionAssistantAdapter } from '../adapters/selectionAssistant';
import type { EditorController, EditorSearchState, EditorSelection as EditorSelectionRange } from '../adapters/types';
import type { EditorState } from '../types';
import type { Extension } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo as codemirrorRedo,
  redoDepth,
  undo as codemirrorUndo,
  undoDepth
} from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorSelection, EditorState as CodeMirrorEditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { useEventListener } from '@vueuse/core';
import { createNamespace } from '@/utils/namespace';
import { getRenderedSourceAnchorOffsetTop } from '../adapters/sourceEditorAnchorScroll';
import { createSourceCodeBlockHighlightExtension } from '../adapters/sourceEditorCodeBlockHighlight';
import { createSourceEditorDrawSelectionExtension } from '../adapters/sourceEditorDrawSelection';
import { createSourceHeadingAnchorExtension, getSourceActiveHeadingId, getSourceHeadingLines } from '../adapters/sourceEditorHeadingAnchors';
import { createSourceEditorLayoutTheme } from '../adapters/sourceEditorLayoutTheme';
import { createSourceEditorMarkdownHighlightExtension } from '../adapters/sourceEditorMarkdownHighlight';
import {
  clearSourceEditorSearch,
  createSourceEditorSearchExtension,
  findNextSourceEditorMatch,
  findPreviousSourceEditorMatch,
  getSourceEditorSearchState,
  setSourceEditorSearchTerm
} from '../adapters/sourceEditorSearch';
import { createSourceSelectionAssistantAdapter, createSourceSelectionHighlightExtension } from '../adapters/sourceSelectionAssistant';
import { createSourceInlineCompletionAdapter, createSourceInlineCompletionExtension } from '../extensions/sourceInlineCompletion';
import { createSourceSelectAllKeymap } from '../extensions/sourceSelectAll';
import { useFrontMatter } from '../hooks/useFrontMatter';
import { useInlineCompletion } from '../hooks/useInlineCompletion';

const [name, bem] = createNamespace('', 'b-markdown-source');

/**
 * 空函数占位，供事件解绑时复用稳定引用。
 */
function noop(): void {
  // noop
}

/**
 * Source 模式回传给宿主的选区工具状态。
 */
interface SourceSelectionHostPayload {
  /** 当前浮层根节点 */
  overlayRoot: HTMLElement | null;
  /** 当前选区适配器 */
  adapter: SelectionAssistantAdapter | null;
}

interface Props {
  editorId?: string;
  editable?: boolean;
  editorState?: EditorState;
  onAnchorScroll?: (hostElement: HTMLElement, offsetTop: number) => void;
  /** 将选区工具宿主状态回传给上层统一编排 */
  onSelectionHostChange?: (payload: SourceSelectionHostPayload | null) => void;
  /** 请求上层重算选区浮层位置 */
  onSelectionOverlayChange?: () => void;
}

const props = withDefaults(defineProps<Props>(), {
  editorId: '',
  editable: true,
  editorState: () => ({ content: '', name: '', path: null, id: '', ext: '' }),
  onAnchorScroll: undefined,
  onSelectionHostChange: undefined,
  onSelectionOverlayChange: undefined
});
const emit = defineEmits<{
  /**
   * 编辑器根区域发生失焦事件。
   */
  (e: 'editor-blur', event: FocusEvent): void;
}>();

const editorContent = defineModel<string>('value', { default: '' });
const outlineContent = defineModel<string>('outlineContent', { default: '' });
const overlayRootRef = ref<HTMLElement | null>(null);
const editorViewHostRef = ref<HTMLDivElement | null>(null);
const editorView = shallowRef<EditorView | null>(null);
const editableCompartment = new Compartment();
const headingAnchorCompartment = new Compartment();
const { bodyContent } = useFrontMatter(editorContent);

const adapter = shallowRef<SelectionAssistantAdapter | null>(null);
const paneInlineCompletion = useInlineCompletion();
let cleanupSelectionOverlayPosition: (() => void) | null = null;

/**
 * 将编辑区 focusout 事件统一转发给外层容器做语义过滤。
 * @param event - 当前失焦事件
 */
function handleEditorFocusOut(event: FocusEvent): void {
  emit('editor-blur', event);
}

function createEditableExtension(editable: boolean): Extension {
  return EditorView.editable.of(editable);
}

function createEditorExtensions(): Extension[] {
  return [
    history(),
    markdown(),
    createSourceEditorMarkdownHighlightExtension(),
    createSourceCodeBlockHighlightExtension(),
    createSourceEditorSearchExtension(),
    keymap.of([indentWithTab, ...createSourceSelectAllKeymap(), ...defaultKeymap, ...historyKeymap]),
    createSourceEditorLayoutTheme(),
    headingAnchorCompartment.of(createSourceHeadingAnchorExtension(props.editorId)),
    placeholder('请输入内容'),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'false' }),
    editableCompartment.of(createEditableExtension(props.editable)),
    createSourceInlineCompletionExtension(),
    EditorView.updateListener.of((update: ViewUpdate): void => {
      if (!update.docChanged) {
        return;
      }

      const nextContent = update.state.doc.toString();
      if (nextContent !== editorContent.value) {
        editorContent.value = nextContent;
      }
    }),
    createSourceEditorDrawSelectionExtension(),
    createSourceSelectionHighlightExtension()
  ];
}

/**
 * 挂载 Source pane 内联补全。
 * @param view - 当前 CodeMirror 视图
 */
function mountInlineCompletion(view: EditorView): void {
  paneInlineCompletion.mount({
    adapter: createSourceInlineCompletionAdapter(view, () => props.editable === true),
    editorState: () => props.editorState
  });
}

function getView(): EditorView | null {
  return editorView.value;
}

function focusEditor(): void {
  getView()?.focus();
}

function focusEditorAtStart(): void {
  const view = getView();
  if (!view) {
    return;
  }

  view.dispatch({
    selection: EditorSelection.cursor(0),
    scrollIntoView: true
  });
  view.focus();
}

function undo(): void {
  const view = getView();
  if (view) {
    codemirrorUndo(view);
  }
}

function redo(): void {
  const view = getView();
  if (view) {
    codemirrorRedo(view);
  }
}

function canUndo(): boolean {
  const view = getView();
  return view ? undoDepth(view.state) > 0 : false;
}

function canRedo(): boolean {
  const view = getView();
  return view ? redoDepth(view.state) > 0 : false;
}

function setSearchTerm(term: string): void {
  const view = getView();
  if (view) {
    setSourceEditorSearchTerm(view, term);
  }
}

function findNext(): void {
  const view = getView();
  if (view) {
    findNextSourceEditorMatch(view);
  }
}

function findPrevious(): void {
  const view = getView();
  if (view) {
    findPreviousSourceEditorMatch(view);
  }
}

function clearSearch(): void {
  const view = getView();
  if (view) {
    clearSourceEditorSearch(view);
  }
}

function getSelection(): EditorSelectionRange | null {
  const view = getView();
  if (!view) {
    return null;
  }

  const selection = view.state.selection.main;
  if (selection.from === selection.to) {
    return null;
  }

  return {
    from: selection.from,
    to: selection.to,
    text: view.state.sliceDoc(selection.from, selection.to)
  };
}

async function insertAtCursor(content: string): Promise<void> {
  const view = getView();
  if (!view) {
    return;
  }

  const selection = view.state.selection.main;
  const nextPosition = selection.from + content.length;

  view.dispatch({
    changes: {
      from: selection.from,
      to: selection.to,
      insert: content
    },
    selection: EditorSelection.cursor(nextPosition),
    scrollIntoView: true
  });
  view.focus();
}

async function replaceSelection(content: string): Promise<void> {
  const view = getView();
  if (!view) {
    return;
  }

  const selection = view.state.selection.main;
  if (selection.from === selection.to) {
    throw new Error('NO_SELECTION');
  }

  const nextPosition = selection.from + content.length;

  view.dispatch({
    changes: {
      from: selection.from,
      to: selection.to,
      insert: content
    },
    selection: EditorSelection.cursor(nextPosition),
    scrollIntoView: true
  });
  view.focus();
}

async function replaceDocument(content: string): Promise<void> {
  const view = getView();
  if (!view) {
    return;
  }

  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: content
    },
    selection: EditorSelection.cursor(content.length),
    scrollIntoView: true
  });
  view.focus();
}

function getSearchState(): EditorSearchState {
  const view = getView();
  return view ? getSourceEditorSearchState(view.state) : { currentIndex: 0, matchCount: 0, term: '' };
}

/**
 * 按源码行号选中并滚动到对应范围。
 * @param startLine - 起始行号（1-based）
 * @param endLine - 结束行号（1-based）
 * @returns 是否成功设置选区
 */
function selectLineRange(startLine: number, endLine: number): boolean {
  const view = getView();
  if (!view) {
    return false;
  }

  const totalLines = view.state.doc.lines;
  const safeStartLine = Math.min(Math.max(1, startLine), totalLines);
  const safeEndLine = Math.min(Math.max(safeStartLine, endLine), totalLines);
  const fromLine = view.state.doc.line(safeStartLine);
  const toLine = view.state.doc.line(safeEndLine);
  const selectionRange = {
    from: fromLine.from,
    to: toLine.to,
    text: view.state.sliceDoc(fromLine.from, toLine.to)
  };

  view.dispatch({
    selection: EditorSelection.range(selectionRange.from, selectionRange.to),
    scrollIntoView: true
  });
  adapter.value?.showSelectionHighlight(selectionRange);
  view.focus();
  return true;
}

function scrollHostToAnchor(hostElement: HTMLElement, anchorId: string, fallbackOffsetTop: number): void {
  props.onAnchorScroll?.(hostElement, getRenderedSourceAnchorOffsetTop(hostElement, anchorId) ?? fallbackOffsetTop);
}

function scrollToAnchor(anchorId: string): boolean {
  const view = getView();
  const hostElement = overlayRootRef.value;
  if (!view || !hostElement) {
    return false;
  }

  const heading = getSourceHeadingLines(view.state.doc.toString(), props.editorId).find((item) => item.id === anchorId);
  if (!heading) {
    return false;
  }

  const lineBlock = view.lineBlockAt(heading.from);
  scrollHostToAnchor(hostElement, anchorId, lineBlock.top);
  view.dispatch({
    selection: EditorSelection.cursor(heading.from),
    effects: EditorView.scrollIntoView(heading.from, { y: 'start', yMargin: 0 })
  });
  requestAnimationFrame((): void => {
    scrollHostToAnchor(hostElement, anchorId, lineBlock.top);
  });
  view.focus();

  return true;
}

function getActiveAnchorId(scrollContainer: HTMLElement, thresholdPx: number): string {
  const view = getView();
  const hostElement = overlayRootRef.value;
  if (!view || !hostElement) {
    return '';
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const hostRect = hostElement.getBoundingClientRect();
  const offsetTop = Math.max(0, thresholdPx - (hostRect.top - containerRect.top));
  const lineBlock = view.lineBlockAtHeight(offsetTop);

  return getSourceActiveHeadingId(view.state.doc.toString(), props.editorId, lineBlock.from);
}

watch(editorContent, (nextContent: string): void => {
  const view = getView();
  if (!view) {
    return;
  }

  const currentContent = view.state.doc.toString();
  if (nextContent === currentContent) {
    return;
  }

  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: nextContent
    }
  });
});

watch(
  bodyContent,
  (content: string): void => {
    outlineContent.value = content;
  },
  { immediate: true }
);

watch(
  () => props.editable,
  (editable: boolean): void => {
    const view = getView();
    if (!view) {
      return;
    }

    view.dispatch({
      effects: editableCompartment.reconfigure(createEditableExtension(editable))
    });
    paneInlineCompletion.destroy();
    if (editable) {
      mountInlineCompletion(view);
    }
  }
);

watch(
  () => props.editorId,
  (editorId: string): void => {
    const view = getView();
    if (!view) {
      return;
    }

    view.dispatch({
      effects: headingAnchorCompartment.reconfigure(createSourceHeadingAnchorExtension(editorId))
    });
  }
);

onMounted((): void => {
  const parent = editorViewHostRef.value;
  const overlayRoot = overlayRootRef.value;
  if (!parent || !overlayRoot) {
    return;
  }

  editorView.value = new EditorView({
    parent,
    state: CodeMirrorEditorState.create({
      doc: editorContent.value,
      extensions: createEditorExtensions()
    })
  });
  cleanupSelectionOverlayPosition = (): void => {
    editorView.value?.scrollDOM.removeEventListener('scroll', props.onSelectionOverlayChange ?? noop);
    window.removeEventListener('scroll', props.onSelectionOverlayChange ?? noop);
  };
  editorView.value.scrollDOM.addEventListener('scroll', props.onSelectionOverlayChange ?? noop);
  // 页面级滚动（CodeMirror scroller 设为 overflow:visible 时 scrollDOM 不滚动，需监听 window）
  window.addEventListener('scroll', props.onSelectionOverlayChange ?? noop);

  // 创建 source adapter，注入文件上下文与浮层根容器
  adapter.value = createSourceSelectionAssistantAdapter(
    editorView.value,
    {
      editorState: props.editorState,
      overlayRoot
    },
    () => props.editable
  );
  props.onSelectionHostChange?.({
    overlayRoot,
    adapter: adapter.value
  });

  if (props.editable) {
    mountInlineCompletion(editorView.value);
  }
});

onBeforeUnmount((): void => {
  paneInlineCompletion.destroy();
  props.onSelectionHostChange?.(null);
  cleanupSelectionOverlayPosition?.();
  cleanupSelectionOverlayPosition = null;
  adapter.value?.dispose?.();
  adapter.value = null;
  editorView.value?.destroy();
  editorView.value = null;
});

useEventListener(window, 'resize', () => {
  props.onSelectionOverlayChange?.();
});

const controller: EditorController = {
  undo,
  redo,
  canUndo,
  canRedo,
  focusEditor,
  focusEditorAtStart,
  setSearchTerm,
  findNext,
  findPrevious,
  clearSearch,
  getSelection,
  insertAtCursor,
  replaceSelection,
  replaceDocument,
  selectLineRange,
  getSearchState,
  scrollToAnchor,
  getActiveAnchorId
};

defineExpose(controller);
</script>

<style lang="less">
.b-markdown-source {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.b-markdown-source__host {
  position: relative;
  min-height: 100%;
}

.b-markdown-source__codemirror {
  width: 100%;

  .cm-editor {
    min-height: calc(100vh - 44px);
    padding: 20px 40px 90px;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    color: var(--source-editor-markdown-foreground);
    background: transparent;
  }

  .cm-focused {
    outline: none;
  }

  .cm-scroller {
    overflow: visible;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    line-height: 1.74;
    background: transparent;
  }

  .cm-content {
    min-height: 100%;
    padding: 0;
    caret-color: var(--source-editor-markdown-caret);
  }

  .cm-line {
    padding: 0;
  }

  .cm-gutters {
    color: var(--source-editor-markdown-gutter-foreground);
    background: transparent;
    border-right: 0;
  }

  .cm-lineNumbers .cm-gutterElement {
    padding: 0 12px 0 0;
  }

  .cm-selectionMatch {
    background: var(--source-editor-markdown-selection-match);
  }

  .search-match {
    background: var(--editor-search-highlight);
  }

  .search-match-current {
    background: var(--editor-search-active);
    box-shadow: var(--editor-search-active-border);
  }

  .cm-activeLine {
    background: var(--source-editor-markdown-line-highlight);
  }

  .b-markdown-source__ai-highlight {
    color: var(--selection-color);
    background: var(--selection-bg);
    box-shadow: 0 0.2em 0 0 var(--selection-bg), 0 -0.2em 0 0 var(--selection-bg);
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;

    // 覆盖 Markdown 语法 token 的显式颜色，确保 AI 高亮范围内统一显示选区前景色。
    &,
    & * {
      color: var(--selection-color) !important;
    }
  }

  .cm-placeholder {
    color: var(--editor-placeholder);
  }

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

  .hljs-function,
  .hljs-title {
    color: var(--code-function);
  }

  .hljs-params {
    color: var(--code-text);
  }

  .hljs-variable,
  .hljs-property {
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

  .hljs-built_in {
    color: var(--code-builtin);
  }

  .hljs-class {
    color: var(--code-class);
  }

  .hljs-constant {
    color: var(--code-constant);
  }

  .md-heading-marker {
    font-weight: bold;
    color: var(--source-editor-markdown-heading-1);
  }

  .md-bold {
    font-weight: bold;
    color: var(--source-editor-markdown-bold);
  }

  .md-italic {
    font-style: italic;
    color: var(--source-editor-markdown-italic);
  }

  .md-strikethrough {
    color: var(--source-editor-markdown-strikethrough);
    text-decoration: line-through;
  }

  .md-code-marker,
  .md-code-fence {
    color: var(--source-editor-markdown-code-fence);
  }

  .md-code-info {
    color: var(--source-editor-markdown-code-info);
  }

  .md-blockquote-marker {
    color: var(--source-editor-markdown-blockquote-marker);
  }

  .md-list-marker,
  .md-list-number {
    color: var(--source-editor-markdown-list-marker);
  }

  .md-hr {
    color: var(--source-editor-markdown-hr);
  }

  .md-link-bracket {
    color: var(--source-editor-markdown-link-bracket);
  }

  .md-link-paren {
    color: var(--source-editor-markdown-link-paren);
  }

  .md-image-marker {
    color: var(--source-editor-markdown-image-marker);
  }

  .md-table-pipe {
    color: var(--source-editor-markdown-table-pipe);
  }

  .md-table-align {
    color: var(--source-editor-markdown-table-align);
  }

  .md-task-bracket {
    color: var(--source-editor-markdown-task-bracket);
  }

  .md-task-unchecked {
    color: var(--source-editor-markdown-task-unchecked);
  }

  .md-task-checked {
    color: var(--source-editor-markdown-task-checked);
  }

  .md-escape {
    color: var(--source-editor-markdown-escape);
  }

  .md-comment-bracket {
    color: var(--source-editor-markdown-link-bracket);
  }

  .md-comment-attr {
    color: var(--source-editor-markdown-escape);
  }
}

.b-markdown-source__inline-completion-ghost {
  color: var(--editor-placeholder);
  pointer-events: none;
  user-select: none;
}
</style>
