import type { Ref } from 'vue';

export interface KeyboardOptions {
  disabled: Ref<boolean>;
  onDeleteVariable: (direction: 'before' | 'after') => boolean;
  onEnter: () => void;
  onSubmit?: () => void;
  submitOnEnter: Ref<boolean>;
  onMenuKeydown: (event: KeyboardEvent) => boolean;
  isMenuVisible: Ref<boolean>;
  hideMenu: () => void;
}

export function useEditorKeyboard(options: KeyboardOptions) {
  const { disabled, onDeleteVariable, onEnter, onSubmit, submitOnEnter, onMenuKeydown, isMenuVisible, hideMenu } = options;

  function handleKeyDown(event: KeyboardEvent): void {
    if (disabled.value) return;

    if (event.key === 'Backspace' && onDeleteVariable('before')) {
      event.preventDefault();
      hideMenu();
      return;
    }

    if (event.key === 'Delete' && onDeleteVariable('after')) {
      event.preventDefault();
      hideMenu();
      return;
    }

    if (event.key === 'Enter' && !isMenuVisible.value) {
      event.preventDefault();
      if (submitOnEnter.value && !event.shiftKey) {
        onSubmit?.();
      } else {
        onEnter();
      }
      return;
    }

    onMenuKeydown(event);
  }

  return {
    handleKeyDown
  };
}
