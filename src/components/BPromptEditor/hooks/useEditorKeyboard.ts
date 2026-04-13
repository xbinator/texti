import type { Ref } from 'vue';

export interface KeyboardOptions {
  disabled: Ref<boolean>;
  onDeleteVariable: (direction: 'before' | 'after') => boolean;
  onEnter: () => void;
  onMenuKeydown: (event: KeyboardEvent) => boolean;
  isMenuVisible: Ref<boolean>;
  hideMenu: () => void;
}

export function useEditorKeyboard(options: KeyboardOptions) {
  const { disabled, onDeleteVariable, onEnter, onMenuKeydown, isMenuVisible, hideMenu } = options;

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
      onEnter();
      return;
    }

    onMenuKeydown(event);
  }

  return {
    handleKeyDown
  };
}
