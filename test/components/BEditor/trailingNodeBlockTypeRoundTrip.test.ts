/**
 * @file trailing-node-test.ts
 * @description 验证 trailingNode 对不同块级节点结尾文档的影响
 */
import { ref, type Ref } from 'vue';
import { Editor } from '@tiptap/core';
import { describe, expect, test } from 'vitest';
import { useExtensions } from '@/components/BEditor/hooks/useExtensions';

function createMarkdownEditor(): Editor {
  const editorInstanceId: Ref<string> = ref('trailing-test');
  const { editorExtensions } = useExtensions(editorInstanceId);
  return new Editor({ extensions: editorExtensions, content: '', contentType: 'markdown' });
}

function roundTripMarkdown(markdown: string): string {
  const editor = createMarkdownEditor();
  editor.commands.setContent(markdown, { contentType: 'markdown' });
  const exported = editor.getMarkdown();
  editor.destroy();
  return exported;
}

describe('trailingNode behavior for different block types at end of document', () => {
  test('document ending with table: round-trip stable', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    expect(roundTripMarkdown(md)).toBe(md);
  });

  test('document ending with code block: round-trip stable', () => {
    const md = '```js\nconst x = 1;\n```';
    expect(roundTripMarkdown(md)).toBe(md);
  });

  test('document ending with heading', () => {
    const md = '# Heading';
    expect(roundTripMarkdown(md)).toBe(md);
  });

  test('document ending with blockquote', () => {
    const md = '> quote';
    expect(roundTripMarkdown(md)).toBe(md);
  });

  test('document ending with ordered list', () => {
    const md = '1. first';
    expect(roundTripMarkdown(md)).toBe(md);
  });

  test('document ending with task list', () => {
    const md = '- [ ] todo';
    expect(roundTripMarkdown(md)).toBe(md);
  });
});
