import type { EditorFile } from '../../../layouts/default/types';
import type { Ref } from 'vue';
import { watch, onUnmounted, ref } from 'vue';
import { debounce } from 'lodash-es';
import { useFilesStore } from '@/stores/files';

export interface AutoSaveOptions {
  delay?: number;
}

export function useAutoSave(fileState: Ref<EditorFile>, options: AutoSaveOptions = {}) {
  const { delay = 500 } = options;

  const filesStore = useFilesStore();
  const isPaused = ref(false);

  async function saveToStorage() {
    if (isPaused.value) return;

    const { content, id } = fileState.value;

    if (content === undefined) return;

    await filesStore.updateFile(id, fileState.value);
  }

  const debouncedSave = debounce(saveToStorage, delay);

  const stopWatch = watch(
    () => fileState.value.content,
    () => !isPaused.value && debouncedSave()
  );

  function pause(): void {
    isPaused.value = true;
  }

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
