import type { DecorationSet } from '@codemirror/view';
import { StateField, EditorState, type ChangeSet, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';

const VARIABLE_PATTERN = /\{\{([^{}\n]+)\}\}/g;

/**
 * 文件引用 Chip Widget，将底层 token 替换为展示文本
 * - 有 line → 显示 `fileName:line`
 * - 无 line → 显示 `fileName`
 */
class FileRefWidget extends WidgetType {
  constructor(private fileName: string, private line: string) {
    super();
  }

  eq(other: FileRefWidget): boolean {
    return this.fileName === other.fileName && this.line === other.line;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'b-prompt-chip b-prompt-chip--file';
    span.textContent = this.line ? `${this.fileName}:${this.line}` : this.fileName;
    return span;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(text: string): DecorationSet {
  const decorations: Range<Decoration>[] = [];

  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    const body = match[1];

    if (body.startsWith('file-ref:')) {
      // 统一按 | 拆分: file-ref:id|fileName|line → widget 显示 fileName:line
      const stripped = body.slice('file-ref:'.length);
      if (!stripped) continue;

      const parts = stripped.split('|');
      const fileName = parts[1] || parts[0];
      const line = parts[2] || '';

      decorations.push(
        Decoration.replace({
          widget: new FileRefWidget(fileName, line)
        }).range(match.index, match.index + match[0].length)
      );
      continue;
    }

    decorations.push(Decoration.mark({ class: 'b-prompt-chip' }).range(match.index, match.index + match[0].length));
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
