import type { Ref } from 'vue';
import { ref } from 'vue';

export interface MenuPosition {
  top: number;
  left: number;
  bottom: number;
}

export function useEditorSelection(editorRef: Ref<HTMLDivElement | undefined>) {
  const cachedRange = ref<Range | null>(null);

  function getActiveSelection(): Selection | null {
    const sel = window.getSelection();
    return sel && sel.rangeCount > 0 ? sel : null;
  }

  function getActiveRange(): Range | null {
    return getActiveSelection()?.getRangeAt(0) ?? null;
  }

  function cacheCurrentRange(): void {
    const range = getActiveRange();
    if (range) cachedRange.value = range.cloneRange();
  }

  function getCursorPosition(): MenuPosition | null {
    const selection = getActiveSelection();
    if (!selection) return null;

    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    let rect = range.getBoundingClientRect();

    if (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0) {
      const span = document.createElement('span');
      span.textContent = '\u200b';
      range.insertNode(span);
      rect = span.getBoundingClientRect();
      span.remove();
      const restored = document.createRange();
      restored.setStartBefore(span);
      restored.collapse(true);
      selection.removeAllRanges();
      selection.addRange(restored);
    }

    return { top: rect.top, left: rect.left, bottom: rect.bottom };
  }

  function getTextBeforeCursor(): string {
    const range = getActiveRange();
    if (!range) return '';
    const { startContainer, startOffset } = range;
    return startContainer.nodeType === Node.TEXT_NODE ? startContainer.textContent?.slice(0, startOffset) ?? '' : '';
  }

  function isSelectionInsideEditor(): boolean {
    const sel = getActiveSelection();
    return !!(sel && editorRef.value?.contains(sel.anchorNode));
  }

  function getVariableQueryBeforeCursor(): string | null {
    const match = getTextBeforeCursor().match(/\{\{([^{}]*)$/);
    return match ? match[1] ?? '' : null;
  }

  function insertTextAtCursor(text: string): boolean {
    const selection = getActiveSelection();
    if (!selection) return false;

    const range = selection.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  return {
    cachedRange,
    getActiveSelection,
    getActiveRange,
    cacheCurrentRange,
    getCursorPosition,
    getTextBeforeCursor,
    isSelectionInsideEditor,
    getVariableQueryBeforeCursor,
    insertTextAtCursor
  };
}
