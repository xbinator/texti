import type { DecorationSet } from '@codemirror/view';
import { StateField, EditorState, type ChangeSet, type Range } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

const VARIABLE_PATTERN = /\{\{([^{}\n]+)\}\}/g;

function buildDecorations(text: string): DecorationSet {
  const decorations: Range<Decoration>[] = [];

  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const body = match[1];

    let className = 'b-prompt-chip';
    if (body.startsWith('file-ref:')) {
      className = 'b-prompt-chip b-prompt-chip--file';
    }

    decorations.push(Decoration.mark({ class: className }).range(match.index, match.index + match[0].length));
  }

  return Decoration.set(decorations, true);
}

export const variableChipField: StateField<DecorationSet> = StateField.define<DecorationSet>({
  create(state: EditorState) {
    return buildDecorations(state.doc.toString());
  },

  update(deco: DecorationSet, tr: { docChanged: boolean; newDoc: EditorState['doc']; changes: ChangeSet }) {
    if (tr.docChanged) {
      return buildDecorations(tr.newDoc.toString());
    }
    return deco.map(tr.changes);
  },

  provide: (field) => EditorView.decorations.from(field)
});
