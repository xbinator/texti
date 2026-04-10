<template>
  <div class="title-bar" :class="`title-bar--${platform}`">
    <div class="title-bar__drag-area">
      <!-- 使用 store 中的标题 -->
      <span class="title-bar__title">{{ settingStore.title }}</span>
    </div>

    <!-- Windows layout -->
    <template v-if="platform === 'win'">
      <div class="title-bar__controls title-bar__controls--win">
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
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { hasElectronAPI, getElectronAPI } from '@/shared/platform/electron-api';
import { isMac } from '@/shared/platform/env';
import { useSettingStore } from '@/stores/setting';

/**
 * 标题栏组件
 * 显示窗口标题和窗口控制按钮（最小化、最大化、关闭）
 * 标题从 setting store 中获取，支持响应式更新
 */

const settingStore = useSettingStore();
const platform = computed(() => (isMac() ? 'mac' : 'win'));

const isMaximized = ref(false);

async function checkMaximized(): Promise<void> {
  if (hasElectronAPI()) {
    isMaximized.value = await getElectronAPI().windowIsMaximized();
  }
}

async function handleMinimize(): Promise<void> {
  if (hasElectronAPI()) await getElectronAPI().windowMinimize();
}

async function handleMaximize(): Promise<void> {
  if (hasElectronAPI()) {
    await getElectronAPI().windowMaximize();
    await checkMaximized();
  }
}

async function handleClose(): Promise<void> {
  if (hasElectronAPI()) await getElectronAPI().windowClose();
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
  width: 100%;
  height: 36px;
  -webkit-user-select: none;
  user-select: none;
  background-color: var(--bg-primary);
  // border-bottom: 1px solid var(--border-secondary);

  // ── Drag area ──────────────────────────────────────
  &__drag-area {
    display: flex;
    flex: 1;
    align-items: center;
    justify-content: center;
    height: 100%;
    -webkit-app-region: drag;

    &--win {
      justify-content: flex-start;
      padding-left: 12px;
    }
  }

  &__title {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }

  // ── Controls ───────────────────────────────────────
  &__controls {
    display: flex;
    height: 100%;

    &--win {
      .title-bar__button {
        width: 46px;
        height: 100%;
        color: var(--text-primary);
        cursor: pointer;
        outline: none;
        background: transparent;
        border: none;
        transition: background-color 0.2s;

        &:hover {
          background-color: var(--bg-hover);
        }

        &--close:hover {
          color: white;
          background-color: #e81123;
        }
      }
    }
  }
}
</style>
