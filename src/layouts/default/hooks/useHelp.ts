import { computed } from 'vue';
import type { ToolbarOptions } from '@/components/BToolbar/types';

interface UseHelpOptions {
  onShowShortcuts: () => void;
}

export function useHelp(options: UseHelpOptions) {
  const { onShowShortcuts } = options;

  const toolbarHelpOptions = computed<ToolbarOptions>(() => [
    {
      value: 'shortcuts',
      label: '快捷键',
      shortcut: 'Ctrl+/',
      onClick: onShowShortcuts
    }
  ]);

  return {
    toolbarHelpOptions
  };
}
