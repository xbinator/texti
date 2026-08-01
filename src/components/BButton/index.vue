<!--
 * @file index.vue
 * @description 通用按钮组件，支持类型、尺寸、图标、加载态和 Tooltip。
-->
<script lang="tsx">
import type { BButtonProps, BButtonSize, BButtonTooltipPlacement, BButtonType } from './types';
import type { PropType, VNodeChild } from 'vue';
import { defineComponent } from 'vue';
import { Tooltip } from 'ant-design-vue';
import { createNamespace } from '@/utils/namespace';

const [, bem] = createNamespace('button');

/**
 * 按钮组件
 * 支持多种类型、尺寸、图标和 tooltip
 */
export default defineComponent({
  name: 'BButton',
  props: {
    type: {
      type: String as PropType<BButtonType>,
      default: 'primary'
    },
    size: {
      type: String as PropType<BButtonSize>,
      default: 'middle'
    },
    disabled: {
      type: Boolean,
      default: false
    },
    loading: {
      type: Boolean,
      default: false
    },
    block: {
      type: Boolean,
      default: false
    },
    rounded: {
      type: Boolean,
      default: false
    },
    square: {
      type: Boolean,
      default: false
    },
    icon: {
      type: String,
      default: ''
    },
    text: {
      type: String,
      default: ''
    },
    danger: {
      type: Boolean,
      default: false
    },
    tooltip: {
      type: String,
      default: ''
    },
    arrow: {
      type: Boolean,
      default: true
    },
    placement: {
      type: String as PropType<BButtonTooltipPlacement>,
      default: 'top'
    }
  },
  emits: ['click'],
  setup(props: BButtonProps, { emit, slots }): () => VNodeChild {
    /**
     * 处理按钮点击事件
     * @param event - 鼠标事件对象
     */
    function handleClick(event: MouseEvent): void {
      if (!props.disabled && !props.loading) {
        emit('click', event);
      }
    }

    /**
     * 渲染按钮内容
     * @returns 按钮 JSX 元素
     */
    function renderButton(): VNodeChild {
      const hasIcon = slots.icon || props.icon;

      return (
        <button
          class={bem([
            props.type,
            props.size,
            {
              disabled: props.disabled,
              loading: props.loading,
              icon: hasIcon,
              block: props.block,
              rounded: props.rounded,
              square: props.square,
              danger: props.danger
            }
          ])}
          onClick={handleClick}
        >
          {props.loading && (
            <div class={bem('loading')}>
              <div class={bem('loading-spinner')}></div>
            </div>
          )}
          {props.icon && <BIcon class={bem('icon')} icon={props.icon} />}
          {slots.default?.()}
        </button>
      );
    }

    return (): VNodeChild => {
      if (props.tooltip) {
        return (
          <Tooltip title={props.tooltip} arrow={props.arrow} placement={props.placement}>
            {renderButton()}
          </Tooltip>
        );
      }
      return renderButton();
    };
  }
});
</script>

<style lang="less">
.b-button {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 0 16px;
  font-family: var(--font-display);
  font-size: 14px;
  color: #fff;
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  background: var(--color-primary);
  border: var(--button-border-width) solid var(--button-border);
  border-radius: var(--control-radius);
  box-shadow: var(--button-shadow);
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-press);

  &:hover:not(.b-button--disabled, .b-button--loading) {
    background: var(--color-primary-hover);
  }

  &:active:not(.b-button--disabled, .b-button--loading) {
    background: var(--color-primary-active);
    box-shadow: var(--button-pressed-shadow);
    transform: translate(var(--interaction-press-offset), var(--interaction-press-offset));
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
    border-radius: var(--radius-full);
  }

  // 尺寸
  &--mini {
    gap: 2px;
    height: 24px;
    padding: 0 8px;
    font-size: 12px;

    .b-button__icon {
      width: 12px;
      height: 12px;
    }
  }

  &--small {
    gap: 4px;
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
    background: var(--color-primary);
    border-color: var(--button-border);

    &:hover:not(.b-button--disabled, .b-button--loading) {
      background: var(--color-primary-hover);
    }

    &:active:not(.b-button--disabled, .b-button--loading) {
      background: var(--color-primary-active);
    }
  }

  &--secondary {
    color: var(--text-primary);
    background: var(--bg-secondary);
    border-color: var(--button-border);

    &:hover:not(.b-button--disabled, .b-button--loading) {
      background: var(--bg-active);
    }

    &:active:not(.b-button--disabled, .b-button--loading) {
      background: var(--bg-selected);
    }
  }

  &--outline {
    color: var(--color-primary);
    background: transparent;
    border: var(--control-border-width) solid var(--color-primary-border);

    &:hover:not(.b-button--disabled, .b-button--loading) {
      background: var(--color-primary-bg);
    }

    &:active:not(.b-button--disabled, .b-button--loading) {
      background: var(--color-primary-bg-hover);
    }
  }

  &--text {
    padding: 0 8px;
    color: var(--color-primary);
    background: transparent;
    border-color: var(--button-border);

    &:hover:not(.b-button--disabled, .b-button--loading) {
      color: var(--text-primary);
      background: var(--color-primary-bg);
      border-color: var(--button-border);
    }

    &:active:not(.b-button--disabled, .b-button--loading) {
      color: var(--text-primary);
      background: var(--color-primary-bg-hover);
    }
  }

  &--ghost {
    color: var(--text-secondary);
    background: transparent;
    border-color: var(--button-border);

    &:hover:not(.b-button--disabled, .b-button--loading) {
      color: var(--text-primary);
      background: var(--color-primary-bg);
      border-color: var(--button-border);
    }

    &:active:not(.b-button--disabled, .b-button--loading) {
      color: var(--text-primary);
      background: var(--color-primary-bg-hover);
    }
  }

  // danger 修饰符
  &--danger {
    &.b-button--primary {
      color: #fff;
      background: var(--color-danger);
      border-color: var(--button-border);

      &:hover:not(.b-button--disabled, .b-button--loading) {
        background: var(--color-danger-hover);
      }

      &:active:not(.b-button--disabled, .b-button--loading) {
        background: var(--color-danger-active);
      }
    }

    &.b-button--secondary {
      color: var(--color-danger);
      background: var(--bg-secondary);
      border-color: var(--button-border);

      &:hover:not(.b-button--disabled, .b-button--loading) {
        background: var(--bg-active);
      }

      &:active:not(.b-button--disabled, .b-button--loading) {
        background: var(--bg-selected);
      }
    }

    &.b-button--outline {
      color: var(--color-danger);
      background: transparent;
      border: var(--control-border-width) solid var(--color-danger-border);

      &:hover:not(.b-button--disabled, .b-button--loading) {
        background: var(--color-danger-bg);
        border-color: var(--color-danger);
      }

      &:active:not(.b-button--disabled, .b-button--loading) {
        background: var(--color-danger-bg-hover);
      }
    }

    &.b-button--text {
      padding: 0 8px;
      color: var(--color-danger);
      background: transparent;
      border-color: var(--button-border);

      &:hover:not(.b-button--disabled, .b-button--loading) {
        color: var(--color-danger-hover);
        background: var(--color-primary-bg);
        border-color: var(--button-border);
      }

      &:active:not(.b-button--disabled, .b-button--loading) {
        color: var(--color-danger-hover);
        background: var(--color-primary-bg-hover);
      }
    }

    &.b-button--ghost {
      color: var(--color-danger);
      background: transparent;
      border-color: var(--button-border);
      transition: color 0.15s ease;

      &:hover:not(.b-button--disabled, .b-button--loading) {
        color: var(--color-danger-hover);
        background: transparent;
        border-color: var(--button-border);
      }

      &:active:not(.b-button--disabled, .b-button--loading) {
        color: var(--color-danger-active);
        background: transparent;
      }
    }

    .b-button__loading-spinner {
      border-color: rgb(255 255 255 / 30%);
      border-top-color: #fff;
    }

    &.b-button--outline .b-button__loading-spinner,
    &.b-button--text .b-button__loading-spinner,
    &.b-button--secondary .b-button__loading-spinner,
    &.b-button--ghost .b-button__loading-spinner {
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
    border-radius: var(--control-radius);

    &.b-button--mini {
      width: 24px;
    }

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

.b-button--soft {
  color: var(--color-primary);
  background: var(--color-primary-bg);
  border-color: var(--button-border);

  &:hover:not(.b-button--disabled, .b-button--loading) {
    background: var(--color-primary-bg-hover);
  }

  &:active:not(.b-button--disabled, .b-button--loading) {
    background: var(--color-primary-bg-hover);
  }
}

.b-button--soft .b-button__loading-spinner {
  border-color: rgb(0 0 0 / 10%);
  border-top-color: var(--color-primary);
}

.b-button--danger.b-button--soft {
  color: var(--color-danger);
  background: var(--color-danger-bg);
  border-color: var(--button-border);

  &:hover:not(.b-button--disabled, .b-button--loading) {
    color: var(--color-danger-hover);
    background: var(--color-danger-bg-hover);
  }

  &:active:not(.b-button--disabled, .b-button--loading) {
    color: var(--color-danger-active);
    background: var(--color-danger-bg-hover);
  }
}

.b-button--danger.b-button--soft .b-button__loading-spinner {
  border-color: rgb(0 0 0 / 10%);
  border-top-color: var(--color-danger);
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
