import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { computed, ref, onMounted, nextTick } from 'vue';
import { customAlphabet } from 'nanoid';
import type { Props as ToolbarProps } from '@/components/Toolbar.vue';
import { isTauri, isWeb } from '@/utils/is';
import { Modal } from '@/utils/modal';
import { native } from '@/utils/native';
import { indexedDB, StoredFile } from '@/utils/storage';

interface UseFileActiveOptions {
  // 暂停自动保存
  pause: () => void;
  // 恢复自动保存
  resume: () => void;
}

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 6);

export function useFileActive(fileState: Ref<EditorFile>, options: UseFileActiveOptions) {
  const canSave = computed(() => fileState.value.path !== undefined);

  const recentFiles = ref<{ missing: EditorFile[]; list: EditorFile[] }>({ missing: [], list: [] });

  async function loadRecentFiles() {
    const files = await indexedDB.getAllRecentFiles();

    recentFiles.value = { missing: files.filter((file) => file.path), list: files };
  }

  function setFileState(file: EditorFile): void {
    options.pause();

    fileState.value = file;
    file.id && indexedDB.setCurrentFile(file.id);

    native.setWindowTitle(`${file.name || '未命名文件'}.${file.ext || 'md'}`);

    nextTick(() => options.resume());
  }

  async function restoreCurrentFile(): Promise<void> {
    const currentId = await indexedDB.getCurrentFileId();
    if (currentId) {
      const stored = await indexedDB.getRecentFile(currentId);
      stored && setFileState(stored);
    }

    if (!fileState.value.id) {
      const _file = { path: '', name: '', ext: 'md', content: '', id: nanoid(6) };
      await indexedDB.addRecentFile(_file as StoredFile);

      setFileState(_file);
    }

    loadRecentFiles();
  }

  onMounted(() => {
    restoreCurrentFile();
  });

  // 持久化并更新当前文件状态
  async function applyFileUpdate(id: string, updated: EditorFile): Promise<void> {
    await indexedDB.updateRecentFile(id, updated as StoredFile);
    setFileState(updated);
  }

  // 桌面端：弹系统对话框另存，成功后更新状态
  async function tauriSaveAs(): Promise<void> {
    const { id, name, ext, content } = fileState.value;
    const defaultPath = `${name || '未命名'}.${ext || 'md'}`;
    const savedPath = await native.saveFile(content, undefined, { defaultPath });
    if (!savedPath) return;

    const fileName = savedPath.split(/[/\\]/).pop() ?? '';
    const [, savedName, savedExt] = /^(.+?)(?:\.([^.]+))?$/.exec(fileName) || ['', '', ''];
    await applyFileUpdate(id, { ...fileState.value, path: savedPath, name: savedName, ext: savedExt });
  }

  const toolbarFileOptions = computed<ToolbarProps['options']>(() => [
    {
      value: 'new',
      label: '新建',
      shortcut: 'Ctrl+N',
      onClick: async () => {
        // 移除所有未保存的文件
        const ids = recentFiles.value.list.filter((v) => !v.path).map((v) => v.id);
        await indexedDB.removeRecentFile(...ids);

        const _file = { path: '', name: '', ext: 'md', content: '', id: nanoid(6) };
        await indexedDB.addRecentFile(_file as StoredFile);

        setFileState(_file);
        loadRecentFiles();
      }
    },
    { type: 'divider' },
    {
      value: 'open',
      label: '打开',
      shortcut: 'Ctrl+O',
      onClick: async () => {
        const file = await native.openFile();
        if (!file.path) return;

        const ids = recentFiles.value.list.filter((v) => !v.path).map((v) => v.id);
        await indexedDB.removeRecentFile(...ids);

        const _file = { ...file, id: nanoid(6) };
        await indexedDB.addRecentFile(_file as StoredFile);

        loadRecentFiles();
        setFileState(_file);
      }
    },
    {
      value: 'recent',
      label: '打开最近的文件',
      disabled: !recentFiles.value.missing.length,
      children: [
        ...recentFiles.value.missing.map((file) => ({
          value: file.id,
          label: file.name,
          onClick: async () => {
            const stored = await indexedDB.getRecentFile(file.id);
            if (!stored) return;

            const ids = recentFiles.value.list.filter((v) => !v.path).map((v) => v.id);
            await indexedDB.removeRecentFile(...ids);

            setFileState(stored);
          }
        })),
        { type: 'divider' as const },
        {
          value: 'clear-recent',
          label: '清除最近打开记录',
          onClick: async () => {
            const [, confirmed] = await Modal.delete('此操作将删除所有最近打开的文件记录，是否继续？');
            if (!confirmed) return;

            await indexedDB.clearRecentFiles();
            await loadRecentFiles();
          }
        }
      ]
    },
    { type: 'divider' },
    {
      value: 'save',
      label: '保存',
      shortcut: 'Ctrl+S',
      onClick: async () => {
        const { id, path, name, ext, content } = fileState.value;

        if (isTauri()) {
          // 桌面端：有 path 直接覆写，没有 path 走另存为流程
          if (path) {
            await native.writeFile(path, content);
          } else {
            await tauriSaveAs();
          }
        } else if (isWeb()) {
          // WAP 端：将文件名覆盖到 path 字段，不触发下载
          const filename = `${name || '未命名'}.${ext || 'md'}`;
          await applyFileUpdate(id, { ...fileState.value, path: filename });
        }
      }
    },
    {
      value: 'saveAs',
      label: '另存为',
      shortcut: 'Ctrl+Shift+S',
      disabled: !canSave.value,
      onClick: async () => {
        const { name, ext, content } = fileState.value;

        if (isTauri()) {
          await tauriSaveAs();
        } else if (isWeb()) {
          // WAP 端：直接下载
          const defaultPath = `${name || '未命名'}.${ext || 'md'}`;
          await native.saveFile(content, undefined, { defaultPath });
        }
      }
    }
  ]);

  return { toolbarFileOptions, loadRecentFiles };
}
