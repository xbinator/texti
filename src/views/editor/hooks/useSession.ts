import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { computed, nextTick, onActivated, onDeactivated, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import { useClipboard } from '@/hooks/useClipboard';
import { resolveRouteCacheKey } from '@/router/cache';
import { native } from '@/shared/platform';
import type { ReadFileResult } from '@/shared/platform/native/types';
import { useEditorFileWatchStore } from '@/stores/editorFileWatch';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import { Modal } from '@/utils/modal';
import { getDefaultSavePath, getRecoveredSavePath, parseFileName, replaceFileName } from '../utils/filePath';
import { resolveFileReconcileAction } from '../utils/reconcileFileContent';
import { useAutoSave } from './useAutoSave';
import { useFileState } from './useFileState';
import { useFileWatcher } from './useFileWatcher';

type ViewMode = 'rich' | 'source';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

export function useSession(fileId: Ref<string>) {
  const route = useRoute();
  const router = useRouter();

  const tabsStore = useTabsStore();
  const filesStore = useFilesStore();
  const fileWatchStore = useEditorFileWatchStore();
  const { clipboard } = useClipboard();
  const { switchWatchedFile, clearWatchedFile, setOnFileChanged, setIsDirty, finishReload } = useFileWatcher();

  const sessionPath = ref(route.fullPath);
  const sessionCacheKey = ref(resolveRouteCacheKey(route));
  const fileState = ref<EditorFile>({ id: '', name: '', content: '', ext: 'md', path: null });
  const viewState = reactive<{ mode: ViewMode; showOutline: boolean }>({ mode: 'rich', showOutline: true });
  const isActive = ref(true);

  const autoSave = useAutoSave(fileState);

  const currentTitle = computed(() => fileState.value.name || '未命名');
  // 文件状态相关的存储同步、保存收尾和外部文件回填都收口到这里，useSession 只做流程编排。
  const fileStateActions = useFileState({
    fileId,
    fileState,
    switchWatchedFile,
    autoSave,
    finishReload
  });
  // 用版本号丢弃过期的异步加载结果，避免快速切换标签时旧请求覆盖新文件状态。
  let loadVersion = 0;
  // 记录当前会话已经注册到全局 watcher 的文件 ID，避免路由复用时旧 ID 残留。
  let registeredWatchFileId: string | null = null;

  setIsDirty(() => tabsStore.isDirty(fileId.value));

  /**
   * 同步当前会话在全局 watcher 中的路径引用。
   * @param currentFileId - 当前编辑器文件 ID
   * @param filePath - 当前文件磁盘路径
   */
  async function syncGlobalWatch(currentFileId: string, filePath: string | null): Promise<void> {
    if (registeredWatchFileId && registeredWatchFileId !== currentFileId) {
      await fileWatchStore.unregister(registeredWatchFileId);
      registeredWatchFileId = null;
    }

    if (!filePath) {
      if (registeredWatchFileId === currentFileId) {
        await fileWatchStore.unregister(currentFileId);
        registeredWatchFileId = null;
      }
      return;
    }

    await fileWatchStore.register(currentFileId, filePath);
    registeredWatchFileId = currentFileId;
  }

  /**
   * 更新当前会话在全局 watcher 中的路径引用。
   * @param currentFileId - 当前编辑器文件 ID
   * @param filePath - 新的磁盘路径
   */
  async function updateGlobalWatchPath(currentFileId: string, filePath: string): Promise<void> {
    if (registeredWatchFileId && registeredWatchFileId !== currentFileId) {
      await fileWatchStore.unregister(registeredWatchFileId);
    }

    await fileWatchStore.updatePath(currentFileId, filePath);
    registeredWatchFileId = currentFileId;
  }

  /**
   * 释放当前会话在全局 watcher 中的路径引用。
   */
  async function unregisterGlobalWatch(): Promise<void> {
    if (!registeredWatchFileId) return;

    await fileWatchStore.unregister(registeredWatchFileId);
    registeredWatchFileId = null;
  }

  function updateTab() {
    if (!fileId.value) return;

    tabsStore.addTab({ id: fileId.value, path: sessionPath.value, title: currentTitle.value, cacheKey: sessionCacheKey.value });
  }

  setOnFileChanged(fileStateActions.handleExternalFileChange);

  /**
   * 通过保存对话框选择目标路径并完成文件保存。
   * @returns 是否保存成功
   */
  async function saveWithDialog(defaultPathOverride?: string): Promise<boolean> {
    const defaultPath = defaultPathOverride || fileState.value.path || getDefaultSavePath(fileState.value);
    const savedPath = await native.saveFile(fileState.value.content, undefined, { defaultPath });

    if (!savedPath) return false;

    await fileStateActions.finalizeSave(savedPath);
    await updateGlobalWatchPath(fileId.value, savedPath);
    tabsStore.clearMissing(fileId.value);
    return true;
  }

  /**
   * 检查指定路径当前是否已有可读文件。
   * @param filePath - 需要检查的文件路径
   * @returns 文件是否存在且可读
   */
  async function isReadableFilePath(filePath: string): Promise<boolean> {
    try {
      await native.readFile(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 将当前编辑内容写回已有路径，并恢复标签和文件监听状态。
   * @param filePath - 写入目标路径
   */
  async function restoreCurrentFileAtPath(filePath: string): Promise<void> {
    await native.writeFile(filePath, fileState.value.content);
    await fileStateActions.markCurrentContentSaved();
    await switchWatchedFile(filePath);
    await updateGlobalWatchPath(fileId.value, filePath);
    tabsStore.clearMissing(fileId.value);
  }

  /**
   * 保存已被外部删除的文件，优先恢复原路径，无法恢复时再走另存为。
   */
  async function saveMissingFile(): Promise<void> {
    const originalPath = fileState.value.path;

    if (!originalPath) {
      await saveWithDialog();
      return;
    }

    if (await isReadableFilePath(originalPath)) {
      const [cancelled] = await Modal.confirm('文件已存在', '原文件路径已重新出现同名文件。是否覆盖它？', {
        confirmText: '覆盖',
        cancelText: '取消'
      });

      if (cancelled) {
        return;
      }
    }

    try {
      await restoreCurrentFileAtPath(originalPath);
    } catch {
      await saveWithDialog(getRecoveredSavePath(originalPath));
    }
  }

  async function onSave() {
    await fileStateActions.ensureStoredFile();

    if (tabsStore.isMissing(fileId.value)) {
      await saveMissingFile();
      return;
    }

    if (fileState.value.path) {
      await native.writeFile(fileState.value.path, fileState.value.content);
      await fileStateActions.markCurrentContentSaved();
      tabsStore.clearMissing(fileId.value);
      return;
    }

    await saveWithDialog();
  }

  async function onSaveAs() {
    await fileStateActions.ensureStoredFile();

    await saveWithDialog();
  }

  async function onRename() {
    await fileStateActions.ensureStoredFile();

    const [cancelled, newName] = await Modal.input('重命名', { defaultValue: fileState.value.name, placeholder: '请输入文件名' });

    const normalizedName = String(newName || '').trim();

    if (cancelled || !normalizedName || normalizedName === fileState.value.name) {
      return;
    }

    if (fileState.value.path) {
      const nextPath = replaceFileName(fileState.value.path, normalizedName, fileState.value.ext);

      await native.renameFile(fileState.value.path, nextPath);
      fileState.value.path = nextPath;
      await switchWatchedFile(nextPath);
      await updateGlobalWatchPath(fileId.value, nextPath);
    }

    fileState.value.name = normalizedName;
    await fileStateActions.persistCurrentFile();
  }

  async function onDuplicate() {
    const nextId = nanoid();
    const nextName = fileState.value.name ? `${fileState.value.name}-副本` : '';

    await filesStore.addFile({ ...fileState.value, id: nextId, name: nextName, path: null, savedContent: fileState.value.content });

    await router.push({ name: 'editor', params: { id: nextId } });
  }

  async function onShowInFolder() {
    if (!fileState.value.path) {
      return;
    }

    await native.showItemInFolder(fileState.value.path);
  }

  /**
   * 复制当前文件绝对路径。
   */
  async function onCopyPath(): Promise<void> {
    if (!fileState.value.path) {
      return;
    }

    await clipboard(fileState.value.path, { successMessage: '已复制路径', trim: false });
  }

  /**
   * 复制相对当前工作目录的路径。
   */
  async function onCopyRelativePath(): Promise<void> {
    if (!fileState.value.path) {
      return;
    }

    const relativePath = await native.getRelativePath(fileState.value.path);
    const normalizedPath = relativePath || fileState.value.path;
    await clipboard(normalizedPath, { successMessage: '已复制相对路径', trim: false });
  }

  async function onDelete() {
    autoSave.pause();

    const path = fileState.value.path || '';

    const [cancelled] = await Modal.delete(path ? `确定要删除文件 "${currentTitle.value}" 吗？` : `确定要删除未保存文档 "${currentTitle.value}" 吗？`);

    if (cancelled) return;

    if (path) {
      await unregisterGlobalWatch();
      await clearWatchedFile();
      // 删除文件
      await native.trashFile(path);
    }
    // 删除关联的文件
    await filesStore.removeFile(fileId.value);
    // 删除关联的标签页
    tabsStore.removeTab(fileId.value);

    await router.push('/welcome');
  }

  async function applyDiskState(diskFile: ReadFileResult): Promise<void> {
    const diskMeta = fileState.value.path ? parseFileName(fileState.value.path) : { name: fileState.value.name, ext: fileState.value.ext };

    fileState.value.content = diskFile.content;
    fileState.value.name = diskMeta.name || fileState.value.name;
    fileState.value.ext = diskMeta.ext || diskFile.ext || fileState.value.ext;
    fileStateActions.savedContent.value = diskFile.content;
    tabsStore.clearDirty(fileId.value);
    await fileStateActions.persistCurrentFile();
  }

  async function reconcileStoredFileWithDisk() {
    if (!fileState.value.path) return;

    let diskFile: ReadFileResult;

    try {
      diskFile = await native.readFile(fileState.value.path);
    } catch {
      return;
    }

    if (!fileStateActions.hasSavedContentBaseline.value) {
      fileStateActions.savedContent.value = diskFile.content;
      fileStateActions.hasSavedContentBaseline.value = true;
      fileStateActions.syncDirtyState();
      await fileStateActions.persistCurrentFile();
      return;
    }

    const currentContent = fileState.value.content;
    const lastSavedContent = fileStateActions.savedContent.value;
    const diskMeta = parseFileName(fileState.value.path);
    const action = resolveFileReconcileAction({
      currentContent,
      savedContent: lastSavedContent,
      currentName: fileState.value.name,
      currentExt: fileState.value.ext,
      diskFile,
      diskName: diskMeta.name,
      diskExt: diskMeta.ext
    });

    if (action === 'keepDraft') {
      return;
    }

    if (action === 'markSaved') {
      fileStateActions.savedContent.value = currentContent;
      tabsStore.clearDirty(fileId.value);
      await fileStateActions.persistCurrentFile();
      return;
    }

    if (currentContent === lastSavedContent) {
      await applyDiskState(diskFile);
      return;
    }

    const [cancelled] = await Modal.confirm('发现内容冲突', '当前文件有未保存草稿，同时磁盘内容也已变化。是否使用磁盘中的最新内容？', {
      confirmText: '使用磁盘内容',
      cancelText: '保留本地草稿'
    });

    if (!cancelled) {
      await applyDiskState(diskFile);
    }
  }

  async function loadFileState() {
    // 增加版本号，标记当前加载请求
    const currentVersion = ++loadVersion;
    // 暂停自动保存，避免在加载过程中触发保存
    autoSave.pause();
    // 页面切换后的初始化回填不应该被视为用户修改。
    fileStateActions.pauseDirtyTracking();

    try {
      // 记录当前文件ID，避免在异步操作过程中文件ID发生变化
      const currentFileId = fileId.value;

      const stored = await filesStore.getFileById(currentFileId);
      // 检查版本号，如果版本不匹配则终止（说明有更新的加载请求）
      if (currentVersion !== loadVersion) return;

      // 初始化文件状态
      await fileStateActions.initializeFileState(stored, currentFileId);

      // 再次检查版本号
      if (currentVersion !== loadVersion) return;
      await reconcileStoredFileWithDisk();

      // 再次检查版本号
      if (currentVersion !== loadVersion) return;
      // 切换文件监听器到新文件
      await syncGlobalWatch(currentFileId, fileState.value.path);
      if (isActive.value) {
        await switchWatchedFile(fileState.value.path);
      }

      // 检查版本号
      if (currentVersion !== loadVersion) return;
      // 等待 Vue 更新周期完成
      await nextTick();
    } finally {
      // 只有当前请求仍然有效时才恢复跟踪，避免旧请求提前解除新请求的保护。
      if (currentVersion === loadVersion) {
        fileStateActions.resumeDirtyTracking();
        autoSave.resume();
      }
    }
  }

  watch(fileId, () => loadFileState(), { immediate: true });

  watch([fileId, () => fileState.value.name], updateTab);

  /**
   * 激活缓存中的编辑器实例，并接管当前文件监听。
   */
  async function activate(): Promise<void> {
    isActive.value = true;
    await switchWatchedFile(fileState.value.path);
  }

  /**
   * 停用缓存中的编辑器实例，并释放当前文件监听。
   */
  async function deactivate(): Promise<void> {
    isActive.value = false;
    await clearWatchedFile();
  }

  async function dispose(): Promise<void> {
    await unregisterGlobalWatch();
    await clearWatchedFile();
  }

  onActivated(() => {
    activate();
  });

  onDeactivated(() => {
    deactivate();
  });

  onUnmounted(() => {
    dispose();
  });

  const actions = { onSave, onSaveAs, onRename, onDelete, onShowInFolder, onCopyPath, onCopyRelativePath, onDuplicate };

  return {
    fileState,
    viewState,
    currentTitle,
    actions,
    loadFileState,
    dispose
  };
}
