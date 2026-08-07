<!--
  @file SettingsItem.vue
  @description 基础设置页局部设置项组件，统一 label、提示文案与右侧控件布局。
-->
<template>
  <div class="basic-settings-item">
    <div class="basic-settings-item__meta">
      <div class="basic-settings-item__label">{{ label }}</div>
      <div v-if="hint" class="basic-settings-item__hint">{{ hint }}</div>
    </div>

    <div :class="['basic-settings-item__control', { 'basic-settings-item__control--fixed': hasFixedControlWidth }]" :style="controlStyle">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue';
import { computed } from 'vue';
import { addCssUnit } from '@/utils/css';

defineOptions({ name: 'BasicSettingsItem' });

/**
 * 设置项控件宽度配置。
 */
type SettingsItemControlWidth = number | string;

/**
 * 基础设置项 props。
 */
interface Props {
  /** 设置项标题 */
  label: string;
  /** 设置项说明文案 */
  hint?: string;
  /** 右侧控件固定宽度，数字按 px 处理 */
  controlWidth?: SettingsItemControlWidth;
}

const props = withDefaults(defineProps<Props>(), {
  hint: '',
  controlWidth: undefined
});

/** 是否使用固定控件宽度。 */
const hasFixedControlWidth = computed<boolean>(() => props.controlWidth !== undefined);

/** 控件区域样式，通过 CSS 变量保留响应式覆盖能力。 */
const controlStyle = computed<CSSProperties>(() => {
  const width = addCssUnit(props.controlWidth);

  if (!width) {
    return {};
  }

  return {
    '--basic-settings-item-control-width': width
  } as CSSProperties;
});
</script>

<style scoped lang="less">
.basic-settings-item {
  display: flex;
  gap: 16px;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
  padding: 0 16px;
  transition: background var(--motion-duration-base) var(--motion-easing-standard);

  & + & {
    border-top: var(--surface-border-width) solid var(--border-tertiary);
  }

  &:hover,
  &:focus-within {
    background: var(--bg-hover);
  }
}

.basic-settings-item__meta {
  flex: 1;
  min-width: 0;
  padding: 12px 0;
}

.basic-settings-item__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  user-select: none;
}

.basic-settings-item__hint {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary);
}

.basic-settings-item__control {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  min-width: 0;
}

.basic-settings-item__control--fixed {
  width: var(--basic-settings-item-control-width);
}

@media (width <= 720px) {
  .basic-settings-item {
    flex-direction: column;
    align-items: flex-start;
  }

  .basic-settings-item__control,
  .basic-settings-item__control--fixed {
    justify-content: flex-start;
    width: 100%;
  }

  .basic-settings-item__control :deep(.b-select) {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .basic-settings-item {
    transition: none;
  }
}
</style>
