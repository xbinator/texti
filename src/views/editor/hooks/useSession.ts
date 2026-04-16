import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import { native } from '@/shared/platform';
import { useFilesStore } from '@/stores/files';
import { useTabsStore } from '@/stores/tabs';
import { Modal } from '@/utils/modal';
import { getDefaultSavePath, replaceFileName } from '../utils/filePath';
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

  async function onSave(): Promise<void> {
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

  async function onSaveAs(): Promise<void> {
    await fileStateActions.ensureStoredFile();

    const savedPath = await native.saveFile(fileState.value.content, undefined, { defaultPath: getDefaultSavePath(fileState.value) });

    if (!savedPath) return;

    await fileStateActions.finalizeSave(savedPath);
  }

  async function onRename(): Promise<void> {
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

  async function onDuplicate(): Promise<void> {
    const nextId = nanoid();
    const nextName = fileState.value.name ? `${fileState.value.name}-副本` : '';

    await filesStore.addFile({ ...fileState.value, id: nextId, name: nextName, path: null });

    await router.push({ name: 'editor', params: { id: nextId } });
  }

  async function loadFileState(): Promise<void> {
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

  const actions = { onSave, onSaveAs, onRename, onDuplicate };

  return {
    fileState,
    viewState,
    currentTitle,
    actions,
    loadFileState,
    dispose
  };
}
