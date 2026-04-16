import type { ToolbarOption, ToolbarOptions } from '../types';
import { useShortcuts } from '@/hooks/useShortcuts';

export function useToolbarShortcuts() {
  const { registerShortcuts } = useShortcuts();

  function register(options: ToolbarOptions): () => void {
    const shortcuts = options
      .filter((item): item is ToolbarOption => item.type !== 'divider')
      .filter((item) => item.shortcut && item.onClick && item.enableShortcut !== false && item.disabled !== true)
      .map((item) => ({
        key: item.shortcut!,
        handler: item.onClick!
      }));

    return registerShortcuts(shortcuts);
  }

  return { register };
}
