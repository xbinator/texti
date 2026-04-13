<template>
  <div v-if="editor && visible" ref="wrapperRef" class="ai-input-wrapper" :style="wrapperStyle">
    <!-- AI 生成预览区 -->
    <div v-if="previewText || loading" class="ai-preview" @click="applyGeneratedContent">
      <div class="ai-preview-text">
        <BMessage :content="previewText" :max-height="200" type="text" status="streaming" :loading="loading" />
      </div>
      <div class="ai-preview-hint">
        <div v-if="loading" class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <Icon icon="svg-spinners:ring-resize" class="ai-loading-icon" />
            <span>正在编写中...</span>
          </div>
          <BButton type="secondary" size="small" @click.stop="stopStreaming">停 止</BButton>
        </div>
        <div v-else class="flex items-center justify-between">
          <div>点击应用 AI 生成内容</div>
          <div class="flex items-center gap-2">
            <BButton type="secondary" size="small" @click.stop="closePanel">取 消</BButton>
            <BButton type="primary" size="small" @click.stop="applyGeneratedContent">应 用</BButton>
          </div>
        </div>
      </div>
    </div>

    <AInput v-else ref="inputRef" v-model:value="inputValue" size="large" placeholder="输入指令，按 Enter 发送..." :disabled="loading" @keydown="onKeydown" />
  </div>
</template>

<script setup lang="ts">
import type { SelectionRange } from '../types';
import type { Editor } from '@tiptap/vue-3';
import type { CSSProperties } from 'vue';
import { onBeforeUnmount, computed, nextTick, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { TextSelection } from '@tiptap/pm/state';
import { onClickOutside, useEventListener } from '@vueuse/core';
import { message } from 'ant-design-vue';
import { useAgent } from '@/hooks/useAgent';
import { useShortcuts } from '@/hooks/useShortcuts';
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
const loading = ref(false);
const inputRef = ref<{ focus: (options?: FocusOptions) => void } | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);
const wrapperStyle = ref<CSSProperties>({});
const modelConfig = ref<AvailableServiceModelConfig | null>(null);
const serviceModelStore = useServiceModelStore();

const providerId = computed(() => modelConfig.value?.providerId ?? '');

const { agent } = useAgent({
  providerId,
  onChunk(content) {
    previewText.value += content;
  },
  onComplete() {
    loading.value = false;
  },
  onError(error) {
    loading.value = false;
    message.error(error.message);
  }
});

const { registerShortcut } = useShortcuts();

let unregisterEscape: (() => void) | null = null;

// ---- Position ----

function scrollIntoViewIfObscured(): void {
  if (!wrapperRef.value) return;

  const rect = wrapperRef.value.getBoundingClientRect();
  const isObscured = rect.bottom > window.innerHeight - 400;

  if (isObscured) {
    wrapperRef.value.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function syncFloatPosition(): void {
  if (!props.editor) return;

  const { from, to } = props.selectionRange!;
  if (from === to) return;

  const editorDom = props.editor.view.dom as HTMLElement;
  const editorRect = editorDom.getBoundingClientRect();
  const endCoords = props.editor.view.coordsAtPos(to);
  const lineHeight = endCoords.bottom - endCoords.top;
  const top = endCoords.top - editorRect.top + editorDom.offsetTop;

  wrapperStyle.value = { top: `${top + lineHeight + 6}px` };

  nextTick(scrollIntoViewIfObscured);
}

// ---- Selection ----

function restoreEditorSelection(): void {
  if (!props.editor) return;

  const { from, to } = props.selectionRange!;
  if (from === to) return;

  const { state, view } = props.editor;
  view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function collapseToSelectionStart(): void {
  if (!props.editor) return;

  const { from } = props.selectionRange!;
  props.editor.chain().focus().setTextSelection(from).run();
}

// ---- State ----

function resetState(): void {
  inputValue.value = '';
  previewText.value = '';
  loading.value = false;
}

function stopStreaming(): void {
  if (loading.value) {
    agent.abort();
  }
}

function closePanel(): void {
  stopStreaming();
  resetState();
  visible.value = false;
  collapseToSelectionStart();
}

// ---- Model Config ----

async function fetchModelConfig(): Promise<void> {
  modelConfig.value = await serviceModelStore.getAvailableServiceConfig('polish');
}

function onServiceModelUpdated(event: Event): void {
  const { detail } = event as CustomEvent<ServiceModelUpdatedDetail>;
  if (detail.serviceType !== 'polish') return;
  fetchModelConfig();
}

useEventListener(window, SERVICE_MODEL_UPDATED_EVENT, onServiceModelUpdated);

fetchModelConfig();

// ---- Visible Watch ----

watch(visible, (isVisible) => {
  if (isVisible) {
    fetchModelConfig();
    nextTick(syncFloatPosition);
    nextTick(() => inputRef.value?.focus({ preventScroll: true }));
    unregisterEscape = registerShortcut({ key: 'escape', handler: closePanel });
  } else {
    resetState();
    unregisterEscape?.();
    unregisterEscape = null;
  }
});

// ---- AI ----

function buildAIPrompt(selectedText: string, userInput: string): string {
  const template = modelConfig.value?.customPrompt ?? '';
  return template.replace(/\{\{SELECTED_TEXT\}\}/g, selectedText).replace(/\{\{USER_INPUT\}\}/g, userInput);
}

async function sendInstruction(): Promise<void> {
  const value = inputValue.value.trim();
  if (!value || !props.editor || loading.value) return;

  const config = modelConfig.value;
  if (!config?.providerId || !config?.modelId) {
    message.warning('未找到可用的模型配置');
    return;
  }

  const { from, to, text } = props.selectionRange!;
  if (from === to) return;

  const selectedText = text || props.editor.state.doc.textBetween(from, to, '');
  const prompt = buildAIPrompt(selectedText, value);

  loading.value = true;
  agent.stream({ modelId: config.modelId, prompt });
}

function applyGeneratedContent(): void {
  if (!props.editor || !previewText.value) return;

  const { from, to } = props.selectionRange!;
  restoreEditorSelection();
  props.editor.chain().focus().insertContentAt({ from, to }, previewText.value).run();

  closePanel();
}

// ---- Events ----

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    sendInstruction();
  }

  // 作为 useShortcuts 全局拦截的兜底
  if (event.key === 'Escape') {
    event.preventDefault();
    closePanel();
  }
}

onClickOutside(wrapperRef, () => {
  if (!loading.value) closePanel();
});

// ---- Lifecycle ----

onBeforeUnmount(() => {
  unregisterEscape?.();
  unregisterEscape = null;
});
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
}

// ---- 预览确认区 ----
.ai-preview {
  cursor: pointer;
  background: var(--bg-primary);
  border: 1px solid var(--border-secondary);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
  transition: border-color 0.2s;

  &:hover {
    border-color: var(--border-primary);
  }
}

.ai-preview-text {
  padding: 9px 12px;
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
}

.ai-preview-hint {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  border-top: 1px solid var(--border-tertiary);
  border-radius: 0 0 8px 8px;
}

.ai-loading-icon,
.ai-apply-icon {
  flex-shrink: 0;
  font-size: 12px;
}

.ai-cancel-btn {
  padding: 2px 8px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: 1px solid var(--border-secondary);
  border-radius: 4px;
  transition: all 0.2s;

  &:hover {
    color: var(--text-primary);
    border-color: var(--border-primary);
  }
}
</style>
