<!--
  @file ControlPanel.vue
  @description Widget设计设置面板的盒模型数值控件，支持全部、四边和四角编辑。
-->
<template>
  <div class="control-panel">
    <BSectionItem :label="label">
      <span class="control-panel__main">
        <BInputNumber v-model:value="allValue" :min="0" :placeholder="isIndividualValue ? '自定义' : '请输入'" @change="handleAllValueChange" />
        <button class="control-panel__toggle" :class="{ 'is-active': isPanelExpanded }" @click="toggleExpanded">
          <BIcon icon="lucide:grid-2x2" :size="15" />
        </button>
      </span>
    </BSectionItem>

    <div v-if="isManuallyExpanded" class="control-panel__advanced">
      <BSectionItem v-for="option in targetOptions" :key="option.value" :label="option.label">
        <BInputNumber :min="0" :value="getTargetValue(option.value)" @change="(value: ValueType) => handleTargetValueUpdate(option.value, value)" />
      </BSectionItem>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ValueType } from '@/components/BInputNumber/types';
import type { WidgetBoxSides, WidgetBoxSideValue, WidgetCornerRadius, WidgetCornerRadiusValue } from '@/components/BWidget/types';

/**
 * 控件面板模式。
 */
type ControlPanelMode = 'sides' | 'corners';

/**
 * 控件面板可编辑值。
 */
type ControlPanelValue = WidgetBoxSideValue | WidgetCornerRadiusValue;

/**
 * 四边独立目标。
 */
type SideTarget = 'top' | 'right' | 'bottom' | 'left';

/**
 * 四角独立目标。
 */
type CornerTarget = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

/**
 * 可独立编辑的目标。
 */
type ControlPanelTarget = SideTarget | CornerTarget;

/**
 * 目标选项。
 */
interface ControlPanelTargetOption<T extends ControlPanelTarget = ControlPanelTarget> {
  /** 目标值 */
  value: T;
  /** 显示标签 */
  label: string;
}

/**
 * 控件面板属性。
 */
interface Props {
  /** 控件标题 */
  label: string;
  /** 控件模式 */
  mode: ControlPanelMode;
  /** 当前值 */
  value?: ControlPanelValue;
}

defineOptions({ name: 'ControlPanel' });

const props = withDefaults(defineProps<Props>(), {
  value: 0
});

const emit = defineEmits<{
  /** 更新当前值 */
  'update:value': [value: ControlPanelValue];
}>();

/** 四边目标选项。 */
const sideTargetOptions: ControlPanelTargetOption<SideTarget>[] = [
  { value: 'top', label: '上' },
  { value: 'right', label: '右' },
  { value: 'bottom', label: '下' },
  { value: 'left', label: '左' }
];

/** 四角目标选项。 */
const cornerTargetOptions: ControlPanelTargetOption<CornerTarget>[] = [
  { value: 'topLeft', label: '左上' },
  { value: 'topRight', label: '右上' },
  { value: 'bottomRight', label: '右下' },
  { value: 'bottomLeft', label: '左下' }
];

/**
 * 判断当前值是否为四边值。
 * @param value - 当前值
 * @returns 是否为四边值
 */
function isBoxSidesValue(value: ControlPanelValue | undefined): value is WidgetBoxSides {
  return typeof value === 'object' && value !== null && 'top' in value;
}

/**
 * 判断当前值是否为四角圆角值。
 * @param value - 当前值
 * @returns 是否为四角圆角值
 */
function isCornerRadiusValue(value: ControlPanelValue | undefined): value is WidgetCornerRadius {
  return typeof value === 'object' && value !== null && 'topLeft' in value;
}

/**
 * 归一化输入数值，兼容 Ant Design Vue 原生 change 事件与受控组件的直接取值。
 * @param value - 原始值，可能是事件对象、字符串、数字或空值
 * @returns 非负数字
 */
function normalizeInputValue(value: string | number | null | undefined | Event): number {
  const rawValue = value instanceof Event ? (value.target as HTMLInputElement | null)?.value : value;
  const numericValue = Number(rawValue ?? 0);

  if (!Number.isFinite(numericValue)) {
    return 0;
  }

  return Math.max(0, numericValue);
}

/**
 * 读取统一数值。
 * @param value - 当前值
 * @returns 统一数值
 */
function getAllValue(value: ControlPanelValue | undefined): number {
  if (typeof value === 'number') {
    return normalizeInputValue(value);
  }

  if (isBoxSidesValue(value)) {
    return normalizeInputValue(value.top);
  }

  if (isCornerRadiusValue(value)) {
    return normalizeInputValue(value.topLeft);
  }

  return 0;
}

/** 统一输入框显示值。 */
const allValue = ref<ValueType | undefined>(typeof props.value === 'number' ? props.value : undefined);

/** 当前值是否为独立值（四边或四角分别设置）。 */
const isIndividualValue = computed<boolean>(() => typeof props.value === 'object' && props.value !== null);

/** 用户是否手动展开了独立编辑面板。 */
const isManuallyExpanded = ref<boolean>(isIndividualValue.value);

/** 独立编辑面板的展开状态：手动展开，或当前值本就是独立值时始终展示。 */
const isPanelExpanded = computed<boolean>(() => isManuallyExpanded.value || isIndividualValue.value);

watch(
  (): ControlPanelValue => props.value,
  (value: ControlPanelValue): void => {
    allValue.value = typeof value === 'number' ? value : undefined;
  }
);

/** 当前模式对应的独立目标。 */
const targetOptions = computed<ControlPanelTargetOption[]>(() => (props.mode === 'sides' ? sideTargetOptions : cornerTargetOptions));

/** 当前值归一化后的四边值（仅 sides 模式下使用）。 */
const currentSides = computed<WidgetBoxSides>(() => {
  const { value } = props;

  if (isBoxSidesValue(value)) {
    return {
      top: normalizeInputValue(value.top),
      right: normalizeInputValue(value.right),
      bottom: normalizeInputValue(value.bottom),
      left: normalizeInputValue(value.left)
    };
  }

  const baseValue = getAllValue(value);

  return { top: baseValue, right: baseValue, bottom: baseValue, left: baseValue };
});

/** 当前值归一化后的四角圆角值（仅 corners 模式下使用）。 */
const currentCorners = computed<WidgetCornerRadius>(() => {
  const { value } = props;

  if (isCornerRadiusValue(value)) {
    return {
      topLeft: normalizeInputValue(value.topLeft),
      topRight: normalizeInputValue(value.topRight),
      bottomRight: normalizeInputValue(value.bottomRight),
      bottomLeft: normalizeInputValue(value.bottomLeft)
    };
  }

  const baseValue = getAllValue(value);

  return { topLeft: baseValue, topRight: baseValue, bottomRight: baseValue, bottomLeft: baseValue };
});

/**
 * 读取目标显示值。
 * @param target - 独立目标
 * @returns 当前目标数值
 */
function getTargetValue(target: ControlPanelTarget): number {
  return props.mode === 'sides' ? currentSides.value[target as SideTarget] : currentCorners.value[target as CornerTarget];
}

/**
 * 切换独立值编辑面板的展开状态。
 */
function toggleExpanded(): void {
  isManuallyExpanded.value = !isManuallyExpanded.value;
}

/**
 * 处理统一数字输入提交。
 * @param value - AInputNumber change 事件值
 */
function handleAllValueChange(value: ValueType): void {
  const nextValue = typeof value === 'number' ? value : Number(value) || 0;

  emit('update:value', nextValue);
}

/**
 * 处理独立数字输入更新。
 * @param target - 独立目标
 * @param value - 输入值
 */
function handleTargetValueUpdate(target: ControlPanelTarget, value: ValueType): void {
  const nextValue = typeof value === 'number' ? value : Number(value) || 0;

  allValue.value = undefined;

  const nextBoxValue: ControlPanelValue =
    props.mode === 'sides' ? { ...currentSides.value, [target]: nextValue } : { ...currentCorners.value, [target]: nextValue };

  emit('update:value', nextBoxValue);
}
</script>

<style scoped lang="less">
.control-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-panel__main {
  display: flex;
  gap: 6px;
  align-items: center;
  width: 100%;
}

.control-panel__toggle {
  display: flex;
  flex-shrink: 0;
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
  transition: color var(--motion-duration-fast) var(--motion-easing-standard), background var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);
}

.control-panel__toggle:hover,
.control-panel__toggle.is-active {
  color: var(--color-primary);
  border-color: var(--color-primary-border);
}

.control-panel__advanced {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding-left: 36px;
}
</style>
