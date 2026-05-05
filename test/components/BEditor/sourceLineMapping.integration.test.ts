/**
 * @file sourceLineMapping.integration.test.ts
 * @description 验证真实 Markdown 导入流程中的源码行号映射结果。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ref, type Ref } from 'vue';
import { Editor } from '@tiptap/core';
import { describe, expect, test } from 'vitest';
import { getSelectionSourceLineRangeFromMarkdown } from '@/components/BEditor/adapters/sourceLineMapping';
import { useExtensions } from '@/components/BEditor/hooks/useExtensions';

/**
 * 加载测试 fixture 文件
 * @param relativePath - 相对于项目根目录的路径
 * @returns 文件内容
 */
function loadFixture(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

/**
 * 创建带源码行号映射能力的 Markdown 编辑器。
 * @returns 编辑器实例
 */
function createMarkdownEditor(): Editor {
  const editorInstanceId: Ref<string> = ref('source-line-integration-test');
  const { editorExtensions } = useExtensions(editorInstanceId);

  return new Editor({
    extensions: editorExtensions,
    content: '',
    contentType: 'markdown'
  });
}

describe('source line mapping integration', () => {
  test('keeps blank lines when mapping the chat image compression plan document', () => {
    const markdown = loadFixture('docs/superpowers/plans/2026-05-01-chat-image-compression.md');
    const editor = createMarkdownEditor();

    editor.commands.setContent(markdown, {
      contentType: 'markdown'
    });

    let architectureRange: { from: number; to: number } | null = null;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'paragraph') {
        return;
      }

      if (node.textContent.startsWith('Architecture:')) {
        architectureRange = {
          from: pos + 1,
          to: pos + node.content.size + 1
        };
      }
    });

    expect(architectureRange).not.toBeNull();
    expect(getSelectionSourceLineRangeFromMarkdown(editor.state.doc, architectureRange!.from, architectureRange!.to, markdown)).toEqual({
      startLine: 7,
      endLine: 7
    });

    editor.destroy();
  });
});
