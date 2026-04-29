<template>
  <button
    :class="bem([type, size, { disabled, loading, icon: $slots.icon || icon, block, rounded, square, danger }])"
    :disabled="disabled || loading"
    @click="handleClick"
  >
    <div v-if="loading" :class="bem('loading')">
      <div :class="bem('loading-spinner')"></div>
    </div>
    <Icon v-if="icon" :class="bem('icon')" :icon="icon" />
    <slot></slot>
  </button>
</template>

<script setup lang="ts">
import type { BButtonProps as Props } from './types';
import { Icon } from '@iconify/vue';
import { createNamespace } from '@/utils/namespace';

const [, bem] = createNamespace('button');

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

function handleClick(event: MouseEvent) {
  if (!props.disabled && !props.loading) {
    emit('click', event);
  }
}
</script>

<style scoped lang="less">
.b-button {
  position: relative;
  display: inline-flex;
  gap: 6px;
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

  // 尺寸
  &--small {
    height: 28px;
    padding: 0 12px;
    font-size: 12px;

    .b-button__icon {
      width: 14px;
      height: 14px;
      margin-right: 4px;
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
      color: var(--text-primary);
      background-color: var(--color-primary-bg);
    }

    &:active:not(.b-button--disabled, .b-button--loading) {
      color: var(--text-primary);
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

    .b-button__icon {
      margin: 0;
    }
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
</style>
