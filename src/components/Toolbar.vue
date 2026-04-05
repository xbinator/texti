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
import { computed, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useShortcuts } from '@/hooks/useShortcuts';
import { isMac } from '@/utils/is';

export interface ToolbarOption extends DropdownOptionItem {
  // 是否选中当前项
  selected?: boolean;
  // 激活状态
  active?: boolean;
  // 快捷键
  shortcut?: string;
  // 是否启用快捷键
  enableShortcut?: boolean;
}

export interface Props {
  // 工具栏标题
  title?: string;
  // 是否显示选中对勾
  showSelectedCheck?: boolean;
  // 工具栏选项
  options?: (ToolbarOption | DropdownOptionDivider)[];
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  showSelectedCheck: false,
  options: () => []
});

const isMacOS = computed(() => isMac());

function formatShortcut(shortcut: string): string {
  if (isMacOS.value) {
    return shortcut.replace(/Ctrl/g, '⌘').replace(/Shift/g, '⇧').replace(/Alt/g, '⌥');
  }
  return shortcut;
}

function getShortcutParts(shortcut: string): string[] {
  const parts = shortcut
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (!isMacOS.value) return parts;

  const macParts: string[] = [];
  const isFunctionKey = /^f\d+$/i.test(parts[parts.length - 1] || '');

  if (isFunctionKey) {
    macParts.push('fn');
  }

  parts.forEach((part) => {
    if (/^ctrl$/i.test(part)) {
      macParts.push('⌘');
    } else if (/^meta$/i.test(part)) {
      macParts.push('⌘');
    } else if (/^shift$/i.test(part)) {
      macParts.push('⇧');
    } else if (/^alt$/i.test(part)) {
      macParts.push('⌥');
    } else {
      macParts.push(formatShortcut(part));
    }
  });

  return macParts;
}

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
    color: var(--color-primary);
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
