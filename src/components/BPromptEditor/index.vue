<template>
  <div class="b-prompt-editor" @click="handleContainerClick">
    <div class="b-prompt-editor__container">
      <div ref="editorHostRef" class="b-prompt-editor__codemirror"></div>
      <SlashCommandSelect
        :visible="slashVisible"
        :commands="filteredSlashCommands"
        :position="slashPosition"
        :active-index="slashActiveIndex"
        @select="handleSlashCommandSelect"
        @update:active-index="handleSlashActiveIndexChange"
      />
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
import type { SlashCommandOption, Variable, BPromptEditorProps as Props } from './types';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewline } from '@codemirror/commands';
import { EditorState, Annotation } from '@codemirror/state';
import { EditorView, Decoration, keymap } from '@codemirror/view';
import SlashCommandSelect from './components/SlashCommandSelect.vue';
import VariableSelect from './components/VariableSelect.vue';
import { editableCompartment, readOnlyCompartment, themeCompartment } from './extensions/base';
import { createPasteHandlerExtension } from './extensions/pasteHandler';
import { createPlaceholderExtension } from './extensions/placeholder';
import { createTriggerPlugin } from './extensions/triggerPlugin';
import { triggerStateField, setTriggerActiveIndex, closeTrigger } from './extensions/triggerState';
import { variableChipField, chipResolverEffect, getChipAtPos } from './extensions/variableChip';

const props = withDefaults(defineProps<Props>(), {
  placeholder: '请输入内容...',
  options: () => [],
  slashCommands: () => [],
  disabled: false,
  maxHeight: undefined,
  submitOnEnter: false,
  chipResolver: undefined,
  onPasteFiles: undefined
});

const emit = defineEmits<{
  (e: 'change', value: string): void;
  (e: 'submit'): void;
  (e: 'slash-command', command: SlashCommandOption): void;
}>();

const modelValue = defineModel<string>('value', { default: '' });

// Template refs
const editorHostRef = ref<HTMLDivElement>();

// Trigger refs (Vue refs, not computed)
const triggerVisible = ref(false);
const triggerPosition = ref({ top: 0, left: 0, bottom: 0 });
const triggerActiveIndex = ref(0);
const triggerQuery = ref('');

// Slash command refs
const slashVisible = ref(false);
const slashPosition = ref({ top: 0, left: 0, bottom: 0 });
const slashActiveIndex = ref(0);
const slashQuery = ref('');
const slashRange = ref<{ from: number; to: number } | null>(null);

// Editor state
const lastSelection = ref<{ main: { head: number } } | null>(null);

// Editor view reference
const view = ref<EditorView | null>(null);

// Computed variables from options
const allVariables = computed<Variable[]>(() => props.options.flatMap((group) => group.options));

// Computed slash command list
const allSlashCommands = computed<readonly SlashCommandOption[]>(() => props.slashCommands ?? []);

// Filtered slash commands based on trigger prefix
const filteredSlashCommands = computed<readonly SlashCommandOption[]>(() => {
  const query = slashQuery.value.toLowerCase();
  if (!query) return allSlashCommands.value;
  return allSlashCommands.value.filter((command) => command.trigger.toLowerCase().startsWith(`/${query}`));
});

// Filtered variables based on trigger query
const filteredVariables = computed<Variable[]>(() => {
  const query = triggerQuery.value.toLowerCase();
  if (!query) return allVariables.value;
  return allVariables.value.filter((v) => v.label.toLowerCase().includes(query) || v.value.toLowerCase().includes(query));
});

// Whether there are variables available for triggering
const hasVariables = computed<boolean>(() => allVariables.value.length > 0);

// Resolved max height
const resolvedMaxHeight = computed<string | undefined>(() => {
  if (props.maxHeight === undefined) return undefined;
  if (typeof props.maxHeight === 'number') return `${props.maxHeight}px`;
  return props.maxHeight;
});

/**
 * 判断编辑器内容在去除空白后是否为空。
 * @param content - 编辑器原始文本内容。
 * @returns 内容是否为空。
 */
function isEditorContentEmpty(content: string): boolean {
  return content.trim().length === 0;
}

// 当前编辑器内容是否为空
const editorIsEmpty = ref<boolean>(isEditorContentEmpty(modelValue.value));

/**
 * 创建编辑器主题扩展。
 * @param maxHeight - 编辑器滚动区域的最大高度。
 * @param isEmpty - 当前编辑器内容是否为空。
 * @returns CodeMirror 主题扩展。
 */
const createThemeExtension = (maxHeight: string | undefined, isEmpty: boolean): import('@codemirror/state').Extension => {
  return EditorView.theme({
    '.cm-scroller': {
      maxHeight: maxHeight ?? 'none',
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
      borderLeft: '1.2px solid var(--color-primary, #4080ff)',
      marginLeft: '-0.6px',
      pointerEvents: 'none',
      position: 'relative',
      height: '1em'
    },
    // 修复 normalize.css 全局 div { border: none } 导致的 widgetBuffer 零宽问题
    '.cm-widgetBuffer': {
      display: 'inline-block',
      width: isEmpty ? '1px' : '0'
    }
  });
};

/**
 * 判断斜杠命令是否匹配当前输入前缀。
 * @param command - 斜杠命令
 * @param query - 当前斜杠查询内容
 * @returns 是否匹配
 */
function isSlashCommandMatch(command: SlashCommandOption, query: string): boolean {
  return command.trigger.toLowerCase().startsWith(`/${query.toLowerCase()}`);
}

/**
 * 获取当前光标所在的斜杠命令上下文。
 * @param state - 编辑器状态
 * @returns 斜杠上下文，不匹配时返回 null
 */
function getSlashCommandContext(state: EditorState): { from: number; to: number; query: string } | null {
  if (allSlashCommands.value.length === 0) {
    return null;
  }

  const selection = state.selection.main;
  if (!selection.empty) {
    return null;
  }

  const pos = selection.head;
  const line = state.doc.lineAt(pos);
  const text = state.sliceDoc(line.from, pos);

  if (!text.startsWith('/')) {
    return null;
  }

  const query = text.slice(1);
  const matches = allSlashCommands.value.filter((command) => isSlashCommandMatch(command, query));

  if (matches.length === 0) {
    return null;
  }

  return {
    from: line.from,
    to: pos,
    query
  };
}

/**
 * 隐藏斜杠菜单并清理活跃范围。
 */
function closeSlashCommandMenu(): void {
  slashVisible.value = false;
  slashQuery.value = '';
  slashRange.value = null;
}

/**
 * 同步斜杠菜单状态。
 * @param state - 编辑器状态
 * @param editorView - 编辑器视图
 */
function syncSlashCommandState(state: EditorState, editorView: EditorView): void {
  const context = getSlashCommandContext(state);
  if (!context) {
    closeSlashCommandMenu();
    return;
  }

  slashVisible.value = true;
  slashQuery.value = context.query;
  slashRange.value = { from: context.from, to: context.to };
  slashActiveIndex.value = 0;

  requestAnimationFrame(() => {
    let coords: { top: number; left: number; bottom: number } | null = null;
    try {
      coords = editorView.coordsAtPos(context.to);
    } catch {
      coords = null;
    }

    if (!coords) {
      slashPosition.value = { top: 0, left: 0, bottom: 0 };
      return;
    }

    const { scrollDOM } = editorView;
    slashPosition.value = {
      top: coords.top + scrollDOM.scrollTop,
      left: coords.left,
      bottom: coords.bottom + scrollDOM.scrollTop
    };
  });
}

// External update annotation for avoiding circular updates
const externalUpdate = Annotation.define<boolean>();

// Model sync extension
const modelSyncExtension = EditorView.updateListener.of((update) => {
  const newValue = update.state.doc.toString();
  editorIsEmpty.value = isEditorContentEmpty(newValue);
  const isExternalValueChange = update.transactions.some((tr) => tr.annotation(externalUpdate));

  syncSlashCommandState(update.state, update.view);

  // Skip if this update was triggered by external value change
  if (isExternalValueChange) {
    return;
  }

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

/**
 * 处理斜杠命令高亮索引变化。
 * @param index - 新的斜杠命令高亮索引
 */
function handleSlashActiveIndexChange(index: number): void {
  slashActiveIndex.value = index;
}

/**
 * 应用斜杠命令并清除当前活动斜杠输入。
 * @param command - 被选择的斜杠命令
 */
function handleSlashCommandSelect(command: SlashCommandOption): void {
  if (!view.value || !slashRange.value) return;

  const { from, to } = slashRange.value;
  view.value.dispatch({
    changes: { from, to, insert: '' },
    selection: { anchor: from }
  });

  emit('slash-command', command);
  closeSlashCommandMenu();
  view.value.focus();
}

/**
 * 选择当前高亮的斜杠命令。
 * @returns 是否已处理
 */
function handleSlashCommandEnter(): boolean {
  const command = filteredSlashCommands.value[slashActiveIndex.value];
  if (!command) {
    return false;
  }

  handleSlashCommandSelect(command);
  return true;
}

/**
 * 处理斜杠菜单向上移动。
 * @returns 是否已处理
 */
function handleSlashCommandArrowUp(): boolean {
  const list = filteredSlashCommands.value;
  if (!slashVisible.value) return false;
  if (list.length === 0) return true;

  const newIndex = (slashActiveIndex.value - 1 + list.length) % list.length;
  handleSlashActiveIndexChange(newIndex);
  return true;
}

/**
 * 处理斜杠菜单向下移动。
 * @returns 是否已处理
 */
function handleSlashCommandArrowDown(): boolean {
  const list = filteredSlashCommands.value;
  if (!slashVisible.value) return false;
  if (list.length === 0) return true;

  const newIndex = (slashActiveIndex.value + 1) % list.length;
  handleSlashActiveIndexChange(newIndex);
  return true;
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
      triggerQuery,
      hasVariables
    }),

    // Placeholder
    createPlaceholderExtension(props.placeholder),

    // Paste handler
    createPasteHandlerExtension(props.onPasteFiles),

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
    EditorView.atomicRanges.of((editorView) => {
      const chipState = editorView.state.field(variableChipField, false);
      return chipState?.decorations ?? Decoration.none;
    }),

    // Editable compartment
    editableCompartment.of(EditorView.editable.of(!props.disabled)),

    // Read-only compartment
    readOnlyCompartment.of(EditorState.readOnly.of(props.disabled)),

    // Theme compartment
    themeCompartment.of(createThemeExtension(resolvedMaxHeight.value, editorIsEmpty.value)),

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
          if (slashVisible.value) {
            return handleSlashCommandArrowUp();
          }
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
          if (slashVisible.value) {
            return handleSlashCommandArrowDown();
          }
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
          if (slashVisible.value) {
            closeSlashCommandMenu();
            return true;
          }
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
          if (slashVisible.value && filteredSlashCommands.value.length > 0) {
            return handleSlashCommandEnter();
          }
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
    effects: themeCompartment.reconfigure(createThemeExtension(maxHeight, editorIsEmpty.value))
  });
});

// Watch for content empty state changes
watch(editorIsEmpty, (isEmpty) => {
  if (!view.value) return;

  view.value.dispatch({
    effects: themeCompartment.reconfigure(createThemeExtension(resolvedMaxHeight.value, isEmpty))
  });
});

// Watch for chipResolver changes
watch(
  () => props.chipResolver,
  (resolver) => {
    if (!view.value || !resolver) return;
    view.value.dispatch({
      effects: chipResolverEffect.of(resolver)
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

  syncSlashCommandState(view.value.state, view.value);

  // 注入初始 chipResolver（watch 为 lazy 模式，首次不触发，需手动分派）
  if (props.chipResolver) {
    view.value.dispatch({
      effects: chipResolverEffect.of(props.chipResolver)
    });
  }

  // 首次创建后强制重新测量视口，确保空内容时光标层正确初始化
  nextTick(() => {
    view.value?.requestMeasure();
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
  /**
   * 保存当前光标位置（用于跨组件延迟插入场景）。
   * 多次调用只保留最后一次。
   */
  saveCursorPosition: () => {
    if (view.value) {
      lastSelection.value = view.value.state.selection;
    }
  },
  /**
   * 在保存的光标位置或当前位置插入文本。
   * 插入后清除保存的位置，光标移到插入内容末尾。
   */
  insertTextAtCursor: (text: string) => {
    if (!view.value) return;

    const selection = lastSelection.value ?? view.value.state.selection;
    const pos = selection.main.head;
    const insertEnd = pos + text.length;

    view.value.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: insertEnd }
    });

    // 清除保存的位置
    lastSelection.value = null;

    view.value.focus();
  },
  /**
   * 获取编辑器原始内容（含 {{...}} token 的文本）。
   */
  getText: () => {
    return view.value?.state.doc.toString() ?? '';
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

  .cm-content {
    word-break: break-all;
    white-space: pre-wrap;
  }

  .cm-line {
    white-space: pre-wrap;
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
