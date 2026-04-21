/**
 * @file useFileWatcher.ts
 * @description 管理当前激活编辑器页面的外部文件修改事件处理。
 */

import { onUnmounted, ref } from 'vue';
import { native } from '@/shared/platform';
import type { FileChangeEvent } from '@/shared/platform/native/types';
import { Modal } from '@/utils/modal';

/**
 * 外部文件修改回调。
 */
export interface FileChangedCallback {
  (event: FileChangeEvent): void;
}

/**
 * 当前编辑器脏状态读取回调。
 */
export interface IsDirtyCallback {
  (): boolean;
}

/**
 * 旧版外部文件删除回调类型；阶段一删除事件已交给全局 watcher 处理。
 */
export interface FileDeletedCallback {
  (): void;
}

/**
 * 当前激活编辑器文件监听器，只处理 change 事件和 reload 确认。
 * @returns 当前页面文件监听控制 API
 */
export function useFileWatcher() {
  const watchedPath = ref<string | null>(null);
  const isReloading = ref(false);
  let unsubscribe: (() => void) | null = null;
  let onFileChangedCallback: FileChangedCallback | null = null;
  let isDirtyCallback: IsDirtyCallback | null = null;

  /**
   * 设置外部文件修改回调。
   * @param callback - 文件修改回调
   */
  function setOnFileChanged(callback: FileChangedCallback): void {
    onFileChangedCallback = callback;
  }

  /**
   * 设置当前文件脏状态读取回调。
   * @param callback - 脏状态读取回调
   */
  function setIsDirty(callback: IsDirtyCallback): void {
    isDirtyCallback = callback;
  }

  /**
   * 保留旧 API 兼容调用方；unlink 已由全局 watcher 统一处理。
   * @param callback - 旧版文件删除回调
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function setOnFileDeleted(_callback: FileDeletedCallback): void {
    // unlink 事件由全局 watcher 统一转换为标签 missing 状态。
  }

  /**
   * 切换当前激活页面关注的路径；native watcher 生命周期由全局 store 管理。
   * @param nextPath - 新的当前激活文件路径
   */
  async function switchWatchedFile(nextPath: string | null): Promise<void> {
    if (watchedPath.value === nextPath) return;

    watchedPath.value = null;

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    if (nextPath) {
      watchedPath.value = nextPath;
      // eslint-disable-next-line no-use-before-define
      unsubscribe = native.onFileChanged(handleFileChanged);
    }

    isReloading.value = false;
  }

  /**
   * 清除当前激活页面关注的路径。
   */
  async function clearWatchedFile(): Promise<void> {
    await switchWatchedFile(null);
  }

  /**
   * 获取当前激活页面关注的文件路径。
   * @returns 当前路径，未监听时返回 null
   */
  function getWatchedPath(): string | null {
    return watchedPath.value;
  }

  /**
   * 标记外部重载流程已结束。
   */
  function finishReload(): void {
    isReloading.value = false;
  }

  /**
   * 清理当前页面事件订阅。
   */
  function dispose(): void {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  }

  /**
   * 处理 native 文件事件；阶段一忽略 unlink，由全局 watcher 标记 missing。
   * @param event - 文件变化事件
   */
  async function handleFileChanged(event: FileChangeEvent): Promise<void> {
    if (isReloading.value) return;
    if (event.filePath !== watchedPath.value) return;

    if (event.type === 'change') {
      const isDirty = isDirtyCallback ? isDirtyCallback() : false;

      if (!isDirty && onFileChangedCallback) {
        isReloading.value = true;
        onFileChangedCallback(event);
        return;
      }

      const [cancelled] = await Modal.confirm('外部修改', '当前文件在外部已被修改，是否重新加载新内容？（未保存的更改将丢失）', {
        confirmText: '重新加载',
        cancelText: '忽略'
      });

      if (!cancelled && onFileChangedCallback) {
        isReloading.value = true;
        onFileChangedCallback(event);
      }
    }
  }

  onUnmounted(() => {
    dispose();
  });

  return {
    switchWatchedFile,
    clearWatchedFile,
    getWatchedPath,
    setOnFileChanged,
    setIsDirty,
    setOnFileDeleted,
    finishReload,
    isReloading
  };
}
