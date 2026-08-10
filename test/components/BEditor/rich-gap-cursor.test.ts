/**
 * @file rich-gap-cursor.test.ts
 * @description Rich 编辑器间隙光标回归测试。
 * @vitest-environment jsdom
 */
import { ref } from 'vue';
import { Editor } from '@tiptap/vue-3';
import { afterEach, describe, expect, it } from 'vitest';
import { useExtensions } from '@/components/BEditor/hooks/useExtensions';

const editors: Editor[] = [];

/**
 * 创建使用 Rich 编辑器完整扩展集的 Tiptap 实例。
 * @param content - 初始 Markdown 内容
 * @returns Tiptap 编辑器实例
 */
function createRichEditor(content: string): Editor {
  const { editorExtensions } = useExtensions(ref('rich-gap-cursor-test'));
  const editor = new Editor({
    extensions: editorExtensions,
    content,
    contentType: 'markdown'
  });

  editors.push(editor);
  return editor;
}

afterEach((): void => {
  editors.splice(0).forEach((editor: Editor): void => editor.destroy());
});

describe('rich gap cursor', (): void => {
  it('registers a gap cursor so adjacent tables have an insertion point', (): void => {
    const editor = createRichEditor(['| A |', '| --- |', '| 1 |', '', '| B |', '| --- |', '| 2 |'].join('\n'));

    expect(editor.extensionManager.extensions.some((extension) => extension.name === 'gapCursor')).toBe(true);
  });
});
