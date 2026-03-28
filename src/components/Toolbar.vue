<template>
  <BDropdownButton :show-icon="false" :options="options" :min-width="220">
    <div>{{ title }}</div>

    <template #menu="{ record }">
      <span class="toolbar-menu-item-label">{{ record.label }}</span>
      <span v-if="record.shortcut" class="toolbar-menu-item-shortcut">{{ formatShortcut(record.shortcut) }}</span>
    </template>
  </BDropdownButton>
</template>

<script setup lang="ts">
import type { DropdownOption } from './BDropdown/type';
import { computed, watch } from 'vue';
import { useMagicKeys, whenever } from '@vueuse/core';
import { isMac } from '@/utils/is';

export interface ToolbarOption extends DropdownOption {
  shortcut?: string;
}

interface Props {
  title?: string;
  options?: ToolbarOption[];
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
    if (option.shortcut && option.onClick && !option.disabled) {
      const keyCombo = getKeyName(option.shortcut);

      const stopFn = whenever(keys[keyCombo], () => option.onClick?.());
      stopFns.push(stopFn);

      if (isMacOS.value && option.shortcut.toLowerCase().includes('ctrl')) {
        const macKeyCombo = getKeyName(option.shortcut.replace(/ctrl/gi, 'meta'));

        const stopFnMac = whenever(keys[macKeyCombo], () => option.onClick?.());
        stopFns.push(stopFnMac);
      }
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
