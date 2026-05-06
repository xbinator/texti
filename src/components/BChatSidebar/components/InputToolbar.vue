<!--
  @file InputToolbar.vue
  @description Chat sidebar input toolbar with model selector, image upload, and submit actions.
-->
<template>
  <div class="chat-input-toolbar">
    <template v-if="isVoiceRecording">
      <VoiceWaveform :samples="voiceWaveformSamples" />

      <div class="toolbar-space"></div>
    </template>
    <template v-else>
      <BUpload v-if="supportsVision" accept="image/*" @change="handleImageInputChange">
        <BButton size="small" type="text" square>
          <Icon icon="lucide:image-plus" width="16" height="16" />
        </BButton>
      </BUpload>

      <div class="toolbar-space"></div>

      <ModelSelector ref="modelSelectorRef" :model="selectedModel" @update:model="handleModelChange" />
    </template>

    <div class="action-buttons">
      <VoiceInput ref="voiceInputRef" :disabled="loading" @start="emit('voice-start')" @complete="handleVoiceComplete" />

      <BButton v-if="loading" size="small" tooltip="停止" square @click="$emit('abort')">
        <svg class="loading-icon" color="currentColor" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
          <title>Stop Loading</title>
          <rect fill="currentColor" height="250" rx="24" ry="24" width="250" x="375" y="375"></rect>
          <circle cx="500" cy="500" fill="none" r="450" stroke="currentColor" stroke-width="100" opacity="0.45"></circle>
          <circle cx="500" cy="500" fill="none" r="450" stroke="currentColor" stroke-width="100" stroke-dasharray="600 9999999">
            <animateTransform attributeName="transform" dur="1s" from="0 500 500" repeatCount="indefinite" to="360 500 500" type="rotate"></animateTransform>
          </circle>
        </svg>
      </BButton>
      <BButton v-else size="small" tooltip="发送" square :disabled="!canSubmit" icon="lucide:arrow-up" @click="$emit('submit')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import BButton from '@/components/BButton/index.vue';
import type { SelectedModel } from '@/stores/serviceModel';
import ModelSelector from './InputToolbar/ModelSelector.vue';
import VoiceInput from './InputToolbar/VoiceInput.vue';
import VoiceWaveform from './InputToolbar/VoiceWaveform.vue';

/**
 * 输入工具栏属性。
 */
interface Props {
  /** 是否正在加载。 */
  loading: boolean;
  /** 输入框内容。 */
  inputValue: string;
  /** 当前选中的模型标识。 */
  selectedModel?: SelectedModel;
  /** 当前模型是否支持视觉识别。 */
  supportsVision: boolean;
  /** 当前是否允许提交。 */
  canSubmit: boolean;
}

withDefaults(defineProps<Props>(), {
  selectedModel: undefined,
  supportsVision: false,
  canSubmit: false
});

const emit = defineEmits<{
  (e: 'submit'): void;
  (e: 'abort'): void;
  (e: 'model-change', model: { providerId: string; modelId: string }): void;
  (e: 'image-select', files: File[]): void;
  (e: 'voice-start'): void;
  (e: 'voice-complete', payload: { text: string }): void;
}>();

/**
 * 模型选择器实例引用。
 */
const modelSelectorRef = ref<InstanceType<typeof ModelSelector>>();

/**
 * 语音输入组件实例引用。
 */
const voiceInputRef = ref<InstanceType<typeof VoiceInput>>();

/**
 * 当前是否正在录音。
 */
const isVoiceRecording = computed<boolean>(() => {
  const input = voiceInputRef.value;
  return input?.isRecording ?? false;
});

/**
 * 当前录音波形采样数据。
 */
const voiceWaveformSamples = computed<number[]>(() => {
  const input = voiceInputRef.value;
  return input?.waveformSamples ?? [];
});

/**
 * 将打开请求转发到内部模型选择器。
 */
function open(): void {
  modelSelectorRef.value?.open();
}

/**
 * 转发模型选择事件。
 * @param value - 新的模型值。
 */
function handleModelChange(model: { providerId: string; modelId: string }): void {
  emit('model-change', model);
}

/**
 * 处理图片输入框 change 事件。
 * @param event - 原生 change 事件
 */
function handleImageInputChange(files: FileList) {
  emit('image-select', Array.from(files));
}

/**
 * 处理语音输入完成事件。
 * @param payload - 语音转写结果
 */
function handleVoiceComplete(payload: { text: string }): void {
  emit('voice-complete', payload);
}

/**
 * 暴露给父组件的程序化打开入口。
 */
defineExpose({
  open
});
</script>

<style scoped lang="less">
.chat-input-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
}

.toolbar-space {
  flex: 1;
}

.action-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
}

.image-input {
  display: none;
}

.loading-icon {
  width: 16px;
  height: 16px;
}
</style>
