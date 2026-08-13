<!--
  @file index.vue
  @description BWidget 轮播图元素中间Widget视图。
-->
<template>
  <div class="widget-swiper-element">
    <div v-if="hasImages" class="widget-swiper-element__viewport">
      <div :style="trackStyle" class="widget-swiper-element__track">
        <div v-for="(image, index) in resolvedImages" :key="`${index}-${image.src}`" class="widget-swiper-element__slide">
          <img
            v-if="image.src && !failedSources.has(image.src)"
            class="widget-swiper-element__img"
            :src="image.src"
            :alt="image.alt"
            :style="imageStyle"
            @error="handleImageError(image.src)"
          />
          <div v-else class="widget-swiper-element__placeholder">
            <BIcon class="widget-swiper-element__placeholder-icon" icon="lucide:images" :size="18" />
          </div>
        </div>
      </div>

      <div v-if="showIndicator" class="widget-swiper-element__indicator">
        <button
          v-for="(_, index) in resolvedImages"
          :key="index"
          class="widget-swiper-element__indicator-item"
          :class="`widget-swiper-element__indicator-item--${indicatorShape}`"
          :style="indicatorStyle"
          type="button"
          :aria-label="`切换到第 ${index + 1} 张`"
          :aria-current="activeIndex === index ? 'true' : undefined"
          @click.stop="goToIndex(index)"
        ></button>
      </div>
    </div>
    <div v-else class="widget-swiper-element__placeholder">
      <BIcon class="widget-swiper-element__placeholder-icon" icon="lucide:images" :size="18" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WidgetSwiperElementMetadata, WidgetSwiperImageItem, WidgetSwiperIndicatorShape } from './schema';
import type { WidgetShapeElement } from '../../types';
import type { WidgetImageFit } from '../Image/schema';
import type { CSSProperties } from 'vue';
import { computed, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue';
import type { BSmartValue } from '@/components/BSmart/types';
import { createLiteralValue, isLiteralValue, isVariableValue } from '@/components/BSmart/utils/value';
import { useElementValue } from '../../hooks/useElementValue';
import { useRenderContext } from '../../hooks/useRenderContext';
import { formatWidgetDisplayTextValue, resolveWidgetSmartValue } from '../../utils/widgetBindings';
import { WIDGET_IMAGE_DEFAULT_FIT } from '../Image/schema';
import {
  WIDGET_SWIPER_DEFAULT_ANIMATION_DURATION,
  WIDGET_SWIPER_DEFAULT_AUTOPLAY_INTERVAL,
  WIDGET_SWIPER_DEFAULT_INDICATOR_COLOR,
  WIDGET_SWIPER_DEFAULT_INDICATOR_SHAPE
} from './schema';

/**
 * 轮播图元素中间Widget视图入参。
 */
interface Props {
  /** 当前轮播图元素 */
  element?: WidgetShapeElement<WidgetSwiperElementMetadata>;
}

/** 带解析结果的轮播图图片项。 */
interface ResolvedSwiperImageItem {
  /** 解析后的图片地址 */
  src: string;
  /** 解析后的替代文本 */
  alt: string;
}

const props = defineProps<Props>();
/** 当前轮播图元素响应式引用。 */
const elementRef = toRef(props, 'element');
/** 当前 Widget 渲染上下文。 */
const renderState = useRenderContext();
/** 当前激活图片索引。 */
const activeIndex = ref(0);
/** 加载失败的图片地址集合。 */
const failedSources = ref<Set<string>>(new Set<string>());
/** 当前是否应减少动效。 */
const reducedMotion = ref(false);
/** 自动轮播定时器。 */
let autoplayTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 规整图片文本 Smart 值，不转换旧字符串数据。
 * @param value - 原始字段值
 * @returns 合法文本 Smart 值
 */
function normalizeImageValue(value: unknown): BSmartValue<string> {
  if (isVariableValue(value)) {
    return { ...value };
  }

  if (isLiteralValue(value) && typeof value.value === 'string') {
    return createLiteralValue(value.value);
  }

  return createLiteralValue('');
}

/**
 * 将未知图片列表规整为轮播图图片项列表。
 * @param value - 原始图片列表
 * @returns 规整后的图片项列表
 */
function normalizeImageItems(value: unknown): WidgetSwiperImageItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: unknown): WidgetSwiperImageItem | null => {
      if (item === null || typeof item !== 'object') {
        return null;
      }

      const image = item as Partial<WidgetSwiperImageItem>;
      const normalizedImage: WidgetSwiperImageItem = {
        alt: normalizeImageValue(image.alt),
        src: normalizeImageValue(image.src)
      };

      if (typeof image.title === 'string') {
        normalizedImage.title = image.title;
      }

      return normalizedImage;
    })
    .filter((item: WidgetSwiperImageItem | null): item is WidgetSwiperImageItem => item !== null);
}

/**
 * 将数值规整到最小值以上。
 * @param value - 原始值
 * @param defaultValue - 默认值
 * @param min - 最小值
 * @returns 规整后的数值
 */
function normalizeNumber(value: unknown, defaultValue: number, min: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(min, value) : defaultValue;
}

/**
 * 将索引规整到图片列表范围内。
 * @param index - 原始索引
 * @param length - 图片数量
 * @returns 可用索引
 */
function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }

  return Math.min(length - 1, Math.max(0, Math.floor(index)));
}

/**
 * 将未知指示器形状规整为当前支持的形状。
 * @param value - 原始指示器形状
 * @returns 当前支持的指示器形状
 */
function normalizeIndicatorShape(value: unknown): WidgetSwiperIndicatorShape {
  if (value === 'dot' || value === 'line' || value === 'active-line') {
    return value;
  }

  return WIDGET_SWIPER_DEFAULT_INDICATOR_SHAPE;
}

/**
 * 解析单个图片字段为展示文本。
 * @param value - 原始结构化图片字段
 * @returns 解析后的展示文本
 */
function resolveImageField(value: BSmartValue<string> | undefined): string {
  const resolvedValue = resolveWidgetSmartValue(value, {
    renderContext: renderState.renderContext.value,
    renderOptions: renderState.options.value
  });

  return formatWidgetDisplayTextValue(resolvedValue);
}

/** 原始图片配置列表。 */
const imageItems = computed<WidgetSwiperImageItem[]>((): WidgetSwiperImageItem[] => normalizeImageItems(elementRef.value?.metadata.images));
/** 解析后的图片配置列表。 */
const resolvedImages = computed<ResolvedSwiperImageItem[]>((): ResolvedSwiperImageItem[] =>
  imageItems.value.map(
    (image: WidgetSwiperImageItem): ResolvedSwiperImageItem => ({
      alt: resolveImageField(image.alt),
      src: resolveImageField(image.src)
    })
  )
);
/** 当前是否存在图片项。 */
const hasImages = computed<boolean>((): boolean => resolvedImages.value.length > 0);
/** 图片填充模式。 */
const imageFit = computed<WidgetImageFit>((): WidgetImageFit => elementRef.value?.metadata.fit || WIDGET_IMAGE_DEFAULT_FIT);
/** 是否开启自动轮播。 */
const autoplayEnabled = useElementValue(elementRef, 'autoplay', { smart: true, transform: 'boolean' });
/** 自动轮播间隔，单位 ms。 */
const autoplayInterval = computed<number>((): number =>
  normalizeNumber(elementRef.value?.metadata.autoplayInterval, WIDGET_SWIPER_DEFAULT_AUTOPLAY_INTERVAL, 100)
);
/** 切换动画时长，单位 ms。 */
const animationDuration = computed<number>((): number =>
  reducedMotion.value ? 0 : normalizeNumber(elementRef.value?.metadata.animationDuration, WIDGET_SWIPER_DEFAULT_ANIMATION_DURATION, 0)
);
/** 是否开启循环播放。 */
const loopEnabled = useElementValue(elementRef, 'loop', { smart: true, transform: 'boolean' });
/** 是否纵向滚动。 */
const verticalEnabled = useElementValue(elementRef, 'vertical', { smart: true, transform: 'boolean' });
/** 指示器显示配置。 */
const indicatorVisible = useElementValue(elementRef, 'showIndicator', { smart: true, transform: 'boolean' });
/** 是否展示指示器。 */
const showIndicator = computed<boolean>((): boolean => indicatorVisible.value && resolvedImages.value.length > 1);
/** 指示器颜色。 */
const indicatorColor = computed<string>((): string => elementRef.value?.metadata.indicatorColor || WIDGET_SWIPER_DEFAULT_INDICATOR_COLOR);
/** 指示器形状。 */
const indicatorShape = computed<WidgetSwiperIndicatorShape>(
  (): WidgetSwiperIndicatorShape => normalizeIndicatorShape(elementRef.value?.metadata.indicatorShape)
);
/** 是否禁用下一张导航。 */
const isNextDisabled = computed<boolean>((): boolean => !loopEnabled.value && activeIndex.value >= resolvedImages.value.length - 1);
/** 图片内联样式。 */
const imageStyle = computed<CSSProperties>((): CSSProperties => ({ objectFit: imageFit.value }));
/** 指示器内联样式。 */
const indicatorStyle = computed<CSSProperties>((): CSSProperties => ({ '--widget-swiper-indicator-color': indicatorColor.value } as CSSProperties));
/** 轮播轨道内联样式。 */
const trackStyle = computed<CSSProperties>((): CSSProperties => {
  const offset = activeIndex.value * -100;

  return {
    flexDirection: verticalEnabled.value ? 'column' : 'row',
    transitionDuration: `${animationDuration.value}ms`,
    transform: verticalEnabled.value ? `translateY(${offset}%)` : `translateX(${offset}%)`
  };
});

/**
 * 根据循环配置规整目标索引。
 * @param index - 目标索引
 * @returns 可用索引
 */
function normalizeTargetIndex(index: number): number {
  const { length } = resolvedImages.value;
  if (length <= 0) {
    return 0;
  }

  if (!loopEnabled.value) {
    return clampIndex(index, length);
  }

  return ((index % length) + length) % length;
}

/**
 * 切换到指定图片索引。
 * @param index - 目标图片索引
 */
function goToIndex(index: number): void {
  activeIndex.value = normalizeTargetIndex(index);
}

/**
 * 切换到下一张。
 */
function goNext(): void {
  if (isNextDisabled.value) {
    return;
  }

  goToIndex(activeIndex.value + 1);
}

/**
 * 清理自动轮播定时器。
 */
function clearAutoplayTimer(): void {
  if (autoplayTimer === null) {
    return;
  }

  clearInterval(autoplayTimer);
  autoplayTimer = null;
}

/**
 * 按当前配置启动自动轮播。
 */
function startAutoplayTimer(): void {
  clearAutoplayTimer();

  if (!autoplayEnabled.value || resolvedImages.value.length <= 1 || (!loopEnabled.value && isNextDisabled.value)) {
    return;
  }

  autoplayTimer = setInterval((): void => {
    if (!loopEnabled.value && isNextDisabled.value) {
      clearAutoplayTimer();
      return;
    }

    goNext();
  }, autoplayInterval.value);
}

/**
 * 标记图片加载失败。
 * @param src - 加载失败的图片地址
 */
function handleImageError(src: string): void {
  failedSources.value = new Set<string>([...failedSources.value, src]);
}

/**
 * 按元素初始索引重置当前激活索引。
 */
function resetActiveIndex(): void {
  activeIndex.value = clampIndex(normalizeNumber(elementRef.value?.metadata.initialIndex, 0, 0), resolvedImages.value.length);
}

/**
 * 同步用户动效偏好。
 */
function syncReducedMotion(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    reducedMotion.value = false;
    return;
  }

  reducedMotion.value = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

watch(
  () => [elementRef.value?.id, elementRef.value?.metadata.initialIndex, resolvedImages.value.length],
  (): void => {
    failedSources.value = new Set<string>();
    resetActiveIndex();
  },
  { immediate: true }
);

watch(
  () => [autoplayEnabled.value, autoplayInterval.value, activeIndex.value, loopEnabled.value, resolvedImages.value.length],
  (): void => {
    startAutoplayTimer();
  },
  { immediate: true }
);

onMounted((): void => {
  syncReducedMotion();
});

onBeforeUnmount((): void => {
  clearAutoplayTimer();
});
</script>

<style lang="less" scoped>
.widget-swiper-element {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  border-color: transparent;
}

.widget-swiper-element__viewport {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.widget-swiper-element__track {
  display: flex;
  width: 100%;
  height: 100%;
  transition-timing-function: ease-out;
  transition-property: transform;
}

.widget-swiper-element__slide {
  position: relative;
  flex: 0 0 100%;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.widget-swiper-element__img {
  display: block;
  width: 100%;
  height: 100%;
}

.widget-swiper-element__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--text-tertiary);
  background: rgb(128 128 128 / 8%);
}

.widget-swiper-element__placeholder-icon {
  opacity: 0.5;
}

.widget-swiper-element__indicator {
  position: absolute;
  right: 8px;
  bottom: 8px;
  left: 8px;
  z-index: 2;
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.widget-swiper-element__indicator-item {
  display: inline-flex;
  flex: 0 0 auto;
  padding: 0;
  pointer-events: auto;
  cursor: pointer;
  background: var(--widget-swiper-indicator-color);
  border: 0;
  opacity: 0.45;
}

.widget-swiper-element__indicator-item[aria-current='true'] {
  opacity: 1;
}

.widget-swiper-element__indicator-item--dot {
  width: 3px;
  height: 3px;
  border-radius: var(--radius-full);
}

.widget-swiper-element__indicator-item--line {
  width: 16px;
  height: 3px;
  border-radius: var(--radius-full);
}

.widget-swiper-element__indicator-item--active-line {
  width: 3px;
  height: 3px;
  border-radius: var(--radius-full);
}

.widget-swiper-element__indicator-item--active-line[aria-current='true'] {
  width: 10px;
  height: 3px;
  border-radius: var(--radius-full);
}

@media (prefers-reduced-motion: reduce) {
  .widget-swiper-element__track {
    transition-duration: 0ms !important;
  }
}
</style>
