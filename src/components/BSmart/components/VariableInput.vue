<!--
  @file VariableInput.vue
  @description 提供可编辑变量路径、变量树下拉和循环键盘导航的内部共享控件。
-->
<template>
  <div ref="rootRef" :class="name" @focusout="handleFocusOut">
    <AInput
      :class="bem('control')"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      :readonly="readonly"
      @input="handleInput"
      @keydown="handleKeydown"
    >
      <template #suffix>
        <button
          :class="bem('dropdown-button', { active: dropdownVisible })"
          type="button"
          :disabled="disabled || !hasVariables"
          @mousedown.prevent
          @click="toggleDropdown"
        >
          <BIcon icon="lucide:chevron-down" />
        </button>
      </template>
    </AInput>
    <VariableSelect
      :visible="dropdownVisible"
      :variables="visibleVariables"
      :position="dropdownPosition"
      :dropdown-width="dropdownWidth"
      :teleport="false"
      :inline-style="dropdownInlineStyle"
      :active-index="activeIndex"
      :scroll-active-into-view="dropdownVisible"
      @select="handleVariableSelect"
      @toggle="handleVariableToggle"
      @update:active-index="handleActiveIndexChange"
    />
  </div>
</template>

<script setup lang="ts">
import type { Variable, VariableOptionGroup } from '../types';
import type { VisibleVariable } from '../utils/variables';
import type { CSSProperties } from 'vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Input as AInput } from 'ant-design-vue';
import { createNamespace } from '@/utils/namespace';
import { scroll } from '@/utils/scroll';
import { findVariableAncestorValues, flattenVariables, getVisibleVariables } from '../utils/variables';
import VariableSelect from './VariableSelect.vue';

/** 默认下拉锚点位置，等待首次打开时同步为真实输入框位置。 */
const DEFAULT_DROPDOWN_POSITION = { top: 0, left: 0, bottom: 0 };
/** 默认下拉宽度，等待首次打开时同步为真实输入框宽度。 */
const DEFAULT_DROPDOWN_WIDTH = 300;
/** 变量下拉与输入框的间距。 */
const VARIABLE_DROPDOWN_GAP = 4;
/** 变量下拉最大高度，包含外层面板 padding。 */
const VARIABLE_DROPDOWN_MAX_HEIGHT = 316;

/**
 * 变量下拉展开方向。
 */
type VariableDropdownPlacement = 'top' | 'bottom';

/**
 * 共享变量输入组件属性。
 */
interface Props {
  /** 占位符 */
  placeholder?: string;
  /** 变量选项 */
  options?: VariableOptionGroup[];
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否只读；只读状态仍允许从变量列表选择 */
  readonly?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '',
  options: (): VariableOptionGroup[] => [],
  disabled: false,
  readonly: false
});

const emit = defineEmits<{
  /** 变量路径文本变化 */
  (e: 'change', value: string): void;
  /** 从列表选择变量 */
  (e: 'select', value: string): void;
}>();

const modelValue = defineModel<string>('value', { default: '' });
const [name, bem] = createNamespace('smart-variable-input');

/** 组件根节点。 */
const rootRef = ref<HTMLDivElement | null>(null);
/** 当前变量下拉是否打开。 */
const dropdownVisible = ref(false);
/** 变量下拉锚点位置。 */
const dropdownPosition = ref(DEFAULT_DROPDOWN_POSITION);
/** 变量下拉宽度。 */
const dropdownWidth = ref(DEFAULT_DROPDOWN_WIDTH);
/** 变量下拉展开方向。 */
const dropdownPlacement = ref<VariableDropdownPlacement>('bottom');
/** 变量下拉在当前滚动容器中的可用最大高度。 */
const dropdownMaxHeight = ref(VARIABLE_DROPDOWN_MAX_HEIGHT);
/** 当前键盘活动变量索引。 */
const activeIndex = ref(0);
/** 用户手动折叠的变量节点值集合。 */
const collapsedValues = ref<Set<string>>(new Set());

/** 变量树根节点。 */
const variableTrees = computed<Variable[]>((): Variable[] => props.options.flatMap((group: VariableOptionGroup): Variable[] => group.options));
/** 所有变量的扁平列表。 */
const allVariables = computed<Variable[]>((): Variable[] => flattenVariables(variableTrees.value));
/** 是否有变量可选。 */
const hasVariables = computed<boolean>((): boolean => allVariables.value.length > 0);
/** 当前下拉可见变量。 */
const visibleVariables = computed<VisibleVariable[]>((): VisibleVariable[] => getVisibleVariables(variableTrees.value, collapsedValues.value, ''));
/** 内联下拉样式。 */
const dropdownInlineStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    position: 'absolute',
    left: '0px',
    width: '100%',
    maxHeight: `${dropdownMaxHeight.value}px`,
    zIndex: 20
  };

  if (dropdownPlacement.value === 'top') {
    style.bottom = `calc(100% + ${VARIABLE_DROPDOWN_GAP}px)`;
  } else {
    style.top = `calc(100% + ${VARIABLE_DROPDOWN_GAP}px)`;
  }

  return style;
});

/**
 * 读取变量下拉应遵守的可视边界。
 * @returns 可视边界
 */
function readDropdownBoundary(): { top: number; bottom: number } {
  const scrollContainer = scroll.container(rootRef.value);

  if (scrollContainer instanceof HTMLElement) {
    const rect = scrollContainer.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  }

  return {
    top: 0,
    bottom: window.innerHeight || document.documentElement.clientHeight || 0
  };
}

/**
 * 同步变量下拉在滚动容器内的展开方向与高度。
 * @param rect - 输入根节点矩形
 */
function syncInlinePlacement(rect: DOMRect): void {
  const boundary = readDropdownBoundary();
  const spaceBelow = boundary.bottom - rect.bottom - VARIABLE_DROPDOWN_GAP;
  const spaceAbove = rect.top - boundary.top - VARIABLE_DROPDOWN_GAP;
  const shouldOpenAbove = spaceBelow < VARIABLE_DROPDOWN_MAX_HEIGHT && spaceAbove > spaceBelow;
  const availableHeight = shouldOpenAbove ? spaceAbove : spaceBelow;

  dropdownPlacement.value = shouldOpenAbove ? 'top' : 'bottom';
  dropdownMaxHeight.value = Math.max(0, Math.min(VARIABLE_DROPDOWN_MAX_HEIGHT, availableHeight));
}

/**
 * 同步变量下拉锚点位置与展开方式。
 */
function syncDropdownPosition(): void {
  const rect = rootRef.value?.getBoundingClientRect();
  if (!rect) {
    dropdownPosition.value = DEFAULT_DROPDOWN_POSITION;
    dropdownWidth.value = DEFAULT_DROPDOWN_WIDTH;
    dropdownPlacement.value = 'bottom';
    dropdownMaxHeight.value = VARIABLE_DROPDOWN_MAX_HEIGHT;
    return;
  }

  syncInlinePlacement(rect);
  dropdownPosition.value = { top: rect.top, left: rect.left, bottom: rect.bottom };
  dropdownWidth.value = rect.width || DEFAULT_DROPDOWN_WIDTH;
}

/**
 * 展开当前选中变量的所有祖先节点。
 */
function revealSelectedVariable(): void {
  const ancestorValues = findVariableAncestorValues(variableTrees.value, modelValue.value);
  if (ancestorValues.length === 0) {
    return;
  }

  const nextValues = new Set(collapsedValues.value);
  ancestorValues.forEach((value: string): void => {
    nextValues.delete(value);
  });
  collapsedValues.value = nextValues;
}

/**
 * 把键盘活动项同步到当前选中变量，未匹配时回退到首项。
 */
function syncActiveVariable(): void {
  const selectedIndex = visibleVariables.value.findIndex((variable: VisibleVariable): boolean => variable.value === modelValue.value);
  activeIndex.value = selectedIndex >= 0 ? selectedIndex : 0;
}

/**
 * 打开变量下拉并定位当前变量。
 */
function openDropdown(): void {
  if (!hasVariables.value || props.disabled) {
    return;
  }

  revealSelectedVariable();
  syncActiveVariable();
  syncDropdownPosition();
  dropdownVisible.value = true;
}

/**
 * 关闭变量下拉。
 */
function closeDropdown(): void {
  dropdownVisible.value = false;
  activeIndex.value = 0;
}

/**
 * 切换变量下拉打开状态。
 */
function toggleDropdown(): void {
  if (dropdownVisible.value) {
    closeDropdown();
  } else {
    openDropdown();
  }
}

/**
 * 处理变量路径输入。
 * @param event - 输入事件
 */
function handleInput(event: Event): void {
  if (props.disabled || props.readonly) {
    return;
  }

  const { target } = event;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  modelValue.value = target.value;
  emit('change', target.value);
}

/**
 * 处理变量列表选择。
 * @param variable - 被选中的变量
 */
function handleVariableSelect(variable: Variable): void {
  if (props.disabled) {
    return;
  }

  modelValue.value = variable.value;
  emit('change', variable.value);
  emit('select', variable.value);
  closeDropdown();
}

/**
 * 处理键盘导航变量下拉。
 * @param event - 键盘事件
 */
function handleKeydown(event: KeyboardEvent): void {
  if (props.disabled || !dropdownVisible.value || visibleVariables.value.length === 0) {
    return;
  }

  const itemCount = visibleVariables.value.length;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDropdown();
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    activeIndex.value = (activeIndex.value + 1) % itemCount;
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    activeIndex.value = (activeIndex.value - 1 + itemCount) % itemCount;
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    const variable = visibleVariables.value[activeIndex.value];
    if (variable) {
      handleVariableSelect(variable);
    }
  }
}

/**
 * 处理变量树节点展开状态切换。
 * @param variable - 被切换的变量
 */
function handleVariableToggle(variable: Variable): void {
  if (props.disabled) {
    return;
  }

  const nextValues = new Set(collapsedValues.value);
  if (nextValues.has(variable.value)) {
    nextValues.delete(variable.value);
  } else {
    nextValues.add(variable.value);
  }
  collapsedValues.value = nextValues;
}

/**
 * 处理变量活动项变更。
 * @param index - 活动项索引
 */
function handleActiveIndexChange(index: number): void {
  if (props.disabled) {
    return;
  }

  activeIndex.value = index;
}

/**
 * 判断焦点是否仍在组件或变量列表内部。
 * @param target - 下一个焦点目标
 * @returns 是否保持列表打开
 */
function isFocusInside(target: EventTarget | null): boolean {
  if (!(target instanceof Node)) {
    return false;
  }

  return Boolean(rootRef.value?.contains(target));
}

/**
 * 处理焦点离开组件。
 * @param event - 焦点事件
 */
function handleFocusOut(event: FocusEvent): void {
  if (!isFocusInside(event.relatedTarget)) {
    closeDropdown();
  }
}

/**
 * 判断指针事件是否发生在组件或变量列表外部。
 * @param event - 指针事件
 * @returns 是否为外部事件
 */
function isOutsidePointerEvent(event: PointerEvent): boolean {
  const { target } = event;
  if (!(target instanceof Node) || rootRef.value?.contains(target)) {
    return false;
  }

  return true;
}

/**
 * 处理外部指针按下。
 * @param event - 指针事件
 */
function handleDocumentPointerDown(event: PointerEvent): void {
  if (dropdownVisible.value && isOutsidePointerEvent(event)) {
    closeDropdown();
  }
}

watch(visibleVariables, (variables: VisibleVariable[]): void => {
  if (activeIndex.value >= variables.length) {
    activeIndex.value = Math.max(0, variables.length - 1);
  }
});

watch(
  () => props.disabled,
  (disabled: boolean): void => {
    if (disabled) {
      closeDropdown();
    }
  }
);

onMounted((): void => {
  document.addEventListener('pointerdown', handleDocumentPointerDown);
});

onBeforeUnmount((): void => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown);
});
</script>

<style lang="less" scoped>
.b-smart-variable-input {
  position: relative;
  width: 100%;
  min-width: 0;
}

.b-smart-variable-input__control {
  font-family: var(--font-sans);
  background: var(--input-bg);
  border: var(--input-border-width) solid var(--input-border);
  border-radius: var(--input-radius);
  box-shadow: var(--input-shadow);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    border-color: var(--border-hover);
  }

  &.ant-input-affix-wrapper-focused {
    border-color: var(--input-focus-border);
    box-shadow: var(--input-active-shadow);
  }

  :deep(.ant-input) {
    font-family: var(--font-sans);
    background: transparent;
  }

  :deep(.ant-input::placeholder) {
    color: var(--input-placeholder-color);
    opacity: 1;
  }
}

.b-smart-variable-input__dropdown-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: var(--input-icon-color);
  cursor: pointer;
  background: transparent;
  border: 0;

  &:hover,
  &.b-smart-variable-input__dropdown-button--active {
    color: var(--color-primary);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
}
</style>
