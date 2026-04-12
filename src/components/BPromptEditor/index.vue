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
  placeholder?: string;
  options?: VariableOptionGroup[];
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

const filteredVariables = computed<Variable[]>(() => {
  const query = variableQuery.value.trim().toLowerCase();
  if (!query) return variables.value;
  return variables.value.filter((variable) => {
    const searchText = [variable.label, variable.value, variable.description || ''].join(' ').toLowerCase();
    return searchText.includes(query);
  });
});

// ─── DOM Helpers ───────────────────────────────────────────────────────────────

function createVariableSpan(variableName: string): HTMLElement {
  const element = document.createElement('span');
  element.className = 'prompt-variable-tag';
  element.setAttribute('data-value', 'variable');
  element.setAttribute('data-content', variableName);
  element.setAttribute('contenteditable', 'false');
  const variable = variables.value.find((v) => v.value === variableName);
  element.textContent = variable?.label || variableName;
  return element;
}

function isVariableElement(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.dataset.value === 'variable';
}

// ─── Encode / Decode ───────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function encodeVariables(content: string): string {
  if (!content) return '';
  return escapeHtml(content).replace(/\{\{([^{}]+)\}\}/g, (_, name) => createVariableSpan(name.trim()).outerHTML);
}

function decodeVariables(content: string): string {
  if (!content) return '';

  const decoded = content
    .replace(/<span[^>]*data-content="([^"]+)"[^>]*>.*?<\/span>/g, '{{$1}}')
    .split(CARET_SPACER)
    .join('');

  const temp = document.createElement('div');
  temp.innerHTML = decoded;

  temp.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  temp.querySelectorAll('div, p').forEach((block) => {
    block.parentNode?.insertBefore(document.createTextNode('\n'), block);
    while (block.firstChild) block.parentNode?.insertBefore(block.firstChild, block);
    block.remove();
  });

  return temp.textContent || '';
}

// ─── Selection Helpers ────────────────────────────────────────────────────────

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

// ─── Variable Node Detection ──────────────────────────────────────────────────

interface VariableTarget {
  variableNode: HTMLElement;
  spacerNode: Node | null;
}

/**
 * Generalized finder for a variable node adjacent to the cursor.
 * direction: 'before' | 'after'
 */
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

// ─── Model Sync ───────────────────────────────────────────────────────────────

function updateModelValue(): void {
  if (!editorRef.value) return;
  const decoded = decodeVariables(editorRef.value.innerHTML);
  inputValue.value = decoded;
  emit('change', decoded);
}

// ─── Cursor Insertion ─────────────────────────────────────────────────────────

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

// ─── Menu Lifecycle ───────────────────────────────────────────────────────────

function showMenu(): void {
  if (!editorRef.value) return;
  cacheCurrentRange();
  const position = getCursorPosition();
  if (position) menuPosition.value = position;
  activeIndex.value = 0;
  showVariableMenu.value = true;
}

function hideMenu(): void {
  showVariableMenu.value = false;
  cachedRange.value = null;
  variableQuery.value = '';
}

function updateMenuPosition(): void {
  if (!showVariableMenu.value) return;
  const position = getCursorPosition();
  if (position) menuPosition.value = position;
}

function canShowMenu(): boolean {
  const sel = getActiveSelection();
  return !!(editorRef.value && sel?.isCollapsed && getVariableQueryBeforeCursor() !== null);
}

function updateDropdownVisibility(): void {
  if (!canShowMenu()) {
    if (showVariableMenu.value) hideMenu();
    return;
  }

  variableQuery.value = getVariableQueryBeforeCursor() ?? '';

  if (showVariableMenu.value) {
    cacheCurrentRange();
    updateMenuPosition();
  } else {
    showMenu();
  }
}

// ─── Variable Selection ───────────────────────────────────────────────────────

function deleteQueryTrigger(range: Range): void {
  const queryText = getVariableQueryBeforeCursor();
  if (queryText === null) return;

  const textNode = range.startContainer;
  if (textNode.nodeType !== Node.TEXT_NODE || !textNode.textContent) return;

  const triggerStart = range.startOffset - queryText.length - 2; // 2 = '{{'
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
  hideMenu();
}

// ─── Variable Deletion ────────────────────────────────────────────────────────

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

// ─── Event Handlers ───────────────────────────────────────────────────────────

function handleInput(): void {
  if (props.disabled) return;
  updateModelValue();
  updateDropdownVisibility();
}

function handleKeyDown(event: KeyboardEvent): void {
  if (props.disabled) return;

  if (event.key === 'Backspace' && deleteAdjacentVariable('before')) {
    event.preventDefault();
    hideMenu();
    return;
  }

  if (event.key === 'Delete' && deleteAdjacentVariable('after')) {
    event.preventDefault();
    hideMenu();
    return;
  }

  if (event.key === 'Enter' && !showVariableMenu.value) {
    event.preventDefault();
    insertTextAtCursor('\n');
    updateModelValue();
    return;
  }

  if (!showVariableMenu.value) return;

  const count = filteredVariables.value.length;

  switch (event.key) {
    case 'ArrowDown':
      if (!count) break;
      event.preventDefault();
      activeIndex.value = (activeIndex.value + 1) % count;
      break;
    case 'ArrowUp':
      if (!count) break;
      event.preventDefault();
      activeIndex.value = activeIndex.value === 0 ? count - 1 : activeIndex.value - 1;
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

function handlePaste(event: ClipboardEvent): void {
  if (props.disabled) return;
  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain');
  if (text) {
    insertTextAtCursor(text);
    updateModelValue();
  }
}

function handleBlur(): void {
  if (!props.disabled) setTimeout(hideMenu, 200);
}

function handleSelectionChange(): void {
  if (props.disabled || !isSelectionInsideEditor()) {
    if (showVariableMenu.value) hideMenu();
    return;
  }
  updateDropdownVisibility();
  updateMenuPosition();
}

function handleClickOutside(event: MouseEvent): void {
  if (showVariableMenu.value && !wrapperRef.value?.contains(event.target as HTMLElement)) {
    hideMenu();
  }
}

let rafId = 0;
function handleViewportChange(): void {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(updateMenuPosition);
}

// ─── Watchers ─────────────────────────────────────────────────────────────────

watch(inputValue, (newValue) => {
  const encoded = encodeVariables(newValue);
  if (editorRef.value && editorRef.value.innerHTML !== encoded) {
    editorRef.value.innerHTML = encoded;
  }
});

watch(filteredVariables, (vars) => {
  if (activeIndex.value >= vars.length) activeIndex.value = 0;
});

// ─── Lifecycle ────────────────────────────────────────────────────────────────

onMounted(() => {
  if (editorRef.value) editorRef.value.innerHTML = encodeVariables(inputValue.value);
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
:deep(.prompt-variable-tag) {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  font-family: inherit;
  font-size: 12px;
  line-height: 20px;
  color: var(--color-primary, #4080ff);
  background-color: rgb(var(--color-primary-value, 64, 128, 255), 0.1);
  border-radius: 4px;
}

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
