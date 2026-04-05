import { computed, ref, watch } from 'vue';
import type { BEditorViewMode } from '@/components/BEditor/types';
import type { Props as ToolbarProps } from '@/components/Toolbar.vue';
import { EditorShortcuts } from '../constants/shortcuts';

const STORAGE_KEY = 'editor_viewState';

interface EditorViewState {
  // 视图模式
  mode: BEditorViewMode;
  // 是否显示大纲
  showOutline: boolean;
  // 主题
  theme: 'dark' | 'light';
}

function loadViewState(): EditorViewState {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const state = JSON.parse(saved) as EditorViewState;
      return state;
    } catch {
      //
    }
  }
  return { mode: 'rich', showOutline: true, theme: 'light' };
}

function saveViewState(state: EditorViewState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function useViewActive() {
  const viewState = ref<EditorViewState>(loadViewState());

  const canShowOutline = computed<boolean>(() => viewState.value.mode === 'rich');

  watch(
    () => viewState.value.theme,
    (theme) => {
      if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
      }
    },
    { immediate: true }
  );

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
    },
    {
      value: 'theme',
      label: '主题',
      selected: false,
      children: [
        {
          value: 'light',
          label: '浅色模式',
          selected: viewState.value.theme === 'light',
          onClick: () => {
            viewState.value.theme = 'light';
            saveViewState(viewState.value);
          }
        },
        {
          value: 'dark',
          label: '深色模式',
          selected: viewState.value.theme === 'dark',
          onClick: () => {
            viewState.value.theme = 'dark';
            saveViewState(viewState.value);
          }
        }
      ]
    }
  ]);

  return { viewState, toolbarViewOptions };
}
