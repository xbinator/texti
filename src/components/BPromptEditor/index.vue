<template>
  <div ref="wrapperRef" class="variable-editor-wrapper">
    <div
      ref="editorRef"
      :contenteditable="!disabled"
      spellcheck="true"
      aria-multiline="true"
      :aria-disabled="disabled"
      class="variable-editor"
      :data-placeholder="placeholder"
      @paste="handlePaste"
      @keydown="handleKeyDown"
      @blur="handleBlur"
      @input="handleInput"
    ></div>

    <VariableSelect
      :visible="showVariableMenu"
      :variables="filteredVariables"
      :position="menuPosition"
      :active-index="activeIndex"
      @select="selectVariable"
      @update:active-index="activeIndex = $event"
    />
  </div>
</template>

<script setup lang="ts">
import type { Variable, VariableOptionGroup } from './types';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import VariableSelect from './components/VariableSelect.vue';

interface Props {
  // 占位符文本
  placeholder?: string;
  // 变量分组选项
  options?: VariableOptionGroup[];
  // 是否禁用
  disabled?: boolean;
}

interface MenuPosition {
  top: number;
  left: number;
  bottom: number;
}

const CARET_SPACER = '\u00A0';

const props = withDefaults(defineProps<Props>(), {
  placeholder: '请输入内容...',
  options: () => [],
  disabled: false
});

const emit = defineEmits<{ (e: 'change', value: string): void }>();

const inputValue = defineModel<string>('value', { default: '' });

const wrapperRef = ref<HTMLDivElement>();
const editorRef = ref<HTMLDivElement>();
const showVariableMenu = ref(false);
const activeIndex = ref(0);
const cachedRange = ref<Range | null>(null);
const menuPosition = ref<MenuPosition>({ top: 0, left: 0, bottom: 0 });
const variableQuery = ref<string>('');

const variables = computed<Variable[]>(() => props.options.flatMap((group) => group.options));

function createVariableSpan(variableName: string): HTMLElement {
  const element = document.createElement('span');

  element.setAttribute('data-value', 'variable');
  element.setAttribute('data-content', variableName);
  element.setAttribute('contenteditable', 'false');

  element.style.backgroundColor = 'rgba(var(--color-primary-value, 64, 128, 255), 0.1)';
  element.style.color = 'var(--color-primary, #4080ff)';
  element.style.borderRadius = '4px';
  element.style.fontSize = '12px';
  element.style.padding = '0 6px';
  element.style.height = '20px';
  element.style.lineHeight = '20px';
  element.style.display = 'inline-flex';
  element.style.alignItems = 'center';
  element.style.gap = '4px';
  element.style.fontFamily = 'inherit';

  const variable = variables.value.find((v) => v.value === variableName);
  element.textContent = variable?.label || variableName;

  return element;
}

function encodeVariables(content: string): string {
  if (!content) return '';

  return content.replace(/\{\{([^{}]+)\}\}/g, (_, variableName) => {
    const span = createVariableSpan(variableName.trim());
    return span.outerHTML;
  });
}

function decodeVariables(content: string): string {
  if (!content) return '';

  return content
    .replace(/<span[^>]*data-content="([^"]+)"[^>]*>.*?<\/span>/g, '{{$1}}')
    .split(CARET_SPACER)
    .join('');
}

function getCursorPosition(): MenuPosition | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0).cloneRange();
  range.collapse(true);
  let rect = range.getBoundingClientRect();

  if (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0) {
    const span = document.createElement('span');
    span.textContent = '\u200b';
    range.insertNode(span);
    rect = span.getBoundingClientRect();
    const restoreRange = document.createRange();
    restoreRange.setStartBefore(span);
    restoreRange.collapse(true);
    span.remove();
    selection.removeAllRanges();
    selection.addRange(restoreRange);
  }

  return {
    top: rect.top,
    left: rect.left,
    bottom: rect.bottom
  };
}

function getTextBeforeCursor(): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return '';

  const range = selection.getRangeAt(0);
  const node = range.startContainer;
  const offset = range.startOffset;

  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent?.slice(0, offset) || '';
  }

  return '';
}

function isVariableElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.value === 'variable';
}

function findVariableNodeBeforeCursor(range: Range): { variableNode: HTMLElement; spacerNode: Node | null } | null {
  const { startContainer, startOffset } = range;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = startContainer;
    const beforeText = textNode.textContent?.slice(0, startOffset) || '';

    if (beforeText === CARET_SPACER && isVariableElement(textNode.previousSibling)) {
      return {
        variableNode: textNode.previousSibling,
        spacerNode: textNode
      };
    }

    if (startOffset === 0 && isVariableElement(textNode.previousSibling)) {
      return {
        variableNode: textNode.previousSibling,
        spacerNode: null
      };
    }

    return null;
  }

  if (startContainer.nodeType === Node.ELEMENT_NODE && startOffset > 0) {
    const previousNode = startContainer.childNodes[startOffset - 1];

    if (previousNode?.nodeType === Node.TEXT_NODE && previousNode.textContent === CARET_SPACER && isVariableElement(previousNode.previousSibling)) {
      return {
        variableNode: previousNode.previousSibling,
        spacerNode: previousNode
      };
    }

    if (isVariableElement(previousNode)) {
      return {
        variableNode: previousNode,
        spacerNode: null
      };
    }
  }

  return null;
}

function findVariableNodeAfterCursor(range: Range): { variableNode: HTMLElement; spacerNode: Node | null } | null {
  const { startContainer, startOffset } = range;

  if (startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = startContainer;
    const afterText = textNode.textContent?.slice(startOffset) || '';

    if (afterText === CARET_SPACER && isVariableElement(textNode.nextSibling)) {
      return {
        variableNode: textNode.nextSibling,
        spacerNode: textNode
      };
    }

    if (startOffset === textNode.textContent?.length && isVariableElement(textNode.nextSibling)) {
      return {
        variableNode: textNode.nextSibling,
        spacerNode: null
      };
    }

    return null;
  }

  if (startContainer.nodeType === Node.ELEMENT_NODE) {
    const nextNode = startContainer.childNodes[startOffset];

    if (nextNode?.nodeType === Node.TEXT_NODE && nextNode.textContent === CARET_SPACER && isVariableElement(nextNode.nextSibling)) {
      return {
        variableNode: nextNode.nextSibling,
        spacerNode: nextNode
      };
    }

    if (isVariableElement(nextNode)) {
      return {
        variableNode: nextNode,
        spacerNode: null
      };
    }
  }

  return null;
}

function isSelectionInsideEditor(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const { anchorNode } = selection;
  if (!anchorNode || !editorRef.value) return false;

  return editorRef.value.contains(anchorNode);
}

function getVariableQueryBeforeCursor(): string | null {
  const beforeText = getTextBeforeCursor();
  const match = beforeText.match(/\{\{([^{}]*)$/);

  if (!match) return null;

  return match[1] || '';
}

function hasTriggerBeforeCursor(): boolean {
  return getVariableQueryBeforeCursor() !== null;
}

const filteredVariables = computed<Variable[]>(() => {
  const query = variableQuery.value.trim().toLowerCase();

  if (!query) return variables.value;

  return variables.value.filter((variable) => {
    const searchText = [variable.label, variable.value, variable.description || ''].join(' ').toLowerCase();

    return searchText.includes(query);
  });
});

function updateModelValue(): void {
  if (!editorRef.value) return;

  const content = editorRef.value.innerHTML;
  const decoded = decodeVariables(content);

  inputValue.value = decoded;
  emit('change', decoded);
}

watch(inputValue, (newValue) => {
  if (editorRef.value && editorRef.value.innerHTML !== encodeVariables(newValue)) {
    editorRef.value.innerHTML = encodeVariables(newValue);
  }
});

watch(filteredVariables, (newVariables) => {
  if (newVariables.length === 0) {
    activeIndex.value = 0;
    return;
  }

  if (activeIndex.value >= newVariables.length) {
    activeIndex.value = 0;
  }
});

function showMenu(): void {
  if (!editorRef.value) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  cachedRange.value = range.cloneRange();

  const position = getCursorPosition();
  if (position) {
    menuPosition.value = position;
  }

  activeIndex.value = 0;
  showVariableMenu.value = true;
}

function updateMenuPosition(): void {
  if (!showVariableMenu.value) return;

  const position = getCursorPosition();
  if (position) {
    menuPosition.value = position;
  }
}

function syncVariableQuery(): void {
  variableQuery.value = getVariableQueryBeforeCursor() || '';
}

function hideMenu(): void {
  showVariableMenu.value = false;
  cachedRange.value = null;
  variableQuery.value = '';
}

function selectVariable(variable: Variable): void {
  if (!editorRef.value) return;

  editorRef.value.focus();

  const selection = window.getSelection();
  if (!selection) return;

  let range: Range;

  if (cachedRange.value) {
    range = cachedRange.value.cloneRange();
    selection.removeAllRanges();
    selection.addRange(range);
  } else if (selection.rangeCount > 0) {
    range = selection.getRangeAt(0);
  } else {
    return;
  }

  const variableQueryText = getVariableQueryBeforeCursor();
  if (variableQueryText !== null) {
    const textNode = range.startContainer;
    if (textNode.nodeType === Node.TEXT_NODE && textNode.textContent) {
      const triggerStartOffset = range.startOffset - variableQueryText.length - 2;
      if (triggerStartOffset >= 0) {
        const triggerRange = document.createRange();
        triggerRange.setStart(textNode, triggerStartOffset);
        triggerRange.setEnd(textNode, range.startOffset);
        triggerRange.deleteContents();
        range.setStart(textNode, triggerStartOffset);
      }
    }
  }

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
  hideMenu();
}

function deleteVariableBeforeCursor(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

  const range = selection.getRangeAt(0);
  const target = findVariableNodeBeforeCursor(range);
  if (!target) return false;

  const { variableNode, spacerNode } = target;
  const { parentNode } = variableNode;
  if (!parentNode) return false;

  const nextNode = spacerNode?.nextSibling || variableNode.nextSibling;

  if (spacerNode) {
    spacerNode.parentNode?.removeChild(spacerNode);
  }
  parentNode.removeChild(variableNode);

  const nextSelection = document.createRange();

  if (nextNode) {
    nextSelection.setStartBefore(nextNode);
  } else {
    nextSelection.selectNodeContents(parentNode);
    nextSelection.collapse(false);
  }

  nextSelection.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextSelection);

  updateModelValue();
  return true;
}

function deleteVariableAfterCursor(): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

  const range = selection.getRangeAt(0);
  const target = findVariableNodeAfterCursor(range);
  if (!target) return false;

  const { variableNode, spacerNode } = target;
  const { parentNode } = variableNode;
  if (!parentNode) return false;

  if (spacerNode) {
    spacerNode.parentNode?.removeChild(spacerNode);
  }
  parentNode.removeChild(variableNode);

  const nextSelection = document.createRange();
  nextSelection.selectNodeContents(parentNode);
  nextSelection.collapse(false);
  selection.removeAllRanges();
  selection.addRange(nextSelection);

  updateModelValue();
  return true;
}

function canShowMenu(): boolean {
  if (!editorRef.value) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;

  return hasTriggerBeforeCursor();
}

function updateDropdownVisibility(): void {
  if (canShowMenu()) {
    syncVariableQuery();

    if (showVariableMenu.value) {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        cachedRange.value = selection.getRangeAt(0).cloneRange();
      }
      updateMenuPosition();
    } else {
      showMenu();
    }
  } else if (showVariableMenu.value) {
    hideMenu();
  }
}

function syncMenuWithSelection(): void {
  if (props.disabled || !isSelectionInsideEditor()) {
    if (showVariableMenu.value) {
      hideMenu();
    }
    return;
  }

  updateDropdownVisibility();
  updateMenuPosition();
}

function handleInput(): void {
  if (props.disabled) return;
  updateModelValue();
  updateDropdownVisibility();
}

function handleKeyDown(event: KeyboardEvent): void {
  if (props.disabled) return;

  if (event.key === 'Backspace' && deleteVariableBeforeCursor()) {
    event.preventDefault();
    hideMenu();
    return;
  }

  if (event.key === 'Delete' && deleteVariableAfterCursor()) {
    event.preventDefault();
    hideMenu();
    return;
  }

  if (showVariableMenu.value) {
    const variableCount = filteredVariables.value.length;

    switch (event.key) {
      case 'ArrowDown':
        if (variableCount === 0) break;
        event.preventDefault();
        activeIndex.value = (activeIndex.value + 1) % variableCount;
        break;
      case 'ArrowUp':
        if (variableCount === 0) break;
        event.preventDefault();
        activeIndex.value = activeIndex.value === 0 ? variableCount - 1 : activeIndex.value - 1;
        break;
      case 'Enter':
        event.preventDefault();
        if (filteredVariables.value[activeIndex.value]) {
          selectVariable(filteredVariables.value[activeIndex.value]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        hideMenu();
        break;
      default:
        break;
    }
  }
}

function handlePaste(event: ClipboardEvent): void {
  if (props.disabled) return;

  event.preventDefault();

  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const textNode = document.createTextNode(text);
  range.insertNode(textNode);

  range.setStartAfter(textNode);
  range.setEndAfter(textNode);

  selection.removeAllRanges();
  selection.addRange(range);

  updateModelValue();
}

function handleBlur(): void {
  if (props.disabled) return;

  setTimeout(() => {
    hideMenu();
  }, 200);
}

function handleSelectionChange(): void {
  syncMenuWithSelection();
}

function handleViewportChange(): void {
  updateMenuPosition();
}

function handleClickOutside(event: MouseEvent): void {
  const target = event.target as HTMLElement;

  const isClickInsideEditor = wrapperRef.value && wrapperRef.value.contains(target);

  if (!isClickInsideEditor && showVariableMenu.value) {
    hideMenu();
  }
}

function initializeEditor(): void {
  if (!editorRef.value) return;

  editorRef.value.innerHTML = encodeVariables(inputValue.value);
}

onMounted(() => {
  initializeEditor();
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('selectionchange', handleSelectionChange);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('scroll', handleViewportChange, true);
});

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('selectionchange', handleSelectionChange);
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, true);
});
</script>

<style scoped lang="less">
.variable-editor-wrapper {
  position: relative;
  width: 100%;
}

.variable-editor {
  min-height: 80px;
  padding: 12px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-all;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  outline: none;
  background: var(--input-bg);
  border: 1px solid var(--input-border);
  border-radius: 6px;
  transition: all 0.2s;

  &:hover {
    border-color: var(--border-hover);
  }

  &:focus {
    background: var(--input-bg);
    border-color: var(--input-focus-border);
    box-shadow: 0 0 0 2px var(--input-focus-shadow);
  }

  &:empty::before {
    font-size: 14px;
    color: var(--text-placeholder);
    pointer-events: none;
    content: attr(data-placeholder);
  }
}
</style>
