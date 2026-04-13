import type { Variable } from '../types';
import type { MenuPosition } from './useEditorSelection';
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

  const { createVariableSpan, isVariableElement } = useVariableEncoder({
    getVariableLabel: (value: string) => variables.value.find((v) => v.value === value)?.label
  });

  const { cachedRange, cacheCurrentRange, getCursorPosition, getVariableQueryBeforeCursor, getActiveSelection, getActiveRange } = selectionHook;

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

  interface VariableTarget {
    variableNode: HTMLElement;
    spacerNode: Node | null;
  }

  function findAdjacentVariableNode(range: Range, direction: 'before' | 'after'): VariableTarget | null {
    const { startContainer, startOffset } = range;
    const isBefore = direction === 'before';

    if (startContainer.nodeType === Node.TEXT_NODE) {
      const text = startContainer.textContent ?? '';
      const relevantText = isBefore ? text.slice(0, startOffset) : text.slice(startOffset);
      const sibling = isBefore ? startContainer.previousSibling : startContainer.nextSibling;

      if (relevantText === CARET_SPACER && isVariableElement(sibling)) {
        return { variableNode: sibling, spacerNode: startContainer };
      }
      const atEdge = isBefore ? startOffset === 0 : startOffset === text.length;
      if (atEdge && isVariableElement(sibling)) {
        return { variableNode: sibling, spacerNode: null };
      }
      return null;
    }

    if (startContainer.nodeType === Node.ELEMENT_NODE) {
      const adjacentIndex = isBefore ? startOffset - 1 : startOffset;
      const node = startContainer.childNodes[adjacentIndex];
      if (!node) return null;

      if (isBefore && node.nodeType === Node.TEXT_NODE && node.textContent === CARET_SPACER && isVariableElement(node.previousSibling)) {
        return { variableNode: node.previousSibling, spacerNode: node };
      }
      if (!isBefore && node.nodeType === Node.TEXT_NODE && node.textContent === CARET_SPACER && isVariableElement(node.nextSibling)) {
        return { variableNode: node.nextSibling, spacerNode: node };
      }
      if (isVariableElement(node)) {
        return { variableNode: node, spacerNode: null };
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

    const { variableNode, spacerNode } = target;
    const parent = variableNode.parentNode;
    if (!parent) return false;

    const nextNode = direction === 'before' ? spacerNode?.nextSibling || variableNode.nextSibling : null;

    spacerNode?.parentNode?.removeChild(spacerNode);
    parent.removeChild(variableNode);

    const newRange = document.createRange();
    if (nextNode) {
      newRange.setStartBefore(nextNode);
    } else {
      newRange.selectNodeContents(parent);
      newRange.collapse(false);
    }
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

  function selectVariable(variable: Variable): void {
    if (!editorRef.value) return;
    editorRef.value.focus();

    const selection = getActiveSelection();
    if (!selection) return;

    let range: Range;
    if (cachedRange.value) {
      range = cachedRange.value.cloneRange();
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      const current = getActiveRange();
      if (!current) return;
      range = current;
    }

    deleteQueryTrigger(range);

    const variableSpan = createVariableSpan(variable.value);
    range.deleteContents();
    range.insertNode(variableSpan);

    const caretSpacer = document.createTextNode(CARET_SPACER);
    range.setStartAfter(variableSpan);
    range.setEndAfter(variableSpan);
    range.insertNode(caretSpacer);
    range.setStartAfter(caretSpacer);
    range.setEndAfter(caretSpacer);
    selection.removeAllRanges();
    selection.addRange(range);

    updateModelValue();
    hide();

    editorRef.value.focus();
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
    selectVariable,
    handleMenuKeydown,
    updateFilteredVariables
  };
}
