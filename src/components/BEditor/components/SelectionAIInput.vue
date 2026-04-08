<template>
  <div v-if="editor && visible" ref="wrapperRef" class="ai-input-wrapper" :style="wrapperStyle">
    <AInput ref="inputRef" v-model="inputValue" size="large" placeholder="输入指令..." @keydown.enter="handleSubmit" @keydown.esc="handleCancel" />
  </div>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/vue-3';
import type { CSSProperties } from 'vue';
import { nextTick, onUnmounted, ref, watch } from 'vue';
import { onClickOutside } from '@vueuse/core';

interface Props {
  editor?: Editor | null;
}

const props = withDefaults(defineProps<Props>(), {
  editor: null
});

const visible = defineModel<boolean>('visible', { default: false });

const inputValue = ref('');
const inputRef = ref<{ focus: () => void } | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);
const wrapperStyle = ref<CSSProperties>({});

// wrapperRef 在 visible=false 时为 null，天然不会触发，无需额外开关
onClickOutside(wrapperRef, () => {
  visible.value = false;
});

function updatePosition(): void {
  if (!props.editor) return;

  const { from, to } = props.editor.state.selection;
  if (from === to) return;

  requestAnimationFrame(() => {
    const editorDom = props.editor!.view.dom as HTMLElement;
    const editorRect = editorDom.getBoundingClientRect();
    const end = props.editor!.view.coordsAtPos(to);
    const lineHeight = end.bottom - end.top;
    const top = end.top - editorRect.top + editorDom.offsetTop;

    wrapperStyle.value = { top: `${top + lineHeight + 6}px` };
  });
}

watch(visible, (newValue) => {
  if (newValue) {
    updatePosition();
    nextTick(() => inputRef.value?.focus());
  } else {
    inputValue.value = '';
  }
});

onUnmounted(() => {
  inputValue.value = '';
});

function handleSubmit(): void {
  const value = inputValue.value.trim();
  if (!value || !props.editor) return;

  const { from, to } = props.editor.state.selection;
  const selectedText = props.editor.state.doc.textBetween(from, to, '');
  console.log('selectedText:', selectedText);

  // TODO: 调用 AI 接口
  inputValue.value = '';
  visible.value = false;
}

function handleCancel(): void {
  inputValue.value = '';
  visible.value = false;
  props.editor?.commands.focus();
}
</script>

<style lang="less" scoped>
.ai-input-wrapper {
  position: absolute;
  left: 50px;
  z-index: 1000;
  display: flex;
  width: calc(100% - 100px);
  padding: 4px;
  background: var(--bg-primary);
  border: 1px solid var(--border-primary);
  border-radius: 8px;
  box-shadow: var(--shadow-lg);
}
</style>
