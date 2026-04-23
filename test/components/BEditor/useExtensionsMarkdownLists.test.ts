/**
 * @file useExtensionsMarkdownLists.test.ts
 * @description Verify Markdown list parsing stays stable for plain, nested, and reference-link list content.
 */
import type { JSONContent } from '@tiptap/core';
import { Editor } from '@tiptap/core';
import { ref, type Ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useExtensions } from '@/components/BEditor/hooks/useExtensions';

/**
 * Create a Markdown-configured editor with the current rich editor extensions.
 * @returns Editor instance used for Markdown import assertions
 */
function createMarkdownEditor(): Editor {
  const editorInstanceId: Ref<string> = ref('test-editor');
  const { editorExtensions } = useExtensions(editorInstanceId);

  return new Editor({
    extensions: editorExtensions,
    content: '',
    contentType: 'markdown'
  });
}

/**
 * Import Markdown into the editor and return the parsed JSON document.
 * @param markdown - Markdown source to import
 * @returns ProseMirror JSON document
 */
function importMarkdown(markdown: string): JSONContent {
  const editor = createMarkdownEditor();

  editor.commands.setContent(markdown, {
    contentType: 'markdown'
  });

  const json = editor.getJSON();
  editor.destroy();

  return json;
}

describe('useExtensions markdown list parsing', () => {
  it('keeps plain bullet items under Files as a bullet list instead of headings', () => {
    const json = importMarkdown(
      [
        '### Task 1: 建立渠道构建脚本骨架',
        '',
        '**Files:**',
        '- Create: `scripts/channelBuild/constants.js`',
        '- Create: `scripts/channelBuild/fsUtils.js`',
        '- Test: 手动执行 `node scripts/channelBuild/prepareChannelBuild.js`'
      ].join('\n')
    );
    const taskHeading = json.content?.[0];
    const filesParagraph = json.content?.[1];
    const filesList = json.content?.[2];

    expect(taskHeading).toMatchObject({
      type: 'heading',
      attrs: expect.objectContaining({ level: 3 })
    });
    expect(filesParagraph).toMatchObject({
      type: 'paragraph'
    });
    expect(filesList).toMatchObject({
      type: 'bulletList'
    });
    expect(filesList?.content).toHaveLength(3);
    expect(filesList?.content?.[0]?.type).toBe('listItem');
    expect(filesList?.content?.[0]?.content?.[0]?.type).toBe('paragraph');
    expect(filesList?.content?.[0]?.content?.[0]?.content?.[0]).toMatchObject({
      type: 'text',
      text: 'Create: '
    });
    expect(
      json.content?.some((node) => {
        return node.type === 'heading'
          && node.attrs?.level === 2
          && typeof node.content?.[0]?.text === 'string'
          && node.content[0].text.includes('Create:');
      })
    ).toBe(false);
  });

  it('keeps Expected bullet items as list items instead of promoting them to headings', () => {
    const json = importMarkdown(
      [
        'Run: `npm run shanghai`',
        '',
        'Expected:',
        '',
        '- 构建启动成功',
        '- 日志中能看到 `[channel-build] city=shanghai`',
        '- 首页编译结果来自上海覆盖文件'
      ].join('\n')
    );
    const expectedParagraph = json.content?.[1];
    const expectedList = json.content?.[2];

    expect(expectedParagraph).toMatchObject({
      type: 'paragraph',
      content: [{ type: 'text', text: 'Expected:' }]
    });
    expect(expectedList).toMatchObject({
      type: 'bulletList'
    });
    expect(expectedList?.content).toHaveLength(3);
    expect(
      json.content?.some((node) => {
        return node.type === 'heading'
          && typeof node.content?.[0]?.text === 'string'
          && node.content[0].text.includes('构建启动成功');
      })
    ).toBe(false);
  });

  it('preserves nested bullet lists inside a plain bullet item', () => {
    const json = importMarkdown(
      [
        '- 某个渠道需要新增页面时：',
        '  - 在 `src/channelPages/<city>/` 下添加页面文件',
        '  - 在 `src/channelPages/<city>/channel.config.js` 里通过 `pages` 或 `subPackages` 追加注册'
      ].join('\n')
    );
    const rootList = json.content?.[0];
    const firstListItem = rootList?.content?.[0];
    const nestedList = firstListItem?.content?.[1];

    expect(rootList).toMatchObject({
      type: 'bulletList'
    });
    expect(firstListItem?.type).toBe('listItem');
    expect(nestedList).toMatchObject({
      type: 'bulletList'
    });
    expect(nestedList?.content).toHaveLength(2);
  });

  it('keeps reference-style links as plain text inside list items', () => {
    const json = importMarkdown('- 详情参考 [Task][task-ref]');
    const firstListItemParagraph = json.content?.[0]?.content?.[0]?.content?.[0];
    const paragraphText = firstListItemParagraph?.content
      ?.map((node) => ('text' in node && typeof node.text === 'string' ? node.text : ''))
      .join('');

    expect(firstListItemParagraph).toMatchObject({
      type: 'paragraph'
    });
    expect(paragraphText).toContain('[Task][task-ref]');
    expect(
      firstListItemParagraph?.content?.some((node) => {
        return 'marks' in node && Array.isArray(node.marks) && node.marks.some((mark) => mark.type === 'link');
      })
    ).toBe(false);
  });
});
