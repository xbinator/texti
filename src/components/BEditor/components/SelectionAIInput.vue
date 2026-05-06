<template>
  <div v-if="adapter && visible" ref="wrapperRef" class="ai-input-wrapper" :style="wrapperStyle">
    <!-- AI 生成预览区 -->
    <div v-if="previewText || loading" class="ai-preview">
      <div class="ai-preview-text">
        <BMessage :content="previewText" :max-height="200" type="text" status="streaming" :loading="loading" />
      </div>
      <div class="ai-preview-hint">
        <div v-if="loading" class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <Icon icon="svg-spinners:ring-resize" class="ai-loading-icon" />
            <span>正在编写中...</span>
          </div>
          <BButton type="secondary" size="small" @click.stop="stopStreaming">停 止</BButton>
        </div>
        <div v-else class="flex items-center justify-between">
          <div>点击应用 AI 生成内容</div>
          <div class="flex items-center gap-4">
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
/**
 * @file SelectionAIInput.vue
 * @description 选区 AI 输入面板，通过 adapter 协议屏蔽 Tiptap/CodeMirror 差异。
 */
import type { SelectionAssistantAdapter, SelectionAssistantPosition, SelectionAssistantRange } from '../adapters/selectionAssistant';
import type { CSSProperties } from 'vue';
import { onBeforeUnmount, computed, nextTick, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { onClickOutside, useEventListener } from '@vueuse/core';
import { message } from 'ant-design-vue';
import { useChat } from '@/hooks/useChat';
import { useShortcuts } from '@/hooks/useShortcuts';
import type { ServiceModelUpdatedDetail } from '@/shared/storage/service-models/events';
import { SERVICE_MODEL_UPDATED_EVENT } from '@/shared/storage/service-models/events';
import type { AvailableServiceModelConfig } from '@/stores/serviceModel';
import { useServiceModelStore } from '@/stores/serviceModel';

interface Props {
  /** 面板是否可见 */
  visible?: boolean;
  /** 选区工具适配器 */
  adapter?: SelectionAssistantAdapter | null;
  /** 缓存选区范围 */
  selectionRange?: SelectionAssistantRange | null;
  /** 面板定位信息（由编排层注入） */
  position?: SelectionAssistantPosition | null;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  adapter: null,
  selectionRange: null,
  position: null
});

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void;
  (e: 'apply', content: string): void;
  (e: 'streaming-change', value: boolean): void;
}>();

const inputValue = ref('');
const previewText = ref('');
const loading = ref(false);
const inputRef = ref<{ focus: (options?: FocusOptions) => void } | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);
const wrapperStyle = ref<CSSProperties>({});
const modelConfig = ref<AvailableServiceModelConfig | null>(null);
const serviceModelStore = useServiceModelStore();

const providerId = computed(() => modelConfig.value?.providerId ?? '');

const { agent } = useChat({
  providerId,
  onText(content) {
    previewText.value += content;
  },
  onComplete() {
    loading.value = false;
    emit('streaming-change', false);
  },
  onError(error) {
    loading.value = false;
    emit('streaming-change', false);
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

/**
 * 根据编排层注入的 position 更新面板定位。
 * 坐标已由 adapter 计算为相对 overlayRoot 的值。
 */
function syncFloatPosition(): void {
  const { position } = props;
  if (!position) return;

  const top = position.anchorRect.top + position.lineHeight + 6;
  wrapperStyle.value = { top: `${top}px` };

  nextTick(scrollIntoViewIfObscured);
}

// ---- Selection ----

/**
 * 关闭面板时将光标收缩到原选区起始位置。
 */
function collapseToSelectionStart(): void {
  const { adapter } = props;
  const range = props.selectionRange;
  if (!adapter || !range) return;

  adapter.restoreSelection({
    from: range.from,
    to: range.from,
    text: '',
    docVersion: range.docVersion,
    snapshotId: range.snapshotId
  });
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
    emit('streaming-change', false);
  }
}

function closePanel(): void {
  stopStreaming();
  resetState();
  collapseToSelectionStart();
  emit('update:visible', false);
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

watch(
  () => props.visible,
  (isVisible) => {
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
  }
);

// 监听 position 变化，重新定位面板
watch(
  () => props.position,
  () => {
    if (props.visible) {
      syncFloatPosition();
    }
  }
);

// ---- AI ----

function buildAIPrompt(selectedText: string, userInput: string): string {
  const template = modelConfig.value?.customPrompt ?? '';
  return template.replace(/\{\{SELECTED_TEXT\}\}/g, selectedText).replace(/\{\{USER_INPUT\}\}/g, userInput);
}

async function sendInstruction(): Promise<void> {
  const value = inputValue.value.trim();
  const range = props.selectionRange;
  if (!value || loading.value || !range) return;

  const config = modelConfig.value;
  if (!config?.providerId || !config?.modelId) {
    message.warning('未找到可用的模型配置');
    return;
  }

  if (range.from === range.to) return;

  const selectedText = range.text;
  const prompt = buildAIPrompt(selectedText, value);

  loading.value = true;
  emit('streaming-change', true);
  agent.stream({ modelId: config.modelId, prompt });
}

function applyGeneratedContent(): void {
  if (!previewText.value) return;
  emit('apply', previewText.value);
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
