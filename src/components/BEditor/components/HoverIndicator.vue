<template>
  <Transition name="hover-indicator-fade">
    <div v-show="isVisible" class="hover-indicator" :class="`is-${type}`" :style="{ top }">
      {{ label }}
    </div>
  </Transition>
</template>

<script setup lang="ts">
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
.hover-indicator {
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
  border: 1px solid var(--hover-indicator-border);
  border-radius: 6px;
  transform: translateY(-50%);

  &.is-heading {
    color: var(--hover-indicator-hover-text);
    border-color: var(--hover-indicator-hover-border);
  }
}

.hover-indicator-fade-enter-active,
.hover-indicator-fade-leave-active {
  transition: all 0.2s ease;
}

.hover-indicator-fade-enter-from,
.hover-indicator-fade-leave-to {
  opacity: 0;
  transform: translateY(-50%) scale(0.8);
}
</style>
