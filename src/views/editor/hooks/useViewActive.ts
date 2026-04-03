import { computed, ref } from 'vue';
import type { BEditorViewMode } from '@/components/BEditor/types';
import type { Props as ToolbarProps } from '@/components/Toolbar.vue';

export function useViewActive() {
  const viewMode = ref<BEditorViewMode>('rich');
  const toolbarViewOptions = computed<ToolbarProps['options']>(() => [
    {
      value: 'source',
      label: '源代码模式',
      onClick: () => {
        viewMode.value = viewMode.value === 'source' ? 'rich' : 'source';
      }
    }
  ]);

  return { viewMode, toolbarViewOptions };
}
