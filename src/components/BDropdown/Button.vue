<template>
  <Dropdown v-model:open="visible" :trigger="trigger">
    <div class="b-dropdown-button" :class="[{ 'is-active': visible, 'is-small': props.size === 'small', 'is-bordered': props.bordered }]">
      <slot>
        <div class="b-dropdown-button-content" :style="{ width }">{{ contentPrefix }}{{ label }}</div>
      </slot>

      <svg class="dropdown-icon" width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: visible ? 'rotate(180deg)' : 'rotate(0deg)' }"/>
      </svg>
    </div>

    <template #overlay>
      <DropdownMenu v-model:value="active" :options="options" :row-class="rowClass" @change="handleActiveChange">
        <template #menu="record">
          <slot name="menu" v-bind="record"></slot>
        </template>
      </DropdownMenu>
    </template>
  </Dropdown>
</template>

<script setup lang="ts">
import type { DropdownOption } from './type';
import { computed, watch } from 'vue';
import { addCssUnit } from '../../utils/common';
import DropdownMenu from './Menu.vue';

interface Props {
  value?: string | number;
  open?: boolean;
  rowClass?: string;
  contentWidth?: string | number;
  options?: DropdownOption[];
  menuClickHide?: boolean;
  overlayClassName?: string;
  contentPrefix?: string;
  size?: 'small' | 'middle' | 'large';
  bordered?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  options: () => [],
  contentWidth: 'auto',
  rowClass: '',
  value: '',
  menuClickHide: false,
  open: false,
  overlayClassName: '',
  contentPrefix: '',
  size: 'middle',
  bordered: false
});

const emit = defineEmits(['update:value', 'change', 'update:open']);

const active = defineModel<string | number>('value', { default: '' });

const width = computed(() => addCssUnit(props.contentWidth));

const label = computed(() => props.options.find((el) => active.value === el.value)?.label);

const visible = defineModel<boolean>('open', { default: false });

function handleActiveChange(record: DropdownOption) {
  props.menuClickHide && (visible.value = false);

  emit('change', record);
}

watch(
  () => props.open,
  (value) => (visible.value = value)
);
</script>

<style scoped>
.b-dropdown-button {
  display: flex;
  gap: 10px;
  align-items: center;
  height: 32px;
  padding: 0 10px;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.65);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.3s;
}

.b-dropdown-button:hover {
  color: rgba(0, 0, 0, 0.88);
  background-color: rgba(68, 83, 130, 0.1);
}

.b-dropdown-button.is-active {
  color: rgba(0, 0, 0, 0.88);
  background-color: rgba(68, 83, 130, 0.1);
}

.b-dropdown-button.is-small {
  height: 28px;
}

.b-dropdown-button.is-bordered {
  border: 1px solid #d9d9d9;
}

.b-dropdown-button-content {
  margin-right: 4px;
}

.dropdown-icon {
  transition: transform 0.3s;
}

:global(.dark) .b-dropdown-button {
  color: rgba(255, 255, 255, 0.65);
}

:global(.dark) .b-dropdown-button:hover {
  color: rgba(255, 255, 255, 0.88);
  background-color: rgba(255, 255, 255, 0.1);
}

:global(.dark) .b-dropdown-button.is-active {
  color: rgba(255, 255, 255, 0.88);
  background-color: rgba(255, 255, 255, 0.1);
}

:global(.dark) .b-dropdown-button.is-bordered {
  border-color: #4b5563;
}
</style>
