<template>
  <div class="source-editor-pane">
    <textarea ref="sourceTextareaRef" v-model="editorContent" class="source-editor-textarea" spellcheck="false" placeholder="请输入内容"></textarea>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useTextareaAutosize } from '@vueuse/core';

const editorContent = defineModel<string>('value', { default: '' });
const sourceTextareaRef = ref<HTMLTextAreaElement | null>(null);

function focusEditor(): void {
  sourceTextareaRef.value?.focus();
}

function focusEditorAtStart(): void {
  const textarea = sourceTextareaRef.value;
  if (textarea) {
    textarea.focus();
    textarea.setSelectionRange(0, 0);
  }
}

defineExpose({ focusEditor, focusEditorAtStart });

// @ts-ignore
useTextareaAutosize({ element: sourceTextareaRef, input: editorContent });
</script>

<style lang="less">
.source-editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.source-editor-textarea {
  width: 100%;
  min-height: 100%;
  padding: 0;
  line-height: 1.74;
  color: var(--editor-text);
  resize: none;
  outline: none;
  border: 0;

  &::placeholder {
    color: var(--editor-placeholder);
  }
}
</style>
