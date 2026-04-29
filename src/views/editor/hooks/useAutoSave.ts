/**
 * @file useAutoSave.ts
 * @description 处理编辑器草稿自动保存，并在内容变更时维护 modifiedAt。
 */

import type { EditorFile } from '../../../layouts/default/types';
import type { Ref } from 'vue';
import { watch, onUnmounted, ref } from 'vue';
import { debounce } from 'lodash-es';
import { useFilesStore } from '@/stores/files';

export interface AutoSaveOptions {
  delay?: number;
}

/**
 * 创建编辑器自动保存逻辑。
 * @param fileState - 当前编辑文件状态
 * @param options - 自动保存配置
 * @returns 自动保存控制器
 */
export function useAutoSave(fileState: Ref<EditorFile>, options: AutoSaveOptions = {}) {
  const { delay = 500 } = options;

  const filesStore = useFilesStore();
  const isPaused = ref(false);

  /**
   * 将当前内容写回最近文件存储，并仅更新内容相关时间字段。
   */
  async function saveToStorage() {
    if (isPaused.value) return;

    const { content, id } = fileState.value;

    if (content === undefined) return;

    const stored = await filesStore.getFileById(id);
    const modifiedAt = Date.now();

    if (stored) {
      await filesStore.updateFile(id, { ...fileState.value, modifiedAt });
      return;
    }

    await filesStore.addFile({ ...fileState.value, createdAt: modifiedAt, modifiedAt });
  }

  const debouncedSave = debounce(saveToStorage, delay);

  const stopWatch = watch(
    () => fileState.value.content,
    () => !isPaused.value && debouncedSave()
  );

  /**
   * 暂停自动保存。
   */
  function pause(): void {
    isPaused.value = true;
  }

  /**
   * 恢复自动保存。
   */
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
