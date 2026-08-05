/**
 * @file source-line-mapping.matrix.test.ts
 * @description 审计 Rich 选区与 Markdown 物理行号的正反向结构覆盖矩阵。
 */
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import {
  createSourceLineTracker,
  getSelectionSourceLineRangeFromMarkdown,
  mapSourceLineRangeToProseMirrorRange
} from '@/components/BEditor/adapters/sourceLineMapping';
import { InlineCommentMark } from '@/components/BEditor/extensions/inlineCommentMark';
import { createRichMarkdownSchemaExtensions } from '@/components/BEditor/hooks/useExtensions';
import { parseMarkdownForRichLoad } from '@/components/BEditor/utils/richMarkdownParser';

/** 映射审计用例。 */
interface MappingAuditCase {
  /** 用例名称。 */
  name: string;
  /** Markdown 源码。 */
  markdown: string;
  /** 选择第几个 TARGET（1-based）。 */
  occurrence?: number;
}

/** 覆盖行内语法、块结构、换行格式和重复内容的审计矩阵。 */
const MAPPING_AUDIT_CASES: readonly MappingAuditCase[] = [
  { name: 'plain paragraph', markdown: 'Prefix\n\nTARGET' },
  { name: 'leading blank line', markdown: '\nTARGET' },
  { name: 'three leading blank lines', markdown: '\n\n\nTARGET' },
  { name: 'three separating blank lines', markdown: 'Prefix\n\n\n\nTARGET' },
  { name: 'rules before target', markdown: 'Prefix\n\n---\n\n***\n\nTARGET' },
  { name: 'inline marks', markdown: 'Prefix\n\n**TARGET** *em* ~~del~~ [link](https://example.com) `code`' },
  { name: 'nested link strong', markdown: 'Prefix\n\n[**TARGET**](https://example.com)' },
  { name: 'nested strong link', markdown: 'Prefix\n\n**[TARGET](https://example.com)**' },
  { name: 'nested triple emphasis', markdown: 'Prefix\n\n***TARGET***' },
  { name: 'nested strike strong', markdown: 'Prefix\n\n~~**TARGET**~~' },
  { name: 'reference link', markdown: 'Prefix\n\n[TARGET][route]\n\n[route]: https://example.com' },
  { name: 'reference link in strong', markdown: 'Prefix\n\n**[TARGET][route]**\n\n[route]: https://example.com' },
  { name: 'reference link in heading strong', markdown: '# **[TARGET][route]**\n\n[route]: https://example.com' },
  { name: 'collapsed reference link', markdown: 'Prefix\n\n[TARGET][]\n\n[TARGET]: https://example.com' },
  { name: 'shortcut reference link', markdown: 'Prefix\n\n[TARGET]\n\n[TARGET]: https://example.com' },
  { name: 'autolink', markdown: 'Prefix\n\n<TARGET@example.com>' },
  { name: 'http autolink', markdown: 'Prefix\n\n<https://example.com/TARGET>' },
  { name: 'plain url autolink', markdown: 'Prefix\n\nhttps://example.com/TARGET' },
  { name: 'escaped punctuation', markdown: 'Prefix\n\n\\*TARGET\\*' },
  { name: 'html entity sibling', markdown: 'Prefix\n\nA &amp; TARGET' },
  { name: 'numeric html entity sibling', markdown: 'Prefix\n\nA &#169; TARGET' },
  { name: 'hex html entity sibling', markdown: 'Prefix\n\nA &#xA9; TARGET' },
  { name: 'copyright html entity sibling', markdown: 'Prefix\n\nA &copy; TARGET' },
  { name: 'less-than html entity sibling', markdown: 'Prefix\n\nA &lt; TARGET' },
  { name: 'quote html entity sibling', markdown: 'Prefix\n\nA &quot; TARGET' },
  { name: 'nbsp html entity sibling', markdown: 'Prefix\n\nA &nbsp; TARGET' },
  { name: 'codespan entity sibling', markdown: 'Prefix\n\n`&copy;` TARGET' },
  { name: 'inline math sibling', markdown: 'Prefix\n\n$x^2$ TARGET' },
  { name: 'inline html', markdown: 'Prefix\n\nBefore <span>TARGET</span>' },
  { name: 'safe inline html', markdown: 'Prefix\n\nBefore <kbd>TARGET</kbd>' },
  { name: 'safe nested inline html', markdown: 'Prefix\n\n<mark><u>TARGET</u></mark>' },
  { name: 'multiline safe inline html', markdown: 'Prefix\n\n<kbd>FIRST\nTARGET</kbd>' },
  { name: 'abbr inline html', markdown: 'Prefix\n\n<abbr title="target">TARGET</abbr>' },
  { name: 'inline html break', markdown: 'Prefix\n\nFIRST<br>TARGET' },
  { name: 'inline image sibling', markdown: 'Prefix\n\nBefore ![alt](https://example.com/image.png) TARGET' },
  { name: 'inline comment', markdown: 'Prefix\n\n[TARGET]{comment="note" id="audit"}' },
  { name: 'inline comment nested mark', markdown: 'Prefix\n\n[**TARGET**]{comment="note" id="audit"}' },
  { name: 'multiline explicit link', markdown: 'Prefix\n\n[FIRST\nTARGET](https://example.com)' },
  { name: 'multiline strong', markdown: 'Prefix\n\n**FIRST\nTARGET**' },
  { name: 'soft line break', markdown: 'Prefix\n\nFIRST\nTARGET' },
  { name: 'soft line nested marks', markdown: 'Prefix\n\nFIRST\n**[TARGET](https://example.com)**' },
  { name: 'hard line break spaces', markdown: 'Prefix\n\nFIRST  \nTARGET' },
  { name: 'hard line break slash', markdown: 'Prefix\n\nFIRST\\\nTARGET' },
  { name: 'hard break nested target', markdown: 'Prefix\n\nFIRST  \n**TARGET**' },
  { name: 'atx heading', markdown: 'Prefix\n\n# TARGET' },
  { name: 'setext heading', markdown: 'Prefix\n\nTARGET\n===' },
  { name: 'fenced code first line', markdown: 'Prefix\n\n```ts\nTARGET\n```' },
  { name: 'fenced code second line', markdown: 'Prefix\n\n```ts\nFIRST\nTARGET\n```' },
  { name: 'tilde fenced code', markdown: 'Prefix\n\n~~~ts\nTARGET\n~~~' },
  { name: 'long fenced code', markdown: 'Prefix\n\n````ts title\nTARGET\n````' },
  { name: 'fenced code blank first', markdown: 'Prefix\n\n```\n\nTARGET\n```' },
  { name: 'fenced code internal blank', markdown: 'Prefix\n\n```\nFIRST\n\nTARGET\n```' },
  { name: 'fenced code internal blanks', markdown: 'Prefix\n\n```\nFIRST\n\n\nTARGET\n```' },
  { name: 'indented fenced code', markdown: 'Prefix\n\n  ```ts\nFIRST\nTARGET\n  ```' },
  { name: 'unclosed fenced code', markdown: 'Prefix\n\n```ts\nFIRST\nTARGET' },
  { name: 'duplicate fenced code line', markdown: 'Prefix\n\n```\nTARGET\nTARGET\n```', occurrence: 2 },
  { name: 'indented code', markdown: 'Prefix\n\n    TARGET' },
  { name: 'blockquote', markdown: 'Prefix\n\n> FIRST\n> TARGET' },
  { name: 'blockquote separated paragraphs', markdown: 'Prefix\n\n> FIRST\n>\n> TARGET' },
  { name: 'blockquote continuation target', markdown: 'Prefix\n\n> FIRST\n> TARGET' },
  { name: 'blockquote nested list', markdown: 'Prefix\n\n> - FIRST\n> - TARGET' },
  { name: 'deep blockquote', markdown: 'Prefix\n\n> > FIRST\n> > TARGET' },
  {
    name: 'blockquote nested reference',
    markdown: 'Prefix\n\n> **[TARGET][route]**\n\n[route]: https://example.com'
  },
  { name: 'blockquote entity', markdown: 'Prefix\n\n> A &copy; TARGET' },
  { name: 'blockquote inline comment', markdown: 'Prefix\n\n> [**TARGET**]{comment="note" id="audit"}' },
  { name: 'blockquote html break', markdown: 'Prefix\n\n> FIRST<br>TARGET' },
  { name: 'blockquote fenced code', markdown: 'Prefix\n\n> ```ts\n> FIRST\n> TARGET\n> ```' },
  { name: 'blockquote table', markdown: 'Prefix\n\n> A | B\n> --- | ---\n> X | TARGET' },
  { name: 'bullet list', markdown: 'Prefix\n\n- FIRST\n- TARGET' },
  { name: 'nested bullet list', markdown: 'Prefix\n\n- FIRST\n  - TARGET' },
  { name: 'deep nested bullet list', markdown: 'Prefix\n\n- FIRST\n  - SECOND\n    - TARGET' },
  { name: 'loose bullet list', markdown: 'Prefix\n\n- FIRST\n\n- TARGET' },
  { name: 'list continuation', markdown: 'Prefix\n\n- FIRST\n  continuation\n- TARGET' },
  { name: 'list continuation target', markdown: 'Prefix\n\n- FIRST\n  TARGET' },
  { name: 'loose continuation target', markdown: 'Prefix\n\n- FIRST\n\n  TARGET' },
  { name: 'plus list', markdown: 'Prefix\n\n+ FIRST\n+ TARGET' },
  { name: 'ordered parenthesis list', markdown: 'Prefix\n\n10) FIRST\n11) TARGET' },
  { name: 'duplicate list item', markdown: 'Prefix\n\n- TARGET\n- TARGET', occurrence: 2 },
  {
    name: 'list nested reference',
    markdown: 'Prefix\n\n- **[TARGET][route]**\n\n[route]: https://example.com'
  },
  { name: 'list safe inline html', markdown: 'Prefix\n\n- <kbd>TARGET</kbd>' },
  { name: 'list inline image sibling', markdown: 'Prefix\n\n- ![alt](https://example.com/image.png) TARGET' },
  { name: 'list entity', markdown: 'Prefix\n\n- A &copy; TARGET' },
  { name: 'list inline comment', markdown: 'Prefix\n\n- [**TARGET**]{comment="note" id="audit"}' },
  { name: 'list hard break target', markdown: 'Prefix\n\n- FIRST  \n  TARGET' },
  { name: 'list fenced code', markdown: 'Prefix\n\n- FIRST\n\n  ```ts\n  TARGET\n  ```' },
  { name: 'list inline math sibling', markdown: 'Prefix\n\n- $x^2$ TARGET' },
  { name: 'ordered list', markdown: 'Prefix\n\n1. FIRST\n2. TARGET' },
  { name: 'task list', markdown: 'Prefix\n\n- [ ] FIRST\n- [x] TARGET' },
  { name: 'table body', markdown: 'Prefix\n\n| A | B |\n| --- | --- |\n| X | TARGET |' },
  { name: 'table header', markdown: 'TARGET | B\n--- | ---\nX | Y' },
  { name: 'table later row', markdown: 'A | B\n--- | ---\nX | Y\nTARGET | Z' },
  { name: 'table third column', markdown: 'A | B | C\n--- | --- | ---\nX | Y | TARGET' },
  { name: 'table inline marks', markdown: 'A | B\n--- | ---\nX | **TARGET**' },
  {
    name: 'table nested reference',
    markdown: 'A | B\n--- | ---\nX | **[TARGET][route]**\n\n[route]: https://example.com'
  },
  { name: 'table inline comment', markdown: 'A | B\n--- | ---\nX | [TARGET]{comment="note" id="audit"}' },
  { name: 'table entity', markdown: 'A | B\n--- | ---\nX | A &copy; TARGET' },
  { name: 'table html break', markdown: 'A | B\n--- | ---\nX | FIRST<br>TARGET' },
  { name: 'table inline image sibling', markdown: 'A | B\n--- | ---\nX | ![alt](https://example.com/image.png) TARGET' },
  { name: 'table escaped pipe', markdown: 'A | B\n--- | ---\nX | before \\| TARGET' },
  { name: 'table crlf', markdown: 'A | B\r\n--- | ---\r\nX | TARGET' },
  { name: 'html block', markdown: 'Prefix\n\n<div>\nTARGET\n</div>' },
  { name: 'script html block', markdown: 'Prefix\n\n<script>\nTARGET\n</script>' },
  { name: 'html comment before target', markdown: '<!-- note -->\n\nTARGET' },
  { name: 'front matter before target', markdown: '---\ntitle: Audit\n---\n\nTARGET' },
  { name: 'front matter crlf', markdown: '---\r\ntitle: Audit\r\n---\r\n\r\nTARGET' },
  { name: 'link definition target', markdown: '[TARGET]: https://example.com' },
  { name: 'crlf multiline paragraph', markdown: 'Prefix\r\n\r\nFIRST\r\nTARGET' },
  { name: 'crlf fenced code', markdown: 'Prefix\r\n\r\n```ts\r\nTARGET\r\n```' },
  { name: 'duplicate second paragraph', markdown: 'TARGET\n\nTARGET', occurrence: 2 }
];

/**
 * 将 Rich JSON 转换为 ProseMirror 文档。
 * @param json - Rich 解析 JSON
 * @param editorInstanceId - 编辑器实例 ID
 * @returns ProseMirror 文档
 */
function createRichDoc(json: JSONContent, editorInstanceId: string): PMNode {
  const tracker = createSourceLineTracker();
  const schemaExtensions = createRichMarkdownSchemaExtensions(editorInstanceId, tracker);
  const schema = getSchema([...schemaExtensions.extensions, InlineCommentMark]);

  return schema.nodeFromJSON(json);
}

/**
 * 查找第 N 个目标文本节点选区。
 * @param doc - ProseMirror 文档
 * @param text - 目标文本
 * @param occurrence - 目标序号（1-based）
 * @returns ProseMirror 选区
 */
function findSelection(doc: PMNode, text: string, occurrence: number): { from: number; to: number } {
  let currentOccurrence = 0;
  let selection: { from: number; to: number } | null = null;

  doc.descendants((node: PMNode, pos: number): boolean => {
    if (!node.isText || typeof node.text !== 'string') return true;

    let searchOffset = 0;
    let textOffset = node.text.indexOf(text, searchOffset);
    while (textOffset >= 0) {
      currentOccurrence += 1;
      if (currentOccurrence === occurrence) {
        selection = { from: pos + textOffset, to: pos + textOffset + text.length };
        return false;
      }
      searchOffset = textOffset + text.length;
      textOffset = node.text.indexOf(text, searchOffset);
    }

    return true;
  });

  if (!selection) throw new Error(`Text occurrence not found: ${text}#${occurrence}`);
  return selection;
}

/**
 * 获取源码中第 N 个目标文本的物理行号。
 * @param markdown - Markdown 源码
 * @param text - 目标文本
 * @param occurrence - 目标序号（1-based）
 * @returns 1-based 物理行号
 */
function getExpectedLine(markdown: string, text: string, occurrence: number): number {
  let currentOccurrence = 0;
  let searchOffset = 0;
  let textOffset = markdown.indexOf(text, searchOffset);

  while (textOffset >= 0) {
    currentOccurrence += 1;
    if (currentOccurrence === occurrence) {
      return markdown.slice(0, textOffset).split(/\r?\n/).length;
    }
    searchOffset = textOffset + text.length;
    textOffset = markdown.indexOf(text, searchOffset);
  }

  throw new Error(`Source occurrence not found: ${text}#${occurrence}`);
}

describe('source line audit matrix', (): void => {
  it.each(MAPPING_AUDIT_CASES)('forward: $name', async ({ name, markdown, occurrence = 1 }: MappingAuditCase): Promise<void> => {
    const editorInstanceId = `source-line-audit-${name.replace(/\s+/g, '-')}`;
    const { json } = await parseMarkdownForRichLoad(markdown, editorInstanceId, '1');
    const doc = createRichDoc(json, editorInstanceId);
    const selection = findSelection(doc, 'TARGET', occurrence);
    const expectedLine = getExpectedLine(markdown, 'TARGET', occurrence);

    expect(getSelectionSourceLineRangeFromMarkdown(doc, selection.from, selection.to, markdown)).toEqual({
      startLine: expectedLine,
      endLine: expectedLine
    });
  });

  it.each(MAPPING_AUDIT_CASES)('reverse: $name', async ({ name, markdown, occurrence = 1 }: MappingAuditCase): Promise<void> => {
    const editorInstanceId = `source-line-reverse-audit-${name.replace(/\s+/g, '-')}`;
    const { json } = await parseMarkdownForRichLoad(markdown, editorInstanceId, '1');
    const doc = createRichDoc(json, editorInstanceId);
    const expectedLine = getExpectedLine(markdown, 'TARGET', occurrence);
    const mappedRange = mapSourceLineRangeToProseMirrorRange(doc, expectedLine, expectedLine, markdown);

    expect(mappedRange).not.toBeNull();
    if (!mappedRange) return;

    expect(doc.textBetween(mappedRange.from, mappedRange.to, '\n', '\n')).toContain('TARGET');
    expect(mappedRange.exact).toBe(true);
  });
});
