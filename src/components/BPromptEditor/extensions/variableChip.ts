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
      // 校验 file-ref:path|name 标准格式
      const fileMatch = body.match(/^file-ref:([^|\n{}]+)\|([^{}\n]+)$/);
      if (!fileMatch) continue;
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

/**
 * 检查指定文档位置是否落在 Chip 范围内
 * @param state - 编辑器状态
 * @param pos - 文档位置
 * @returns Chip 范围 { from, to } 或 null
 */
export function getChipAtPos(state: EditorState, pos: number): { from: number; to: number } | null {
  const decorations = state.field(variableChipField, false);
  if (!decorations) return null;

  const iter = decorations.iter();
  while (iter.value !== null) {
    if (pos >= iter.from && pos < iter.to) {
      return { from: iter.from, to: iter.to };
    }
    iter.next();
  }
  return null;
}
