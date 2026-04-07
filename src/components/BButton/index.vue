<template>
  <button
    class="b-button"
    :class="[
      `b-button--${type}`,
      `b-button--${size}`,
      { 'b-button--disabled': disabled },
      { 'b-button--loading': loading },
      { 'b-button--icon': $slots.icon || icon },
      { 'b-button--block': block },
      { 'b-button--rounded': rounded },
      { 'b-button--square': square },
      { 'b-button--danger': danger }
    ]"
    :disabled="disabled || loading"
    @click="handleClick"
  >
    <div v-if="loading" class="b-button__loading">
      <div class="b-button__loading-spinner"></div>
    </div>
    <Icon v-if="$slots.icon || icon" class="b-button__icon" :icon="icon" />
    <slot v-if="$slots.icon" name="icon"></slot>
    <span class="b-button__text">
      <template v-if="isTwoCharacterText"> {{ textArray[0] }} {{ textArray[1] }} </template>
      <template v-else>
        <slot></slot>
      </template>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed, useSlots } from 'vue';
import { Icon } from '@iconify/vue';

interface Props {
  /** 按钮类型 */
  type?: 'primary' | 'secondary' | 'outline' | 'text';
  /** 按钮尺寸 */
  size?: 'small' | 'middle' | 'large';
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否加载中 */
  loading?: boolean;
  /** 是否显示为块级元素 */
  block?: boolean;
  /** 是否圆角 */
  rounded?: boolean;
  /** 是否方形 */
  square?: boolean;
  /** 图标 */
  icon?: string;
  /** 按钮文本 */
  text?: string;
  /** 危险按钮 */
  danger?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  type: 'primary',
  size: 'middle',
  disabled: false,
  loading: false,
  block: false,
  rounded: false,
  square: false,
  icon: '',
  text: '',
  danger: false
});

const emit = defineEmits(['click']);
const slots = useSlots();

// 获取按钮文本
const buttonText = computed(() => {
  if (props.text) {
    return props.text;
  }
  // 尝试从插槽中获取文本
  const defaultSlot = slots.default?.();
  if (defaultSlot && defaultSlot.length > 0) {
    const slotContent = defaultSlot[0];
    if (typeof slotContent === 'string') {
      return slotContent;
    }
    if (slotContent.children && typeof slotContent.children === 'string') {
      return slotContent.children;
    }
  }
  return '';
});

// 检查是否是两个字符的文本
const isTwoCharacterText = computed(() => {
  const text = buttonText.value.trim();
  return text.length === 2;
});

// 将文本拆分为数组
const textArray = computed(() => {
  return buttonText.value.trim().split('');
});

function handleClick(event: MouseEvent) {
  if (!props.disabled && !props.loading) {
    emit('click', event);
  }
}
</script>

<style scoped lang="less">
.b-button {
  display: inline-flex;
  gap: 8px;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  font-size: 14px;
  line-height: 1;
  color: #fff;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  background-color: var(--color-primary);
  border: none;
  border-radius: 6px;
  transition: all 0.3s ease;

  &:hover:not(.b-button--disabled, .b-button--loading) {
    background-color: var(--color-primary-hover);
  }

  &:active:not(.b-button--disabled, .b-button--loading) {
    background-color: var(--color-primary-active);
  }

  &--disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  &--loading {
    cursor: not-allowed;
    opacity: 0.8;
  }

  &--block {
    display: flex;
    width: 100%;
  }

  &--rounded {
    border-radius: 9999px;
  }

  &--square {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border-radius: 6px;

    &.b-button--small {
      width: 28px;
    }

    &.b-button--middle {
      width: 32px;
    }

    &.b-button--large {
      width: 44px;
    }

    .b-button__text {
      display: none;
    }

    .b-button__icon {
      margin: 0;
    }
  }

  // 尺寸
  &--small {
    height: 28px;
    padding: 0 12px;
    font-size: 12px;

    .b-button__icon {
      width: 14px;
      height: 14px;
    }
  }

  &--middle {
    height: 32px;
    padding: 0 16px;
    font-size: 14px;
  }

  &--large {
    height: 44px;
    padding: 0 20px;
    font-size: 16px;

    .b-button__icon {
      width: 18px;
      height: 18px;
    }
  }

  // 类型
  &--primary {
    color: #fff;
    background-color: var(--color-primary);

    &:hover:not(.b-button--disabled, .b-button--loading) {
      background-color: var(--color-primary-hover);
    }

    &:active:not(.b-button--disabled, .b-button--loading) {
      background-color: var(--color-primary-active);
    }
  }

  &--secondary {
    color: var(--text-primary);
    background-color: var(--bg-secondary);

    &:hover:not(.b-button--disabled, .b-button--loading) {
      background-color: var(--bg-active);
    }

    &:active:not(.b-button--disabled, .b-button--loading) {
      background-color: var(--bg-selected);
    }
  }

  &--outline {
    color: var(--color-primary);
    background-color: transparent;
    border: 1px solid var(--color-primary-border);

    &:hover:not(.b-button--disabled, .b-button--loading) {
      background-color: var(--color-primary-bg);
      border-color: var(--color-primary);
    }

    &:active:not(.b-button--disabled, .b-button--loading) {
      background-color: var(--color-primary-bg-hover);
    }
  }

  &--text {
    padding: 0 8px;
    color: var(--color-primary);
    background-color: transparent;

    &:hover:not(.b-button--disabled, .b-button--loading) {
      background-color: var(--color-primary-bg);
    }

    &:active:not(.b-button--disabled, .b-button--loading) {
      background-color: var(--color-primary-bg-hover);
    }
  }

  // danger 修饰符
  &--danger {
    &.b-button--primary {
      color: #fff;
      background-color: var(--color-danger);

      &:hover:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--color-danger-hover);
      }

      &:active:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--color-danger-active);
      }
    }

    &.b-button--secondary {
      color: var(--color-danger);
      background-color: var(--bg-secondary);

      &:hover:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--bg-active);
      }

      &:active:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--bg-selected);
      }
    }

    &.b-button--outline {
      color: var(--color-danger);
      background-color: transparent;
      border: 1px solid var(--color-danger-border);

      &:hover:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--color-danger-bg);
        border-color: var(--color-danger);
      }

      &:active:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--color-danger-bg-hover);
      }
    }

    &.b-button--text {
      padding: 0 8px;
      color: var(--color-danger);
      background-color: transparent;

      &:hover:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--color-primary-bg);
      }

      &:active:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--color-primary-bg-hover);
      }
    }

    .b-button__loading-spinner {
      border-color: rgb(255 255 255 / 30%);
      border-top-color: #fff;
    }

    &.b-button--outline .b-button__loading-spinner,
    &.b-button--text .b-button__loading-spinner,
    &.b-button--secondary .b-button__loading-spinner {
      border-color: rgb(0 0 0 / 10%);
      border-top-color: var(--color-danger);
    }
  }

  // 图标
  &--icon {
    .b-button__text {
      margin-left: 4px;
    }
  }

  &__icon {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
  }

  &__text {
    flex: 1;
  }

  &__loading {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;

    &-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgb(255 255 255 / 30%);
      border-top: 2px solid #fff;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
  }

  &--secondary .b-button__loading-spinner,
  &--outline .b-button__loading-spinner,
  &--text .b-button__loading-spinner {
    border-color: rgb(0 0 0 / 10%);
    border-top-color: var(--color-primary);
  }
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

// 深色模式
:deep(.dark) {
  .b-button {
    &--secondary {
      color: var(--text-primary);
      background-color: var(--bg-secondary);

      &:hover:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--bg-active);
      }
    }

    &--outline {
      color: var(--color-primary);
      border-color: var(--color-primary-border);

      &:hover:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--color-primary-bg);
        border-color: var(--color-primary);
      }
    }

    &--text {
      color: var(--color-primary);

      &:hover:not(.b-button--disabled, .b-button--loading) {
        background-color: var(--color-primary-bg);
      }
    }

    &--danger {
      &.b-button--primary {
        color: #fff;
        background-color: var(--color-danger);

        &:hover:not(.b-button--disabled, .b-button--loading) {
          background-color: var(--color-danger-hover);
        }

        &:active:not(.b-button--disabled, .b-button--loading) {
          background-color: var(--color-danger-active);
        }
      }

      &.b-button--secondary {
        color: var(--color-danger);
        background-color: var(--bg-secondary);

        &:hover:not(.b-button--disabled, .b-button--loading) {
          background-color: var(--bg-active);
        }

        &:active:not(.b-button--disabled, .b-button--loading) {
          background-color: var(--bg-selected);
        }
      }

      &.b-button--outline {
        color: var(--color-danger);
        border-color: var(--color-danger-border);

        &:hover:not(.b-button--disabled, .b-button--loading) {
          background-color: var(--color-danger-bg);
          border-color: var(--color-danger);
        }
      }

      &.b-button--text {
        color: var(--color-danger);

        &:hover:not(.b-button--disabled, .b-button--loading) {
          background-color: var(--color-danger-bg);
        }
      }

      .b-button__loading-spinner {
        border-color: rgb(255 255 255 / 10%);
        border-top-color: #fff;
      }

      &.b-button--outline .b-button__loading-spinner,
      &.b-button--text .b-button__loading-spinner,
      &.b-button--secondary .b-button__loading-spinner {
        border-color: rgb(255 255 255 / 10%);
        border-top-color: var(--color-danger);
      }
    }

    &--secondary .b-button__loading-spinner,
    &--outline .b-button__loading-spinner,
    &--text .b-button__loading-spinner {
      border-color: rgb(255 255 255 / 10%);
      border-top-color: var(--color-primary);
    }
  }
}
</style>
