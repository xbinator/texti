import type { SearchScrollContext } from '../extensions/Search';
import type { Ref } from 'vue';
import { ref, watch } from 'vue';
import { TextSelection } from '@tiptap/pm/state';
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

interface CodeBlockSelectionRange {
  from: number;
  to: number;
}

function getActiveCodeBlockRange(editor: Editor): CodeBlockSelectionRange | null {
  const { selection } = editor.state;
  const { $from } = selection;

  for (let { depth } = $from; depth > 0; depth--) {
    const node = $from.node(depth);

    if (node.type.name === 'codeBlock') {
      return {
        from: $from.start(depth),
        to: $from.end(depth)
      };
    }
  }

  return null;
}

function handleSelectAllInCodeBlock(editor: Editor, event: KeyboardEvent): boolean {
  const range = getActiveCodeBlockRange(editor);

  if (!range) {
    return false;
  }

  const { selection } = editor.state;
  const isCurrentCodeBlockSelected = selection.from === range.from && selection.to === range.to;

  if (isCurrentCodeBlockSelected) {
    return false;
  }

  event.preventDefault();
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, range.from, range.to)));

  return true;
}

export function useRichEditor({ bodyContent, editable, editorInstanceId, onContentChange, onSearchMatchFocus }: UseRichEditorParams): UseRichEditorResult {
  const { editorExtensions, resetHeadingIndex, assignHeadingIds } = useExtensions(editorInstanceId, { onSearchMatchFocus });
  const editorInstanceRef = ref<Editor>();

  const { setEditorContent, onPaste, onEditorUpdate, isEquivalentToImportedContent, rememberImportedContent } = useContent({
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
      handleDrop: () => true, // 返回 true 阻止 drop
      attributes: { spellcheck: 'false', draggable: 'false' },
      handlePaste: onPaste,
      handleKeyDown: (_, event) => {
        const key = event.key.toLowerCase();
        const isTab = key === 'tab';
        const isSelectAll = (event.ctrlKey || event.metaKey) && key === 'a' && !event.shiftKey && !event.altKey;
        const isUndo = (event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey;
        const isRedo = (event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey));

        if (isSelectAll) {
          const instance = editorInstanceRef.value;

          if (!instance) {
            return false;
          }

          if (handleSelectAllInCodeBlock(instance, event)) {
            return true;
          }
        }

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
      },
      handleDOMEvents: {
        dragstart: (_view, event) => {
          event.preventDefault();
          return true;
        },
        drop: (_view, event) => {
          event.preventDefault();
          return true;
        }
      }
    },
    onUpdate: onEditorUpdate
  });

  watch(
    editorInstance,
    (instance) => {
      editorInstanceRef.value = instance;
      if (instance) {
        rememberImportedContent(bodyContent.value ?? '');
      }
    },
    { immediate: true }
  );

  watch(bodyContent, (content) => {
    const instance = editorInstanceRef.value;
    if (!instance) return;

    const currentContent = instance.getMarkdown();
    if (isEquivalentToImportedContent(content, currentContent)) return;
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
