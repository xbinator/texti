<!--
  @file index.vue
  @description 通用可拖拽面板分隔器，负责宽度约束、拖拽生命周期和关闭事件。
-->
<template>
  <div ref="rootRef" :class="name">
    <div :class="[bem('section'), sectionClass]" :style="sectionStyle">
      <slot></slot>
    </div>

    <div v-if="!props.disabled" :class="bem('line', { dragging: isDragging })" :style="splitterStyle" @mousedown="handleMouseDown">
      <div :class="bem('resizer')"></div>
      <div :class="bem('bar')"></div>
    </div>

    <Teleport to="body">
      <div v-if="isDragging" :class="bem('drag-shield')" @mousemove.stop="handleMouseMove" @mouseup.stop="handleMouseUp"></div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import type { BPanelSplitterProps as Props } from './types';
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import { useResizeObserver } from '@vueuse/core';
import { clamp } from 'lodash-es';
import { createNamespace } from '@/utils/namespace';

defineOptions({ name: 'BPanelSplitter' });

const [name, bem] = createNamespace('panel-splitter');

const props = withDefaults(defineProps<Props>(), {
  position: 'left',
  minWidth: 200,
  maxWidth: 600,
  sectionClass: '',
  closeThreshold: 60,
  closable: true,
  disabled: false
});

const size = defineModel<number>('size', { default: 300 });

const emit = defineEmits<{
  /** 拖拽关闭面板 */
  close: [];
  /** 用户开始拖拽调整面板宽度 */
  'resize-start': [];
}>();

const isDragging = ref(false);
const rootRef = ref<HTMLElement>();

/** 当前拖拽周期的全局事件控制器，用于一次性移除 move/up 监听。 */
let dragAbortController: AbortController | null = null;

const state = reactive({
  startX: 0,
  startSize: 0
});

const isLeft = computed(() => props.position === 'left');
const containerRef = computed(() => rootRef.value?.parentElement);

const sectionStyle = computed(() => {
  if (size.value === 0) {
    return { display: 'none' };
  }

  return { width: `${size.value}px` };
});

const splitterStyle = computed(() => {
  if (isLeft.value) {
    return { left: 0, transform: 'translateX(-100%)' };
  }

  return { right: 0, transform: 'translateX(100%)' };
});

/**
 * 获取百分比宽度计算所需的父容器宽度。
 * @returns 父容器宽度，无法读取时返回 0
 */
function getContainerWidth(): number {
  let container = rootRef.value?.parentElement;

  while (container) {
    const { width } = container.getBoundingClientRect();

    if (width > 0) {
      return width;
    }

    container = container.parentElement;
  }

  return 0;
}

/**
 * 将宽度约束转换为像素值。
 * @param value - 宽度约束，数字表示 px，百分数字符串表示相对父容器宽度
 * @returns 宽度像素值
 */
function resolveSizeValue(value: NonNullable<Props['minWidth']>): number {
  if (typeof value === 'number') {
    return value;
  }

  const percentage = Number.parseFloat(value);

  if (!Number.isFinite(percentage)) {
    return 0;
  }

  return (getContainerWidth() * percentage) / 100;
}

/**
 * 将当前面板宽度同步到最新的宽度约束范围内。
 */
function syncSizeWithinBounds(): void {
  if (size.value === 0) {
    return;
  }

  const minWidth = resolveSizeValue(props.minWidth);
  const maxWidth = resolveSizeValue(props.maxWidth);
  const nextSize = clamp(size.value, minWidth, maxWidth);

  if (nextSize !== size.value) {
    size.value = nextSize;
  }
}

/**
 * 获取本次拖拽中的理论面板宽度。
 * @param e - 鼠标移动事件
 * @returns 理论面板宽度，单位 px
 */
function getRawSize(e: MouseEvent): number {
  const deltaX = e.clientX - state.startX;

  return state.startSize + (isLeft.value ? -deltaX : deltaX);
}

/**
 * 处理鼠标移动：
 *
 * rawSize 表示本次拖拽中的“理论宽度”。
 *
 * - rawSize > minWidth：正常调整宽度
 * - minWidth >= rawSize > minWidth - closeThreshold：宽度保持 minWidth
 * - rawSize <= minWidth - closeThreshold：关闭，size 设置为 0
 *
 * 关闭后，如果鼠标仍然按住并往打开方向拖动，
 * 只要 rawSize 再次大于 minWidth - closeThreshold，
 * 面板就会恢复到 minWidth。
 */
function handleMouseMove(e: MouseEvent): void {
  const rawSize = getRawSize(e);
  const minWidth = resolveSizeValue(props.minWidth);
  const maxWidth = resolveSizeValue(props.maxWidth);
  const closeLine = minWidth - props.closeThreshold;

  if (props.closable && rawSize <= closeLine) {
    size.value = 0;
    return;
  }

  size.value = clamp(rawSize, minWidth, maxWidth);
}

/**
 * 清理全局拖拽副作用。
 */
function cleanupDragSideEffects(): void {
  isDragging.value = false;

  document.body.classList.remove('cursor-col-resize');
  document.body.style.userSelect = '';

  dragAbortController?.abort();
  dragAbortController = null;
}

/**
 * 处理鼠标松开：清理拖拽状态。
 */
function handleMouseUp(): void {
  cleanupDragSideEffects();

  if (size.value === 0) {
    emit('close');
  }
}

/**
 * 处理鼠标按下：记录起始位置并注册全局拖拽事件。
 * @param e - 鼠标按下事件
 */
function handleMouseDown(e: MouseEvent): void {
  e.preventDefault();
  emit('resize-start');

  isDragging.value = true;
  state.startX = e.clientX;
  state.startSize = size.value;

  document.body.classList.add('cursor-col-resize');
  document.body.style.userSelect = 'none';

  dragAbortController?.abort();
  dragAbortController = new AbortController();
  window.addEventListener('mousemove', handleMouseMove, { signal: dragAbortController.signal });
  window.addEventListener('mouseup', handleMouseUp, { signal: dragAbortController.signal });
}

/**
 * 监听父容器尺寸变化，确保百分比约束随容器变化重新生效。
 */
useResizeObserver(containerRef, () => {
  syncSizeWithinBounds();
});

/**
 * 组件卸载时兜底清理拖拽监听，避免拖拽中离开页面后遗留全局状态。
 */
onBeforeUnmount((): void => {
  cleanupDragSideEffects();
});
</script>

<style lang="less">
.b-panel-splitter {
  position: relative;
  height: 100%;
}

.b-panel-splitter__section {
  height: 100%;
  transition: background 0.2s ease;
}

.b-panel-splitter__line {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 2;
  width: 6px;
  padding: 0 2px;
  cursor: col-resize;
}

.b-panel-splitter__line:hover,
.b-panel-splitter__line--dragging {
  .b-panel-splitter__resizer {
    background: var(--scrollbar-bg);
  }

  .b-panel-splitter__bar {
    display: none;
  }
}

.b-panel-splitter__resizer {
  height: 100%;
  transition: all 0.2s ease;
}

.b-panel-splitter__bar {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 2px;
  height: 40px;
  background: var(--border-secondary);
  border-radius: 2px;
  transform: translate(-50%, -50%);
}

.b-panel-splitter__drag-shield {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  cursor: col-resize;
  user-select: none;
  background: transparent;
}
</style>
