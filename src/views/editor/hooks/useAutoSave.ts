import type { Ref } from 'vue';
import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { useEditorStore } from '@/stores/editor';
import { useSettingsStore } from '@/stores/settings';
import { native } from '@/utils/native';

export interface UseAutoSaveOptions {
  content: Ref<string>;
  title: Ref<string>;
  filePath: Ref<string | null>;
  fileName: Ref<string>;
  fileExt: Ref<string>;
}

export interface AutoSaveStatus {
  isSaving: boolean;
  lastSavedAt: number | null;
  error: string | null;
}

export function useAutoSave(options: UseAutoSaveOptions) {
  const { content, title, filePath, fileName, fileExt } = options;

  const editorStore = useEditorStore();
  const settingsStore = useSettingsStore();

  const status = ref<AutoSaveStatus>({
    isSaving: false,
    lastSavedAt: null,
    error: null
  });

  const performAutoSave = async (): Promise<void> => {
    if (!settingsStore.autoSaveEnabled) return;

    if (!filePath.value) return;

    if (!editorStore.isDirty) return;

    status.value.isSaving = true;
    status.value.error = null;

    try {
      const result = await native.autoSave(filePath.value, content.value, fileName.value, fileExt.value);

      if (result.success) {
        status.value.lastSavedAt = Date.now();
        editorStore.markSaved();
      } else {
        status.value.error = result.error || 'Auto save failed';
        console.error('Auto save failed:', result.error);
      }
    } catch (error) {
      status.value.error = error instanceof Error ? error.message : 'Auto save failed';
      console.error('Auto save error:', error);
    } finally {
      status.value.isSaving = false;
    }
  };

  const debouncedAutoSave = useDebounceFn(performAutoSave, settingsStore.autoSaveDelay);

  const stopWatcher = watch(
    [content, title],
    () => {
      if (filePath.value && settingsStore.autoSaveEnabled) {
        debouncedAutoSave();
      }
    },
    { deep: true }
  );

  const saveImmediately = async (): Promise<boolean> => {
    if (!filePath.value) return false;

    await performAutoSave();
    return status.value.error === null;
  };

  const cleanup = (): void => {
    stopWatcher();
  };

  return {
    status,
    saveImmediately,
    cleanup
  };
}
