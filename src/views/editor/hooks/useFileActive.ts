/* eslint-disable no-restricted-syntax */
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

function getRecentFileLabel(file: Pick<EditorFile, 'name' | 'content'>): string {
  const content = file.content.replace(/^\s*---[\s\S]*?---\s*\n?/, '');

  const match = /^#{1,6}\s+(.+)/m.exec(content);

  return match?.[1]?.trim() || file.name || '未命名';
}

export function useFileActive(fileState: Ref<EditorFile>, options: UseFileActiveOptions) {
  const canSave = computed(() => fileState.value.path !== undefined);
  const recentFiles = ref<EditorFile[]>([]);
  const savedRecentFiles = computed<EditorFile[]>(() => recentFiles.value.filter((file) => Boolean(file.path)));

  async function loadRecentFiles(): Promise<void> {
    const files = await indexedDB.getAllRecentFiles();

    recentFiles.value = files;
  }

  async function removeUnsavedFiles(): Promise<void> {
    const ids = recentFiles.value.filter((v) => !v.path).map((v) => v.id);
    if (!ids.length) return;

    await indexedDB.removeRecentFile(...ids);
  }

  async function confirmUnsavedChanges() {
    if (fileState.value.path) return true;
    if (!fileState.value.content.trim()) return true;

    const [cancelled] = await Modal.confirm('提示', '当前文件未保存，是否放弃当前修改？');
    return !cancelled;
  }

  function setFileState(file: EditorFile): void {
    options.pause();

    fileState.value = file;
    file.id && indexedDB.setCurrentFile(file.id);

    native.setWindowTitle(`${file.name || '未命名'}.${file.ext || 'md'}`);

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

  async function activateLatestOrNew(): Promise<void> {
    const files = await indexedDB.getAllRecentFiles();
    const first = files[0];
    if (first) {
      setFileState(first);
      await loadRecentFiles();
      return;
    }

    const _file = { path: '', name: '', ext: 'md', content: '', id: nanoid(6) };
    await indexedDB.addRecentFile(_file as StoredFile);
    setFileState(_file);
    await loadRecentFiles();
  }

  const toolbarFileOptions = computed<ToolbarProps['options']>(() => [
    {
      value: 'new',
      label: '新建',
      shortcut: 'Ctrl+N',
      onClick: async () => {
        if (!(await confirmUnsavedChanges())) return;
        await removeUnsavedFiles();

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

        if (!(await confirmUnsavedChanges())) return;
        await removeUnsavedFiles();

        const _file = { ...file, id: nanoid(6) };
        await indexedDB.addRecentFile(_file as StoredFile);

        loadRecentFiles();
        setFileState(_file);
      }
    },
    {
      value: 'recent',
      label: '打开最近的文件',
      disabled: !savedRecentFiles.value.length,
      children: [
        ...savedRecentFiles.value.map((file) => ({
          value: file.id,
          label: getRecentFileLabel(file),
          onClick: async () => {
            const stored = await indexedDB.getRecentFile(file.id);
            if (!stored) return;

            if (!(await confirmUnsavedChanges())) return;
            await removeUnsavedFiles();

            setFileState(stored);
          }
        })),
        { type: 'divider' as const },
        {
          value: 'clear-recent',
          label: '清除最近打开记录',
          onClick: async () => {
            const [, confirmed] = await Modal.delete('此操作将删除所有最近打开的文件记录，是否继续？', { title: '清除最近打开记录' });
            if (!confirmed) return;

            await indexedDB.clearRecentFiles();
            await loadRecentFiles();
          }
        }
      ]
    },
    { type: 'divider' },
    {
      value: 'duplicate',
      label: '复制为新文件',
      shortcut: 'Ctrl+Alt+N',
      onClick: async () => {
        if (!(await confirmUnsavedChanges())) return;
        await removeUnsavedFiles();

        const src = fileState.value;
        const _file = {
          path: src.path,
          name: src.name ? `${src.name}-副本` : '',
          ext: src.ext || 'md',
          content: src.content,
          id: nanoid(6)
        };

        await indexedDB.addRecentFile(_file as StoredFile);
        setFileState(_file);
        await loadRecentFiles();
      }
    },
    {
      value: 'save',
      label: '保存',
      shortcut: 'Ctrl+S',
      onClick: async () => {
        const { id, path, name = '未命名', ext = 'md', content } = fileState.value;

        if (isTauri()) {
          // 桌面端：有 path 直接覆写，没有 path 走另存为流程
          if (path) {
            await native.writeFile(path, content);
          } else {
            await tauriSaveAs();
          }
        } else if (isWeb()) {
          fileState.value = { ...fileState.value, name, ext, path: path || `${name}.${ext}` };
          // WAP 端：将文件名覆盖到 path 字段，不触发下载
          await applyFileUpdate(id, { ...fileState.value });

          await loadRecentFiles();
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
    },
    { type: 'divider' },
    {
      value: 'rename',
      label: '重命名',
      shortcut: 'F2',
      disabled: !fileState.value.path,
      onClick: async () => {
        const { id, name = '' } = fileState.value;
        const [cancel, newName] = await Modal.input('重命名', { defaultValue: name, placeholder: '请输入' });
        if (cancel || newName === name) return;

        await applyFileUpdate(id, { ...fileState.value, name: newName });
        await loadRecentFiles();
      }
    },
    { type: 'divider' },
    {
      value: 'clear-content',
      label: '清空内容',
      onClick: async () => {
        const [, confirmed] = await Modal.confirm('确认清空', '将清空当前文件内容，是否继续？');
        if (!confirmed) return;

        const { id } = fileState.value;
        await applyFileUpdate(id, { ...fileState.value, content: '' });
        await loadRecentFiles();
      }
    },

    {
      value: 'remove-current',
      label: '从最近记录移除当前',
      onClick: async () => {
        const [, confirmed] = await Modal.delete('此操作仅移除最近打开记录，不会删除磁盘上的文件，是否继续？');
        if (!confirmed) return;

        const { id } = fileState.value;
        await indexedDB.removeRecentFile(id);

        const currentId = await indexedDB.getCurrentFileId();
        if (currentId === id) {
          await indexedDB.clearCurrentFile();
        }

        await activateLatestOrNew();
      }
    }
  ]);

  return { toolbarFileOptions, loadRecentFiles };
}
