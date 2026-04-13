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
        <slot name="header-left"></slot>
        <div class="b-layout-header__center"></div>
        <slot name="header-right"></slot>
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
      <div :class="contentClass">
        <slot></slot>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { useEventListener } from '@vueuse/core';
import { getElectronAPI } from '@/shared/platform/electron-api';
import { isMac } from '@/shared/platform/env';

export interface Props {
  contentClass?: string;
}

withDefaults(defineProps<Props>(), {
  contentClass: ''
});

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

.b-layout-header__button--close:hover {
  color: white;
  background-color: #e81123;
}
</style>
