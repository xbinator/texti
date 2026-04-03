<template>
  <div class="source-editor-pane">
    <textarea ref="sourceTextareaRef" v-model="editorContent" class="source-editor-textarea" spellcheck="false"></textarea>
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

defineExpose({ focusEditor });

// @ts-ignore
useTextareaAutosize({ element: sourceTextareaRef, input: editorContent });
</script>

<style lang="less">
.source-editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px 40px 90px;
}

.source-editor-textarea {
  width: 100%;
  min-height: 100%;
  padding: 0;
  font-size: 14px;
  line-height: 1.6;
  color: #2e2e2e;
  resize: none;
  outline: none;
  border: 0;
}
</style>
