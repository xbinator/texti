<!--
  @file WidgetNode.vue
  @description BWidget HTML 节点渲染组件。
-->
<template>
  <div
    ref="nodeRef"
    class="b-widget-node b-widget-element"
    :class="{ 'is-selected': selected }"
    :style="nodeStyle"
    @contextmenu.stop.prevent="emit('context-menu', node.id, $event)"
    @pointerdown.stop="emit('select', node.id, $event)"
    @pointerup="emit('release', node.id, $event)"
  >
    <component :is="nodeView" v-if="nodeView" :element="node" />
  </div>
</template>

<script setup lang="ts">
import type { WidgetPoint, WidgetShapeElement, WidgetSize } from '../types';
import type { WidgetRenderContext } from 'types/widget';
import type { Component, CSSProperties } from 'vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getWidgetElementView } from '../elements';
import { provideRenderContext, useRenderContext } from '../hooks/useRenderContext';
import { createWidgetElementCssTransform, getWidgetShapeRenderSize, registerWidgetElementTarget, unregisterWidgetElementTarget } from '../utils/widgetGeometry';
import { createWidgetElementContentStyleProperties, createWidgetElementCustomCssProperties, createWidgetElementStyleProperties } from '../utils/widgetStyle';

/**
 * 节点组件入参。
 */
interface Props {
  /** 节点 */
  node: WidgetShapeElement;
  /** 预览位置 */
  previewPosition?: WidgetPoint | null;
  /** 预览尺寸 */
  previewSize?: WidgetSize | null;
  /** 是否选中 */
  selected?: boolean;
  /** 节点级渲染上下文 */
  nodeRenderContext?: (WidgetRenderContext & { locals?: Record<string, unknown> }) | null;
}

const props = withDefaults(defineProps<Props>(), {
  nodeRenderContext: null,
  previewPosition: null,
  previewSize: null,
  selected: false
});

const emit = defineEmits<{
  /** 选择节点 */
  select: [id: string, event: PointerEvent];
  /** 在节点上释放指针 */
  release: [id: string, event: PointerEvent];
  /** 打开节点右键菜单 */
  'context-menu': [id: string, event: MouseEvent];
}>();

/** 上层Widget渲染上下文。 */
const renderState = useRenderContext();
/** 当前节点根元素引用，用于注册内部 DOM 到元素 ID 的映射。 */
const nodeRef = ref<HTMLElement | null>(null);
/** 当前节点有效渲染上下文。 */
const nodeRenderContext = computed<WidgetRenderContext | undefined>(() => props.nodeRenderContext ?? renderState.renderContext.value);

provideRenderContext(nodeRenderContext);

/** 节点渲染尺寸，预览尺寸作为临时模型尺寸后仍按元素 schema 重新测量。 */
const renderSize = computed<WidgetSize>(() =>
  getWidgetShapeRenderSize(
    {
      ...props.node,
      size: props.previewSize ?? props.node.size
    },
    {
      renderContext: nodeRenderContext.value,
      renderOptions: renderState.options.value
    }
  )
);
/** 节点渲染位置，Moveable 预览时优先使用临时位置。 */
const renderPosition = computed<WidgetPoint>(() => props.previewPosition ?? props.node.position);
/** 当前节点对应的中间视图组件。 */
const nodeView = computed<Component | null>(() => getWidgetElementView(props.node.name));
/** HTML 节点定位和几何样式。 */
const nodeStyle = computed<CSSProperties>(() => ({
  ...createWidgetElementStyleProperties(props.node.style),
  ...createWidgetElementContentStyleProperties(props.node.style),
  width: `${renderSize.value.width}px`,
  height: `${renderSize.value.height}px`,
  opacity: props.node.style.opacity,
  transform: createWidgetElementCssTransform(renderPosition.value, props.node.rotation),
  ...createWidgetElementCustomCssProperties(props.node.style)
}));

/**
 * 注册当前 DOM 节点与 Widget 元素 ID 的映射。
 */
function registerCurrentNode(): void {
  if (!nodeRef.value) {
    return;
  }

  registerWidgetElementTarget(nodeRef.value, props.node.id);
}

onMounted(registerCurrentNode);

watch(
  () => props.node.id,
  () => {
    registerCurrentNode();
  }
);

onBeforeUnmount(() => {
  if (nodeRef.value) {
    unregisterWidgetElementTarget(nodeRef.value);
  }
});
</script>

<style lang="less" scoped>
.b-widget-node {
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  cursor: pointer;
}

.b-widget-node__fallback {
  padding: 8px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre-wrap;
}
</style>
