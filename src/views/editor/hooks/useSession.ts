import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import { native } from '@/shared/platform';
import type { ReadFileResult } from '@/shared/platform/native/types';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import { Modal } from '@/utils/modal';
import { getDefaultSavePath, parseFileName, replaceFileName } from '../utils/filePath';
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
  const { switchWatchedFile, clearWatchedFile, setOnFileChanged, setIsDirty, finishReload } = useFileWatcher();

  const fileState = ref<EditorFile>({ id: '', name: '', content: '', ext: 'md', path: null });
  const viewState = reactive<{ mode: ViewMode; showOutline: boolean }>({ mode: 'rich', showOutline: true });

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

  setIsDirty(() => tabsStore.isDirty(fileId.value));

  function updateTab() {
    if (!fileId.value) return;

    tabsStore.addTab({ id: fileId.value, path: route.fullPath, title: currentTitle.value });
  }

  setOnFileChanged(fileStateActions.handleExternalFileChange);

  async function onSave() {
    await fileStateActions.ensureStoredFile();

    if (fileState.value.path) {
      await native.writeFile(fileState.value.path, fileState.value.content);
      await fileStateActions.markCurrentContentSaved();
      return;
    }

    const savedPath = await native.saveFile(fileState.value.content, undefined, { defaultPath: getDefaultSavePath(fileState.value) });

    if (!savedPath) return;

    await fileStateActions.finalizeSave(savedPath);
  }

  async function onSaveAs() {
    await fileStateActions.ensureStoredFile();

    const savedPath = await native.saveFile(fileState.value.content, undefined, { defaultPath: getDefaultSavePath(fileState.value) });

    if (!savedPath) return;

    await fileStateActions.finalizeSave(savedPath);
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

  async function onDelete() {
    autoSave.pause();

    const path = fileState.value.path || '';

    const [cancelled] = await Modal.delete(path ? `确定要删除文件 "${currentTitle.value}" 吗？` : `确定要删除未保存文档 "${currentTitle.value}" 吗？`);

    if (cancelled) return;

    if (path) {
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
      await switchWatchedFile(fileState.value.path);

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

  watch([fileId, () => route.fullPath, () => fileState.value.name], updateTab);

  async function dispose(): Promise<void> {
    await clearWatchedFile();
  }

  onUnmounted(() => {
    dispose();
  });

  const actions = { onSave, onSaveAs, onRename, onDelete, onShowInFolder, onDuplicate };

  return {
    fileState,
    viewState,
    currentTitle,
    actions,
    loadFileState,
    dispose
  };
}
