<!--
  @file BCollapseTransition.vue
  @description 共享折叠过渡组件，提供高度、内边距与透明度动画。
-->
<template>
  <Transition
    :name="name"
    @before-enter="onBeforeEnter"
    @enter="onEnter"
    @after-enter="onAfterEnter"
    @before-leave="onBeforeLeave"
    @leave="onLeave"
    @after-leave="onAfterLeave"
  >
    <slot></slot>
  </Transition>
</template>

<script setup lang="ts">
import type { RendererElement } from 'vue';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BCollapseTransition' });

const [name] = createNamespace('collapse-transition');
const frameMap = new WeakMap<RendererElement, number>();

/**
 * 取消元素上尚未执行的动画帧。
 * @param el - 过渡元素
 */
function clearFrame(el: RendererElement): void {
  const frameId = frameMap.get(el);

  if (frameId === undefined) {
    return;
  }

  cancelAnimationFrame(frameId);
  frameMap.delete(el);
}

/**
 * 在下一帧执行样式变更，确保浏览器先绘制起始高度。
 * @param el - 过渡元素
 * @param callback - 样式变更回调
 */
function runNextFrame(el: RendererElement, callback: () => void): void {
  clearFrame(el);

  const frameId = requestAnimationFrame((): void => {
    frameMap.delete(el);
    callback();
  });

  frameMap.set(el, frameId);
}

/**
 * 清除过渡期间写入的内联样式。
 * @param el - 过渡元素
 */
function resetStyles(el: RendererElement): void {
  clearFrame(el);
  el.style.height = '';
  el.style.overflow = '';
  el.style.paddingTop = '';
  el.style.paddingBottom = '';
}

/**
 * 进入前：将元素初始状态设为高度和 padding 均为 0
 * @param el - 过渡元素
 */
function onBeforeEnter(el: RendererElement): void {
  clearFrame(el);
  el.style.height = '0';
  el.style.overflow = 'hidden';
  el.style.paddingTop = '0';
  el.style.paddingBottom = '0';
}

/**
 * 进入时：将高度过渡到元素的实际内容高度，恢复 padding
 * @param el - 过渡元素
 */
function onEnter(el: RendererElement): void {
  runNextFrame(el, (): void => {
    el.style.paddingTop = '';
    el.style.paddingBottom = '';

    if (el.scrollHeight !== 0) {
      el.style.height = `${el.scrollHeight}px`;
    } else {
      el.style.height = '';
    }
  });
}

/**
 * 进入后：清除内联样式，恢复元素自适应高度
 * @param el - 过渡元素
 */
function onAfterEnter(el: RendererElement): void {
  resetStyles(el);
}

/**
 * 离开前：锁定当前高度，隐藏溢出
 * @param el - 过渡元素
 */
function onBeforeLeave(el: RendererElement): void {
  clearFrame(el);
  el.style.height = `${el.scrollHeight}px`;
  el.style.overflow = 'hidden';
}

/**
 * 离开时：将高度和 padding 过渡到 0
 * @param el - 过渡元素
 */
function onLeave(el: RendererElement): void {
  runNextFrame(el, (): void => {
    if (el.scrollHeight !== 0) {
      el.style.height = '0';
      el.style.paddingTop = '0';
      el.style.paddingBottom = '0';
    }
  });
}

/**
 * 离开后：清除所有内联样式
 * @param el - 过渡元素
 */
function onAfterLeave(el: RendererElement): void {
  resetStyles(el);
}
</script>

<style lang="less">
.b-collapse-transition-leave-active,
.b-collapse-transition-enter-active {
  box-sizing: border-box;
  overflow: hidden;
  transition: height 0.22s cubic-bezier(0.4, 0, 0.2, 1), padding-top 0.22s cubic-bezier(0.4, 0, 0.2, 1), padding-bottom 0.22s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.14s ease-out;
  will-change: height, padding-top, padding-bottom, opacity;
}

.b-collapse-transition-enter-from,
.b-collapse-transition-leave-to {
  opacity: 0;
}

.b-collapse-transition-enter-to,
.b-collapse-transition-leave-from {
  opacity: 1;
}
</style>
