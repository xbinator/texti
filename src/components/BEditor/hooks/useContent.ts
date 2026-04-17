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
  isEquivalentToImportedContent: (externalContent: string | undefined, currentMarkdown: string) => boolean;
  rememberImportedContent: (text: string) => void;
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
  let lastImportedRawContent = '';
  let lastImportedCanonicalContent = '';

  function rememberImportedContent(text: string): void {
    const instance = getEditorInstance();
    lastImportedRawContent = text;
    lastImportedCanonicalContent = instance ? instance.getMarkdown() : text;
  }

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

    rememberImportedContent(text);
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
    const markdown = editor.getMarkdown();

    editorContent.value = markdown === lastImportedCanonicalContent ? lastImportedRawContent : markdown;
    onContentChange?.();
  }

  function isEquivalentToImportedContent(externalContent: string | undefined, currentMarkdown: string): boolean {
    return currentMarkdown === lastImportedCanonicalContent && (externalContent ?? '') === lastImportedRawContent;
  }

  watch(
    () => editable.value,
    (isEditable) => {
      getEditorInstance()?.setEditable(isEditable);
    }
  );

  return {
    isEquivalentToImportedContent,
    rememberImportedContent,
    onEditorUpdate,
    onPaste,
    setEditorContent
  };
}
