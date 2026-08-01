<!--
  @file ImageNode.vue
  @description BMessage 图片行内节点渲染组件。
-->
<template>
  <span :class="bem('image')">
    <img
      :src="node.src"
      :alt="node.alt"
      :title="node.title || undefined"
      :class="bem('image-img')"
      @click="handleImageClick"
      @mousedown="handleImageMouseDown"
      @error="handleImageError"
    />
    <button
      v-if="!imageLoadError"
      type="button"
      :class="bem('image-copy')"
      title="复制图片"
      aria-label="复制图片"
      @click="handleImageCopyClick"
      @mousedown.stop.prevent
    >
      <BIcon icon="lucide:copy" :size="14" />
    </button>
  </span>
</template>

<script setup lang="ts">
import type { ImageInlineNode } from '../types';
import { inject, ref, watch } from 'vue';
import { useClipboard } from '@/hooks/useClipboard';
import { createNamespace } from '@/utils/namespace';
import { MESSAGE_NODE_RENDER_CONTEXT_KEY } from '../types';

defineOptions({ name: 'ImageNode' });

const [, bem] = createNamespace('message');

/**
 * ImageNode 组件属性。
 */
interface Props {
  /** 待渲染的图片行内节点 */
  node: ImageInlineNode;
}

const props = defineProps<Props>();

const renderContext = inject(MESSAGE_NODE_RENDER_CONTEXT_KEY, null);
const { copyImage } = useClipboard();

/** 图片是否加载失败 */
const imageLoadError = ref(false);

/** 图片 src 变化时重置错误状态 */
watch(
  () => props.node.src,
  () => {
    imageLoadError.value = false;
  }
);

/**
 * 图片加载失败时标记错误状态，禁用预览与复制。
 */
function handleImageError(): void {
  imageLoadError.value = true;
}

/**
 * 处理图片点击，加载失败时不触发预览。
 * @param event - 鼠标点击事件
 */
async function handleImageClick(event: MouseEvent): Promise<void> {
  if (imageLoadError.value) return;

  event.preventDefault();
  event.stopPropagation();
  await renderContext?.previewImageAt(props.node.imageIndex);
}

/**
 * 复制图片本体到系统剪贴板。
 * @param event - 鼠标点击事件
 */
async function handleImageCopyClick(event: MouseEvent): Promise<void> {
  event.preventDefault();
  event.stopPropagation();

  await copyImage(props.node.src, {
    successMessage: '图片已复制',
    errorMessage: '复制图片失败'
  });
}

/**
 * 阻止图片拖拽和选区。
 * @param event - 鼠标按下事件
 */
function handleImageMouseDown(event: MouseEvent): void {
  event.preventDefault();
}
</script>

<style scoped lang="less">
.b-message__image {
  position: relative;
  display: inline-block;
  max-width: 100%;
  line-height: 0;
  vertical-align: top;
}

.b-message__image-img {
  display: block;
  max-width: 100%;
}

.b-message__image-copy {
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
  border-radius: var(--control-radius);
  opacity: 0;
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard), color var(--motion-duration-fast) var(--motion-easing-standard),
    background var(--motion-duration-fast) var(--motion-easing-standard);
}

.b-message__image-copy:hover,
.b-message__image-copy:focus-visible {
  color: var(--color-primary);
  background: var(--bg-secondary);
  border-color: var(--border-primary);
}

.b-message__image:hover .b-message__image-copy,
.b-message__image:focus-within .b-message__image-copy {
  opacity: 1;
}
</style>
