<!--
  @file index.vue
  @description BWidget 图片元素中间Widget视图。
-->
<template>
  <div class="widget-image-element">
    <img v-if="imageSrc && !hasError" class="widget-image-element__img" :src="imageSrc" :alt="altText" :style="imageStyle" @error="handleError" />
    <div v-else class="widget-image-element__placeholder">
      <BIcon class="widget-image-element__placeholder-icon" :icon="placeholderIcon" :size="18" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WidgetImageElementMetadata, WidgetImageFit } from './schema';
import type { WidgetShapeElement } from '../../types';
import type { CSSProperties } from 'vue';
import { computed, ref, toRef, watch } from 'vue';
import { useElementValue } from '../../hooks/useElementValue';
import { WIDGET_IMAGE_DEFAULT_FIT } from './schema';

/**
 * 图片元素中间Widget视图入参。
 */
interface Props {
  /** 当前图片元素 */
  element?: WidgetShapeElement<WidgetImageElementMetadata>;
}

const props = defineProps<Props>();
/** 图片地址（渲染态，已解析变量）。 */
const imageSrc = useElementValue(toRef(props, 'element'), 'src', { smart: true, transform: 'text' });
/** 替代文本（渲染态，已解析变量）。 */
const altText = useElementValue(toRef(props, 'element'), 'alt', { smart: true, transform: 'text' });
/** 图片加载失败标记，src 变化时重置以重新尝试加载。 */
const hasError = ref(false);

// src 变化时重置错误状态，允许新地址重新加载
watch(imageSrc, (): void => {
  hasError.value = false;
});

/** 图片填充模式，归一化为合法值。 */
const fit = computed<WidgetImageFit>((): WidgetImageFit => props.element?.metadata.fit || WIDGET_IMAGE_DEFAULT_FIT);

/** 图片内联样式：object-fit 控制填充，宽高撑满元素 box。 */
const imageStyle = computed<CSSProperties>((): CSSProperties => ({ objectFit: fit.value, width: '100%', height: '100%' }));

/** 占位图标：加载失败用 image-off，未设置地址用 image。 */
const placeholderIcon = computed((): string => (hasError.value ? 'lucide:image-off' : 'lucide:image'));

/**
 * 图片加载失败回调，标记错误状态以切换到占位视图。
 */
function handleError(): void {
  hasError.value = true;
}
</script>

<style lang="less" scoped>
.widget-image-element {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
  border-color: transparent;
}

.widget-image-element__img {
  display: block;
  width: 100%;
  height: 100%;
}

.widget-image-element__placeholder {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--text-tertiary);
}

.widget-image-element__placeholder-icon {
  opacity: 0.5;
}
</style>
