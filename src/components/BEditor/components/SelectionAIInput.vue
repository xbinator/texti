<template>
  <div v-if="editor && visible" ref="wrapperRef" class="ai-input-wrapper" :style="wrapperStyle">
    <!-- 确认区：生成结果展示，等待用户操作 -->
    <div v-if="previewText" class="ai-preview">
      <div class="ai-preview-header">
        <span class="ai-preview-dot"></span>
        <span>AI 结果</span>
      </div>
      <div class="ai-preview-text">{{ previewText }}</div>
      <div class="ai-preview-actions">
        <AButton type="primary" size="small" @click="handleApply">✓ 应用</AButton>
        <AButton size="small" @click="handleDiscard">✕ 丢弃</AButton>
      </div>
    </div>

    <!-- 生成中：隐藏输入框，显示 loading -->
    <div v-else-if="isLoading" class="ai-loading-row">
      <Icon icon="svg-spinners:ring-resize" class="ai-loading-icon" />
      <span class="ai-loading-text">正在生成...</span>
      <span class="ai-cancel" @click="handleCancel">取消</span>
    </div>

    <!-- 空闲：正常输入框 -->
    <AInput v-else ref="inputRef" v-model:value="inputValue" size="large" placeholder="输入指令..." @keydown="handleKeydown" />
  </div>
</template>

<script setup lang="ts">
import type { SelectionRange } from '../types';
import type { Editor } from '@tiptap/vue-3';
import type { CSSProperties } from 'vue';
import { nextTick, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { TextSelection } from '@tiptap/pm/state';
import { onClickOutside, useEventListener } from '@vueuse/core';
import { useStream } from '@/hooks/useStream';
import type { ServiceModelUpdatedDetail } from '@/shared/storage/service-models/events';
import { SERVICE_MODEL_UPDATED_EVENT } from '@/shared/storage/service-models/events';
import type { AvailableServiceModelConfig } from '@/stores/service-model';
import { useServiceModelStore } from '@/stores/service-model';

interface Props {
  editor?: Editor | null;
  selectionRange?: SelectionRange;
}

const props = withDefaults(defineProps<Props>(), {
  editor: null,
  selectionRange: () => ({ from: 0, to: 0, text: '' })
});

const visible = defineModel<boolean>('visible', { default: false });

const inputValue = ref('');
const previewText = ref('');
const inputRef = ref<{ focus: (options?: FocusOptions) => void } | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);
const wrapperStyle = ref<CSSProperties>({});
const modelConfig = ref<AvailableServiceModelConfig | null>(null);
const serviceModelStore = useServiceModelStore();
const { isLoading, streamText } = useStream();

// ---- Model Config ----

async function loadModelConfig(): Promise<void> {
  modelConfig.value = await serviceModelStore.getAvailableServiceConfig('polish');
}

function handleServiceModelUpdated(event: Event): void {
  const { detail } = event as CustomEvent<ServiceModelUpdatedDetail>;
  if (detail.serviceType !== 'polish') return;
  loadModelConfig();
}

useEventListener(window, SERVICE_MODEL_UPDATED_EVENT, handleServiceModelUpdated);

// ---- Position ----

function updatePosition(): void {
  if (!props.editor) return;

  const { from, to } = props.selectionRange!;
  if (from === to) return;

  requestAnimationFrame(() => {
    const editorDom = props.editor!.view.dom as HTMLElement;
    const editorRect = editorDom.getBoundingClientRect();
    const end = props.editor!.view.coordsAtPos(to);
    const lineHeight = end.bottom - end.top;
    const top = end.top - editorRect.top + editorDom.offsetTop;

    wrapperStyle.value = { top: `${top + lineHeight + 6}px` };
  });
}

// ---- Selection ----

function restoreSelection(): void {
  if (!props.editor) return;

  const { from, to } = props.selectionRange!;
  if (from === to) return;

  const { state, view } = props.editor;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

// ---- AI Submit ----

interface PromptReplacement {
  pattern: RegExp;
  replacement: string;
}

function buildPrompt(selectedText: string, userInput: string): string {
  const template = modelConfig.value?.customPrompt ?? '';

  const replacements: PromptReplacement[] = [
    { pattern: /\{\{SELECTED_TEXT\}\}/g, replacement: selectedText },
    { pattern: /\{\{USER_INPUT\}\}/g, replacement: userInput }
  ];

  return replacements.reduce((result, { pattern, replacement }) => result.replace(pattern, replacement), template);
}

function reset(): void {
  inputValue.value = '';
  previewText.value = '';
}

async function handleSubmit(): Promise<void> {
  const value = inputValue.value.trim();
  if (!value || !props.editor) return;

  await loadModelConfig();

  const config = modelConfig.value;
  if (!config?.providerId || !config?.modelId) return;

  const { from, to, text } = props.selectionRange!;
  if (from === to) return;

  const selectedText = text || props.editor.state.doc.textBetween(from, to, '');
  const prompt = buildPrompt(selectedText, value);

  const accumulatedText = await streamText({ providerId: config.providerId, modelId: config.modelId, prompt });

  if (!accumulatedText) {
    reset();
    return;
  }

  previewText.value = accumulatedText;
}

function handleApply(): void {
  if (!props.editor || !previewText.value) return;

  const { from, to } = props.selectionRange!;
  restoreSelection();
  props.editor.chain().focus().insertContentAt({ from, to }, previewText.value).run();
  props.editor.commands.focus();

  reset();
  visible.value = false;
}

function handleDiscard(): void {
  previewText.value = '';
  requestAnimationFrame(() => {
    nextTick(() => inputRef.value?.focus({ preventScroll: true }));
  });
}

function handleCancel(): void {
  if (isLoading.value) return;
  reset();
  visible.value = false;
  props.editor?.commands.focus();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleSubmit();
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    handleCancel();
  }
}

// ---- Lifecycle ----

onClickOutside(wrapperRef, () => {
  if (!isLoading.value && !previewText.value) {
    visible.value = false;
  }
});

watch(visible, (newValue) => {
  if (newValue) {
    loadModelConfig();
    updatePosition();
    requestAnimationFrame(() => {
      nextTick(() => inputRef.value?.focus({ preventScroll: true }));
    });
  } else {
    reset();
  }
});

loadModelConfig();
</script>

<style lang="less" scoped>
.ai-input-wrapper {
  position: absolute;
  left: 50px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: calc(100% - 100px);
  padding: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}

// ---- 预览确认区 ----
.ai-preview {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border-secondary);
  border-radius: 8px;
}

.ai-preview-header {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-tertiary);
}

.ai-preview-dot {
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  background: var(--color-success);
  border-radius: 50%;
}

.ai-preview-text {
  padding: 9px 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
}

.ai-preview-actions {
  display: flex;
  gap: 6px;
  padding: 6px 8px;
  border-top: 1px solid var(--border-tertiary);
}

// ---- 生成中 loading 行 ----
.ai-loading-row {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--text-secondary);
}

.ai-loading-icon {
  flex-shrink: 0;
  font-size: 14px;
  color: var(--text-secondary);
}

.ai-loading-text {
  flex: 1;
}

.ai-cancel {
  font-size: 12px;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 0.15s;
}

.ai-cancel:hover {
  color: var(--text-secondary);
}
</style>
