<!--
  @file index.vue
  @description 独立Widget工具组件。
-->
<template>
  <section ref="rootRef" class="b-widget" tabindex="0">
    <InfiniteViewport>
      <WidgetCanvas
        :elements="board.state.value.elements"
        :selection="board.state.value.selection"
        :active-element-id="activeElementId"
        :geometry-preview-changes="moveablePreviewChanges"
        :viewport="board.state.value.viewport"
        :viewport-size="viewportSize"
        :viewport-ready="isViewportReady"
        :active-tool="activeTool"
        :create-cursor="activeCreateCursor"
        :is-create-tool="isCreateToolActive"
        :is-panning="isPanning"
        @select="handleElementSelect"
        @element-pointerup="handleElementPointerup"
        @canvas-pointerdown="handleCanvasPointerdown"
        @canvas-pointermove="handleCanvasPointermove"
        @canvas-pointerup="handleCanvasPointerup"
        @canvas-wheel="handleCanvasWheel"
        @context-menu="handleWidgetContextMenu"
      />
    </InfiniteViewport>
    <MoveableLayer
      :enabled="activeTool === 'select' && !hideMoveableDuringDirectDrag"
      :root="rootRef"
      :elements="board.state.value.elements"
      :selection="board.state.value.selection"
      :active-element-id="activeElementId"
      :viewport="board.state.value.viewport"
      :viewport-size="viewportSize"
      @context-menu="handleWidgetContextMenu"
      @move="board.onMoveElements"
      @preview-end="handleMoveablePreviewEnd"
      @resize="handleMoveableResize"
      @resize-preview="handleMoveableGeometryPreview"
    />
    <SelectoLayer
      :root="rootRef"
      :active-tool="activeTool"
      :selection="board.state.value.selection"
      :viewport="board.state.value.viewport"
      :viewport-size="viewportSize"
      @set-selection="setBoardSelection"
    />
    <WidgetContextMenu
      :open="contextMenuState.open"
      :position="contextMenuState.clientPoint"
      :items="contextMenuItems"
      @select="handleContextMenuCommand"
      @close="closeContextMenu"
    />
    <Toolbar
      :zoom="board.state.value.viewport.zoom"
      :active-tool="activeTool"
      :elements="board.state.value.elements"
      :viewport="board.state.value.viewport"
      :viewport-size="viewportSize"
      :can-undo="canUndo"
      :can-redo="canRedo"
      @set-tool="setActiveTool"
      @undo="board.onUndo"
      @redo="board.onRedo"
      @zoom-in="viewport.zoomIn"
      @zoom-out="viewport.zoomOut"
      @reset-zoom="viewport.resetZoom"
      @set-center="viewport.setCenter"
      @set-zoom="viewport.setZoom"
    />
  </section>
</template>

<script setup lang="ts">
import type { WidgetElementSchema } from './elements';
import type {
  BWidgetExpose,
  WidgetData,
  WidgetContextMenuPayload,
  WidgetElement,
  WidgetElementStyle,
  WidgetGeometryChange,
  WidgetLayerAction,
  WidgetPoint,
  WidgetSelectElementByIdOptions,
  WidgetSelectTarget,
  WidgetSize
} from './types';
import type { WidgetCanvasPointProjection } from './utils/widgetGeometry';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useShortcuts } from '@/hooks/useShortcuts';
import WidgetContextMenu from './components/ContextMenu.vue';
import InfiniteViewport from './components/InfiniteViewport.vue';
import MoveableLayer from './components/MoveableLayer.vue';
import SelectoLayer from './components/SelectoLayer.vue';
import Toolbar from './components/Toolbar.vue';
import { getWidgetElementSchema } from './elements';
import { useModelSync } from './hooks/useModelSync';
import { provideRenderContext } from './hooks/useRenderContext';
import { useViewportSize } from './hooks/useViewportSize';
import { useWidgetBoard } from './hooks/useWidgetBoard';
import { useWidgetInteraction } from './hooks/useWidgetInteraction';
import { useWidgetViewport } from './hooks/useWidgetViewport';
import WidgetCanvas from './renderers/WidgetCanvas.vue';
import { createDefaultWidgetData } from './utils/widgetData';
import { clientDeltaToWidgetDelta, createWidgetViewportForElements, projectClientPointToWidgetBoard } from './utils/widgetGeometry';
import { readWidgetPreviewRenderContext } from './utils/widgetPreviewContext';
import {
  findElementTreeNode,
  flattenWidgetElementTree,
  isSameParent,
  isWidgetGroupElement,
  readWidgetElementChildren,
  type WidgetRenderTreeNode
} from './utils/widgetTree';

/**
 * 右键菜单命令。
 */
type WidgetContextMenuCommand =
  | 'copy'
  | 'paste'
  | 'lock'
  | 'unlock'
  | 'group'
  | 'ungroup'
  | 'bringToFront'
  | 'bringForward'
  | 'sendBackward'
  | 'sendToBack'
  | 'delete';

/**
 * 右键菜单项。
 */
interface WidgetContextMenuItem {
  /** 菜单项类型 */
  type?: 'item';
  /** 菜单命令 */
  key: WidgetContextMenuCommand;
  /** 展示文案 */
  label: string;
  /** 图标 */
  icon: string;
  /** 是否禁用 */
  disabled?: boolean;
  /** 是否危险操作 */
  danger?: boolean;
}

/**
 * 右键菜单分割线。
 */
interface WidgetContextMenuDivider {
  /** 菜单项类型 */
  type: 'divider';
  /** 分割线唯一标识 */
  key: string;
}

/**
 * 右键菜单条目。
 */
type WidgetContextMenuEntry = WidgetContextMenuItem | WidgetContextMenuDivider;

/**
 * 右键菜单状态。
 */
interface WidgetContextMenuState {
  /** 是否打开 */
  open: boolean;
  /** 右键命中的元素 ID */
  elementId: string | null;
  /** 浏览器坐标 */
  clientPoint: WidgetPoint;
  /** Widget坐标 */
  boardPoint: WidgetPoint;
}

const dataItem = defineModel<WidgetData>('value', {
  default: createDefaultWidgetData
});
/** 当前选中的绘图目标（元素或锚点），支持双向绑定。 */
const selectedTarget = defineModel<WidgetSelectTarget>('select', { default: null });
const emit = defineEmits<{
  /** 同步内部选区 ID 列表 */
  'selection-change': [selection: string[]];
}>();
/** Widget实例，管理绘图元素数据与状态。 */
const board = useWidgetBoard(dataItem.value);
/** 当前Widget数据内声明的预览渲染上下文。 */
const renderContext = computed(() => readWidgetPreviewRenderContext(dataItem.value.metadata));
provideRenderContext(renderContext);
/** 视口控制器，处理Widget的平移与缩放。 */
const viewport = useWidgetViewport(board);
/** 交互控制器，处理鼠标/触控事件与元素操作。 */
const interaction = useWidgetInteraction(board);
/** 当前激活的工具名称，默认为选择工具。 */
const activeTool = ref<string>('select');
/** 组合选区内当前作为设置面板编辑目标的子元素 ID。 */
const activeElementId = ref<string | null>(null);
/** 创建工具激活时应用到下一个形状的样式。 */
const creationStyle = ref<WidgetElementStyle>({});
const { rootRef, viewportSize, isViewportReady } = useViewportSize();
const { registerShortcuts } = useShortcuts();
/** 当前历史栈是否允许撤销。 */
const canUndo = computed<boolean>(() => board.state.value.history.past.length > 0);
/** 当前历史栈是否允许重做。 */
const canRedo = computed<boolean>(() => board.state.value.history.future.length > 0);
/** 是否已执行初始内容视口适配。 */
const initialContentViewportFitted = ref<boolean>(false);
/** 未选中节点直接拖拽期间临时隐藏 Moveable 图层，避免旧选框跟随显示。 */
const hideMoveableDuringDirectDrag = ref<boolean>(false);
/** Moveable 拖拽缩放过程中的临时几何预览。 */
const moveablePreviewChanges = ref<WidgetGeometryChange[]>([]);
/** 右键菜单状态。 */
const contextMenuState = ref<WidgetContextMenuState>({
  open: false,
  elementId: null,
  clientPoint: { x: 0, y: 0 },
  boardPoint: { x: 0, y: 0 }
});

/** 当前激活工具对应的可创建元素配置。 */
const activeCreateSchema = computed<WidgetElementSchema | null>(() => getWidgetElementSchema(activeTool.value));
/** 当前是否激活可创建元素工具。 */
const isCreateToolActive = computed<boolean>(() => activeCreateSchema.value !== null);
/** 当前创建工具光标。 */
const activeCreateCursor = computed<string | undefined>(() => (activeCreateSchema.value ? activeCreateSchema.value.createCursor ?? 'crosshair' : undefined));
/** 当前右键菜单项。 */
const contextMenuItems = computed<WidgetContextMenuEntry[]>(() => {
  const hasSelection = board.state.value.selection.length > 0;
  const selectedElements = board.state.value.selection
    .map((elementId: string): WidgetElement | null => findElementTreeNode(board.state.value.elements, elementId)?.element ?? null)
    .filter((element: WidgetElement | null): element is WidgetElement => element !== null);
  let lockEntry: WidgetContextMenuItem | null = null;

  if (selectedElements.length > 0) {
    const isSelectionLocked = selectedElements.every((element: WidgetElement): boolean => element.locked === true);

    if (isSelectionLocked) {
      lockEntry = { key: 'unlock', label: '解锁', icon: 'lucide:unlock' };
    } else {
      lockEntry = { key: 'lock', label: '锁定', icon: 'lucide:lock' };
    }
  }
  const canGroup = board.state.value.selection.length > 1 && isSameParent(board.state.value.elements, board.state.value.selection);
  const canUngroup = board.state.value.selection.some((elementId: string): boolean => {
    const element = findElementTreeNode(board.state.value.elements, elementId)?.element;

    return element ? isWidgetGroupElement(element) : false;
  });
  const editEntries: WidgetContextMenuEntry[] = [];

  if (lockEntry) {
    editEntries.push(lockEntry);
  }
  if (canUngroup) {
    editEntries.push({ key: 'ungroup', label: '取消合并', icon: 'lucide:ungroup' });
  } else if (canGroup) {
    editEntries.push({ key: 'group', label: '合并', icon: 'lucide:group' });
  }

  return [
    { key: 'copy', label: '复制', icon: 'lucide:copy', disabled: !hasSelection },
    { key: 'paste', label: '粘贴', icon: 'lucide:clipboard-paste', disabled: !board.hasClipboard.value },
    ...(editEntries.length ? [{ type: 'divider', key: 'divider-edit' } satisfies WidgetContextMenuDivider, ...editEntries] : []),
    { type: 'divider', key: 'divider-group-layer' },
    { key: 'bringForward', label: '上一层', icon: 'lucide:bring-to-front', disabled: !hasSelection },
    { key: 'sendBackward', label: '下一层', icon: 'lucide:send-to-back', disabled: !hasSelection },
    { key: 'bringToFront', label: '置顶', icon: 'lucide:chevrons-up', disabled: !hasSelection },
    { key: 'sendToBack', label: '置底', icon: 'lucide:chevrons-down', disabled: !hasSelection },
    { type: 'divider', key: 'divider-layer-danger' },
    { key: 'delete', label: '删除', icon: 'lucide:trash-2', disabled: !hasSelection, danger: true }
  ];
});
/**
 * 根据内部选区创建外部可编辑目标。
 * @param selection - 内部选区 ID 列表
 * @returns 外部可编辑目标
 */
function createSelectedTargetFromSelection(selection: string[]): WidgetSelectTarget {
  if (selection.length === 0) return dataItem.value.metadata;

  if (activeElementId.value && selection.includes(activeElementId.value)) {
    const activeElement = findElementTreeNode(dataItem.value.elements, activeElementId.value)?.element;

    if (activeElement) {
      return activeElement;
    }
  }

  if (selection.length > 1) return null;

  const selectedId = selection[0];
  const element = selectedId ? findElementTreeNode(dataItem.value.elements, selectedId)?.element : null;

  return element ?? dataItem.value.metadata;
}

/**
 * 判断设置目标是否为Widget元素。
 * @param target - 设置目标
 * @returns 是否为Widget元素
 */
function isWidgetElementSelectTarget(target: WidgetSelectTarget): target is WidgetElement {
  return target !== null && typeof target === 'object' && 'id' in target && typeof target.id === 'string';
}

/**
 * 判断两个选区是否一致。
 * @param current - 当前选区
 * @param next - 目标选区
 * @returns 是否一致
 */
function isSameSelection(current: string[], next: string[]): boolean {
  return current.length === next.length && current.every((id: string, index: number): boolean => id === next[index]);
}

/**
 * 判断当前激活子元素是否仍然对应一个完整组合选区。
 * @param selection - 内部选区 ID 列表
 * @returns 激活子元素是否有效
 */
function isActiveElementSelection(selection: string[]): boolean {
  return Boolean(activeElementId.value && selection.includes(activeElementId.value));
}

/**
 * 同步组合子元素激活态，避免激活 ID 脱离当前选区。
 * @param selection - 内部选区 ID 列表
 */
function syncActiveElementId(selection: string[]): void {
  if (activeElementId.value && !isActiveElementSelection(selection)) {
    activeElementId.value = null;
  }
}

/**
 * 处理内部选区变化。
 * @param selection - 内部选区 ID 列表
 */
function handleSelectionChange(selection: string[]): void {
  syncActiveElementId(selection);
  selectedTarget.value = createSelectedTargetFromSelection(selection);
  emit('selection-change', [...selection]);
}

/**
 * 设置Widget选区。
 * @param selection - 原始选区
 */
function setBoardSelection(selection: string[]): void {
  activeElementId.value = null;
  board.onSetSelection(selection);
}

/**
 * 读取命中元素路径上当前已选中的节点 ID。
 * @param id - 命中的元素 ID
 * @returns 当前已选路径节点 ID，不存在时返回 null
 */
function getSelectedPathElementId(id: string): string | null {
  const node = findElementTreeNode(board.state.value.elements, id);
  if (!node) {
    return null;
  }

  const reversedPath = node.path.slice().reverse();
  if (isWidgetElementSelectTarget(selectedTarget.value) && reversedPath.includes(selectedTarget.value.id)) {
    return selectedTarget.value.id;
  }

  const selectedIds = new Set(board.state.value.selection);

  return reversedPath.find((pathId: string): boolean => selectedIds.has(pathId)) ?? null;
}

/**
 * 读取元素点击后应使用的选区。
 * @param id - 元素 ID
 * @returns 目标选区
 */
function getSelectionForElement(id: string): string[] {
  const selectedPathElementId = getSelectedPathElementId(id);
  if (!selectedPathElementId) {
    return [id];
  }

  if (board.state.value.selection.includes(selectedPathElementId)) {
    return [...board.state.value.selection];
  }

  return [selectedPathElementId];
}

/**
 * 读取元素指针拖拽应操作的节点 ID。
 * @param id - 命中的元素 ID
 * @returns 拖拽目标元素 ID
 */
function getDragTargetForElement(id: string): string {
  return getSelectedPathElementId(id) ?? id;
}

/**
 * 将外部传入的元素设置目标同步到内部画布选区。
 * @param target - 外部设置目标
 */
function syncBoardSelectionFromSelectedTarget(target: WidgetSelectTarget): void {
  if (!isWidgetElementSelectTarget(target)) {
    return;
  }

  if (board.state.value.selection.includes(target.id)) {
    return;
  }

  const hasElement = findElementTreeNode(board.state.value.elements, target.id) !== null;
  if (!hasElement) {
    return;
  }

  activeElementId.value = null;
  board.onSetSelection(getSelectionForElement(target.id));
}

/**
 * 处理外部模型重置，允许异步加载出的已有内容重新执行初始视口适配。
 * @param nextDataItem - 最新外部Widget数据
 */
function handleExternalModelReset(nextDataItem: WidgetData): void {
  if (nextDataItem.elements.length > 0) {
    initialContentViewportFitted.value = false;
  }

  syncBoardSelectionFromSelectedTarget(selectedTarget.value);
}

useModelSync({
  board,
  dataItem,
  onExternalModelReset: handleExternalModelReset
});

/**
 * 读取元素右键菜单应使用的选区。
 * @param id - 元素 ID
 * @returns 右键菜单选区
 */
function getContextMenuSelectionForElement(id: string): string[] {
  if (board.state.value.selection.includes(id)) {
    return [...board.state.value.selection];
  }

  const node = findElementTreeNode(board.state.value.elements, id);
  const selectedIds = new Set(board.state.value.selection);
  if (node?.path.some((pathId: string): boolean => selectedIds.has(pathId))) {
    return [...board.state.value.selection];
  }

  return getSelectionForElement(id);
}

/**
 * 关闭右键菜单。
 */
function closeContextMenu(): void {
  contextMenuState.value = {
    ...contextMenuState.value,
    open: false
  };
}

/**
 * 首次打开已有内容时自动适配视口。
 */
function fitInitialContentViewport(): void {
  if (initialContentViewportFitted.value || !isViewportReady.value) {
    return;
  }

  initialContentViewportFitted.value = true;
  if (board.state.value.elements.length === 0) {
    return;
  }

  const nextViewport = createWidgetViewportForElements(board.state.value.elements, viewportSize.value);
  if (!nextViewport) {
    return;
  }

  viewport.setCenter(nextViewport.center);
  viewport.setZoom(nextViewport.zoom);
}

watch(
  [isViewportReady, () => viewportSize.value.width, () => viewportSize.value.height, () => board.state.value.elements.length],
  (): void => {
    fitInitialContentViewport();
  },
  { immediate: true }
);

syncBoardSelectionFromSelectedTarget(selectedTarget.value);
watch(() => board.state.value.selection, handleSelectionChange, { immediate: true });
watch(
  () => [selectedTarget.value, board.state.value.elements],
  (): void => {
    syncBoardSelectionFromSelectedTarget(selectedTarget.value);
  },
  { deep: true }
);

/**
 * 直接拖拽预览节点。
 */
interface DirectElementDragPreviewNode {
  /** 预览元素 ID */
  id: string;
  /** 起始画布绝对坐标 */
  startAbsolutePosition: WidgetPoint;
}

/**
 * 直接拖拽节点会话。
 */
interface DirectElementDragSession {
  /** 拖拽元素 ID */
  id: string;
  /** 起始浏览器坐标 */
  startClient: WidgetPoint;
  /** 起始Widget坐标 */
  startBoard: WidgetPoint | null;
  /** 起始元素位置 */
  startPosition: WidgetPoint;
  /** 最后一次预览位置 */
  currentPosition: WidgetPoint;
  /** 跟随直接拖拽预览的节点列表 */
  previewNodes: DirectElementDragPreviewNode[];
  /** 是否已经产生位移 */
  moved: boolean;
  /** 是否在拖拽结束后选中元素 */
  selectOnEnd: boolean;
  /** 拖拽监听取消器 */
  abortController: AbortController;
}

/**
 * 手型工具平移会话。
 */
interface HandPanSession {
  /** 起始浏览器坐标 */
  startClient: WidgetPoint;
  /** 起始视口中心 */
  startCenter: WidgetPoint;
  /** 起始缩放比例 */
  startZoom: number;
  /** 起始Widget渲染尺寸 */
  canvasSize: WidgetSize;
  /** 拖拽监听取消器 */
  abortController: AbortController;
}

let directDragSession: DirectElementDragSession | null = null;
let handPanSession: HandPanSession | null = null;

/** 手型工具是否正在平移中。 */
const isPanning = ref<boolean>(false);

/**
 * 获取当前工具对应的创建元素名称。
 * @returns 可创建元素名称，不是创建工具时返回 null
 */
function getActiveCreateName(): string | null {
  return activeCreateSchema.value?.name ?? null;
}

/**
 * 通过元素 ID 读取渲染树节点。
 * @param treeNodes - 渲染树节点列表
 * @param elementId - 元素 ID
 * @returns 渲染树节点，不存在时返回 null
 */
function findRenderTreeNodeById(treeNodes: WidgetRenderTreeNode[], elementId: string): WidgetRenderTreeNode | null {
  return treeNodes.find((item: WidgetRenderTreeNode): boolean => item.element.id === elementId) ?? null;
}

/**
 * 读取渲染树节点的父级绝对坐标。
 * @param treeNodes - 渲染树节点列表
 * @param node - 当前节点
 * @returns 父级绝对坐标，顶层返回原点
 */
function getRenderTreeNodeParentPosition(treeNodes: WidgetRenderTreeNode[], node: WidgetRenderTreeNode): WidgetPoint {
  if (!node.parentId) {
    return { x: 0, y: 0 };
  }

  return findRenderTreeNodeById(treeNodes, node.parentId)?.absolutePosition ?? { x: 0, y: 0 };
}

/**
 * 将模型坐标预览变更转换为画布绝对坐标预览。
 * @param change - 模型坐标预览变更
 * @param node - 变更命中的渲染树节点
 * @param treeNodes - 渲染树节点列表
 * @returns 画布绝对坐标预览变更
 */
function createRenderPreviewChange(change: WidgetGeometryChange, node: WidgetRenderTreeNode, treeNodes: WidgetRenderTreeNode[]): WidgetGeometryChange {
  if (!change.position) {
    return { ...change };
  }

  const parentPosition = getRenderTreeNodeParentPosition(treeNodes, node);

  return {
    ...change,
    position: {
      x: parentPosition.x + change.position.x,
      y: parentPosition.y + change.position.y
    }
  };
}

/**
 * 递归创建组合内部仅跟随位置的预览变更。
 * @param groupElement - 组合元素
 * @param groupPreviewPosition - 组合预览绝对坐标
 * @returns 子树位置预览变更
 */
function createGroupDescendantPositionPreviewChanges(groupElement: WidgetElement, groupPreviewPosition: WidgetPoint): WidgetGeometryChange[] {
  return readWidgetElementChildren(groupElement).flatMap((child: WidgetElement): WidgetGeometryChange[] => {
    const childPreviewPosition = {
      x: groupPreviewPosition.x + child.position.x,
      y: groupPreviewPosition.y + child.position.y
    };
    const childChange: WidgetGeometryChange = {
      id: child.id,
      position: childPreviewPosition
    };

    return isWidgetGroupElement(child) ? [childChange, ...createGroupDescendantPositionPreviewChanges(child, childPreviewPosition)] : [childChange];
  });
}

/**
 * 按组合缩放预览创建子树几何预览变更。
 * @param groupElement - 被缩放的组合元素
 * @param groupPreviewPosition - 组合预览绝对坐标
 * @param scaleX - 横向缩放比例
 * @param scaleY - 纵向缩放比例
 * @returns 子树几何预览变更
 */
function createGroupResizeChildPreviewChanges(
  groupElement: WidgetElement,
  groupPreviewPosition: WidgetPoint,
  scaleX: number,
  scaleY: number
): WidgetGeometryChange[] {
  return readWidgetElementChildren(groupElement).flatMap((child: WidgetElement): WidgetGeometryChange[] => {
    const childPreviewPosition = {
      x: groupPreviewPosition.x + child.position.x * scaleX,
      y: groupPreviewPosition.y + child.position.y * scaleY
    };
    const childChange: WidgetGeometryChange = {
      id: child.id,
      position: childPreviewPosition,
      size: {
        width: child.size.width * scaleX,
        height: child.size.height * scaleY
      }
    };

    return isWidgetGroupElement(child) ? [childChange, ...createGroupResizeChildPreviewChanges(child, childPreviewPosition, scaleX, scaleY)] : [childChange];
  });
}

/**
 * 将 Moveable 几何预览补齐为画布渲染所需的绝对坐标子树预览。
 * @param changes - Moveable 模型坐标预览变更
 * @returns 画布渲染预览变更
 */
function createMoveableRenderPreviewChanges(changes: WidgetGeometryChange[]): WidgetGeometryChange[] {
  const treeNodes = flattenWidgetElementTree(board.state.value.elements);

  return changes.flatMap((change: WidgetGeometryChange): WidgetGeometryChange[] => {
    const node = findRenderTreeNodeById(treeNodes, change.id);
    if (!node) {
      return [change];
    }

    const renderChange = createRenderPreviewChange(change, node, treeNodes);
    if (!isWidgetGroupElement(node.element)) {
      return [renderChange];
    }

    const groupPreviewPosition = renderChange.position ?? node.absolutePosition;
    if (!change.size) {
      return [renderChange, ...createGroupDescendantPositionPreviewChanges(node.element, groupPreviewPosition)];
    }

    const scaleX = node.element.size.width === 0 ? 1 : change.size.width / node.element.size.width;
    const scaleY = node.element.size.height === 0 ? 1 : change.size.height / node.element.size.height;

    return [renderChange, ...createGroupResizeChildPreviewChanges(node.element, groupPreviewPosition, scaleX, scaleY)];
  });
}

/**
 * 处理 Moveable 几何预览。
 * @param changes - 预览几何变更
 */
function handleMoveableGeometryPreview(changes: WidgetGeometryChange[]): void {
  moveablePreviewChanges.value = createMoveableRenderPreviewChanges(changes);
}

/**
 * 清理 Moveable 临时预览。
 */
function handleMoveablePreviewEnd(): void {
  moveablePreviewChanges.value = [];
}

/**
 * 提交 Moveable 缩放并清理预览。
 * @param changes - 几何变更
 */
function handleMoveableResize(changes: WidgetGeometryChange[]): void {
  board.onResizeElements(changes);
  handleMoveablePreviewEnd();
}

/**
 * 判断元素自身是否锁定几何。
 * @param element - Widget元素
 * @returns 当前元素是否锁定位置和尺寸
 */
function isElementGeometryLocked(element: WidgetElement): boolean {
  return element.locked === true;
}

/**
 * 读取Widget渲染尺寸。
 * @returns Widget渲染尺寸，无法读取时返回 null
 */
function getCanvasSize(): WidgetSize | null {
  if (viewportSize.value.width && viewportSize.value.height) {
    return { ...viewportSize.value };
  }

  const rect = rootRef.value?.getBoundingClientRect();
  if (!rect?.width || !rect.height) {
    return null;
  }

  return {
    width: rect.width,
    height: rect.height
  };
}

/**
 * 将浏览器坐标投影到Widget坐标系。
 * @param clientX - 浏览器横坐标
 * @param clientY - 浏览器纵坐标
 * @returns Widget投影信息，无法读取Widget尺寸时返回 null
 */
function getCanvasPointProjection(clientX: number, clientY: number): WidgetCanvasPointProjection | null {
  const rect = rootRef.value?.getBoundingClientRect();
  if (!rect) {
    return null;
  }

  return projectClientPointToWidgetBoard({ x: clientX, y: clientY }, rect, board.state.value.viewport);
}

/**
 * 将浏览器坐标转换为Widget坐标。
 * @param clientX - 浏览器横坐标
 * @param clientY - 浏览器纵坐标
 * @returns Widget坐标，无法读取Widget尺寸时返回 null
 */
function getBoardPointFromClient(clientX: number, clientY: number): WidgetPoint | null {
  return getCanvasPointProjection(clientX, clientY)?.boardPoint ?? null;
}

/**
 * 将浏览器指针位置转换为Widget坐标。
 * @param event - 指针事件
 * @returns Widget坐标，无法读取Widget尺寸时返回 null
 */
function getBoardPointFromPointer(event: PointerEvent): WidgetPoint | null {
  return getBoardPointFromClient(event.clientX, event.clientY);
}

/**
 * 根据浏览器坐标计算直接拖拽位置。
 * @param event - 指针事件
 * @param session - 拖拽会话
 * @returns 新位置
 */
function getDirectDragPosition(event: PointerEvent, session: DirectElementDragSession): WidgetPoint {
  const currentBoardPoint = getBoardPointFromPointer(event);
  if (currentBoardPoint && session.startBoard) {
    return {
      x: session.startPosition.x + currentBoardPoint.x - session.startBoard.x,
      y: session.startPosition.y + currentBoardPoint.y - session.startBoard.y
    };
  }

  return {
    x: session.startPosition.x + (event.clientX - session.startClient.x) / board.state.value.viewport.zoom,
    y: session.startPosition.y + (event.clientY - session.startClient.y) / board.state.value.viewport.zoom
  };
}

/**
 * 判断渲染树节点是否在目标路径对应的子树内。
 * @param item - 渲染树节点
 * @param targetPath - 目标元素路径
 * @returns 是否属于目标元素子树
 */
function isNodeInTargetSubtree(item: WidgetRenderTreeNode, targetPath: string[]): boolean {
  return targetPath.every((pathId: string, index: number): boolean => item.path[index] === pathId);
}

/**
 * 读取直接拖拽期间需要一起预览移动的节点。
 * @param elementId - 被拖拽元素 ID
 * @returns 预览节点列表
 */
function getDirectDragPreviewNodes(elementId: string): DirectElementDragPreviewNode[] {
  const treeNodes = flattenWidgetElementTree(board.state.value.elements);
  const targetNode = treeNodes.find((item: WidgetRenderTreeNode): boolean => item.element.id === elementId);
  if (!targetNode) {
    return [];
  }

  return treeNodes
    .filter((item: WidgetRenderTreeNode): boolean => isNodeInTargetSubtree(item, targetNode.path))
    .map(
      (item: WidgetRenderTreeNode): DirectElementDragPreviewNode => ({
        id: item.element.id,
        startAbsolutePosition: item.absolutePosition
      })
    );
}

/**
 * 根据当前拖拽位置创建直接拖拽预览变更。
 * @param position - 当前被拖拽元素局部位置
 * @param session - 直接拖拽会话
 * @returns 几何预览变更
 */
function createDirectDragPreviewChanges(position: WidgetPoint, session: DirectElementDragSession): WidgetGeometryChange[] {
  const delta = {
    x: position.x - session.startPosition.x,
    y: position.y - session.startPosition.y
  };

  return session.previewNodes.map(
    (node: DirectElementDragPreviewNode): WidgetGeometryChange => ({
      id: node.id,
      position: {
        x: node.startAbsolutePosition.x + delta.x,
        y: node.startAbsolutePosition.y + delta.y
      }
    })
  );
}

/**
 * 判断两个Widget坐标是否不同。
 * @param first - 第一个坐标
 * @param second - 第二个坐标
 * @returns 两个坐标是否不同
 */
function isDifferentWidgetPoint(first: WidgetPoint, second: WidgetPoint): boolean {
  return first.x !== second.x || first.y !== second.y;
}

/**
 * 根据指针事件刷新直接拖拽会话的最后位置。
 * @param event - 指针事件
 * @param session - 直接拖拽会话
 */
function updateDirectDragSessionPosition(event: PointerEvent, session: DirectElementDragSession): void {
  const position = getDirectDragPosition(event, session);

  moveablePreviewChanges.value = createDirectDragPreviewChanges(position, session);
  session.currentPosition = position;
  session.moved = session.moved || isDifferentWidgetPoint(position, session.startPosition);
}

/**
 * 判断当前按下是否需要启动 BWidget 直接拖拽。
 * @param hitElementId - 指针命中的元素 ID
 * @param dragTargetId - 实际拖拽目标 ID
 * @param selectionChanged - 本次按下是否改变选区
 * @returns 是否启动直接拖拽
 */
function shouldStartDirectDrag(hitElementId: string, dragTargetId: string, selectionChanged: boolean): boolean {
  return selectionChanged || hitElementId !== dragTargetId;
}

/**
 * 取消直接拖拽。
 */
function cancelDirectDrag(): void {
  directDragSession?.abortController.abort();
  directDragSession = null;
  moveablePreviewChanges.value = [];
  hideMoveableDuringDirectDrag.value = false;
}

/**
 * 取消手型工具平移。 */
function cancelHandPan(): void {
  handPanSession?.abortController.abort();
  handPanSession = null;
  isPanning.value = false;
}

/**
 * 设置当前Widget工具。
 * @param tool - 目标工具
 */
function setActiveTool(tool: string): void {
  board.onClearDraft();
  cancelHandPan();
  activeTool.value = tool;

  if (tool !== 'select') {
    board.onSetSelection([]);
  }
}

/**
 * 打开Widget右键菜单。
 * @param payload - 右键菜单事件载荷
 */
function handleWidgetContextMenu(payload: WidgetContextMenuPayload): void {
  cancelDirectDrag();
  setActiveTool('select');

  if (payload.elementId !== null) {
    const selection = getContextMenuSelectionForElement(payload.elementId);
    if (!isSameSelection(board.state.value.selection, selection)) {
      board.onSetSelection(selection);
    }
  }

  contextMenuState.value = {
    open: true,
    elementId: payload.elementId,
    clientPoint: payload.clientPoint,
    boardPoint: payload.boardPoint
  };
}

/**
 * 处理右键菜单命令。
 * @param command - 菜单命令
 */
function handleContextMenuCommand(command: string): void {
  switch (command) {
    case 'copy': {
      board.onCopySelection();
      break;
    }
    case 'paste': {
      board.onPasteClipboard(contextMenuState.value.boardPoint);
      break;
    }
    case 'lock': {
      board.onSetSelectionLocked(true);
      break;
    }
    case 'unlock': {
      board.onSetSelectionLocked(false);
      break;
    }
    case 'group': {
      board.onGroupSelection();
      break;
    }
    case 'ungroup': {
      board.onUngroupSelection();
      break;
    }
    case 'bringToFront': {
      board.onReorderSelection('bringToFront');
      break;
    }
    case 'bringForward': {
      board.onReorderSelection('bringForward');
      break;
    }
    case 'sendBackward': {
      board.onReorderSelection('sendBackward');
      break;
    }
    case 'sendToBack': {
      board.onReorderSelection('sendToBack');
      break;
    }
    case 'delete': {
      board.onDeleteSelection();
      break;
    }
    default: {
      break;
    }
  }

  closeContextMenu();
}

/**
 * 在指定Widget坐标创建元素。
 * @param name - 元素注册名称
 * @param point - 创建位置
 */
function createElementAtPoint(name: string, point: WidgetPoint): void {
  board.onStartShapeDraft(name, point);
  board.onUpdateDraftPoint(point);
  board.onCommitShapeDraft(creationStyle.value);
  setActiveTool('select');
}

/**
 * 处理手型工具平移移动。
 * @param event - 指针事件
 */
function handleHandPanMove(event: PointerEvent): void {
  if (!handPanSession) {
    return;
  }

  const delta = clientDeltaToWidgetDelta(
    {
      x: event.clientX - handPanSession.startClient.x,
      y: event.clientY - handPanSession.startClient.y
    },
    handPanSession.canvasSize,
    handPanSession.startZoom
  );
  if (!delta) {
    return;
  }

  viewport.setCenter({
    x: handPanSession.startCenter.x - delta.x,
    y: handPanSession.startCenter.y - delta.y
  });
}

/**
 * 结束手型工具平移。
 */
function handleHandPanEnd(): void {
  cancelHandPan();
}

/**
 * 开始手型工具平移。
 * @param event - 指针事件
 */
function startHandPan(event: PointerEvent): void {
  const canvasSize = getCanvasSize();
  if (!canvasSize) {
    return;
  }

  const abortController = new AbortController();
  cancelHandPan();
  isPanning.value = true;
  handPanSession = {
    startClient: {
      x: event.clientX,
      y: event.clientY
    },
    startCenter: { ...board.state.value.viewport.center },
    startZoom: board.state.value.viewport.zoom,
    canvasSize,
    abortController
  };

  window.addEventListener('pointermove', handleHandPanMove, { signal: abortController.signal });
  window.addEventListener('pointerup', handleHandPanEnd, { signal: abortController.signal });
  window.addEventListener('pointercancel', handleHandPanEnd, { signal: abortController.signal });
}

/**
 * 处理直接拖拽移动。
 * @param event - 指针事件
 */
function handleDirectDragMove(event: PointerEvent): void {
  if (!directDragSession) {
    return;
  }

  updateDirectDragSessionPosition(event, directDragSession);
}

/**
 * 处理直接拖拽结束。
 * @param event - 指针事件
 */
function handleDirectDragEnd(event?: PointerEvent): void {
  if (!directDragSession) {
    return;
  }

  const session = directDragSession;
  if (event) {
    updateDirectDragSessionPosition(event, session);
  }
  session.abortController.abort();
  directDragSession = null;

  if (!session.moved) {
    if (session.selectOnEnd) {
      board.onSetSelection([session.id]);
    }
    moveablePreviewChanges.value = [];
    hideMoveableDuringDirectDrag.value = false;
    return;
  }

  board.onMoveElements([
    {
      id: session.id,
      position: session.currentPosition
    }
  ]);
  if (session.selectOnEnd) {
    board.onSetSelection([session.id]);
  }
  moveablePreviewChanges.value = [];
  hideMoveableDuringDirectDrag.value = false;
}

/**
 * 处理直接拖拽取消。
 */
function handleDirectDragCancel(): void {
  cancelDirectDrag();
}

/**
 * 开始直接拖拽节点。
 * @param id - 元素 ID
 * @param event - 指针事件
 * @param selectOnEnd - 是否在拖拽结束后选中
 */
function startDirectDrag(id: string, event: PointerEvent, selectOnEnd: boolean): void {
  const element = findElementTreeNode(board.state.value.elements, id)?.element ?? null;
  if (!element || isElementGeometryLocked(element)) {
    return;
  }

  const abortController = new AbortController();
  cancelDirectDrag();
  // 新选中直接拖拽需要隐藏旧控制层；组合直接拖拽需要避免父子预览与控制层错位。
  hideMoveableDuringDirectDrag.value = selectOnEnd || isWidgetGroupElement(element);
  directDragSession = {
    id,
    startClient: {
      x: event.clientX,
      y: event.clientY
    },
    startBoard: getBoardPointFromPointer(event),
    startPosition: { ...element.position },
    currentPosition: { ...element.position },
    previewNodes: getDirectDragPreviewNodes(id),
    moved: false,
    selectOnEnd,
    abortController
  };

  window.addEventListener('pointermove', handleDirectDragMove, { signal: abortController.signal });
  window.addEventListener('pointerup', handleDirectDragEnd, { signal: abortController.signal });
  window.addEventListener('pointercancel', handleDirectDragCancel, { signal: abortController.signal });
}

/**
 * 处理元素上释放指针。
 * @param _id - 元素 ID
 * @param event - 指针事件
 */
function handleElementPointerup(_id: string, event: PointerEvent): void {
  handleDirectDragEnd(event);
}

/**
 * 处理元素点击。
 * @param id - 元素 ID
 * @param _event - 指针事件
 */
function handleElementSelect(id: string, event: PointerEvent): void {
  if (event.button !== 0) {
    return;
  }

  if (activeTool.value === 'hand') {
    return;
  }

  /* 元素创建工具激活时，禁止选中已有节点，让点击穿透到Widget创建元素 */
  if (getActiveCreateName()) {
    return;
  }

  const selection = getSelectionForElement(id);
  const dragTargetId = getDragTargetForElement(id);
  const selectionChanged = !isSameSelection(board.state.value.selection, selection);

  if (selectionChanged) {
    activeElementId.value = null;
    board.onSetSelection(selection);
  }
  if (selection.length === 1 && shouldStartDirectDrag(id, dragTargetId, selectionChanged)) {
    startDirectDrag(dragTargetId, event, selectionChanged);
  }
}

/**
 * 处理Widget空白区域按下。
 * @param point - Widget坐标
 */
function handleCanvasPointerdown(point: WidgetPoint, event: PointerEvent): void {
  if (activeTool.value === 'hand') {
    startHandPan(event);
    return;
  }

  const name = getActiveCreateName();
  if (name) {
    board.onStartShapeDraft(name, point);
    return;
  }

  interaction.clearSelection();
}

/**
 * 处理Widget空白区域移动。
 * @param point - Widget坐标
 */
function handleCanvasPointermove(point: WidgetPoint): void {
  board.onUpdateDraftPoint(point);
}

/**
 * 处理Widget空白区域抬起。
 * @param point - Widget坐标
 */
function handleCanvasPointerup(point: WidgetPoint): void {
  const { draft } = board.state.value;
  if (draft?.kind !== 'creating-shape') {
    return;
  }

  board.onUpdateDraftPoint(point);
  board.onCommitShapeDraft(creationStyle.value);
  setActiveTool('select');
}

/**
 * 根据注册元素和浏览器坐标创建Widget元素。
 * @param name - 元素注册名称
 * @param clientPoint - 浏览器坐标
 */
async function createElementFromClientPoint(name: string, clientPoint: WidgetPoint): Promise<void> {
  const schema = getWidgetElementSchema(name);
  if (!schema) return;

  cancelDirectDrag();
  board.onClearDraft();
  const point = getBoardPointFromClient(clientPoint.x, clientPoint.y);
  if (!point) return;

  createElementAtPoint(schema.name, point);
}

/**
 * 根据元素 ID 选中Widget元素。
 * @param id - 元素 ID
 * @param options - 选中配置
 */
function selectElementById(id: string, options: WidgetSelectElementByIdOptions = {}): void {
  const hasElement = findElementTreeNode(board.state.value.elements, id) !== null;
  if (!hasElement) {
    return;
  }

  cancelDirectDrag();
  setActiveTool('select');
  const selection = getSelectionForElement(id);
  activeElementId.value = options.activateElement ? id : null;
  board.onSetSelection(selection);
}

/**
 * 根据元素 ID 列表选中Widget元素。
 * @param ids - 元素 ID 列表
 */
function selectElementsByIds(ids: string[]): void {
  const elementIds = new Set(flattenWidgetElementTree(board.state.value.elements).map((item: WidgetRenderTreeNode): string => item.element.id));
  const selection = ids.filter((id: string): boolean => elementIds.has(id));
  if (selection.length === 0) {
    return;
  }

  cancelDirectDrag();
  setActiveTool('select');
  activeElementId.value = null;
  board.onSetSelection(selection);
}

/**
 * 复制当前Widget选区。
 */
function copySelection(): void {
  board.onCopySelection();
}

/**
 * 合并当前Widget选区。
 */
function groupSelection(): void {
  board.onGroupSelection();
}

/**
 * 取消当前Widget选区中的组合。
 */
function ungroupSelection(): void {
  board.onUngroupSelection();
}

/**
 * 删除当前Widget选区。
 */
function deleteSelection(): void {
  board.onDeleteSelection();
}

/**
 * 调整当前Widget选区层级。
 * @param action - 层级操作
 */
function reorderSelection(action: WidgetLayerAction): void {
  board.onReorderSelection(action);
}

/**
 * 处理Widget滚轮缩放。
 * @param event - 滚轮事件
 */
function handleCanvasWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) {
    if (event.deltaX === 0 && event.deltaY === 0) {
      return;
    }

    const canvasSize = getCanvasSize();
    if (!canvasSize) {
      return;
    }

    event.preventDefault();
    viewport.panByClientDelta({ x: event.deltaX, y: event.deltaY }, canvasSize);
    return;
  }

  if (event.deltaY === 0) {
    return;
  }

  const projection = getCanvasPointProjection(event.clientX, event.clientY);

  event.preventDefault();
  if (event.deltaY < 0) {
    if (projection) {
      viewport.zoomInAt(projection);
      return;
    }

    viewport.zoomIn();
    return;
  }

  if (projection) {
    viewport.zoomOutAt(projection);
    return;
  }

  viewport.zoomOut();
}

/**
 * 判断键盘事件是否来自可编辑输入区域。
 * @param event - 键盘事件
 * @returns 是否来自输入区域
 */
function isKeyboardEventFromEditableTarget(event: KeyboardEvent): boolean {
  const { target } = event;
  if (!(target instanceof Element)) {
    return false;
  }

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.closest('[contenteditable="true"]') !== null
  );
}

/**
 * 判断Widget局部快捷键是否可响应当前键盘事件。
 * @param event - 键盘事件
 * @returns 是否允许响应Widget快捷键
 */
function canHandleWidgetShortcut(event: KeyboardEvent): boolean {
  const { target } = event;

  return target instanceof Element && rootRef.value?.contains(target) === true && !isKeyboardEventFromEditableTarget(event);
}

/**
 * 选中Widget中的全部元素。
 */
function selectAllWidgetElements(): void {
  board.onSetSelection(board.state.value.elements.map((element: WidgetElement): string => element.id));
}

/**
 * 注册Widget键盘快捷键。
 * @returns 取消快捷键注册的函数
 */
function registerWidgetKeyboardShortcuts(): () => void {
  return registerShortcuts([
    {
      key: 'Ctrl+Z',
      handler: board.onUndo,
      guard: canHandleWidgetShortcut
    },
    {
      key: 'Ctrl+Shift+Z',
      handler: board.onRedo,
      guard: canHandleWidgetShortcut
    },
    {
      key: 'Ctrl+Y',
      handler: board.onRedo,
      guard: canHandleWidgetShortcut
    },
    {
      key: 'Ctrl+A',
      handler: selectAllWidgetElements,
      guard: canHandleWidgetShortcut
    },
    {
      key: 'Delete',
      handler: interaction.deleteSelection,
      guard: canHandleWidgetShortcut
    },
    {
      key: 'Backspace',
      handler: interaction.deleteSelection,
      guard: canHandleWidgetShortcut
    }
  ]);
}

const unregisterWidgetKeyboardShortcuts = registerWidgetKeyboardShortcuts();

onBeforeUnmount((): void => {
  unregisterWidgetKeyboardShortcuts();
  cancelHandPan();
  cancelDirectDrag();
});

defineExpose<BWidgetExpose>({
  createElementFromClientPoint,
  selectElementById,
  selectElementsByIds,
  copySelection,
  groupSelection,
  ungroupSelection,
  deleteSelection,
  reorderSelection
});
</script>

<style lang="less" scoped>
.b-widget {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  outline: none;
}
</style>
