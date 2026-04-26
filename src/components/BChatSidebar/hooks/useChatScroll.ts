/**
 * @file useChatScroll.ts
 * @description 聊天面板滚动状态和历史加载 hook
 */
import { nextTick, ref, onMounted, useTemplateRef } from 'vue';
import { useEventListener } from '@vueuse/core';
import { getScrollTop, getScroller, setScrollTop } from '@/utils/scroll';

export interface UseChatScrollOptions {
  /** 容器元素引用 */
  /** 历史加载阈值（滚动到此位置时触发加载） */
  historyLoadThreshold?: number;
  /** 回到底部按钮可见阈值 */
  backBottomHeight?: number;
  /** 加载历史回调 */
  onLoadHistory?: () => Promise<void> | void;
}

export function useChatScroll(scrollOptions: UseChatScrollOptions) {
  const containerRef = useTemplateRef<HTMLElement>('container');

  const { historyLoadThreshold = 160, backBottomHeight = 300, onLoadHistory } = scrollOptions;

  const scroller = ref<HTMLElement | Window>();
  const isBackBottom = ref(false);

  /**
   * 检查是否接近历史边缘
   */
  function isNearHistoryEdge(target: HTMLElement | Window): boolean {
    if (!('scrollTop' in target)) {
      return false;
    }

    const scrollTop = getScrollTop(target);
    const reverseMinScrollTop = target.clientHeight - target.scrollHeight;

    if (scrollTop <= 0 && reverseMinScrollTop < 0) {
      return scrollTop - reverseMinScrollTop <= historyLoadThreshold;
    }

    return scrollTop <= historyLoadThreshold;
  }

  /**
   * 处理滚动事件
   */
  function handleScroll(): void {
    if (!scroller.value) return;

    const scrollTop = getScrollTop(scroller.value);
    isBackBottom.value = Math.abs(scrollTop) > backBottomHeight;

    if (isNearHistoryEdge(scroller.value)) {
      onLoadHistory?.();
    }
  }

  /**
   * 滚动到底部
   */
  function scrollToBottom(options?: { behavior?: 'smooth' | 'auto' }): void {
    const behavior = options?.behavior || 'smooth';
    nextTick(() => scroller.value && setScrollTop(scroller.value, { top: 0, behavior }));
  }

  /**
   * 带滚动锚点的回调
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
   * 初始化 scroller
   */
  function initScroller(): void {
    if (containerRef.value) {
      scroller.value = getScroller(containerRef.value);
    }
  }

  useEventListener(() => scroller.value, 'scroll', handleScroll);

  onMounted(() => {
    initScroller();
  });

  return {
    scroller,
    isBackBottom,
    scrollToBottom,
    withScrollAnchor,
    initScroller
  };
}
