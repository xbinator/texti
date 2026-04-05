<template>
  <BDropdownButton :show-icon="false" :options="options" :overlay-width="240">
    <div>{{ title }}</div>

    <template #menu="{ record }">
      <span v-if="props.showSelectedCheck" class="toolbar-menu-item-check">
        <Icon v-if="(record as ToolbarOption).selected" icon="lucide:check" />
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
import type { DropdownOptionItem, DropdownOptionDivider } from './BDropdown/type';
import { watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useShortcuts } from '@/hooks/useShortcuts';
import { getShortcutParts } from '@/utils/shortcut';

export interface ToolbarOption extends DropdownOptionItem {
  selected?: boolean;
  active?: boolean;
  shortcut?: string;
  enableShortcut?: boolean;
}

export interface Props {
  title?: string;
  showSelectedCheck?: boolean;
  options?: (ToolbarOption | DropdownOptionDivider)[];
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  showSelectedCheck: false,
  options: () => []
});

const { registerShortcuts } = useShortcuts();

function setupShortcuts() {
  const shortcuts = [];

  for (let i = 0; i < props.options.length; i++) {
    const option = props.options[i];

    if (option.type === 'divider') {
      continue;
    }

    const toolbarOption = option as ToolbarOption;
    const shouldBindShortcut = toolbarOption.enableShortcut !== false;
    const isEnabled = toolbarOption.disabled !== true;

    if (shouldBindShortcut && !!toolbarOption.shortcut && !!toolbarOption.onClick && isEnabled) {
      shortcuts.push({ key: toolbarOption.shortcut!, handler: () => toolbarOption.onClick!(), enabled: true, preventDefault: true });
    }
  }

  return registerShortcuts(shortcuts);
}

let cleanup: (() => void) | undefined;

watch(
  () => props.options,
  () => {
    cleanup?.();
    cleanup = setupShortcuts();
  },
  { immediate: true, deep: true }
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
  height: 18px;
  padding: 0 6px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  color: var(--text-secondary);
  white-space: nowrap;
  background: var(--bg-hover);
  border: 1px solid var(--border-primary);
  border-radius: 4px;
}

// 参考 CurrentBlockMenu 的样式
:deep(.b-dropdown-button) {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: var(--shadow-dropdown);
  transition: all 0.15s ease;

  &:hover,
  &.is-active {
    color: var(--text-primary);
    background: var(--bg-tertiary);
    border-color: var(--border-primary);
  }
}

:deep(.b-dropdown-menu) {
  min-width: 172px;
  padding: 6px;
  background: var(--dropdown-bg);
  border: 1px solid var(--dropdown-border);
  border-radius: 10px;
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
  border-radius: 8px;
  transition: background-color 0.15s ease;

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
