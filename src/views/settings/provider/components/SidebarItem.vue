<template>
  <div class="sidebar-item" :class="{ active, collapsed }" :title="title" @click="emit('click')">
    <img v-if="logo" class="provider-logo" :src="logo" :alt="label" />
    <Icon v-else-if="icon" :icon="icon" width="16" height="16" />
    <Icon v-else-if="isCustom" icon="lucide:bot" width="16" height="16" />
    <BModelIcon v-else-if="provider" :provider="provider" :size="16" />
    <span v-if="!collapsed" class="item-label">{{ label }}</span>
    <span v-if="!collapsed && count !== undefined" class="count">{{ count }}</span>
    <slot v-if="!collapsed" name="extra"></slot>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import BModelIcon from '@/components/BModelIcon/index.vue';

interface Props {
  active?: boolean;
  collapsed?: boolean;
  count?: number;
  icon?: string;
  isCustom?: boolean;
  label: string;
  logo?: string;
  provider?: string;
  title?: string;
}

withDefaults(defineProps<Props>(), {
  active: false,
  collapsed: false,
  count: undefined,
  icon: '',
  isCustom: false,
  logo: '',
  provider: '',
  title: ''
});

const emit = defineEmits<{ (e: 'click'): void }>();
</script>

<style scoped lang="less">
.sidebar-item {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);

    :deep(.edit-btn) {
      opacity: 1;
    }
  }

  &.active {
    font-weight: 500;
    color: var(--text-primary);
    background: var(--color-primary-bg);

    :deep(.edit-btn) {
      opacity: 1;
    }
  }

  &.collapsed {
    justify-content: center;
    padding: 8px 0;
  }
}

.provider-logo {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  object-fit: cover;
  border-radius: 4px;
}

.item-label {
  min-width: 0;
}

.count {
  padding: 1px 6px;
  margin-left: auto;
  font-size: 11px;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  border-radius: 8px;
}
</style>
