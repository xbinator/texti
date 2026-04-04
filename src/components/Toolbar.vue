<template>
  <BDropdownButton :show-icon="false" :options="options" :overlay-width="240">
    <div>{{ title }}</div>

    <template #menu="{ record }">
      <span v-if="props.showSelectedCheck" class="toolbar-menu-item-check">
        <Icon v-if="(record as ToolbarOption).selected" icon="lucide:check" />
      </span>
      <span class="toolbar-menu-item-label">{{ (record as ToolbarOption).label }}</span>
      <span v-if="(record as ToolbarOption).shortcut" class="toolbar-menu-item-shortcut">
        <span
          v-for="(part, index) in getShortcutParts((record as ToolbarOption).shortcut as string)"
          :key="`${part}-${index}`"
          class="toolbar-menu-item-shortcut-key"
        >
          {{ part }}
        </span>
      </span>
    </template>
  </BDropdownButton>
</template>

<script setup lang="ts">
import type { DropdownOptionItem, DropdownOptionDivider } from './BDropdown/type';
import { computed, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useMagicKeys, whenever, useEventListener } from '@vueuse/core';
import { isMac } from '@/utils/is';

export interface ToolbarOption extends DropdownOptionItem {
  // 是否选中当前项
  selected?: boolean;
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

function getKeyName(shortcut: string): string {
  return shortcut.replace(/\+/g, '_').replace(/\s+/g, '').toLowerCase();
}

const keys = useMagicKeys();

function setupShortcuts() {
  const stopFns: (() => void)[] = [];

  props.options?.forEach((option) => {
    if (option.type === 'divider') return;

    const shouldBindShortcut = option.enableShortcut !== false;
    if (!(shouldBindShortcut && option.shortcut && option.onClick && !option.disabled)) return;

    const keyCombo = getKeyName(option.shortcut);

    const stopFn = whenever(keys[keyCombo], () => option.onClick?.());
    stopFns.push(stopFn);

    const stopPreventDefault = useEventListener(
      'keydown',
      (e) => {
        const shortcut = option.shortcut?.toLowerCase();
        if (!shortcut) return;

        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;
        const alt = e.altKey;

        const hasCtrl = shortcut.includes('ctrl') || shortcut.includes('meta');
        const hasShift = shortcut.includes('shift');
        const hasAlt = shortcut.includes('alt');

        const key = shortcut.split('+').pop()?.trim();

        if (ctrl === hasCtrl && shift === hasShift && alt === hasAlt && e.key.toLowerCase() === key) {
          e.preventDefault();
        }
      },
      { capture: true }
    );
    stopFns.push(stopPreventDefault);

    if (isMacOS.value && option.shortcut.toLowerCase().includes('ctrl')) {
      const macKeyCombo = getKeyName(option.shortcut.replace(/ctrl/gi, 'meta'));

      const stopFnMac = whenever(keys[macKeyCombo], () => option.onClick?.());
      stopFns.push(stopFnMac);
    }
  });

  return () => stopFns.forEach((stop) => stop());
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
  color: rgb(0 0 0 / 78%);
}

.toolbar-menu-item-label {
  flex: 1;
}

.toolbar-menu-item-shortcut {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  margin-left: 24px;
  font-size: 12px;
  color: rgb(0 0 0 / 45%);
}

.toolbar-menu-item-shortcut-key {
  height: 18px;
  padding: 0 6px;
  font-variant-numeric: tabular-nums;
  line-height: 18px;
  color: rgb(0 0 0 / 65%);
  white-space: nowrap;
  background: rgb(0 0 0 / 2%);
  border: 1px solid rgb(0 0 0 / 12%);
  border-radius: 4px;
}
</style>
