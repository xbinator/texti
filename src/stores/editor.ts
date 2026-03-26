import { ref } from 'vue';
import { defineStore } from 'pinia';

export const useEditorStore = defineStore('editor', () => {
  const content = ref('');
  const isDirty = ref(false);
  const currentFilePath = ref<string | null>(null);

  function setContent(newContent: string) {
    content.value = newContent;
    isDirty.value = true;
  }

  function setFilePath(path: string) {
    currentFilePath.value = path;
  }

  function markSaved() {
    isDirty.value = false;
  }

  function reset() {
    content.value = '';
    isDirty.value = false;
    currentFilePath.value = null;
  }

  return {
    content,
    isDirty,
    currentFilePath,
    setContent,
    setFilePath,
    markSaved,
    reset
  };
});
