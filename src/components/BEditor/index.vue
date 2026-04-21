<template>
  <div ref="layoutRef" class="b-editor-layout">
    <BEditorSidebar
      v-if="showOutline"
      :title="editorTitle"
      :file-path="props.filePath"
      :content="outlineContent"
      :anchor-id-prefix="props.editorId"
      :active-id="activeAnchorId"
      @change="handleEditorAnchorChange"
      @rename-file="emit('rename-file')"
      @save="emit('save')"
      @save-as="emit('save-as')"
      @copy-path="emit('copy-path')"
      @copy-relative-path="emit('copy-relative-path')"
      @show-in-folder="emit('show-in-folder')"
    />

    <BScrollbar ref="scrollbarRef" class="b-editor-scrollbar" @scroll="handleEditorScrollEvent">
      <div class="b-editor-container">
        <RichEditorHost
          v-if="isRichMode"
          ref="richEditorPaneRef"
          v-model:value="editorContent"
          v-model:outline-content="outlineContent"
          :editor-id="props.editorId"
          :editable="props.editable"
          :on-search-match-element-focus="scrollSearchMatchElementIntoView"
        />

        <PaneSourceEditor
          v-else
          ref="sourceEditorPaneRef"
          v-model:value="editorContent"
          v-model:outline-content="outlineContent"
          :editor-id="props.editorId"
          :on-anchor-scroll="scrollSourceAnchorIntoView"
          :editable="props.editable"
        />
      </div>

      <FindBar v-model:visible="findBarVisible" :editor-instance="editorPublicInstance" />
    </BScrollbar>
  </div>
</template>

<script setup lang="ts">
import type { BEditorPublicInstance, EditorController, EditorSearchState } from './adapters/types';
import type { AnchorRecord } from './hooks/useAnchors';
import type { BEditorViewMode } from './types';
import { computed, defineAsyncComponent, ref } from 'vue';
import BScrollbar from '@/components/BScrollbar/index.vue';
import { handleEditorAnchorNavigation } from './adapters/editorAnchorNavigation';
import FindBar from './components/FindBar.vue';
import { useAnchors } from './hooks/useAnchors';
import { useEditorController } from './hooks/useEditorController';

const RichEditorHost = defineAsyncComponent(() => import('./components/RichEditorHost.vue'));
const PaneSourceEditor = defineAsyncComponent(() => import('./components/PaneSourceEditor.vue'));

const layoutRef = ref<HTMLElement | null>(null);
const scrollbarRef = ref<InstanceType<typeof BScrollbar> | null>(null);

interface Props {
  editable?: boolean;
  // 编辑器实例ID
  editorId?: string;
  // 文件路径
  filePath?: string | null;
  // 编辑器视图模式
  viewMode?: BEditorViewMode;
  // 是否显示大纲
  showOutline?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editable: true,
  // 编辑器实例ID
  editorId: '',
  filePath: null,
  viewMode: 'rich',
  showOutline: true
});

const emit = defineEmits(['rename-file', 'save', 'save-as', 'copy-path', 'copy-relative-path', 'show-in-folder']);

const isRichMode = computed<boolean>(() => props.viewMode === 'rich');

const editorContent = defineModel<string>('value', { default: '' });

const editorTitle = defineModel<string>('title', { default: '' });
const outlineContent = defineModel<string>('outlineContent', { default: '' });

const richEditorPaneRef = ref<EditorController | null>(null);
const sourceEditorPaneRef = ref<EditorController | null>(null);
const findBarVisible = ref(false);

const { activeAnchorId, handleChangeAnchor, handleEditorScroll, setActiveAnchorId } = useAnchors(layoutRef, scrollbarRef);

function scrollSearchMatchElementIntoView(targetElement: HTMLElement): void {
  const scrollElement = scrollbarRef.value?.getScrollElement();
  if (!scrollElement) {
    targetElement.scrollIntoView({ block: 'center', inline: 'nearest' });
    return;
  }

  const scrollRect = scrollElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  const centeredTop = scrollElement.scrollTop + (targetRect.top - scrollRect.top) - (scrollElement.clientHeight - targetRect.height) / 2;
  const maxScrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
  const nextTop = Math.min(Math.max(centeredTop, 0), maxScrollTop);

  scrollbarRef.value?.scrollTo({ top: nextTop, behavior: 'auto' });
}

const editorController = useEditorController({ isRichMode, richEditorPaneRef, sourceEditorPaneRef });

function scrollSourceAnchorIntoView(hostElement: HTMLElement, offsetTop: number) {
  const scrollElement = scrollbarRef.value?.getScrollElement();
  if (!scrollElement) {
    hostElement.scrollIntoView({ block: 'start' });
    return;
  }

  const scrollRect = scrollElement.getBoundingClientRect();
  const hostRect = hostElement.getBoundingClientRect();
  const nextTop = scrollElement.scrollTop + (hostRect.top - scrollRect.top) + offsetTop;

  scrollbarRef.value?.scrollTo({ top: Math.max(0, nextTop), behavior: 'auto' });
}

function handleEditorAnchorChange(record: AnchorRecord) {
  handleEditorAnchorNavigation({
    record,
    isRichMode: isRichMode.value,
    setActiveAnchorId,
    scrollToTop: () => scrollbarRef.value?.scrollTo({ top: 0, behavior: 'auto' }),
    scrollRichAnchor: handleChangeAnchor,
    scrollEditorAnchor: editorController.value.scrollToAnchor
  });
}

function handleEditorScrollEvent() {
  if (isRichMode.value) {
    handleEditorScroll();
    return;
  }

  const scrollElement = scrollbarRef.value?.getScrollElement();
  if (!scrollElement) {
    return;
  }

  if (scrollElement.scrollTop < 50) {
    setActiveAnchorId('');
    return;
  }

  setActiveAnchorId(editorController.value.getActiveAnchorId(scrollElement, 100));
}

function setContent(text: string): void {
  editorContent.value = text;
}

function undo(): void {
  editorController.value.undo();
}

function redo(): void {
  editorController.value.redo();
}

function canUndo(): boolean {
  return editorController.value.canUndo();
}

function canRedo(): boolean {
  return editorController.value.canRedo();
}

function setSearchTerm(term: string): void {
  editorController.value.setSearchTerm(term);
}

function findNext(): void {
  editorController.value.findNext();
}

function findPrevious(): void {
  editorController.value.findPrevious();
}

function clearSearch(): void {
  editorController.value.clearSearch();
}

function getSelection() {
  return editorController.value.getSelection();
}

async function insertAtCursor(content: string): Promise<void> {
  await editorController.value.insertAtCursor(content);
}

async function replaceSelection(content: string): Promise<void> {
  await editorController.value.replaceSelection(content);
}

async function replaceDocument(content: string): Promise<void> {
  await editorController.value.replaceDocument(content);
}

function focusEditor(): void {
  editorController.value.focusEditor();
}

function getSearchState(): EditorSearchState {
  return editorController.value.getSearchState();
}

const editorPublicInstance = computed<BEditorPublicInstance>(() => ({
  undo,
  redo,
  canUndo,
  canRedo,
  focusEditor,
  getSelection,
  insertAtCursor,
  replaceSelection,
  replaceDocument,
  setSearchTerm,
  findNext,
  findPrevious,
  clearSearch,
  getSearchState
}));

defineExpose({
  setContent,
  undo,
  redo,
  canUndo,
  canRedo,
  setSearchTerm,
  findNext,
  findPrevious,
  clearSearch,
  focusEditor,
  getSelection,
  insertAtCursor,
  replaceSelection,
  replaceDocument,
  getSearchState
});
</script>

<style lang="less">
.b-editor-layout {
  display: flex;
  gap: 6px;
  height: 100%;

  --selection-color: #fff;
  --selection-bg: #ff6b6b;

  ::selection {
    color: var(--selection-color);
    background: var(--selection-bg);
  }
}

.b-editor-scrollbar {
  flex: 1;
  width: 0;
  background: var(--bg-primary);
  border-radius: 8px;
}

.b-editor-container {
  position: relative;
  max-width: 900px;
  padding: 20px 40px 90px;
  margin: 0 auto;
  font-size: 16px;
}

.b-editor-title {
  display: block;
  width: 100%;
  padding: 20px 40px 0;
  margin: 0;
  font-size: 28px;
  font-weight: 600;
  color: var(--editor-text);
  cursor: text;
  resize: none;
  outline: none;
  background: transparent;
  border: none;

  &::placeholder {
    font-weight: 600;
    color: var(--editor-placeholder);
  }
}
</style>
