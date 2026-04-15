import { computed } from 'vue';
import type { ToolbarOptions } from '@/components/BToolbar/types';
import { EditorShortcuts } from '@/constants/shortcuts';
import { emitter } from '@/utils/emitter';

export function useEditActive() {
  const toolbarEditOptions = computed<ToolbarOptions>(() => {
    return [
      {
        value: 'undo',
        label: '撤销',
        shortcut: EditorShortcuts.EDIT_UNDO,
        enableShortcut: false,
        disabled: false,
        onClick: () => {
          emitter.emit('edit:undo');
        }
      },
      {
        value: 'redo',
        label: '重做',
        shortcut: EditorShortcuts.EDIT_REDO,
        enableShortcut: false,
        disabled: false,
        onClick: () => {
          emitter.emit('edit:redo');
        }
      },
      { type: 'divider' },
      {
        value: 'copyPlainText',
        label: '复制为纯文本',
        disabled: false,
        onClick: async () => {
          emitter.emit('edit:copyPlainText');
        }
      },
      {
        value: 'copyMarkdown',
        label: '复制为 Markdown',
        disabled: false,
        onClick: async () => {
          emitter.emit('edit:copyMarkdown');
        }
      },
      {
        value: 'copyHtml',
        label: '复制为 HTML 代码',
        disabled: false,
        onClick: async () => {
          emitter.emit('edit:copyHtml');
        }
      }
    ];
  });

  return { toolbarEditOptions };
}
