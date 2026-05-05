<template>
  <BubbleMenu
    v-if="editor"
    :editor="editor"
    :plugin-key="SELECTION_TOOLBAR_PLUGIN_KEY"
    :should-show="shouldShow"
    :options="bubbleMenuOptions"
    class="bubble-menu-wrapper"
  >
    <SelectionToolbar :format-buttons="resolvedFormatButtons" @ai="$emit('ai')" @reference="$emit('reference')" @format="handleFormat" />
  </BubbleMenu>
</template>

<script setup lang="ts">
/**
 * @file SelectionToolbarRich.vue
 * @description Rich 模式选区工具栏宿主，使用 BubbleMenu 进行定位与显隐管理。
 */
import type { SelectionToolbarAction } from '../adapters/selectionAssistant';
import type { EditorState } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/vue-3';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { PluginKey } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import SelectionToolbar from './SelectionToolbar.vue';

/**
 * 格式按钮定义（从 host 外部注入，含当前编辑器激活态）。
 */
interface FormatButton {
  command: SelectionToolbarAction;
  icon: string;
  active?: boolean;
}

interface Props {
  /** Tiptap Editor 实例 */
  editor: Editor;
  /** 是否允许工具栏显示 */
  visible?: boolean;
  /** 需要展示的格式按钮列表 */
  formatButtons?: FormatButton[];
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  formatButtons: () => []
});

const emit = defineEmits<{
  (e: 'ai'): void;
  (e: 'reference'): void;
  (e: 'format', command: SelectionToolbarAction): void;
}>();

/**
 * 与 BubbleMenu 共享的 PluginKey，用于 blur 恢复等 meta 控制。
 */
const SELECTION_TOOLBAR_PLUGIN_KEY = new PluginKey('bubbleMenu');

/** 主动隐藏标志，防止 blur handler 错误恢复工具栏 */
const suppressRestore = ref(false);

/**
 * 覆盖 BubbleMenu 内置显示判定：
 * - 去掉 hasEditorFocus 检查（支持失焦后仍显示）
 * - 选区为空或选中区域无文本时隐藏
 */
const shouldShow = computed(() => ({ state }: { state: EditorState }): boolean => {
  if (!props.visible) {
    return false;
  }
  const { from, to } = state.selection;
  if (from === to || !state.doc.textBetween(from, to, '') || !props.editor?.isEditable) {
    return false;
  }
  return true;
});

const bubbleMenuOptions = computed(() => ({
  placement: 'top-start' as const,
  onShow: () => {
    // 工具栏显示时重置主动隐藏标志
    suppressRestore.value = false;
  },
  onHide: () => {
    // onHide 由 BubbleMenu 内置管理，不在此处操作编排状态
  }
}));

/** 合并格式按钮的 active 态（基于当前编辑器状态） */
const resolvedFormatButtons = computed(() =>
  props.formatButtons.map((btn) => ({
    ...btn,
    active: btn.active ?? props.editor?.isActive(btn.command) ?? false
  }))
);

/**
 * 处理格式按钮点击，直接操作编辑器。
 * 格式命令与 Tiptap 内核紧密耦合，仅存在于 rich host 层。
 */
function handleFormat(command: SelectionToolbarAction): void {
  const { editor } = props;
  switch (command) {
    case 'bold':
      editor.chain().focus().toggleBold().run();
      break;
    case 'italic':
      editor.chain().focus().toggleItalic().run();
      break;
    case 'underline':
      editor.chain().focus().toggleUnderline().run();
      break;
    case 'strike':
      editor.chain().focus().toggleStrike().run();
      break;
    case 'code':
      editor.chain().focus().toggleCode().run();
      break;
    default:
      break;
  }
  emit('format', command);
}

// ---- Blur Recovery ----

/** 记录最后一次 document mousedown 目标，用于兜底 relatedTarget 为 null 的场景 */
let lastMousedownTarget: HTMLElement | null = null;

function handleDocumentMousedown(e: MouseEvent): void {
  lastMousedownTarget = e.target as HTMLElement | null;
}

/**
 * blur 后若选区仍存在，通过 meta 强制重显菜单。
 * BubbleMenu 内置 blurHandler 会直接调用 hide()，不受 shouldShow 制约。
 * 利用同步 dispatch 的时序保证无闪烁：hide()→show()→浏览器 paint。
 *
 * 例外：焦点/点击移入编辑器面板内的其他 UI（如 FrontMatterCard），
 * 说明用户已转向编辑其他内容，不再恢复菜单。
 * @param event - 编辑器 blur 事件
 */
function handleBlurRestore({ event }: { event: FocusEvent }): void {
  if (suppressRestore.value) {
    suppressRestore.value = false;
    return;
  }

  const { state } = props.editor!;
  const { from, to } = state.selection;
  if (from === to) {
    return;
  }

  // relatedTarget 在点击非可聚焦元素（如 div 容器背景）时为 null，
  // 此时用 document mousedown 记录的点击目标兜底
  const target = (event.relatedTarget as HTMLElement | null) ?? lastMousedownTarget;
  lastMousedownTarget = null;

  if (target) {
    const editorDom = props.editor!.view.dom;
    // 利用 DOM 结构关系定位编辑器面板边界，避免硬编码类名
    const editorPane = editorDom.parentElement?.parentElement ?? null;
    if (editorPane && editorPane.contains(target) && !editorDom.contains(target)) {
      return;
    }
  }

  props.editor!.view.dispatch(state.tr.setMeta(SELECTION_TOOLBAR_PLUGIN_KEY, 'show'));
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMousedown, true);
  // 等 BubbleMenu 内部插件注册完毕，再注册 blur handler
  nextTick(() => {
    props.editor?.on('blur', handleBlurRestore);
  });
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMousedown, true);
  props.editor?.off('blur', handleBlurRestore);
});

/**
 * 主动隐藏工具栏（供外部调用，如点击 AI 助手后让位给面板）。
 */
function suppress(): void {
  suppressRestore.value = true;
  props.editor?.view.dispatch(props.editor.state.tr.setMeta(SELECTION_TOOLBAR_PLUGIN_KEY, 'hide'));
}

defineExpose({ suppress });
</script>
