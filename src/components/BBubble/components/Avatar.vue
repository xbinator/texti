<template>
  <div class="b-bubble-avatar">
    <img v-if="src" :src="src" class="b-bubble-avatar__image" />
    <div v-else class="b-bubble-avatar__placeholder">{{ title?.charAt(0) }}</div>
    <div v-if="title" class="b-bubble-avatar__text">{{ title }}</div>
  </div>
</template>

<script setup lang="ts">
import type { BBubbleAvatarProps } from '../types';

withDefaults(defineProps<BBubbleAvatarProps>(), {
  src: '',
  title: ''
});
</script>

<style scoped lang="less">
.b-bubble-avatar {
  display: flex;
  align-items: center;

  &__image {
    width: 24px;
    height: 24px;
    object-fit: cover;
    border-radius: 50%;
  }

  &__placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    font-size: 12px;
    font-weight: 600;
    color: #fff;
    background: var(--color-primary);
    border-radius: 50%;
  }

  &__text {
    margin-left: 10px;
    font-size: 12px;
    color: var(--text-secondary);
  }
}
</style>
