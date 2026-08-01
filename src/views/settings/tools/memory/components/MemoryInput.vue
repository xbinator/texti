<!--
  @file MemoryInput.vue
  @description 记忆输入弹窗组件，以 Modal 形式提供输入框和发送按钮，支持 ESC 退出编辑。
-->
<template>
  <BModal v-model:open="visible" :width="480" mask-closable :main-style="{ padding: 0 }" :border-radius="24" :keyboard="true" @close="handleCancel">
    <div class="memory-input">
      <input
        ref="inputRef"
        v-model="content"
        class="memory-input__field"
        placeholder="告诉我要记住或忘记什么..."
        :disabled="organizing"
        @keydown.enter="handleSubmit"
        @keydown.escape="handleCancel"
      />

      <div
        class="memory-input__send"
        :class="{
          disabled: !hasContent || organizing,
          active: hasContent && !organizing,
          loading: organizing
        }"
        @click="handleSubmit"
      >
        <BIcon v-if="organizing" icon="lucide:loader-2" class="memory-input__send-spin" />
        <BIcon v-else icon="lucide:send" />
      </div>
    </div>
  </BModal>
</template>

<script setup lang="ts">
/**
 * @file MemoryInput.vue
 * @description 记忆输入弹窗组件，以 Modal 形式提供输入框和发送按钮，支持 ESC 退出编辑。
 */
import { computed, nextTick, ref, watch } from 'vue';
import { useMemory } from '../hooks/useMemory';

const { organizing, organize } = useMemory();

/** 弹窗是否打开 */
const visible = defineModel<boolean>('open', { default: false });

/** 输入内容 */
const content = ref('');
/** 输入框引用 */
const inputRef = ref<HTMLTextAreaElement>();
/** 是否有有效内容 */
const hasContent = computed(() => content.value.trim().length > 0);

/** 弹窗打开时自动聚焦输入框 */
watch(visible, (val) => val && nextTick(() => inputRef.value?.focus()));

/**
 * 提交输入内容，调用 AI 整理记忆
 */
async function handleSubmit(): Promise<void> {
  if (!hasContent.value || organizing.value) return;
  const value = content.value.trim();
  const success = await organize(value);
  if (success) {
    content.value = '';
    visible.value = false;
  }
}

/**
 * 取消编辑并清空输入
 */
function handleCancel(): void {
  content.value = '';
  visible.value = false;
}

/**
 * 聚焦输入框
 */
function focus(): void {
  nextTick(() => {
    inputRef.value?.focus();
  });
}

/**
 * 清空输入内容
 */
function clear(): void {
  content.value = '';
}

defineExpose({ focus, clear });
</script>

<style scoped lang="less">
.memory-input {
  display: flex;
  gap: 8px;
  align-items: center;
  height: 48px;
  padding: 0 8px 0 20px;
}

.memory-input__field {
  flex: 1;
  font-family: var(--input-font-family);
  color: var(--text-primary);
  resize: vertical;
  outline: none;
  background: transparent;
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard);

  &:focus {
    border-color: var(--color-primary);
  }

  &::placeholder {
    color: var(--input-placeholder-color);
    opacity: 1;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }
}

.memory-input__send {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  font-size: 18px;
  cursor: pointer;
  border-radius: var(--radius-full);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard),
    opacity var(--motion-duration-base) var(--motion-easing-standard);

  &.disabled {
    color: var(--text-tertiary);
    cursor: not-allowed;
    background: var(--bg-tertiary);
  }

  &.active {
    color: #fff;
    background: var(--color-primary);

    &:hover {
      background: var(--color-primary-hover);
    }

    &:active {
      background: var(--color-primary-active);
    }
  }

  &.loading {
    color: #fff;
    cursor: not-allowed;
    background: var(--color-primary);
    opacity: 0.8;
  }
}

.memory-input__send-spin {
  animation: memory-input-spin 1s linear infinite;
}

@keyframes memory-input-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
