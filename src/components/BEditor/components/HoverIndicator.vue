<template>
  <Transition name="b-markdown-hover-fade">
    <div v-show="isVisible" :class="[name, `is-${type}`]" :style="{ top }">
      {{ label }}
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { createNamespace } from '@/utils/namespace';

const [name] = createNamespace('', 'b-markdown-hover');

type HoverBlockType = 'heading' | 'paragraph';

interface Props {
  isVisible: boolean;
  label: string;
  top: string;
  type: HoverBlockType;
}

withDefaults(defineProps<Props>(), {
  isVisible: false,
  label: '',
  top: '0px',
  type: 'paragraph'
});
</script>

<style lang="less" scoped>
.b-markdown-hover {
  position: absolute;
  top: 0;
  left: 4px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  color: var(--hover-indicator-text);
  pointer-events: none;
  background: var(--hover-indicator-bg);
  border: var(--control-border-width) solid var(--hover-indicator-border);
  border-radius: var(--control-radius);
  transform: translateY(-50%);

  &.is-heading {
    color: var(--hover-indicator-hover-text);
    border-color: var(--hover-indicator-hover-border);
  }
}

.b-markdown-hover-fade-enter-active,
.b-markdown-hover-fade-leave-active {
  transition: opacity var(--motion-duration-base) var(--motion-easing-standard), transform var(--motion-duration-base) var(--motion-easing-standard);
}

.b-markdown-hover-fade-enter-from,
.b-markdown-hover-fade-leave-to {
  opacity: 0;
  transform: translateY(-50%) scale(0.8);
}
</style>
