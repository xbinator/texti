import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { ref, watch } from 'vue';
import type { FileChangeEvent } from '@/shared/platform/native/types';
import type { StoredFile } from '@/shared/storage/files/types';
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
  hasSavedContentBaseline: Ref<boolean>;
  ensureStoredFile: () => Promise<void>;
  persistCurrentFile: () => Promise<void>;
  markCurrentContentSaved: (savedAt?: number) => Promise<void>;
  pauseDirtyTracking: () => void;
  resumeDirtyTracking: () => void;
  syncDirtyState: () => void;
  handleExternalFileChange: (event: FileChangeEvent) => void;
  finalizeSave: (savedPath: string) => Promise<void>;
  initializeFileState: (stored: StoredFile | undefined, currentFileId: string) => Promise<void>;
}

/**
 * 管理编辑器文件在“最近文件存储 / 标签脏状态 / 外部文件同步”之间的状态收口。
 * @param options - 会话持久化依赖项
 * @returns 编辑器文件状态持久化控制器
 */
export function useFileState(options: SessionPersistenceOptions): SessionPersistenceResult {
  const { fileId, fileState, switchWatchedFile, autoSave, finishReload } = options;
  const filesStore = useFilesStore();
  const tabsStore = useTabsStore();
  // 与当前编辑内容对比，用来判断标签页 dirty 状态和外部变更后的“已保存”基线。
  const savedContent = ref<string>('');
  const hasSavedContentBaseline = ref(false);
  const isDirtyTrackingPaused = ref(false);

  /**
   * 生成当前编辑状态对应的存储记录。
   * @returns 用于持久化的文件记录
   */
  function toStoredFile(): StoredFile {
    return {
      ...fileState.value,
      savedContent: savedContent.value
    };
  }

  /**
   * 根据当前内容与基线同步标签页脏状态。
   */
  function syncDirtyState(): void {
    if (!hasSavedContentBaseline.value) {
      tabsStore.clearDirty(fileId.value);
      return;
    }

    if (fileState.value.content !== savedContent.value) {
      tabsStore.setDirty(fileId.value);
    } else {
      tabsStore.clearDirty(fileId.value);
    }
  }

  watch(
    () => fileState.value.content,
    () => {
      if (isDirtyTrackingPaused.value) {
        return;
      }

      syncDirtyState();
    }
  );

  // 确保当前编辑文件在最近文件存储中存在，供显式保存和后续自动保存复用。
  async function ensureStoredFile(): Promise<void> {
    const stored = await filesStore.getFileById(fileState.value.id);
    if (stored) return;

    await filesStore.addFile(toStoredFile());
  }

  // 将当前文件状态写回本地存储；如果记录尚未创建则补建，避免新文件首次自动保存丢失。
  async function persistCurrentFile(): Promise<void> {
    const current = toStoredFile();
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
    hasSavedContentBaseline.value = true;
    tabsStore.clearDirty(fileId.value);
    persistCurrentFile().catch((error: unknown) => {
      console.error('Failed to persist externally changed file:', error);
    });
    finishReload();
    autoSave.resume();
  }

  // 显式保存成功后，统一更新“已保存”基线、dirty 状态和最近文件存储。
  async function markCurrentContentSaved(savedAt = Date.now()): Promise<void> {
    savedContent.value = fileState.value.content;
    hasSavedContentBaseline.value = true;
    syncDirtyState();

    const current = toStoredFile();
    const stored = await filesStore.getFileById(current.id);

    if (stored) {
      await filesStore.updateFile(current.id, {
        ...current,
        savedContent: current.content,
        savedAt
      });
      return;
    }

    await filesStore.addFile({
      ...current,
      savedContent: current.content,
      createdAt: savedAt,
      savedAt
    });
  }

  /**
   * 暂停 dirty 状态跟踪。
   */
  function pauseDirtyTracking(): void {
    isDirtyTrackingPaused.value = true;
  }

  /**
   * 恢复 dirty 状态跟踪。
   */
  function resumeDirtyTracking(): void {
    isDirtyTrackingPaused.value = false;
  }

  // 文件成功保存到磁盘后，同步路径、文件名和本地存储，并切换文件监听目标。
  async function finalizeSave(savedPath: string): Promise<void> {
    const savedAt = Date.now();
    const { name, ext } = parseFileName(savedPath);

    fileState.value.path = savedPath;
    fileState.value.name = name || fileState.value.name;
    fileState.value.ext = ext || fileState.value.ext || 'md';
    await markCurrentContentSaved(savedAt);
    await switchWatchedFile(savedPath);
  }

  // 加载编辑文件时，优先恢复存储中的草稿；没有记录时创建一个新的空文件状态。
  async function initializeFileState(stored: StoredFile | undefined, currentFileId: string): Promise<void> {
    if (stored) {
      fileState.value = { ...stored };
    } else {
      // 先把新文件写入最近文件存储，避免首轮自动保存更新不到记录。
      fileState.value = { id: currentFileId, name: '未命名', content: '', ext: 'md', path: null };
      await filesStore.addFile({ ...fileState.value, savedContent: fileState.value.content });
    }

    hasSavedContentBaseline.value = stored?.savedContent !== undefined || !fileState.value.path;
    savedContent.value = stored?.savedContent ?? fileState.value.content;
    syncDirtyState();
  }

  return {
    savedContent,
    hasSavedContentBaseline,
    ensureStoredFile,
    persistCurrentFile,
    markCurrentContentSaved,
    pauseDirtyTracking,
    resumeDirtyTracking,
    syncDirtyState,
    handleExternalFileChange,
    finalizeSave,
    initializeFileState
  };
}
