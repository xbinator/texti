<template>
  <div class="b-chat-to-bottom" :class="{ 'b-chat-to-bottom--visible': visible }" @click="handleClick">
    <Icon icon="lucide:arrow-down" />
    <div v-if="loading" class="b-chat-to-bottom__loading"></div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

interface Props {
  visible: boolean;
  loading: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  loading: false
});

const emit = defineEmits<{
  (e: 'click', options: { behavior: 'smooth' | 'auto' }): void;
}>();

function handleClick() {
  emit('click', { behavior: props.loading ? 'auto' : 'smooth' });
}
</script>

<style scoped lang="less">
.b-chat-to-bottom {
  position: absolute;
  bottom: 20px;
  left: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  font-size: 18px;
  color: var(--color-primary);
  pointer-events: none;
  cursor: pointer;
  user-select: none;
  background: var(--bg-primary);
  border-radius: 50%;
  box-shadow: 0 0 4px 0 rgb(0 0 0 / 2%), 0 6px 10px 0 rgb(47 53 64 / 10%);
  opacity: 0;
  transform: translateX(-50%);
  transition: opacity 0.2s ease;
}

.b-chat-to-bottom--visible {
  pointer-events: auto;
  opacity: 1;
}

.b-chat-to-bottom__loading {
  position: absolute;
  width: 44px;
  height: 44px;
  border: 2px solid var(--border-secondary);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: b-chat-loading 1s linear infinite;
}

@keyframes b-chat-loading {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}
</style>
