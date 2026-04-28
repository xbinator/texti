<template>
  <div class="chat-input-toolbar">
    <ModelSelector :model="selectedModel" @update:model="handleModelChange" />
    <div class="action-buttons">
      <BButton v-if="loading" size="small" square @click="$emit('abort')">
        <svg class="loading-icon" color="currentColor" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg">
          <title>Stop Loading</title>
          <rect fill="currentColor" height="250" rx="24" ry="24" width="250" x="375" y="375"></rect>
          <circle cx="500" cy="500" fill="none" r="450" stroke="currentColor" stroke-width="100" opacity="0.45"></circle>
          <circle cx="500" cy="500" fill="none" r="450" stroke="currentColor" stroke-width="100" stroke-dasharray="600 9999999">
            <animateTransform attributeName="transform" dur="1s" from="0 500 500" repeatCount="indefinite" to="360 500 500" type="rotate"></animateTransform>
          </circle>
        </svg>
      </BButton>
      <BButton v-else size="small" square :disabled="!inputValue" icon="lucide:arrow-up" @click="$emit('submit')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import BButton from '@/components/BButton/index.vue';
import ModelSelector from './InputToolbar/ModelSelector.vue';

interface Props {
  /** 是否正在加载 */
  loading: boolean;
  /** 输入框内容 */
  inputValue: string;
  /** 当前选中的模型 (providerId:modelId) */
  selectedModel?: string;
}

withDefaults(defineProps<Props>(), {
  selectedModel: undefined
});

const emit = defineEmits<{
  (e: 'submit'): void;
  (e: 'abort'): void;
  (e: 'model-change', value: string): void;
}>();

function handleModelChange(value: string): void {
  emit('model-change', value);
}
</script>

<style scoped lang="less">
.chat-input-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
}

.action-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
}

.loading-icon {
  width: 16px;
  height: 16px;
}
</style>
