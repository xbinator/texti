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
  margin-right: 6px;
  color: var(--text-primary);
}

.toolbar-menu-item-label {
  flex: 1;
  width: 0;

  &.is-active {
    font-weight: 500;
  }
}

.toolbar-menu-item-shortcut {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  margin-left: 24px;
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
</style>
