<template>
  <div ref="wrapperRef" class="b-prompt-editor" @click="handleContainerClick">
    <div class="b-prompt-editor__container">
      <div v-if="!disabled" v-show="editorIsEmpty" class="b-prompt-editor__placeholder">
        {{ placeholder }}
      </div>

      <div
        ref="editorRef"
        :contenteditable="!disabled"
        spellcheck="true"
        aria-multiline="true"
        :aria-disabled="disabled"
        class="b-prompt-editor__textarea"
        :style="editorStyle"
        data-empty="true"
        @paste="handlePaste"
        @dragover="handleDragOver"
        @drop="handleDrop"
        @keydown="handleKeyDown"
        @keyup="handleCaretChange"
        @blur="handleBlur"
        @input="handleInput"
        @mouseup="handleCaretChange"
      ></div>

      <VariableSelect
        v-if="options.length"
        :visible="trigger.visible.value"
        :variables="trigger.filteredVariables.value"
        :position="trigger.menuPosition.value"
        :active-index="trigger.activeIndex.value"
        @select="trigger.selectVariable"
        @update:active-index="trigger.activeIndex.value = $event"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BPromptEditor/index.vue
 * @description Prompt editor input surface, variable insertion, and submit interactions.
 */
import type { FileReferenceChip } from './hooks/useVariableEncoder';
import type { Variable, BPromptEditorProps as Props } from './types';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { addCssUnit } from '@/utils/css';
import VariableSelect from './components/VariableSelect.vue';
import { useEditorCore, useEditorKeyboard, useEditorPaste, useEditorTrigger } from './hooks';

const props = withDefaults(defineProps<Props>(), {
  placeholder: '请输入内容...',
  options: () => [],
  disabled: false,
  maxHeight: undefined,
  submitOnEnter: false
});

const emit = defineEmits<{
  (e: 'change', value: string): void;
  (e: 'submit'): void;
}>();

const inputValue = defineModel<string>('value', { default: '' });

const wrapperRef = ref<HTMLDivElement>();
const editorRef = ref<HTMLDivElement>();
const disabledRef = computed(() => props.disabled);

const variables = computed<Variable[]>(() => props.options.flatMap((group) => group.options));

const editorStyle = computed(() => {
  const style: Record<string, string> = {};
  if (props.maxHeight) {
    style.maxHeight = addCssUnit(props.maxHeight);
  }
  return style;
});

const { selectionHook, updateModelValue, normalizeInlineTokens, initializeEditor, cleanup, editorIsEmpty, undoHistory, redoHistory } = useEditorCore(
  editorRef,
  inputValue,
  {
    variables,
    emitChange: (value) => emit('change', value)
  }
);

const trigger = useEditorTrigger(editorRef, selectionHook, {
  variables,
  updateModelValue,
  onHide: () => {
    //
  }
});

const { handleKeyDown } = useEditorKeyboard({
  disabled: disabledRef,
  onDeleteVariable: trigger.deleteAdjacentVariable,
  onEnter: () => {
    selectionHook.insertTextAtCursor('\n');
    updateModelValue();
  },
  onUndo: () => undoHistory(),
  onRedo: () => redoHistory(),
  onSubmit: () => emit('submit'),
  submitOnEnter: computed(() => props.submitOnEnter),
  onMenuKeydown: trigger.handleMenuKeydown,
  isMenuVisible: trigger.visible,
  hideMenu: trigger.hide
});

const { handlePaste, handleDragOver, handleDrop } = useEditorPaste({
  disabled: disabledRef,
  insertTextAtCursor: selectionHook.insertTextAtCursor,
  updateModelValue
});

/**
 * Keeps the editor model synchronized after direct typing or chip edits.
 */
function handleInput(): void {
  if (props.disabled) return;
  updateModelValue();
  normalizeInlineTokens();
  // 输入完成后立即记录最新光标，避免失焦前缓存退化为根节点级 offset。
  requestAnimationFrame(selectionHook.cacheCurrentRangeIfInsideEditor);
  trigger.updateVisibility();
}

/**
 * Hides the suggestion menu shortly after the editor loses focus.
 */
function handleBlur(): void {
  if (props.disabled) return;
  setTimeout(trigger.hide, 200);
}

/**
 * 在用户点击或键盘移动光标后，同步记录最近一次有效插入点。
 */
function handleCaretChange(): void {
  if (props.disabled) return;

  requestAnimationFrame(selectionHook.cacheCurrentRangeIfInsideEditor);
}

/**
 * Focuses the editable surface when the wrapper is clicked.
 */
function handleContainerClick(): void {
  if (!props.disabled && editorRef.value) {
    editorRef.value.focus();
    selectionHook.restoreCachedRange();
  }
}

/**
 * Focuses the underlying contenteditable node for external callers.
 */
function focus(): void {
  editorRef.value?.focus();
}

/**
 * 显式记录当前光标位置，供外部在失焦后恢复插入点。
 */
function captureCursorPosition(): void {
  if (props.disabled) return;

  selectionHook.cacheCurrentRangeIfInsideEditor();
}

/**
 * Inserts a file-reference chip into the editor.
 * @param reference - File reference metadata.
 */
function insertFileReference(reference: FileReferenceChip): void {
  if (props.disabled) return;

  editorRef.value?.focus();
  selectionHook.restoreCachedRange();
  trigger.insertFileReference(reference);
}

/**
 * Recomputes the variable picker visibility when the selection changes.
 */
function handleSelectionChange(): void {
  if (props.disabled) {
    if (trigger.visible.value) trigger.hide();
    return;
  }

  if (!selectionHook.isSelectionInsideEditor()) {
    if (trigger.visible.value) trigger.hide();
    return;
  }

  trigger.updateVisibility();
  trigger.updateMenuPosition();
}

/**
 * Closes the variable menu when clicks land outside the editor wrapper.
 * @param event - Mouse click event.
 */
function handleClickOutside(event: MouseEvent): void {
  if (trigger.visible.value && !wrapperRef.value?.contains(event.target as HTMLElement)) {
    trigger.hide();
  }
}

let rafId = 0;

/**
 * Repositions the variable menu on viewport changes.
 */
function handleViewportChange(): void {
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(trigger.updateMenuPosition);
}

watch(variables, () => {
  trigger.updateFilteredVariables();
});

watch(trigger.filteredVariables, (vars) => {
  if (trigger.activeIndex.value >= vars.length) trigger.activeIndex.value = 0;
});

onMounted(() => {
  initializeEditor();
  document.addEventListener('click', handleClickOutside);
  document.addEventListener('selectionchange', handleSelectionChange);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('scroll', handleViewportChange, true);
});

onUnmounted(() => {
  cleanup();
  document.removeEventListener('click', handleClickOutside);
  document.removeEventListener('selectionchange', handleSelectionChange);
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('scroll', handleViewportChange, true);
});

defineExpose({ focus, captureCursorPosition, insertFileReference });
</script>

<style lang="less">
@import url('@/assets/styles/scrollbar.less');

.b-prompt-editor-tag {
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

.b-prompt-editor-tag--file-reference {
  color: var(--text-primary);
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-primary);
}

.b-prompt-editor {
  width: 100%;
  min-height: 80px;
  padding: 12px;
  overflow-y: auto;
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

  .scrollbar-style();
}

.b-prompt-editor__container {
  position: relative;
  width: 100%;
  height: 100%;
}

.b-prompt-editor__placeholder {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: inherit;
  color: var(--text-placeholder);
  pointer-events: none;
}

.b-prompt-editor__textarea {
  width: 100%;
  height: 100%;
  resize: none;
  outline: none;
  background: var(--input-bg);
  border: none;
}
</style>
