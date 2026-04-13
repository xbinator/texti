import type { Ref } from 'vue';
import { ref, watch } from 'vue';

interface DirtySource {
  id: string;
  content: string;
}

export function useDirty(source: Ref<DirtySource>) {
  const isDirty = ref(false);
  const originalContent = ref<string>('');
  const currentId = ref<string>('');

  function setOriginalContent(content: string): void {
    originalContent.value = content;
    isDirty.value = false;
  }

  function resetOriginalContent(): void {
    setOriginalContent(source.value.content);
  }

  watch(
    () => source.value.id,
    (newId) => {
      if (newId !== currentId.value) {
        currentId.value = newId;
        setOriginalContent(source.value.content);
      }
    },
    { immediate: true }
  );

  watch(
    () => source.value.content,
    () => {
      isDirty.value = source.value.content !== originalContent.value;
    }
  );

  return {
    isDirty,
    originalContent,
    setOriginalContent,
    resetOriginalContent
  };
}
