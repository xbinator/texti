<!--
  @file Carousel.vue
  @description 图片查看器底部缩略图轮播组件，支持左右滚动和点击切换
-->
<template>
  <div :class="name" @click.stop>
    <div v-if="canScrollLeft" :class="bem('button', { left: true })" @click.stop="scrollCarousel('left')"></div>
    <div v-if="canScrollRight" :class="bem('button', { right: true })" @click.stop="scrollCarousel('right')"></div>
    <div ref="carouselImagesRef" :class="bem('images')">
      <img v-for="(url, index) in images" :key="index" :src="url" :class="bem('image', { active: index === currentIndex })" @click="updateIndex(index)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useEventListener } from '@vueuse/core';
import { createNamespace } from '@/utils/namespace';

/**
 * 缩略图轮播组件 Props
 */
interface Props {
  /** 图片列表 */
  images: string[];
}

const props = withDefaults(defineProps<Props>(), { images: () => [] });

const [name, bem] = createNamespace('image-viewer-carousel');

const currentIndex = defineModel<number>('currentIndex', { default: 0 });

const carouselImagesRef = ref<HTMLDivElement>();
const canScrollLeft = ref(false);
const canScrollRight = ref(false);

/**
 * 将当前激活的缩略图滚动到可视区域中央
 */
function centerActive(): void {
  const el = carouselImagesRef.value;
  if (!el) return;
  const child = el.children[currentIndex.value] as HTMLElement | undefined;
  if (!child) return;
  const target = child.offsetLeft + child.offsetWidth / 2 - el.clientWidth / 2;
  const max = el.scrollWidth - el.clientWidth;
  const left = Math.min(max, Math.max(0, target));
  el.scrollTo({ left, behavior: 'smooth' });
}

/**
 * 更新左右滚动按钮的显示状态
 */
function updateButtons(): void {
  const el = carouselImagesRef.value;
  if (!el) {
    canScrollLeft.value = false;
    canScrollRight.value = false;
    return;
  }
  const maxScrollLeft = el.scrollWidth - el.clientWidth;
  if (maxScrollLeft <= 1) {
    canScrollLeft.value = false;
    canScrollRight.value = false;
    return;
  }
  canScrollLeft.value = el.scrollLeft > 1;
  canScrollRight.value = el.scrollLeft < maxScrollLeft - 1;
}

/**
 * 滚动轮播列表
 * @param direction - 滚动方向
 */
function scrollCarousel(direction: 'left' | 'right'): void {
  const el = carouselImagesRef.value;
  if (!el) return;
  const delta = Math.max(160, Math.floor(el.clientWidth * 0.8));
  el.scrollBy({ left: direction === 'left' ? -delta : delta, behavior: 'smooth' });
}

/**
 * 更新当前激活的图片索引
 * @param index - 图片索引
 */
function updateIndex(index: number): void {
  currentIndex.value = index;
}

useEventListener(carouselImagesRef, 'scroll', updateButtons);
useEventListener(window, 'resize', () => {
  updateButtons();
  centerActive();
});

watch(
  () => props.images,
  () => {
    nextTick(updateButtons);
    nextTick(centerActive);
  }
);

watch(
  () => currentIndex.value,
  () => {
    nextTick(centerActive);
  }
);

nextTick(updateButtons);
</script>

<style>
.b-image-viewer-carousel {
  position: relative;
  display: flex;
  justify-content: center;
  height: 66px;
  margin-bottom: 28px;
}

.b-image-viewer-carousel__images {
  display: flex;
  gap: 3px;
  align-items: center;
  height: 100%;
  padding-inline: 44px;
  overflow-x: auto;
  scrollbar-width: none;
}

.b-image-viewer-carousel__images::-webkit-scrollbar {
  display: none;
}

.b-image-viewer-carousel__image {
  position: relative;
  z-index: 100;
  box-sizing: border-box;
  flex: 0 0 auto;
  height: 100%;
  cursor: pointer;
  border: 3px solid transparent;
  border-radius: 3px;
}

.b-image-viewer-carousel__image--active {
  border-color: #fff;
}

.b-image-viewer-carousel__button {
  position: absolute;
  top: 50%;
  z-index: 110;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin-top: -18px;
  font-size: 16px;
  color: #fff;
  cursor: pointer;
  background-color: rgb(46 50 56 / 30%);
  border-radius: 999px;
  backdrop-filter: blur(6px);
}

.b-image-viewer-carousel__button:hover {
  background-color: rgb(46 50 56 / 45%);
}

.b-image-viewer-carousel__button--left {
  left: 8px;
}

.b-image-viewer-carousel__button--right {
  right: 8px;
}
</style>
