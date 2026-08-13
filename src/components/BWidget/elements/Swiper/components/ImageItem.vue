<!--
  @file ImageItem.vue
  @description BWidget 轮播图图片条形编辑项。
-->
<template>
  <div class="widget-swiper-image-item" :class="{ 'is-collapsed': collapsed }">
    <div class="widget-swiper-image-item__bar">
      <button class="widget-swiper-image-item__drag" :class="handleClass" type="button" @click.stop>
        <BIcon icon="lucide:grip-vertical" :size="14" />
      </button>
      <div class="widget-swiper-image-item__main">
        <input
          v-if="editingTitle"
          ref="titleInputRef"
          v-model="titleDraft"
          class="widget-swiper-image-item__title-input"
          type="text"
          @blur="commitTitle"
          @keydown.enter.stop.prevent="commitTitle"
          @keydown.esc.stop.prevent="cancelTitleEdit"
        />
        <button v-else class="widget-swiper-image-item__title" type="button" @click="startTitleEdit">
          {{ title }}
        </button>
        <span v-if="summary" class="widget-swiper-image-item__summary">{{ summary }}</span>
      </div>
      <div class="widget-swiper-image-item__actions">
        <BButton
          class="widget-swiper-image-item__remove widget-swiper-setter__remove"
          type="text"
          size="mini"
          danger
          square
          icon="lucide:trash-2"
          :disabled="!removable"
          @click="emit('remove')"
        />
        <BButton
          class="widget-swiper-image-item__collapse"
          type="text"
          size="mini"
          square
          :icon="collapsed ? 'lucide:chevron-right' : 'lucide:chevron-down'"
          @click="emit('toggle-collapse')"
        />
      </div>
    </div>

    <div v-if="!collapsed" class="widget-swiper-image-item__body">
      <BSectionItem label="地址" label-min-width="51">
        <BSmartInput
          class="widget-swiper-setter__src-input widget-swiper-image-item__src-input"
          :value="image.src"
          :options="variableOptions"
          placeholder="图片地址"
          @update:value="updateSrc"
        />
      </BSectionItem>
      <BSectionItem label="替代文本" label-min-width="51">
        <BSmartInput
          class="widget-swiper-setter__alt-input widget-swiper-image-item__alt-input"
          :value="image.alt"
          :options="variableOptions"
          placeholder="替代文本"
          allow-clear
          @update:value="updateAlt"
        />
      </BSectionItem>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { WidgetSwiperImageItem } from '../schema';
import { computed, nextTick, ref } from 'vue';
import type { BSmartValue, VariableOptionGroup } from '@/components/BSmart/types';

defineOptions({ name: 'SwiperImageItem' });

/**
 * 轮播图图片条形编辑项入参。
 */
interface Props {
  /** 图片项数据 */
  image: WidgetSwiperImageItem;
  /** 图片项下标 */
  index: number;
  /** 是否折叠 */
  collapsed: boolean;
  /** 是否允许删除 */
  removable: boolean;
  /** 拖拽手柄 class */
  handleClass?: string;
  /** 当前可插入变量候选 */
  variableOptions?: VariableOptionGroup[];
}

const props = withDefaults(defineProps<Props>(), {
  handleClass: '',
  variableOptions: (): VariableOptionGroup[] => []
});

const emit = defineEmits<{
  /** 图片项字段更新 */
  update: [image: WidgetSwiperImageItem];
  /** 删除当前图片项 */
  remove: [];
  /** 切换折叠状态 */
  'toggle-collapse': [];
}>();

/** 图片项标题。 */
const title = computed<string>((): string => props.image.title?.trim() || `图片 ${props.index + 1}`);
/** 图片项摘要。 */
const summary = computed<string>((): string => props.image.src.value.trim());
/** 是否正在编辑标题。 */
const editingTitle = ref(false);
/** 标题输入框元素引用。 */
const titleInputRef = ref<HTMLInputElement | null>(null);
/** 标题编辑草稿。 */
const titleDraft = ref('');

/**
 * 进入标题编辑状态。
 */
async function startTitleEdit(): Promise<void> {
  titleDraft.value = props.image.title?.trim() || title.value;
  editingTitle.value = true;

  await nextTick();

  titleInputRef.value?.focus();
  titleInputRef.value?.select();
}

/**
 * 提交标题编辑内容。
 */
function commitTitle(): void {
  if (!editingTitle.value) {
    return;
  }

  const nextTitle = titleDraft.value.trim();
  const currentTitle = props.image.title?.trim() ?? '';

  editingTitle.value = false;

  if ((currentTitle === '' && nextTitle === title.value) || currentTitle === nextTitle) {
    return;
  }

  emit('update', {
    ...props.image,
    title: nextTitle
  });
}

/**
 * 取消标题编辑。
 */
function cancelTitleEdit(): void {
  editingTitle.value = false;
  titleDraft.value = '';
}

/**
 * 更新图片地址。
 * @param value - 新图片地址
 */
function updateSrc(value: BSmartValue<string>): void {
  emit('update', {
    ...props.image,
    src: value
  });
}

/**
 * 更新替代文本。
 * @param value - 新替代文本
 */
function updateAlt(value: BSmartValue<string>): void {
  emit('update', {
    ...props.image,
    alt: value
  });
}
</script>

<style lang="less" scoped>
.widget-swiper-image-item {
  overflow: hidden;
  background: var(--bg-secondary);
  border: 1px solid var(--border-primary);
  border-radius: var(--control-radius);

  &:hover .widget-swiper-image-item__remove,
  &:focus-within .widget-swiper-image-item__remove {
    pointer-events: auto;
    opacity: 1;
  }
}

.widget-swiper-image-item__bar {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 6px;
  align-items: center;
  min-height: 32px;
  padding: 4px 6px;
}

.widget-swiper-image-item__drag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  color: var(--text-tertiary);
  cursor: grab;
  background: transparent;
  border: 0;
}

.widget-swiper-image-item__main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.widget-swiper-image-item__title {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  padding: 0;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  color: var(--text-primary);
  text-align: left;
  cursor: text;
  background: transparent;
  border: 0;
}

.widget-swiper-image-item__title-input {
  width: 100%;
  min-width: 0;
  height: 20px;
  padding: 0 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  outline: none;
  background: var(--bg-primary);
  border: 1px solid var(--border-active);
  border-radius: 4px;
}

.widget-swiper-image-item__summary {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.widget-swiper-image-item__actions {
  display: flex;
  gap: 2px;
  align-items: center;
}

.widget-swiper-image-item__remove {
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.16s ease;
}

.widget-swiper-image-item__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 8px 8px;
}
</style>
