import type { Ref } from 'vue';
import { nextTick, ref, watch } from 'vue';
import { useEditorSelection } from './useEditorSelection';
import { useVariableEncoder } from './useVariableEncoder';

export interface EditorCoreOptions {
  variables: Ref<{ label: string; value: string }[]>;
  emitChange: (value: string) => void;
}

export function useEditorCore(editorRef: Ref<HTMLDivElement | undefined>, modelValue: Ref<string>, options: EditorCoreOptions) {
  const { variables, emitChange } = options;

  const selectionHook = useEditorSelection(editorRef);

  const { encodeVariables, decodeVariables } = useVariableEncoder({
    getVariableLabel: (value: string) => variables.value.find((v) => v.value === value)?.label
  });

  const isInternalUpdate = ref(false);

  function updateEditorContent(content: string): void {
    if (!editorRef.value) return;
    const encoded = encodeVariables(content);
    if (editorRef.value.innerHTML !== encoded) {
      editorRef.value.innerHTML = encoded;
    }
  }

  function getEditorContent(): string {
    if (!editorRef.value) return '';
    return decodeVariables(editorRef.value.innerHTML);
  }

  function updateModelValue(): void {
    if (!editorRef.value) return;
    const decoded = getEditorContent();
    isInternalUpdate.value = true;
    modelValue.value = decoded;
    emitChange(decoded);
    isInternalUpdate.value = false;
  }

  const unwatchModelValue = watch(modelValue, (newValue) => {
    if (isInternalUpdate.value) return;

    if (!editorRef.value) return;

    const currentValue = getEditorContent();
    if (currentValue === (newValue || '')) return;

    const hadFocus = document.activeElement === editorRef.value;

    let cursorOffset = 0;
    if (hadFocus) {
      const selection = window.getSelection();
      const rangeToRestore = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;

      if (rangeToRestore && editorRef.value.contains(rangeToRestore.startContainer)) {
        const textNode = editorRef.value.firstChild as Text | null;
        if (textNode && textNode === rangeToRestore.startContainer) {
          cursorOffset = Math.min(rangeToRestore.startOffset, currentValue.length);
        }
      }
    }

    updateEditorContent(newValue || '');

    nextTick(() => {
      if (!editorRef.value) return;

      if (hadFocus) {
        const newSelection = window.getSelection();
        if (!newSelection) return;

        const newRange = document.createRange();
        const newTextNode = editorRef.value.firstChild as Text | null;

        if (newTextNode) {
          const targetOffset = Math.min(cursorOffset, newTextNode.length);
          newRange.setStart(newTextNode, targetOffset);
          newRange.setEnd(newTextNode, targetOffset);
        } else {
          newRange.selectNodeContents(editorRef.value);
          newRange.collapse(false);
        }

        newSelection.removeAllRanges();
        newSelection.addRange(newRange);
        editorRef.value.focus();
      }
    });
  });

  const unwatchEditorRef = watch(editorRef, (newEditor) => {
    if (newEditor && modelValue.value) {
      updateEditorContent(modelValue.value);
    }
  });

  function initializeEditor(): void {
    if (editorRef.value && modelValue.value) {
      updateEditorContent(modelValue.value);
    }
  }

  function cleanup(): void {
    unwatchModelValue();
    unwatchEditorRef();
  }

  return {
    selectionHook,
    encodeVariables,
    decodeVariables,
    updateEditorContent,
    getEditorContent,
    updateModelValue,
    initializeEditor,
    cleanup
  };
}
