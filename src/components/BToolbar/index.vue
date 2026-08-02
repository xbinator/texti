<!--
 * @file index.vue
 * @description BToolbar 顶部菜单工具栏组件。
 -->
<template>
  <BDropdownButton :show-icon="false" :options="options" :overlay-width="240">
    <div>{{ title }}</div>

    <template #menu="{ record }">
      <span v-if="shouldShowSelectedCheckColumn" class="toolbar-menu-item-check">
        <BIcon v-if="(record as ToolbarOption).selected" icon="lucide:check" />
      </span>
      <BTruncateText :text="(record as ToolbarOption).label" class="toolbar-menu-item-label" :class="{ 'is-active': (record as ToolbarOption).active }" />
      <div v-if="(record as ToolbarOption).shortcut" class="toolbar-menu-item-shortcut">
        <span
          v-for="(part, index) in getShortcutParts((record as ToolbarOption).shortcut as string)"
          :key="`${part}-${index}`"
          class="toolbar-menu-item-shortcut-key"
        >
          {{ part }}
        </span>
      </div>
    </template>
  </BDropdownButton>
</template>

<script setup lang="ts">
import type { ToolbarOption, ToolbarOptions } from './types';
import { computed } from 'vue';
import { getShortcutParts } from '@/utils/shortcut';

/**
 * BToolbar 组件属性。
 */
export interface Props {
  /** 工具栏按钮标题。 */
  title?: string;
  /** 是否在存在选中项时展示勾选列。 */
  showSelectedCheck?: boolean;
  /** 工具栏下拉菜单配置。 */
  options?: ToolbarOptions;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  showSelectedCheck: false,
  options: () => []
});

/** 是否需要为选中勾选图标预留列。 */
const shouldShowSelectedCheckColumn = computed<boolean>(
  (): boolean => props.showSelectedCheck && props.options.some((option): boolean => option.type !== 'divider' && option.selected === true)
);
</script>

<style lang="less" scoped>
.toolbar-menu-item-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  margin-right: 8px;
  color: var(--text-primary);
}

.toolbar-menu-item-label {
  flex: 1;
  width: 0;
  font-size: 13px;
  color: var(--text-primary);

  &.is-active {
    font-weight: 500;
  }
}

.toolbar-menu-item-shortcut {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  margin-left: 16px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.toolbar-menu-item-shortcut-key {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  padding: 0 6px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  color: var(--text-secondary);
  white-space: nowrap;
  background: var(--bg-hover);
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--control-radius);
}

:deep(.b-dropdown-menu) {
  min-width: 172px;
  padding: 6px;
  background: var(--dropdown-bg);
  border: var(--overlay-border-width) solid var(--dropdown-border);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-lg);
}

:deep(.b-dropdown-menu-item) {
  display: flex;
  gap: 8px;
  align-items: center;
  width: 100%;
  height: 32px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);

  &:hover {
    background: var(--bg-hover);
  }

  &.is-disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
    background: transparent;
  }

  &.is-active {
    background: var(--color-primary-bg);
  }
}

:deep(.b-dropdown-menu-divider) {
  height: 1px;
  margin: 4px 6px;
  background: var(--dropdown-divider);
}
</style>
