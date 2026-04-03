import type { EditorFile } from '../types';
import { computed, Ref } from 'vue';
import { useClipboard } from '@vueuse/core';
import { message } from 'ant-design-vue';
import BEditor from '@/components/BEditor/index.vue';
import type { Props as ToolbarProps } from '@/components/Toolbar.vue';

export function useEditActive(fileState: Ref<EditorFile>, editorRef: Ref<InstanceType<typeof BEditor> | null>) {
  const { copy } = useClipboard();

  const toolbarEditOptions = computed<ToolbarProps['options']>(() => {
    const { content } = fileState.value;
    const canCopy = Boolean(content.trim());
    return [
      {
        value: 'undo',
        label: '撤销',
        shortcut: 'Ctrl+Z',
        enableShortcut: false,
        disabled: !editorRef.value?.canUndo(),
        onClick: () => editorRef.value?.undo()
      },
      {
        value: 'redo',
        label: '重做',
        shortcut: 'Ctrl+Shift+Z',
        enableShortcut: false,
        disabled: !editorRef.value?.canRedo(),
        onClick: () => editorRef.value?.redo()
      },
      { type: 'divider' },
      {
        value: 'copyAll',
        label: '复制全文',
        disabled: !canCopy,
        onClick: async () => {
          if (!canCopy) {
            message.warning('内容为空');
            return;
          }

          try {
            await copy(content);
            message.success('复制成功');
          } catch {
            message.error('复制失败');
          }
        }
      }
    ];
  });
  return { toolbarEditOptions };
}
