<!--
  @file HeaderUpdateNotice.vue
  @description 在标题栏右侧展示可关闭的 GitHub Release 更新提示。
-->
<template>
  <div v-if="updateInfo" class="header-update-notice">
    <button class="header-update-notice__link" @click="handleOpenRelease">
      <Icon icon="tabler:tag" width="14" height="14" />
      <span class="header-update-notice__text">可更新 {{ updateInfo.latestVersion }}</span>
    </button>
    <button class="header-update-notice__close" @click="handleDismiss">
      <Icon icon="tabler:x" width="13" height="13" />
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * @file HeaderUpdateNotice.vue
 * @description 标题栏更新提示组件，负责检查更新、打开 Release 页面与永久关闭提示。
 */
import type { ElectronUpdateAvailableResult } from 'types/electron-api';
import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { Icon } from '@iconify/vue';
import { getElectronAPI } from '@/shared/platform/electron-api';

const DISMISS_STORAGE_KEY = 'tibis:update-notice-dismissed';
/** 延迟检查更新，避免应用启动首屏阶段抢占 IPC 与网络资源。 */
const UPDATE_CHECK_STARTUP_DELAY_MS = 2500;

/** 当前可展示的更新信息。 */
const updateInfo = shallowRef<ElectronUpdateAvailableResult | null>(null);
/** 延迟检查更新的定时器 ID。 */
let updateCheckTimer: number | null = null;

/**
 * 判断用户是否已永久关闭更新提示。
 * @returns 已关闭时返回 true
 */
function hasDismissedUpdateNotice(): boolean {
  return window.localStorage.getItem(DISMISS_STORAGE_KEY) === 'true';
}

/**
 * 永久记录用户不再查看更新提示。
 */
function persistDismissedUpdateNotice(): void {
  window.localStorage.setItem(DISMISS_STORAGE_KEY, 'true');
}

/**
 * 检查 GitHub Release 是否有新版本。
 */
async function checkUpdateNotice(): Promise<void> {
  if (hasDismissedUpdateNotice()) {
    return;
  }

  try {
    const result = await getElectronAPI().checkForUpdate();

    if (result.available) {
      updateInfo.value = result;
    }
  } catch (_error: unknown) {
    // 更新检查失败不影响主工作流，保持标题栏安静即可。
  }
}

/**
 * 打开 GitHub Release 下载页。
 */
async function handleOpenRelease(): Promise<void> {
  if (!updateInfo.value) {
    return;
  }

  await getElectronAPI().openExternal(updateInfo.value.releaseUrl);
}

/**
 * 用户主动关闭提示后永久隐藏。
 */
function handleDismiss(): void {
  persistDismissedUpdateNotice();
  updateInfo.value = null;
}

onMounted(() => {
  updateCheckTimer = window.setTimeout(() => {
    updateCheckTimer = null;
    Promise.resolve(checkUpdateNotice()).catch(() => undefined);
  }, UPDATE_CHECK_STARTUP_DELAY_MS);
});

onBeforeUnmount(() => {
  if (updateCheckTimer) {
    window.clearTimeout(updateCheckTimer);
    updateCheckTimer = null;
  }
});
</script>

<style lang="less">
.header-update-notice {
  position: relative;
  display: flex;
  align-items: center;
  height: 22px;
  color: var(--color-primary);
  background: color-mix(in srgb, var(--color-primary-bg) 72%, transparent);
  border: var(--control-border-width) solid color-mix(in srgb, var(--color-primary-border) 82%, transparent);
  border-radius: var(--radius-full);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 28%);
  -webkit-app-region: no-drag;
}

.header-update-notice:hover {
  background: var(--color-primary-bg);
  border-color: var(--color-primary-border);
}

.header-update-notice__link,
.header-update-notice__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0;
  color: inherit;
  cursor: pointer;
  outline: none;
  background: transparent;
  border: 0;
  transition: background var(--motion-duration-fast) var(--motion-easing-standard);
}

.header-update-notice__link {
  gap: 4px;
  min-width: 0;
  max-width: 142px;
  padding: 0 8px;
  border-radius: var(--radius-full);
}

.header-update-notice__link:hover {
  color: var(--color-primary-hover);
}

.header-update-notice__text {
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.header-update-notice__close {
  position: absolute;
  top: -5px;
  right: -5px;
  width: 14px;
  height: 14px;
  color: var(--text-tertiary);
  pointer-events: none;
  background: var(--bg-primary);
  border-radius: var(--radius-full);
  box-shadow: var(--shadow-sm);
  opacity: 0;
  transform: scale(0.82) translate(2px, -2px);
  transition: color var(--motion-duration-fast) var(--motion-easing-standard), opacity var(--motion-duration-fast) var(--motion-easing-standard),
    transform var(--motion-duration-fast) var(--motion-easing-standard), background var(--motion-duration-fast) var(--motion-easing-standard);
}

.header-update-notice:hover .header-update-notice__close {
  pointer-events: auto;
  opacity: 1;
  transform: scale(1) translate(0, 0);
}

.header-update-notice__close:hover {
  color: var(--color-danger);
  background: var(--color-danger-bg);
}
</style>
