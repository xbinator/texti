<template>
  <div class="source-editor-pane">
    <div ref="editorHostRef" class="source-editor-codemirror"></div>
  </div>
</template>

<script setup lang="ts">
import type { EditorController, EditorSearchState } from '../adapters/types';
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
import { noop } from 'lodash-es';
import { getRenderedSourceAnchorOffsetTop } from '../adapters/sourceEditorAnchorScroll';
import { createSourceCodeBlockHighlightExtension } from '../adapters/sourceEditorCodeBlockHighlight';
import { createSourceHeadingAnchorExtension, getSourceActiveHeadingId, getSourceHeadingLines } from '../adapters/sourceEditorHeadingAnchors';
import { createSourceEditorLayoutTheme } from '../adapters/sourceEditorLayoutTheme';
import { useFrontMatter } from '../hooks/useFrontMatter';

interface Props {
  editorId?: string;
  editable?: boolean;
  onAnchorScroll?: (hostElement: HTMLElement, offsetTop: number) => void;
}

const props = withDefaults(defineProps<Props>(), {
  editorId: '',
  editable: true,
  onAnchorScroll: undefined
});

const editorContent = defineModel<string>('value', { default: '' });
const outlineContent = defineModel<string>('outlineContent', { default: '' });
const editorHostRef = ref<HTMLDivElement | null>(null);
const editorView = shallowRef<EditorView | null>(null);
const editableCompartment = new Compartment();
const headingAnchorCompartment = new Compartment();
const { bodyContent } = useFrontMatter(editorContent);

const emptySearchState: EditorSearchState = {
  currentIndex: 0,
  matchCount: 0,
  term: ''
};

function createEditableExtension(editable: boolean): Extension {
  return EditorView.editable.of(editable);
}

function createEditorExtensions(): Extension[] {
  return [
    history(),
    markdown(),
    createSourceCodeBlockHighlightExtension(),
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
    })
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

const setSearchTerm = noop;
const findNext = noop;
const findPrevious = noop;
const clearSearch = noop;

function getSearchState(): EditorSearchState {
  return { ...emptySearchState };
}

function scrollHostToAnchor(hostElement: HTMLElement, anchorId: string, fallbackOffsetTop: number): void {
  props.onAnchorScroll?.(hostElement, getRenderedSourceAnchorOffsetTop(hostElement, anchorId) ?? fallbackOffsetTop);
}

function scrollToAnchor(anchorId: string): boolean {
  const view = getView();
  const hostElement = editorHostRef.value;
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
  const hostElement = editorHostRef.value;
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
  const parent = editorHostRef.value;
  if (!parent) {
    return;
  }

  editorView.value = new EditorView({
    parent,
    state: EditorState.create({
      doc: editorContent.value,
      extensions: createEditorExtensions()
    })
  });
});

onBeforeUnmount((): void => {
  editorView.value?.destroy();
  editorView.value = null;
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

.source-editor-codemirror {
  width: 100%;
  min-height: 100%;

  .cm-editor {
    min-height: 100%;
    font: inherit;
    color: var(--source-editor-markdown-foreground);
    background-color: transparent;
  }

  .cm-focused {
    outline: none;
  }

  .cm-scroller {
    overflow: visible;
    font: inherit;
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

  .cm-selectionBackground,
  .cm-focused .cm-selectionBackground,
  ::selection {
    background-color: var(--source-editor-markdown-selection);
  }

  .cm-selectionMatch {
    background-color: var(--source-editor-markdown-selection-match);
  }

  .cm-activeLine {
    background-color: var(--source-editor-markdown-line-highlight);
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
}
</style>
