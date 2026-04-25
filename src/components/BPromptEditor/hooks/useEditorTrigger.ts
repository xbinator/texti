import type { Variable } from '../types';
import type { MenuPosition } from './useEditorSelection';
import type { FileReferenceChip } from './useVariableEncoder';
import type { Ref } from 'vue';
import { ref } from 'vue';
import { CARET_SPACER, useVariableEncoder } from './useVariableEncoder';

export interface TriggerOptions {
  trigger?: string;
  variables: Ref<Variable[]>;
  updateModelValue: () => void;
  onHide: () => void;
}

export function useEditorTrigger(
  editorRef: Ref<HTMLDivElement | undefined>,
  selectionHook: ReturnType<typeof import('./useEditorSelection').useEditorSelection>,
  options: TriggerOptions
) {
  const { trigger = '{{', variables, updateModelValue, onHide } = options;

  const visible = ref(false);
  const menuPosition = ref<MenuPosition>({ top: 0, left: 0, bottom: 0 });
  const variableQuery = ref<string>('');
  const activeIndex = ref(0);

  const { createFileReferenceSpan, createVariableSpan, isChipElement } = useVariableEncoder({
    getVariableLabel: (value: string) => variables.value.find((v) => v.value === value)?.label
  });

  const { cachedRange, cacheCurrentRange, restoreCachedRange, getCursorPosition, getVariableQueryBeforeCursor, getActiveSelection, getActiveRange } =
    selectionHook;

  const filteredVariables = ref<Variable[]>([]);

  function updateFilteredVariables(): void {
    const query = variableQuery.value.trim().toLowerCase();
    if (!query) {
      filteredVariables.value = variables.value;
    } else {
      filteredVariables.value = variables.value.filter((variable) => {
        const searchText = [variable.label, variable.value, variable.description || ''].join(' ').toLowerCase();
        return searchText.includes(query);
      });
    }
  }

  function show(): void {
    if (!editorRef.value) return;
    cacheCurrentRange();
    const position = getCursorPosition();
    if (position) menuPosition.value = position;
    activeIndex.value = 0;
    visible.value = true;
  }

  function hide(): void {
    visible.value = false;
    cachedRange.value = null;
    variableQuery.value = '';
    onHide();
  }

  function updateMenuPosition(): void {
    if (!visible.value) return;
    const position = getCursorPosition();
    if (position) menuPosition.value = position;
  }

  function canShow(): boolean {
    const sel = selectionHook.getActiveSelection();
    return !!(editorRef.value && sel?.isCollapsed && getVariableQueryBeforeCursor() !== null);
  }

  function updateVisibility(): void {
    if (!canShow()) {
      if (visible.value) hide();
      return;
    }

    variableQuery.value = getVariableQueryBeforeCursor() ?? '';
    updateFilteredVariables();

    if (visible.value) {
      cacheCurrentRange();
      updateMenuPosition();
    } else {
      show();
    }
  }

  interface ChipTarget {
    chipNode: HTMLElement;
    spacerNode: Node | null;
  }

  function findAdjacentVariableNode(range: Range, direction: 'before' | 'after'): ChipTarget | null {
    const { startContainer, startOffset } = range;
    const isBefore = direction === 'before';

    if (startContainer.nodeType === Node.TEXT_NODE) {
      const text = startContainer.textContent ?? '';
      const relevantText = isBefore ? text.slice(0, startOffset) : text.slice(startOffset);
      const sibling = isBefore ? startContainer.previousSibling : startContainer.nextSibling;

      if (relevantText === CARET_SPACER && isChipElement(sibling)) {
        return { chipNode: sibling, spacerNode: startContainer };
      }
      const atEdge = isBefore ? startOffset === 0 : startOffset === text.length;
      if (atEdge && isChipElement(sibling)) {
        return { chipNode: sibling, spacerNode: null };
      }
      return null;
    }

    if (startContainer.nodeType === Node.ELEMENT_NODE) {
      const adjacentIndex = isBefore ? startOffset - 1 : startOffset;
      const node = startContainer.childNodes[adjacentIndex];
      if (!node) return null;

      if (isBefore && node.nodeType === Node.TEXT_NODE && node.textContent === CARET_SPACER && isChipElement(node.previousSibling)) {
        return { chipNode: node.previousSibling, spacerNode: node };
      }
      if (!isBefore && node.nodeType === Node.TEXT_NODE && node.textContent === CARET_SPACER && isChipElement(node.nextSibling)) {
        return { chipNode: node.nextSibling, spacerNode: node };
      }
      if (isChipElement(node)) {
        return { chipNode: node, spacerNode: null };
      }
    }

    return null;
  }

  function deleteAdjacentVariable(direction: 'before' | 'after'): boolean {
    const selection = getActiveSelection();
    if (!selection?.isCollapsed) return false;

    const range = getActiveRange();
    if (!range) return false;

    const target = findAdjacentVariableNode(range, direction);
    if (!target) return false;

    const { chipNode, spacerNode } = target;
    const parent = chipNode.parentNode;
    if (!parent) return false;
    const variableIndex = Array.from(parent.childNodes).indexOf(chipNode);
    if (variableIndex < 0) return false;

    spacerNode?.parentNode?.removeChild(spacerNode);
    parent.removeChild(chipNode);

    const newRange = document.createRange();
    const targetOffset = Math.min(variableIndex, parent.childNodes.length);
    newRange.setStart(parent, targetOffset);
    newRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(newRange);

    updateModelValue();
    return true;
  }

  function deleteQueryTrigger(range: Range): void {
    const queryText = getVariableQueryBeforeCursor();
    if (queryText === null) return;

    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE || !textNode.textContent) return;

    const triggerStart = range.startOffset - queryText.length - trigger.length;
    if (triggerStart < 0) return;

    const triggerRange = document.createRange();
    triggerRange.setStart(textNode, triggerStart);
    triggerRange.setEnd(textNode, range.startOffset);
    triggerRange.deleteContents();
    range.setStart(textNode, triggerStart);
  }

  /**
   * 解析当前可用的插入 Range，没有有效光标时回退到编辑器末尾。
   * @returns 可插入内容的 Range
   */
  function resolveInsertionRange(): Range | null {
    if (!editorRef.value) return null;
    editorRef.value.focus();

    if (cachedRange.value) {
      return restoreCachedRange();
    }

    const current = getActiveRange();
    if (current && editorRef.value.contains(current.startContainer)) {
      return current;
    }

    const selection = window.getSelection();
    if (!selection) return null;

    const range = document.createRange();
    range.selectNodeContents(editorRef.value);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    return range;
  }

  /**
   * 在当前光标位置插入不可编辑 chip，并补充光标落点。
   * @param chip - 待插入的 chip 元素
   * @param range - 插入位置
   */
  function insertChipAtRange(chip: HTMLElement, range: Range): void {
    range.deleteContents();
    range.insertNode(chip);

    const caretSpacer = document.createTextNode(CARET_SPACER);
    range.setStartAfter(chip);
    range.setEndAfter(chip);
    range.insertNode(caretSpacer);
    range.setStartAfter(caretSpacer);
    range.setEndAfter(caretSpacer);

    const selection = getActiveSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);

    // 插入完成后立即把新光标位置写回缓存，确保下一次插入从最新位置继续。
    cacheCurrentRange();
    updateModelValue();
    editorRef.value?.focus();
  }

  function selectVariable(variable: Variable): void {
    const range = resolveInsertionRange();
    if (!range) return;

    deleteQueryTrigger(range);
    insertChipAtRange(createVariableSpan(variable.value), range);
    hide();
  }

  /**
   * 在当前光标位置插入文件引用 chip。
   * @param reference - 文件引用数据
   */
  function insertFileReference(reference: FileReferenceChip): void {
    const range = resolveInsertionRange();
    if (!range) return;

    insertChipAtRange(createFileReferenceSpan(reference), range);
  }

  function handleMenuKeydown(event: KeyboardEvent): boolean {
    if (!visible.value) return false;

    const count = filteredVariables.value.length;

    switch (event.key) {
      case 'ArrowDown':
        if (!count) return false;
        event.preventDefault();
        activeIndex.value = (activeIndex.value + 1) % count;
        return true;
      case 'ArrowUp':
        if (!count) return false;
        event.preventDefault();
        activeIndex.value = activeIndex.value === 0 ? count - 1 : activeIndex.value - 1;
        return true;
      case 'Enter':
        event.preventDefault();
        if (filteredVariables.value[activeIndex.value]) {
          selectVariable(filteredVariables.value[activeIndex.value]);
        }
        return true;
      case 'Escape':
        event.preventDefault();
        hide();
        return true;
      default:
        return false;
    }
  }

  return {
    visible,
    menuPosition,
    variableQuery,
    activeIndex,
    filteredVariables,
    show,
    hide,
    updateMenuPosition,
    updateVisibility,
    deleteAdjacentVariable,
    insertFileReference,
    selectVariable,
    handleMenuKeydown,
    updateFilteredVariables
  };
}
