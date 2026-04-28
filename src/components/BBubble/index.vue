<template>
  <div :class="bem([placement, { [size]: size !== 'auto' }])">
    <div v-if="avatar" :class="bem('avatar')">
      <slot name="avatar">
        <Avatar v-bind="isObject(avatar) ? avatar : {}" />
      </slot>
    </div>

    <div v-if="$slots.header" :class="bem('header')">
      <slot name="header"></slot>
    </div>

    <div :class="bem('main')">
      <template v-if="placement === 'right'">
        <Loading v-if="loading" type="circle" :class="bem('loading')" />
      </template>

      <div :class="bem('container')">
        <slot name="top"></slot>

        <div ref="contentRef" :class="bem('content', { collapse: collapse.value })">
          <slot></slot>
        </div>

        <div v-if="shouldShowCollapseButton" :class="bem('collapse')" @click="toggleCollapse">
          <span :class="bem('collapse-text')">{{ collapse.value ? '展开查看全部' : '收起' }}</span>
          <Icon :icon="collapse.value ? 'lucide:chevron-down' : 'lucide:chevron-up'" :class="bem('collapse-icon')" />
        </div>
      </div>
    </div>

    <div v-if="loading && placement === 'left'" :class="bem('container')">
      <Loading type="dot" />
    </div>

    <div v-if="$slots.toolbar" :class="bem('toolbar')">
      <slot name="toolbar"></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { BBubbleProps } from './types';
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { isObject } from 'lodash-es';
import { createNamespace } from '@/utils/namespace';
import Avatar from './components/Avatar.vue';
import Loading from './components/Loading.vue';
import { useCollapse } from './hooks/useCollapse';

defineOptions({ name: 'BBubble' });

const [, bem] = createNamespace('bubble');

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

<style>
.b-bubble {
  display: flex;
  flex-direction: column;
}

.b-bubble + .b-bubble {
  margin: 12px 0 0;
}

.b-bubble--left + .b-bubble--left,
.b-bubble--right + .b-bubble--right {
  margin-top: 6px;
}

.b-bubble:hover .b-bubble__toolbar {
  opacity: 1;
}

.b-bubble--left .b-bubble__container {
  background: var(--bg-primary);
  border-radius: 2px 12px 12px;
}

.b-bubble--right {
  align-items: flex-end;
}

.b-bubble--right .b-bubble__container {
  padding: 10px 14px;
  color: var(--text-primary);
  background: var(--color-primary-bg);
  border-radius: 12px 2px 12px 12px;
}

.b-bubble--right .b-bubble__avatar {
  flex-direction: row-reverse;
}

.b-bubble--right .b-bubble__avatar-text {
  margin-right: 10px;
}

.b-bubble--right .b-bubble__loading {
  margin-right: 10px;
}

.b-bubble--fill .b-bubble__container {
  width: 100%;
}

.b-bubble__main {
  display: flex;
  align-items: center;
}

.b-bubble__container {
  width: fit-content;
  max-width: 100%;
}

.b-bubble__content--collapse {
  height: 200px;
  overflow: hidden;
}

.b-bubble__avatar {
  margin-bottom: 8px;
}

.b-bubble__header {
  margin-bottom: 8px;
}

.b-bubble__loading {
  display: flex;
  align-items: center;
  margin-right: 10px;
}

.b-bubble__collapse {
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
}

.b-bubble__collapse--active::before {
  position: absolute;
  top: -10px;
  right: 0;
  left: 0;
  height: 28px;
  content: '';
  background: linear-gradient(180deg, rgb(255 255 255 / 0%) 0%, var(--bg-primary) 100%);
  transform: translateY(-100%);
}

.b-bubble__collapse-text {
  font-weight: 600;
}

.b-bubble__collapse-icon {
  margin-left: 4px;
  font-size: 12px;
  color: var(--text-tertiary);
}

.b-bubble__toolbar {
  opacity: 0;
  transition: opacity 0.2s ease-in-out;
}

.b-bubble__toolbar:not(:empty) {
  margin-top: 6px;
}
</style>
