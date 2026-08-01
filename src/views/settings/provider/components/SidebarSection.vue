<template>
  <div class="sidebar-section">
    <div v-if="title && !collapsed" class="section-header">
      <div class="section-title-wrapper" @click="handleTitleClick">
        <div class="section-title">{{ title }}</div>
        <Icon v-if="collapsible" :icon="sectionCollapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'" width="12" height="12" class="collapse-icon" />
      </div>
      <button v-if="actionIcon" type="button" class="section-actions" :title="actionTitle" @click.stop="emit('action')">
        <Icon :icon="actionIcon" width="14" height="14" />
      </button>
    </div>
    <div v-else-if="$slots.title && !collapsed" class="section-title">
      <slot name="title"></slot>
    </div>

    <div v-show="!collapsible || !sectionCollapsed" class="section-content">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

interface Props {
  actionIcon?: string;
  actionTitle?: string;
  collapsed?: boolean;
  collapsible?: boolean;
  sectionCollapsed?: boolean;
  title?: string;
}

const props = withDefaults(defineProps<Props>(), {
  actionIcon: '',
  actionTitle: '',
  collapsed: false,
  collapsible: false,
  sectionCollapsed: false,
  title: ''
});

const emit = defineEmits<{
  (e: 'action'): void;
  (e: 'update:sectionCollapsed', value: boolean): void;
}>();

function handleTitleClick(): void {
  if (!props.collapsible || props.collapsed) return;
  emit('update:sectionCollapsed', !props.sectionCollapsed);
}
</script>

<style scoped lang="less">
.sidebar-section {
  display: flex;
  flex-direction: column;
  user-select: none;

  & + .sidebar-section {
    margin-top: 20px;
  }
}

.section-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 12px;
  background: var(--bg-primary);
}

.section-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.section-title-wrapper {
  display: flex;
  gap: 4px;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.collapse-icon {
  color: var(--text-tertiary);
  transition: transform var(--motion-duration-base) var(--motion-easing-standard);
}

.section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* slot title 分支：作为 sidebar-section 直接子元素时粘性吸顶 */
.sidebar-section > .section-title {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0 8px 12px;
  background: var(--bg-primary);
}

.section-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  color: var(--text-tertiary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-fast) var(--motion-easing-standard), background var(--motion-duration-fast) var(--motion-easing-standard);

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
}
</style>
