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
        <div class="b-layout-header__teleport">
          <div class="header-left">
            <template v-if="!isMac()">
              <BToolbar :title="'文件'" :options="toolbarFileOptions" />
              <BToolbar :title="'编辑'" :options="toolbarEditOptions" />
              <BToolbar :title="'视图'" show-selected-check :options="toolbarViewOptions" />
              <BToolbar :title="'帮助'" :options="toolbarHelpOptions" />
            </template>
          </div>
        </div>
        <div class="b-layout-header__center">
          <HeaderTabs />
        </div>
        <div class="b-layout-header__teleport">
          <div class="header-right">
            <!-- 辅助工具侧边栏切换按钮 -->
            <BButton type="secondary" size="small" square @click="toggleSidebar">
              <Icon icon="lucide:panel-right" width="16" height="16" />
            </BButton>

            <BButton type="secondary" size="small" square @click="handleOpenSettings">
              <Icon icon="lucide:settings" width="16" height="16" />
            </BButton>
          </div>
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
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { EditorFile } from './types';
import { computed, ref, reactive, watch, provide } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { useStorage, useEventListener } from '@vueuse/core';
import BButton from '@/components/BButton/index.vue';
import type { BEditorPublicInstance } from '@/components/BEditor/types';
import BToolbar from '@/components/BToolbar/index.vue';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { isMac } from '@/shared/platform/env';
import HeaderTabs from './components/HeaderTabs.vue';
import { useAutoSave } from './hooks/useAutoSave';
import { useDirty } from './hooks/useDirty';
import { useEditActive } from './hooks/useEditActive';
import { useFileActive } from './hooks/useFileActive';
import { useHelp } from './hooks/useHelp';
import { useNativeMenu } from './hooks/useNativeMenu';
import { useViewActive } from './hooks/useViewActive';

const fileState = ref<EditorFile>({ id: '', path: '', content: '', name: '', ext: 'md' });
const editorInstance = ref<BEditorPublicInstance | null>(null);
const route = useRoute();
const router = useRouter();

const { setOriginalContent } = useDirty(fileState);

const visible = reactive({ find: false, recentSearch: false, shortcuts: false });
const sidebarState = useStorage('editor-sidebar-state', { visible: false, width: 300 });

function toggleSidebar(): void {
  sidebarState.value.visible = !sidebarState.value.visible;
}

function handleOpenSettings(): void {
  router.push('/settings');
}

const { pause, resume } = useAutoSave(fileState);

const { toolbarFileOptions, savedRecentFiles, openRecentFile, loadFileById } = useFileActive(fileState, {
  pause,
  resume,
  setOriginalContent,
  visible
});

// 路由参数变化时加载对应文件
watch(
  () => route.params.id,
  (id) => {
    if (route.name === 'Editor' || route.path.startsWith('/editor')) {
      loadFileById(id as string);
    }
  },
  { immediate: true }
);

async function handleSelectRecentFile(id: string): Promise<void> {
  await openRecentFile(id);
}

const { toolbarEditOptions } = useEditActive(fileState, { editorInstance, visible });

const { viewState, toolbarViewOptions } = useViewActive();

const { toolbarHelpOptions } = useHelp({ onShowShortcuts: () => (visible.shortcuts = true) });

useNativeMenu({
  toolbarFileOptions,
  toolbarEditOptions,
  toolbarViewOptions,
  toolbarHelpOptions,
  visible
});

// Provide the global editor state to the actual editor view and other components
provide('editorFileState', fileState);
provide('editorInstance', editorInstance);
provide('editorVisible', visible);
provide('editorSidebarState', sidebarState);
provide('editorViewState', viewState);
provide('editorSavedRecentFiles', savedRecentFiles);
provide('editorHandleSelectRecentFile', handleSelectRecentFile);

// --- Window Controls ---
const api = getElectronAPI();
const platform = computed(() => (isMac() ? 'mac' : 'win'));
const isMaximized = ref(false);
const isFullScreen = ref(false);

// 验证窗口状态
function validateWindowState() {
  // 最大化窗口
  api?.windowIsMaximized?.().then((value) => (isMaximized.value = value));
  // 全屏窗口
  api?.windowIsFullScreen?.().then((value) => (isFullScreen.value = value));
}

// 最小化窗口
function handleMinimize() {
  api?.windowMinimize();
}
// 最大化窗口
function handleMaximize() {
  api?.windowMaximize();

  validateWindowState();
}
// 关闭窗口
function handleClose() {
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
  flex: 1;
  height: 0;
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
  }
}

.b-layout-header__center {
  display: flex;
  flex: 1;
  align-items: center;
  width: 0;
  height: 100%;
  -webkit-app-region: drag;
}

.b-layout-header__divider {
  width: 1px;
  height: 16px;
  margin: 0 6px;
  background-color: var(--border-secondary);
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
  transition: background-color 0.2s;
}

.b-layout-header__button:hover {
  background-color: var(--bg-hover);
}

.b-layout-header__teleport {
  display: flex;
  align-items: center;
  height: 100%;
}

.header-left {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 0 20px;

  &:empty {
    display: none;
  }
}

:deep(.b-dropdown-menu-item.is-active) {
  color: var(--color-primary);
  background-color: var(--color-primary-bg);
}

.header-right {
  display: flex;
  gap: 12px;
  align-items: center;
  padding-right: 12px;
}
</style>
