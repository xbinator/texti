<template>
  <div ref="webviewShellRef" class="webview-shell">
    <AddressBar
      :url="webview.state.value.url"
      :can-go-back="webview.state.value.canGoBack"
      :can-go-forward="webview.state.value.canGoForward"
      :is-loading="webview.state.value.isLoading"
      @go-back="webview.goBack"
      @go-forward="webview.goForward"
      @reload="webview.reload"
      @stop="webview.stop"
      @submit-url="handleSubmitUrl"
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
      <div class="loading-progress" :style="{ width: `${(webview.state.value.loadProgress || 0) * 100}%` }"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file index.vue
 * @description native WebContentsView 页面入口。
 */
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useResizeObserver } from '@vueuse/core';
import { native } from '@/shared/platform';
import { hashString } from '@/shared/utils/hash';
import { useTabTitle } from '@/views/webview/shared/hooks/useTabTitle';
import { normalizeWebviewUrl } from '@/views/webview/shared/utils/url';
import AddressBar from './components/AddressBar.vue';
import { useNativeWebView } from './hooks/useNativeWebView';

const route = useRoute();

/**
 * 使用路由完整路径的哈希值作为主进程 WebContentsView 的唯一标识。
 */
const tabId = computed(() => hashString(route.fullPath));
const initialUrl = computed(() => normalizeWebviewUrl(decodeURIComponent((route.query.url as string) || '')));
const webviewContainerRef = ref<HTMLElement | null>(null);
const webviewShellRef = ref<HTMLElement | null>(null);
const webview = useNativeWebView(tabId);

/**
 * 更新 native WebContentsView 的边界位置和尺寸。
 */
function updateBounds(): void {
  if (!webviewContainerRef.value) {
    return;
  }

  const rect = webviewContainerRef.value.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }

  webview.setBounds({
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  });
}

/**
 * 在系统默认浏览器中打开当前页面 URL。
 */
async function handleOpenInBrowser(): Promise<void> {
  if (!webview.state.value.url) {
    return;
  }

  await native.openExternal(webview.state.value.url);
}

/**
 * 处理地址栏提交的 URL。
 * @param value - 用户输入的 URL
 */
async function handleSubmitUrl(value: string): Promise<void> {
  await webview.navigate(normalizeWebviewUrl(value));
}

useResizeObserver(webviewShellRef, updateBounds);
useTabTitle({
  routeFullPath: route.fullPath,
  title: computed(() => webview.state.value.title)
});

onMounted(async () => {
  await webview.create(initialUrl.value);
  updateBounds();
  await webview.show();
});

onActivated(async () => {
  updateBounds();
  await webview.show();
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
  overflow: hidden;
  background: var(--bg-primary);
  border-radius: var(--surface-radius);
}

.webview-content {
  position: relative;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: var(--surface-radius);
}

.loading-bar {
  height: 2px;
  background: var(--border-primary, #e0e0e0);
}

.loading-progress {
  height: 100%;
  background: var(--color-primary);
  transition: width var(--motion-duration-base) var(--motion-easing-standard);
}
</style>
