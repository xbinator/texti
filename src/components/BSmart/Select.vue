<!--
  @file Select.vue
  @description 支持变量模板覆盖的单值选择组件。
-->
<template>
  <div :class="name">
    <template v-if="inputMode">
      <BSmartInput v-model:value="inputValue" :options="variables" :placeholder="placeholder" :disabled="disabled" replace-entire-value />
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
      <button :class="bem('variable-button')" type="button" :disabled="disabled || !hasVariables" @click="switchToInputMode">
        <BIcon icon="lucide:braces" />
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { BSmartSelectOption, BSmartSelectStaticValue, BSmartSelectValue, Variable, VariableOptionGroup } from './types';
import { computed, ref, watch } from 'vue';
import { createNamespace } from '@/utils/namespace';
import { flattenVariables } from './utils/variables';

/**
 * 内部静态选项映射。
 */
interface TextSelectOptionEntry {
  /** BSelect 使用的字符串值 */
  key: string;
  /** 原始选项 */
  option: BSmartSelectOption;
}

/**
 * BSmartSelect 组件属性。
 */
interface Props {
  /** 静态选项 */
  options?: BSmartSelectOption[];
  /** 变量候选 */
  variables?: VariableOptionGroup[];
  /** 占位符 */
  placeholder?: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 选择框宽度 */
  width?: number | string;
}

const props = withDefaults(defineProps<Props>(), {
  options: (): BSmartSelectOption[] => [],
  variables: (): VariableOptionGroup[] => [],
  placeholder: '请选择',
  disabled: false,
  width: '100%'
});

const modelValue = defineModel<BSmartSelectValue>('value', { default: undefined });
const [name, bem] = createNamespace('smart-select');

/** 整体变量模板匹配表达式。 */
const WHOLE_TEMPLATE_PATTERN = /^\s*\{\{[\s\S]+?\}\}\s*$/;

/**
 * 创建静态选项内部 key。
 * @param value - 静态选项值
 * @param index - 选项下标
 * @returns 内部 key
 */
function createOptionKey(value: BSmartSelectStaticValue, index: number): string {
  return `static:${index}:${typeof value}:${JSON.stringify(value)}`;
}

/**
 * 判断值是否为完整变量模板。
 * @param value - 待判断值
 * @returns 是否为完整变量模板
 */
function isTemplateValue(value: unknown): value is string {
  return typeof value === 'string' && WHOLE_TEMPLATE_PATTERN.test(value);
}

/**
 * 读取完整变量模板内部表达式。
 * @param value - 模板值
 * @returns 去掉外层 {{ }} 的表达式
 */
function readTemplateExpression(value: string): string {
  const matched = value.match(WHOLE_TEMPLATE_PATTERN);

  return matched ? value.replace(/^\s*\{\{\s*/, '').replace(/\s*\}\}\s*$/, '') : value;
}

/**
 * 将输入表达式格式化为完整变量模板。
 * @param value - 输入表达式或完整模板
 * @returns 完整变量模板
 */
function formatTemplateValue(value: string): string {
  if (WHOLE_TEMPLATE_PATTERN.test(value)) {
    return value;
  }

  const expression = value.trim();

  return expression ? `{{ ${expression} }}` : '';
}

/**
 * 判断两个静态选项值是否相同。
 * @param left - 左侧值
 * @param right - 右侧值
 * @returns 是否相同
 */
function isSameStaticValue(left: BSmartSelectStaticValue, right: BSmartSelectValue): boolean {
  return left === right;
}

/** 当前是否使用变量输入模式。 */
const inputMode = ref(isTemplateValue(modelValue.value));
/** 变量树根节点。 */
const variableTrees = computed<Variable[]>((): Variable[] => props.variables.flatMap((group: VariableOptionGroup): Variable[] => group.options));
/** 是否存在可选变量。 */
const hasVariables = computed<boolean>((): boolean => flattenVariables(variableTrees.value).length > 0);
/** 变量输入框值。 */
const inputValue = computed<string>({
  get: (): string => (typeof modelValue.value === 'string' ? readTemplateExpression(modelValue.value) : ''),
  set: (value: string): void => {
    modelValue.value = formatTemplateValue(value);
  }
});
/** 静态选项映射。 */
const optionEntries = computed<TextSelectOptionEntry[]>((): TextSelectOptionEntry[] =>
  props.options.map(
    (option: BSmartSelectOption, index: number): TextSelectOptionEntry => ({
      key: createOptionKey(option.value, index),
      option
    })
  )
);
/** BSelect 选项。 */
const selectOptions = computed<Array<{ label: string; value: string }>>(
  (): Array<{ label: string; value: string }> =>
    optionEntries.value.map((entry: TextSelectOptionEntry): { label: string; value: string } => ({
      label: entry.option.label,
      value: entry.key
    }))
);
/** 当前 BSelect 选中值。 */
const selectedKey = computed<string | undefined>((): string | undefined => {
  if (isTemplateValue(modelValue.value)) {
    return undefined;
  }

  return optionEntries.value.find((entry: TextSelectOptionEntry): boolean => isSameStaticValue(entry.option.value, modelValue.value))?.key;
});

/**
 * 处理静态选项变化。
 * @param value - 内部选项值
 */
function handleSelectValueUpdate(value: string | number | undefined): void {
  const entry = optionEntries.value.find((item: TextSelectOptionEntry): boolean => item.key === value);

  if (entry) {
    modelValue.value = entry.option.value;
    inputMode.value = false;
  }
}

/**
 * 切换到变量输入模式。
 */
function switchToInputMode(): void {
  if (props.disabled || !hasVariables.value) return;

  inputMode.value = true;
}

/**
 * 切换到静态选择模式。
 */
function switchToSelectMode(): void {
  if (props.disabled) return;

  inputMode.value = false;
}

watch(modelValue, (value: BSmartSelectValue): void => {
  inputMode.value = isTemplateValue(value);
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
}

.b-smart-select__variable-button:hover,
.b-smart-select__select-button:hover {
  color: var(--color-primary);
  border-color: var(--color-primary-border);
}

.b-smart-select__variable-button:disabled,
.b-smart-select__select-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
