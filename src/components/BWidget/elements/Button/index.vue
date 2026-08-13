<!--
  @file index.vue
  @description BWidget 按钮元素中间Widget视图。
-->
<template>
  <div class="widget-button-element">
    <button
      :aria-busy="buttonLoading ? 'true' : 'false'"
      class="widget-button-element__button"
      :class="{ 'is-loading': buttonLoading, disabled: buttonBlocked }"
      type="button"
      @click.stop="handleButtonClick"
    >
      <span v-if="buttonLoading" class="widget-button-element__loading" aria-hidden="true">
        <span class="widget-button-element__loading-spinner"></span>
      </span>
      <span class="widget-button-element__text">{{ buttonText }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { WidgetButtonElementMetadata } from './schema';
import type { WidgetShapeElement } from '../../types';
import { computed, toRef } from 'vue';
import { useElementAction } from '../../hooks/useElementAction';
import { useElementValue } from '../../hooks/useElementValue';

/**
 * 按钮元素中间Widget视图入参。
 */
interface Props {
  /** 当前按钮元素 */
  element?: WidgetShapeElement<WidgetButtonElementMetadata>;
}

const props = defineProps<Props>();
/** 当前按钮元素响应式引用。 */
const elementRef = toRef(props, 'element');
/** 按钮展示文字（渲染态，已解析变量）。 */
const buttonText = useElementValue(elementRef, 'text', { smart: true, transform: 'text' });
/** 是否禁用按钮交互。 */
const buttonDisabled = useElementValue(elementRef, 'disabled', { smart: true, transform: 'boolean' });
/** 是否展示加载态并阻止重复点击。 */
const buttonLoading = useElementValue(elementRef, 'loading', { smart: true, transform: 'boolean' });
/** 点击动作执行器。 */
const actionRunner = useElementAction(elementRef, 'actions');

/** 按钮是否阻止点击动作。 */
const buttonBlocked = computed<boolean>((): boolean => buttonDisabled.value || buttonLoading.value);

/**
 * 处理按钮点击，调用运行态中的同名业务方法。
 */
function handleButtonClick(): void {
  if (buttonBlocked.value) return;

  actionRunner();
}
</script>

<style lang="less" scoped>
.widget-button-element {
  width: 100%;
  height: 100%;
}

.widget-button-element__button {
  position: relative;
  width: 100%;
  min-width: 0;
  height: 100%;
  overflow: hidden;
  font: inherit;
  color: inherit;
  text-align: inherit;
  cursor: pointer;
  background: transparent;
  border: 0;
  border-radius: inherit;

  &.is-loading {
    cursor: not-allowed;
    opacity: 0.8;
  }

  &.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
}

.widget-button-element__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.widget-button-element__loading-spinner {
  width: 1em;
  height: 1em;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 999px;
  animation: widget-button-element-loading-spin 0.8s linear infinite;
}

.widget-button-element__text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes widget-button-element-loading-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
