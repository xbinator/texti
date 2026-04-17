import { computed, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { customAlphabet } from 'nanoid';
import { useToolbarShortcuts } from '@/components/BToolbar/hooks/useToolbarShortcuts';
import type { ToolbarOptions } from '@/components/BToolbar/types';
import { native } from '@/shared/platform';
import { isElectron } from '@/shared/platform/env';
import { useFilesStore } from '@/stores/files';
import { emitter } from '@/utils/emitter';
import { EditorShortcuts } from '../../../constants/shortcuts';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz_', 8);

interface UseFileActiveOptions {
  visible: { searchRecent: boolean };
}

export function useFileActive(visible: UseFileActiveOptions['visible']) {
  const router = useRouter();
  const filesStore = useFilesStore();
  const { register: registerShortcuts } = useToolbarShortcuts();

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
        const existingFile = await filesStore.getFileByPath(file.path);

        if (existingFile) {
          id = existingFile.id;
        } else {
          await filesStore.addFile({ ...file, id });
        }

        router.push({ name: 'editor', params: { id } });
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
      enableShortcut: !isElectron(),
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

  const cleanup = registerShortcuts(toolbarFileOptions.value);
  const unregisterRecent = emitter.on('file:recent', () => {
    visible.searchRecent = true;
  });

  onUnmounted(() => {
    cleanup();
    unregisterRecent();
  });

  return { toolbarFileOptions };
}
