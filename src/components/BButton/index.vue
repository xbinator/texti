<script lang="tsx">
import type { BButtonProps } from './types';
import { defineComponent, type PropType } from 'vue';
import { Icon } from '@iconify/vue';
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
      type: String as PropType<'primary' | 'secondary' | 'outline' | 'text'>,
      default: 'primary'
    },
    size: {
      type: String as PropType<'small' | 'middle' | 'large'>,
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
    }
  },
  emits: ['click'],
  setup(props: BButtonProps, { emit, slots }) {
    /**
     * 处理按钮点击事件
     * @param event - 鼠标事件对象
     */
    function handleClick(event: MouseEvent) {
      if (!props.disabled && !props.loading) {
        emit('click', event);
      }
    }

    /**
     * 渲染按钮内容
     * @returns 按钮 JSX 元素
     */
    function renderButton() {
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
          disabled={props.disabled || props.loading}
          onClick={handleClick}
        >
          {props.loading && (
            <div class={bem('loading')}>
              <div class={bem('loading-spinner')}></div>
            </div>
          )}
          {props.icon && <Icon class={bem('icon')} icon={props.icon} />}
          {slots.default?.()}
        </button>
      );
    }

    return () => {
      if (props.tooltip) {
        return <Tooltip title={props.tooltip}>{renderButton()}</Tooltip>;
      }
      return renderButton();
    };
  }
});
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
