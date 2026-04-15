import { computed } from 'vue';
import type { ToolbarOptions } from '@/components/BToolbar/types';
import { useSettingStore } from '@/stores/setting';
import { EditorShortcuts } from '../../../constants/shortcuts';

export function useViewActive() {
  const settingStore = useSettingStore();

  const toolbarViewOptions = computed<ToolbarOptions>(() => [
    {
      value: 'source',
      label: '源代码模式',
      shortcut: EditorShortcuts.VIEW_SOURCE,
      selected: settingStore.sourceMode,
      onClick: () => {
        settingStore.toggleSourceMode();
      }
    },
    {
      value: 'outline',
      label: '大纲',
      selected: settingStore.showOutline,
      disabled: false,
      onClick: () => {
        settingStore.toggleOutline();
      }
    },
    { type: 'divider' },
    {
      value: 'theme',
      label: '主题',
      selected: false,
      children: [
        {
          value: 'light',
          label: '浅色模式',
          selected: settingStore.theme === 'light',
          onClick: () => {
            settingStore.setTheme('light');
          }
        },
        {
          value: 'dark',
          label: '深色模式',
          selected: settingStore.theme === 'dark',
          onClick: () => {
            settingStore.setTheme('dark');
          }
        },
        {
          value: 'system',
          label: '跟随系统',
          selected: settingStore.theme === 'system',
          onClick: () => {
            settingStore.setTheme('system');
          }
        }
      ]
    }
  ]);

  return { toolbarViewOptions };
}
