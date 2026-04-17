import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import { createSingleDecorationSet, type DecorationRange } from './decoration-utils';

type AISelectionRange = DecorationRange;

interface AISelectionHighlightState {
  decorations: DecorationSet;
  range: AISelectionRange | null;
}

interface AISelectionHighlightMeta {
  range?: AISelectionRange | null;
}

const aiSelectionHighlightPluginKey = new PluginKey<AISelectionHighlightState>('b-editor-ai-selection-highlight');

function createHighlightState(doc: PMNode, range: AISelectionRange | null = null): AISelectionHighlightState {
  return {
    decorations: createSingleDecorationSet(doc, range, 'ai-selection-highlight'),
    range
  };
}

export function setAISelectionHighlight(editor: Editor | null | undefined, range: AISelectionRange): void {
  if (!editor) return;

  editor.view.dispatch(
    editor.state.tr.setMeta(aiSelectionHighlightPluginKey, {
      range
    })
  );
}

export function clearAISelectionHighlight(editor: Editor | null | undefined): void {
  if (!editor) return;

  editor.view.dispatch(
    editor.state.tr.setMeta(aiSelectionHighlightPluginKey, {
      range: null
    })
  );
}

export const AISelectionHighlight = Extension.create({
  name: 'aiSelectionHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<AISelectionHighlightState>({
        key: aiSelectionHighlightPluginKey,
        state: {
          init: (_, state) => createHighlightState(state.doc),
          apply(tr, pluginState, _oldState, newState) {
            const meta = tr.getMeta(aiSelectionHighlightPluginKey) as AISelectionHighlightMeta | undefined;

            if (meta && 'range' in meta) {
              return createHighlightState(newState.doc, meta.range ?? null);
            }

            if (tr.docChanged && pluginState.range) {
              const mappedFrom = tr.mapping.map(pluginState.range.from);
              const mappedTo = tr.mapping.map(pluginState.range.to);

              return createHighlightState(newState.doc, { from: mappedFrom, to: mappedTo });
            }

            return pluginState;
          }
        },
        props: {
          decorations(state) {
            return aiSelectionHighlightPluginKey.getState(state)?.decorations ?? DecorationSet.create(state.doc, []);
          }
        }
      })
    ];
  }
});
