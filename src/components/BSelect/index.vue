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
    :get-popup-container="getPopupContainer"
    @change="handleChange"
    @dropdown-visible-change="handleDropdownVisibleChange"
  >
    <template #suffixIcon>
      <BIcon v-if="loading" icon="lucide:loader-2" class="is-spinning" />
      <BIcon v-else-if="showSearch" icon="lucide:search" />
      <BIcon v-else icon="lucide:chevron-down" :size="suffixIconSize" />
    </template>

    <template #option="data">
      <div class="b-select-option" @mouseenter="hoveredTips = data.tips ?? undefined" @mouseleave="hoveredTips = undefined">
        <slot v-if="$slots.option" name="option" v-bind="data"></slot>
        <span v-else>{{ data.label }}</span>
      </div>
    </template>

    <template v-if="$slots.tagRender" #tagRender="data">
      <slot name="tagRender" v-bind="data"></slot>
    </template>

    <template #dropdownRender="{ menuNode }">
      <slot v-if="$slots.dropdownRender" name="dropdownRender" v-bind="{ menuNode }"></slot>
      <template v-else>
        <VNodes :vnodes="menuNode" />
        <div v-if="displayedTips" class="b-select-tips">
          <span>{{ displayedTips }}</span>
        </div>
      </template>
    </template>

    <slot></slot>
  </ASelect>
</template>

<script lang="ts" setup>
import type { SelectOption } from './types';
import { computed, ref, onMounted, defineComponent, Ref } from 'vue';
import { useVModel } from '@vueuse/core';

// Hoisted outside setup to avoid re-creating on every render
const VNodes = defineComponent({
  props: { vnodes: { type: Object, required: true } },
  render() {
    return this.vnodes;
  }
});

interface Props {
  placeholder?: string;
  value?: string | number | null;
  showArrow?: boolean;
  showSearch?: boolean;
  options?: SelectOption[];
  suffixIconSize?: number;
  loading?: boolean;
  isFillColor?: boolean;
  width?: number | string;
  defaultValue?: string | number;
  disabled?: boolean;
  size?: 'large' | 'middle' | 'small';
  getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
}

const props = withDefaults(defineProps<Props>(), {
  width: '100%',
  value: undefined,
  showArrow: true,
  showSearch: false,
  loading: false,
  placeholder: '请选择',
  options: undefined,
  suffixIconSize: 16,
  isFillColor: undefined,
  defaultValue: undefined,
  disabled: false,
  size: 'middle',
  getPopupContainer: undefined
});

const emit = defineEmits<{
  'update:value': [value: string | number | undefined];
  change: [value: string | number, option?: unknown];
}>();

const selected = useVModel(props, 'value', emit) as Ref<string | number>;

// Tips of the currently hovered option
const hoveredTips = ref<string | undefined>(undefined);

// Tips of the currently selected option
const selectedTips = computed<string | undefined>(() => {
  if (selected.value === undefined || !props.options) return undefined;
  return props.options.find((opt) => opt.value === selected.value)?.tips ?? undefined;
});

// Hover takes priority; fall back to selected option's tips
const displayedTips = computed(() => hoveredTips.value ?? selectedTips.value);

const viewWidth = computed(() => (typeof props.width === 'number' ? `${props.width}px` : props.width));

onMounted(() => {
  if (props.defaultValue !== undefined && props.value === undefined) {
    selected.value = props.defaultValue;
    emit('change', props.defaultValue);
  }
});

function handleChange(value: unknown, option: unknown): void {
  emit('change', value as string | number, option);
}

function handleDropdownVisibleChange(open: boolean): void {
  if (!open) hoveredTips.value = undefined;
}
</script>

<style lang="less" scoped>
.b-select {
  :deep(.ant-select-selector.ant-select-selector) {
    height: auto;
    font-family: var(--input-font-family);
    outline: none;
    background: var(--input-bg);
    border: var(--input-border-width) solid var(--input-border);
    border-radius: var(--input-radius);
    box-shadow: var(--input-shadow);
    transition: border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard),
      background var(--motion-duration-base) var(--motion-easing-standard);
  }

  &.ant-select.ant-select-focused:not(.ant-select-customize-input),
  &.ant-select.ant-select-open:not(.ant-select-customize-input) {
    :deep(.ant-select-selector.ant-select-selector) {
      outline: none;
      border-color: var(--input-focus-border);
      box-shadow: var(--input-active-shadow);
    }
  }

  &.is-fill-color {
    :deep(.ant-select-selector) {
      background: var(--bg-disabled);
      border-color: var(--bg-disabled);
    }

    &.ant-select-focused :deep(.ant-select-selector) {
      background: transparent;
    }
  }

  .is-spinning {
    animation: spin 1s linear infinite;
  }
}

.b-select-option {
  width: 100%;
}

.b-select-tips {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  background: var(--dropdown-bg);
  border-top: 1px solid var(--border-primary);
  border-radius: 0 0 var(--control-radius) var(--control-radius);
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
