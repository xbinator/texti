<template>
  <div ref="wrapperRef" class="b-prompt-variable">
    <div
      ref="editorRef"
      :contenteditable="!disabled"
      spellcheck="true"
      aria-multiline="true"
      :aria-disabled="disabled"
      class="b-prompt-variable__textarea"
      :class="`b-prompt-variable--${variant}`"
      :style="editorStyle"
      :data-placeholder="placeholder"
      @paste="handlePaste"
      @keydown="handleKeyDown"
      @blur="handleBlur"
      @input="handleInput"
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
</template>

<script setup lang="ts">
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
  variant: 'outlined',
  submitOnEnter: true
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

const { selectionHook, updateModelValue, initializeEditor, cleanup } = useEditorCore(editorRef, inputValue, {
  variables,
  emitChange: (value) => emit('change', value)
});

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
  onSubmit: () => emit('submit'),
  submitOnEnter: computed(() => props.submitOnEnter),
  onMenuKeydown: trigger.handleMenuKeydown,
  isMenuVisible: trigger.visible,
  hideMenu: trigger.hide
});

const { handlePaste } = useEditorPaste({
  disabled: disabledRef,
  insertTextAtCursor: selectionHook.insertTextAtCursor,
  updateModelValue
});

function handleInput(): void {
  if (props.disabled) return;
  updateModelValue();
  trigger.updateVisibility();
}

function handleBlur(): void {
  if (!props.disabled) setTimeout(trigger.hide, 200);
}

function handleSelectionChange(): void {
  if (props.disabled || !selectionHook.isSelectionInsideEditor()) {
    if (trigger.visible.value) trigger.hide();
    return;
  }
  trigger.updateVisibility();
  trigger.updateMenuPosition();
}

function handleClickOutside(event: MouseEvent): void {
  if (trigger.visible.value && !wrapperRef.value?.contains(event.target as HTMLElement)) {
    trigger.hide();
  }
}

let rafId = 0;
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
</script>

<style lang="less">
@import url('@/assets/styles/scrollbar.less');

.b-prompt-variable-tag {
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

.b-prompt-variable {
  position: relative;
  width: 100%;
}

.b-prompt-variable__textarea {
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

  &:empty::before {
    font-size: 14px;
    color: var(--text-placeholder);
    pointer-events: none;
    content: attr(data-placeholder);
  }

  .scrollbar-style();
}

.b-prompt-variable--outlined {
  background: var(--input-bg);
  border: 1px solid var(--input-border);

  &:hover {
    border-color: var(--border-hover);
  }

  &:focus {
    border-color: var(--input-focus-border);
    box-shadow: 0 0 0 2px var(--input-focus-shadow);
  }
}

.b-prompt-variable--borderless {
  background: transparent;
  border: none;

  &:hover,
  &:focus {
    border: none;
    box-shadow: none;
  }
}

.b-prompt-variable--filled {
  background: var(--bg-secondary);
  border: none;

  &:hover {
    background: var(--bg-tertiary);
  }

  &:focus {
    background: var(--input-bg);
    box-shadow: none;
  }
}

.b-prompt-variable--underlined {
  padding-right: 0;
  padding-left: 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--input-border);
  border-radius: 0;

  &:hover {
    border-bottom-color: var(--border-hover);
  }

  &:focus {
    border-bottom-color: var(--input-focus-border);
    box-shadow: none;
  }
}
</style>
