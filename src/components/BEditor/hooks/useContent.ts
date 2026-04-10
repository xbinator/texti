import type { Editor } from '@tiptap/core';
import type { Ref } from 'vue';
import { watch } from 'vue';
import { normalizeEditorContent } from '../extensions/emptyContent';

interface UseBEditorContentParams {
  assignHeadingIds: (editor: Editor) => void;
  editable: Ref<boolean>;
  editorContent: Ref<string | undefined>;
  getEditorInstance: () => Editor | undefined;
  resetHeadingIndex: () => void;
  onContentChange?: () => void;
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
  resetHeadingIndex,
  onContentChange
}: UseBEditorContentParams): UseBEditorContentResult {
  function setEditorContent(text: string, emitUpdate = true): void {
    const instance = getEditorInstance();
    if (!instance) {
      return;
    }

    resetHeadingIndex();
    instance.commands.setContent(normalizeEditorContent(text), {
      emitUpdate,
      contentType: text ? 'markdown' : undefined
    });
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
    onContentChange?.();
  }

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
