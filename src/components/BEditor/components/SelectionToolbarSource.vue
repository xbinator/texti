<template>
  <Teleport v-if="overlayRoot" :to="overlayRoot">
    <div v-if="visible" ref="toolbarRef" class="source-selection-toolbar" :style="style">
      <SelectionToolbar :format-buttons="formatButtons" @ai="$emit('ai')" @reference="$emit('reference')" @format="$emit('format', $event)" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * @file SelectionToolbarSource.vue
 * @description Source 模式选区工具栏宿主，使用绝对定位浮层承载内容组件。
 */
import type { SelectionAssistantPosition, SelectionToolbarAction } from '../adapters/selectionAssistant';
import type { CSSProperties } from 'vue';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useEventListener, useResizeObserver } from '@vueuse/core';
import SelectionToolbar from './SelectionToolbar.vue';

/**
 * 格式按钮定义（source 模式下无格式按钮，此接口保留以兼容内容组件）。
 */
interface FormatButton {
  command: SelectionToolbarAction;
  icon: string;
  active?: boolean;
}

interface Props {
  /** 工具栏是否可见 */
  visible?: boolean;
  /** 工具栏定位信息 */
  position?: SelectionAssistantPosition | null;
  /** 浮层根容器 DOM 元素 */
  overlayRoot?: HTMLElement | null;
  /** 需要展示的格式按钮列表（source 模式下为空） */
  formatButtons?: FormatButton[];
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  position: null,
  overlayRoot: null,
  formatButtons: () => []
});

defineEmits<{
  (e: 'ai'): void;
  (e: 'reference'): void;
  (e: 'format', command: SelectionToolbarAction): void;
}>();

/**
 * 工具栏浮层与选区之间的间距。
 */
const TOOLBAR_GAP = 8;

/**
 * 工具栏相对容器的最小安全边距。
 */
const TOOLBAR_PADDING = 8;

const toolbarRef = ref<HTMLElement | null>(null);
const style = ref<CSSProperties>({ display: 'none' });
const hasMeasuredPosition = ref(false);
const pointerPressActive = ref(false);
let cleanupOverlayPointerListeners: (() => void) | null = null;

/**
 * 计算工具栏定位约束所需的容器尺寸。
 * @param position - 当前选区定位信息
 * @returns 归一化后的容器矩形
 */
function resolveContainerRect(position: SelectionAssistantPosition): { top: number; left: number; width: number; height: number } {
  if (position.containerRect) {
    return position.containerRect;
  }

  return {
    top: 0,
    left: 0,
    width: props.overlayRoot?.clientWidth ?? 0,
    height: props.overlayRoot?.clientHeight ?? 0
  };
}

/**
 * 基于当前锚点、工具栏尺寸和容器边界同步最终定位。
 * 顶部空间不足时会翻转到选区下方，左右位置则会被约束在容器内。
 */
function syncStyle(): void {
  if (pointerPressActive.value) {
    hasMeasuredPosition.value = false;
    style.value = { display: 'none' };
    return;
  }

  if (!props.visible || !props.position) {
    hasMeasuredPosition.value = false;
    style.value = { display: 'none' };
    return;
  }

  const { position } = props;
  const toolbarElement = toolbarRef.value;
  const toolbarRect = toolbarElement?.getBoundingClientRect();
  const toolbarWidth = toolbarRect?.width ?? toolbarElement?.offsetWidth ?? 0;
  const toolbarHeight = toolbarRect?.height ?? toolbarElement?.offsetHeight ?? 0;
  if (toolbarWidth <= 0 || toolbarHeight <= 0) {
    hasMeasuredPosition.value = false;
    style.value = {
      position: 'absolute',
      top: '0px',
      left: '0px',
      visibility: 'hidden',
      zIndex: 100
    };
    return;
  }

  const containerRect = resolveContainerRect(position);
  const anchorCenterX = position.anchorRect.left + position.anchorRect.width / 2;

  const minLeft = containerRect.left + TOOLBAR_PADDING;
  const maxLeft = containerRect.left + containerRect.width - toolbarWidth - TOOLBAR_PADDING;
  const preferredLeft = anchorCenterX - toolbarWidth / 2;
  const left = maxLeft >= minLeft ? Math.min(Math.max(preferredLeft, minLeft), maxLeft) : minLeft;

  const preferredTop = position.anchorRect.top - toolbarHeight - TOOLBAR_GAP;
  const fallbackTop = position.anchorRect.top + position.lineHeight + TOOLBAR_GAP;
  const maxTop = containerRect.top + containerRect.height - toolbarHeight - TOOLBAR_PADDING;
  const top = preferredTop >= containerRect.top + TOOLBAR_PADDING ? preferredTop : Math.min(fallbackTop, Math.max(containerRect.top + TOOLBAR_PADDING, maxTop));

  style.value = {
    position: 'absolute',
    top: `${top}px`,
    left: `${left}px`,
    visibility: 'visible',
    zIndex: 100
  };
  hasMeasuredPosition.value = true;
}

/**
 * 在 DOM 更新后重新测量工具栏尺寸并同步定位。
 * 适用于显隐切换、锚点变化和内容尺寸变化后的重排。
 */
function syncStyleOnNextTick(): void {
  if (pointerPressActive.value || !props.visible || !props.position) {
    style.value = { display: 'none' };
    hasMeasuredPosition.value = false;
    return;
  }

  if (!hasMeasuredPosition.value) {
    style.value = {
      position: 'absolute',
      top: '0px',
      left: '0px',
      visibility: 'hidden',
      zIndex: 100
    };
  }

  nextTick(() => {
    syncStyle();
  });
}

/**
 * 绑定 overlayRoot 上的指针按下/抬起监听。
 * 按下编辑区时立即隐藏 toolbar，避免上一轮 toolbar 在拖拽开始瞬间闪现。
 */
function bindOverlayPointerListeners(): void {
  cleanupOverlayPointerListeners?.();
  const { overlayRoot } = props;
  if (!overlayRoot) {
    return;
  }

  const handlePointerDown = (event: PointerEvent): void => {
    const target = event.target as Node | null;
    const toolbarElement = toolbarRef.value;
    if (toolbarElement?.contains(target)) {
      return;
    }

    pointerPressActive.value = true;
    hasMeasuredPosition.value = false;
    style.value = { display: 'none' };
  };

  const handlePointerUp = (): void => {
    if (!pointerPressActive.value) {
      return;
    }

    pointerPressActive.value = false;
    syncStyleOnNextTick();
  };

  overlayRoot.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('pointerup', handlePointerUp, true);

  cleanupOverlayPointerListeners = (): void => {
    overlayRoot.removeEventListener('pointerdown', handlePointerDown, true);
    document.removeEventListener('pointerup', handlePointerUp, true);
  };
}

watch(() => props.visible, syncStyleOnNextTick, { immediate: true });
watch(() => props.position, syncStyleOnNextTick, { deep: true });
watch(() => props.formatButtons, syncStyleOnNextTick, { deep: true });
watch(() => props.overlayRoot, bindOverlayPointerListeners, { immediate: true });

useResizeObserver(toolbarRef, (): void => {
  syncStyle();
});

useEventListener(window, 'resize', (): void => {
  syncStyle();
});

onBeforeUnmount((): void => {
  cleanupOverlayPointerListeners?.();
  cleanupOverlayPointerListeners = null;
  style.value = { display: 'none' };
});
</script>
