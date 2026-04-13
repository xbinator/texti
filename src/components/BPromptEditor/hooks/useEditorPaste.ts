import type { Ref } from 'vue';

export interface PasteOptions {
  disabled: Ref<boolean>;
  insertTextAtCursor: (text: string) => boolean;
  updateModelValue: () => void;
}

export function useEditorPaste(options: PasteOptions) {
  const { disabled, insertTextAtCursor, updateModelValue } = options;

  function handlePaste(event: ClipboardEvent): void {
    if (disabled.value) return;
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain');
    if (text) {
      insertTextAtCursor(text);
      updateModelValue();
    }
  }

  return {
    handlePaste
  };
}
