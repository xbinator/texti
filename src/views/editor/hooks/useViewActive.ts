import { computed, ref } from 'vue';
import type { BEditorViewMode } from '@/components/BEditor/types';
import type { Props as ToolbarProps } from '@/components/Toolbar.vue';
import { EditorShortcuts } from '../constants/shortcuts';

const STORAGE_KEY = 'editor_viewState';

interface EditorViewState {
  mode: BEditorViewMode;
  showOutline: boolean;
}

function loadViewState(): EditorViewState {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      return JSON.parse(saved) as EditorViewState;
    } catch {
      //
    }
  }
  return { mode: 'rich', showOutline: true };
}

function saveViewState(state: EditorViewState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function useViewActive() {
  const viewState = ref<EditorViewState>(loadViewState());

  const canShowOutline = computed<boolean>(() => viewState.value.mode === 'rich');

  const toolbarViewOptions = computed<ToolbarProps['options']>(() => [
    {
      value: 'source',
      label: '源代码模式',
      shortcut: EditorShortcuts.VIEW_SOURCE,
      selected: viewState.value.mode === 'source',
      onClick: () => {
        viewState.value.mode = viewState.value.mode === 'source' ? 'rich' : 'source';
        saveViewState(viewState.value);
      }
    },
    {
      value: 'outline',
      label: '大纲',
      selected: canShowOutline.value && viewState.value.showOutline,
      disabled: !canShowOutline.value,
      onClick: () => {
        viewState.value.showOutline = !viewState.value.showOutline;
        saveViewState(viewState.value);
      }
    }
  ]);

  return { viewState, toolbarViewOptions };
}
