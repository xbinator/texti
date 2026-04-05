<template>
  <Dropdown overlay-class-name="b-dropdown-overlay" :disabled="disabled">
    <slot></slot>

    <template #overlay>
      <div>
        <slot name="overlay"></slot>
      </div>
    </template>
  </Dropdown>
</template>

<script lang="ts" setup>
import { Dropdown } from 'ant-design-vue';

interface Props {
  disabled?: boolean;
}

withDefaults(defineProps<Props>(), {
  disabled: false
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
