import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { computed } from 'vue';
import { marked } from 'marked';
import BEditor from '@/components/BEditor/index.vue';
import type { Props as ToolbarProps } from '@/components/Toolbar.vue';
import { useClipboard } from '@/hooks/useClipboard';
import { EditorShortcuts } from '../constants/shortcuts';

interface UseEditActiveOptions {
  /** 查找栏是否可见 */
  visible: { find: boolean };
  /** 编辑器实例 */
  editorInstance: Ref<InstanceType<typeof BEditor> | null>;
}

export function useEditActive(fileState: Ref<EditorFile>, options: UseEditActiveOptions) {
  const { editorInstance, visible } = options;

  const { clipboard } = useClipboard();

  async function toHtml(markdown: string): Promise<string> {
    const rendered = marked.parse(markdown);

    if (typeof rendered === 'string') {
      return rendered;
    }

    return rendered;
  }

  async function toPlainText(markdown: string): Promise<string> {
    const parser = new DOMParser();
    const html = await toHtml(markdown);
    const documentNode = parser.parseFromString(html, 'text/html');

    return documentNode.body.textContent?.trim() ?? '';
  }

  const toolbarEditOptions = computed<ToolbarProps['options']>(() => {
    const { content } = fileState.value;
    const canCopy = Boolean(content.trim());
    return [
      {
        value: 'undo',
        label: '撤销',
        shortcut: EditorShortcuts.EDIT_UNDO,
        enableShortcut: false,
        disabled: !editorInstance.value?.canUndo(),
        onClick: () => editorInstance.value?.undo()
      },
      {
        value: 'redo',
        label: '重做',
        shortcut: EditorShortcuts.EDIT_REDO,
        enableShortcut: false,
        disabled: !editorInstance.value?.canRedo(),
        onClick: () => editorInstance.value?.redo()
      },
      {
        value: 'find',
        label: '查找',
        shortcut: EditorShortcuts.EDIT_FIND,
        disabled: !canCopy,
        onClick: () => {
          visible.find = true;
        }
      },
      { type: 'divider' },
      {
        value: 'copyPlainText',
        label: '复制为纯文本',
        disabled: !canCopy,
        onClick: async () => {
          const plainText = await toPlainText(content);
          await clipboard(plainText, { successMessage: '已复制纯文本' });
        }
      },
      {
        value: 'copyMarkdown',
        label: '复制为 Markdown',
        disabled: !canCopy,
        onClick: async () => {
          await clipboard(content, { successMessage: '已复制 Markdown' });
        }
      },
      {
        value: 'copyHtml',
        label: '复制为 HTML 代码',
        disabled: !canCopy,
        onClick: async () => {
          const html = await toHtml(content);
          await clipboard(html, { successMessage: '已复制 HTML 代码' });
        }
      }
    ];
  });
  return {
    toolbarEditOptions
  };
}
