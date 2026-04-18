<template>
  <div class="b-chat-container">
    <div ref="mainRef" class="b-chat-container__main">
      <div class="b-chat-container__placeholder"></div>
      <div class="b-chat-container__content">
        <slot></slot>
      </div>
    </div>

    <ToBottomButton :visible="isBackBottom" :loading="loading" @click="scrollToBottom" />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useEventListener } from '@vueuse/core';
import { getScrollTop, getScroller, setScrollTop } from '@/utils/scroll';
import ToBottomButton from './ToBottomButton.vue';

defineOptions({ name: 'ChatContainer' });

interface Props {
  loading: boolean;
}

withDefaults(defineProps<Props>(), {
  loading: false
});

const emit = defineEmits<{
  (e: 'load'): void;
}>();

const BACK_BOTTOM_HEIGHT = 300;
const SCROLL_TOP_HEIGHT = 100;

const mainRef = ref<HTMLElement>();
const scroller = ref<HTMLElement | Window>();
const isBackBottom = ref(false);

function handleLoadData() {
  emit('load');
}

function scrollToBottom(options?: { behavior?: 'smooth' | 'auto' }) {
  const behavior = options?.behavior || 'smooth';

  nextTick(() => scroller.value && setScrollTop(scroller.value, { top: 0, behavior }));
}

function handleScroll() {
  if (!scroller.value) return;

  const scrollTop = getScrollTop(scroller.value);
  isBackBottom.value = Math.abs(scrollTop) > BACK_BOTTOM_HEIGHT;

  if (scrollTop < SCROLL_TOP_HEIGHT) {
    handleLoadData();
  }
}

useEventListener(() => scroller.value, 'scroll', handleScroll);

onMounted(() => {
  scroller.value = getScroller(mainRef.value);
});

defineExpose({ scrollToBottom });
</script>

<style lang="less">
@import url('@/assets/styles/scrollbar.less');

.b-chat-container {
  position: relative;
  height: 100%;
}

.b-chat-container__main {
  display: flex;
  flex-direction: column-reverse;
  height: 100%;
  padding: var(--b-chat-padding, 16px);
  overflow-y: auto;
  scrollbar-gutter: stable;

  .scrollbar-style();
}

.b-chat-container__content {
  width: 100%;
  max-width: var(--b-chat-max-width, 800px);
  margin: 0 auto;
}

.b-chat-container__placeholder {
  flex: 1;
  pointer-events: none;
}
</style>
