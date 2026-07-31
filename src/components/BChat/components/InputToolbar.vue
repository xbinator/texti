<!--
  @file InputToolbar.vue
  @description Chat sidebar input toolbar with model selector, image upload, and submit actions.
-->
<template>
  <div class="chat-input-toolbar">
    <div v-if="showWorkspaceControl" :class="['chat-input-toolbar__workspace', { 'is-overridden': hasWorkspaceOverride }]">
      <button class="chat-input-toolbar__workspace-select" type="button" :disabled="workspaceDisabled" @click="$emit('workspace-select')">
        <BIcon class="chat-input-toolbar__workspace-folder" icon="lucide:folder-closed" :size="16" />
        <span class="chat-input-toolbar__workspace-label">{{ workspaceLabel }}</span>
      </button>
      <button
        v-if="hasWorkspaceOverride"
        class="chat-input-toolbar__workspace-clear"
        type="button"
        :disabled="workspaceDisabled"
        @click="$emit('workspace-clear')"
      >
        <BIcon icon="lucide:x" :size="16" />
      </button>
    </div>

    <BUpload v-if="supportsVision" accept="image/*" @change="handleImageInputChange">
      <BButton size="small" type="text" square>
        <BIcon icon="lucide:image-plus" :size="16" />
      </BButton>
    </BUpload>

    <div class="toolbar-space"></div>

    <ContextUsage v-if="selectedModel && contextUsedTokens" :used-tokens="contextUsedTokens" :context-window="contextWindow" />

    <ModelSelector ref="modelSelectorRef" :model="selectedModel" @update:model="handleModelChange" />

    <div class="action-buttons">
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
import { ref } from 'vue';
import BButton from '@/components/BButton/index.vue';
import type { SelectedModel } from '@/stores/ai/serviceModel';
import ContextUsage from './InputToolbar/ContextUsage.vue';
import ModelSelector from './InputToolbar/ModelSelector.vue';

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
  /** 当前模型输入投影估算 Token 数。 */
  contextUsedTokens: number;
  /** 当前模型最大上下文窗口 Token 数。 */
  contextWindow: number;
  /** 当前模型是否支持视觉识别。 */
  supportsVision: boolean;
  /** 当前是否允许提交。 */
  canSubmit: boolean;
  /** 当前工作区的简短显示名称。 */
  workspaceLabel: string;
  /** 当前会话是否存在临时工作区覆盖。 */
  hasWorkspaceOverride: boolean;
  /** 是否禁止在当前状态切换工作区。 */
  workspaceDisabled: boolean;
  /** 是否显示工作区选择与恢复入口。 */
  showWorkspaceControl: boolean;
}

withDefaults(defineProps<Props>(), {
  selectedModel: undefined,
  contextUsedTokens: 0,
  contextWindow: 200_000,
  supportsVision: false,
  canSubmit: false,
  workspaceLabel: '默认工作区',
  hasWorkspaceOverride: false,
  workspaceDisabled: false,
  showWorkspaceControl: false
});

const emit = defineEmits<{
  (e: 'submit'): void;
  (e: 'abort'): void;
  (e: 'model-change', model: { providerId: string; modelId: string }): void;
  (e: 'image-select', files: File[]): void;
  (e: 'workspace-select'): void;
  (e: 'workspace-clear'): void;
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
function handleModelChange(model: { providerId: string; modelId: string }): void {
  emit('model-change', model);
}

/**
 * 处理图片输入框 change 事件。
 * @param files - 选择的图片文件列表
 */
function handleImageInputChange(files: FileList): void {
  emit('image-select', Array.from(files));
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

.chat-input-toolbar__workspace {
  position: relative;
  display: flex;
  align-items: center;
  min-width: 0;
  height: 28px;
  overflow: hidden;
  border-radius: 18px;

  &:hover,
  &:focus-within {
    background: var(--bg-secondary);
  }

  &.is-overridden:hover .chat-input-toolbar__workspace-folder,
  &.is-overridden:focus-within .chat-input-toolbar__workspace-folder {
    opacity: 0;
  }

  &.is-overridden:hover .chat-input-toolbar__workspace-clear,
  &.is-overridden:focus-within .chat-input-toolbar__workspace-clear {
    pointer-events: auto;
    opacity: 1;
  }
}

.chat-input-toolbar__workspace-select,
.chat-input-toolbar__workspace-clear {
  font: inherit;
  color: var(--text-primary);
  appearance: none;
  cursor: pointer;
  background: transparent;
  border: 0;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.chat-input-toolbar__workspace-select {
  display: flex;
  gap: 6px;
  align-items: center;
  min-width: 0;
  height: 28px;
  padding: 0 14px 0 8px;
}

.chat-input-toolbar__workspace-clear {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.chat-input-toolbar__workspace-folder {
  flex: 0 0 16px;
  transition: opacity 0.16s ease;
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

.chat-input-toolbar__workspace-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  white-space: nowrap;
}
</style>
