<template>
  <BDropdownButton :show-icon="false" :options="options" :overlay-width="220">
    <div>{{ title }}</div>

    <template #menu="{ record }">
      <span class="toolbar-menu-item-label">{{ (record as ToolbarOption).label }}</span>
      <span v-if="(record as ToolbarOption).shortcut" class="toolbar-menu-item-shortcut">
        {{ formatShortcut((record as ToolbarOption).shortcut as string) }}
      </span>
    </template>
  </BDropdownButton>
</template>

<script setup lang="ts">
import type { DropdownOptionItem, DropdownOptionDivider } from './BDropdown/type';
import { computed, watch } from 'vue';
import { useMagicKeys, whenever, useEventListener } from '@vueuse/core';
import { isMac } from '@/utils/is';

interface ToolbarOption extends DropdownOptionItem {
  shortcut?: string;
}

export interface Props {
  title?: string;
  //
  options?: (ToolbarOption | DropdownOptionDivider)[];
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  options: () => []
});

const isMacOS = computed(() => isMac());

function formatShortcut(shortcut: string): string {
  if (isMacOS.value) {
    return shortcut.replace(/Ctrl/g, '⌘').replace(/Shift/g, '⇧').replace(/Alt/g, '⌥');
  }
  return shortcut;
}

function getKeyName(shortcut: string): string {
  return shortcut.replace(/\+/g, '_').replace(/\s+/g, '').toLowerCase();
}

const keys = useMagicKeys();

function setupShortcuts() {
  const stopFns: (() => void)[] = [];

  props.options?.forEach((option) => {
    if (option.type === 'divider') return;

    if (!(option.shortcut && option.onClick && !option.disabled)) return;

    const keyCombo = getKeyName(option.shortcut);

    const stopFn = whenever(keys[keyCombo], () => option.onClick?.());
    stopFns.push(stopFn);

    const stopPreventDefault = useEventListener('keydown', (e) => {
      const shortcut = option.shortcut?.toLowerCase();
      if (!shortcut) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const alt = e.altKey;

      const hasCtrl = shortcut.includes('ctrl') || shortcut.includes('meta');
      const hasShift = shortcut.includes('shift');
      const hasAlt = shortcut.includes('alt');

      const key = shortcut.split('+').pop();

      if (ctrl === hasCtrl && shift === hasShift && alt === hasAlt && e.key.toLowerCase() === key) {
        e.preventDefault();
      }
    });
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
.toolbar-menu-item-label {
  flex: 1;
}

.toolbar-menu-item-shortcut {
  margin-left: 24px;
  font-size: 12px;
  color: rgb(0 0 0 / 45%);
}
</style>
