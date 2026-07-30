/**
 * @file useProviderTransition.ts
 * @description 基于 View Transition API 的模型平台列表→详情共享元素缩放转场。
 */

import { nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { asyncTo } from '@/utils/asyncTo';

/** 共享元素名称：被点击卡片与详情容器通过同名建立 morph 关系。 */
const HERO_NAME = 'provider-hero';

/** 视图过渡类型标签，用于在 CSS 中限定 `::view-transition-*` 规则的作用域。 */
const TRANSITION_TYPE = 'provider-nav';

/** 转场进行中标志，防止重复触发导致旧快照未清理。 */
let isTransitioning = false;

/**
 * 模型平台列表→详情的视图过渡控制。
 * @returns 导航方法
 */
export function useProviderTransition() {
  const router = useRouter();

  /**
   * 从被点击卡片位置缩放过渡到详情页。
   * 不支持 View Transition API 时回退为普通路由跳转。
   * @param cardEl - 被点击的卡片 DOM 元素
   * @param providerId - 模型平台 ID
   */
  async function navigateToDetail(cardEl: HTMLElement, providerId: string): Promise<void> {
    // 转场进行中时忽略后续点击，避免快照时序错乱
    if (isTransitioning) return;

    const fallback = async (): Promise<void> => {
      await asyncTo(router.push({ name: 'provider-detail', params: { provider: providerId } }));
    };

    // 不支持 View Transition API 时直接回退
    if (!('startViewTransition' in document)) {
      await fallback();
      return;
    }

    isTransitioning = true;

    // 必须在 startViewTransition 之前同步设置 hero 名称，使其进入旧快照
    cardEl.style.viewTransitionName = HERO_NAME;

    try {
      const transition = document.startViewTransition({
        update: async () => {
          await asyncTo(router.push({ name: 'provider-detail', params: { provider: providerId } }));
          // 等待详情页挂载并完成 DOM 更新后再捕获新快照
          await nextTick();
        },
        types: [TRANSITION_TYPE]
      });

      await asyncTo(transition.finished);
    } finally {
      // 转场结束或失败后清理 hero 名称，避免残留影响后续过渡
      if (cardEl.isConnected) {
        cardEl.style.viewTransitionName = '';
      }
      isTransitioning = false;
    }
  }

  return { navigateToDetail };
}
