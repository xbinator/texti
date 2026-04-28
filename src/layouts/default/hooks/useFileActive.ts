/**
 * @file useFileActive.ts
 * @description 收口顶部文件菜单及全局文件事件的打开行为。
 */

import { computed, onUnmounted } from 'vue';
import type { ComputedRef } from 'vue';
import { useToolbarShortcuts } from '@/components/BToolbar/hooks/useToolbarShortcuts';
import type { ToolbarOptions } from '@/components/BToolbar/types';
import { useOpenFile } from '@/hooks/useOpenFile';
import { isElectron } from '@/shared/platform/env';
import { useFilesStore } from '@/stores/files';
import { emitter } from '@/utils/emitter';
import { EditorShortcuts } from '../../../constants/shortcuts';

interface UseFileActiveOptions {
  visible: { searchRecent: boolean };
}

interface UseFileActiveResult {
  toolbarFileOptions: ComputedRef<ToolbarOptions>;
}

/**
 * 绑定文件菜单和全局事件。
 * @param visible - 页面可见状态
 * @returns 工具栏文件菜单配置
 */
export function useFileActive(visible: UseFileActiveOptions['visible']): UseFileActiveResult {
  const filesStore = useFilesStore();
  const { register: registerShortcuts } = useToolbarShortcuts();
  const { createNewFile, openFileById, openNativeFile } = useOpenFile();

  /**
   * 创建并打开一个新文件。
   */
  async function handleCreateNewFile(): Promise<void> {
    await createNewFile('new');
  }

  /**
   * 通过原生文件选择器打开文件。
   */
  async function handleOpenNativeFile(): Promise<void> {
    await openNativeFile('menu');
  }

  /**
   * 打开最近文件；未命中时回退到最近文件搜索弹窗。
   * @param id - 文件 ID
   */
  async function handleOpenRecentFile(id: string): Promise<void> {
    const file = await filesStore.getFileById(id);
    if (!file) {
      visible.searchRecent = true;
      return;
    }

    await openFileById(id, 'platform-recent');
  }

  const toolbarFileOptions = computed<ToolbarOptions>(() => [
    {
      value: 'new',
      label: '新建',
      shortcut: EditorShortcuts.FILE_NEW,
      onClick: () => {
        handleCreateNewFile();
      }
    },
    { type: 'divider' },
    {
      value: 'open',
      label: '打开',
      shortcut: EditorShortcuts.FILE_OPEN,
      onClick: async () => {
        await handleOpenNativeFile();
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

  const unregisterNew = emitter.on('file:new', () => {
    handleCreateNewFile();
  });

  const unregisterOpen = emitter.on('file:open', async () => {
    await handleOpenNativeFile();
  });

  const unregisterRecent = emitter.on('file:recent', () => {
    visible.searchRecent = true;
  });

  const unregisterOpenRecent = emitter.on('file:openRecent', async (payload: unknown) => {
    const id = typeof payload === 'string' ? payload : '';
    if (!id) return;

    await handleOpenRecentFile(id);
  });

  onUnmounted(() => {
    cleanup();
    unregisterNew();
    unregisterOpen();
    unregisterRecent();
    unregisterOpenRecent();
  });

  return { toolbarFileOptions };
}
