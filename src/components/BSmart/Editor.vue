<template>
  <div ref="editorRootRef" :class="bem('shell')" @focusout="handleEditorShellFocusOut">
    <SlashCommandSelect
      :visible="slashCommand.slashVisible.value"
      :commands="slashCommand.filteredSlashCommands.value"
      :active-index="slashCommand.slashActiveIndex.value"
      :scroll-active-into-view="slashCommand.slashShouldScrollActive.value"
      @select="slashCommand.handleSlashCommandSelect"
      @update:active-index="slashCommand.handleSlashActiveIndexChange"
    />
    <FileMentionSelect
      :visible="fileMention.mentionVisible.value"
      :files="fileMention.filteredFileMentions.value"
      :active-index="fileMention.mentionActiveIndex.value"
      :scroll-active-into-view="fileMention.mentionShouldScrollActive.value"
      @select="fileMention.handleFileMentionSelect"
      @update:active-index="fileMention.handleMentionActiveIndexChange"
    />
    <div :class="name" @click="handleContainerClick">
      <div :class="bem('container')">
        <BScrollbar :class="bem('scrollbar')" :max-height="resolvedMaxHeight">
          <div ref="editorHostRef" :class="bem('codemirror')"></div>
        </BScrollbar>
        <VariableSelect
          :visible="triggerVisible"
          :variables="filteredVariables"
          :position="triggerPosition"
          :active-index="triggerActiveIndex"
          @select="handleVariableSelect"
          @toggle="handleVariableToggle"
          @update:active-index="handleActiveIndexChange"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * @file BSmart/Editor.vue
 * @description Prompt 编辑器主组件，基于 CodeMirror 6 实现
 */
import type { ChipResolver } from './extensions/variableChip';
import type { SlashCommandOption, Variable, FileMentionOption, BSmartEditorExpose, BSmartEditorProps as Props } from './types';
import type { FlatVariable, VisibleVariable } from './utils/variables';
import type { Extension } from '@codemirror/state';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { history } from '@codemirror/commands';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createNamespace } from '@/utils/namespace';
import FileMentionSelect from './components/FileMentionSelect.vue';
import SlashCommandSelect from './components/SlashCommandSelect.vue';
import VariableSelect from './components/VariableSelect.vue';
import { editableCompartment, readOnlyCompartment, themeCompartment } from './extensions/base';
import { createPasteHandlerExtension } from './extensions/pasteHandler';
import { createPlaceholderExtension } from './extensions/placeholder';
import { createTriggerPlugin } from './extensions/triggerPlugin';
import { closeTrigger, setTriggerActiveIndex, triggerStateField } from './extensions/triggerState';
import { variableChipField, chipResolverEffect, getChipAtPos, getChipAtomicDecorations } from './extensions/variableChip';
import { useEditorKeymap } from './hooks/useEditorKeymap';
import { useFileMention } from './hooks/useFileMention';
import { useSlashCommand } from './hooks/useSlashCommand';
import { flattenVariables, getVisibleVariables } from './utils/variables';

const props = withDefaults(defineProps<Props>(), {
  placeholder: '请输入内容...',
  options: () => [],
  slashCommands: () => [],
  fileMentions: () => [],
  disabled: false,
  maxHeight: undefined,
  submitOnEnter: false,
  chipResolver: undefined,
  onPasteFiles: undefined,
  onPasteImages: undefined,
  canAcceptImages: undefined,
  onCancel: undefined
});

const emit = defineEmits<{
  (e: 'change', value: string): void;
  (e: 'submit'): void;
  (e: 'slash-command', command: SlashCommandOption): void;
  (e: 'file-mention-select', file: FileMentionOption): void;
}>();

const modelValue = defineModel<string>('value', { default: '' });
const [name, bem] = createNamespace('smart-editor');

// 模板 ref
const editorRootRef = ref<HTMLDivElement>();
const editorHostRef = ref<HTMLDivElement>();

// 触发器状态（变量选择相关）
const triggerVisible = ref(false);
const triggerPosition = ref({ top: 0, left: 0, bottom: 0 });
const triggerActiveIndex = ref(0);
const triggerQuery = ref('');

// 编辑器状态
const lastSelection = ref<{ main: { head: number } } | null>(null);

// 从 options 读取变量树，供菜单展示和 Chip 解析共用
const variableTrees = computed<Variable[]>(() => props.options.flatMap((group) => group.options));

// 从 options 计算得到的扁平变量列表，保留树深度用于下拉菜单缩进
const allVariables = computed<FlatVariable[]>(() => flattenVariables(variableTrees.value));

// 用户手动折叠的变量节点值集合
const collapsedVariableValues = ref<Set<string>>(new Set());

// 根据触发查询和折叠状态计算当前可见变量
const filteredVariables = computed<VisibleVariable[]>(() => getVisibleVariables(variableTrees.value, collapsedVariableValues.value, triggerQuery.value));

// 是否有可用于触发的变量
const hasVariables = computed<boolean>(() => allVariables.value.length > 0);

/**
 * 默认仅给变量 token 添加可编辑高亮，不替换成 Chip。
 * @returns 默认变量高亮装饰
 */
const defaultVariableTokenResolver: ChipResolver = () => ({ className: 'b-prompt-variable-token' });

// 调用方可显式传入 chipResolver 覆盖默认变量高亮。
const resolvedChipResolver = computed<ChipResolver>(() => props.chipResolver ?? defaultVariableTokenResolver);

// 解析后的最大高度
const resolvedMaxHeight = computed<string | undefined>(() => {
  if (props.maxHeight === undefined) return undefined;
  if (typeof props.maxHeight === 'number') return `${props.maxHeight}px`;
  return props.maxHeight;
});

/**
 * 判断编辑器内容在去除空白后是否为空
 */
function isEditorContentEmpty(content: string): boolean {
  return content.trim().length === 0;
}

// 编辑器当前是否包含可见内容
const editorIsEmpty = ref<boolean>(isEditorContentEmpty(modelValue.value));
// 斜杠命令列表
const allSlashCommands = computed<readonly SlashCommandOption[]>(() => props.slashCommands ?? []);
// 文件提及列表
const allFileMentions = computed<readonly FileMentionOption[]>(() => props.fileMentions ?? []);
// 外部更新标记
const externalUpdate = Annotation.define<boolean>();
// 编辑器视图引用
const instance = shallowRef<EditorView | null>(null);
// 使用斜杠命令 hook
const slashCommand = useSlashCommand(instance, allSlashCommands, (event, command) => emit(event, command));
// 使用文件提及 hook
const fileMention = useFileMention(instance, allFileMentions, (event, file) => emit(event, file));

/**
 * 将选中的变量插入到活动触发范围
 */
function handleVariableSelect(variable: Variable): void {
  if (!instance.value) return;

  const { state } = instance.value;
  const triggerState = state.field(triggerStateField, false);

  if (!triggerState) return;

  const variableText = `{{${variable.value}}} `;
  instance.value.dispatch({
    changes: { from: triggerState.from, to: triggerState.to, insert: variableText },
    effects: closeTrigger.of()
  });

  instance.value.focus();
}

/**
 * 更新高亮变量的索引
 */
function handleActiveIndexChange(index: number): void {
  if (!instance.value) return;

  triggerActiveIndex.value = index;
  instance.value.dispatch({
    effects: setTriggerActiveIndex.of(index)
  });
}

/**
 * 切换变量树节点的展开状态。
 * @param variable - 被切换的变量节点
 */
function handleVariableToggle(variable: Variable): void {
  const nextValues = new Set(collapsedVariableValues.value);

  if (nextValues.has(variable.value)) {
    nextValues.delete(variable.value);
  } else {
    nextValues.add(variable.value);
  }

  collapsedVariableValues.value = nextValues;
}

watch(filteredVariables, (variables: VisibleVariable[]): void => {
  if (triggerActiveIndex.value < variables.length) return;

  triggerActiveIndex.value = Math.max(0, variables.length - 1);
});

// 键盘快捷键扩展
const keymapExtension = useEditorKeymap({
  view: instance,
  slashCommand,
  fileMention,
  variableTrigger: {
    triggerVisible,
    triggerActiveIndex,
    filteredVariables
  },
  handleVariableSelect,
  submitOnEnter: props.submitOnEnter,
  onSubmit: () => emit('submit'),
  onCancel: props.onCancel
});

/**
 * 创建 CodeMirror 主题扩展
 * @param isEmpty - 编辑器内容是否为空
 * @returns CodeMirror 主题扩展
 */
function createThemeExtension(isEmpty: boolean): Extension {
  return EditorView.theme({
    '.cm-scroller': {
      overflow: 'visible',
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
      backgroundColor: 'color-mix(in srgb, var(--color-primary, #4080ff) 15%, transparent) !important'
    },
    '&.cm-focused .cm-selectionBackground': {
      backgroundColor: 'color-mix(in srgb, var(--color-primary, #4080ff) 20%, transparent) !important'
    },
    '.cm-cursor': {
      borderLeft: '1.2px solid var(--color-primary, #4080ff)',
      marginLeft: '-0.6px',
      pointerEvents: 'none',
      position: 'relative',
      height: '1em'
    },
    '.cm-widgetBuffer': {
      display: 'inline-block',
      width: isEmpty ? '1px' : '0'
    },
    '.b-prompt-variable-token': {
      color: 'var(--color-primary, #4080ff)'
    }
  });
}

/**
 * 构建 CodeMirror 扩展列表
 */
function createExtensions(): Extension[] {
  const modelSyncExtension = EditorView.updateListener.of((update) => {
    const newValue = update.state.doc.toString();
    editorIsEmpty.value = isEditorContentEmpty(newValue);
    const isExternalValueChange = update.transactions.some((tr) => tr.annotation(externalUpdate));

    slashCommand.syncSlashCommandState(update.state, update.view);
    fileMention.syncMentionState(update.state, update.view);

    if (isExternalValueChange) {
      return;
    }

    if (modelValue.value !== newValue) {
      modelValue.value = newValue;
      emit('change', newValue);
    }
  });

  const extensions: Extension[] = [
    EditorView.lineWrapping,
    history(),
    modelSyncExtension,
    variableChipField,
    triggerStateField,
    createTriggerPlugin({
      triggerVisible,
      triggerPosition,
      triggerActiveIndex,
      triggerQuery,
      hasVariables
    }),
    createPlaceholderExtension(props.placeholder),
    createPasteHandlerExtension(props.onPasteFiles, props.onPasteImages, props.canAcceptImages),
    EditorView.domEventHandlers({
      focus: () => {
        return false;
      },
      blur: (_event, editorView) => {
        if (slashCommand.slashVisible.value) {
          slashCommand.closeSlashCommandMenu(true);
        }
        if (fileMention.mentionVisible.value) {
          fileMention.closeMentionMenu(true);
        }
        if (triggerVisible.value) {
          editorView.dispatch({ effects: closeTrigger.of() });
        }
        return false;
      }
    }),
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
    EditorView.atomicRanges.of((editorView) => getChipAtomicDecorations(editorView.state)),
    editableCompartment.of(EditorView.editable.of(!props.disabled)),
    readOnlyCompartment.of(EditorState.readOnly.of(props.disabled)),
    themeCompartment.of(createThemeExtension(editorIsEmpty.value)),
    keymapExtension
  ];

  return extensions;
}

/**
 * 将当前 Chip 解析器同步到 CodeMirror 状态字段。
 */
function syncChipResolver(): void {
  if (!instance.value) return;

  instance.value.dispatch({
    effects: chipResolverEffect.of(resolvedChipResolver.value)
  });
}

/**
 * 初始化编辑器
 */
function setupEditor(): void {
  if (!editorHostRef.value) return;

  const state = EditorState.create({
    doc: modelValue.value,
    extensions: createExtensions()
  });

  instance.value = new EditorView({ state, parent: editorHostRef.value });

  slashCommand.syncSlashCommandState(instance.value.state as EditorState, instance.value as EditorView);
  fileMention.syncMentionState(instance.value.state as EditorState, instance.value as EditorView);

  syncChipResolver();

  nextTick(() => {
    instance.value?.requestMeasure();
  });
}

/**
 * 销毁编辑器
 */
function destroyEditor(): void {
  instance.value?.destroy();
  instance.value = null;
}

/**
 * 点击编辑器外壳时聚焦编辑器
 */
function handleContainerClick(): void {
  if (!props.disabled && instance.value) {
    instance.value.focus();
  }
}

/**
 * 处理编辑器外壳外部的文档点击事件
 */
function handleDocumentMouseDown(event: MouseEvent): void {
  const root = editorRootRef.value;
  const { target } = event;

  if (!root || !(target instanceof Node) || root.contains(target)) {
    return;
  }

  if (slashCommand.slashVisible.value) {
    slashCommand.closeSlashCommandMenu(true);
  }
  if (fileMention.mentionVisible.value) {
    fileMention.closeMentionMenu(true);
  }
}

/**
 * 焦点离开编辑器外壳时关闭菜单
 */
function handleEditorShellFocusOut(event: FocusEvent): void {
  const root = editorRootRef.value;
  const { relatedTarget } = event;

  if (!root) {
    return;
  }

  if (relatedTarget instanceof Node && root.contains(relatedTarget)) {
    return;
  }

  if (slashCommand.slashVisible.value) {
    slashCommand.closeSlashCommandMenu(true);
  }
  if (fileMention.mentionVisible.value) {
    fileMention.closeMentionMenu(true);
  }
}

// 监听 modelValue 变化
watch(modelValue, (value) => {
  if (!instance.value) return;

  const currentDoc = instance.value.state.doc.toString();
  if (currentDoc === value) return;

  instance.value.dispatch({
    changes: { from: 0, to: currentDoc.length, insert: value },
    annotations: externalUpdate.of(true)
  });
});

// 监听 disabled 变化
watch(
  () => props.disabled,
  (isDisabled) => {
    if (!instance.value) return;

    instance.value.dispatch({
      effects: [editableCompartment.reconfigure(EditorView.editable.of(!isDisabled)), readOnlyCompartment.reconfigure(EditorState.readOnly.of(isDisabled))]
    });
  }
);

// 监听 editorIsEmpty 变化
watch(editorIsEmpty, (isEmpty) => {
  if (!instance.value) return;

  instance.value.dispatch({
    effects: themeCompartment.reconfigure(createThemeExtension(isEmpty))
  });
});

// 监听 Chip 解析器变化
watch(resolvedChipResolver, () => {
  syncChipResolver();
});

// Skill Store 等外部候选变化时，以当前光标与文档重新计算菜单可见性。
watch(allSlashCommands, (): void => {
  if (!instance.value) return;
  slashCommand.syncSlashCommandState(instance.value.state, instance.value);
});

onMounted(() => {
  setupEditor();
  document.addEventListener('mousedown', handleDocumentMouseDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown);
  destroyEditor();
});

defineExpose<BSmartEditorExpose>({
  focus: (options?: { moveToEnd?: boolean }): void => {
    if (!instance.value) return;
    instance.value.focus();
    if (options?.moveToEnd) {
      const end = instance.value.state.doc.length;
      instance.value.dispatch({ selection: { anchor: end } });
    }
  },
  getCursorPosition: (): number => {
    if (!instance.value) {
      return 0;
    }

    const selection = lastSelection.value ?? instance.value.state.selection;
    return selection.main.head;
  },
  saveCursorPosition: (): void => {
    if (instance.value) {
      lastSelection.value = instance.value.state.selection;
    }
  },
  insertTextAtCursor: (text: string): void => {
    if (!instance.value) return;

    instance.value.focus();
    const selection = lastSelection.value ?? instance.value.state.selection;
    const pos = selection.main.head;
    const insertEnd = pos + text.length;

    instance.value.dispatch({
      changes: { from: pos, insert: text },
      selection: { anchor: insertEnd }
    });

    lastSelection.value = null;
  },
  replaceTextRange: (from: number, to: number, text: string): void => {
    if (!instance.value) return;

    instance.value.focus();
    const insertEnd = from + text.length;
    instance.value.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: insertEnd }
    });
  },
  getText: (): string => {
    return instance.value?.state.doc.toString() ?? '';
  }
});
</script>

<style lang="less">
@import url('@/assets/styles/scrollbar.less');

.b-smart-editor__shell {
  position: relative;
  width: 100%;
}

.b-smart-editor {
  width: 100%;
  min-height: 80px;
  padding: var(--input-padding-block) var(--input-padding-inline);
  overflow-y: auto;
  font-family: var(--input-font-family);
  font-size: 14px;
  line-height: 1.6;
  word-break: break-all;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  outline: none;
  border: var(--input-border-width) solid var(--input-border);
  border-radius: var(--input-radius);
  transition: border-color var(--motion-duration-base) var(--motion-easing-standard), box-shadow var(--motion-duration-base) var(--motion-easing-standard);

  &:hover {
    border-color: var(--border-hover);
  }

  &:focus-within {
    border-color: var(--input-focus-border);
    box-shadow: var(--input-active-shadow);
  }

  .scrollbar-style();
}

.b-smart-editor__container {
  position: relative;
  width: 100%;
  height: 100%;
}

.b-smart-editor__scrollbar {
  min-height: 80px;
}

.b-smart-editor__codemirror {
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

  .cm-placeholder {
    color: var(--input-placeholder-color);
  }
}
</style>
