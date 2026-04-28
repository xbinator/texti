<template>
  <BubbleMenu :editor="editor" :plugin-key="SELECTION_TOOLBAR_PLUGIN_KEY" :should-show="shouldShow" :options="bubbleMenuOptions" class="bubble-menu-wrapper">
    <div class="selection-toolbar">
      <template v-if="isModelAvailable">
        <div class="selection-toolbar__ai-btn" @mousedown.prevent="toggleAIInput">
          <Icon icon="lucide:sparkles" />
          <span>AI 助手</span>
        </div>
        <div class="selection-toolbar__divider"></div>
      </template>

      <template v-if="props.filePath || props.fileName">
        <div class="selection-toolbar__ai-btn" @mousedown.prevent="insertSelectionReferenceToChat">
          <Icon icon="lucide:message-square-plus" />
          <span>插入对话</span>
        </div>
        <div class="selection-toolbar__divider"></div>
      </template>

      <button
        v-for="btn in formatButtons"
        :key="btn.command"
        type="button"
        class="selection-toolbar__btn"
        :class="{ 'is-active': editor?.isActive(btn.command) }"
        @mousedown.prevent="btn.action"
      >
        <Icon :icon="btn.icon" />
      </button>
    </div>
  </BubbleMenu>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3';
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { Icon } from '@iconify/vue';
import { PluginKey, type EditorState } from '@tiptap/pm/state';
import { BubbleMenu } from '@tiptap/vue-3/menus';
import { useEventListener } from '@vueuse/core';
import { emitChatFileReferenceInsert, getFileNameFromPath, getLineRangeFromTextBeforeSelection } from '@/shared/chat/fileReference';
import type { ServiceModelUpdatedDetail } from '@/shared/storage/service-models/events';
import { SERVICE_MODEL_UPDATED_EVENT } from '@/shared/storage/service-models/events';
import { useServiceModelStore } from '@/stores/service-model';

/**
 * 选区范围信息。
 */
interface SelectionRange {
  from: number;
  to: number;
  text: string;
}

/**
 * 组件属性。
 */
interface Props {
  editor: Editor;
  filePath?: string | null;
  fileName?: string;
}

const props = withDefaults(defineProps<Props>(), {
  filePath: null,
  fileName: ''
});

const emit = defineEmits<{
  (e: 'ai-input-toggle', value: boolean, selectionRange?: SelectionRange): void;
  (e: 'selection-reference-insert', selectionRange: SelectionRange): void;
  (e: 'selection-reference-clear'): void;
}>();

const isModelAvailable = ref(false);
const serviceModelStore = useServiceModelStore();

// ---- Model Availability ----

async function checkModelAvailability(): Promise<void> {
  isModelAvailable.value = await serviceModelStore.isServiceAvailable('polish');
}

/**
 * 响应模型配置更新事件，保持工具栏状态与当前服务可用性一致。
 * @param event - 模型配置更新事件
 */
function handleServiceModelUpdated(event: Event): void {
  const { detail } = event as CustomEvent<ServiceModelUpdatedDetail>;
  if (detail.serviceType !== 'polish') return;

  checkModelAvailability();
}

useEventListener(window, SERVICE_MODEL_UPDATED_EVENT, handleServiceModelUpdated);

// ---- Bubble Menu ----

/**
 * 与 BubbleMenu 共享的 PluginKey，用于 blur 恢复等 meta 控制。
 */
const SELECTION_TOOLBAR_PLUGIN_KEY = new PluginKey('bubbleMenu');

/**
 * 覆盖 BubbleMenu 内置显示判定：
 * - 去掉 hasEditorFocus 检查，失焦时菜单不隐藏
 * - 选区为空或选中区域无文本时仍隐藏
 */
const shouldShow = computed(() => ({ state }: { state: EditorState }): boolean => {
  const { from, to } = state.selection;
  if (from === to || !state.doc.textBetween(from, to, '') || !props.editor?.isEditable) {
    return false;
  }
  return true;
});

const bubbleMenuOptions = computed(() => ({
  placement: 'top-start' as const,
  onShow: () => {
    checkModelAvailability();
    emit('ai-input-toggle', false);
  },
  onHide: () => {
    // emit('ai-input-toggle', false);
    // emit('selection-reference-clear');
  }
}));

// ---- AI Input ----

/** 当主动隐藏工具栏（如点击"AI 助手"）时设为 true，阻止 blur handler 错误恢复 */
let suppressRestore = false;

function toggleAIInput(): void {
  const selection = props.editor?.state.selection;
  if (!selection || selection.from === selection.to) {
    emit('ai-input-toggle', true);
    return;
  }

  // 主动隐藏工具栏，为 AI 输入面板让位
  suppressRestore = true;
  props.editor?.view.dispatch(props.editor.state.tr.setMeta(SELECTION_TOOLBAR_PLUGIN_KEY, 'hide'));

  const text = props.editor?.state.doc.textBetween(selection.from, selection.to, '') ?? '';

  emit('ai-input-toggle', true, { from: selection.from, to: selection.to, text });
}

/**
 * 读取当前编辑器选区信息，供父组件在失焦后恢复选区与高亮。
 * @returns 当前选区信息；无有效选区时返回 null
 */
function getCurrentSelectionRange(): SelectionRange | null {
  const { editor } = props;
  const selection = editor?.state.selection;
  if (!editor || !selection || selection.from === selection.to) {
    return null;
  }

  const text = editor.state.doc.textBetween(selection.from, selection.to, '');

  return { from: selection.from, to: selection.to, text };
}

/**
 * 将当前选区所在文件与行号插入聊天输入框。
 */
function insertSelectionReferenceToChat(): void {
  const { filePath } = props;
  const { editor } = props;
  const selectionRange = getCurrentSelectionRange();
  if (!editor || !selectionRange) {
    return;
  }

  // 在工具栏点击导致编辑器失焦前，先把选区交给父组件缓存并恢复显示。
  emit('selection-reference-insert', selectionRange);

  const textBeforeStart = editor.state.doc.textBetween(0, selectionRange.from, '\n', '\n');
  const textBeforeEnd = editor.state.doc.textBetween(0, selectionRange.to, '\n', '\n');

  const range = getLineRangeFromTextBeforeSelection(textBeforeStart, textBeforeEnd);

  emitChatFileReferenceInsert({
    filePath: filePath ?? null,
    fileName: props.fileName || getFileNameFromPath(filePath ?? '未保存文件'),
    startLine: range.startLine,
    endLine: range.endLine
  });
}

// ---- Format Buttons ----

const formatButtons = computed(() => [
  { command: 'bold', icon: 'lucide:bold', action: () => props.editor?.chain().focus().toggleBold().run() },
  { command: 'italic', icon: 'lucide:italic', action: () => props.editor?.chain().focus().toggleItalic().run() },
  { command: 'underline', icon: 'lucide:underline', action: () => props.editor?.chain().focus().toggleUnderline().run() },
  { command: 'strike', icon: 'lucide:strikethrough', action: () => props.editor?.chain().focus().toggleStrike().run() },
  { command: 'code', icon: 'lucide:code', action: () => props.editor?.chain().focus().toggleCode().run() }
]);

checkModelAvailability();

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
  if (suppressRestore) {
    suppressRestore = false;
    return;
  }

  const { state } = props.editor!;
  const { from, to } = state.selection;
  if (from === to) return;

  // relatedTarget 在点击非可聚焦元素（如 div 容器背景）时为 null，
  // 此时用 document mousedown 记录的点击目标兜底
  const target = (event.relatedTarget as HTMLElement | null) ?? lastMousedownTarget;
  lastMousedownTarget = null;

  if (target) {
    const editorDom = props.editor!.view.dom;
    // 利用 DOM 结构关系定位编辑器面板边界，避免硬编码类名
    const editorPane = editorDom.parentElement?.parentElement ?? null;
    if (editorPane && editorPane.contains(target) && !editorDom.contains(target)) {
      emit('selection-reference-clear');
      return;
    }
  }

  props.editor!.view.dispatch(state.tr.setMeta(SELECTION_TOOLBAR_PLUGIN_KEY, 'show'));
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentMousedown, true);
  // 等 BubbleMenu 内部插件注册完毕（其 onMounted 里用了 nextTick）
  // 再注册我们的 blur handler，确保内置 blurHandler 先于我们触发
  nextTick(() => {
    props.editor?.on('blur', handleBlurRestore);
  });
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleDocumentMousedown, true);
  props.editor?.off('blur', handleBlurRestore);
});
</script>

<style lang="less" scoped>
.selection-toolbar {
  display: flex;
  gap: 2px;
  align-items: center;
  padding: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
}

.selection-toolbar__ai-btn {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  height: 28px;
  padding: 0 8px;
  font-size: 13px;
  color: var(--color-primary);
  cursor: pointer;
  border: none;
  border-radius: 6px;
  transition: background-color 0.15s ease;

  &:hover {
    background: var(--color-primary-bg-hover);
  }
}

.selection-toolbar__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 14px;
  color: var(--text-secondary);
  cursor: pointer;
  background: transparent;
  border: none;
  border-radius: 6px;
  transition: background-color 0.15s ease, color 0.15s ease;

  &:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  &.is-active {
    color: var(--color-primary);
    background: var(--bg-hover);
  }
}

.selection-toolbar__divider {
  width: 1px;
  height: 16px;
  margin: 0 4px;
  background: var(--border-primary);
}
</style>
