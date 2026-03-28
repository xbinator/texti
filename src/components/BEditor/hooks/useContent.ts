import type { Editor } from '@tiptap/core';
import type { Ref } from 'vue';
import { watch } from 'vue';

interface UseBEditorContentParams {
  assignHeadingIds: (editor: Editor) => void;
  editable: Ref<boolean>;
  editorContent: Ref<string | undefined>;
  getEditorInstance: () => Editor | undefined;
  resetHeadingIndex: () => void;
}

interface UseBEditorContentResult {
  onEditorUpdate: ({ editor }: { editor: Editor }) => void;
  onPaste: (_view: unknown, event: ClipboardEvent) => boolean;
  setEditorContent: (text: string, emitUpdate?: boolean) => void;
}

export function useContent({
  assignHeadingIds,
  editable,
  editorContent,
  getEditorInstance,
  resetHeadingIndex
}: UseBEditorContentParams): UseBEditorContentResult {
  function setEditorContent(text: string, emitUpdate = true): void {
    const instance = getEditorInstance();
    if (!instance) {
      return;
    }

    resetHeadingIndex();
    instance.commands.setContent(text, { emitUpdate, contentType: 'markdown' });
  }

  function onPaste(_view: unknown, event: ClipboardEvent): boolean {
    const instance = getEditorInstance();
    if (!instance) {
      return false;
    }

    const text = event.clipboardData?.getData('text/plain') || '';

    if (!text.trim()) {
      return false;
    }

    if (instance.state.doc.textContent.trim().length > 0) {
      return false;
    }

    event.preventDefault();
    setEditorContent(text);

    return true;
  }

  function onEditorUpdate({ editor }: { editor: Editor }): void {
    assignHeadingIds(editor);
    editorContent.value = editor.getMarkdown();
  }

  watch(
    () => editorContent.value,
    (content) => {
      const instance = getEditorInstance();
      if (!instance) {
        return;
      }

      if (instance.getMarkdown() === content) {
        return;
      }

      setEditorContent(content ?? '', false);
    }
  );

  watch(
    () => editable.value,
    (isEditable) => {
      getEditorInstance()?.setEditable(isEditable);
    }
  );

  return {
    onEditorUpdate,
    onPaste,
    setEditorContent
  };
}
