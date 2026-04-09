<template>
  <div v-if="editor && visible" ref="wrapperRef" class="ai-input-wrapper" :style="wrapperStyle">
    <AInput ref="inputRef" v-model:value="inputValue" size="large" placeholder="输入指令..." @keydown="handleKeydown" />
  </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3';
import type { CSSProperties } from 'vue';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { TextSelection } from '@tiptap/pm/state';
import { onClickOutside } from '@vueuse/core';
import { aiService } from '@/services/ai';
import { serviceModelsStorage } from '@/utils/storage';
import type { ServiceModelConfig } from '@/utils/storage/service-models';
import type { ServiceModelUpdatedDetail } from '@/utils/storage/service-models/events';
import { SERVICE_MODEL_UPDATED_EVENT } from '@/utils/storage/service-models/events';

interface Props {
  editor?: Editor | null;
  selectionRange?: {
    from: number;
    to: number;
    text: string;
  };
}

const props = withDefaults(defineProps<Props>(), {
  editor: null,
  selectionRange: () => ({ from: 0, to: 0, text: '' })
});

const visible = defineModel<boolean>('visible', { default: false });

const inputValue = ref('');
const inputRef = ref<{ focus: () => void } | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);
const wrapperStyle = ref<CSSProperties>({});
const modelConfig = ref<ServiceModelConfig | null>(null);
const isLoading = ref(false);

async function loadModelConfig(): Promise<void> {
  const config = await serviceModelsStorage.getConfig('polish');

  modelConfig.value = config
    ? {
        providerId: config.providerId,
        modelId: config.modelId,
        customPrompt: config.customPrompt,
        updatedAt: config.updatedAt
      }
    : null;
}

function refreshModelConfig(): void {
  loadModelConfig().catch((error: unknown) => {
    console.error('加载模型配置失败:', error);
  });
}

function handleServiceModelUpdated(event: Event): void {
  const customEvent = event as CustomEvent<ServiceModelUpdatedDetail>;
  if (customEvent.detail.serviceType !== 'polish') return;

  refreshModelConfig();
}

onClickOutside(wrapperRef, () => {
  if (!isLoading.value) {
    visible.value = false;
  }
});

function updatePosition(): void {
  if (!props.editor) return;

  const { from, to } = props.selectionRange;
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

function restoreSelection(): void {
  if (!props.editor) return;

  const { from, to } = props.selectionRange;
  if (from === to) return;

  const transaction = props.editor.state.tr.setSelection(TextSelection.create(props.editor.state.doc, from, to));
  props.editor.view.dispatch(transaction);
}

function buildPrompt(selectedText: string, userInput: string): string {
  const template = modelConfig.value?.customPrompt || '';

  return template.replace(/\{\{SELECTED_TEXT\}\}/g, selectedText).replace(/\{\{USER_INPUT\}\}/g, userInput);
}

watch(visible, (newValue) => {
  if (newValue) {
    refreshModelConfig();
    updatePosition();
    nextTick(() => inputRef.value?.focus());
  } else {
    inputValue.value = '';
  }
});

onMounted(() => {
  refreshModelConfig();
  window.addEventListener(SERVICE_MODEL_UPDATED_EVENT, handleServiceModelUpdated);
});

onUnmounted(() => {
  inputValue.value = '';
  window.removeEventListener(SERVICE_MODEL_UPDATED_EVENT, handleServiceModelUpdated);
});

async function readStreamText(stream: AsyncIterable<string>): Promise<string> {
  const iterator = stream[Symbol.asyncIterator]();
  async function consume(accumulatedText: string): Promise<string> {
    const result = await iterator.next();
    if (result.done) {
      return accumulatedText;
    }

    return consume(accumulatedText + result.value);
  }

  return consume('');
}

async function handleSubmit(): Promise<void> {
  const value = inputValue.value.trim();
  if (!value || !props.editor) return;

  await loadModelConfig();
  if (!modelConfig.value) return;

  const { from, to } = props.selectionRange;
  if (from === to) return;

  const selectedText = props.selectionRange.text || props.editor.state.doc.textBetween(from, to, '');
  console.log('🚀 ~ handleSubmit ~ selectedText:', selectedText);

  if (!modelConfig.value.providerId || !modelConfig.value.modelId) {
    console.error('未配置模型');
    return;
  }

  const prompt = buildPrompt(selectedText, value);

  isLoading.value = true;

  const [error, stream] = await aiService.streamText({
    providerId: modelConfig.value.providerId,
    modelId: modelConfig.value.modelId,
    prompt
  });

  if (error) {
    console.error('AI 调用失败:', error);
    isLoading.value = false;
    return;
  }

  let accumulatedText = '';

  try {
    accumulatedText = await readStreamText(stream.textStream);
  } catch (streamError) {
    console.error('流式输出错误:', streamError);
    isLoading.value = false;
    return;
  }

  restoreSelection();
  props.editor.chain().focus().insertContentAt({ from, to }, accumulatedText).run();
  props.editor.commands.focus();
  isLoading.value = false;
  inputValue.value = '';
  visible.value = false;
}

function handleCancel(): void {
  if (isLoading.value) return;

  inputValue.value = '';
  visible.value = false;
  props.editor?.commands.focus();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    handleSubmit().catch((error: unknown) => {
      console.error('处理 AI 输入提交失败:', error);
    });
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    handleCancel();
  }
}
</script>

<style lang="less" scoped>
.ai-input-wrapper {
  position: absolute;
  left: 50px;
  z-index: 1000;
  display: flex;
  width: calc(100% - 100px);
  padding: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
}
</style>
