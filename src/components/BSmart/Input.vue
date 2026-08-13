<!--
  @file Input.vue
  @description 使用显式静态模式或可编辑变量路径模式的单行 Smart 输入组件。
-->
<template>
  <div :class="name">
    <template v-if="variableMode">
      <VariableInput
        :value="variableDraft"
        :options="options"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        @update:value="handleVariableInput"
      />
      <button :class="bem('type-button')" type="button" :disabled="disabled" @click="switchToLiteralMode">
        <BIcon icon="lucide:type" />
      </button>
    </template>
    <template v-else>
      <AInput
        :class="bem('literal-control')"
        :value="literalValue"
        :placeholder="placeholder"
        :disabled="disabled"
        :readonly="readonly"
        @input="handleLiteralInput"
      />
      <button :class="bem('variable-button')" type="button" :disabled="disabled || !hasVariables" @click="switchToVariableMode">
        <BIcon icon="lucide:braces" />
      </button>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { BSmartInputValue, Variable, VariableOptionGroup } from './types';
import { computed, ref, watch } from 'vue';
import { Input as AInput } from 'ant-design-vue';
import { createNamespace } from '@/utils/namespace';
import VariableInput from './components/VariableInput.vue';
import { createLiteralValue, createVariableValue, isLiteralValue, isVariableValue } from './utils/value';
import { flattenVariables } from './utils/variables';

/**
 * 单行 Smart 输入组件属性。
 */
interface Props {
  /** 占位符 */
  placeholder?: string;
  /** 变量选项 */
  options?: VariableOptionGroup[];
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否只读；只读时仍允许从变量列表选择 */
  readonly?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: '',
  options: (): VariableOptionGroup[] => [],
  disabled: false,
  readonly: false
});

const emit = defineEmits<{
  /** 完整 Smart 值变化 */
  (e: 'change', value: BSmartInputValue): void;
}>();

const modelValue = defineModel<BSmartInputValue>('value', { default: (): BSmartInputValue => createLiteralValue('') });
const [name, bem] = createNamespace('smart-input');

/** 当前是否展示变量输入模式。 */
const variableMode = ref(isVariableValue(modelValue.value));
/** 当前变量路径草稿。 */
const variableDraft = ref(isVariableValue(modelValue.value) ? modelValue.value.value : '');
/** 静态输入展示值。 */
const literalValue = computed<string>((): string => (isLiteralValue(modelValue.value) ? modelValue.value.value : ''));
/** 变量树根节点。 */
const variableTrees = computed<Variable[]>((): Variable[] => props.options.flatMap((group: VariableOptionGroup): Variable[] => group.options));
/** 是否存在可选变量。 */
const hasVariables = computed<boolean>((): boolean => flattenVariables(variableTrees.value).length > 0);

/**
 * 写回完整 Smart 值并发送 change。
 * @param value - 新 Smart 值
 */
function updateValue(value: BSmartInputValue): void {
  modelValue.value = value;
  emit('change', value);
}

/**
 * 处理静态文本输入。
 * @param event - 输入事件
 */
function handleLiteralInput(event: Event): void {
  if (props.disabled || props.readonly) {
    return;
  }

  const { target } = event;
  if (target instanceof HTMLInputElement) {
    updateValue(createLiteralValue(target.value));
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

  updateValue(createVariableValue(path));
}

/**
 * 切换到变量输入模式。
 */
function switchToVariableMode(): void {
  if (props.disabled || !hasVariables.value) {
    return;
  }

  if (isVariableValue(modelValue.value)) {
    variableDraft.value = modelValue.value.value;
  } else if (isLiteralValue(modelValue.value) && typeof modelValue.value.value === 'string') {
    // 将当前文本带入变量草稿，避免切换界面时用户正在编辑的内容消失。
    variableDraft.value = modelValue.value.value;
  } else {
    variableDraft.value = '';
  }
  variableMode.value = true;
}

/**
 * 把当前变量路径显式转换成静态字符串。
 */
function switchToLiteralMode(): void {
  if (props.disabled) {
    return;
  }

  if (isLiteralValue(modelValue.value) && modelValue.value.value === variableDraft.value) {
    variableMode.value = false;
    return;
  }

  if (!variableDraft.value.trim() && !isVariableValue(modelValue.value)) {
    variableMode.value = false;
    return;
  }

  updateValue(createLiteralValue(variableDraft.value.trim() ? variableDraft.value : ''));
  variableMode.value = false;
}

watch([() => modelValue.value.type, () => modelValue.value.value], (): void => {
  const { value } = modelValue;
  if (isVariableValue(value)) {
    variableDraft.value = value.value;
    variableMode.value = true;
    return;
  }

  variableMode.value = false;
});
</script>

<style lang="less" scoped>
.b-smart-input {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 28px;
  gap: 6px;
  align-items: center;
  width: 100%;
  min-width: 0;
}

.b-smart-input__literal-control {
  min-width: 0;
  font-family: var(--font-sans);
  background: var(--input-bg);
  border: var(--input-border-width) solid var(--input-border);
  border-radius: var(--input-radius);
  box-shadow: var(--input-shadow);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    border-color: var(--border-hover);
  }

  &:focus {
    border-color: var(--input-focus-border);
    box-shadow: var(--input-active-shadow);
  }

  &::placeholder {
    color: var(--input-placeholder-color);
    opacity: 1;
  }
}

.b-smart-input__variable-button,
.b-smart-input__type-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--input-icon-color);
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
