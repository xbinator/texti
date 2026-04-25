<template>
  <div class="chat-input-toolbar">
    <ModelSelector :model="selectedModel" @update:model="handleModelChange" />
    <div class="action-buttons">
      <BButton v-if="loading" size="small" square icon="lucide:square" @click="$emit('abort')" />
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
</style>
