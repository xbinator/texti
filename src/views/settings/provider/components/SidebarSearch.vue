<template>
  <div class="sidebar-header">
    <button class="sidebar-collapse-btn" :title="collapsed ? '展开侧边栏' : '折叠侧边栏'" @click="emit('toggle')">
      <Icon :icon="collapsed ? 'lucide:panel-left-open' : 'lucide:panel-left-close'" width="15" height="15" />
    </button>
    <div v-show="!collapsed" class="sidebar-search">
      <Icon icon="lucide:search" width="13" height="13" class="search-icon" />
      <input :value="modelValue" class="search-input" placeholder="搜索服务商" @input="handleInput" />
      <button v-show="modelValue" class="search-clear" @click="emit('update:modelValue', '')">
        <Icon icon="lucide:x" width="12" height="12" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

interface Props {
  collapsed: boolean;
  modelValue: string;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: 'toggle'): void;
  (e: 'update:modelValue', value: string): void;
}>();

function handleInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value);
}
</script>

<style scoped lang="less">
.sidebar-header {
  display: flex;
  gap: 6px;
  align-items: center;
  height: 32px;
  margin-bottom: 12px;
}

.sidebar-collapse-btn {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
  transition: color 0.15s, background 0.15s;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
}

.sidebar-search {
  display: flex;
  flex: 1;
  gap: 6px;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid transparent;
  border-radius: 6px;
  transition: border-color 0.15s;

  &:focus-within {
    border-color: var(--color-primary);
  }
}

.search-icon {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

.search-input {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text-primary);
  outline: none;
  background: transparent;
  border: none;

  &::placeholder {
    color: var(--text-quaternary, var(--text-tertiary));
  }
}

.search-clear {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  padding: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 50%;
  transition: color 0.15s;

  &:hover {
    color: var(--text-primary);
  }
}
</style>
