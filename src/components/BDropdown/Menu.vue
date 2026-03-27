<template>
  <div class="b-dropdown-menu" :style="{ minWidth: typeof minWidth === 'number' ? `${minWidth}px` : minWidth }" @contextmenu.prevent>
    <template v-for="item in options" :key="item.value">
      <div
        class="b-dropdown-menu-item"
        :class="[item.class, rowClass, { disabled: item.disabled, danger: item.danger }, item.color]"
        @click="handleClickMenu(item)"
      >
        <slot name="menu" v-bind="{ record: item }">
          <span>{{ item.label }}</span>
        </slot>
      </div>

      <div v-if="item.divider" class="b-dropdown-menu-item-divider"></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { DropdownOption } from './type';

interface Props {
  value?: string | number;
  options: DropdownOption[];
  rowClass?: string;
  minWidth?: string | number;
}

withDefaults(defineProps<Props>(), { value: '', rowClass: '', minWidth: 'auto' });

const emit = defineEmits<{
  (e: 'update:value', value: string | number): void;
  (e: 'change', value: DropdownOption): void;
}>();

const active = defineModel<string | number>('value', { default: '' });

function handleClickMenu(record: DropdownOption) {
  if (record.disabled) return;

  if (record.value !== active.value) {
    active.value = record.value;
  }

  emit('change', record);
}
</script>

<style scoped>
.b-dropdown-menu {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  line-height: 32px;
  background: #fff;
  border-radius: 6px;
  box-shadow: 1px 1px 8px 0 rgb(0 0 0 / 12%);
}

.b-dropdown-menu-item {
  display: flex;
  align-items: center;
  padding: 0 8px;
  color: rgb(0 0 0 / 78%);
  cursor: pointer;
  border-radius: 6px;
}

.b-dropdown-menu-item:hover {
  color: rgb(0 0 0 / 78%);
  background-color: #f2f3f5;
}

.b-dropdown-menu-item.disabled {
  cursor: default;
  background-color: rgb(255 255 255 / 0%);
  opacity: 0.3;
}

.b-dropdown-menu-item.danger {
  color: #ff4d4f;
}

.b-dropdown-menu-item-divider {
  height: 1px;
  margin: 3px 8px;
  background: #e5e6eb;
}

:global(.dark) .b-dropdown-menu {
  background: #1f2937;
  box-shadow: 1px 1px 8px 0 rgb(0 0 0 / 30%);
}

:global(.dark) .b-dropdown-menu-item {
  color: rgb(255 255 255 / 78%);
}

:global(.dark) .b-dropdown-menu-item:hover {
  color: rgb(255 255 255 / 78%);
  background-color: #374151;
}

:global(.dark) .b-dropdown-menu-item.disabled {
  background-color: rgb(255 255 255 / 0%);
}

:global(.dark) .b-dropdown-menu-item.danger {
  color: #ff7875;
}

:global(.dark) .b-dropdown-menu-item-divider {
  background: #374151;
}
</style>
