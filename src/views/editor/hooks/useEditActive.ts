import { computed, Ref } from 'vue';
import type { Props as ToolbarProps } from '@/components/Toolbar.vue';
import { native } from '@/utils/native';

export function useEditActive(fileState: Ref<EditorFile>) {
  const toolbarEditOptions = computed<ToolbarProps['options']>(() => [
    {
      value: 'undo',
      label: '撤销',
      shortcut: 'Ctrl+Z',
      onClick: async () => {
        // await native.undo();
      }
    },
    {
      value: 'redo',
      label: '重做',
      shortcut: 'Ctrl+Y+Z',
      onClick: async () => {
        // await native.redo();
      }
    }
  ]);
  return { toolbarEditOptions };
}
