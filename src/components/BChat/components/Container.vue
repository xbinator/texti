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
/**
 * @file Container.vue
 * @description 聊天消息滚动容器，负责回到底部、历史加载触发和滚动锚定。
 */
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
  (e: 'load-history'): void;
}>();

const BACK_BOTTOM_HEIGHT = 300;
const HISTORY_LOAD_THRESHOLD = 160;

const mainRef = ref<HTMLElement>();
const scroller = ref<HTMLElement | Window>();
const isBackBottom = ref(false);

/**
 * 判断滚动位置是否接近历史消息边界。
 * @param target - 当前滚动容器
 * @returns 是否需要提前触发历史加载
 */
function isNearHistoryEdge(target: HTMLElement | Window): boolean {
  if (!('scrollTop' in target)) {
    return false;
  }

  const scrollTop = getScrollTop(target);
  const reverseMinScrollTop = target.clientHeight - target.scrollHeight;

  if (scrollTop <= 0 && reverseMinScrollTop < 0) {
    return scrollTop - reverseMinScrollTop <= HISTORY_LOAD_THRESHOLD;
  }

  return scrollTop <= HISTORY_LOAD_THRESHOLD;
}

/**
 * 通知宿主加载更早历史消息。
 */
function handleLoadHistory(): void {
  emit('load-history');
}

/**
 * 滚动到最新消息位置。
 * @param options - 滚动行为配置
 */
function scrollToBottom(options?: { behavior?: 'smooth' | 'auto' }): void {
  const behavior = options?.behavior || 'smooth';

  nextTick(() => scroller.value && setScrollTop(scroller.value, { top: 0, behavior }));
}

/**
 * 在向消息列表前方插入历史消息后保持用户当前视觉位置不跳动。
 * @param callback - 会插入历史消息的回调
 */
async function withScrollAnchor(callback: () => Promise<void> | void): Promise<void> {
  const target = scroller.value;
  if (!target || !('scrollTop' in target)) {
    await callback();
    return;
  }

  const previousScrollHeight = target.scrollHeight;
  const previousScrollTop = target.scrollTop;

  await callback();
  await nextTick();

  const heightDelta = target.scrollHeight - previousScrollHeight;
  target.scrollTop = previousScrollTop < 0 ? previousScrollTop - heightDelta : previousScrollTop + heightDelta;
}

/**
 * 处理消息区滚动，负责回到底部按钮状态和历史加载阈值判断。
 */
function handleScroll(): void {
  if (!scroller.value) return;

  const scrollTop = getScrollTop(scroller.value);
  isBackBottom.value = Math.abs(scrollTop) > BACK_BOTTOM_HEIGHT;

  if (isNearHistoryEdge(scroller.value)) {
    handleLoadHistory();
  }
}

useEventListener(() => scroller.value, 'scroll', handleScroll);

onMounted(() => {
  scroller.value = getScroller(mainRef.value);
});

defineExpose({ scrollToBottom, withScrollAnchor });
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
