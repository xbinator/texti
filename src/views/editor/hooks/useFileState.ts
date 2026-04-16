import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { ref, watch } from 'vue';
import type { FileChangeEvent } from '@/shared/platform/native/types';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import { parseFileName } from '../utils/filePath';
import { useAutoSave } from './useAutoSave';

interface SessionPersistenceOptions {
  fileId: Ref<string>;
  fileState: Ref<EditorFile>;
  switchWatchedFile: (nextPath: string | null) => Promise<void>;
  autoSave: ReturnType<typeof useAutoSave>;
  finishReload: () => void;
}

interface SessionPersistenceResult {
  savedContent: Ref<string>;
  ensureStoredFile: () => Promise<void>;
  persistCurrentFile: () => Promise<void>;
  markCurrentContentSaved: () => Promise<void>;
  pauseDirtyTracking: () => void;
  resumeDirtyTracking: () => void;
  handleExternalFileChange: (event: FileChangeEvent) => void;
  finalizeSave: (savedPath: string) => Promise<void>;
  initializeFileState: (stored: EditorFile | undefined, currentFileId: string) => Promise<void>;
}

// 管理编辑器文件在“最近文件存储 / 标签脏状态 / 外部文件同步”之间的状态收口。
export function useFileState(options: SessionPersistenceOptions): SessionPersistenceResult {
  const { fileId, fileState, switchWatchedFile, autoSave, finishReload } = options;
  const filesStore = useFilesStore();
  const tabsStore = useTabsStore();
  // 与当前编辑内容对比，用来判断标签页 dirty 状态和外部变更后的“已保存”基线。
  const savedContent = ref<string>('');
  const isDirtyTrackingPaused = ref(false);

  watch(
    () => fileState.value.content,
    (content) => {
      if (isDirtyTrackingPaused.value) {
        return;
      }

      if (content !== savedContent.value) {
        tabsStore.setDirty(fileId.value);
      } else {
        tabsStore.clearDirty(fileId.value);
      }
    }
  );

  // 确保当前编辑文件在最近文件存储中存在，供显式保存和后续自动保存复用。
  async function ensureStoredFile(): Promise<void> {
    const stored = await filesStore.getFileById(fileState.value.id);
    if (stored) return;

    await filesStore.addFile({ ...fileState.value });
  }

  // 将当前文件状态写回本地存储；如果记录尚未创建则补建，避免新文件首次自动保存丢失。
  async function persistCurrentFile(): Promise<void> {
    const current = { ...fileState.value };
    const stored = await filesStore.getFileById(current.id);

    if (stored) {
      await filesStore.updateFile(current.id, current);
      return;
    }

    // 新建文件的首次自动保存可能发生在初始化写入完成前，这里兜底补建记录。
    await filesStore.addFile(current);
  }

  // 外部文件变化被接受后，统一从这里回填内容并重置“已保存”基线。
  function handleExternalFileChange(event: FileChangeEvent): void {
    if (event.type !== 'change' || event.content === undefined) return;

    // 外部内容回填时先暂停自动保存，避免把“重新加载的内容”当成用户输入再次写回。
    autoSave.pause();
    fileState.value.content = event.content;
    savedContent.value = event.content;
    tabsStore.clearDirty(fileId.value);
    persistCurrentFile();
    finishReload();
    autoSave.resume();
  }

  // 显式保存成功后，统一更新“已保存”基线、dirty 状态和最近文件存储。
  async function markCurrentContentSaved(): Promise<void> {
    savedContent.value = fileState.value.content;
    tabsStore.clearDirty(fileId.value);
    await persistCurrentFile();
  }

  function pauseDirtyTracking(): void {
    isDirtyTrackingPaused.value = true;
  }

  function resumeDirtyTracking(): void {
    isDirtyTrackingPaused.value = false;
  }

  // 文件成功保存到磁盘后，同步路径、文件名和本地存储，并切换文件监听目标。
  async function finalizeSave(savedPath: string): Promise<void> {
    const { name, ext } = parseFileName(savedPath);

    fileState.value.path = savedPath;
    fileState.value.name = name || fileState.value.name;
    fileState.value.ext = ext || fileState.value.ext || 'md';
    await markCurrentContentSaved();
    await switchWatchedFile(savedPath);
  }

  // 加载编辑文件时，优先恢复存储中的草稿；没有记录时创建一个新的空文件状态。
  async function initializeFileState(stored: EditorFile | undefined, currentFileId: string): Promise<void> {
    if (stored) {
      fileState.value = { ...stored };
    } else {
      // 先把新文件写入最近文件存储，避免首轮自动保存更新不到记录。
      fileState.value = { id: currentFileId, name: '未命名', content: '', ext: 'md', path: null };
      await filesStore.addFile({ ...fileState.value });
    }

    savedContent.value = fileState.value.content;
    tabsStore.clearDirty(currentFileId);
  }

  return {
    savedContent,
    ensureStoredFile,
    persistCurrentFile,
    markCurrentContentSaved,
    pauseDirtyTracking,
    resumeDirtyTracking,
    handleExternalFileChange,
    finalizeSave,
    initializeFileState
  };
}
