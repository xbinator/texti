<template>
  <div :class="['b-bubble', `b-bubble--${placement}`, { [`b-bubble--${size}`]: size !== 'auto' }]">
    <div v-if="avatar" class="b-bubble__avatar">
      <slot name="avatar">
        <Avatar v-bind="isObject(avatar) ? avatar : {}" />
      </slot>
    </div>

    <div v-if="$slots.header" class="b-bubble__header">
      <slot name="header"></slot>
    </div>

    <div class="b-bubble__main">
      <div v-if="loading && placement === 'left'" class="b-bubble__container">
        <Loading type="dot" />
      </div>

      <template v-else>
        <template v-if="placement === 'right'">
          <Loading v-if="loading" type="circle" class="b-bubble__loading" />
        </template>

        <div class="b-bubble__container">
          <slot name="top"></slot>

          <div ref="contentRef" :class="['b-bubble__content', { 'b-bubble__content--collapse': collapse.value }]">
            <slot></slot>
          </div>

          <div v-if="shouldShowCollapseButton" class="b-bubble__collapse" @click="toggleCollapse">
            <span class="b-bubble__collapse-text">{{ collapse.value ? '展开查看全部' : '收起' }}</span>
            <Icon :icon="collapse.value ? 'lucide:chevron-down' : 'lucide:chevron-up'" class="b-bubble__collapse-icon" />
          </div>
        </div>
      </template>
    </div>

    <div v-if="$slots.toolbar" class="b-bubble__toolbar">
      <slot name="toolbar"></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BBubbleProps } from './types';
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { isObject } from 'lodash-es';
import Avatar from './components/Avatar.vue';
import Loading from './components/Loading.vue';
import { useCollapse } from './hooks/useCollapse';

defineOptions({ name: 'BBubble' });

const props = withDefaults(defineProps<BBubbleProps>(), {
  placement: 'left',
  avatar: undefined,
  state: 'complete',
  size: 'fill'
});

const contentRef = ref<HTMLDivElement>();

const { collapse, toggleCollapse } = useCollapse(contentRef, () => ({ isCollapse: props.isCollapse, state: props.state }), props.collapseOptions);

const shouldShowCollapseButton = computed(() => props.placement === 'left' && collapse.visible && props.isCollapse);
</script>

<style scoped lang="less">
.b-bubble {
  display: flex;
  flex-direction: column;

  & + .b-bubble {
    margin: 12px 0 0;
  }

  &--left + &--left,
  &--right + &--right {
    margin-top: 6px;
  }

  &:hover {
    .b-bubble__toolbar {
      opacity: 1;
    }
  }

  &--left {
    .b-bubble__container {
      background: var(--bg-primary);
      border-radius: 2px 12px 12px;
    }
  }

  &--right {
    align-items: flex-end;

    .b-bubble__container {
      color: #fff;
      background: var(--color-primary);
      border-radius: 12px 2px 12px 12px;
    }

    .b-bubble-avatar {
      flex-direction: row-reverse;
    }

    .b-bubble-avatar__text {
      margin-right: 10px;
    }

    .b-bubble__loading {
      margin-right: 10px;
    }
  }

  &--fill {
    .b-bubble__container {
      width: 100%;
    }
  }

  &__main {
    display: flex;
    align-items: center;
  }

  &__container {
    width: fit-content;
    max-width: 100%;
    padding: 10px 14px;
  }

  &__content {
    &--collapse {
      height: 200px;
      overflow: hidden;
    }
  }

  &__avatar {
    margin-bottom: 8px;
  }

  &__header {
    margin-bottom: 8px;
  }

  &__loading {
    display: flex;
    align-items: center;
    margin-right: 10px;
  }

  &__collapse {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 36px;
    margin: 10px 0 0;
    font-size: 12px;
    cursor: pointer;
    background: var(--bg-secondary);
    border-radius: 18px;

    &--active::before {
      position: absolute;
      top: -10px;
      right: 0;
      left: 0;
      height: 28px;
      content: '';
      background: linear-gradient(180deg, rgb(255 255 255 / 0%) 0%, var(--bg-primary) 100%);
      transform: translateY(-100%);
    }

    &-text {
      font-weight: 600;
    }

    &-icon {
      margin-left: 4px;
      font-size: 12px;
      color: var(--text-tertiary);
    }
  }

  &__toolbar {
    opacity: 0;
    transition: opacity 0.2s ease-in-out;

    &:not(:empty) {
      margin-top: 6px;
    }
  }
}
</style>
