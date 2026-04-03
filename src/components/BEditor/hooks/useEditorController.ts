import type RichEditorPane from '../components/RichEditorPane.vue';
import type SourceEditorPane from '../components/SourceEditorPane.vue';
import type { ComputedRef, Ref } from 'vue';
import { computed } from 'vue';

export interface EditorController {
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

interface UseEditorControllerParams {
  isRichMode: ComputedRef<boolean>;
  richEditorPaneRef: Ref<InstanceType<typeof RichEditorPane> | null>;
  sourceEditorPaneRef: Ref<InstanceType<typeof SourceEditorPane> | null>;
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
    }
  };

  return computed<EditorController>(() => {
    if (isRichMode.value && richEditorPaneRef.value) {
      return richEditorPaneRef.value;
    }

    return sourceEditorController;
  });
}
