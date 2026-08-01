<!--
  @file ImageBlock.vue
  @description BEditor Rich 模式图片 NodeView，支持点击放大预览与复制图片。
-->
<template>
  <NodeViewWrapper :class="[name, { 'is-selected': selected, 'is-error': imageLoadError }]" contenteditable="false">
    <img :src="src" :alt="alt" :title="title || undefined" :class="bem('img')" @click="handleImageClick" @mousedown.prevent @error="handleImageError" />

    <button v-if="!imageLoadError" type="button" :class="bem('copy')" title="复制图片" aria-label="复制图片" @click="handleImageCopyClick" @mousedown.prevent>
      <BIcon icon="lucide:copy" :size="14" />
    </button>

    <div v-if="imageLoadError" :class="bem('error')">
      <BIcon icon="lucide:image-off" :size="24" />
      <span>图片加载失败</span>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { useClipboard } from '@/hooks/useClipboard';
import { useImagePreview } from '@/hooks/useImagePreview';
import { createNamespace } from '@/utils/namespace';

const [name, bem] = createNamespace('markdown-image');

const props = defineProps(nodeViewProps);

const { copyImage } = useClipboard();
const { previewImage } = useImagePreview();

/** 图片是否加载失败 */
const imageLoadError = ref(false);

/** 图片 src 属性 */
const src = computed<string>(() => (typeof props.node.attrs.src === 'string' ? props.node.attrs.src : ''));

/** 图片 alt 属性 */
const alt = computed<string>(() => (typeof props.node.attrs.alt === 'string' ? props.node.attrs.alt : ''));

/** 图片 title 属性 */
const title = computed<string>(() => (typeof props.node.attrs.title === 'string' ? props.node.attrs.title : ''));

/** 图片 src 变化时重置错误状态 */
watch(src, () => {
  imageLoadError.value = false;
});

/**
 * 图片加载失败时标记错误状态，禁用预览与复制。
 */
function handleImageError(): void {
  imageLoadError.value = true;
}

/**
 * 点击图片打开预览查看器。
 */
async function handleImageClick(): Promise<void> {
  if (imageLoadError.value || !src.value) return;

  await previewImage({
    images: [{ src: src.value }],
    startPosition: 0,
    showCarousel: false
  });
}

/**
 * 复制图片本体到系统剪贴板。
 * @param event - 鼠标点击事件
 */
async function handleImageCopyClick(event: MouseEvent): Promise<void> {
  event.preventDefault();
  event.stopPropagation();

  if (!src.value) return;

  await copyImage(src.value, {
    successMessage: '图片已复制',
    errorMessage: '复制图片失败'
  });
}
</script>

<style scoped lang="less">
.b-markdown-image {
  position: relative;
  display: inline-block;
  max-width: 100%;
  margin: 0.75em 0;
  line-height: 0;
  vertical-align: top;
  border-radius: var(--surface-radius);
}

.b-markdown-image__img {
  display: block;
  max-width: 100%;
  cursor: zoom-in;
  user-select: none;
  -webkit-user-drag: none;
  border-radius: var(--surface-radius);
}

.b-markdown-image__copy {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--text-secondary);
  cursor: pointer;
  background: var(--bg-primary);
  border: none;
  border-radius: var(--control-radius);
  opacity: 0;
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard), color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);

  &:hover,
  &:focus-visible {
    color: var(--color-primary);
    background: var(--bg-secondary);
  }
}

.b-markdown-image:hover .b-markdown-image__copy,
.b-markdown-image:focus-within .b-markdown-image__copy {
  opacity: 1;
}

.b-markdown-image__error {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 80px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-tertiary);
  background: var(--bg-tertiary);
  border: var(--surface-border-width) dashed var(--border-secondary);
  border-radius: var(--surface-radius);
}

.b-markdown-image.is-selected {
  .b-markdown-image__img {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }
}

.b-markdown-image.is-error {
  .b-markdown-image__img {
    display: none;
  }
}
</style>
