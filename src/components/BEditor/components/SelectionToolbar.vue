<template>
  <div class="selection-toolbar">
    <template v-if="isModelAvailable">
      <div class="selection-toolbar__ai-btn" @mousedown.prevent="$emit('ai')">
        <Icon icon="lucide:sparkles" />
        <span>AI 助手</span>
      </div>
    </template>

    <div class="selection-toolbar__ai-btn" @mousedown.prevent="$emit('reference')">
      <Icon icon="lucide:message-square-plus" />
      <span>插入对话</span>
    </div>
    <div v-if="buttons.length" class="selection-toolbar__divider"></div>

    <button
      v-for="btn in buttons"
      :key="btn.command"
      type="button"
      class="selection-toolbar__btn"
      :class="{ 'is-active': btn.active }"
      @mousedown.prevent="$emit('format', btn.command)"
    >
      <Icon :icon="btn.icon" />
    </button>
  </div>
</template>

<script setup lang="ts">
import type { SelectionToolbarAction } from '../adapters/selectionAssistant';
import { ref, computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useServiceModelStore } from '@/stores/service-model';

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
  (e: 'format', command: SelectionToolbarAction): void;
}>();

/** 过滤掉 ai/reference 动作（这些由父级按钮单独处理） */
const buttons = computed(() => props.formatButtons.filter((btn) => btn.command !== 'ai' && btn.command !== 'reference'));

const isModelAvailable = ref(false);
const serviceModelStore = useServiceModelStore();

// ---- Model Availability ----

async function checkModelAvailability() {
  isModelAvailable.value = await serviceModelStore.isServiceAvailable('polish');
}

checkModelAvailability();
</script>

<style lang="less" scoped>
.selection-toolbar {
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
}

.selection-toolbar__ai-btn {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--color-primary);
  cursor: pointer;
  border: none;
  border-radius: 6px;
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--color-primary-bg-hover);
  }
}

.selection-toolbar__btn {
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
  border-radius: 6px;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &.is-active {
    color: var(--color-primary);
    background: var(--bg-hover);
  }
}

.selection-toolbar__divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border-primary);
}
</style>
