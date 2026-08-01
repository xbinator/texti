<template>
  <div :class="name">
    <template v-if="isModelAvailable">
      <div class="b-markdown-seltoolbar__ai-btn" @mousedown.prevent="$emit('ai')">
        <BIcon icon="lucide:sparkles" />
        <span>AI 助手</span>
      </div>
    </template>

    <div class="b-markdown-seltoolbar__ai-btn" @mousedown.prevent="$emit('reference')">
      <BIcon icon="lucide:message-square-plus" />
      <span>插入对话</span>
    </div>

    <div class="b-markdown-seltoolbar__ai-btn" @mousedown.prevent="$emit('comment')">
      <BIcon icon="lucide:message-circle" />
      <span>评论</span>
    </div>
    <div v-if="buttons.length" class="b-markdown-seltoolbar__divider"></div>

    <button
      v-for="btn in buttons"
      :key="btn.command"
      type="button"
      class="b-markdown-seltoolbar__btn"
      :class="{ 'is-active': btn.active }"
      @mousedown.prevent="$emit('format', btn.command)"
    >
      <BIcon :icon="btn.icon" />
    </button>
  </div>
</template>

<script setup lang="ts">
import type { SelectionToolbarAction } from '../adapters/selectionAssistant';
import { ref, computed } from 'vue';
import { useServiceModelStore } from '@/stores/ai/serviceModel';
import { createNamespace } from '@/utils/namespace';

const [name] = createNamespace('', 'b-markdown-seltoolbar');

/**
 * 格式按钮的定义（由 host 注入，含当前激活态）。
 */
interface FormatButton {
  /** 按钮对应的动作类型 */
  command: SelectionToolbarAction;
  /** Iconify 图标名称 */
  icon: string;
  /** 当前是否为激活态（由 host 根据编辑器状态动态计算） */
  active?: boolean;
}

interface Props {
  /** 需要展示的格式按钮列表（已排除 ai/reference，由 host 注入） */
  formatButtons?: FormatButton[];
}

const props = withDefaults(defineProps<Props>(), {
  formatButtons: () => []
});

defineEmits<{
  (e: 'ai'): void;
  (e: 'reference'): void;
  (e: 'comment'): void;
  (e: 'format', command: SelectionToolbarAction): void;
}>();

/** 过滤掉 ai/reference/comment 动作（这些由父级按钮单独处理） */
const buttons = computed(() => props.formatButtons.filter((btn) => !['ai', 'reference', 'comment'].includes(btn.command)));

const isModelAvailable = ref(false);
const serviceModelStore = useServiceModelStore();

// ---- Model Availability ----

async function checkModelAvailability() {
  isModelAvailable.value = await serviceModelStore.isServiceAvailable('polish');
}

checkModelAvailability();
</script>

<style lang="less" scoped>
.b-markdown-seltoolbar {
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 4px;
  background: var(--bg-primary);
  border: var(--overlay-border-width) solid var(--border-primary);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-lg);
}

.b-markdown-seltoolbar__ai-btn {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--color-primary);
  white-space: nowrap;
  cursor: pointer;
  border: none;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);

  &:hover {
    background: var(--color-primary-bg-hover);
  }
}

.b-markdown-seltoolbar__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard), color var(--motion-duration-fast) var(--motion-easing-standard);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &.is-active {
    color: var(--color-primary);
    background: var(--bg-hover);
  }
}

.b-markdown-seltoolbar__divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border-primary);
}
</style>
