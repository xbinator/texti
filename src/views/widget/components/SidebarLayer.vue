<!--
  @file SidebarLayer.vue
  @description Widget页面侧边栏图层列表，展示Widget元素图层项及选中态。
-->
<template>
  <SidebarPanel title="图层">
    <!-- 图层列表为空时的缺省提示 -->
    <div v-if="layerEntries.length === 0" class="sidebar-panel__layer-empty">
      <div class="sidebar-panel__layer-empty-icon">
        <BIcon icon="lucide:layers" :size="24" />
      </div>
      <span class="sidebar-panel__layer-empty-text">暂无图层</span>
      <span class="sidebar-panel__layer-empty-hint">添加元素后图层将在此展示</span>
    </div>
    <!-- 图层拖拽列表 -->
    <BDraggable
      v-else
      class="sidebar-panel__layer-list"
      :list="layerEntries"
      item-key="id"
      :item-class="getDraggableItemClass"
      handle-class="sidebar-panel__layer-drag-handle"
      emit-unchanged-move
      @item-click="handleDraggableItemClick"
      @move="handleDraggableMove"
    >
      <template #default="{ item: entry, handleClass, draggingKey, dropPosition }">
        <div
          class="sidebar-panel__layer-row"
          :class="getLayerRowClass(entry, dropPosition, draggingKey)"
          :style="getLayerRowStyle(entry, dropPosition, draggingKey)"
        >
          <button type="button" :class="handleClass" @click.stop>
            <BIcon icon="lucide:grip-vertical" :size="14" />
          </button>
          <button v-if="entry.childCount > 0" type="button" class="sidebar-panel__layer-collapse" @click.stop="toggleGroupCollapsed(entry.element.id)">
            <BIcon :icon="isGroupExpanded(entry) ? 'lucide:chevron-down' : 'lucide:chevron-right'" :size="14" />
          </button>
          <span v-else-if="shouldShowCollapsePlaceholder(entry)" class="sidebar-panel__layer-collapse-placeholder"></span>
          <button type="button" class="sidebar-panel__layer-select">
            <BIcon :icon="getElementIcon(entry.element)" :size="15" />
            <div class="sidebar-panel__layer-main">
              <span v-if="entry.isGroup" class="sidebar-panel__layer-group-title">{{ getGroupTitle(entry) }}</span>
              <span v-else class="sidebar-panel__layer-title">{{ entry.element.title }}</span>
            </div>
          </button>
          <div class="sidebar-panel__layer-actions">
            <BButton class="sidebar-panel__layer-action" type="text" size="mini" square icon="lucide:copy" @click.stop="handleEntryCopy(entry)" />
            <BButton class="sidebar-panel__layer-action" type="text" size="mini" danger square icon="lucide:trash-2" @click.stop="handleEntryDelete(entry)" />
          </div>
        </div>
      </template>
    </BDraggable>
  </SidebarPanel>
</template>

<script setup lang="ts">
import type { LayerMovePayload } from '../hooks/useLayerActions';
import type { WidgetLayerMovePosition } from '../utils/layerOrder';
import type { CSSProperties } from 'vue';
import { computed, ref } from 'vue';
import type { BDraggableKey, BDraggableMoveEvent, BDraggableMovePosition } from '@/components/BDraggable/types';
import type { WidgetElement } from '@/components/BWidget/types';
import { isWidgetGroupElement, readWidgetElementChildren } from '@/components/BWidget/utils/widgetTree';
import SidebarPanel from './_SidebarPanel.vue';

/**
 * 侧栏图层投放预览位置。
 */
type SidebarLayerDropPosition = WidgetLayerMovePosition | 'after-parent' | null;

/**
 * 图层行内联样式。
 */
type SidebarLayerRowStyle = CSSProperties & {
  /** 投放指示线相对当前行的缩进 */
  '--sidebar-layer-drop-offset'?: string;
};

/**
 * 图层列表展示项。
 */
interface SidebarLayerEntry {
  /** 展示项唯一标识 */
  id: string;
  /** Widget元素 */
  element: WidgetElement;
  /** 直接父级元素 ID，顶层为 null */
  parentId: string | null;
  /** 缩进深度 */
  depth: number;
  /** 是否为组合元素 */
  isGroup: boolean;
  /** 直接子元素数量 */
  childCount: number;
}

/**
 * 图层列表入参。
 */
interface Props {
  /** 组合选区内当前编辑的元素 ID */
  activeElementId?: string | null;
  /** 当前Widget元素列表 */
  elements: WidgetElement[];
  /** 当前选中的Widget元素 ID 列表 */
  selectedElementIds?: string[];
}

const props = withDefaults(defineProps<Props>(), {
  activeElementId: null,
  selectedElementIds: (): string[] => []
});
const emit = defineEmits<{
  /** 选择一个或多个图层元素 */
  'select-elements': [elements: WidgetElement[]];
  /** 复制一个或多个图层元素 */
  'copy-elements': [elements: WidgetElement[]];
  /** 删除一个或多个图层元素 */
  'delete-elements': [elements: WidgetElement[]];
  /** 移动一个或多个Widget图层展示项 */
  'move-elements': [payload: LayerMovePayload];
}>();

/** 当前选中元素 ID 集合。 */
const selectedElementIdSet = computed<Set<string>>(() => new Set(props.selectedElementIds));
/** 当前已折叠的组合 ID。 */
const collapsedGroupIds = ref<Set<string>>(new Set());
/** 单层缩进宽度。 */
const WIDGET_LAYER_DEPTH_INDENT = 16;

/**
 * 创建图层展示项。
 * @param element - Widget元素
 * @param parentId - 直接父级元素 ID
 * @param depth - 当前嵌套深度
 * @returns 图层展示项
 */
function createLayerEntry(element: WidgetElement, parentId: string | null, depth: number): SidebarLayerEntry {
  const children = readWidgetElementChildren(element);

  return {
    id: element.id,
    element,
    parentId,
    depth,
    isGroup: isWidgetGroupElement(element),
    childCount: children.length
  };
}

/**
 * 将Widget元素树转换为可见侧栏展示项。
 * @param elements - Widget元素列表
 * @param parentId - 直接父级元素 ID
 * @param depth - 当前层深度
 * @returns 侧栏展示项
 */
function createLayerEntries(elements: WidgetElement[], parentId: string | null = null, depth = 0): SidebarLayerEntry[] {
  const displayElements = [...elements].reverse();

  return displayElements.flatMap((element: WidgetElement): SidebarLayerEntry[] => {
    const entry = createLayerEntry(element, parentId, depth);
    const children = readWidgetElementChildren(element);
    if (!entry.isGroup || children.length === 0 || collapsedGroupIds.value.has(element.id)) {
      return [entry];
    }

    return [entry, ...createLayerEntries(children, element.id, depth + 1)];
  });
}

/** 按Widget层级从上到下展示的元素列表。 */
const layerEntries = computed<SidebarLayerEntry[]>(() => createLayerEntries(props.elements));

/**
 * 读取展示项包含的Widget元素。
 * @param entry - 图层展示项
 * @returns 展示项包含的Widget元素
 */
function getEntryElements(entry: SidebarLayerEntry): WidgetElement[] {
  return [entry.element];
}

/**
 * 读取组合展示标题。
 * @param entry - 组合展示项
 * @returns 组合标题
 */
function getGroupTitle(entry: SidebarLayerEntry): string {
  return `${entry.element.title} (${entry.childCount})`;
}

/**
 * 判断组合是否展开。
 * @param entry - 组合展示项
 * @returns 是否展开
 */
function isGroupExpanded(entry: SidebarLayerEntry): boolean {
  return !collapsedGroupIds.value.has(entry.element.id);
}

/**
 * 判断同父级图层中是否存在可展开组合。
 * @param entry - 图层展示项
 * @returns 同层是否需要保留折叠按钮占位
 */
function hasCollapsiblePeer(entry: SidebarLayerEntry): boolean {
  return layerEntries.value.some((item: SidebarLayerEntry): boolean => item.parentId === entry.parentId && item.childCount > 0);
}

/**
 * 判断是否展示折叠按钮占位。
 * @param entry - 图层展示项
 * @returns 是否展示占位
 */
function shouldShowCollapsePlaceholder(entry: SidebarLayerEntry): boolean {
  return entry.childCount === 0 && hasCollapsiblePeer(entry);
}

/**
 * 切换组合折叠状态。
 * @param groupElementId - 组合元素 ID
 */
function toggleGroupCollapsed(groupElementId: string): void {
  const nextCollapsedGroupIds = new Set(collapsedGroupIds.value);
  if (nextCollapsedGroupIds.has(groupElementId)) {
    nextCollapsedGroupIds.delete(groupElementId);
  } else {
    nextCollapsedGroupIds.add(groupElementId);
  }

  collapsedGroupIds.value = nextCollapsedGroupIds;
}

/**
 * 读取图层图标。
 * @param element - Widget元素
 * @returns 图层图标名称
 */
function getElementIcon(element: WidgetElement): string {
  return element.icon;
}

/**
 * 判断图层元素是否处于选中态。
 * @param element - Widget元素
 * @returns 是否选中
 */
function isElementSelected(element: WidgetElement): boolean {
  return selectedElementIdSet.value.has(element.id);
}

/**
 * 判断展示项是否处于选中态。
 * @param entry - 图层展示项
 * @returns 是否选中
 */
function isEntrySelected(entry: SidebarLayerEntry): boolean {
  const elements = getEntryElements(entry);

  return elements.length > 0 && elements.every((element: WidgetElement): boolean => isElementSelected(element));
}

/**
 * 生成公共拖拽列表项 class。
 * @param entry - 图层展示项
 * @returns 列表项 class 映射
 */
function getDraggableItemClass(entry: SidebarLayerEntry): Record<string, boolean> {
  return {
    'sidebar-panel__layer-item': true,
    'is-active': isEntrySelected(entry),
    'is-group': entry.isGroup,
    'is-child': entry.depth > 0
  };
}

/**
 * 判断展示项是否为同父级视觉顺序中的最后一个直接子节点。
 * @param entry - 图层展示项
 * @returns 是否为最后一个直接子节点
 */
function isLastDirectChildEntry(entry: SidebarLayerEntry): boolean {
  const siblingEntries = layerEntries.value.filter((item: SidebarLayerEntry): boolean => item.parentId === entry.parentId);

  return siblingEntries[siblingEntries.length - 1]?.id === entry.id;
}

/**
 * 判断展示项是否为同父级视觉顺序中的第一个直接子节点。
 * @param entry - 图层展示项
 * @returns 是否为第一个直接子节点
 */
function isFirstDirectChildEntry(entry: SidebarLayerEntry): boolean {
  const siblingEntries = layerEntries.value.filter((item: SidebarLayerEntry): boolean => item.parentId === entry.parentId);

  return siblingEntries[0]?.id === entry.id;
}

/**
 * 通过图层 ID 读取展示项。
 * @param entryId - 图层 ID
 * @returns 图层展示项，不存在时返回 null
 */
function getLayerEntryById(entryId: BDraggableKey | null): SidebarLayerEntry | null {
  if (!entryId) {
    return null;
  }

  return layerEntries.value.find((entry: SidebarLayerEntry): boolean => entry.id === entryId) ?? null;
}

/**
 * 判断投放预览是否应落到父级同层。
 * @param entry - 目标图层展示项
 * @param dropPosition - 拖拽投放预览位置
 * @param draggingKey - 当前拖拽源图层 ID
 * @returns 是否应作为父级同层投放
 */
function shouldPreviewAfterParent(entry: SidebarLayerEntry, dropPosition: BDraggableMovePosition | null, draggingKey: BDraggableKey | null): boolean {
  const sourceEntry = getLayerEntryById(draggingKey);

  return dropPosition === 'after' && entry.parentId !== null && sourceEntry?.parentId === entry.parentId && isLastDirectChildEntry(entry);
}

/**
 * 解析图层投放预览位置。
 * @param entry - 图层展示项
 * @param dropPosition - 拖拽投放预览位置
 * @param draggingKey - 当前拖拽源图层 ID
 * @returns 侧栏图层投放预览位置
 */
function resolveLayerDropPosition(
  entry: SidebarLayerEntry,
  dropPosition: BDraggableMovePosition | null,
  draggingKey: BDraggableKey | null
): SidebarLayerDropPosition {
  if (!dropPosition) {
    return null;
  }

  if (shouldPreviewAfterParent(entry, dropPosition, draggingKey)) {
    return 'after-parent';
  }

  return dropPosition === 'after' && entry.isGroup && isGroupExpanded(entry) ? 'inside' : dropPosition;
}

/**
 * 生成图层投放预览 class。
 * @param entry - 图层展示项
 * @param dropPosition - 拖拽投放预览位置
 * @param draggingKey - 当前拖拽源图层 ID
 * @returns 投放预览 class 映射
 */
function getLayerDropClass(entry: SidebarLayerEntry, dropPosition: BDraggableMovePosition | null, draggingKey: BDraggableKey | null): Record<string, boolean> {
  const resolvedDropPosition = resolveLayerDropPosition(entry, dropPosition, draggingKey);

  return {
    'is-drop-before': resolvedDropPosition === 'before',
    'is-drop-after': resolvedDropPosition === 'after' || resolvedDropPosition === 'after-parent',
    'is-drop-inside': resolvedDropPosition === 'inside'
  };
}

/**
 * 读取图层投放指示线缩进。
 * @param dropPosition - 已解析的投放预览位置
 * @returns 指示线缩进
 */
function getLayerDropOffset(dropPosition: SidebarLayerDropPosition): number {
  if (dropPosition === 'inside') {
    return WIDGET_LAYER_DEPTH_INDENT;
  }

  if (dropPosition === 'after-parent') {
    return -WIDGET_LAYER_DEPTH_INDENT;
  }

  return 0;
}

/**
 * 生成图层行 class。
 * @param entry - 图层展示项
 * @param dropPosition - 拖拽投放预览位置
 * @param draggingKey - 当前拖拽源图层 ID
 * @returns 图层行 class 映射
 */
function getLayerRowClass(entry: SidebarLayerEntry, dropPosition: BDraggableMovePosition | null, draggingKey: BDraggableKey | null): Record<string, boolean> {
  return {
    'is-active': props.activeElementId === entry.element.id || isEntrySelected(entry),
    'is-group': entry.isGroup,
    'sidebar-panel__layer-child': entry.depth > 0,
    ...getLayerDropClass(entry, dropPosition, draggingKey)
  };
}

/**
 * 生成图层行缩进样式。
 * @param entry - 图层展示项
 * @param dropPosition - 拖拽投放预览位置
 * @param draggingKey - 当前拖拽源图层 ID
 * @returns 图层行样式
 */
function getLayerRowStyle(entry: SidebarLayerEntry, dropPosition: BDraggableMovePosition | null, draggingKey: BDraggableKey | null): SidebarLayerRowStyle {
  const indent = entry.depth * WIDGET_LAYER_DEPTH_INDENT;
  const resolvedDropPosition = resolveLayerDropPosition(entry, dropPosition, draggingKey);
  const dropOffset = getLayerDropOffset(resolvedDropPosition);
  const dropStyle: SidebarLayerRowStyle = {
    '--sidebar-layer-drop-offset': `${dropOffset}px`
  };

  if (indent === 0) {
    return dropStyle;
  }

  return {
    ...dropStyle,
    marginLeft: `${indent}px`,
    width: `calc(100% - ${indent}px)`
  };
}

/**
 * 判断拖拽移动是否应解释为移入组合。
 * @param event - 拖拽移动事件
 * @returns 是否应移入目标组合
 */
function shouldMoveInsideGroup(event: BDraggableMoveEvent<SidebarLayerEntry>): boolean {
  return event.position === 'after' && event.targetItem.isGroup && isGroupExpanded(event.targetItem);
}

/**
 * 解析侧栏图层移动位置。
 * @param event - 拖拽移动事件
 * @returns 图层移动位置
 */
function resolveLayerMovePosition(event: BDraggableMoveEvent<SidebarLayerEntry>): WidgetLayerMovePosition {
  return shouldMoveInsideGroup(event) ? 'inside' : event.position;
}

/**
 * 读取指定展示项的父级展示项。
 * @param entry - 图层展示项
 * @returns 父级展示项，不存在时返回 null
 */
function getParentEntry(entry: SidebarLayerEntry): SidebarLayerEntry | null {
  if (!entry.parentId) {
    return null;
  }

  return layerEntries.value.find((item: SidebarLayerEntry): boolean => item.id === entry.parentId) ?? null;
}

/**
 * 解析拖到最后一个子节点之后时应使用的父级目标。
 * @param event - 拖拽移动事件
 * @returns 父级展示项，不需要移出时返回 null
 */
function resolveAfterParentMoveTarget(event: BDraggableMoveEvent<SidebarLayerEntry>): SidebarLayerEntry | null {
  if (
    event.position !== 'after' ||
    event.sourceItem.parentId === null ||
    event.sourceItem.parentId !== event.targetItem.parentId ||
    !isLastDirectChildEntry(event.targetItem)
  ) {
    return null;
  }

  return getParentEntry(event.targetItem);
}

/**
 * 判断拖到第一个子节点前方时是否应解释为移入父组合顶部。
 * @param event - 拖拽移动事件
 * @returns 是否应移入目标子节点的父组合
 */
function shouldMoveInsideFromFirstChild(event: BDraggableMoveEvent<SidebarLayerEntry>): boolean {
  return (
    event.position === 'before' &&
    event.targetItem.parentId !== null &&
    event.sourceItem.id !== event.targetItem.parentId &&
    event.sourceItem.parentId !== event.targetItem.parentId &&
    isFirstDirectChildEntry(event.targetItem)
  );
}

/**
 * 解析拖到第一个子节点前方时应使用的父级组合目标。
 * @param event - 拖拽移动事件
 * @returns 父级展示项，不需要移入时返回 null
 */
function resolveInsideParentMoveTarget(event: BDraggableMoveEvent<SidebarLayerEntry>): SidebarLayerEntry | null {
  if (!shouldMoveInsideFromFirstChild(event)) {
    return null;
  }

  return getParentEntry(event.targetItem);
}

/**
 * 解析拖拽移动最终写入的图层位置。
 * @param event - 拖拽移动事件
 * @param afterParentTarget - 移出到父级同层时的父级目标
 * @param insideParentTarget - 移入父级组合顶部时的父级目标
 * @returns 图层移动位置
 */
function resolveFinalLayerMovePosition(
  event: BDraggableMoveEvent<SidebarLayerEntry>,
  afterParentTarget: SidebarLayerEntry | null,
  insideParentTarget: SidebarLayerEntry | null
): WidgetLayerMovePosition {
  if (afterParentTarget) {
    return 'after';
  }

  if (insideParentTarget) {
    return 'inside';
  }

  return resolveLayerMovePosition(event);
}

/**
 * 处理图层展示项点击。
 * @param entry - 被点击的图层展示项
 */
function handleEntryClick(entry: SidebarLayerEntry): void {
  emit('select-elements', [entry.element]);
}

/**
 * 处理图层元素复制。
 * @param element - 被复制的Widget元素
 */
function handleElementCopy(element: WidgetElement): void {
  emit('copy-elements', [element]);
}

/**
 * 处理图层展示项复制。
 * @param entry - 被复制的图层展示项
 */
function handleEntryCopy(entry: SidebarLayerEntry): void {
  handleElementCopy(entry.element);
}

/**
 * 处理图层元素删除。
 * @param element - 被删除的Widget元素
 */
function handleElementDelete(element: WidgetElement): void {
  emit('delete-elements', [element]);
}

/**
 * 处理图层展示项删除。
 * @param entry - 被删除的图层展示项
 */
function handleEntryDelete(entry: SidebarLayerEntry): void {
  handleElementDelete(entry.element);
}

/**
 * 处理公共拖拽组件发出的列表项点击。
 * @param entry - 被点击的图层展示项
 */
function handleDraggableItemClick(entry: SidebarLayerEntry): void {
  handleEntryClick(entry);
}

/**
 * 处理公共拖拽组件发出的移动事件。
 * @param event - 拖拽移动事件
 */
function handleDraggableMove(event: BDraggableMoveEvent<SidebarLayerEntry>): void {
  const sourceElements = getEntryElements(event.sourceItem);
  const afterParentTarget = resolveAfterParentMoveTarget(event);
  const insideParentTarget = afterParentTarget ? null : resolveInsideParentMoveTarget(event);
  const targetEntry = afterParentTarget ?? insideParentTarget ?? event.targetItem;
  const targetElements = getEntryElements(targetEntry);
  const movePosition = resolveFinalLayerMovePosition(event, afterParentTarget, insideParentTarget);
  emit('move-elements', {
    sourceIds: sourceElements.map((element: WidgetElement): string => element.id),
    targetIds: targetElements.map((element: WidgetElement): string => element.id),
    position: movePosition
  });
}
</script>

<style lang="less" scoped>
.sidebar-panel__layer-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  align-items: center;
  justify-content: center;
  padding: 40px 16px;
}

.sidebar-panel__layer-empty-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: 4px;
  color: var(--text-quaternary);
  background: var(--bg-tertiary);
  border-radius: var(--control-radius);
}

.sidebar-panel__layer-empty-text {
  font-size: 13px;
  color: var(--text-tertiary);
}

.sidebar-panel__layer-empty-hint {
  font-size: 12px;
  color: var(--text-quaternary);
}

.sidebar-panel__layer-list {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
}

.sidebar-panel__layer-list :deep(.b-draggable__indicator) {
  display: none;
}

:deep(.sidebar-panel__layer-item) {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: auto;
  min-height: 32px;
  color: var(--text-secondary);

  &.is-active .sidebar-panel__layer-row {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    border-color: var(--color-primary-border);
  }

  &.is-dragging {
    opacity: 0.55;
  }

  &.is-active.is-dragging {
    border-color: transparent;
  }

  &:hover .sidebar-panel__layer-actions,
  &:focus-within .sidebar-panel__layer-actions {
    pointer-events: auto;
    opacity: 1;
  }
}

.sidebar-panel__layer-row {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  height: 32px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: var(--control-border-width) solid transparent;
  border-radius: var(--control-radius);
  transition: color var(--motion-duration-fast) var(--motion-easing-standard), background var(--motion-duration-fast) var(--motion-easing-standard),
    border-color var(--motion-duration-fast) var(--motion-easing-standard);

  &.is-active {
    color: var(--color-primary);
    background: var(--color-primary-bg);
    border-color: var(--color-primary-border);
  }
}

.sidebar-panel__layer-row.is-drop-before::before,
.sidebar-panel__layer-row.is-drop-after::after,
.sidebar-panel__layer-row.is-drop-inside::after {
  position: absolute;
  right: 0;
  left: var(--sidebar-layer-drop-offset, 0);
  z-index: 1;
  height: 2px;
  content: '';
  background: var(--color-primary);
  border-radius: var(--radius-full);
}

.sidebar-panel__layer-row.is-drop-before::before {
  top: -4px;
}

.sidebar-panel__layer-row.is-drop-after::after,
.sidebar-panel__layer-row.is-drop-inside::after {
  bottom: -4px;
}

.sidebar-panel__layer-drag-handle {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 100%;
  padding: 0;
  color: var(--text-secondary);
  appearance: none;
  cursor: grab;
  background: transparent;
  border: 0;
  opacity: 0.72;
  transition: color var(--motion-duration-fast) var(--motion-easing-standard), opacity var(--motion-duration-fast) var(--motion-easing-standard);

  &:hover,
  &:focus-visible {
    color: var(--color-primary);
    opacity: 1;
  }
}

.sidebar-panel__layer-collapse {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 100%;
  padding: 0;
  padding-right: 4px;
  color: var(--text-secondary);
  appearance: none;
  cursor: pointer;
  background: transparent;
  border: 0;

  &:hover,
  &:focus-visible {
    color: var(--color-primary);
  }
}

.sidebar-panel__layer-collapse-placeholder {
  display: block;
  flex-shrink: 0;
  width: 20px;
  height: 100%;
}

.sidebar-panel__layer-select {
  display: flex;
  flex: 1;
  gap: 9px;
  align-items: center;
  min-width: 0;
  height: 100%;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  appearance: none;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.sidebar-panel__layer-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.sidebar-panel__layer-title {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
}

.sidebar-panel__layer-group-title {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
}

.sidebar-panel__layer-actions {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
  align-items: center;
  padding-right: 4px;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard);
}
</style>
