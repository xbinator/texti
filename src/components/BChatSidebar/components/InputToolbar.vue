<!--
  @file InputToolbar.vue
  @description Chat sidebar input toolbar with model selector and submit actions.
-->
<template>
  <div class="chat-input-toolbar">
    <ModelSelector ref="modelSelectorRef" :model="selectedModel" @update:model="handleModelChange" />
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
import { ref } from 'vue';
import BButton from '@/components/BButton/index.vue';
import ModelSelector from './InputToolbar/ModelSelector.vue';

/**
 * 输入工具栏属性。
 */
interface Props {
  /** 是否正在加载。 */
  loading: boolean;
  /** 输入框内容。 */
  inputValue: string;
  /** 当前选中的模型（providerId:modelId）。 */
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

/**
 * 模型选择器实例引用。
 */
const modelSelectorRef = ref<InstanceType<typeof ModelSelector>>();

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
function handleModelChange(value: string): void {
  emit('model-change', value);
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
