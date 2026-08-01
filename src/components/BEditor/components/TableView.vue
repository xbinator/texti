<template>
  <NodeViewWrapper :class="name">
    <div :class="[bem('viewport'), { 'is-cell-dragging': isDraggingCellSelection }]">
      <div ref="scrollerRef" :class="bem('scroller')" @mousedown="handleScrollerMouseDown" @mousemove="handleMouseMove" @scroll="handleScroll">
        <NodeViewContent as="table" :class="bem('table')" />
      </div>

      <!-- 焦点控制区 -->
      <div v-show="showControlOverlay" :class="bem('control-overlay')" contenteditable="false">
        <div v-show="showCornerControl" :class="bem('corner-control')" :style="cornerControlStyle"></div>
        <button
          v-for="control in columnControls"
          :key="`column-${control.index}`"
          type="button"
          :class="[
            bem('column-control'),
            {
              'is-first': control.isFirst,
              'is-last': control.isLast,
              'is-selected': selectedSegment?.type === 'column' && selectedSegment.index === control.index
            }
          ]"
          :style="control.style"
          title="选择列"
          aria-label="选择列"
          @mousedown.prevent
          @click="handleColumnControlClick(control.index)"
        ></button>
        <button
          v-for="control in rowControls"
          :key="`row-${control.index}`"
          type="button"
          :class="[
            bem('row-control'),
            {
              'is-first': control.isFirst,
              'is-last': control.isLast,
              'is-selected': selectedSegment?.type === 'row' && selectedSegment.index === control.index
            }
          ]"
          :style="control.style"
          title="选择行"
          aria-label="选择行"
          @mousedown.prevent
          @click="handleRowControlClick(control.index)"
        ></button>
        <button
          v-for="point in insertPoints"
          :key="point.id"
          type="button"
          :class="[bem('insert-point', point.hit.type), { 'is-active': isHoveredInsertPoint(point) }]"
          :style="point.style"
          :title="point.title"
          :aria-label="point.title"
          @mousedown.prevent
          @mouseenter="handleInsertPointEnter(point)"
          @mouseleave="scheduleHoveredInsertClear"
          @focus="handleInsertPointEnter(point)"
          @blur="scheduleHoveredInsertClear"
          @click="handleInsert(point.hit)"
        >
          <BIcon :class="bem('button-icon')" :icon="ICONS.add" />
        </button>
        <div v-show="showInsertGuide" :class="bem('insert-guide', hoveredInsert?.hit.type ?? 'column')" :style="insertGuideStyle"></div>
      </div>

      <!-- 区段 + 外侧格式工具条 -->
      <div v-show="showSegmentOverlay" :class="bem('segment-overlay')" contenteditable="false">
        <div v-show="selectedSegmentHover?.column" :class="bem('segment-highlight', 'column')" :style="columnSegmentHighlightStyle"></div>
        <div v-show="selectedSegmentHover?.row" :class="bem('segment-highlight', 'row')" :style="rowSegmentHighlightStyle"></div>
        <div v-show="showSegmentToolbar" :class="bem('segment-toolbar')" :style="selectedSegmentToolbarStyle">
          <button
            v-for="button in SEGMENT_FORMAT_BUTTONS"
            :key="button.command"
            type="button"
            :class="[bem('segment-toolbar-button'), { 'is-active': isSegmentFormatActive(button.command) }]"
            :title="button.title"
            :aria-label="button.title"
            @mousedown.prevent
            @click="handleSegmentFormat(button.command)"
          >
            <BIcon :class="bem('button-icon')" :icon="button.icon" />
          </button>
          <template v-if="showColumnAlignButtons">
            <div :class="bem('segment-toolbar-divider')"></div>
            <button
              v-for="button in SEGMENT_COLUMN_ALIGN_BUTTONS"
              :key="button.alignment"
              type="button"
              :class="[bem('segment-toolbar-button'), { 'is-active': isColumnAlignActive(button.alignment) }]"
              :title="button.title"
              :aria-label="button.title"
              @mousedown.prevent
              @click="handleColumnAlign(button.alignment)"
            >
              <BIcon :class="bem('button-icon')" :icon="button.icon" />
            </button>
          </template>
          <div :class="bem('segment-toolbar-divider')"></div>
          <button
            type="button"
            :class="[bem('segment-toolbar-button'), bem('segment-toolbar-button', 'danger')]"
            :title="selectedSegmentRemoveTitle"
            :aria-label="selectedSegmentRemoveTitle"
            @mousedown.prevent
            @click="handleSelectedSegmentRemove"
          >
            <BIcon :class="bem('button-icon')" :icon="ICONS.remove" />
          </button>
        </div>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
/**
 * @file TableView.vue
 * @description TipTap 表格 NodeView，负责富文本表格焦点控制区与行列删除。
 */

import type {
  DividerHit,
  DOMRectLike,
  SegmentActionPlacement,
  SegmentActionPlacementOptions,
  SegmentHit,
  SelectedTableSegment,
  TableCellGeometryRow
} from '../extensions/tableControlsGeometry';
import type { CSSProperties } from 'vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3';
import { createNamespace } from '@/utils/namespace';
import { applyAddAction, applyRemoveAction } from '../extensions/tableControlsCommands';
import {
  createLogicalColumnRects,
  createSelectedSegmentHover,
  getColumnSegmentActionPlacement,
  getRowSegmentActionPlacement
} from '../extensions/tableControlsGeometry';

const [name, bem] = createNamespace('', 'b-markdown-table');

// ─── 常量 ────────────────────────────────────────────────────────────────────

const props = defineProps(nodeViewProps);

const UI = {
  DRAG_SELECTION_THRESHOLD: 4,
  CONTROL_SIZE: 14,
  ACTION_OFFSET: 8,
  SEGMENT_ROW_TOOLBAR_WIDTH: 138,
  SEGMENT_COLUMN_TOOLBAR_WIDTH: 238,
  SEGMENT_TOOLBAR_HEIGHT: 38,
  GUIDE_THICKNESS: 2,
  OVERLAY_GUTTER: 0
} as const;

const ICONS = {
  add: 'mdi:plus',
  remove: 'mdi:trash-can-outline',
  bold: 'lucide:bold',
  italic: 'lucide:italic',
  strike: 'lucide:strikethrough',
  alignLeft: 'lucide:align-left',
  alignCenter: 'lucide:align-center',
  alignRight: 'lucide:align-right'
} as const;

const FALLBACK = {
  COLUMN_WIDTH: 120,
  ROW_HEIGHT: 40,
  ROW_COUNT: 3,
  COLUMN_COUNT: 3
} as const;

// ─── Refs ────────────────────────────────────────────────────────────────────

const scrollerRef = ref<HTMLElement | null>(null);

/**
 * 表格单元格的逻辑坐标。
 */
interface TableCellPosition {
  /** 行索引。 */
  row: number;
  /** 列索引。 */
  column: number;
}

/**
 * 当前拖拽选区状态。
 */
interface DragSelectionState {
  /** 拖拽起始单元格。 */
  anchor: TableCellPosition;
  /** 拖拽当前经过的单元格。 */
  head: TableCellPosition;
}

/**
 * 尚未跨过拖拽阈值时的候选拖拽状态。
 */
interface PendingDragState {
  /** 按下时命中的起始单元格。 */
  anchor: TableCellPosition;
  /** 鼠标按下时的起始坐标。 */
  startPointer: {
    clientX: number;
    clientY: number;
  };
}

/**
 * 行列控制区渲染项。
 */
interface TableControlItem {
  /** 控制区对应的行/列索引。 */
  index: number;
  /** 是否是当前控制条第一段。 */
  isFirst: boolean;
  /** 是否是当前控制条最后一段。 */
  isLast: boolean;
  /** 控制区定位样式。 */
  style: CSSProperties;
}

/**
 * 表格行列工具条支持的文本格式命令。
 */
type TableSegmentFormatAction = 'bold' | 'italic' | 'strike';

/**
 * 表格列工具条支持的列对齐方式。
 */
type TableColumnAlignment = 'left' | 'center' | 'right';

/**
 * 表格行列工具条格式按钮。
 */
interface TableSegmentFormatButton {
  /** 按钮对应的 TipTap 格式命令。 */
  command: TableSegmentFormatAction;
  /** Iconify 图标名称。 */
  icon: string;
  /** 按钮提示文案。 */
  title: string;
}

/**
 * 表格列对齐按钮。
 */
interface TableColumnAlignButton {
  /** 目标列对齐方式。 */
  alignment: TableColumnAlignment;
  /** Iconify 图标名称。 */
  icon: string;
  /** 按钮提示文案。 */
  title: string;
}

/**
 * 选中行列时展示的轻量格式按钮。
 */
const SEGMENT_FORMAT_BUTTONS: readonly TableSegmentFormatButton[] = [
  { command: 'bold', icon: ICONS.bold, title: '加粗' },
  { command: 'italic', icon: ICONS.italic, title: '斜体' },
  { command: 'strike', icon: ICONS.strike, title: '中划线' }
] as const;

/**
 * 选中列时展示的列对齐按钮。
 */
const SEGMENT_COLUMN_ALIGN_BUTTONS: readonly TableColumnAlignButton[] = [
  { alignment: 'left', icon: ICONS.alignLeft, title: '左对齐' },
  { alignment: 'center', icon: ICONS.alignCenter, title: '居中对齐' },
  { alignment: 'right', icon: ICONS.alignRight, title: '右对齐' }
] as const;

/**
 * 控制区新增按钮的插入位置。
 */
type InsertPlacement = 'before' | 'after';

/**
 * 当前控制区 hover 派生出的新增目标。
 */
interface InsertHoverState {
  /** 新增命令使用的分割线命中结果。 */
  hit: DividerHit;
  /** 用户当前靠近目标区段的前半段或后半段。 */
  placement: InsertPlacement;
}

/**
 * 表格常驻新增点渲染项。
 */
interface InsertPointItem {
  /** 渲染列表唯一标识。 */
  id: string;
  /** 新增命令使用的分割线命中结果。 */
  hit: DividerHit;
  /** 插入点对应前/后方向，用于 hover 状态表达。 */
  placement: InsertPlacement;
  /** 按钮提示文案。 */
  title: string;
  /** 插入点定位样式。 */
  style: CSSProperties;
}

/**
 * 单元格选区在表格映射中的矩形范围。
 */
interface TableSelectionRect {
  /** 左侧逻辑列索引。 */
  left: number;
  /** 右侧逻辑列索引（开区间）。 */
  right: number;
  /** 顶部逻辑行索引。 */
  top: number;
  /** 底部逻辑行索引（开区间）。 */
  bottom: number;
}

// ─── 控制区状态 ─────────────────────────────────────────────────────────────

const isTableFocused = ref(false);
const selectedSegment = ref<SelectedTableSegment | null>(null);
const hoveredInsert = ref<InsertHoverState | null>(null);
const tableGeometry = ref<{ columnRects: DOMRectLike[]; rowRects: DOMRectLike[] }>({ columnRects: [], rowRects: [] });
const lastPointer = ref<{ clientX: number; clientY: number } | null>(null);
const dragSelection = ref<DragSelectionState | null>(null);
const pendingDrag = ref<PendingDragState | null>(null);

let scrollFrame = 0;
let geometryRefreshFrame = 0;
let insertHideTimer = 0;
let isComponentUnmounted = false;

/**
 * 清空当前选中的删除目标。
 */
function clearSelectedSegment(): void {
  selectedSegment.value = null;
}

/**
 * 取消新增按钮的延迟隐藏。
 */
function cancelHoveredInsertClear(): void {
  if (insertHideTimer !== 0) {
    window.clearTimeout(insertHideTimer);
    insertHideTimer = 0;
  }
}

/**
 * 取消等待中的表格几何刷新。
 */
function cancelTableGeometryRefresh(): void {
  if (geometryRefreshFrame !== 0) {
    cancelAnimationFrame(geometryRefreshFrame);
    geometryRefreshFrame = 0;
  }
}

/**
 * 清空当前 hover 派生出的新增目标。
 */
function clearHoveredInsert(): void {
  cancelHoveredInsertClear();
  hoveredInsert.value = null;
}

/**
 * 延迟隐藏新增按钮，给鼠标从控制条移动到外侧按钮留出缓冲。
 */
function scheduleHoveredInsertClear(): void {
  cancelHoveredInsertClear();
  insertHideTimer = window.setTimeout(() => {
    insertHideTimer = 0;
    hoveredInsert.value = null;
  }, 120);
}

// ─── 几何计算 ────────────────────────────────────────────────────────────────

/**
 * 将视口矩形转换为相对 scroller 内容区域的局部坐标。
 */
function toLocalRect(rect: DOMRect, scrollerRect: DOMRect, scroller: HTMLElement): DOMRectLike {
  return {
    top: rect.top - scrollerRect.top + scroller.scrollTop,
    right: rect.right - scrollerRect.left + scroller.scrollLeft,
    bottom: rect.bottom - scrollerRect.top + scroller.scrollTop,
    left: rect.left - scrollerRect.left + scroller.scrollLeft,
    width: rect.width,
    height: rect.height
  };
}

/**
 * 测试/空内容场景下的回退几何。
 */
function createFallbackGeometry(): { columnRects: DOMRectLike[]; rowRects: DOMRectLike[] } {
  const { COLUMN_WIDTH, ROW_HEIGHT, ROW_COUNT, COLUMN_COUNT } = FALLBACK;

  const columnRects = Array.from({ length: COLUMN_COUNT }, (_, i) => ({
    top: 0,
    bottom: ROW_HEIGHT * ROW_COUNT,
    left: i * COLUMN_WIDTH,
    right: (i + 1) * COLUMN_WIDTH,
    width: COLUMN_WIDTH,
    height: ROW_HEIGHT * ROW_COUNT
  }));

  const rowRects = Array.from({ length: ROW_COUNT }, (_, i) => ({
    top: i * ROW_HEIGHT,
    bottom: (i + 1) * ROW_HEIGHT,
    left: 0,
    right: COLUMN_WIDTH * COLUMN_COUNT,
    width: COLUMN_WIDTH * COLUMN_COUNT,
    height: ROW_HEIGHT
  }));

  return { columnRects, rowRects };
}

/**
 * 读取单元格跨列数量，避免首行合并单元格把逻辑列控制点带偏。
 * @param cell - 表格单元格元素
 * @returns 至少为 1 的跨列数量
 */
function getCellColSpan(cell: Element): number {
  if (cell instanceof HTMLTableCellElement) {
    return Math.max(1, cell.colSpan || 1);
  }

  const parsedColSpan = Number.parseInt(cell.getAttribute('colspan') ?? '1', 10);
  return Number.isFinite(parsedColSpan) ? Math.max(1, parsedColSpan) : 1;
}

/**
 * 读取单元格跨行数量，用于跳过被上一行跨行单元格占用的逻辑列。
 * @param cell - 表格单元格元素
 * @returns 至少为 1 的跨行数量
 */
function getCellRowSpan(cell: Element): number {
  if (cell instanceof HTMLTableCellElement) {
    return Math.max(1, cell.rowSpan || 1);
  }

  const parsedRowSpan = Number.parseInt(cell.getAttribute('rowspan') ?? '1', 10);
  return Number.isFinite(parsedRowSpan) ? Math.max(1, parsedRowSpan) : 1;
}

/**
 * 将 DOM 表格行转换为纯数据单元格几何，便于几何模块计算逻辑列。
 * @param rows - 表格行元素列表
 * @param toLocal - DOM 元素到局部矩形的转换函数
 * @returns 单元格几何行
 */
function readCellGeometryRows(rows: Element[], toLocal: (el: Element) => DOMRectLike): TableCellGeometryRow[] {
  return rows.map((row) => {
    return Array.from(row.querySelectorAll('th,td')).map((cell) => {
      const cellRect = toLocal(cell);
      return {
        left: cellRect.left,
        right: cellRect.right,
        width: cellRect.width,
        colSpan: getCellColSpan(cell),
        rowSpan: getCellRowSpan(cell)
      };
    });
  });
}

/**
 * 读取全表逻辑列矩形，列高度拉伸到整个表格范围。
 * @param rows - 表格行元素列表
 * @param scroller - 表格滚动容器
 * @param scrollerRect - 滚动容器视口矩形
 * @returns 逻辑列矩形列表
 */
function readColumnRects(rows: Element[], scroller: HTMLElement, scrollerRect: DOMRect): DOMRectLike[] {
  if (rows.length === 0) return [];

  const toLocal = (el: Element) => toLocalRect(el.getBoundingClientRect(), scrollerRect, scroller);
  const rowRects = rows.map(toLocal);
  const tableTop = rowRects[0]?.top ?? 0;
  const tableBottom = rowRects[rowRects.length - 1]?.bottom ?? 0;

  return createLogicalColumnRects(readCellGeometryRows(rows, toLocal), tableTop, tableBottom);
}

/**
 * 读取当前表格的行列几何，DOM 读取失败时降级为 fallback。
 */
function readTableGeometry(): { columnRects: DOMRectLike[]; rowRects: DOMRectLike[] } {
  const scroller = scrollerRef.value;
  const tableElement = scroller?.querySelector('table');

  if (!scroller || !(tableElement instanceof HTMLTableElement)) {
    return createFallbackGeometry();
  }

  const scrollerRect = scroller.getBoundingClientRect();
  const toLocal = (el: Element) => toLocalRect(el.getBoundingClientRect(), scrollerRect, scroller);
  const rows = Array.from(tableElement.querySelectorAll('tr'));
  const rowRects = rows.map(toLocal);
  const columnRects = readColumnRects(rows, scroller, scrollerRect);

  if (rowRects.length === 0 || columnRects.length === 0) {
    return createFallbackGeometry();
  }

  return { columnRects, rowRects };
}

/**
 * 读取当前表格下的所有可命中单元格。
 * @returns 单元格节点列表
 */
function getTableCells(): HTMLTableCellElement[] {
  const tableElement = scrollerRef.value?.querySelector('table');
  if (!(tableElement instanceof HTMLTableElement)) {
    return [];
  }

  return Array.from(tableElement.querySelectorAll('th,td')).filter((cell): cell is HTMLTableCellElement => cell instanceof HTMLTableCellElement);
}

/**
 * 根据指针坐标命中当前表格中的单元格。
 * @param clientX - 视口横坐标
 * @param clientY - 视口纵坐标
 * @returns 命中的单元格；未命中时返回 null
 */
function findCellElementByPoint(clientX: number, clientY: number): HTMLTableCellElement | null {
  return (
    getTableCells().find((cell) => {
      const rect = cell.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    }) ?? null
  );
}

/**
 * 计算单元格在当前行中的逻辑列索引。
 * 简单表格下直接累加前序单元格的 `colSpan`，兼容基础跨列场景。
 * @param cell - 当前单元格
 * @returns 逻辑列索引；无法定位时返回 null
 */
function getCellColumnIndex(cell: HTMLTableCellElement): number | null {
  const row = cell.parentElement;
  if (!(row instanceof HTMLTableRowElement)) {
    return null;
  }

  let columnIndex = 0;
  for (const currentCell of Array.from(row.cells)) {
    if (currentCell === cell) {
      return columnIndex;
    }
    columnIndex += currentCell.colSpan || 1;
  }

  return null;
}

/**
 * 读取单元格在表格中的逻辑坐标。
 * @param cell - 当前单元格
 * @returns 行列坐标；无法定位时返回 null
 */
function getCellPosition(cell: HTMLTableCellElement): TableCellPosition | null {
  const row = cell.parentElement;
  if (!(row instanceof HTMLTableRowElement) || row.sectionRowIndex < 0) {
    return null;
  }

  const column = getCellColumnIndex(cell);
  if (column === null) {
    return null;
  }

  return {
    row: row.sectionRowIndex,
    column
  };
}

/**
 * 从当前事件或指针坐标中解析命中的单元格位置。
 * @param target - 事件目标
 * @param clientX - 视口横坐标
 * @param clientY - 视口纵坐标
 * @returns 命中的单元格位置；未命中时返回 null
 */
function resolveCellPosition(target: EventTarget | null, clientX: number, clientY: number): TableCellPosition | null {
  const targetCell = target instanceof Element ? target.closest('th,td') : null;
  if (targetCell instanceof HTMLTableCellElement && scrollerRef.value?.contains(targetCell)) {
    return getCellPosition(targetCell);
  }

  const pointedCell = findCellElementByPoint(clientX, clientY);
  return pointedCell ? getCellPosition(pointedCell) : null;
}

/**
 * 判断两个单元格坐标是否相同。
 * @param first - 第一个坐标
 * @param second - 第二个坐标
 * @returns 完全相同时返回 true
 */
function isSameCellPosition(first: TableCellPosition, second: TableCellPosition): boolean {
  return first.row === second.row && first.column === second.column;
}

/**
 * 判断当前位置是否已经跨过拖拽阈值。
 * @param startPointer - 鼠标按下时的起始坐标
 * @param clientX - 当前横坐标
 * @param clientY - 当前纵坐标
 * @returns 超过阈值时返回 true
 */
function hasExceededDragThreshold(startPointer: { clientX: number; clientY: number }, clientX: number, clientY: number): boolean {
  return Math.abs(clientX - startPointer.clientX) >= UI.DRAG_SELECTION_THRESHOLD || Math.abs(clientY - startPointer.clientY) >= UI.DRAG_SELECTION_THRESHOLD;
}

// ─── 编辑器操作 ──────────────────────────────────────────────────────────────

/**
 * 读取当前 NodeView 对应表格在文档中的起始位置。
 * @returns 表格起始位置，无法定位时返回 null
 */
function getCurrentTablePos(): number | null {
  if (typeof props.getPos !== 'function') {
    return null;
  }

  const position = props.getPos();
  return typeof position === 'number' ? position : null;
}

/**
 * 读取当前 NodeView 对应表格的映射信息。
 * @returns 当前表格的 TableMap 与起始位置
 */
function getCurrentTableMap(): { map: TableMap; tablePos: number } | null {
  const tablePos = getCurrentTablePos();
  if (tablePos === null || props.node.type.name !== 'table') {
    return null;
  }

  return {
    map: TableMap.get(props.node),
    tablePos
  };
}

/**
 * 刷新当前表格的几何快照。
 */
function refreshTableGeometry(): void {
  tableGeometry.value = readTableGeometry();
}

/**
 * 在 Vue 与浏览器布局完成后刷新表格几何，避免新增行列后控制区使用旧矩形。
 */
function scheduleTableGeometryRefresh(): void {
  nextTick(() => {
    if (isComponentUnmounted) return;

    cancelTableGeometryRefresh();
    geometryRefreshFrame = requestAnimationFrame(() => {
      geometryRefreshFrame = 0;
      refreshTableGeometry();
    });
  }).catch(() => undefined);
}

/**
 * 判断当前编辑器选区是否落在这个表格 NodeView 内。
 */
function isSelectionInsideCurrentTable(): boolean {
  const tablePos = getCurrentTablePos();
  if (tablePos === null) {
    return false;
  }

  const { selection } = props.editor.state;
  const tableEnd = tablePos + props.node.nodeSize;
  return selection.from >= tablePos && selection.to <= tableEnd;
}

/**
 * 读取单元格选区在当前表格映射中的矩形范围。
 * @param selection - 当前单元格选区
 * @param tableState - 当前表格映射信息
 * @returns 单元格选区矩形；选区不属于当前表格时返回 null
 */
function getCellSelectionRect(selection: CellSelection, tableState: { map: TableMap; tablePos: number }): TableSelectionRect | null {
  const anchorCell = selection.$anchorCell.pos - tableState.tablePos - 1;
  const headCell = selection.$headCell.pos - tableState.tablePos - 1;
  if (anchorCell < 0 || headCell < 0) {
    return null;
  }

  return tableState.map.rectBetween(anchorCell, headCell);
}

/**
 * 判断当前单元格选区是否仍然匹配控制区选中的整行或整列。
 * @param selection - 当前单元格选区
 * @param segment - 控制区选中的行或列
 * @returns 选区仍覆盖同一个整行/整列时返回 true
 */
function isCellSelectionMatchingSelectedSegment(selection: CellSelection, segment: SelectedTableSegment): boolean {
  const tableState = getCurrentTableMap();
  if (!tableState) {
    return false;
  }

  const rect = getCellSelectionRect(selection, tableState);
  if (!rect) {
    return false;
  }

  if (segment.type === 'column') {
    return rect.left === segment.index && rect.right === segment.index + 1 && rect.top === 0 && rect.bottom === tableState.map.height;
  }

  return rect.top === segment.index && rect.bottom === segment.index + 1 && rect.left === 0 && rect.right === tableState.map.width;
}

/**
 * 同步表格焦点态，并在离开表格时清空删除目标。
 */
function syncTableFocusState(): void {
  const isFocused = props.editor.isFocused && isSelectionInsideCurrentTable();
  isTableFocused.value = isFocused;

  if (!isFocused) {
    clearSelectedSegment();
    clearHoveredInsert();
    return;
  }

  refreshTableGeometry();
  const { selection } = props.editor.state;
  if (!(selection instanceof CellSelection)) {
    clearSelectedSegment();
    return;
  }

  if (selectedSegment.value && !isCellSelectionMatchingSelectedSegment(selection, selectedSegment.value)) {
    clearSelectedSegment();
  }
}

/**
 * 聚焦到当前表格中的目标单元格。
 */
function focusCellAt(position: { row: number; column: number }): boolean {
  const { tr, doc } = props.editor.state;
  const tableState = getCurrentTableMap();
  if (!tableState) return false;

  const row = Math.min(position.row, tableState.map.height - 1);
  const column = Math.min(position.column, tableState.map.width - 1);
  const cellPos = tableState.tablePos + 1 + tableState.map.map[row * tableState.map.width + column];

  props.editor.view.dispatch(tr.setSelection(TextSelection.near(doc.resolve(cellPos + 1))));
  return true;
}

/**
 * 选中指定列的全部单元格。
 * @param columnIndex - 目标列索引
 * @returns 是否成功选中列
 */
function selectColumnAt(columnIndex: number): boolean {
  const tableState = getCurrentTableMap();
  if (!tableState) return false;

  const column = Math.min(Math.max(columnIndex, 0), tableState.map.width - 1);
  const firstCell = tableState.tablePos + 1 + tableState.map.map[column];
  const lastCell = tableState.tablePos + 1 + tableState.map.map[(tableState.map.height - 1) * tableState.map.width + column];
  const { doc, tr } = props.editor.state;
  props.editor.view.dispatch(tr.setSelection(CellSelection.create(doc, firstCell, lastCell)));
  return true;
}

/**
 * 选中指定行的全部单元格。
 * @param rowIndex - 目标行索引
 * @returns 是否成功选中行
 */
function selectRowAt(rowIndex: number): boolean {
  const tableState = getCurrentTableMap();
  if (!tableState) return false;

  const row = Math.min(Math.max(rowIndex, 0), tableState.map.height - 1);
  const firstCell = tableState.tablePos + 1 + tableState.map.map[row * tableState.map.width];
  const lastCell = tableState.tablePos + 1 + tableState.map.map[row * tableState.map.width + tableState.map.width - 1];
  const { doc, tr } = props.editor.state;
  props.editor.view.dispatch(tr.setSelection(CellSelection.create(doc, firstCell, lastCell)));
  return true;
}

/**
 * 根据新增点 hover 更新当前新增目标。
 * @param point - 当前 hover 的新增点
 */
function handleInsertPointEnter(point: InsertPointItem): void {
  cancelHoveredInsertClear();
  hoveredInsert.value = {
    hit: point.hit,
    placement: point.placement
  };
}

/**
 * 判断两个分割线命中是否表示同一个插入点。
 * @param first - 第一个分割线命中
 * @param second - 第二个分割线命中
 * @returns 两者一致时返回 true
 */
function isSameDividerHit(first: DividerHit, second: DividerHit): boolean {
  return first.type === second.type && first.index === second.index && first.edge === second.edge;
}

/**
 * 判断新增点是否处于当前 hover 状态。
 * @param point - 待判断的新增点
 * @returns 当前点处于 hover 时返回 true
 */
function isHoveredInsertPoint(point: InsertPointItem): boolean {
  const hit = hoveredInsert.value?.hit ?? null;
  return hit ? isSameDividerHit(hit, point.hit) : false;
}

/**
 * 点击列控制区时选中列并显示删除按钮。
 * @param index - 列索引
 */
function handleColumnControlClick(index: number): void {
  refreshTableGeometry();
  if (!selectColumnAt(index)) return;
  selectedSegment.value = { type: 'column', index };
}

/**
 * 点击行控制区时选中行并显示删除按钮。
 * @param index - 行索引
 */
function handleRowControlClick(index: number): void {
  refreshTableGeometry();
  if (!selectRowAt(index)) return;
  selectedSegment.value = { type: 'row', index };
}

/**
 * 恢复当前行列工具条对应的整行/整列选区。
 * @returns 是否成功恢复选区
 */
function restoreSelectedSegmentSelection(): boolean {
  const segment = selectedSegment.value;
  if (!segment) {
    return false;
  }

  return segment.type === 'column' ? selectColumnAt(segment.index) : selectRowAt(segment.index);
}

/**
 * 判断格式命令在当前选区中是否处于激活状态。
 * @param command - 文本格式命令
 * @returns 当前格式是否激活
 */
function isSegmentFormatActive(command: TableSegmentFormatAction): boolean {
  return props.editor.isActive(command);
}

/**
 * 判断列对齐方式是否处于当前激活状态。
 * @param alignment - 目标列对齐方式
 * @returns 当前列是否使用该对齐方式
 */
function isColumnAlignActive(alignment: TableColumnAlignment): boolean {
  return props.editor.isActive('tableCell', { align: alignment }) || props.editor.isActive('tableHeader', { align: alignment });
}

/**
 * 读取指定单元格的文档位置。
 * @param position - 单元格逻辑坐标
 * @returns 单元格位置；无法定位时返回 null
 */
function getCellDocumentPosition(position: TableCellPosition): number | null {
  const tableState = getCurrentTableMap();
  if (!tableState) {
    return null;
  }

  const row = Math.min(position.row, tableState.map.height - 1);
  const column = Math.min(position.column, tableState.map.width - 1);
  return tableState.tablePos + 1 + tableState.map.map[row * tableState.map.width + column];
}

/**
 * 将当前拖拽范围同步为矩形单元格选区。
 * @param anchor - 起始单元格
 * @param head - 当前单元格
 * @returns 是否成功更新选区
 */
function setDraggedCellSelection(anchor: TableCellPosition, head: TableCellPosition): boolean {
  const anchorPos = getCellDocumentPosition(anchor);
  const headPos = getCellDocumentPosition(head);
  if (anchorPos === null || headPos === null) {
    return false;
  }

  const { doc, tr } = props.editor.state;
  props.editor.view.dispatch(tr.setSelection(CellSelection.create(doc, anchorPos, headPos)).scrollIntoView());
  return true;
}

/**
 * 开始表格拖拽选区。
 * @param event - 鼠标按下事件
 */
function handleScrollerMouseDown(event: MouseEvent): void {
  if (!props.editor.isEditable || event.button !== 0) {
    return;
  }

  const position = resolveCellPosition(event.target, event.clientX, event.clientY);
  if (!position) {
    return;
  }

  isTableFocused.value = true;
  clearSelectedSegment();
  clearHoveredInsert();
  refreshTableGeometry();
  lastPointer.value = { clientX: event.clientX, clientY: event.clientY };
  pendingDrag.value = {
    anchor: position,
    startPointer: {
      clientX: event.clientX,
      clientY: event.clientY
    }
  };
}

/**
 * 按当前鼠标位置扩展拖拽选区。
 * @param target - 当前事件目标
 * @param clientX - 视口横坐标
 * @param clientY - 视口纵坐标
 */
function updateDragSelection(target: EventTarget | null, clientX: number, clientY: number): void {
  const currentDrag = dragSelection.value;
  if (!currentDrag) {
    return;
  }

  const position = resolveCellPosition(target, clientX, clientY);
  if (!position || isSameCellPosition(position, currentDrag.head)) {
    return;
  }

  dragSelection.value = {
    anchor: currentDrag.anchor,
    head: position
  };
  setDraggedCellSelection(currentDrag.anchor, position);
}

/**
 * 结束当前拖拽选区。
 */
function stopDragSelection(): void {
  dragSelection.value = null;
  pendingDrag.value = null;
}

/**
 * 清理浏览器原生文字选区，避免表格矩形拖拽时同时出现文本选中。
 */
function clearDomTextSelection(): void {
  window.getSelection()?.removeAllRanges();
}

/**
 * 处理表格内部鼠标移动。
 * 拖拽时优先扩展单元格选区，未跨过阈值时保持候选拖拽状态。
 * @param event - 当前鼠标移动事件
 */
function handleMouseMove(event: MouseEvent): void {
  lastPointer.value = { clientX: event.clientX, clientY: event.clientY };
  if (dragSelection.value) {
    updateDragSelection(event.target, event.clientX, event.clientY);
    return;
  }

  const currentPendingDrag = pendingDrag.value;
  if (currentPendingDrag) {
    if ((event.buttons & 1) === 0) {
      pendingDrag.value = null;
    } else {
      const currentCellPosition = resolveCellPosition(event.target, event.clientX, event.clientY);
      const hasExceededThreshold = hasExceededDragThreshold(currentPendingDrag.startPointer, event.clientX, event.clientY);
      const hasCrossedIntoAnotherCell = currentCellPosition !== null && !isSameCellPosition(currentCellPosition, currentPendingDrag.anchor);

      if (hasExceededThreshold && hasCrossedIntoAnotherCell) {
        clearSelectedSegment();
        clearDomTextSelection();
        dragSelection.value = {
          anchor: currentPendingDrag.anchor,
          head: currentPendingDrag.anchor
        };
        pendingDrag.value = null;
        updateDragSelection(event.target, event.clientX, event.clientY);
      }
    }
  }
}

/**
 * 拖拽期间在窗口范围内继续扩展单元格选区。
 * @param event - 当前全局鼠标移动事件
 */
function handleWindowMouseMove(event: MouseEvent): void {
  lastPointer.value = { clientX: event.clientX, clientY: event.clientY };
  if (dragSelection.value) {
    updateDragSelection(event.target, event.clientX, event.clientY);
  }
}

/**
 * 滚动时用 rAF 节流，刷新控制区几何。
 */
function handleScroll(): void {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    clearHoveredInsert();
    refreshTableGeometry();
  });
}

/**
 * 读取当前 NodeView 对应表格的行列数。
 */
function getDimensions(): { rowCount: number; columnCount: number } {
  const tableState = getCurrentTableMap();
  if (!tableState) return { rowCount: FALLBACK.ROW_COUNT, columnCount: FALLBACK.COLUMN_COUNT };

  return { rowCount: tableState.map.height, columnCount: tableState.map.width };
}

const editorContext = { editor: props.editor, focusCellAt, getDimensions };

/**
 * 对当前选中的列设置对齐方式。
 * @param alignment - 目标列对齐方式
 */
function handleColumnAlign(alignment: TableColumnAlignment): void {
  if (selectedSegment.value?.type !== 'column' || !restoreSelectedSegmentSelection()) {
    return;
  }

  props.editor.chain().focus().setCellAttribute('align', alignment).run();
}

/**
 * 对当前选中的行或列执行文本格式命令。
 * @param command - 文本格式命令
 */
function handleSegmentFormat(command: TableSegmentFormatAction): void {
  if (!restoreSelectedSegmentSelection()) {
    return;
  }

  const chain = props.editor.chain().focus();
  switch (command) {
    case 'bold':
      chain.toggleBold().run();
      break;
    case 'italic':
      chain.toggleItalic().run();
      break;
    case 'strike':
      chain.toggleStrike().run();
      break;
    default:
      break;
  }
}

/**
 * 执行删除动作。
 * @param hit - 当前选中的行或列命中结果
 */
function handleRemove(hit: SegmentHit | null): void {
  if (hit && applyRemoveAction(editorContext, hit)) {
    scheduleTableGeometryRefresh();
  }
  clearSelectedSegment();
}

/**
 * 执行新增动作，按当前 hover 分割线插入行/列。
 * @param hit - 当前 hover 派生出的分割线
 */
function handleInsert(hit: DividerHit | null): void {
  if (hit && applyAddAction(editorContext, hit)) {
    scheduleTableGeometryRefresh();
  }
  clearSelectedSegment();
  clearHoveredInsert();
}

// ─── 样式计算 ────────────────────────────────────────────────────────────────

/**
 * 将内容坐标投影到可见视口坐标，供外层 overlay 使用。
 */
function toViewportPosition(position: { top: number; left: number }): { top: number; left: number } {
  const scroller = scrollerRef.value;
  if (!scroller) return position;
  return {
    top: position.top - scroller.scrollTop + UI.OVERLAY_GUTTER,
    left: position.left - scroller.scrollLeft + UI.OVERLAY_GUTTER
  };
}

/**
 * 将内容矩形转换为可视视口样式。
 * @param rect - 内容坐标矩形
 * @returns 绝对定位样式
 */
function toViewportRectStyle(rect: DOMRectLike): CSSProperties {
  const vp = toViewportPosition({ top: rect.top, left: rect.left });
  return {
    top: `${vp.top}px`,
    left: `${vp.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`
  };
}

/**
 * 根据列矩形生成顶部控制区样式。
 * @param rect - 列矩形
 * @returns 控制区定位样式
 */
function getColumnControlStyle(rect: DOMRectLike): CSSProperties {
  const vp = toViewportPosition({ top: rect.top, left: rect.left });
  return {
    top: `${vp.top - UI.CONTROL_SIZE}px`,
    left: `${vp.left}px`,
    width: `${rect.width}px`,
    height: `${UI.CONTROL_SIZE}px`
  };
}

/**
 * 根据行矩形生成左侧控制区样式。
 * @param rect - 行矩形
 * @returns 控制区定位样式
 */
function getRowControlStyle(rect: DOMRectLike): CSSProperties {
  const vp = toViewportPosition({ top: rect.top, left: rect.left });
  return {
    top: `${vp.top}px`,
    left: `${vp.left - UI.CONTROL_SIZE}px`,
    width: `${UI.CONTROL_SIZE}px`,
    height: `${rect.height}px`
  };
}

/**
 * 将内容坐标转换为绝对定位样式。
 * @param position - 内容坐标
 * @returns 可直接绑定到 overlay 元素的定位样式
 */
function toViewportStyle(position: { top: number; left: number }): CSSProperties {
  const vp = toViewportPosition(position);
  return { top: `${vp.top}px`, left: `${vp.left}px` };
}

/**
 * 将删除浮层定位转换为可绑定样式，保留几何模块给出的 transform。
 * @param placement - 删除浮层定位结果
 * @returns 可直接绑定到 overlay 元素的定位样式
 */
function toViewportActionStyle(placement: SegmentActionPlacement): CSSProperties {
  const vp = toViewportPosition({ top: placement.top, left: placement.left });
  return {
    top: `${vp.top}px`,
    left: `${vp.left}px`,
    transform: placement.transform
  };
}

/**
 * 读取 overlay 起点到浏览器视口起点的距离，用于决定删除浮层是否有真实外侧空间。
 * @param axis - 需要判断的轴向
 * @returns 删除浮层定位配置
 */
function getSegmentActionPlacementOptions(axis: 'x' | 'y'): SegmentActionPlacementOptions {
  const scrollerRect = scrollerRef.value?.getBoundingClientRect();
  const viewportStartOffset = axis === 'x' ? scrollerRect?.left ?? 0 : scrollerRect?.top ?? 0;
  const toolbarWidth = selectedSegment.value?.type === 'column' ? UI.SEGMENT_COLUMN_TOOLBAR_WIDTH : UI.SEGMENT_ROW_TOOLBAR_WIDTH;

  return {
    controlSize: UI.CONTROL_SIZE,
    actionOffset: UI.ACTION_OFFSET,
    actionGroupSize: axis === 'x' ? toolbarWidth : UI.SEGMENT_TOOLBAR_HEIGHT,
    viewportStartOffset: Math.max(0, viewportStartOffset)
  };
}

/**
 * 生成控制条渲染项并标记首尾段。
 * @param rects - 行/列几何列表
 * @param getStyle - 单段控制条样式生成函数
 * @returns 控制条渲染项
 */
function createControlItems(rects: DOMRectLike[], getStyle: (rect: DOMRectLike) => CSSProperties): TableControlItem[] {
  const lastIndex = rects.length - 1;
  return rects.map((rect, index) => ({
    index,
    isFirst: index === 0,
    isLast: index === lastIndex,
    style: getStyle(rect)
  }));
}

const columnControls = computed<TableControlItem[]>(() => createControlItems(tableGeometry.value.columnRects, getColumnControlStyle));

const rowControls = computed<TableControlItem[]>(() => createControlItems(tableGeometry.value.rowRects, getRowControlStyle));

/**
 * 创建列方向的所有插入分割线。
 * @param rects - 当前列几何列表
 * @returns 列插入分割线列表
 */
function createColumnDividerHits(rects: DOMRectLike[]): DividerHit[] {
  const first = rects[0];
  if (!first) return [];

  const createLine = (axis: number, index: number, edge: DividerHit['edge']): DividerHit => ({
    type: 'column',
    index,
    edge,
    lineRect: {
      top: first.top,
      right: axis,
      bottom: first.bottom,
      left: axis,
      width: 0,
      height: first.bottom - first.top
    }
  });

  const hits = [createLine(first.left, 0, 'leading')];
  for (let index = 1; index < rects.length; index++) {
    hits.push(createLine(rects[index - 1].right, index, 'inner'));
  }

  const lastIndex = rects.length - 1;
  hits.push(createLine(rects[lastIndex].right, lastIndex, 'trailing'));
  return hits;
}

/**
 * 创建行方向的所有插入分割线。
 * @param rects - 当前行几何列表
 * @returns 行插入分割线列表
 */
function createRowDividerHits(rects: DOMRectLike[]): DividerHit[] {
  const first = rects[0];
  if (!first) return [];

  const createLine = (axis: number, index: number, edge: DividerHit['edge']): DividerHit => ({
    type: 'row',
    index,
    edge,
    lineRect: {
      top: axis,
      right: first.right,
      bottom: axis,
      left: first.left,
      width: first.right - first.left,
      height: 0
    }
  });

  const hits = [createLine(first.top, 0, 'leading')];
  for (let index = 1; index < rects.length; index++) {
    hits.push(createLine(rects[index - 1].bottom, index, 'inner'));
  }

  const lastIndex = rects.length - 1;
  hits.push(createLine(rects[lastIndex].bottom, lastIndex, 'trailing'));
  return hits;
}

/**
 * 读取插入点对应的前后方向。
 * @param hit - 分割线命中结果
 * @returns 插入方向
 */
function getInsertPointPlacement(hit: DividerHit): InsertPlacement {
  return hit.edge === 'leading' ? 'before' : 'after';
}

/**
 * 生成插入点提示文案。
 * @param hit - 分割线命中结果
 * @returns 提示文案
 */
function getInsertPointTitle(hit: DividerHit): string {
  if (hit.type === 'column') {
    if (hit.edge === 'leading') return '在左侧新增列';
    if (hit.edge === 'trailing') return '在右侧新增列';
    return '在此处新增列';
  }

  if (hit.edge === 'leading') return '在上方新增行';
  if (hit.edge === 'trailing') return '在下方新增行';
  return '在此处新增行';
}

/**
 * 根据插入分割线生成常驻点定位样式。
 * @param hit - 分割线命中结果
 * @returns 插入点样式
 */
function getInsertPointStyle(hit: DividerHit): CSSProperties {
  if (hit.type === 'column') {
    return toViewportStyle({
      top: hit.lineRect.top - UI.CONTROL_SIZE / 2,
      left: hit.lineRect.left
    });
  }

  return toViewportStyle({
    top: hit.lineRect.top,
    left: hit.lineRect.left - UI.CONTROL_SIZE / 2
  });
}

/**
 * 将分割线命中结果转换为插入点渲染项。
 * @param hit - 分割线命中结果
 * @returns 插入点渲染项
 */
function createInsertPointItem(hit: DividerHit): InsertPointItem {
  return {
    id: `${hit.type}-${hit.edge}-${hit.index}`,
    hit,
    placement: getInsertPointPlacement(hit),
    title: getInsertPointTitle(hit),
    style: getInsertPointStyle(hit)
  };
}

/**
 * 生成表格所有可插入位置的常驻点。
 * @param columnRects - 列几何列表
 * @param rowRects - 行几何列表
 * @returns 插入点渲染列表
 */
function createInsertPoints(columnRects: DOMRectLike[], rowRects: DOMRectLike[]): InsertPointItem[] {
  return [...createColumnDividerHits(columnRects), ...createRowDividerHits(rowRects)].map(createInsertPointItem);
}

const insertPoints = computed<InsertPointItem[]>(() => createInsertPoints(tableGeometry.value.columnRects, tableGeometry.value.rowRects));

const selectedSegmentHover = computed(() => createSelectedSegmentHover(selectedSegment.value, tableGeometry.value.columnRects, tableGeometry.value.rowRects));

const selectedSegmentHit = computed<SegmentHit | null>(() => selectedSegmentHover.value?.column ?? selectedSegmentHover.value?.row ?? null);

/**
 * 删除当前工具条所绑定的行或列。
 */
function handleSelectedSegmentRemove(): void {
  handleRemove(selectedSegmentHit.value);
}

const cornerControlStyle = computed<CSSProperties | null>(() => {
  const firstColumn = tableGeometry.value.columnRects[0];
  const firstRow = tableGeometry.value.rowRects[0];
  if (!firstColumn || !firstRow) return null;

  const vp = toViewportPosition({
    top: firstRow.top - UI.CONTROL_SIZE,
    left: firstColumn.left - UI.CONTROL_SIZE
  });

  return {
    top: `${vp.top}px`,
    left: `${vp.left}px`,
    width: `${UI.CONTROL_SIZE}px`,
    height: `${UI.CONTROL_SIZE}px`
  };
});

const columnSegmentHighlightStyle = computed<CSSProperties>(() => {
  const hit = selectedSegmentHover.value?.column ?? null;
  return hit ? toViewportRectStyle(hit.segmentRect) : {};
});

const rowSegmentHighlightStyle = computed<CSSProperties>(() => {
  const hit = selectedSegmentHover.value?.row ?? null;
  return hit ? toViewportRectStyle(hit.segmentRect) : {};
});

const selectedSegmentToolbarStyle = computed<CSSProperties | null>(() => {
  const hit = selectedSegmentHit.value;
  if (!hit) return null;

  const placement =
    hit.type === 'row'
      ? getRowSegmentActionPlacement(hit.segmentRect, getSegmentActionPlacementOptions('x'))
      : getColumnSegmentActionPlacement(hit.segmentRect, getSegmentActionPlacementOptions('y'));

  return toViewportActionStyle(placement);
});

const selectedSegmentRemoveTitle = computed<string>(() => (selectedSegment.value?.type === 'column' ? '删除列' : '删除行'));

const showColumnAlignButtons = computed<boolean>(() => selectedSegment.value?.type === 'column');

const insertGuideStyle = computed<CSSProperties | null>(() => {
  const hit = hoveredInsert.value?.hit ?? null;
  if (!hit) return null;

  if (hit.type === 'column') {
    const vp = toViewportPosition({ top: hit.lineRect.top, left: hit.lineRect.left });
    return {
      top: `${vp.top}px`,
      left: `${vp.left - UI.GUIDE_THICKNESS / 2}px`,
      width: `${UI.GUIDE_THICKNESS}px`,
      height: `${hit.lineRect.height}px`
    };
  }

  const vp = toViewportPosition({ top: hit.lineRect.top, left: hit.lineRect.left });
  return {
    top: `${vp.top - UI.GUIDE_THICKNESS / 2}px`,
    left: `${vp.left}px`,
    width: `${hit.lineRect.width}px`,
    height: `${UI.GUIDE_THICKNESS}px`
  };
});

/**
 * 当前是否显示焦点控制层。
 */
const showControlOverlay = computed<boolean>(() => props.editor.isEditable && isTableFocused.value && !dragSelection.value);

/**
 * 当前是否显示左上角控制条接缝块。
 */
const showCornerControl = computed<boolean>(() => showControlOverlay.value && cornerControlStyle.value !== null);

/**
 * 当前是否显示 hover 新增指引线。
 */
const showInsertGuide = computed<boolean>(() => showControlOverlay.value && insertGuideStyle.value !== null);

/**
 * 当前是否显示行列操作层。
 */
const showSegmentOverlay = computed<boolean>(() => showControlOverlay.value && selectedSegmentHover.value !== null);

/**
 * 当前是否显示行列工具条。
 */
const showSegmentToolbar = computed<boolean>(() => !dragSelection.value && selectedSegmentToolbarStyle.value !== null);

/**
 * 当前是否处于表格矩形拖拽选区中。
 */
const isDraggingCellSelection = computed<boolean>(() => dragSelection.value !== null);

// ─── 生命周期 ────────────────────────────────────────────────────────────────

onMounted(() => {
  isComponentUnmounted = false;
  window.addEventListener('mousemove', handleWindowMouseMove);
  window.addEventListener('mouseup', stopDragSelection);
  props.editor.on('selectionUpdate', syncTableFocusState);
  props.editor.on('focus', syncTableFocusState);
  props.editor.on('blur', syncTableFocusState);
  syncTableFocusState();
});

onBeforeUnmount(() => {
  isComponentUnmounted = true;
  window.removeEventListener('mousemove', handleWindowMouseMove);
  window.removeEventListener('mouseup', stopDragSelection);
  props.editor.off('selectionUpdate', syncTableFocusState);
  props.editor.off('focus', syncTableFocusState);
  props.editor.off('blur', syncTableFocusState);
  cancelAnimationFrame(scrollFrame);
  cancelTableGeometryRefresh();
  cancelHoveredInsertClear();
});
</script>

<style lang="less">
.b-markdown-table {
  width: 100%;
  margin: 0.75em 0;
  overflow: visible;
}

.b-markdown-table__viewport {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  overflow: visible;

  &.is-cell-dragging,
  &.is-cell-dragging * {
    -webkit-user-select: none;
    user-select: none;
  }
}

.b-markdown-table__scroller {
  width: 100%;
  overflow-x: auto;
}

.b-markdown-table__table {
  width: 100%;
  margin: 0;
  table-layout: fixed;
  border-spacing: 0;
  border-collapse: separate;
  border: var(--surface-border-width) solid var(--editor-table-border);
  border-radius: var(--surface-radius);
}

.b-markdown-table__table colgroup,
.b-markdown-table__table col {
  width: auto !important;
}

.b-markdown-table__table [data-node-view-content-vue] {
  display: contents;
}

.b-markdown-table__table tbody,
.b-markdown-table__table thead {
  width: 100%;
}

.b-markdown-table__table tr {
  width: 100%;
}

.b-markdown-table__table th,
.b-markdown-table__table td {
  width: auto;
  min-width: 0;
}

.b-markdown-table__control-overlay,
.b-markdown-table__segment-overlay {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}

.b-markdown-table__column-control,
.b-markdown-table__row-control {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  padding: 0;
  pointer-events: auto;
  cursor: pointer;
  background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
  border: none;
  border-radius: 0;
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.b-markdown-table__corner-control {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  pointer-events: none;
  background: color-mix(in srgb, var(--bg-secondary) 82%, transparent);
  border: none;
  border-top-left-radius: var(--surface-radius);
}

.b-markdown-table__column-control.is-last {
  border-top-right-radius: var(--surface-radius);
}

.b-markdown-table__row-control.is-last {
  border-bottom-left-radius: var(--surface-radius);
}

.b-markdown-table__column-control:hover,
.b-markdown-table__row-control:hover,
.b-markdown-table__column-control.is-selected,
.b-markdown-table__row-control.is-selected {
  background: color-mix(in srgb, var(--color-primary) 78%, transparent);
}

.b-markdown-table__segment-highlight {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  background: color-mix(in srgb, var(--editor-link) 18%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--editor-link) 20%, transparent);
}

.b-markdown-table__insert-guide {
  position: absolute;
  z-index: 3;
  pointer-events: none;
  background: var(--color-primary);
  border-radius: var(--radius-full);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary) 18%, transparent);
}

.b-markdown-table__segment-toolbar {
  position: absolute;
  z-index: 3;
  display: inline-flex;
  gap: 2px;
  align-items: center;
  justify-content: center;
  padding: 4px;
  pointer-events: auto;
  background: var(--bg-primary);
  border: var(--overlay-border-width) solid var(--border-primary);
  border-radius: var(--overlay-radius);
  box-shadow: var(--shadow-lg);
}

.b-markdown-table__insert-point {
  position: absolute;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  color: #fff;
  pointer-events: auto;
  cursor: pointer;
  background: transparent;
  background-image: radial-gradient(
    circle at center,
    color-mix(in srgb, var(--text-secondary) 62%, transparent) 0,
    color-mix(in srgb, var(--text-secondary) 62%, transparent) 2.5px,
    transparent 3px
  );
  background-repeat: no-repeat;
  background-position: center;
  background-size: 100% 100%;
  border: none;
  border-radius: var(--radius-full);
  transform: translate(-50%, -50%);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard), background-image var(--motion-duration-fast) var(--motion-easing-standard),
    box-shadow var(--motion-duration-fast) var(--motion-easing-standard), transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.b-markdown-table__insert-point .b-markdown-table__button-icon {
  width: 14px;
  height: 14px;
  opacity: 0;
  transform: scale(0.78);
  transition: opacity var(--motion-duration-fast) var(--motion-easing-standard), transform var(--motion-duration-fast) var(--motion-easing-standard);
}

.b-markdown-table__insert-point:hover,
.b-markdown-table__insert-point.is-active {
  background: var(--color-primary);
  background-image: none;
  box-shadow: 0 8px 22px color-mix(in srgb, var(--color-primary) 30%, transparent);
  transform: translate(-50%, -50%) scale(1.1);
}

.b-markdown-table__insert-point:hover .b-markdown-table__button-icon,
.b-markdown-table__insert-point.is-active .b-markdown-table__button-icon {
  opacity: 1;
  transform: scale(1);
}

.b-markdown-table__segment-toolbar-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  font-size: 14px;
  color: var(--text-secondary);
  pointer-events: auto;
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: var(--control-radius);
  transition: background var(--motion-duration-fast) var(--motion-easing-standard), color var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard);

  &:hover,
  &.is-active {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &.is-active {
    color: var(--color-primary);
  }

  &:active {
    transform: scale(0.96);
  }
}

.b-markdown-table__segment-toolbar-button--danger:hover {
  color: var(--color-danger);
}

.b-markdown-table__segment-toolbar-divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border-primary);
}

.b-markdown-table__button-icon {
  width: 14px;
  height: 14px;
  pointer-events: none;
}
</style>
