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

    <BScrollbar ref="scrollbarRef" class="b-editor-scrollbar" @scroll="handleEditorScroll">
      <div ref="containerRef" :class="['b-editor-container']">
        <textarea ref="titleTextareaRef" v-model="editorTitle" class="b-editor-title" placeholder="请输入标题" @blur="handleTitleBlur"></textarea>

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
import type { FrontMatterData } from './hooks/useFrontMatter';
import type { BEditorViewMode } from './types';
import { computed, ref, toRef } from 'vue';
import { useTextareaAutosize, useWindowSize } from '@vueuse/core';
import BScrollbar from '../BScrollbar/index.vue';
import RichEditorPane from './components/RichEditorPane.vue';
import SourceEditorPane from './components/SourceEditorPane.vue';
import { getSearchSnapshot, type SearchScrollContext, type SearchSnapshot } from './extensions/Search';
import { useAnchors } from './hooks/useAnchors';
import { useEditorController } from './hooks/useEditorController';
import { useFrontMatter } from './hooks/useFrontMatter';
import { useRichEditor } from './hooks/useRichEditor';

// 视图宽度 + 侧边栏宽度 + 视图间距
const MIN_WIDTH_FOR_SIDEBAR = 800 + 560;
const editorInstanceCounter = ref(0);

const { width } = useWindowSize();
const layoutRef = ref<HTMLElement | null>(null);
const scrollbarRef = ref<InstanceType<typeof BScrollbar> | null>(null);
const titleTextareaRef = ref<HTMLTextAreaElement | null>(null);

interface Props {
  editable?: boolean;
  // 编辑器实例ID
  editorId?: string;
  viewMode?: BEditorViewMode;
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
const showSidebar = computed(() => isRichMode.value && props.showOutline && width.value >= MIN_WIDTH_FOR_SIDEBAR);

const editorContent = defineModel<string>('value', { default: '' });

const editorTitle = defineModel<string>('title', { default: '' });

const emit = defineEmits<{ titleBlur: [title: string] }>();
const richEditorPaneRef = ref<InstanceType<typeof RichEditorPane> | null>(null);
const sourceEditorPaneRef = ref<InstanceType<typeof SourceEditorPane> | null>(null);

function handleTitleBlur(): void {
  emit('titleBlur', editorTitle.value);
}
const { activeAnchorId, handleChangeAnchor, handleEditorScroll } = useAnchors(layoutRef);

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

  const wrapElement = scrollbarRef.value?.getWrapElement();
  if (!wrapElement) {
    targetElement.scrollIntoView({
      block: 'center',
      inline: 'nearest'
    });
    return;
  }

  const wrapRect = wrapElement.getBoundingClientRect();
  const targetRect = targetElement.getBoundingClientRect();
  const centeredTop = wrapElement.scrollTop + (targetRect.top - wrapRect.top) - (wrapElement.clientHeight - targetRect.height) / 2;
  const maxScrollTop = Math.max(0, wrapElement.scrollHeight - wrapElement.clientHeight);
  const nextTop = Math.min(Math.max(centeredTop, 0), maxScrollTop);

  scrollbarRef.value?.scrollTo({
    top: nextTop,
    behavior: 'auto'
  });
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
    return {
      currentIndex: 0,
      matchCount: 0,
      term: ''
    };
  }

  return getSearchSnapshot(editorInstance.value);
}

defineExpose({ setContent, undo, redo, canUndo, canRedo, setSearchTerm, findNext, findPrevious, clearSearch, focusEditor, getSearchState });

// @ts-ignore
useTextareaAutosize({ element: titleTextareaRef, input: editorTitle });
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
  position: relative;
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
</style>
