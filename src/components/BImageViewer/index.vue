<!--
  @file index.vue
  @description 全屏图片查看器组件，支持缩放、旋转、拖拽、左右切换与滚轮缩放
-->
<template>
  <Teleport to="body">
    <Transition :name="bem('fade-scale') as string">
      <div v-if="show" ref="viewerRef" :class="name" @click="close">
        <div :class="bem('controls')" @click.stop>
          <div :class="bem('button')" @click="handleZoomOut">
            <Icon icon="lucide:zoom-out" />
          </div>
          <div :class="bem('button')" @click="handleZoomIn">
            <Icon icon="lucide:zoom-in" />
          </div>
          <div :class="bem('button')" @click="handleRotateLeft">
            <Icon icon="lucide:rotate-ccw" />
          </div>
          <div :class="bem('button')" @click="handleRotateRight">
            <Icon icon="lucide:rotate-cw" />
          </div>
          <div :class="[bem('button'), bem('close')]" @click="close">
            <Icon icon="lucide:x" />
          </div>
        </div>

        <div ref="canvasRef" :class="bem('canvas')">
          <img
            v-if="visible.image"
            :src="src"
            :class="bem('image')"
            :style="[imageSize, imageStyle]"
            @click.stop
            @mousedown="handleMouseDown"
            @touchstart="handleTouchStart"
            @touchmove="handleTouchMove"
            @touchend="handleTouchEnd"
            @touchcancel="handleTouchEnd"
          />
        </div>

        <Carousel v-if="showCarousel" v-model:current-index="currentIndex" :images="images" />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { BImageViewerProps } from './types';
import type { CSSProperties } from 'vue';
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useEventListener } from '@vueuse/core';
import { clamp } from 'lodash-es';
import { createNamespace } from '@/utils/namespace';
import Carousel from './components/Carousel.vue';

defineOptions({ name: 'BImageViewer' });

const props = withDefaults(defineProps<BImageViewerProps>(), {
  images: () => [],
  startPosition: 0,
  showCarousel: true
});

/** 是否展示查看器（通过 v-model:show 控制） */
const show = defineModel<boolean>('show', { default: false });

const [name, bem] = createNamespace('image-viewer');

/** 当前显示的图片索引与对应的 URL */
const currentIndex = ref(0);
const src = computed(() => props.images[currentIndex.value] || '');

/** 容器元素与图片的初始尺寸样式 */
const viewerRef = ref<HTMLDivElement>();
const canvasRef = ref<HTMLDivElement>();
const imageSize = ref<CSSProperties>({});

/** 可见性与拖拽状态 */
const visible = reactive({ image: false, isDragging: false });
/** 变换状态：缩放、位移与旋转，及拖拽起点 */
const transform = reactive({ scale: 1, translateX: 0, translateY: 0, startX: 0, startY: 0, rotate: 0 });
/** 触控状态：双指缩放参考距离与比例、滑动开始位置与滑动标记 */
const touch = reactive({ initialDistance: 0, initialScale: 1, startX: 0, isSwiping: false });

/** 缩放边界与步进 */
const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
const SCALE_STEP = 0.5;

/** 图片样式：按 transform 状态生成 CSS 变换 */
const imageStyle = computed(() => ({
  transform: `translate(${transform.translateX}px, ${transform.translateY}px) scale(${transform.scale}) rotate(${transform.rotate}deg)`,
  transformOrigin: 'center center'
}));

/** 记录 body 原始 overflow，用于弹窗打开时禁止滚动、关闭时恢复 */
const bodyOverflow = ref('');

/** 初始化序列号：用于打断过期的异步初始化 */
let initSequence = 0;

/** 文档级事件清理句柄（鼠标拖拽时绑定到 document） */
const stopDocumentMouseMove = ref<undefined | (() => void)>();
const stopDocumentMouseUp = ref<undefined | (() => void)>();

/**
 * 加载图片并获取其原始尺寸
 * @param url - 图片 URL
 * @returns 图片的宽高
 */
function loadImageSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * 结束拖拽并移除文档事件监听
 */
function stopDragging(): void {
  visible.isDragging = false;
  stopDocumentMouseMove.value?.();
  stopDocumentMouseUp.value?.();
  stopDocumentMouseMove.value = undefined;
  stopDocumentMouseUp.value = undefined;
}

/**
 * 关闭查看器
 */
function close(): void {
  initSequence++;
  stopDragging();
  show.value = false;
}

/**
 * 重置所有变换为默认状态
 */
function resetTransform(): void {
  Object.assign(transform, { scale: 1, translateX: 0, translateY: 0, startX: 0, startY: 0, rotate: 0 });
}

/**
 * 初始化图片在查看器中的显示尺寸
 * 依据容器可用空间与图片原始尺寸进行等比缩放
 */
async function initScaledDimensions(): Promise<void> {
  const currentInitId = ++initSequence;
  visible.image = false;
  if (!show.value) return;
  if (!src.value) return;

  const currentSrc = src.value;
  const image = await loadImageSize(currentSrc);
  if (currentInitId !== initSequence) return;
  if (currentSrc !== src.value) return;
  const containerEl = viewerRef.value;
  if (!containerEl) return;

  const { clientHeight, clientWidth } = containerEl;
  const canvasEl = canvasRef.value;
  const baseWidth = canvasEl?.clientWidth ?? clientWidth;
  const baseHeight = canvasEl?.clientHeight ?? clientHeight;
  const margin = window.innerWidth < 768 ? 40 : 100;
  const availableWidth = Math.max(0, baseWidth - margin);
  const availableHeight = Math.max(0, baseHeight - margin);

  const originalWidth = image.width;
  const originalHeight = image.height;
  const isTallImage = originalHeight > originalWidth;

  let maxWidth = Infinity;
  let maxHeight = Infinity;

  if (isTallImage) {
    maxWidth = window.innerWidth < 768 ? window.innerWidth - 40 : 720;
  } else {
    maxHeight = window.innerWidth < 768 ? window.innerHeight * 0.5 : 720;
  }

  const widthRatio = Math.min(1, availableWidth / originalWidth, maxWidth / originalWidth);
  const heightRatio = Math.min(1, availableHeight / originalHeight, maxHeight / originalHeight);
  const scaleRatio = Math.min(widthRatio, heightRatio);

  const width = Math.floor(originalWidth * scaleRatio);
  const height = Math.floor(originalHeight * scaleRatio);

  resetTransform();
  imageSize.value = { width: `${width}px`, height: `${height}px` };
  visible.image = true;
}

/**
 * 鼠标拖拽过程中更新位移
 */
function handleMouseMove(event: MouseEvent): void {
  if (!visible.isDragging) return;
  transform.translateX = event.clientX - transform.startX;
  transform.translateY = event.clientY - transform.startY;
}

/** 鼠标抬起结束拖拽 */
function handleMouseUp(): void {
  stopDragging();
}

/**
 * 鼠标按下开始拖拽（仅在左键且已放大时允许）
 */
function handleMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  if (transform.scale <= 1) return;

  event.preventDefault();
  event.stopPropagation();

  stopDragging();
  visible.isDragging = true;
  transform.startX = event.clientX - transform.translateX;
  transform.startY = event.clientY - transform.translateY;

  stopDocumentMouseMove.value = useEventListener(document, 'mousemove', handleMouseMove);
  stopDocumentMouseUp.value = useEventListener(document, 'mouseup', handleMouseUp);
}

/**
 * 计算双指间距离
 */
function getDistance(touch1: Touch, touch2: Touch): number {
  const dx = touch2.clientX - touch1.clientX;
  const dy = touch2.clientY - touch1.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 触控开始：双指进入缩放模式；单指根据缩放状态决定拖拽或滑动切换
 */
function handleTouchStart(event: TouchEvent): void {
  const { touches } = event;

  if (touches.length === 2) {
    touch.initialDistance = Math.max(1, getDistance(touches[0], touches[1]));
    touch.initialScale = transform.scale;
    stopDragging();
    touch.isSwiping = false;
  } else if (touches.length === 1) {
    const touchPoint = touches[0];
    touch.startX = touchPoint.clientX;
    touch.isSwiping = transform.scale <= 1;

    if (transform.scale > 1) {
      transform.startX = touchPoint.clientX - transform.translateX;
      transform.startY = touchPoint.clientY - transform.translateY;
      visible.isDragging = true;
    }
  }
}

/**
 * 触控移动：双指缩放；单指在放大状态下拖拽位移
 */
function handleTouchMove(event: TouchEvent): void {
  const { touches } = event;

  if (touches.length === 2) {
    const currentDistance = getDistance(touches[0], touches[1]);
    if (!touch.initialDistance) return;
    transform.scale = clamp((currentDistance / touch.initialDistance) * touch.initialScale, MIN_SCALE, MAX_SCALE);
    event.preventDefault();
  } else if (visible.isDragging && touches.length === 1) {
    const touchPoint = touches[0];
    transform.translateX = touchPoint.clientX - transform.startX;
    transform.translateY = touchPoint.clientY - transform.startY;
    event.preventDefault();
  }
}

/** 切换到上一张（循环） */
function handlePrevImage(): void {
  if (props.images.length <= 1) return;
  currentIndex.value = (currentIndex.value - 1 + props.images.length) % props.images.length;
}

/** 切换到下一张（循环） */
function handleNextImage(): void {
  if (props.images.length <= 1) return;
  currentIndex.value = (currentIndex.value + 1) % props.images.length;
}

/**
 * 触控结束：当未放大时，单指水平滑动触发左右切换
 */
function handleTouchEnd(event: TouchEvent): void {
  if (touch.isSwiping && event.changedTouches.length === 1) {
    const endX = event.changedTouches[0].clientX;
    const diffX = endX - touch.startX;

    if (Math.abs(diffX) > 50) {
      if (diffX > 0) {
        handlePrevImage();
      } else {
        handleNextImage();
      }
    }
  }

  visible.isDragging = false;
  touch.isSwiping = false;
}

/** 缩放后重置位移 */
function updateTransform(): void {
  transform.translateX = 0;
  transform.translateY = 0;
}

/**
 * 设置缩放并应用边界
 */
function setScale(scale: number): void {
  transform.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
  updateTransform();
}

/** 缩小 */
function handleZoomOut(): void {
  setScale(transform.scale - SCALE_STEP);
}

/** 放大 */
function handleZoomIn(): void {
  setScale(transform.scale + SCALE_STEP);
}

/** 向左旋转 90° */
function handleRotateLeft(): void {
  transform.rotate = (transform.rotate - 90 + 360) % 360;
}

/** 向右旋转 90° */
function handleRotateRight(): void {
  transform.rotate = (transform.rotate + 90) % 360;
}

useEventListener(window, 'keydown', (e) => {
  if (!show.value) return;

  if (e.key === 'Escape') {
    close();
  } else if (e.key === 'ArrowLeft') {
    handlePrevImage();
  } else if (e.key === 'ArrowRight') {
    handleNextImage();
  }
});

useEventListener(
  window,
  'wheel',
  (event) => {
    if (!show.value) return;
    const viewerEl = viewerRef.value;
    if (viewerEl && event.target instanceof Node && !viewerEl.contains(event.target)) return;
    event.preventDefault();
    if (event.deltaY > 0) {
      handleZoomOut();
    } else {
      handleZoomIn();
    }
  },
  { passive: false }
);

watch(() => currentIndex.value, initScaledDimensions);

watch(
  () => show.value,
  (val) => {
    if (val) {
      bodyOverflow.value = document.body.style.overflow || '';
      document.body.style.overflow = 'hidden';
    } else {
      initSequence++;
      stopDragging();
      document.body.style.overflow = bodyOverflow.value;
    }

    if (!val) return;
    if (!props.images.length) return;

    currentIndex.value = clamp(props.startPosition, 0, props.images.length - 1);
    nextTick(initScaledDimensions);
  }
);

watch(
  () => props.images,
  () => {
    if (!show.value) return;
    if (!props.images.length) {
      visible.image = false;
      return;
    }

    currentIndex.value = clamp(currentIndex.value, 0, props.images.length - 1);
    nextTick(initScaledDimensions);
  }
);

useEventListener(window, 'resize', () => {
  if (show.value) initScaledDimensions();
});

onBeforeUnmount(() => {
  stopDragging();
  document.body.style.overflow = bodyOverflow.value;
});
</script>

<style>
.b-image-viewer {
  position: fixed;
  inset-inline: 0;
  top: 0;
  bottom: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: rgb(0 0 0 / 90%);
}

.b-image-viewer__controls {
  position: relative;
  display: flex;
  flex-shrink: 0;
  gap: 6px;
  align-items: center;
  justify-content: center;
  height: 50px;
}

.b-image-viewer__button {
  position: relative;
  z-index: 100;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  font-size: 18px;
  line-height: 32px;
  color: #fff;
  cursor: pointer;
  background-color: rgb(46 50 56 / 5%);
  border-radius: 8px;
}

.b-image-viewer__button:hover {
  background-color: rgb(46 50 56 / 20%);
}

.b-image-viewer__close {
  position: absolute;
  right: 20px;
}

.b-image-viewer__canvas {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
}

.b-image-viewer__image {
  max-width: 100%;
  max-height: 100%;
  pointer-events: auto;
  user-select: none;
}

.b-image-viewer__fade-scale-enter-active,
.b-image-viewer__fade-scale-leave-active {
  transition: all 0.3s ease;
}

.b-image-viewer__fade-scale-enter-from,
.b-image-viewer__fade-scale-leave-to {
  opacity: 0;
  transform: scale(0.9);
}

.b-image-viewer__fade-scale-enter-to,
.b-image-viewer__fade-scale-leave-from {
  opacity: 1;
  transform: scale(1);
}
</style>
