import type { JSONContent } from '@tiptap/core';

export function createEmptyParagraphDoc(): JSONContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph' }]
  };
}

export function normalizeEditorContent(content: string): string | JSONContent {
  return content || createEmptyParagraphDoc();
}
