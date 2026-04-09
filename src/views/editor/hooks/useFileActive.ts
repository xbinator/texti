/* eslint-disable no-restricted-syntax */
import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { computed, nextTick, onMounted, ref } from 'vue';
import { customAlphabet } from 'nanoid';
import type { ToolbarOptions } from '@/components/Toolbar/types';
import { native } from '@/shared/platform';
import { isElectron, isWeb } from '@/shared/platform/env';
import { recentFilesStorage, type StoredFile } from '@/shared/storage';
import { Modal } from '@/utils/modal';
import { EditorShortcuts } from '../constants/shortcuts';

interface UseFileActiveOptions {
  pause: () => void;
  resume: () => void;
  visible: { recentSearch: boolean };
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
    const files = await recentFilesStorage.getAllRecentFiles();
    recentFiles.value = files;
  }

  async function removeUnsavedFiles(preserveIds: string[] = []): Promise<void> {
    const ids = recentFiles.value.filter((file) => !file.path && !preserveIds.includes(file.id)).map((file) => file.id);
    if (!ids.length) return;

    await recentFilesStorage.removeRecentFile(...ids);
  }

  async function confirmUnsavedChanges(): Promise<boolean> {
    if (fileState.value.path) return true;
    if (!fileState.value.content.trim()) return true;

    const [cancelled] = await Modal.confirm('提示', '当前文件未保存，是否放弃当前修改？');
    return !cancelled;
  }

  function setFileState(file: EditorFile): void {
    options.pause();

    fileState.value = file;
    if (file.id) {
      recentFilesStorage.setCurrentFile(file.id);
    }

    native.setWindowTitle(`${file.name || '未命名'}.${file.ext || 'md'}`);
    nextTick(() => options.resume());
  }

  async function restoreCurrentFile(): Promise<void> {
    const currentId = await recentFilesStorage.getCurrentFileId();
    if (currentId) {
      const stored = await recentFilesStorage.getRecentFile(currentId);
      if (stored) {
        setFileState(stored);
      }
    }

    if (!fileState.value.id) {
      const nextFile: EditorFile = { path: '', name: '', ext: 'md', content: '', id: nanoid(6) };
      await recentFilesStorage.addRecentFile(nextFile as StoredFile);
      setFileState(nextFile);
    }

    await loadRecentFiles();
  }

  onMounted(() => {
    restoreCurrentFile();
  });

  async function applyFileUpdate(id: string, updated: EditorFile): Promise<void> {
    await recentFilesStorage.updateRecentFile(id, updated as StoredFile);
    setFileState(updated);
  }

  async function electronSaveAs(): Promise<void> {
    const { id, name, ext, content } = fileState.value;
    const defaultPath = `${name || '未命名'}.${ext || 'md'}`;
    const savedPath = await native.saveFile(content, undefined, { defaultPath });
    if (!savedPath) return;

    const fileName = savedPath.split(/[/\\]/).pop() ?? '';
    const [, savedName, savedExt] = /^(.+?)(?:\.([^.]+))?$/.exec(fileName) || ['', '', ''];
    await applyFileUpdate(id, { ...fileState.value, path: savedPath, name: savedName, ext: savedExt });
  }

  async function activateLatestOrNew(): Promise<void> {
    const files = await recentFilesStorage.getAllRecentFiles();
    const first = files[0];
    if (first) {
      setFileState(first);
      await loadRecentFiles();
      return;
    }

    const nextFile: EditorFile = { path: '', name: '', ext: 'md', content: '', id: nanoid(6) };
    await recentFilesStorage.addRecentFile(nextFile as StoredFile);
    setFileState(nextFile);
    await loadRecentFiles();
  }

  async function openRecentFile(id: string): Promise<void> {
    const stored = await recentFilesStorage.getRecentFile(id);
    if (!stored) return;

    if (!(await confirmUnsavedChanges())) return;
    await removeUnsavedFiles([id]);

    setFileState(stored);
    await loadRecentFiles();
  }

  const toolbarFileOptions = computed<ToolbarOptions>(() => [
    {
      value: 'new',
      label: '新建',
      shortcut: EditorShortcuts.FILE_NEW,
      onClick: async () => {
        if (!(await confirmUnsavedChanges())) return;
        await removeUnsavedFiles();

        const nextFile: EditorFile = { path: '', name: '', ext: 'md', content: '', id: nanoid(6) };
        await recentFilesStorage.addRecentFile(nextFile as StoredFile);

        setFileState(nextFile);
        await loadRecentFiles();
      }
    },
    { type: 'divider' },
    {
      value: 'open',
      label: '打开',
      shortcut: EditorShortcuts.FILE_OPEN,
      onClick: async () => {
        const file = await native.openFile();
        if (!file.path) return;

        if (!(await confirmUnsavedChanges())) return;
        await removeUnsavedFiles();

        const nextFile: EditorFile = { ...file, id: nanoid(6) };
        await recentFilesStorage.addRecentFile(nextFile as StoredFile);

        setFileState(nextFile);
        await loadRecentFiles();
      }
    },
    {
      value: 'recent',
      label: '打开最近的文件',
      disabled: !savedRecentFiles.value.length,
      children: [
        ...savedRecentFiles.value.slice(0, 10).map((file) => ({
          value: file.id,
          label: getRecentFileLabel(file),
          active: file.id === fileState.value.id,
          onClick: async () => {
            await openRecentFile(file.id);
          }
        })),
        ...(savedRecentFiles.value.length > 10
          ? [
              { type: 'divider' as const },
              {
                value: 'more',
                label: '更多',
                shortcut: EditorShortcuts.FILE_RECENT_MORE,
                enableShortcut: false,
                onClick: async () => {
                  options.visible.recentSearch = true;
                }
              }
            ]
          : []),
        { type: 'divider' as const },
        {
          value: 'clear-recent',
          label: '清除最近打开记录',
          onClick: async () => {
            const [, confirmed] = await Modal.delete('此操作将删除所有最近打开的文件记录，是否继续？', { title: '清除最近打开记录' });
            if (!confirmed) return;

            await recentFilesStorage.clearRecentFiles();
            await loadRecentFiles();
          }
        }
      ]
    },
    { type: 'divider' },
    {
      value: 'duplicate',
      label: '复制为新文件',
      shortcut: EditorShortcuts.FILE_DUPLICATE,
      onClick: async () => {
        if (!(await confirmUnsavedChanges())) return;
        await removeUnsavedFiles();

        const source = fileState.value;
        const nextFile: EditorFile = {
          path: source.path,
          name: source.name ? `${source.name}-副本` : '',
          ext: source.ext || 'md',
          content: source.content,
          id: nanoid(6)
        };

        await recentFilesStorage.addRecentFile(nextFile as StoredFile);
        setFileState(nextFile);
        await loadRecentFiles();
      }
    },
    {
      value: 'save',
      label: '保存',
      shortcut: EditorShortcuts.FILE_SAVE,
      onClick: async () => {
        const { id, path, name = '未命名', ext = 'md', content } = fileState.value;

        if (isElectron()) {
          if (path) {
            await native.writeFile(path, content);
          } else {
            await electronSaveAs();
          }
        } else if (isWeb()) {
          fileState.value = { ...fileState.value, name, ext, path: path || `${name}.${ext}` };
          await applyFileUpdate(id, { ...fileState.value });
          await loadRecentFiles();
        }
      }
    },
    {
      value: 'saveAs',
      label: '另存为',
      shortcut: EditorShortcuts.FILE_SAVE_AS,
      disabled: !canSave.value,
      onClick: async () => {
        const { name, ext, content } = fileState.value;

        if (isElectron()) {
          await electronSaveAs();
        } else if (isWeb()) {
          const defaultPath = `${name || '未命名'}.${ext || 'md'}`;
          await native.saveFile(content, undefined, { defaultPath });
        }
      }
    },
    { type: 'divider' },
    {
      value: 'rename',
      label: '重命名',
      shortcut: EditorShortcuts.FILE_RENAME,
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
        const [, confirmed] = await Modal.delete('将清空当前文件内容，是否继续？', { title: '清空内容' });
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
        await recentFilesStorage.removeRecentFile(id);

        const currentId = await recentFilesStorage.getCurrentFileId();
        if (currentId === id) {
          await recentFilesStorage.clearCurrentFile();
        }

        await activateLatestOrNew();
      }
    }
  ]);

  return { toolbarFileOptions, loadRecentFiles, recentFiles, openRecentFile };
}
