<!--
  @file ImagePreview.vue
  @description 图片预览组件，展示已上传的图片列表和模型不支持图片的警告提示
-->
<template>
  <div v-if="images.length && supportsVision" class="image-preview-container">
    <div v-if="images.length" class="image-preview">
      <div v-for="(image, index) in images" :key="image.id" class="image-preview-item">
        <img :src="image.url" :alt="image.name" class="image-preview-image" @click="handleImageClick(index)" />
        <div class="image-preview-remove" @click.stop="handleRemoveImage(image.id)">
          <BIcon icon="lucide:x" :size="12" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ChatMessageFile } from 'types/chat';
import { computed } from 'vue';
import type { ImagePreviewItem } from '@/hooks/useImagePreview';
import { useImagePreview } from '@/hooks/useImagePreview';

/**
 * 图片预览组件 Props
 */
interface Props {
  /** 已上传的图片列表 */
  images: ChatMessageFile[];
  /** 当前模型是否阻止图片上传 */
  supportsVision: boolean;
  /** 删除图片的回调函数 */
  onRemoveImage: (imageId: string) => void;
}

const props = defineProps<Props>();
const { previewImage } = useImagePreview();

/** 图片预览条目列表 */
const imagePreviewItems = computed<ImagePreviewItem[]>(() =>
  props.images
    .filter((image) => Boolean(image.url))
    .map((image) => ({
      src: image.url || '',
      name: image.name,
      mimeType: image.mimeType
    }))
);

/**
 * 处理图片点击事件，打开图片查看器。
 * @param index - 图片索引
 */
async function handleImageClick(index: number): Promise<void> {
  await previewImage({ images: imagePreviewItems.value, startPosition: index, showCarousel: props.images.length > 1 });
}

/**
 * 处理删除图片操作
 * @param imageId - 图片 ID
 */
function handleRemoveImage(imageId: string): void {
  props.onRemoveImage(imageId);
}
</script>

<style lang="less" scoped>
.image-preview-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.image-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
}

.image-preview-item {
  position: relative;
  flex: 0 0 auto;
  width: 60px;
  height: 60px;
  // overflow: hidden;
  border: var(--surface-border-width) solid var(--border-primary);
  border-radius: var(--surface-radius);

  &:hover {
    .image-preview-remove {
      opacity: 1;
    }
  }
}

.image-preview-image {
  width: 100%;
  height: 100%;
  cursor: pointer;
  object-fit: cover;
  border-radius: var(--surface-radius);
}

.image-preview-remove {
  position: absolute;
  top: -4px;
  right: -4px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: #fff;
  cursor: pointer;
  background: var(--color-primary);
  border-radius: 50%;
  opacity: 0;
  transition: opacity var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    background: var(--color-primary-hover);
  }
}

.image-warning {
  width: 100%;
  font-size: 12px;
  color: var(--color-danger, #d14343);
}
</style>
