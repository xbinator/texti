/**
 * @file richEditorHeadingIdTransaction.test.ts
 * @description 验证标题 ID 补齐会触发文档事务，但不应改写导出的 Markdown 字符串。
 */
import type { JSONContent } from '@tiptap/core';
import { ref, type Ref } from 'vue';
import { Editor } from '@tiptap/core';
import { describe, expect, test } from 'vitest';
import { useExtensions } from '@/components/BEditor/hooks/useExtensions';

/**
 * 创建包含标题扩展的编辑器与 ID 补齐函数。
 * @returns 编辑器实例与标题 ID 补齐函数
 */
function createHeadingEditor(): { assignHeadingIds: (editor: Editor) => void; editor: Editor } {
  const editorInstanceId: Ref<string> = ref('heading-id-test');
  const { assignHeadingIds, editorExtensions } = useExtensions(editorInstanceId);

  return {
    assignHeadingIds,
    editor: new Editor({
      extensions: editorExtensions,
      content: '',
      contentType: 'markdown'
    })
  };
}

/**
 * 创建一个缺少 heading `id` 属性的文档。
 * @returns 用于测试标题 ID 补齐的文档 JSON
 */
function createHeadingDocumentWithoutId(): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: {
          level: 1
        },
        content: [
          {
            type: 'text',
            text: '标题'
          }
        ]
      }
    ]
  };
}

describe('rich editor heading id transaction', () => {
  test('assigns heading ids through a doc-changing transaction without changing markdown text', () => {
    const { editor, assignHeadingIds } = createHeadingEditor();
    const transactionFlags: boolean[] = [];

    editor.on('transaction', ({ transaction }) => {
      transactionFlags.push(transaction.docChanged);
    });

    editor.commands.setContent(createHeadingDocumentWithoutId());
    transactionFlags.length = 0;

    assignHeadingIds(editor);

    expect(transactionFlags).toEqual([true]);
    expect(editor.getMarkdown()).toBe('# 标题');
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({
      id: 'heading-id-test-heading-0',
      level: 1
    });

    editor.destroy();
  });
});
