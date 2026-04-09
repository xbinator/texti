import type { ComputedRef, Ref } from 'vue';
import { computed } from 'vue';

export interface EditorController {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  focusEditor: () => void;
  focusEditorAtStart: () => void;
}

interface UseEditorControllerParams {
  isRichMode: ComputedRef<boolean>;
  richEditorPaneRef: Ref<EditorController | null>;
  sourceEditorPaneRef: Ref<Pick<EditorController, 'focusEditor' | 'focusEditorAtStart'> | null>;
}

export function useEditorController({ isRichMode, richEditorPaneRef, sourceEditorPaneRef }: UseEditorControllerParams): ComputedRef<EditorController> {
  const sourceEditorController: EditorController = {
    undo(): void {
      sourceEditorPaneRef.value?.focusEditor();
    },
    redo(): void {
      sourceEditorPaneRef.value?.focusEditor();
    },
    canUndo(): boolean {
      return false;
    },
    canRedo(): boolean {
      return false;
    },
    focusEditor(): void {
      sourceEditorPaneRef.value?.focusEditor();
    },
    focusEditorAtStart(): void {
      sourceEditorPaneRef.value?.focusEditorAtStart();
    }
  };

  return computed<EditorController>(() => {
    if (isRichMode.value && richEditorPaneRef.value) {
      return richEditorPaneRef.value;
    }

    return sourceEditorController;
  });
}
