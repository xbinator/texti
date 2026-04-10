<template>
  <div v-if="showTitleBar" class="title-bar">
    <div class="title-bar__drag-area">
      <span class="title-bar__title">{{ title }}</span>
    </div>
    <div class="title-bar__controls">
      <button class="title-bar__button title-bar__button--minimize" @click="handleMinimize">
        <Icon icon="lucide:minus" width="16" height="16" />
      </button>
      <button class="title-bar__button title-bar__button--maximize" @click="handleMaximize">
        <Icon v-if="isMaximized" icon="lucide:copy" width="14" height="14" />
        <Icon v-else icon="lucide:square" width="14" height="14" />
      </button>
      <button class="title-bar__button title-bar__button--close" @click="handleClose">
        <Icon icon="lucide:x" width="16" height="16" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { hasElectronAPI, getElectronAPI } from '@/shared/platform/electron-api';
import { isElectron, isMac } from '@/shared/platform/env';

withDefaults(
  defineProps<{
    title?: string;
  }>(),
  {
    title: 'Texti'
  }
);

const isMaximized = ref(false);
const showTitleBar = computed(() => isElectron() && !isMac());

async function checkMaximized(): Promise<void> {
  if (hasElectronAPI()) {
    isMaximized.value = await getElectronAPI().windowIsMaximized();
  }
}

async function handleMinimize(): Promise<void> {
  if (hasElectronAPI()) {
    await getElectronAPI().windowMinimize();
  }
}

async function handleMaximize(): Promise<void> {
  if (hasElectronAPI()) {
    await getElectronAPI().windowMaximize();
    await checkMaximized();
  }
}

async function handleClose(): Promise<void> {
  if (hasElectronAPI()) {
    await getElectronAPI().windowClose();
  }
}

function handleResize(): void {
  checkMaximized();
}

onMounted(() => {
  checkMaximized();
  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
});
</script>

<style scoped lang="less">
.title-bar {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 32px;
  background-color: var(--bg-primary);
  border-bottom: 1px solid var(--border-secondary);

  &__drag-area {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    height: 100%;
    -webkit-app-region: drag;
  }

  &__title {
    font-size: 13px;
    color: var(--text-secondary);
  }

  &__controls {
    display: flex;
    height: 100%;
    -webkit-app-region: no-drag;
  }

  &__button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    height: 100%;
    padding: 0;
    color: var(--text-secondary);
    cursor: pointer;
    outline: none;
    background: transparent;
    border: none;
    transition: background-color 0.1s ease;

    &:hover {
      background-color: rgb(255 255 255 / 10%);
    }

    &:active {
      background-color: rgb(255 255 255 / 5%);
    }

    &--close {
      &:hover {
        color: #fff;
        background-color: #e81123;
      }

      &:active {
        background-color: #c50f1f;
      }
    }
  }
}
</style>
