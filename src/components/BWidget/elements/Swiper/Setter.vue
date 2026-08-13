<!--
  @file Setter.vue
  @description BWidget 轮播图元素专属属性设置面板。
-->
<template>
  <BSectionBlock title="图片" label-min-width="64">
    <template #extra>
      <BButton icon="lucide:plus" size="mini" square type="text" @click="addImage" />
    </template>

    <BDraggable
      class="widget-swiper-setter__image-list"
      :list="imageEntries"
      item-key="key"
      item-class="widget-swiper-setter__image-item"
      handle-class="widget-swiper-image-item__drag-handle"
      @move="handleImageMove"
    >
      <template #default="{ item: entry, handleClass }">
        <SwiperImageItem
          :image="entry.image"
          :index="entry.index"
          :collapsed="isImageCollapsed(entry.key)"
          :removable="imageEntries.length > 1"
          :variable-options="variableOptions"
          :handle-class="handleClass"
          @update="(image: WidgetSwiperImageItem) => updateImage(entry.index, image)"
          @remove="removeImage(entry.index)"
          @toggle-collapse="toggleImageCollapsed(entry.key)"
        />
      </template>
    </BDraggable>
  </BSectionBlock>

  <BSectionBlock title="显示" label-min-width="64">
    <BSectionItem label="填充">
      <BSelect v-model:value="element.metadata.fit" class="widget-swiper-setter__fit-select" :options="WIDGET_SWIPER_FIT_OPTIONS" />
    </BSectionItem>
    <BSectionItem label="初始索引">
      <BInputNumber v-model:value="element.metadata.initialIndex" class="widget-swiper-setter__initial-index-input" :min="0" :precision="0" />
    </BSectionItem>
    <BSectionItem label="纵向滚动">
      <BSmartSelect
        v-model:value="element.metadata.vertical"
        class="widget-swiper-setter__vertical-select"
        :options="WIDGET_SWIPER_BOOLEAN_OPTIONS"
        :variables="variableOptions"
      />
    </BSectionItem>
  </BSectionBlock>

  <BSectionBlock title="播放" label-min-width="64">
    <BSectionItem label="自动播放">
      <BSmartSelect
        v-model:value="element.metadata.autoplay"
        class="widget-swiper-setter__autoplay-select"
        :options="WIDGET_SWIPER_BOOLEAN_OPTIONS"
        :variables="variableOptions"
      />
    </BSectionItem>
    <BSectionItem label="间隔">
      <BInputNumber v-model:value="element.metadata.autoplayInterval" class="widget-swiper-setter__interval-input" :min="100" :precision="0" />
    </BSectionItem>
    <BSectionItem label="动画时长">
      <BInputNumber v-model:value="element.metadata.animationDuration" class="widget-swiper-setter__duration-input" :min="0" :precision="0" />
    </BSectionItem>
    <BSectionItem label="循环播放">
      <BSmartSelect
        v-model:value="element.metadata.loop"
        class="widget-swiper-setter__loop-select"
        :options="WIDGET_SWIPER_BOOLEAN_OPTIONS"
        :variables="variableOptions"
      />
    </BSectionItem>
  </BSectionBlock>

  <BSectionBlock title="指示器" label-min-width="64">
    <BSectionItem label="显示">
      <BSmartSelect
        v-model:value="element.metadata.showIndicator"
        class="widget-swiper-setter__indicator-visible-select"
        :options="WIDGET_SWIPER_BOOLEAN_OPTIONS"
        :variables="variableOptions"
      />
    </BSectionItem>
    <BSectionItem label="颜色">
      <BColorPicker v-model:value="element.metadata.indicatorColor" class="widget-swiper-setter__indicator-color" />
    </BSectionItem>
    <BSectionItem label="形状">
      <BSelect
        v-model:value="element.metadata.indicatorShape"
        class="widget-swiper-setter__indicator-shape-select"
        :options="WIDGET_SWIPER_INDICATOR_SHAPE_OPTIONS"
      />
    </BSectionItem>
  </BSectionBlock>
</template>

<script setup lang="ts">
import type { WidgetSwiperElementMetadata, WidgetSwiperImageItem } from './schema';
import type { WidgetElement } from '../../types';
import { computed, ref, watch } from 'vue';
import type { BDraggableMoveEvent } from '@/components/BDraggable/types';
import type { BSmartValue } from '@/components/BSmart/types';
import { createLiteralValue, isLiteralValue, isVariableValue } from '@/components/BSmart/utils/value';
import { useElementVariables } from '../../hooks/useElementVariables';
import SwiperImageItem from './components/ImageItem.vue';
import { WIDGET_SWIPER_BOOLEAN_OPTIONS, WIDGET_SWIPER_FIT_OPTIONS, WIDGET_SWIPER_INDICATOR_SHAPE_OPTIONS } from './schema';

/**
 * 轮播图图片拖拽展示项。
 */
interface SwiperImageEntry {
  /** 拖拽项唯一标识 */
  key: string;
  /** 当前图片下标 */
  index: number;
  /** 图片项 */
  image: WidgetSwiperImageItem;
}

/** 当前编辑的轮播图元素。 */
const element = defineModel<WidgetElement<WidgetSwiperElementMetadata>>('element', { required: true });

/** 当前可插入变量候选。 */
const { variableOptions } = useElementVariables((): WidgetElement<WidgetSwiperElementMetadata> => element.value);
/** 图片项本地稳定 key 列表，不写入 metadata。 */
const imageKeys = ref<string[]>([]);
/** 图片项本地折叠 key 集合，不写入 metadata。 */
const collapsedKeys = ref<Set<string>>(new Set<string>());
/** 图片项 key 自增种子。 */
let imageKeySeed = 0;

/**
 * 创建空轮播图图片项。
 * @returns 空图片项
 */
function createEmptyImage(): WidgetSwiperImageItem {
  return {
    alt: createLiteralValue(''),
    src: createLiteralValue('')
  };
}

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
 * 创建本地图片项 key。
 * @returns 本地图片项 key
 */
function createImageKey(): string {
  imageKeySeed += 1;

  return `swiper-image-${imageKeySeed}`;
}

/**
 * 规整图片项列表，保证至少有一行可编辑。
 * @param images - 原始图片项列表
 * @returns 可编辑图片项列表
 */
function normalizeImages(images: WidgetSwiperImageItem[] | undefined): WidgetSwiperImageItem[] {
  if (!Array.isArray(images) || images.length === 0) {
    return [createEmptyImage()];
  }

  return images.map((image: WidgetSwiperImageItem): WidgetSwiperImageItem => {
    const normalizedImage: WidgetSwiperImageItem = {
      alt: normalizeImageValue(image.alt),
      src: normalizeImageValue(image.src)
    };

    if (typeof image.title === 'string') {
      normalizedImage.title = image.title;
    }

    return normalizedImage;
  });
}

/**
 * 写回轮播图图片项列表。
 * @param images - 新图片项列表
 */
function writeImages(images: WidgetSwiperImageItem[]): void {
  element.value.metadata = {
    ...element.value.metadata,
    images: normalizeImages(images)
  };
}

/** 当前可编辑图片项列表。 */
const imageItems = computed<WidgetSwiperImageItem[]>((): WidgetSwiperImageItem[] => normalizeImages(element.value.metadata.images));

/**
 * 同步本地图片项 key 列表长度。
 */
function syncImageKeys(): void {
  const nextKeys = imageKeys.value.slice(0, imageItems.value.length);

  while (nextKeys.length < imageItems.value.length) {
    nextKeys.push(createImageKey());
  }

  imageKeys.value = nextKeys;
  collapsedKeys.value = new Set<string>([...collapsedKeys.value].filter((key: string): boolean => nextKeys.includes(key)));
}

/** 当前图片拖拽展示项列表。 */
const imageEntries = computed<SwiperImageEntry[]>((): SwiperImageEntry[] =>
  imageItems.value.map(
    (image: WidgetSwiperImageItem, index: number): SwiperImageEntry => ({
      image,
      index,
      key: imageKeys.value[index] ?? `swiper-image-fallback-${index}`
    })
  )
);

/**
 * 更新指定图片项。
 * @param index - 图片项下标
 * @param image - 新图片项
 */
function updateImage(index: number, image: WidgetSwiperImageItem): void {
  const nextImages = imageItems.value.map((item: WidgetSwiperImageItem): WidgetSwiperImageItem => ({ ...item }));

  nextImages[index] = image;
  writeImages(nextImages);
}

/**
 * 添加图片项。
 */
function addImage(): void {
  const key = createImageKey();

  imageKeys.value = [...imageKeys.value, key];
  collapsedKeys.value = new Set<string>([...collapsedKeys.value].filter((item: string): boolean => item !== key));
  writeImages([...imageItems.value, createEmptyImage()]);
}

/**
 * 删除图片项，至少保留一行。
 * @param index - 待删除图片项下标
 */
function removeImage(index: number): void {
  if (imageItems.value.length <= 1) {
    return;
  }

  const removedKey = imageKeys.value[index];
  imageKeys.value = imageKeys.value.filter((_key: string, keyIndex: number): boolean => keyIndex !== index);
  if (removedKey) {
    collapsedKeys.value = new Set<string>([...collapsedKeys.value].filter((key: string): boolean => key !== removedKey));
  }

  writeImages(imageItems.value.filter((_image: WidgetSwiperImageItem, imageIndex: number): boolean => imageIndex !== index));
}

/**
 * 处理图片项拖拽排序。
 * @param event - 拖拽排序事件
 */
function handleImageMove(event: BDraggableMoveEvent<SwiperImageEntry>): void {
  imageKeys.value = event.nextList.map((entry: SwiperImageEntry): string => entry.key);
  writeImages(event.nextList.map((entry: SwiperImageEntry): WidgetSwiperImageItem => entry.image));
}

/**
 * 判断图片项是否折叠。
 * @param key - 图片项本地 key
 * @returns 是否折叠
 */
function isImageCollapsed(key: string): boolean {
  return collapsedKeys.value.has(key);
}

/**
 * 切换图片项折叠状态。
 * @param key - 图片项本地 key
 */
function toggleImageCollapsed(key: string): void {
  const nextKeys = new Set<string>(collapsedKeys.value);

  if (nextKeys.has(key)) {
    nextKeys.delete(key);
  } else {
    nextKeys.add(key);
  }

  collapsedKeys.value = nextKeys;
}

watch(
  () => imageItems.value.length,
  (): void => {
    syncImageKeys();
  },
  { immediate: true }
);
</script>

<style lang="less" scoped>
.widget-swiper-setter__image-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
