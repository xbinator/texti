<!--
  @file index.vue
  @description 通用选择器组件，支持选项提示、下拉底部扩展和自定义下拉渲染。
-->
<template>
  <ASelect
    v-model:value="selectValue"
    class="b-select"
    :open="dropdownOpen"
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
      <slot
        v-if="$slots.dropdownRender"
        name="dropdownRender"
        v-bind="{ closeDropdown, displayedTips, menuNode, selected: selectedKey, selectedOption }"
      ></slot>
      <template v-else>
        <VNodes :vnodes="menuNode" />
        <div v-if="displayedTips || $slots.dropdownFooter" class="b-select-extra">
          <div v-if="displayedTips" class="b-select-tips">
            <span>{{ displayedTips }}</span>
          </div>
          <div v-if="$slots.dropdownFooter" class="b-select-footer">
            <slot name="dropdownFooter" v-bind="dropdownFooterProps"></slot>
          </div>
        </div>
      </template>
    </template>

    <slot></slot>
  </ASelect>
</template>

<script lang="ts" setup>
import type { SelectOption } from './types';
import type { SelectValue } from 'ant-design-vue/es/select';
import { computed, defineComponent, onMounted, ref, type Ref } from 'vue';
import { useVModel } from '@vueuse/core';

// Hoisted outside setup to avoid re-creating on every render
const VNodes = defineComponent({
  props: { vnodes: { type: Object, required: true } },
  render() {
    return this.vnodes;
  }
});

interface Props {
  /** 占位提示文案。 */
  placeholder?: string;
  /** 当前选中值。 */
  value?: string | number | null;
  /** 是否显示下拉箭头。 */
  showArrow?: boolean;
  /** 是否启用搜索。 */
  showSearch?: boolean;
  /** 下拉选项列表。 */
  options?: SelectOption[];
  /** 下拉箭头尺寸。 */
  suffixIconSize?: number;
  /** 是否显示加载中图标。 */
  loading?: boolean;
  /** 是否使用填充色样式。 */
  isFillColor?: boolean;
  /** 组件宽度。 */
  width?: number | string;
  /** 默认值，仅在外部未传 value 时生效。 */
  defaultValue?: string | number;
  /** 是否禁用。 */
  disabled?: boolean;
  /** 组件尺寸。 */
  size?: 'large' | 'middle' | 'small';
  /** 下拉容器挂载位置。 */
  getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
}

/**
 * 下拉底部插槽参数。
 */
interface DropdownFooterSlotProps {
  /** 关闭下拉菜单。 */
  closeDropdown: () => void;
  /** 当前选中值。 */
  selected: string | number | undefined;
  /** 当前选中选项。 */
  selectedOption: SelectOption | undefined;
  /** 当前可见提示文案。 */
  displayedTips: string | undefined;
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

const selected = useVModel(props, 'value', emit) as Ref<string | number | null | undefined>;
const dropdownOpen = ref<boolean>(false);

/**
 * 归一化单选值，过滤 null，并忽略 Select 的非单值输出。
 * @param value - 原始选择值
 * @returns 可用于单选场景比较的原始值
 */
function normalizeSelectValue(value: SelectValue | null | undefined): string | number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return value;
  }

  return undefined;
}

/**
 * ASelect 的双向绑定代理。
 */
const selectValue = computed<SelectValue>({
  get(): SelectValue {
    return normalizeSelectValue(selected.value);
  },
  set(value: SelectValue): void {
    selected.value = normalizeSelectValue(value);
  }
});

/**
 * 当前用于匹配选项和对外暴露的单值。
 */
const selectedKey = computed<string | number | undefined>(() => normalizeSelectValue(selected.value));

// Tips of the currently hovered option
const hoveredTips = ref<string | undefined>(undefined);

/** 当前选中的选项。 */
const selectedOption = computed<SelectOption | undefined>(() => {
  if (selectedKey.value === undefined || !props.options) return undefined;
  return props.options.find((opt) => opt.value === selectedKey.value);
});

// Tips of the currently selected option
const selectedTips = computed<string | undefined>(() => {
  if (selectedOption.value === undefined || !props.options) return undefined;
  return selectedOption.value?.tips ?? undefined;
});

// Hover takes priority; fall back to selected option's tips
const displayedTips = computed(() => hoveredTips.value ?? selectedTips.value);

/**
 * 关闭下拉菜单。
 */
function closeDropdown(): void {
  dropdownOpen.value = false;
  hoveredTips.value = undefined;
}

/**
 * 下拉底部扩展区插槽参数。
 */
const dropdownFooterProps = computed<DropdownFooterSlotProps>(() => ({
  closeDropdown,
  displayedTips: displayedTips.value,
  selected: selectedKey.value,
  selectedOption: selectedOption.value
}));

const viewWidth = computed(() => (typeof props.width === 'number' ? `${props.width}px` : props.width));

onMounted(() => {
  if (props.defaultValue !== undefined && props.value === undefined) {
    selected.value = props.defaultValue;
    emit('change', props.defaultValue);
  }
});

/**
 * 转发选中值变化。
 * @param value - 新的选中值
 * @param option - 当前选中项
 */
function handleChange(value: unknown, option: unknown): void {
  emit('change', value as string | number, option);
}

/**
 * 处理下拉展开状态变化。
 * @param open - 当前下拉是否展开
 */
function handleDropdownVisibleChange(open: boolean): void {
  dropdownOpen.value = open;
  if (!open) hoveredTips.value = undefined;
}
</script>

<style lang="less" scoped>
.b-select {
  :deep(.ant-select-selector.ant-select-selector) {
    height: auto;
    font-family: var(--font-sans);
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

.b-select-extra {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid var(--border-primary);
}

.b-select-tips {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  padding: 8px 12px 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
  background: var(--dropdown-bg);
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
