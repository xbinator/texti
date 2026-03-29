import type { Ref } from 'vue';
import { watch, onUnmounted, ref } from 'vue';
import { debounce } from 'lodash-es';
import { indexedDBStorage } from '@/utils/storage';

export interface AutoSaveOptions {
  delay?: number;
}

export interface AutoSaveFile {
  path?: string | null;
  content?: string;
  name?: string;
  ext?: string;
}

export function useAutoSave(fileState: Ref<AutoSaveFile>, options: AutoSaveOptions = {}) {
  const { delay = 500 } = options;

  const isPaused = ref(false);

  async function saveToStorage() {
    if (isPaused.value) return;

    const { path, content, name, ext } = fileState.value;

    if (!path || content === undefined) return;

    await indexedDBStorage.updateRecentFile({ path, content, name: name ?? '', ext: ext ?? '' });
  }

  const debouncedSave = debounce(saveToStorage, delay);

  const stopWatch = watch(
    () => [fileState.value.name, fileState.value.content],
    () => {
      if (!(fileState.value.path && !isPaused.value)) return;

      debouncedSave();
    }
  );

  // 暂停自动保存
  function pause(): void {
    isPaused.value = true;
  }

  // 恢复自动保存
  function resume(): void {
    isPaused.value = false;
  }

  onUnmounted(() => {
    stopWatch();

    !isPaused.value && saveToStorage();
  });

  return {
    save: saveToStorage,
    debouncedSave,
    isPaused,
    pause,
    resume
  };
}
