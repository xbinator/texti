<!--
  @file HeaderTabs.vue
  @description 渲染应用顶部标签栏，并处理切换、关闭、横向滚动与拖拽排序交互。
-->
<template>
  <div ref="scrollContainer" class="header-tabs" @dragover.prevent="handleDragOver" @drop.prevent="handleDrop" @wheel.prevent="handleWheel">
    <div
      v-for="tab in tabsStore.tabs"
      :key="tab.id"
      :data-tab-id="tab.id"
      class="header-tab"
      :class="getTabClassName(tab)"
      draggable="true"
      @click="handleClickTab(tab.path)"
      @dragstart="handleDragStart($event, tab.id)"
      @dragend="handleDragEnd"
    >
      <div class="header-tab__title">
        <span v-if="tabsStore.isDirty(tab.id)" class="header-tab__dirty-mark">*</span>
        <span class="header-tab__title-text">{{ tab.title }}</span>
      </div>

      <button class="header-tab__close" @click.stop="handleCloseTab(tab)">
        <Icon icon="ic:round-close" width="12" height="12" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file HeaderTabs.vue
 * @description 渲染顶部标签栏的交互逻辑，并将拖拽操作映射到标签页状态管理。
 */

import type { HeaderTabRect } from './headerTabDrag';
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useTabsStore } from '@/stores/tabs';
import type { Tab, TabMovePosition } from '@/stores/tabs';
import { getHeaderTabAutoScrollDelta, getHeaderTabDropSlot } from './headerTabDrag';

/**
 * 用于在浏览器拖拽传输中标记标签页 ID 的 MIME 类型。
 */
const TAB_DRAG_MIME_TYPE = 'application/x-texti-tab-id';

const tabsStore = useTabsStore();
const scrollContainer = ref<HTMLElement | null>(null);
const draggingTabId = ref<string | null>(null);
const dropTargetTabId = ref<string | null>(null);
const dragInsertPosition = ref<TabMovePosition>('before');
const lastDragEndedAt = ref(0);
const route = useRoute();
const router = useRouter();

/**
 * 判断标签页是否为当前激活状态。
 * @param tab - 待判断的标签页
 * @returns 是否与当前路由匹配
 */
function isActiveTab(tab: Pick<Tab, 'path'>): boolean {
  return tab.path === route.fullPath;
}

/**
 * 生成标签页样式状态。
 * @param tab - 当前渲染的标签页
 * @returns 标签页样式映射
 */
function getTabClassName(tab: Tab): Record<string, boolean> {
  const isDragTarget = dropTargetTabId.value === tab.id && draggingTabId.value !== tab.id;

  return {
    'is-active': isActiveTab(tab),
    'is-missing': tabsStore.isMissing(tab.id),
    'is-dragging': draggingTabId.value === tab.id,
    'is-drop-before': isDragTarget && dragInsertPosition.value === 'before',
    'is-drop-after': isDragTarget && dragInsertPosition.value === 'after'
  };
}

/**
 * 点击标签页时切换路由。
 * @param path - 目标路由路径
 */
async function handleClickTab(path: string): Promise<void> {
  if (Date.now() - lastDragEndedAt.value < 180) {
    return;
  }

  if (path && route.fullPath !== path) {
    await router.push(path);
  }
}

/**
 * 关闭标签页，并在必要时跳转到相邻标签。
 * @param tab - 待关闭的标签页
 */
async function handleCloseTab(tab: Tab): Promise<void> {
  const isActive = isActiveTab(tab);
  const closingIndex = tabsStore.tabs.findIndex((item) => item.id === tab.id);
  const nextTab = closingIndex === -1 ? null : tabsStore.tabs[closingIndex + 1] ?? tabsStore.tabs[closingIndex - 1] ?? null;

  tabsStore.removeTab(tab.id);

  if (isActive && nextTab) {
    await router.push(nextTab.path);
  } else if (tabsStore.tabs.length === 0) {
    // 最后一个标签页被关闭时，跳转到欢迎页
    await router.push('/welcome');
  }
}

/**
 * 开始拖拽标签页，并记录拖拽源。
 * @param event - 拖拽开始事件
 * @param tabId - 被拖拽的标签页 ID
 */
function handleDragStart(event: DragEvent, tabId: string): void {
  draggingTabId.value = tabId;
  dropTargetTabId.value = null;
  dragInsertPosition.value = 'before';

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(TAB_DRAG_MIME_TYPE, tabId);
    event.dataTransfer.setData('text/plain', tabId);
  }
}

/**
 * 读取当前标签元素的几何信息，供拖拽槽位计算使用。
 * @returns 标签元素矩形列表
 */
function getHeaderTabRects(): HeaderTabRect[] {
  if (!scrollContainer.value) {
    return [];
  }

  return Array.from(scrollContainer.value.querySelectorAll<HTMLElement>('[data-tab-id]')).map((element) => {
    const { left, width } = element.getBoundingClientRect();

    return { id: element.dataset.tabId, left, width };
  });
}

/**
 * 拖拽时靠近标签栏边缘自动横向滚动，方便跨屏移动标签。
 * @param clientX - 当前指针相对视口的横向坐标
 */
function scrollHeaderTabsByPointer(clientX: number): void {
  if (!scrollContainer.value) {
    return;
  }

  const { left, right } = scrollContainer.value.getBoundingClientRect();
  const scrollDelta = getHeaderTabAutoScrollDelta(clientX, { left, right });

  if (scrollDelta !== 0) {
    scrollContainer.value.scrollLeft += scrollDelta;
  }
}

/**
 * 计算拖拽悬停时的稳定插入槽位，并更新视觉反馈。
 * @param event - 拖拽悬停事件
 */
function handleDragOver(event: DragEvent): void {
  scrollHeaderTabsByPointer(event.clientX);

  if (!draggingTabId.value) {
    dropTargetTabId.value = null;
    return;
  }

  const dropSlot = getHeaderTabDropSlot(event.clientX, getHeaderTabRects(), draggingTabId.value);
  if (!dropSlot) {
    dropTargetTabId.value = null;
    return;
  }

  dropTargetTabId.value = dropSlot.targetId;
  dragInsertPosition.value = dropSlot.position;
}

/**
 * 清理拖拽中的临时状态。
 */
function handleDragEnd(): void {
  if (draggingTabId.value) {
    lastDragEndedAt.value = Date.now();
  }

  draggingTabId.value = null;
  dropTargetTabId.value = null;
  dragInsertPosition.value = 'before';
}

/**
 * 释放拖拽时，根据当前目标标签重新排序。
 * @param event - 放置事件
 */
function handleDrop(event: DragEvent): void {
  const draggedTabId = draggingTabId.value || event.dataTransfer?.getData(TAB_DRAG_MIME_TYPE) || event.dataTransfer?.getData('text/plain') || '';
  const dropSlot = draggedTabId ? getHeaderTabDropSlot(event.clientX, getHeaderTabRects(), draggedTabId) : null;

  if (!draggedTabId || !dropSlot || draggedTabId === dropSlot.targetId) {
    handleDragEnd();
    return;
  }

  tabsStore.moveTab(draggedTabId, dropSlot.targetId, dropSlot.position);
  handleDragEnd();
}

/**
 * 将纵向滚轮滚动映射为横向标签栏滚动。
 * @param event - 鼠标滚轮事件
 */
function handleWheel(event: WheelEvent): void {
  if (!scrollContainer.value) {
    return;
  }

  scrollContainer.value.scrollLeft += event.deltaY !== 0 ? event.deltaY : event.deltaX;
}
</script>

<style lang="less" scoped>
.header-tabs {
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  overflow: auto hidden;

  /* Hide scrollbar for Chrome, Safari and Opera */
  &::-webkit-scrollbar {
    display: none;
  }

  /* Hide scrollbar for IE, Edge and Firefox */
  -ms-overflow-style: none;
  scrollbar-width: none;

  /* Make the empty space draggable */
  -webkit-app-region: drag;
}

.header-tab {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: center;
  height: 28px;
  padding: 0 4px 0 10px;
  margin-right: 4px;
  cursor: pointer;
  background-color: transparent;
  border-radius: 6px;
  transition: background-color 0.2s, opacity 0.2s;

  /* Ensure tabs themselves are clickable (not draggable) */
  -webkit-app-region: no-drag;

  &:hover {
    background-color: var(--bg-hover);
  }

  &.is-active {
    font-weight: 500;
    background-color: var(--bg-active, var(--bg-hover));
  }

  &.is-dragging {
    opacity: 0.55;
  }

  &.is-drop-before::before,
  &.is-drop-after::after {
    position: absolute;
    top: 4px;
    bottom: 4px;
    width: 2px;
    content: '';
    background-color: var(--primary-color, #1677ff);
    border-radius: 999px;
  }

  &.is-drop-before::before {
    left: -2px;
  }

  &.is-drop-after::after {
    right: -2px;
  }

  &.is-missing .header-tab__title {
    color: var(--error-color, #ff4d4f);
  }

  &.is-missing .header-tab__title-text {
    text-decoration-line: line-through;
    text-decoration-thickness: 1px;
  }
}

.header-tab__title {
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--text-primary);
  white-space: nowrap;
  user-select: none;
}

.header-tab__dirty-mark {
  margin-right: 2px;
  font-weight: 700;
}

.header-tab__close {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 4px;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.2s;

  &:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover-secondary, rgb(0 0 0 / 10%));
  }
}

.header-tab:hover .header-tab__close,
.header-tab.is-active .header-tab__close {
  opacity: 1;
}

:deep(.dark) .header-tab__close:hover {
  background-color: rgb(255 255 255 / 10%);
}
</style>
