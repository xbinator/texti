<template>
  <Teleport to="body" :disabled="!teleport">
    <div v-if="visible" ref="dropdownRef" class="select-dropdown" :style="menuStyle" v-bind="$attrs" @mousedown.prevent>
      <!-- 可选的头部区域 -->
      <div v-if="$slots.header" class="select-dropdown__header">
        <slot name="header"></slot>
      </div>
      <!-- 列表区域 -->
      <div v-if="items.length > 0" class="select-dropdown__list">
        <template v-for="(item, index) in items" :key="index">
          <slot name="before-item" :item="item" :index="index"></slot>
          <div class="select-dropdown__item" :class="{ active: activeIndex === index }" @click="handleSelect(item)" @mouseenter="handleMouseEnter(index)">
            <slot name="item" :item="item" :index="index" :active="activeIndex === index"></slot>
          </div>
        </template>
      </div>
      <!-- 空状态 -->
      <slot v-else name="empty"></slot>
    </div>
  </Teleport>
</template>

<script setup lang="ts" generic="T">
import type { CSSProperties } from 'vue';
import { computed, nextTick, ref, watch } from 'vue';

/**
 * SelectDropdown 组件属性定义
 */
interface Props {
  /** 是否显示下拉菜单 */
  visible: boolean;
  /** 列表项数据 */
  items: readonly T[];
  /** 当前高亮项索引 */
  activeIndex?: number;
  /** 活动项变化时是否滚动到可视区 */
  scrollActiveIntoView?: boolean;
  /** 是否使用 Teleport 传送到 body */
  teleport?: boolean;
  /** Teleport 模式下的锚点位置，用于自动计算弹出方向 */
  position?: { top: number; left: number; bottom: number };
  /** Teleport 模式下的菜单宽度 */
  dropdownWidth?: number;
  /** 内联模式下的自定义样式，默认为 absolute 定位在上方 */
  inlineStyle?: CSSProperties;
}

const props = withDefaults(defineProps<Props>(), {
  activeIndex: 0,
  scrollActiveIntoView: false,
  teleport: false,
  position: undefined,
  dropdownWidth: 300,
  inlineStyle: undefined
});

defineOptions({ inheritAttrs: false });

const emit = defineEmits<{
  (e: 'select', item: T): void;
  (e: 'update:activeIndex', index: number): void;
}>();

const dropdownRef = ref<HTMLElement>();

/**
 * 内联模式的默认样式：absolute 定位在父容器上方
 */
const defaultInlineStyle = computed<CSSProperties>(() => ({
  position: 'absolute',
  bottom: 'calc(100% + 8px)',
  left: '0px',
  width: '100%',
  zIndex: 10
}));

/**
 * Teleport 模式下的动态定位样式，根据视口自动调整弹出方向
 */
const teleportStyle = ref<CSSProperties>({});

watch(
  [() => props.visible, () => props.position],
  async () => {
    if (!props.visible || !props.teleport || !props.position) return;

    await nextTick();

    const styles: CSSProperties = {
      position: 'fixed',
      maxHeight: '400px',
      width: `${props.dropdownWidth}px`,
      zIndex: 9999
    };

    const { innerHeight: viewportHeight, innerWidth: viewportWidth } = window;
    const dropdownHeight = dropdownRef.value?.clientHeight || 0;
    const dropdownWidth = dropdownRef.value?.clientWidth || props.dropdownWidth;
    const gap = 8;
    const { top, left, bottom } = props.position;

    // 垂直方向：优先向下展开，空间不足则向上
    if (bottom + gap + dropdownHeight > viewportHeight) {
      styles.top = `${Math.max(gap, top - dropdownHeight - gap)}px`;
    } else {
      styles.top = `${bottom + gap}px`;
    }

    // 水平方向：优先左对齐，空间不足则右对齐
    if (left + dropdownWidth > viewportWidth) {
      styles.left = `${Math.max(gap, viewportWidth - dropdownWidth - gap)}px`;
    } else {
      styles.left = `${Math.max(gap, left)}px`;
    }

    teleportStyle.value = styles;
  },
  { immediate: true }
);

/**
 * 将当前活动项滚动到列表可视区内。
 * @param index - 当前活动项索引
 */
function scrollActiveItemIntoView(index: number): void {
  const activeItem = dropdownRef.value?.querySelectorAll<HTMLElement>('.select-dropdown__item')[index];
  if (typeof activeItem?.scrollIntoView === 'function') {
    activeItem.scrollIntoView({ block: 'nearest' });
  }
}

watch([() => props.activeIndex, () => props.scrollActiveIntoView, () => props.visible], async ([activeIndex, scrollActiveIntoView, visible]) => {
  if (!visible || !scrollActiveIntoView) return;

  await nextTick();
  scrollActiveItemIntoView(activeIndex);
});

/**
 * 计算最终的菜单样式：Teleport 模式使用动态定位，内联模式使用默认或自定义样式
 */
const menuStyle = computed<CSSProperties>(() => {
  if (props.teleport) {
    return teleportStyle.value;
  }
  return props.inlineStyle ?? defaultInlineStyle.value;
});

/**
 * 处理列表项点击选择
 * @param item - 被点击的列表项
 */
function handleSelect(item: T): void {
  emit('select', item);
}

/**
 * 处理鼠标悬停，更新高亮索引
 * @param index - 鼠标悬停项的索引
 */
function handleMouseEnter(index: number): void {
  emit('update:activeIndex', index);
}
</script>

<style scoped lang="less">
.select-dropdown {
  min-width: 0;
  padding: 8px 0;
  overflow: auto;
  background: var(--bg-primary);
  border: var(--overlay-border-width) solid var(--border-primary);
  border-radius: var(--overlay-radius);
  box-shadow: 0 6px 16px rgb(0 0 0 / 8%), 0 3px 6px -4px rgb(0 0 0 / 12%), 0 9px 28px 8px rgb(0 0 0 / 5%);
}

.select-dropdown__header {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border-secondary);
}

.select-dropdown__list {
  max-height: 300px;
  overflow-y: auto;
}

.select-dropdown__item {
  display: flex;
  align-items: center;
  min-height: 32px;
  padding: 2px 8px;
  margin: 0 6px;
  cursor: pointer;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-base) var(--motion-easing-standard);

  &:hover,
  &.active {
    background: var(--bg-secondary);
  }
}
</style>
