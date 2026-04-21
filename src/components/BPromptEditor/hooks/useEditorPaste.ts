import type { Ref } from 'vue';

export interface PasteOptions {
  disabled: Ref<boolean>;
  insertTextAtCursor: (text: string) => boolean;
  updateModelValue: () => void;
}

export function useEditorPaste(options: PasteOptions) {
  const { disabled, insertTextAtCursor, updateModelValue } = options;

  /**
   * 处理粘贴事件，仅接受纯文本。
   * @param event - 剪贴板事件
   */
  function handlePaste(event: ClipboardEvent): void {
    if (disabled.value) return;
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain');
    if (text) {
      insertTextAtCursor(text);
      updateModelValue();
    }
  }

  /**
   * 处理拖拽悬停事件，阻止默认行为以允许放置。
   * @param event - 拖拽事件
   */
  function handleDragOver(event: DragEvent): void {
    if (disabled.value) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
  }

  /**
   * 处理拖拽放置事件，仅接受纯文本。
   * @param event - 拖拽事件
   */
  function handleDrop(event: DragEvent): void {
    if (disabled.value) return;
    event.preventDefault();
    const text = event.dataTransfer?.getData('text/plain');
    if (text) {
      insertTextAtCursor(text);
      updateModelValue();
    }
  }

  return {
    handlePaste,
    handleDragOver,
    handleDrop
  };
}
