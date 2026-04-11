<template>
  <div class="b-layout">
    <div class="b-layout-header">
      <div class="b-layout-header__content">
        <slot name="header-left"></slot>
        <div class="b-layout-header__drag"></div>
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

    <div class="b-layout__content" :class="contentClass">
      <slot></slot>
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
// 验证窗口是否最大化
async function validateMaximized() {
  isMaximized.value = (await api?.windowIsMaximized()) ?? false;
}
// 最小化窗口
function handleMinimize() {
  api?.windowMinimize();
}
// 最大化窗口
async function handleMaximize() {
  await api?.windowMaximize();
  await validateMaximized();
}
// 关闭窗口
function handleClose() {
  api?.windowClose();
}

validateMaximized();
useEventListener(window, 'resize', validateMaximized);
</script>

<style lang="less">
.b-layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.b-layout__content {
  flex: 1;
  height: 0;
}

.b-layout-header {
  display: flex;
  align-items: center;
  width: 100%;
  height: 36px;
}

.b-layout-header__content {
  display: flex;
  flex: 1;
  align-items: center;
  height: 100%;
}

.b-layout-header__drag {
  flex: 1;
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
