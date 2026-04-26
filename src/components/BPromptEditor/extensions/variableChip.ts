import { StateField, EditorState } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';

const VARIABLE_PATTERN = /\{\{([^{}\n]+)\}\}/g;

function buildDecorations(text: string): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  let match: RegExpExecArray | null;

  VARIABLE_PATTERN.lastIndex = 0;
  while ((match = VARIABLE_PATTERN.exec(text)) !== null) {
    const fullMatch = match[0];
    const body = match[1];

    let className = 'b-prompt-chip';
    if (body.startsWith('file-ref:')) {
      className = 'b-prompt-chip b-prompt-chip--file';
    }

    decorations.push(
      Decoration.mark({ class: className }).range(match.index)
    );
  }

  return Decoration.set(decorations, true);
}

export const variableChipField: StateField<DecorationSet> = StateField.define<DecorationSet>({
  create(state: EditorState) {
    return buildDecorations(state.doc.toString());
  },

  update(deco: DecorationSet, tr: { docChanged: boolean; newDoc: EditorState['doc']; changes: EditorState['changeSet'] }) {
    if (tr.docChanged) {
      return buildDecorations(tr.newDoc.toString());
    }
    return deco.map(tr.changes);
  },

  provide: (field) => EditorView.decorations.from(field),
});

type Range<T> = { from: number; to: number } & T;