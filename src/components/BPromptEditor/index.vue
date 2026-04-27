<template>
  <div class="b-prompt-editor" @click="handleContainerClick">
    <div class="b-prompt-editor__container">
      <div ref="editorHostRef" class="b-prompt-editor__codemirror"></div>
      <VariableSelect
        :visible="triggerVisible"
        :variables="filteredVariables"
        :position="triggerPosition"
        :active-index="triggerActiveIndex"
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
import type { Variable, BPromptEditorProps as Props } from './types';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewline } from '@codemirror/commands';
import { EditorState, Annotation } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import VariableSelect from './components/VariableSelect.vue';
import { editableCompartment, readOnlyCompartment, themeCompartment } from './extensions/base';
import { createPasteHandlerExtension } from './extensions/pasteHandler';
import { createPlaceholderExtension } from './extensions/placeholder';
import { createTriggerPlugin } from './extensions/triggerPlugin';
import { triggerStateField, setTriggerActiveIndex, closeTrigger } from './extensions/triggerState';
import { variableChipField, getChipAtPos } from './extensions/variableChip';

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
const editorHostRef = ref<HTMLDivElement>();

// Trigger refs (Vue refs, not computed)
const triggerVisible = ref(false);
const triggerPosition = ref({ top: 0, left: 0, bottom: 0 });
const triggerActiveIndex = ref(0);
const triggerQuery = ref('');

// Editor state
const lastSelection = ref<{ main: { head: number } } | null>(null);

// Editor view reference
const view = ref<EditorView | null>(null);

// Computed variables from options
const allVariables = computed<Variable[]>(() => props.options.flatMap((group) => group.options));

// Filtered variables based on trigger query
const filteredVariables = computed<Variable[]>(() => {
  const query = triggerQuery.value.toLowerCase();
  if (!query) return allVariables.value;
  return allVariables.value.filter((v) => v.label.toLowerCase().includes(query) || v.value.toLowerCase().includes(query));
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
});

// Handle variable selection
function handleVariableSelect(variable: Variable): void {
  if (!view.value) return;

  const { state } = view.value;
  const triggerState = state.field(triggerStateField, false);

  if (!triggerState) return;

  const variableText = `{{${variable.value}}} `;
  view.value.dispatch({
    changes: { from: triggerState.from, to: triggerState.to, insert: variableText },
    effects: closeTrigger.of()
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

    // 历史记录（撤销/重做）
    history(),

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

    // 失焦时隐藏变量菜单
    EditorView.domEventHandlers({
      blur: (_event, editorView) => {
        if (triggerVisible.value) {
          editorView.dispatch({ effects: closeTrigger.of() });
        }
        return false;
      }
    }),

    // 点击 Chip 内部时自动跳转到最近的边界
    EditorView.domEventHandlers({
      mousedown: (event, editorView) => {
        if (!(event instanceof MouseEvent)) return false;
        const pos = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos == null) return false;
        const chip = getChipAtPos(editorView.state, pos);
        if (!chip) return false;
        event.preventDefault();
        const anchor = pos - chip.from < chip.to - pos ? chip.from : chip.to;
        editorView.dispatch({
          selection: { anchor },
          scrollIntoView: true
        });
        return true;
      }
    }),

    // 变量 Chip 设为原子范围（光标不可进入，删除时整词删除）
    EditorView.atomicRanges.of((editorView) => editorView.state.field(variableChipField)),

    // Editable compartment
    editableCompartment.of(EditorView.editable.of(!props.disabled)),

    // Read-only compartment
    readOnlyCompartment.of(EditorState.readOnly.of(props.disabled)),

    // Theme compartment
    themeCompartment.of(createThemeExtension(resolvedMaxHeight.value)),

    // 变量菜单键盘导航 + Chip 删除 + Enter 提交 + Shift-Enter 换行 + Tab 缩进
    keymap.of([
      indentWithTab,
      // 单步 Backspace 删除整词 Chip
      {
        key: 'Backspace',
        run: (editorView) => {
          const sel = editorView.state.selection.main;
          if (!sel.empty) return false;
          if (sel.head > 0) {
            const chip = getChipAtPos(editorView.state, sel.head - 1);
            if (chip) {
              editorView.dispatch({
                changes: { from: chip.from, to: chip.to }
              });
              return true;
            }
          }
          return false;
        }
      },
      // 单步 Delete 删除整词 Chip
      {
        key: 'Delete',
        run: (editorView) => {
          const sel = editorView.state.selection.main;
          if (!sel.empty) return false;
          const chip = getChipAtPos(editorView.state, sel.head);
          if (chip) {
            editorView.dispatch({
              changes: { from: chip.from, to: chip.to }
            });
            return true;
          }
          return false;
        }
      },
      {
        key: 'ArrowUp',
        run: () => {
          if (!triggerVisible.value) return false;
          const list = filteredVariables.value;
          if (list.length === 0) return true;
          const newIdx = (triggerActiveIndex.value - 1 + list.length) % list.length;
          handleActiveIndexChange(newIdx);
          return true;
        }
      },
      {
        key: 'ArrowDown',
        run: () => {
          if (!triggerVisible.value) return false;
          const list = filteredVariables.value;
          if (list.length === 0) return true;
          const newIdx = (triggerActiveIndex.value + 1) % list.length;
          handleActiveIndexChange(newIdx);
          return true;
        }
      },
      {
        key: 'Escape',
        run: (editorView) => {
          if (triggerVisible.value) {
            editorView.dispatch({ effects: closeTrigger.of() });
            return true;
          }
          return false;
        }
      },
      {
        key: 'Shift-Enter',
        run: insertNewline
      },
      {
        key: 'Enter',
        run: () => {
          if (triggerVisible.value && filteredVariables.value.length > 0) {
            const variable = filteredVariables.value[triggerActiveIndex.value];
            if (variable) {
              handleVariableSelect(variable);
              return true;
            }
          }
          if (props.submitOnEnter) {
            emit('submit');
            return true;
          }
          return false;
        }
      }
    ]),

    // 默认键映射（Ctrl+Z/Ctrl+Y/Ctrl+A 等标准快捷键）
    keymap.of([...defaultKeymap, ...historyKeymap])
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
  }
);

// Watch for disabled changes
watch(
  () => props.disabled,
  (disabled) => {
    if (!view.value) return;

    view.value.dispatch({
      effects: [editableCompartment.reconfigure(EditorView.editable.of(!disabled)), readOnlyCompartment.reconfigure(EditorState.readOnly.of(disabled))]
    });
  }
);

// Watch for maxHeight changes
watch(resolvedMaxHeight, (maxHeight) => {
  if (!view.value) return;

  view.value.dispatch({
    effects: themeCompartment.reconfigure(createThemeExtension(maxHeight))
  });
});

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
    const fileRefText = `{{file-ref:${reference.referenceId}}} `;

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
    word-break: break-all;
    white-space: pre-wrap;
  }

  .cm-line {
    white-space: pre-wrap;
  }

  .cm-placeholder {
    font-style: normal;
    color: var(--text-placeholder);
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
