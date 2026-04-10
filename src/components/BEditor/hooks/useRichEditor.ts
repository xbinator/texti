import type { SearchScrollContext } from '../extensions/Search';
import type { Ref } from 'vue';
import { ref, watch } from 'vue';
import { useEditor, type Editor } from '@tiptap/vue-3';
import { normalizeEditorContent } from '../extensions/emptyContent';
import { useContent } from './useContent';
import { useExtensions } from './useExtensions';

interface UseRichEditorParams {
  bodyContent: Ref<string>;
  editable: Ref<boolean>;
  editorInstanceId: Ref<string>;
  onContentChange: () => void;
  onSearchMatchFocus?: (context: SearchScrollContext) => void;
}

interface UseRichEditorResult {
  editorInstance: ReturnType<typeof useEditor>;
  editorInstanceRef: Ref<Editor | undefined>;
  setContent: (text: string) => void;
}

export function useRichEditor({ bodyContent, editable, editorInstanceId, onContentChange, onSearchMatchFocus }: UseRichEditorParams): UseRichEditorResult {
  const { editorExtensions, resetHeadingIndex, assignHeadingIds } = useExtensions(editorInstanceId, { onSearchMatchFocus });
  const editorInstanceRef = ref<Editor>();

  const { setEditorContent, onPaste, onEditorUpdate } = useContent({
    assignHeadingIds,
    editable,
    editorContent: bodyContent,
    getEditorInstance: () => editorInstanceRef.value,
    resetHeadingIndex,
    onContentChange
  });

  const editorInstance = useEditor({
    content: normalizeEditorContent(bodyContent.value ?? ''),
    extensions: editorExtensions,
    editable: editable.value,
    contentType: 'markdown',
    editorProps: {
      attributes: { spellcheck: 'false' },
      handlePaste: onPaste,
      handleKeyDown: (_, event) => {
        const key = event.key.toLowerCase();
        const isTab = key === 'tab';
        const isUndo = (event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey;
        const isRedo = (event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey));

        if (isTab && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const instance = editorInstanceRef.value;
          if (!instance) {
            return false;
          }

          if (instance.isActive('table') || instance.isActive('listItem')) {
            return false;
          }

          event.preventDefault();

          if (event.shiftKey) {
            const { from, empty } = instance.state.selection;
            if (!empty || from <= 2) {
              return true;
            }

            const before = instance.state.doc.textBetween(from - 2, from, '\0', '\0');
            if (before === '  ') {
              instance.commands.deleteRange({ from: from - 2, to: from });
            }
            return true;
          }

          instance.commands.insertContent(instance.isActive('codeBlock') ? '\t' : '  ');
          return true;
        }

        if (isUndo || isRedo) {
          event.preventDefault();
          const instance = editorInstanceRef.value;
          if (!instance) {
            return true;
          }
          if (isUndo) {
            instance.commands.undo();
            return true;
          }
          instance.commands.redo();
          return true;
        }
        return false;
      }
    },
    onUpdate: onEditorUpdate
  });

  watch(
    editorInstance,
    (instance) => {
      editorInstanceRef.value = instance;
    },
    { immediate: true }
  );

  watch(bodyContent, (content) => {
    const instance = editorInstanceRef.value;
    if (!instance) return;

    const currentContent = instance.getMarkdown();
    if (currentContent === content) return;

    setEditorContent(content ?? '', false);
  });

  function setContent(text: string): void {
    setEditorContent(text, false);
  }

  return {
    editorInstance,
    editorInstanceRef,
    setContent
  };
}
