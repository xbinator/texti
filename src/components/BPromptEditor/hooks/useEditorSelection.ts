import type { Ref } from 'vue';
import { ref } from 'vue';
import { ZERO_WIDTH_SPACE } from './useVariableEncoder';

export interface MenuPosition {
  top: number;
  left: number;
  bottom: number;
}

/**
 * 记录最近一次有效光标位置的序列化快照。
 */
interface SelectionSnapshot {
  /** 光标容器在编辑器根节点下的路径 */
  path: number[];
  /** 光标在目标容器中的偏移 */
  offset: number;
}

export function useEditorSelection(editorRef: Ref<HTMLDivElement | undefined>) {
  const cachedRange = ref<Range | null>(null);
  const cachedSelectionSnapshot = ref<SelectionSnapshot | null>(null);

  /**
   * 将折叠选区恢复到父节点的指定 child offset，避免引用已脱离 DOM 的节点。
   * @param selection - 当前浏览器选区
   * @param parentNode - 目标父节点
   * @param restoredOffset - 目标 child offset
   */
  function restoreCollapsedSelectionAtOffset(selection: Selection, parentNode: Node, restoredOffset: number): void {
    const restored = document.createRange();
    restored.setStart(parentNode, restoredOffset);
    restored.collapse(true);
    selection.removeAllRanges();
    selection.addRange(restored);
  }

  function getActiveSelection(): Selection | null {
    const sel = window.getSelection();
    return sel && sel.rangeCount > 0 ? sel : null;
  }

  function getActiveRange(): Range | null {
    return getActiveSelection()?.getRangeAt(0) ?? null;
  }

  /**
   * 将节点转换为相对编辑器根节点的路径，供光标恢复使用。
   * @param root - 编辑器根节点
   * @param targetNode - 需要记录的节点
   * @returns 节点路径，无法定位时返回 null
   */
  function buildNodePath(root: Node, targetNode: Node): number[] | null {
    const path: number[] = [];
    let currentNode: Node | null = targetNode;

    while (currentNode && currentNode !== root) {
      const parentNode = currentNode.parentNode as Node | null;
      if (!parentNode) return null;

      const childIndex = Array.from(parentNode.childNodes).indexOf(currentNode as ChildNode);
      if (childIndex < 0) return null;

      path.unshift(childIndex);
      currentNode = parentNode;
    }

    return currentNode === root ? path : null;
  }

  /**
   * 按路径解析编辑器中的目标节点。
   * @param root - 编辑器根节点
   * @param path - 节点路径
   * @returns 对应节点；路径失效时返回 null
   */
  function resolveNodePath(root: Node, path: number[]): Node | null {
    let currentNode: Node | null = root;

    for (const childIndex of path) {
      currentNode = currentNode?.childNodes[childIndex] ?? null;
      if (!currentNode) {
        return null;
      }
    }

    return currentNode;
  }

  /**
   * 判断指定 Range 是否仍位于当前编辑器内部。
   * @param range - 待判断的 Range
   * @returns 是否属于当前编辑器
   */
  function isRangeInsideEditor(range: Range | null): boolean {
    if (!range || !editorRef.value) {
      return false;
    }

    return editorRef.value.contains(range.startContainer) && editorRef.value.contains(range.endContainer);
  }

  function cacheCurrentRange(): void {
    const range = getActiveRange();
    if (!isRangeInsideEditor(range) || !range) return;

    cachedRange.value = range.cloneRange();
    const path = buildNodePath(editorRef.value as Node, range.startContainer);
    cachedSelectionSnapshot.value = path ? { path, offset: range.startOffset } : null;
  }

  /**
   * 在编辑器仍持有有效光标时缓存当前位置，供失焦后的插入操作恢复。
   */
  function cacheCurrentRangeIfInsideEditor(): void {
    cacheCurrentRange();
  }

  /**
   * 恢复上一次缓存的光标位置。
   * @returns 恢复后的 Range；没有可用缓存时返回 null
   */
  function restoreCachedRange(): Range | null {
    if (!editorRef.value) {
      return null;
    }

    const selection = window.getSelection();
    if (!selection) {
      return null;
    }

    if (cachedSelectionSnapshot.value) {
      const targetNode = resolveNodePath(editorRef.value, cachedSelectionSnapshot.value.path);
      if (targetNode) {
        const restoredRange = document.createRange();
        const maxOffset = targetNode.nodeType === Node.TEXT_NODE ? targetNode.textContent?.length ?? 0 : targetNode.childNodes.length;
        const restoredOffset = Math.min(cachedSelectionSnapshot.value.offset, maxOffset);

        restoredRange.setStart(targetNode, restoredOffset);
        restoredRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(restoredRange);
        cachedRange.value = restoredRange.cloneRange();
        return restoredRange;
      }
    }

    if (!cachedRange.value) {
      return null;
    }

    const restoredRange = cachedRange.value.cloneRange();
    selection.removeAllRanges();
    selection.addRange(restoredRange);
    return restoredRange;
  }

  function getCursorPosition(): MenuPosition | null {
    const selection = getActiveSelection();
    if (!selection) return null;

    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    let rect = range.getBoundingClientRect();

    if (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0) {
      const span = document.createElement('span');
      span.textContent = ZERO_WIDTH_SPACE;
      range.insertNode(span);
      rect = span.getBoundingClientRect();
      const parentNode = span.parentNode as Node | null;
      const restoredOffset = parentNode ? Array.from(parentNode.childNodes).indexOf(span as ChildNode) : -1;

      span.remove();

      if (parentNode && restoredOffset >= 0) {
        restoreCollapsedSelectionAtOffset(selection, parentNode, restoredOffset);
      }
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
    cachedSelectionSnapshot,
    getActiveSelection,
    getActiveRange,
    cacheCurrentRange,
    cacheCurrentRangeIfInsideEditor,
    restoreCachedRange,
    getCursorPosition,
    getTextBeforeCursor,
    isSelectionInsideEditor,
    getVariableQueryBeforeCursor,
    insertTextAtCursor
  };
}
