<template>
  <Teleport v-if="overlayRoot" :to="overlayRoot">
    <div v-if="visible" class="source-selection-toolbar" :style="style">
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
import { computed } from 'vue';
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

/** 根据定位信息计算绝对定位样式 */
const style = computed<CSSProperties>(() => {
  if (!props.visible || !props.position) {
    return { display: 'none' };
  }
  return {
    position: 'absolute',
    top: `${Math.max(0, props.position.anchorRect.top - 44)}px`,
    left: `${props.position.anchorRect.left}px`,
    zIndex: 100
  };
});
</script>
