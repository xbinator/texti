/**
 * @file richEditorMarkdownRoundTrip.test.ts
 * @description 验证富文本编辑器的 Markdown 导入导出是否会在无用户编辑时改写原始字符串。
 */
import { ref, type Ref } from 'vue';
import { Editor } from '@tiptap/core';
import { describe, expect, test } from 'vitest';
import { useExtensions } from '@/components/BEditor/hooks/useExtensions';

/**
 * 创建带有当前 BEditor 扩展集的 Markdown 编辑器。
 * @returns 可用于导入导出 Markdown 的编辑器实例
 */
function createMarkdownEditor(): Editor {
  const editorInstanceId: Ref<string> = ref('round-trip-test');
  const { editorExtensions } = useExtensions(editorInstanceId);

  return new Editor({
    extensions: editorExtensions,
    content: '',
    contentType: 'markdown'
  });
}

/**
 * 让 Markdown 经过一次富文本导入与导出流程。
 * @param markdown - 原始 Markdown 文本
 * @returns 导出后的 Markdown 文本
 */
function roundTripMarkdown(markdown: string): string {
  const editor = createMarkdownEditor();

  editor.commands.setContent(markdown, {
    contentType: 'markdown'
  });

  const exportedMarkdown = editor.getMarkdown();
  editor.destroy();

  return exportedMarkdown;
}

describe('rich editor markdown round trip', () => {
  test.each([
    ['heading', '# 标题'],
    ['task-list', '- [ ] 待办事项'],
    ['reference-link', '- 详情参考 [Task][task-ref]\n\n[task-ref]: https://example.com'],
    ['html-comment', '<!-- comment -->'],
    ['ordered-list', '1. 第一项\n2. 第二项']
  ])('keeps %s markdown text stable without user edits', (_label: string, markdown: string) => {
    const exportedMarkdown = roundTripMarkdown(markdown);

    expect(exportedMarkdown).toBe(markdown);
  });
});
