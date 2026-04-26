<template>
  <div class="webview-shell">
    <AddressBar
      :url="webview.state.value.url"
      :can-go-back="webview.state.value.canGoBack"
      :can-go-forward="webview.state.value.canGoForward"
      :is-loading="webview.state.value.isLoading"
      @navigate="handleNavigate"
      @go-back="webview.goBack"
      @go-forward="webview.goForward"
      @reload="webview.reload"
      @stop="webview.stop"
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
import { ref, computed, onMounted, onActivated, onDeactivated, onBeforeUnmount } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import { useTabsStore } from '@/stores/tabs';
import AddressBar from './components/AddressBar.vue';
import { useWebView } from './hooks/useWebView';

const route = useRoute();
const router = useRouter();
const tabsStore = useTabsStore();
const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

const tabId = computed(() => (route.query.tabId as string) || 'default');
const initialUrl = computed(() => (route.query.url as string) || '');

const webviewContainerRef = ref<HTMLElement | null>(null);

const webview = useWebView(tabId);

const updateBounds = () => {
  if (!webviewContainerRef.value) return;
  const rect = webviewContainerRef.value.getBoundingClientRect();

  webview.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
};

const handleOpenInNewTab = (url: string) => {
  const newTabId = nanoid();

  console.log(route.fullPath);

  tabsStore.addTab({ id: newTabId, path: route.fullPath, title: new URL(url).hostname, cacheKey: newTabId });
  router.push({ name: 'webview', query: { tabId: newTabId, url } });
};

onMounted(async () => {
  await webview.create(initialUrl.value);
  updateBounds();
  await webview.show();
  webview.onOpenInNewTab(handleOpenInNewTab);
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

const handleNavigate = (url: string) => {
  webview.navigate(url);
};
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
