import { computed } from 'vue';
import type { ToolbarOptions } from '@/components/BToolbar/types';

interface UseHelpOptions {
  searchRecent: boolean;
  shortcutsHelp: boolean;
}

export function useHelpActive(options: UseHelpOptions) {
  const toolbarHelpOptions = computed<ToolbarOptions>(() => [
    {
      value: 'shortcuts',
      label: '快捷键',
      shortcut: 'Ctrl+/',
      onClick: () => {
        options.shortcutsHelp = true;
      }
    }
  ]);

  return {
    toolbarHelpOptions
  };
}
