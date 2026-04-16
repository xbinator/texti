import { onUnmounted, ref } from 'vue';
import { native } from '@/shared/platform';
import type { FileChangeEvent } from '@/shared/platform/native/types';
import { Modal } from '@/utils/modal';

export interface FileChangedCallback {
  (event: FileChangeEvent): void;
}

export interface IsDirtyCallback {
  (): boolean;
}

export function useFileWatcher() {
  const watchedPath = ref<string | null>(null);
  const isReloading = ref(false);
  let unsubscribe: (() => void) | null = null;
  let onFileChangedCallback: FileChangedCallback | null = null;
  let isDirtyCallback: IsDirtyCallback | null = null;

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
    } else if (event.type === 'unlink') {
      await Modal.alert('文件已删除', '当前文件已被外部程序删除', '知道了');
    }
  }

  function setOnFileChanged(callback: FileChangedCallback): void {
    onFileChangedCallback = callback;
  }

  function setIsDirty(callback: IsDirtyCallback): void {
    isDirtyCallback = callback;
  }

  async function switchWatchedFile(nextPath: string | null): Promise<void> {
    if (watchedPath.value === nextPath) return;

    if (watchedPath.value) {
      await native.unwatchFile();
      watchedPath.value = null;
    }

    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    if (nextPath) {
      await native.watchFile(nextPath);
      watchedPath.value = nextPath;
      unsubscribe = native.onFileChanged(handleFileChanged);
    }

    isReloading.value = false;
  }

  async function clearWatchedFile(): Promise<void> {
    await switchWatchedFile(null);
  }

  function getWatchedPath(): string | null {
    return watchedPath.value;
  }

  function finishReload(): void {
    isReloading.value = false;
  }

  function dispose(): void {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
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
    finishReload,
    isReloading
  };
}
