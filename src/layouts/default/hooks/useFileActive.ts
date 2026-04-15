import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import type { ToolbarOptions } from '@/components/BToolbar/types';
import { native } from '@/shared/platform';
import { recentFilesStorage, type StoredFile } from '@/shared/storage';
import { emitter } from '@/utils/emitter';
import { EditorShortcuts } from '../../../constants/shortcuts';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

interface UseFileActiveOptions {
  visible: { searchRecent: boolean };
}

export function useFileActive(visible: UseFileActiveOptions['visible']) {
  const router = useRouter();
  const storedFiles = ref<StoredFile[]>([]);

  async function loadStoredFiles(): Promise<void> {
    storedFiles.value = await recentFilesStorage.getAllRecentFiles();
  }

  loadStoredFiles();

  const toolbarFileOptions = computed<ToolbarOptions>(() => [
    {
      value: 'new',
      label: '新建',
      shortcut: EditorShortcuts.FILE_NEW,
      onClick: () => {
        router.push({ name: 'editor', params: { id: nanoid() } });
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

        let id = nanoid();

        const index = storedFiles.value.findIndex((f) => f.path === file.path);
        index === -1 ? await recentFilesStorage.addRecentFile({ ...file, id }) : (id = storedFiles.value[index].id);

        router.push({ name: 'editor', params: { id } });

        loadStoredFiles();
      }
    },
    {
      value: 'recent',
      label: '打开最近的文件',
      shortcut: EditorShortcuts.FILE_RECENT,
      onClick: () => {
        visible.searchRecent = true;
      }
    },
    { type: 'divider' },
    {
      value: 'duplicate',
      label: '复制为新文件',
      shortcut: EditorShortcuts.FILE_DUPLICATE,
      onClick: () => {
        emitter.emit('file:duplicate');
      }
    },
    {
      value: 'save',
      label: '保存',
      shortcut: EditorShortcuts.FILE_SAVE,
      onClick: () => {
        emitter.emit('file:save');
      }
    },
    {
      value: 'saveAs',
      label: '另存为',
      shortcut: EditorShortcuts.FILE_SAVE_AS,
      onClick: () => {
        emitter.emit('file:saveAs');
      }
    },
    { type: 'divider' },
    {
      value: 'rename',
      label: '重命名',
      shortcut: EditorShortcuts.FILE_RENAME,
      onClick: () => {
        emitter.emit('file:rename');
      }
    }
  ]);

  return { toolbarFileOptions };
}
