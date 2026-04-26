<template>
  <div ref="webviewShellRef" class="webview-shell">
    <AddressBar
      :can-go-back="webview.state.value.canGoBack"
      :can-go-forward="webview.state.value.canGoForward"
      :is-loading="webview.state.value.isLoading"
      @go-back="webview.goBack"
      @go-forward="webview.goForward"
      @reload="webview.reload"
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
import { useTabsStore } from '@/stores/tabs';
import AddressBar from './components/AddressBar.vue';
import { useWebView } from './hooks/useWebView';

const route = useRoute();
const tabsStore = useTabsStore();

const tabId = computed(() => (route.query.tabId as string) || 'default');
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

  webview.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
}

// 使用 VueUse 的 useResizeObserver 监听外层容器大小变化，自动更新 webview bounds
useResizeObserver(webviewShellRef, updateBounds);

function updateTab() {
  const { fullPath } = route;

  const title = new URL(initialUrl.value).hostname;

  tabsStore.addTab({ id: fullPath, path: fullPath, cacheKey: fullPath, title });
}

// 监听 webview title 变化，更新 tabsStore 中的标签页标题
watch(
  () => webview.state.value.title,
  (title) => {
    if (!title) return;

    const { fullPath } = route;
    tabsStore.updateTabTitle({ id: fullPath, title });
  }
);

onMounted(async () => {
  console.log('🚀 ~ onMounted ~ initialUrl.value:', initialUrl.value);
  await webview.create(initialUrl.value);
  updateBounds();

  updateTab();
  // 显示 webview 后添加标签页
  await webview.show();
});

onActivated(async () => {
  await webview.show();
  updateBounds();
});

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
}

.webview-content {
  position: relative;
  flex: 1;
  overflow: hidden;
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
