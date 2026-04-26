<template>
  <div ref="webviewShellRef" class="webview-shell">
    <AddressBar
      :url="initialUrl"
      :can-go-back="webview.state.value.canGoBack"
      :can-go-forward="webview.state.value.canGoForward"
      :is-loading="webview.state.value.isLoading"
      @go-back="webview.goBack"
      @go-forward="webview.goForward"
      @reload="webview.reload"
      @open-in-browser="handleOpenInBrowser"
    />

    <div ref="webviewContainerRef" class="webview-content">
      <!--
        WebContentsView 由主进程渲染在 BrowserWindow.contentView 中，
        不在 Vue 虚拟 DOM 里。此占位 div 仅用于：
        1. 获取 getBoundingClientRect() 计算 bounds
        2. 发送 setBounds IPC 让主进程定位视图
      -->
    </div>

    <div v-if="webview.state.value.isLoading" class="loading-bar">
      <div class="loading-progress" :style="{ width: `${webview.state.value.loadProgress * 100}%` }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onActivated, onDeactivated, onBeforeUnmount, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useResizeObserver } from '@vueuse/core';
import { native } from '@/shared/platform';
import { hashString } from '@/shared/utils/hash';
import { useTabsStore } from '@/stores/tabs';
import AddressBar from './components/AddressBar.vue';
import { useWebView } from './hooks/useWebView';

const route = useRoute();
const tabsStore = useTabsStore();

/**
 * 使用路由完整路径的哈希值作为主进程 WebContentsView 的唯一标识。
 * 直接使用 fullPath 作为 tabId 会导致 IPC 日志中打印过长 URL 字符串，
 * 使用短哈希同时保证唯一性和可读性。
 */
const tabId = computed(() => hashString(route.fullPath));
const initialUrl = computed(() => decodeURIComponent((route.query.url as string) || ''));

const webviewContainerRef = ref<HTMLElement | null>(null);
/** webview 外层容器引用，用于监听大小变化 */
const webviewShellRef = ref<HTMLElement | null>(null);

const webview = useWebView(tabId);

/**
 * 更新 webview 的边界位置和尺寸
 * 根据容器的 getBoundingClientRect 计算并设置 webview 的 bounds
 */
function updateBounds() {
  if (!webviewContainerRef.value) return;
  const rect = webviewContainerRef.value.getBoundingClientRect();
  // 跳过未完成渲染的初始状态（宽高为 0）
  if (!rect.width || !rect.height) return;

  webview.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
}

/**
 * 在系统默认浏览器中打开当前页面 URL
 */
async function handleOpenInBrowser() {
  if (!initialUrl.value) return;

  await native.openExternal(initialUrl.value);
}

// 使用 VueUse 的 useResizeObserver 监听外层容器大小变化，自动更新 webview bounds
useResizeObserver(webviewShellRef, updateBounds);

// 监听 webview title 变化，更新 tabsStore 中的标签页标题
watch(
  () => webview.state.value.title,
  (title) => {
    if (!title) return;

    const { fullPath } = route;
    tabsStore.updateTabTitle({ id: fullPath, title });
  }
);

/**
 * 组件挂载时初始化 webview
 * 创建 webview 实例、更新边界位置并显示
 */
onMounted(async () => {
  await webview.create(initialUrl.value);
  // updateBounds();

  await webview.show();
});

/**
 * 组件激活时（keep-alive 缓存恢复）
 * 显示 webview、更新边界位置，并恢复标签页标题
 */
onActivated(async () => {
  await webview.show();
  // updateBounds();
  // 切回已缓存的 tab 时，afterEach 会用路由 meta title 覆盖已有标题，从 webview 状态恢复
  const currentTitle = webview.state.value.title;
  if (currentTitle) {
    tabsStore.updateTabTitle({ id: route.fullPath, title: currentTitle });
  }
});

/**
 * 组件停用时（keep-alive 缓存）
 * 隐藏 webview 以节省资源
 */
onDeactivated(async () => {
  await webview.hide();
});

onBeforeUnmount(async () => {
  await webview.destroy();
});
</script>

<style scoped>
.webview-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: 8px;
}

.webview-content {
  position: relative;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
}

.loading-bar {
  height: 2px;
  background: var(--border-color, #e0e0e0);
}

.loading-progress {
  height: 100%;
  background: var(--primary-color, #1890ff);
  transition: width 0.2s ease;
}
</style>
