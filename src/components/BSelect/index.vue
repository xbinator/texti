<template>
  <ASelect
    v-model:value="selected"
    class="b-select"
    :show-search="showSearch"
    :show-arrow="showArrow"
    :placeholder="placeholder"
    :options="options"
    :disabled="disabled"
    :size="size"
    :style="{ width: viewWidth }"
    :class="{ 'is-fill-color': isFillColor }"
    @change="handleChange"
  >
    <template #suffixIcon>
      <Icon v-if="loading" icon="lucide:loader-2" class="is-spinning" />
      <Icon v-else-if="showSearch" icon="lucide:search" />
      <Icon v-else icon="lucide:chevron-down" :style="{ fontSize: `${suffixIconSize}px` }" />
    </template>

    <template v-if="$slots.option" #option="data">
      <slot name="option" v-bind="data"></slot>
    </template>

    <template v-if="$slots.tagRender" #tagRender="data">
      <slot name="tagRender" v-bind="data"></slot>
    </template>

    <template v-if="$slots.dropdownRender" #dropdownRender="data">
      <slot name="dropdownRender" v-bind="data"></slot>
    </template>

    <slot></slot>
  </ASelect>
</template>

<script lang="ts" setup>
import type { SelectProps } from 'ant-design-vue';
import { computed, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useVModel } from '@vueuse/core';

interface Props {
  placeholder?: string;
  value?: string | number;
  showArrow?: boolean;
  showSearch?: boolean;
  options?: SelectProps['options'];
  suffixIconSize?: number;
  loading?: boolean;
  isFillColor?: boolean;
  width?: number | string;
  defaultValue?: string | number;
  disabled?: boolean;
  size?: 'large' | 'middle' | 'small';
}

const props = withDefaults(defineProps<Props>(), {
  width: '100%',
  value: undefined,
  showArrow: true,
  showSearch: false,
  loading: false,
  placeholder: '请选择',
  options: undefined,
  suffixIconSize: 12,
  isFillColor: undefined,
  defaultValue: undefined,
  disabled: false,
  size: 'middle'
});

const emit = defineEmits<{
  'update:value': [value: string | number | undefined];
  change: [value: unknown, option?: unknown];
}>();

const selected = useVModel(props, 'value', emit);

const viewWidth = computed(() => {
  if (typeof props.width === 'number') {
    return `${props.width}px`;
  }
  return props.width;
});

function handleChange(value: unknown, option: unknown): void {
  emit('change', value, option);
}

watch(
  () => [props.defaultValue, props.value],
  () => {
    if (props.defaultValue === undefined) return;

    if (props.value !== undefined) return;

    selected.value = props.defaultValue;
    emit('change', props.defaultValue);
  },
  { immediate: true }
);
</script>

<style lang="less" scoped>
.b-select {
  :deep(.ant-select-selector) {
    transition: all 0.2s ease;
  }

  &.is-fill-color {
    :deep(.ant-select-selector) {
      background-color: #f2f3f5;
      border-color: #f2f3f5;
    }

    &.ant-select-focused {
      :deep(.ant-select-selector) {
        background-color: transparent;
      }
    }
  }

  .is-spinning {
    animation: spin 1s linear infinite;
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}
</style>
