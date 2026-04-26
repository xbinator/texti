<template>
  <div ref="wrapperRef" class="b-prompt-editor" @click="handleContainerClick">
    <div class="b-prompt-editor__container">
      <div v-if="!disabled" v-show="editorIsEmpty" class="b-prompt-editor__placeholder">
        {{ placeholder }}
      </div>
      <div ref="editorHostRef" class="b-prompt-editor__codemirror"></div>
      <VariableSelect
        :visible="triggerVisible.value"
        :variables="filteredVariables"
        :position="triggerPosition.value"
        :active-index="triggerActiveIndex.value"
        @select="handleVariableSelect"
        @update:active-index="handleActiveIndexChange"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BPromptEditor/index.vue
 * @description Prompt editor main component using CodeMirror 6
 */
import type { Variable, BPromptEditorProps } from './types';
import type { VariableOptionGroup } from './types';
import { computed, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue';
import { EditorState, Annotation } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import VariableSelect from './components/VariableSelect.vue';

import { variableChipField } from './extensions/variableChip';
import { triggerStateField, setTriggerActiveIndex, closeTrigger } from './extensions/triggerState';
import { createTriggerPlugin } from './extensions/triggerPlugin';
import { createPlaceholderExtension } from './extensions/placeholder';
import { createPasteHandlerExtension } from './extensions/pasteHandler';
import { editableCompartment, readOnlyCompartment, themeCompartment } from './extensions/base';

interface Props {
  placeholder?: string;
  options?: VariableOptionGroup[];
  disabled?: boolean;
  maxHeight?: number | string;
  submitOnEnter?: boolean;
}

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

const modelValue = defineModel<string>('value', { default: '' });

// Template refs
const wrapperRef = ref<HTMLDivElement>();
const editorHostRef = ref<HTMLDivElement>();

// Trigger refs (Vue refs, not computed)
const triggerVisible = ref(false);
const triggerPosition = ref({ top: 0, left: 0, bottom: 0 });
const triggerActiveIndex = ref(0);
const triggerQuery = ref('');

// Editor state
const editorIsEmpty = ref(true);
const lastSelection = ref<{ main: { head: number } } | null>(null);

// Editor view reference
const view = ref<EditorView | null>(null);

// Computed variables from options
const allVariables = computed<Variable[]>(() => props.options.flatMap((group) => group.options));

// Filtered variables based on trigger query
const filteredVariables = computed<Variable[]>(() => {
  const query = triggerQuery.value.toLowerCase();
  if (!query) return allVariables.value;
  return allVariables.value.filter(
    (v) => v.label.toLowerCase().includes(query) || v.value.toLowerCase().includes(query)
  );
});

// Resolved max height
const resolvedMaxHeight = computed<string | undefined>(() => {
  if (props.maxHeight === undefined) return undefined;
  if (typeof props.maxHeight === 'number') return `${props.maxHeight}px`;
  return props.maxHeight;
});

// Theme extension with max height
const createThemeExtension = (maxHeight: string | undefined) => {
  return EditorView.theme({
    '&': {
      maxHeight: maxHeight ?? 'none',
      overflow: 'auto'
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'inherit',
      fontSize: '14px',
      lineHeight: '1.6'
    },
    '.cm-content': {
      caretColor: 'var(--color-primary, #4080ff)',
      padding: '0'
    },
    '.cm-line': {
      padding: '0'
    },
    '.cm-placeholder': {
      color: 'var(--text-placeholder)',
      fontStyle: 'normal'
    },
    '.cm-selectionBackground': {
      backgroundColor: 'rgb(var(--color-primary-value, 64, 128, 255), 0.15) !important'
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'rgb(var(--color-primary-value, 64, 128, 255), 0.2) !important'
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--color-primary, #4080ff)'
    }
  });
};

// External update annotation for avoiding circular updates
const externalUpdate = Annotation.define<boolean>();

// Model sync extension
const modelSyncExtension = EditorView.updateListener.of((update) => {
  // Skip if this update was triggered by external value change
  if (update.transactions.some((tr) => tr.annotation(externalUpdate))) {
    return;
  }

  const newValue = update.state.doc.toString();
  if (modelValue.value !== newValue) {
    modelValue.value = newValue;
    emit('change', newValue);
  }

  // Update editorIsEmpty
  editorIsEmpty.value = newValue.trim().length === 0;
});

// Handle variable selection
function handleVariableSelect(variable: Variable): void {
  if (!view.value) return;

  const state = view.value.state;
  const triggerState = state.field(triggerStateField, false);

  if (!triggerState) return;

  const variableText = `{{${variable.value}}}`;
  view.value.dispatch({
    changes: { from: triggerState.from, to: triggerState.to, insert: variableText },
    effects: closeTrigger.of(null)
  });

  view.value.focus();
}

// Handle active index change
function handleActiveIndexChange(index: number): void {
  triggerActiveIndex.value = index;
  if (view.value) {
    view.value.dispatch({
      effects: setTriggerActiveIndex.of(index)
    });
  }
}

// Handle container click
function handleContainerClick(): void {
  if (!props.disabled && view.value) {
    view.value.focus();
  }
}

// Create extensions array
function createExtensions(): import('@codemirror/state').Extension[] {
  const extensions: import('@codemirror/state').Extension[] = [
    // Base extensions
    EditorView.lineWrapping,

    // Model sync
    modelSyncExtension,

    // Variable chip decorations
    variableChipField,

    // Trigger state
    triggerStateField,

    // Trigger plugin (view plugin)
    createTriggerPlugin({
      triggerVisible,
      triggerPosition,
      triggerActiveIndex,
      triggerQuery
    }),

    // Placeholder
    createPlaceholderExtension(props.placeholder),

    // Paste handler
    createPasteHandlerExtension(),

    // Editable compartment
    editableCompartment.of(EditorView.editable.of(!props.disabled)),

    // Read-only compartment
    readOnlyCompartment.of(EditorState.readOnly.of(props.disabled)),

    // Theme compartment
    themeCompartment.of(createThemeExtension(resolvedMaxHeight.value)),

    // Keymap for submit on Enter
    EditorView.keymap.of([
      {
        key: 'Enter',
        run: () => {
          if (props.submitOnEnter) {
            emit('submit');
            return true;
          }
          return false;
        }
      }
    ])
  ];

  return extensions;
}

// Watch for external modelValue changes
watch(
  () => modelValue.value,
  (value) => {
    if (!view.value) return;

    const currentDoc = view.value.state.doc.toString();
    if (currentDoc === value) return;

    view.value.dispatch({
      changes: { from: 0, to: currentDoc.length, insert: value },
      annotations: externalUpdate.of(true)
    });

    editorIsEmpty.value = value.trim().length === 0;
  }
);

// Watch for disabled changes
watch(
  () => props.disabled,
  (disabled) => {
    if (!view.value) return;

    view.value.dispatch({
      effects: [
        editableCompartment.reconfigure(EditorView.editable.of(!disabled)),
        readOnlyCompartment.reconfigure(EditorState.readOnly.of(disabled))
      ]
    });
  }
);

// Watch for maxHeight changes
watch(
  resolvedMaxHeight,
  (maxHeight) => {
    if (!view.value) return;

    view.value.dispatch({
      effects: themeCompartment.reconfigure(createThemeExtension(maxHeight))
    });
  }
);

// onMounted: create EditorView
onMounted(() => {
  if (!editorHostRef.value) return;

  const state = EditorState.create({
    doc: modelValue.value,
    extensions: createExtensions()
  });

  view.value = new EditorView({
    state,
    parent: editorHostRef.value
  });

  editorIsEmpty.value = modelValue.value.trim().length === 0;
});

// onBeforeUnmount: destroy EditorView
onBeforeUnmount(() => {
  view.value?.destroy();
  view.value = null;
});

// Expose methods
defineExpose({
  focus: () => {
    view.value?.focus();
  },
  captureCursorPosition: () => {
    if (view.value) {
      lastSelection.value = view.value.state.selection;
    }
  },
  insertFileReference: (reference: { referenceId: string; documentId: string; fileName: string; line: number | string }) => {
    if (!view.value) return;

    const selection = lastSelection.value ?? view.value.state.selection;
    const pos = selection.main.head;
    const fileRefText = `{{file-ref:${reference.referenceId}}}`;

    view.value.dispatch({
      changes: { from: pos, insert: fileRefText }
    });

    view.value.focus();
  }
});
</script>

<style lang="less">
@import url('@/assets/styles/scrollbar.less');

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

  &:focus-within {
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

.b-prompt-editor__codemirror {
  width: 100%;
  min-height: 80px;

  .cm-editor {
    outline: none;
  }

  .cm-focused {
    outline: none;
  }

  .cm-scroller {
    font-family: inherit;
    font-size: inherit;
    line-height: inherit;
  }

  .cm-content {
    white-space: pre-wrap;
    word-break: break-all;
  }

  .cm-line {
    white-space: pre-wrap;
  }

  .cm-placeholder {
    color: var(--text-placeholder);
    font-style: normal;
  }

  .cm-selectionBackground {
    background-color: rgb(var(--color-primary-value, 64, 128, 255), 0.15) !important;
  }
}

// Variable chip decorations
.b-prompt-chip {
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

.b-prompt-chip--file {
  color: var(--text-primary);
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-primary);
}
</style>
