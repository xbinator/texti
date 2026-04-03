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

    <BScrollbar class="b-editor-scrollbar" @scroll="handleEditorScroll">
      <div ref="containerRef" :class="['b-editor-container']" @mouseleave="onContainerMouseLeave" @mousemove="onContainerMouseMove">
        <textarea ref="titleTextareaRef" v-model="editorTitle" class="b-editor-title" placeholder="请输入标题" @blur="handleTitleBlur"></textarea>

        <RichEditorPane
          v-if="isRichMode"
          ref="richEditorPaneRef"
          v-model:front-matter-data="frontMatterModel"
          :editor="editorInstance"
          :editor-id="props.editorId"
          :hover-indicator="hoverIndicator"
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
import { computed, ref, toRef, watch } from 'vue';
import { useTextareaAutosize, useWindowSize } from '@vueuse/core';
import RichEditorPane from './components/RichEditorPane.vue';
import SourceEditorPane from './components/SourceEditorPane.vue';
import { useAnchors } from './hooks/useAnchors';
import { useEditorController } from './hooks/useEditorController';
import { useFrontMatter } from './hooks/useFrontMatter';
import { useHoverIndicator } from './hooks/useHoverIndicator';
import { useRichEditor } from './hooks/useRichEditor';

// 视图宽度 + 侧边栏宽度 + 视图间距
const MIN_WIDTH_FOR_SIDEBAR = 800 + 560;
const editorInstanceCounter = ref(0);

const { width } = useWindowSize();
const layoutRef = ref<HTMLElement | null>(null);
const containerRef = ref<HTMLElement | null>(null);
const titleTextareaRef = ref<HTMLTextAreaElement | null>(null);
const showSidebar = ref(true);

watch(width, (newWidth) => (showSidebar.value = newWidth >= MIN_WIDTH_FOR_SIDEBAR), { immediate: true });

interface Props {
  editable?: boolean;
  // 编辑器实例ID
  editorId?: string;
  viewMode?: BEditorViewMode;
}

const props = withDefaults(defineProps<Props>(), {
  editable: true,
  // 编辑器实例ID
  editorId: '',
  viewMode: 'rich'
});

const editorInstanceId = computed(() => `${props.editorId || ''}`);
const isRichMode = computed(() => props.viewMode === 'rich');

const editorContent = defineModel<string>('value', { default: '' });

const editorTitle = defineModel<string>('title', { default: '' });

const emit = defineEmits<{ titleBlur: [title: string] }>();
const richEditorPaneRef = ref<InstanceType<typeof RichEditorPane> | null>(null);
const sourceEditorPaneRef = ref<InstanceType<typeof SourceEditorPane> | null>(null);

function handleTitleBlur(): void {
  emit('titleBlur', editorTitle.value);
}
const { activeAnchorId, handleChangeAnchor, handleEditorScroll } = useAnchors(layoutRef);
const { hoverIndicator, onContainerMouseLeave, onContainerMouseMove } = useHoverIndicator(containerRef);

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

const { editorInstance, setContent: setRichEditorContent } = useRichEditor({
  bodyContent,
  editable: toRef(props, 'editable'),
  editorInstanceId,
  onContentChange: syncToExternal
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

defineExpose({ setContent, undo, redo, canUndo, canRedo });

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
