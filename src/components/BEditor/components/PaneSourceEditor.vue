<template>
  <div class="source-editor-pane">
    <div ref="overlayRootRef" class="source-editor-content-host">
      <div ref="editorViewHostRef" class="source-editor-codemirror"></div>
      <SelectionToolbarSource
        :visible="assistant.toolbarVisible.value"
        :position="assistant.toolbarPosition.value"
        :overlay-root="overlayRootRef"
        :format-buttons="[]"
        @ai="assistant.openAIInput()"
        @reference="assistant.insertReference()"
      />
      <SelectionAIInput
        :visible="assistant.aiInputVisible.value"
        :adapter="adapter"
        :selection-range="assistant.cachedSelectionRange.value"
        :position="assistant.panelPosition.value"
        @update:visible="onAIInputVisibleChange"
        @apply="assistant.applyAIResult($event)"
        @streaming-change="assistant.setStreaming($event)"
      />
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
import type { EditorState as BEditorState } from '../types';
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
import { Compartment, EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { useEventListener } from '@vueuse/core';
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
import { useFrontMatter } from '../hooks/useFrontMatter';
import { useSelectionAssistant } from '../hooks/useSelectionAssistant';
import SelectionAIInput from './SelectionAIInput.vue';
import SelectionToolbarSource from './SelectionToolbarSource.vue';

interface Props {
  editorId?: string;
  editable?: boolean;
  editorState?: BEditorState;
  onAnchorScroll?: (hostElement: HTMLElement, offsetTop: number) => void;
}

const props = withDefaults(defineProps<Props>(), {
  editorId: '',
  editable: true,
  editorState: () => ({ content: '', name: '', path: null, id: '', ext: '' }),
  onAnchorScroll: undefined
});

const editorContent = defineModel<string>('value', { default: '' });
const outlineContent = defineModel<string>('outlineContent', { default: '' });
const overlayRootRef = ref<HTMLElement | null>(null);
const editorViewHostRef = ref<HTMLDivElement | null>(null);
const editorView = shallowRef<EditorView | null>(null);
const editableCompartment = new Compartment();
const headingAnchorCompartment = new Compartment();
const { bodyContent } = useFrontMatter(editorContent);

const adapter = shallowRef<SelectionAssistantAdapter | null>(null);

const assistant = useSelectionAssistant({
  adapter: () => adapter.value,
  isEditable: () => props.editable
});
let cleanupSelectionOverlayPosition: (() => void) | null = null;

/**
 * 同步 AI 面板显隐到统一编排层。
 * @param visible - 面板是否可见
 */
function onAIInputVisibleChange(visible: boolean): void {
  if (!visible) {
    assistant.closeAIInput();
  }
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
    keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
    createSourceEditorLayoutTheme(),
    headingAnchorCompartment.of(createSourceHeadingAnchorExtension(props.editorId)),
    placeholder('请输入内容'),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'false' }),
    editableCompartment.of(createEditableExtension(props.editable)),
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
    state: EditorState.create({
      doc: editorContent.value,
      extensions: createEditorExtensions()
    })
  });
  cleanupSelectionOverlayPosition = (): void => {
    editorView.value?.scrollDOM.removeEventListener('scroll', assistant.recomputeAllPositions);
  };
  editorView.value.scrollDOM.addEventListener('scroll', assistant.recomputeAllPositions);

  // 创建 source adapter，注入文件上下文与浮层根容器
  adapter.value = createSourceSelectionAssistantAdapter(
    editorView.value,
    {
      editorState: props.editorState,
      overlayRoot
    },
    () => props.editable
  );
});

onBeforeUnmount((): void => {
  cleanupSelectionOverlayPosition?.();
  cleanupSelectionOverlayPosition = null;
  adapter.value?.dispose?.();
  adapter.value = null;
  editorView.value?.destroy();
  editorView.value = null;
});

useEventListener(window, 'resize', () => {
  assistant.recomputeAllPositions();
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
  getSearchState,
  scrollToAnchor,
  getActiveAnchorId
};

defineExpose(controller);
</script>

<style lang="less">
.source-editor-pane {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.source-editor-content-host {
  position: relative;
  min-height: 100%;
}

.source-editor-codemirror {
  width: 100%;
  min-height: 100%;

  .cm-editor {
    min-height: 100%;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    color: var(--source-editor-markdown-foreground);
    background-color: transparent;
  }

  .cm-focused {
    outline: none;
  }

  .cm-scroller {
    overflow: visible;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    line-height: 1.74;
    background-color: transparent;
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
    background-color: transparent;
    border-right: 0;
  }

  .cm-lineNumbers .cm-gutterElement {
    padding: 0 12px 0 0;
  }

  .cm-selectionMatch {
    background-color: var(--source-editor-markdown-selection-match);
  }

  .search-match {
    background: var(--editor-search-highlight);
  }

  .search-match-current {
    background: var(--editor-search-active);
    box-shadow: var(--editor-search-active-border);
  }

  .cm-activeLine {
    background-color: var(--source-editor-markdown-line-highlight);
  }

  .source-ai-selection-highlight {
    color: var(--selection-color);
    background: var(--selection-bg);
    box-shadow: 0 0.2em 0 0 var(--selection-bg), 0 -0.2em 0 0 var(--selection-bg);
    -webkit-box-decoration-break: clone;
    box-decoration-break: clone;
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
}
</style>
