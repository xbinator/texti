<template>
  <div ref="scrollContainer" class="header-tabs" @wheel.prevent="handleWheel">
    <div v-for="tab in tabsStore.tabs" :key="tab.id" class="header-tab" :class="{ 'is-active': isActiveTab(tab) }" @click="handleClickTab(tab.id, tab.path)">
      <div class="header-tab__title"><span v-if="tabsStore.isDirty(tab.id)" class="header-tab__dirty-mark">*</span>{{ tab.title }}</div>

      <button class="header-tab__close" @click.stop="handleCloseTab(tab)">
        <Icon icon="ic:round-close" width="12" height="12" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useTabsStore } from '@/stores/tabs';

const tabsStore = useTabsStore();
const scrollContainer = ref<HTMLElement | null>(null);
const route = useRoute();
const router = useRouter();

interface HeaderTabItem {
  id: string;
  path: string;
}

// 判断标签页是否为当前激活状态
function isActiveTab(tab: { path: string }): boolean {
  // 从路由路径中提取文件 ID，与标签页 ID 比较
  return tab.path === route.path;
}

async function handleClickTab(_id: string, path: string): Promise<void> {
  if (path && route.fullPath !== path) {
    await router.push(path);
  }
}

async function handleCloseTab(tab: HeaderTabItem): Promise<void> {
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

function handleWheel(e: WheelEvent) {
  if (scrollContainer.value) {
    if (e.deltaY !== 0) {
      scrollContainer.value.scrollLeft += e.deltaY;
    } else {
      scrollContainer.value.scrollLeft += e.deltaX;
    }
  }
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
  display: flex;
  flex-shrink: 0;
  align-items: center;
  height: 28px;
  padding: 0 4px 0 10px;
  margin-right: 4px;
  cursor: pointer;
  background-color: transparent;
  border-radius: 6px;
  transition: background-color 0.2s;

  /* Ensure tabs themselves are clickable (not draggable) */
  -webkit-app-region: no-drag;

  &:hover {
    background-color: var(--bg-hover);
  }

  &.is-active {
    font-weight: 500;
    background-color: var(--bg-active, var(--bg-hover));
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

.header-tab__dirty {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  background-color: var(--text-secondary);
  border-radius: 50%;
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
