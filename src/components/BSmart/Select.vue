<!--
  @file Select.vue
  @description 在静态选项和可编辑变量路径之间显式切换的单值 Smart 选择组件。
-->
<template>
  <div :class="name">
    <template v-if="variableMode">
      <VariableInput :value="variableDraft" :options="variables" :placeholder="placeholder" :disabled="disabled" @update:value="handleVariableInput" />
      <button :class="bem('select-button')" type="button" :disabled="disabled" @click="switchToSelectMode">
        <BIcon icon="lucide:list" />
      </button>
    </template>
    <template v-else>
      <BSelect
        :value="selectedKey"
        :options="selectOptions"
        :placeholder="placeholder"
        :disabled="disabled"
        :width="width"
        @update:value="handleSelectValueUpdate"
      />
      <button :class="bem('variable-button')" type="button" :disabled="disabled || !hasVariables" @click="switchToVariableMode">
        <BIcon icon="lucide:braces" />
      </button>
    </template>
  </div>
</template>

<script setup lang="ts" generic="T extends BSmartSelectStaticValue = BSmartSelectStaticValue">
import type { BSmartSelectOption, BSmartSelectStaticValue, BSmartSelectValue, Variable, VariableOptionGroup } from './types';
import { computed, ref, watch } from 'vue';
import { createNamespace } from '@/utils/namespace';
import VariableInput from './components/VariableInput.vue';
import { createLiteralValue, createVariableValue, isLiteralValue, isVariableValue } from './utils/value';
import { flattenVariables } from './utils/variables';

/**
 * 内部静态选项映射。
 */
interface TextSelectOptionEntry<TValue extends BSmartSelectStaticValue> {
  /** BSelect 使用的字符串值 */
  key: string;
  /** 原始选项 */
  option: BSmartSelectOption<TValue>;
}

/**
 * BSmartSelect 组件属性。
 */
interface Props<TValue extends BSmartSelectStaticValue> {
  /** 静态选项 */
  options?: BSmartSelectOption<TValue>[];
  /** 变量候选 */
  variables?: VariableOptionGroup[];
  /** 占位符 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 选择框宽度 */
  width?: number | string;
}

const props = withDefaults(defineProps<Props<T>>(), {
  options: (): BSmartSelectOption<T>[] => [],
  variables: (): VariableOptionGroup[] => [],
  placeholder: '请选择',
  disabled: false,
  width: '100%'
});

const modelValue = defineModel<BSmartSelectValue<T>>('value', { default: undefined });
const [name, bem] = createNamespace('smart-select');

/** 当前是否展示变量输入模式。 */
const variableMode = ref(isVariableValue(modelValue.value));
/** 当前变量路径草稿。 */
const variableDraft = ref(isVariableValue(modelValue.value) ? modelValue.value.value : '');
/** 变量树根节点。 */
const variableTrees = computed<Variable[]>((): Variable[] => props.variables.flatMap((group: VariableOptionGroup): Variable[] => group.options));
/** 是否存在可选变量。 */
const hasVariables = computed<boolean>((): boolean => flattenVariables(variableTrees.value).length > 0);

/**
 * 创建静态选项内部 key。
 * @param value - 静态选项值
 * @param index - 选项下标
 * @returns 内部 key
 */
function createOptionKey(value: T, index: number): string {
  return `static:${index}:${typeof value}:${JSON.stringify(value)}`;
}

/** 静态选项映射。 */
const optionEntries = computed<TextSelectOptionEntry<T>[]>((): TextSelectOptionEntry<T>[] =>
  props.options.map(
    (option: BSmartSelectOption<T>, index: number): TextSelectOptionEntry<T> => ({
      key: createOptionKey(option.value, index),
      option
    })
  )
);
/** BSelect 选项。 */
const selectOptions = computed<Array<{ label: string; value: string }>>(
  (): Array<{ label: string; value: string }> =>
    optionEntries.value.map((entry: TextSelectOptionEntry<T>): { label: string; value: string } => ({
      label: entry.option.label,
      value: entry.key
    }))
);
/** 当前静态选项内部 key。 */
const selectedKey = computed<string | undefined>((): string | undefined => {
  if (!isLiteralValue(modelValue.value)) {
    return undefined;
  }

  const literalValue = modelValue.value.value as T;
  return optionEntries.value.find((entry: TextSelectOptionEntry<T>): boolean => entry.option.value === literalValue)?.key;
});

/**
 * 处理静态选项变化。
 * @param value - 内部选项值
 */
function handleSelectValueUpdate(value: string | number | undefined): void {
  const entry = optionEntries.value.find((item: TextSelectOptionEntry<T>): boolean => item.key === value);
  if (entry) {
    modelValue.value = createLiteralValue(entry.option.value);
    variableMode.value = false;
  }
}

/**
 * 处理变量路径输入或选择。
 * @param path - 新变量路径
 */
function handleVariableInput(path: string): void {
  variableDraft.value = path;

  if (!path.trim()) {
    // 空路径只保留为未提交草稿，避免写入非法变量值或在输入事件期间卸载控件。
    return;
  }

  modelValue.value = createVariableValue(path);
}

/**
 * 切换到变量输入模式。
 */
function switchToVariableMode(): void {
  if (props.disabled || !hasVariables.value) {
    return;
  }

  variableDraft.value = isVariableValue(modelValue.value) ? modelValue.value.value : '';
  variableMode.value = true;
}

/**
 * 返回静态选择界面但不改写当前模型。
 */
function switchToSelectMode(): void {
  if (props.disabled) {
    return;
  }

  if (!variableDraft.value.trim() && isVariableValue(modelValue.value)) {
    modelValue.value = undefined;
  }

  variableMode.value = false;
}

watch([() => modelValue.value?.type, () => modelValue.value?.value], (): void => {
  const { value } = modelValue;
  if (isVariableValue(value)) {
    variableDraft.value = value.value;
    variableMode.value = true;
    return;
  }

  variableDraft.value = '';
  variableMode.value = false;
});
</script>

<style lang="less" scoped>
.b-smart-select {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  gap: 6px;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.b-smart-select__variable-button,
.b-smart-select__select-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-secondary);
  cursor: pointer;
  background: var(--bg-primary);
  border: var(--control-border-width) solid var(--border-primary);
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    color: var(--color-primary);
    border-color: var(--color-primary-border);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
}
</style>
