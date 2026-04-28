<template>
  <ADropdown overlay-class-name="b-dropdown-overlay" :disabled="disabled" :placement="placement" :align="align">
    <slot></slot>

    <template #overlay>
      <div>
        <slot name="overlay"></slot>
      </div>
    </template>
  </ADropdown>
</template>

<script lang="ts" setup>
import { DropdownProps } from 'ant-design-vue';

interface Props {
  disabled?: boolean;
  placement?: DropdownProps['placement'];
  align?: DropdownProps['align'];
}

withDefaults(defineProps<Props>(), {
  disabled: false,
  placement: 'bottomLeft',
  align: undefined
});
</script>

<style scoped>
.b-dropdown-overlay {
  padding: 4px;
  outline: none;
  background-color: var(--dropdown-bg);
  border: 1px solid var(--dropdown-border);
  border-radius: 8px;
}
</style>
