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
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 6px 16px 0 rgb(0 0 0 / 8%), 0 3px 6px -4px rgb(0 0 0 / 12%), 0 9px 28px 8px rgb(0 0 0 / 5%);
}

:global(.dark) .b-dropdown-overlay {
  background-color: #1f2937;
  box-shadow: 0 6px 16px 0 rgb(0 0 0 / 30%), 0 3px 6px -4px rgb(0 0 0 / 40%), 0 9px 28px 8px rgb(0 0 0 / 20%);
}
</style>
