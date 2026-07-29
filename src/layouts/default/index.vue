<!--
  @file index.vue
  @description 默认应用布局，承载标题栏、标签页、主内容区和辅助侧边栏。
-->
<template>
  <div class="b-layout">
    <div class="b-layout-header">
      <!--
        为 macOS 的原生红绿灯按钮留出空间。
        在 macOS 下：
        - 普通模式或最大化时，系统会在左上角显示红绿灯，我们需要留出 60px 的宽度避免内容重叠。
        - 全屏模式时，系统原生红绿灯会隐藏，此时取消占位，让内容紧贴左侧边缘。
      -->
      <div v-if="platform === 'mac' && !isFullScreen" class="b-layout-header__mac-spacer"></div>

      <div class="b-layout-header__content" :class="{ 'is-mac': platform === 'mac' }">
        <template v-if="!isMac()">
          <div class="b-layout-header__left">
            <BToolbar :title="'文件'" :options="toolbarFileOptions" />
            <BToolbar :title="'编辑'" :options="toolbarEditOptions" />
            <BToolbar :title="'视图'" show-selected-check :options="toolbarViewOptions" />
            <BToolbar :title="'帮助'" :options="toolbarHelpOptions" />
          </div>
          <!-- 分割线 -->
          <div class="b-layout-header__divider"></div>
        </template>
        <div class="b-layout-header__center">
          <BButton icon="lucide:blocks" :type="welcomeButtonType" size="small" square @click="handleOpenWelcome" />
          <HeaderTabs />
        </div>
        <div class="b-layout-header__right">
          <HeaderUpdateNotice />
          <HeaderEditorActions />
          <!-- 搜索按钮 -->
          <BButton type="secondary" size="small" square @click="commandPanelStore.openRecent()">
            <Icon icon="tabler:search" width="16" height="16" />
          </BButton>
          <!-- 辅助工具侧边栏切换按钮 -->
          <BButton type="secondary" size="small" square @click="handleToggleSidebar">
            <Icon :icon="settingStore.sidebarVisible ? 'tabler:layout-sidebar-right-filled' : 'tabler:layout-sidebar-right'" width="16" height="16" />
          </BButton>

          <BButton icon="tabler:settings" type="secondary" size="small" square @click="handleOpenSettings" />
        </div>
      </div>

      <template v-if="platform === 'win'">
        <div class="b-layout-header__divider"></div>
        <div class="b-layout-header__controls">
          <button class="b-layout-header__button" @click="handleMinimize">
            <Icon icon="lucide:minus" width="14" height="14" />
          </button>
          <button class="b-layout-header__button" @click="handleMaximize">
            <Icon v-if="isMaximized" icon="lucide:copy" width="14" height="14" />
            <Icon v-else icon="lucide:square" width="14" height="14" />
          </button>
          <button class="b-layout-header__button b-layout-header__button--close" @click="handleClose">
            <Icon icon="lucide:x" width="14" height="14" />
          </button>
        </div>
      </template>
    </div>

    <div class="b-layout__content">
      <MainDropZone class="b-layout__content__main">
        <RouterView v-slot="{ Component, route }">
          <KeepAlive :include="tabsStore.cachedComponentNames">
            <component :is="getRouteCacheComponent(route)" v-if="Component" :key="getRouteCacheKey(route)" :route-component="Component" />
          </KeepAlive>
        </RouterView>
      </MainDropZone>

      <ChatSider :motion-enabled="sidebarMotionEnabled" @button-close="handleSidebarClose" />

      <ShortcutsHelp v-model:visible="visible.shortcutsHelp" />
    </div>

    <BCommandPanel />
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useEventListener } from '@vueuse/core';
import BButton from '@/components/BButton/index.vue';
import BCommandPanel from '@/components/BCommandPanel/index.vue';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { isMac } from '@/shared/platform/env';
import { useCommandPanelStore } from '@/stores/ui/commandPanel';
import { useSettingStore } from '@/stores/ui/setting';
import { useTabsStore } from '@/stores/workspace/tabs';
import ChatSider from './components/ChatSider.vue';
import HeaderEditorActions from './components/HeaderEditorActions.vue';
import HeaderTabs from './components/HeaderTabs.vue';
import HeaderUpdateNotice from './components/HeaderUpdateNotice.vue';
import MainDropZone from './components/MainDropZone.vue';
import { useEditActive } from './hooks/useEditActive';
import { useFileActive } from './hooks/useFileActive';
import { useHelpActive } from './hooks/useHelpActive';
import { useKeepAlive } from './hooks/useKeepAlive';
import { useViewActive } from './hooks/useViewActive';
import { useWatchSkill } from './hooks/useWatchSkill';
import { useWatchWidget } from './hooks/useWatchWidget';

const currentRoute = useRoute();
const router = useRouter();

const visible = reactive({ shortcutsHelp: false });

const commandPanelStore = useCommandPanelStore();
const settingStore = useSettingStore();
const tabsStore = useTabsStore();
const { getRouteCacheKey, getRouteCacheComponent } = useKeepAlive();

/** 应用级 Skill 与 Widget 资源扫描和目录监听。 */
useWatchSkill();
useWatchWidget();

/** 快捷键帮助抽屉仅在打开时加载，减少默认布局首屏组件体积。 */
const ShortcutsHelp = defineAsyncComponent(() => import('./components/ShortcutsHelp.vue'));

const { toolbarFileOptions } = useFileActive();
const { toolbarEditOptions } = useEditActive();
const { toolbarViewOptions } = useViewActive();
const { toolbarHelpOptions } = useHelpActive(visible);

/** 欢迎页路由。 */
const WELCOME_ROUTE_PATH = '/welcome';
/** 设置页标签固定 ID。 */
const SETTINGS_TAB_ID = 'settings';
/** 设置页根路由。 */
const SETTINGS_ROUTE_ROOT = '/settings';
/** 侧栏拖拽关闭后重新打开使用的默认宽度。 */
const SIDEBAR_DEFAULT_WIDTH = 340;
/** 按钮触发的侧栏显隐动画时长，需与 ChatSider Less 过渡保持一致。 */
const SIDEBAR_MOTION_DURATION = 360;
/** 是否临时启用侧栏按钮显隐动画。 */
const sidebarMotionEnabled = ref(false);
/** 侧栏动画状态清理定时器。 */
let sidebarMotionTimer: number | null = null;

onMounted(() => {
  tabsStore.subscribeToFileWatchEvents();
});

/**
 * 判断路径是否位于欢迎页。
 * @param path - 待判断的完整路由路径
 * @returns 是否是欢迎页
 */
function isWelcomeRoutePath(path: string): boolean {
  const routePath = path.split(/[?#]/u)[0] ?? path;

  return routePath === WELCOME_ROUTE_PATH;
}

/** 欢迎页按钮类型，当前页激活时使用柔和态。 */
const welcomeButtonType = computed<'soft' | 'secondary'>((): 'soft' | 'secondary' => (isWelcomeRoutePath(currentRoute.fullPath) ? 'soft' : 'secondary'));

/**
 * 判断路径是否位于设置页内。
 * @param path - 待判断的完整路由路径
 * @returns 是否是设置页或设置页子路由
 */
function isSettingsRoutePath(path: string): boolean {
  const routePath = path.split(/[?#]/u)[0] ?? path;

  return routePath === SETTINGS_ROUTE_ROOT || routePath.startsWith(`${SETTINGS_ROUTE_ROOT}/`);
}

/**
 * 打开欢迎页。
 */
function handleOpenWelcome(): void {
  if (isWelcomeRoutePath(currentRoute.fullPath)) {
    return;
  }

  router.push(WELCOME_ROUTE_PATH);
}

/**
 * 打开设置页。
 */
function handleOpenSettings(): void {
  if (isSettingsRoutePath(currentRoute.fullPath)) {
    return;
  }

  const settingsTab = tabsStore.tabs.find((tab) => tab.id === SETTINGS_TAB_ID);

  router.push(settingsTab?.path ?? SETTINGS_ROUTE_ROOT);
}

/**
 * 清理侧栏按钮动画定时器。
 */
function clearSidebarMotion(): void {
  if (sidebarMotionTimer === null) {
    return;
  }

  window.clearTimeout(sidebarMotionTimer);
  sidebarMotionTimer = null;
}

onUnmounted((): void => {
  tabsStore.unsubscribeFromFileWatchEvents();
  clearSidebarMotion();
});

/**
 * 临时启用侧栏按钮显隐动画。
 */
function enableSidebarMotion(): void {
  clearSidebarMotion();
  sidebarMotionEnabled.value = true;
  sidebarMotionTimer = window.setTimeout((): void => {
    sidebarMotionEnabled.value = false;
    sidebarMotionTimer = null;
  }, SIDEBAR_MOTION_DURATION);
}

/**
 * 切换右侧辅助栏显示状态。
 * 如果侧边栏宽度为 0（通过拖拽关闭），重新打开时恢复为默认宽度。
 */
function handleToggleSidebar(): void {
  enableSidebarMotion();
  if (!settingStore.sidebarVisible && settingStore.sidebarWidth === 0) {
    settingStore.setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
  }
  settingStore.toggleSidebar();
}

/**
 * 处理 ChatSider 内部关闭按钮请求。
 */
function handleSidebarClose(): void {
  enableSidebarMotion();
  settingStore.setSidebarVisible(false);
}

// --- Window Controls ---
const api = getElectronAPI();
const platform = computed(() => (isMac() ? 'mac' : 'win'));
const isMaximized = ref(false);
const isFullScreen = ref(false);

/**
 * 同步窗口最大化和全屏状态。
 */
function validateWindowState(): void {
  // 读取最大化状态用于切换窗口按钮图标。
  api?.windowIsMaximized?.().then((value) => (isMaximized.value = value));
  // 读取全屏状态用于 macOS 标题栏占位。
  api?.windowIsFullScreen?.().then((value) => (isFullScreen.value = value));
}

/**
 * 最小化当前窗口。
 */
function handleMinimize(): void {
  api?.windowMinimize();
}

/**
 * 切换当前窗口最大化状态。
 */
function handleMaximize(): void {
  api?.windowMaximize();

  validateWindowState();
}

/**
 * 关闭当前窗口。
 */
function handleClose(): void {
  api?.windowClose();
}

validateWindowState();
useEventListener(window, 'resize', validateWindowState);
</script>

<style lang="less">
.b-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
}

.b-layout-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  width: 100%;
  height: 36px;
  -webkit-app-region: drag;

  button {
    -webkit-app-region: no-drag;
  }
}

.b-layout__content {
  position: relative;
  display: flex;
  flex: 1;
  gap: 6px;
  height: 0;
  margin: 0 6px 6px;

  .b-layout__content__main {
    flex: 1;
    width: 0;
  }
}

.b-layout-header__mac-spacer {
  flex-shrink: 0;
  width: 60px;
  height: 100%;
}

.b-layout-header__content {
  display: flex;
  flex: 1;
  align-items: center;
  height: 100%;

  &.is-mac {
    padding: 0 12px;

    .b-layout-header__center {
      margin-left: 12px;
    }
  }
}

.b-layout-header__center {
  display: flex;
  flex: 1;
  gap: 4px;
  align-items: center;
  width: 0;
  height: 100%;
  -webkit-app-region: drag;
}

.b-layout-header__divider {
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background: var(--border-secondary);
}

.b-layout-header__controls {
  display: flex;
  height: 100%;
}

.b-layout-header__button {
  width: 46px;
  height: 100%;
  color: var(--text-primary);
  cursor: pointer;
  outline: none;
  background: transparent;
  border: none;
  transition: background 0.2s;
}

.b-layout-header__button:hover {
  background: var(--bg-hover);
}

.b-layout-header__left,
.b-layout-header__right {
  display: flex;
  gap: 4px;
  align-items: center;
  height: 100%;

  &:empty {
    display: none;
  }
}

.b-layout-header__left {
  padding-left: 8px;
}

.b-dropdown-menu-item.is-active {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}
</style>
