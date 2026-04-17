import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface DecorationRange {
  from: number;
  to: number;
}

export type ClassNameResolver<T extends DecorationRange> = (item: T, index: number) => string;

export function createInlineDecorationSet<T extends DecorationRange>(doc: PMNode, items: T[], classNameResolver: ClassNameResolver<T>): DecorationSet {
  if (items.length === 0) {
    return DecorationSet.create(doc, []);
  }

  const decorations = items.map((item, index) =>
    Decoration.inline(item.from, item.to, {
      class: classNameResolver(item, index)
    })
  );

  return DecorationSet.create(doc, decorations);
}

export function createSingleDecorationSet(doc: PMNode, range: DecorationRange | null, className: string): DecorationSet {
  if (!range || range.from === range.to) {
    return DecorationSet.create(doc, []);
  }

  return DecorationSet.create(doc, [
    Decoration.inline(range.from, range.to, {
      class: className
    })
  ]);
}
