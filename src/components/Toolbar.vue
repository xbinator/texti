<template>
  <BDropdownButton :show-icon="false" :options="props.options" :min-width="220">
    <div>{{ title }}</div>

    <template #menu="{ record }">
      <span>{{ record.label }}</span>
    </template>
  </BDropdownButton>
</template>

<script setup lang="ts">
import type { DropdownOption } from './BDropdown/type';

interface Props {
  title?: string;
  //
  options?: DropdownOption[];
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  options: () => []
});
</script>
