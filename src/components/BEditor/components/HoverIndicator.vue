<template>
  <div v-show="isVisible" class="hover-indicator" :class="`is-${type}`" :style="{ top }">
    {{ label }}
  </div>
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
  color: #5f6368;
  pointer-events: none;
  background: rgb(255 255 255 / 96%);
  border: 1px solid #d9dde3;
  border-radius: 6px;
  transform: translateY(-50%);

  &.is-heading {
    color: #1761d2;
    border-color: rgb(23 97 210 / 22%);
  }
}
</style>
