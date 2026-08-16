<!--
  @file HeaderTabs.vue
  @description 渲染应用顶部标签栏，并处理切换、关闭、横向滚动与拖拽排序交互。
-->
<template>
  <BDraggable
    class="header-tabs"
    :list="visibleTabs"
    direction="horizontal"
    item-key="id"
    item-class="header-tabs__item"
    @wheel="handleWheel"
    @move="handleDraggableMove"
    @drag-end="handleDragEnded"
  >
    <template #default="{ item, dragging }">
      <HeaderTab
        :tab="item"
        :dragging="dragging"
        :status="item.status"
        @click="handleClickTab(item.path)"
        @close="handleCloseButton(item)"
        @contextmenu="handleTabContextMenu(item, $event)"
      />
    </template>
  </BDraggable>
  <HeaderTabMenu ref="tabMenuRef" />
</template>

<script setup lang="ts">
/**
 * @file HeaderTabs.vue
 * @description 渲染顶部标签栏的交互逻辑，拖拽排序委托给 BDraggable 公共组件。
 */

import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { BDraggableMoveEvent } from '@/components/BDraggable/types';
import HeaderTab from '@/layouts/default/components/HeaderTab.vue';
import HeaderTabMenu from '@/layouts/default/components/HeaderTabMenu.vue';
import { getHeaderTabsWheelScrollDelta } from '@/layouts/default/utils/headerTabsScroll';
import { createChatTabId } from '@/router/routes/helpers/chatRouteTab';
import { isMac } from '@/shared/platform/env';
import type { ChatSessionTitlePayload } from '@/stores/helpers/events';
import { storeEvents } from '@/stores/helpers/events';
import { useSettingStore } from '@/stores/ui/setting';
import { useRecentStore } from '@/stores/workspace/recent';
import { useTabsStore } from '@/stores/workspace/tabs';
import type { Tab } from '@/stores/workspace/tabs';
import { asyncTo } from '@/utils/asyncTo';

const tabsStore = useTabsStore();
const recentStore = useRecentStore();
const settingStore = useSettingStore();
const route = useRoute();
const router = useRouter();

/** 拖拽结束后最近一次的时间戳，用于抑制拖后误点击 */
const lastDragEndedAt = shallowRef(0);

/** 全局聊天标题事件取消订阅函数。 */
let unsubscribeChatTitle: (() => void) | undefined;

/** 当前可见标签，直接消费 store 列表。 */
const visibleTabs = computed<Tab[]>(() => tabsStore.tabs);

/** 顶部标签右键菜单组件实例。 */
const tabMenuRef = ref<InstanceType<typeof HeaderTabMenu> | null>(null);

/**
 * 拖拽排序回调：将 BDraggable 的排序结果传递给 store。
 * @param event - BDraggable 移动事件
 */
function handleDraggableMove(event: BDraggableMoveEvent<Tab>): void {
  tabsStore.moveTab(event.sourceKey, event.targetKey, event.position);
}

/**
 * 拖拽结束回调：记录时间戳以抑制误点击。
 */
function handleDragEnded(): void {
  lastDragEndedAt.value = Date.now();
}

/**
 * 打开指定标签的右键菜单。
 * @param tab - 右键命中的标签
 * @param event - 鼠标右键事件
 */
async function handleTabContextMenu(tab: Tab, event: MouseEvent): Promise<void> {
  await tabMenuRef.value?.openForTab(tab, event);
}

/** 组件卸载时清理事件订阅 */
onUnmounted(() => {
  unsubscribeChatTitle?.();
  unsubscribeChatTitle = undefined;
});

/**
 * 将自动命名结果同步到持久化会话标签。
 * @param payload - 会话标题事件
 */
function handleChatTitleUpdated(payload: ChatSessionTitlePayload): void {
  tabsStore.updateTabTitle({ id: createChatTabId(payload.sessionId), title: payload.title });
}

/**
 * 组件挂载后加载最近记录，并订阅聊天标题更新事件。
 */
onMounted((): void => {
  asyncTo(recentStore.ensureLoaded());
  unsubscribeChatTitle = storeEvents.onChatSessionTitleUpdated(handleChatTitleUpdated);
});

/** 当前激活的标签页 */
const activeTab = computed(() => tabsStore.tabs.find((tab) => tab.path === route.fullPath));

/**
 * 监听激活标签标题变化，同步更新窗口标题。
 */
watch(
  () => activeTab.value?.title,
  (title) => {
    if (title) {
      settingStore.setWindowTitle(title);
    }
  },
  { immediate: true }
);

/**
 * 点击标签页时切换路由。
 * @param path - 目标路由路径
 */
async function handleClickTab(path: string): Promise<void> {
  // 拖拽结束后 180ms 内抑制点击，防止拖后误触
  if (Date.now() - lastDragEndedAt.value < 180) {
    return;
  }

  if (path && route.fullPath !== path) {
    await asyncTo(router.push(path));
  }
}

/**
 * 顶部关闭按钮复用菜单组件的标签关闭能力。
 * @param tab - 待关闭的标签页
 */
async function handleCloseButton(tab: Tab): Promise<void> {
  await tabMenuRef.value?.closeTab(tab);
}

/**
 * 将滚轮输入映射为标签栏横向滚动。
 * @param event - 鼠标滚轮事件
 */
function handleWheel(event: WheelEvent): void {
  const scrollContainer = event.currentTarget;
  if (!(scrollContainer instanceof HTMLElement)) {
    return;
  }

  const scrollDelta = getHeaderTabsWheelScrollDelta({
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    isMacPlatform: isMac()
  });

  if (scrollDelta === null) {
    return;
  }

  event.preventDefault();
  scrollContainer.scrollLeft += scrollDelta;
}
</script>

<style lang="less" scoped>
.header-tabs {
  position: relative;
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

.header-tabs :deep(.header-tabs__item) {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  height: 100%;
  margin-right: 4px;
  transition: margin-right var(--motion-duration-base) var(--motion-easing-standard);
  -webkit-app-region: no-drag;
}

/* 标签离场收缩时同步收起右侧间距，避免动画结束瞬间残留 4px 跳动 */
.header-tabs :deep(.header-tabs__item:has(> .header-tab.is-closing)) {
  margin-right: 0;
}

.header-tabs :deep(.header-tab) {
  transition: color var(--motion-duration-base) var(--motion-easing-standard), background var(--motion-duration-base) var(--motion-easing-standard),
    border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard),
    opacity var(--motion-duration-base) var(--motion-easing-standard), transform var(--motion-duration-fast) var(--motion-easing-press),
    width var(--motion-duration-base) var(--motion-easing-standard), padding var(--motion-duration-base) var(--motion-easing-standard),
    border-width var(--motion-duration-base) var(--motion-easing-standard);
}

.header-tabs :deep(.header-tab:active:not(.is-dragging)) {
  box-shadow: var(--button-pressed-shadow);
  transform: translate(var(--interaction-press-offset), var(--interaction-press-offset));
}

.header-tabs :deep(.b-draggable__indicator--horizontal) {
  top: 4px;
  bottom: 4px;
  background: var(--color-primary);
}
</style>
