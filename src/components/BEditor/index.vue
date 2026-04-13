<template>
  <div ref="layoutRef" class="b-editor-layout">
    <BEditorSidebar
      v-if="showSidebar"
      :title="editorTitle"
      :content="bodyContentForSidebar"
      :anchor-id-prefix="editorInstanceId"
      :active-id="activeAnchorId"
      @change="handleChangeAnchor"
    />

    <BScrollbar ref="scrollbarRef" class="b-editor-scrollbar" @scroll="handleEditorScroll">
      <div ref="containerRef" class="b-editor-container">
        <RichEditorPane
          v-if="isRichMode"
          ref="richEditorPaneRef"
          v-model:front-matter-data="frontMatterModel"
          :editor="editorInstance"
          :editor-id="props.editorId"
          :should-show-front-matter-card="shouldShowFrontMatterCard"
        />

        <SourceEditorPane v-else ref="sourceEditorPaneRef" v-model:value="editorContent" />
      </div>
    </BScrollbar>
  </div>
</template>

<script setup lang="ts">
import type { EditorController } from './hooks/useEditorController';
import type { FrontMatterData } from './hooks/useFrontMatter';
import type { BEditorViewMode } from './types';
import { computed, ref, toRef } from 'vue';
import { useTextareaAutosize } from '@vueuse/core';
import BScrollbar from '@/components/BScrollbar/index.vue';
import RichEditorPane from './components/RichEditorPane.vue';
import SourceEditorPane from './components/SourceEditorPane.vue';
import { getSearchSnapshot, type SearchScrollContext, type SearchSnapshot } from './extensions/Search';
import { useAnchors } from './hooks/useAnchors';
import { useEditorController } from './hooks/useEditorController';
import { useFrontMatter } from './hooks/useFrontMatter';
import { useRichEditor } from './hooks/useRichEditor';

const editorInstanceCounter = ref(0);

const layoutRef = ref<HTMLElement | null>(null);
const scrollbarRef = ref<InstanceType<typeof BScrollbar> | null>(null);
const titleTextareaRef = ref<HTMLTextAreaElement | null>(null);

interface Props {
  editable?: boolean;
  // 编辑器实例ID
  editorId?: string;
  // 编辑器视图模式
  viewMode?: BEditorViewMode;
  // 是否显示大纲
  showOutline?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  editable: true,
  // 编辑器实例ID
  editorId: '',
  viewMode: 'rich',
  showOutline: true
});

const editorInstanceId = computed(() => `${props.editorId || ''}`);
const isRichMode = computed(() => props.viewMode === 'rich');
const showSidebar = computed(() => isRichMode.value && props.showOutline);

const editorContent = defineModel<string>('value', { default: '' });

const editorTitle = defineModel<string>('title', { default: '' });

const richEditorPaneRef = ref<EditorController | null>(null);
const sourceEditorPaneRef = ref<Pick<EditorController, 'focusEditor' | 'focusEditorAtStart'> | null>(null);

const { activeAnchorId, handleChangeAnchor, handleEditorScroll } = useAnchors(layoutRef, scrollbarRef);

const { bodyContent, frontMatterData, hasFrontMatter, updateFrontMatter, reconstructContent } = useFrontMatter(editorContent);

const bodyContentForSidebar = computed(() => bodyContent.value);
const shouldShowFrontMatterCard = computed(() => Boolean(hasFrontMatter.value));

function syncToExternal(): void {
  editorContent.value = reconstructContent();
}

const frontMatterModel = computed<FrontMatterData>({
  get(): FrontMatterData {
    return frontMatterData.value;
  },
  set(data: FrontMatterData): void {
    updateFrontMatter(data);
    syncToExternal();
  }
});

function scrollSearchMatchIntoView({ targetElement }: SearchScrollContext): void {
  if (!(targetElement instanceof HTMLElement)) {
    return;
  }

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

const { editorInstance, setContent: setRichEditorContent } = useRichEditor({
  bodyContent,
  editable: toRef(props, 'editable'),
  editorInstanceId,
  onContentChange: syncToExternal,
  onSearchMatchFocus: scrollSearchMatchIntoView
});

const editorController = useEditorController({ isRichMode, richEditorPaneRef, sourceEditorPaneRef });

function setContent(text: string): void {
  editorInstanceCounter.value += 1;

  setRichEditorContent(text);
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
  if (!isRichMode.value) return;

  const commands = editorInstance.value?.commands;
  commands?.setSearchTerm?.(term);
}

function findNext() {
  if (!isRichMode.value) return;

  const commands = editorInstance.value?.commands;
  commands?.findNext?.();
}

function findPrevious() {
  if (!isRichMode.value) return;

  const commands = editorInstance.value?.commands;
  commands?.findPrevious?.();
}

function clearSearch() {
  if (!isRichMode.value) return;

  const commands = editorInstance.value?.commands;
  commands?.clearSearch?.();
}

function focusEditor(): void {
  editorController.value.focusEditor();
}

function getSearchState(): SearchSnapshot {
  if (!isRichMode.value) {
    return { currentIndex: 0, matchCount: 0, term: '' };
  }

  return getSearchSnapshot(editorInstance.value);
}

defineExpose({ setContent, undo, redo, canUndo, canRedo, setSearchTerm, findNext, findPrevious, clearSearch, focusEditor, getSearchState });

// @ts-ignore
useTextareaAutosize({ element: titleTextareaRef, input: editorTitle });
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
  max-width: 800px;
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
