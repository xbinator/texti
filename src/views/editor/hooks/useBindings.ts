import type { EditorFile } from '../types';
import type { Ref } from 'vue';
import { onUnmounted } from 'vue';
import { marked } from 'marked';
import type { BEditorPublicInstance } from '@/components/BEditor/types';
import { useClipboard } from '@/hooks/useClipboard';
import { emitter } from '@/utils/emitter';

interface UseBindingsOptions {
  fileState: Ref<EditorFile>;
  actions: {
    // 保存文件
    onSave: () => Promise<void>;
    // 保存文件为新文件
    onSaveAs: () => Promise<void>;
    // 重命名文件
    onRename: () => Promise<void>;
    // 删除文件
    onDelete: () => Promise<void>;
    // 打开文件所在位置
    onShowInFolder: () => Promise<void>;
    // 复制文件
    onDuplicate: () => Promise<void>;
  };
  editorInstance?: Ref<BEditorPublicInstance | null>;
}

export function useBindings(fileId: Ref<string>, options: UseBindingsOptions) {
  const { fileState, actions, editorInstance } = options;
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

  const unregisters = [
    emitter.on('file:save', actions.onSave),
    emitter.on('file:saveAs', async () => {
      if (fileId.value && fileId.value !== fileState.value.id) return;
      await actions.onSaveAs();
    }),
    emitter.on('file:rename', actions.onRename),
    emitter.on('file:delete', actions.onDelete),
    emitter.on('file:duplicate', actions.onDuplicate),
    emitter.on('edit:undo', () => {
      editorInstance?.value?.undo();
    }),
    emitter.on('edit:redo', () => {
      editorInstance?.value?.redo();
    }),
    emitter.on('edit:copyPlainText', async () => {
      const plainText = await toPlainText(fileState.value.content);
      await clipboard(plainText, { successMessage: '已复制纯文本' });
    }),
    emitter.on('edit:copyMarkdown', async () => {
      await clipboard(fileState.value.content, { successMessage: '已复制 Markdown' });
    }),
    emitter.on('edit:copyHtml', async () => {
      const html = await toHtml(fileState.value.content);
      await clipboard(html, { successMessage: '已复制 HTML 代码' });
    })
  ];

  const unregister = () => {
    unregisters.forEach((fn) => fn());
  };

  onUnmounted(() => {
    unregister();
  });

  return {
    unregister
  };
}
