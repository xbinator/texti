/**
 * @file source-line-mapping.test.ts
 * @description BEditor Rich/Markdown 源码行号映射回归测试。
 */
import type { JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { getSchema } from '@tiptap/core';
import { Schema } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import {
  captureSourceLineRange,
  createSourceLineTracker,
  getSelectionSourceLineRange,
  getSelectionSourceLineRangeFromMarkdown,
  mapSourceLineRangeToProseMirrorRange
} from '@/components/BEditor/adapters/sourceLineMapping';
import { createRichMarkdownSchemaExtensions } from '@/components/BEditor/hooks/useExtensions';
import { parseMarkdownForRichLoad } from '@/components/BEditor/utils/richMarkdownParser';

/**
 * 命中的块节点位置信息。
 */
interface BlockPosition {
  /** ProseMirror 块节点。 */
  node: PMNode;
  /** 块节点在文档中的起始位置。 */
  pos: number;
}

/**
 * 创建用于源码行号映射测试的最小 ProseMirror schema。
 * @returns ProseMirror schema
 */
function createMappingSchema(): Schema {
  return new Schema({
    nodes: {
      doc: { content: 'block+' },
      heading: {
        content: 'text*',
        group: 'block',
        attrs: {
          level: { default: 1 },
          sourceLineStart: { default: null },
          sourceLineEnd: { default: null }
        }
      },
      text: { group: 'inline' }
    },
    marks: {}
  });
}

/**
 * 创建一个 rich 文档：Markdown 中 mixed list 被合并/省略为非目标块，而目标标题保留真实 attrs 行号。
 * @returns ProseMirror 文档节点
 */
function createMismatchedDoc(): PMNode {
  const schema = createMappingSchema();
  const beforeHeading = schema.nodes.heading.create({ level: 1, sourceLineStart: 1, sourceLineEnd: 1 }, schema.text('Before'));
  const codeHeading = schema.nodes.heading.create({ level: 2, sourceLineStart: 8, sourceLineEnd: 8 }, schema.text('Code'));

  return schema.node('doc', null, [beforeHeading, codeHeading]);
}

/**
 * 创建带有过期 attrs 行号的 Rich 文档，模拟 Markdown 精确 token 未对齐时的危险回退。
 * @returns 第二个标题 attrs 错误指向源码第 3 行的文档
 */
function createStaleLineDoc(): PMNode {
  const schema = createMappingSchema();
  const beforeHeading = schema.nodes.heading.create({ level: 1, sourceLineStart: 1, sourceLineEnd: 1 }, schema.text('Before'));
  const codeHeading = schema.nodes.heading.create({ level: 2, sourceLineStart: 3, sourceLineEnd: 3 }, schema.text('Code'));

  return schema.node('doc', null, [beforeHeading, codeHeading]);
}

/**
 * 创建会让 marked 顶层 token 数多于测试 rich 文档块数的 Markdown。
 * @returns Markdown 源码
 */
function createMismatchedMarkdown(): string {
  return ['# Before', '', '1. 第一步', '  - 注意事项 A', '  - 注意事项 B', '2. 第二步', '', '## Code'].join('\n');
}

/**
 * 创建会触发真实 rich parser 顶层 token/block 数量不一致的 Markdown。
 * @returns Markdown 源码
 */
function createParserMismatchedMarkdown(): string {
  return [
    '# Before',
    '',
    '### 4.3 混合嵌套',
    '',
    '1. 第一步',
    '  - 注意事项 A',
    '  - 注意事项 B',
    '2. 第二步',
    '  - 注意事项 C',
    '  1. 子步骤 i',
    '  2. 子步骤 ii',
    '',
    '---',
    '',
    '## Code'
  ].join('\n');
}
/**
 * 创建任务列表后接代码块的 Markdown，用于覆盖按行跳转误选后续代码块的问题。
 * @returns Markdown 源码
 */
function createTaskListBeforeCodeMarkdown(): string {
  return [
    '# Before',
    '',
    '### 4.3 混合嵌套',
    '',
    '1. 第一步',
    '  - 注意事项 A',
    '  - 注意事项 B',
    '2. 第二步',
    '  - 注意事项 C',
    '  1. 子步骤 i',
    '  2. 子步骤 ii',
    '',
    '---',
    '',
    '## Tasks',
    '',
    '- [x] 已完成任务',
    '- [x] 第二项已完成',
    '- [x] 未完成任务',
    '- [ ] 另一项待办',
    '  - [x] 嵌套已完成',
    '  - [ ] 嵌套未完成',
    '',
    '---',
    '',
    '## Code',
    '',
    '```json',
    '{',
    '  "active": true',
    '}',
    '```'
  ].join('\n');
}

/**
 * 创建包含 98 行前缀以及跨行内联语法段落的 Markdown。
 * 目标段落首行固定为第 99 行，用于复现 Rich 文本去除 Markdown 标记后无法与源码 token 对齐的问题。
 * @returns 行内语法映射回归测试 Markdown
 */
function createInlineSyntaxMarkdown(): string {
  const prefixLines = Array.from({ length: 49 }, (_value, index): string[] => [`## 分段 ${index + 1}`, '']).flat();

  return [
    ...prefixLines,
    '已生成**行程地图**（[高德](https://ditu.amap.com)）：',
    '`amapuri://workInAmap/createWithToken?polymericId=source-line-regression&from=MCP`'
  ].join('\n');
}

/**
 * 将 rich parser JSON 转为 ProseMirror 文档节点。
 * @param json - rich parser 输出 JSON
 * @param editorInstanceId - 编辑器实例 ID
 * @returns ProseMirror 文档节点
 */
function createRichDoc(json: JSONContent, editorInstanceId: string): PMNode {
  const sourceLineTracker = createSourceLineTracker();
  const schemaExtensions = createRichMarkdownSchemaExtensions(editorInstanceId, sourceLineTracker);
  const schema = getSchema(schemaExtensions.extensions);

  return schema.nodeFromJSON(json);
}

/**
 * 按文本内容查找块节点位置。
 * @param doc - ProseMirror 文档节点
 * @param text - 目标块文本
 * @returns 块节点位置
 */
function findBlockPosition(doc: PMNode, text: string): BlockPosition {
  let matched: BlockPosition | null = null;

  doc.descendants((node: PMNode, pos: number): boolean => {
    if (matched) {
      return false;
    }

    if (node.isBlock && node.textContent === text) {
      matched = { node, pos };
      return false;
    }

    return true;
  });

  if (!matched) {
    throw new Error(`Block not found: ${text}`);
  }

  return matched;
}

/**
 * 计算整块文本的 ProseMirror 选区范围。
 * @param blockPosition - 块节点位置信息
 * @returns 选区起止位置
 */
function getWholeBlockSelection(blockPosition: BlockPosition): { from: number; to: number } {
  const from = blockPosition.pos + 1;
  const to = from + blockPosition.node.textContent.length;

  return { from, to };
}

/**
 * 按渲染文本查找块内 ProseMirror 选区。
 * @param doc - ProseMirror 文档节点
 * @param text - 目标渲染文本
 * @returns 目标文本的选区起止位置
 */
function findTextSelection(doc: PMNode, text: string): { from: number; to: number } {
  let selection: { from: number; to: number } | null = null;

  doc.descendants((node: PMNode, pos: number): boolean => {
    if (!node.isBlock) {
      return true;
    }

    const textOffset = node.textContent.indexOf(text);
    if (textOffset < 0) {
      return true;
    }

    selection = {
      from: pos + 1 + textOffset,
      to: pos + 1 + textOffset + text.length
    };
    return false;
  });

  if (!selection) {
    throw new Error(`Text not found: ${text}`);
  }

  return selection;
}

describe('source line mapping', (): void => {
  it('counts CRLF as one physical newline when capturing node attributes', (): void => {
    const tracker = createSourceLineTracker();

    expect(captureSourceLineRange(tracker, 'FIRST\r\nTARGET')).toEqual({ startLine: 1, endLine: 2 });
    expect(tracker.currentLine).toBe(3);
  });

  it('aligns matching top-level Markdown tokens even when earlier mixed lists split', (): void => {
    const doc = createMismatchedDoc();
    const markdown = createMismatchedMarkdown();
    const selection = getWholeBlockSelection(findBlockPosition(doc, 'Code'));
    const markdownRange = getSelectionSourceLineRangeFromMarkdown(doc, selection.from, selection.to, markdown);
    const fallbackRange = markdownRange || getSelectionSourceLineRange(doc, selection.from, selection.to);

    expect(markdownRange).toEqual({ startLine: 8, endLine: 8 });
    expect(fallbackRange).toEqual({ startLine: 8, endLine: 8 });
  });

  it('does not reverse-map an unmatched Markdown token line onto a later rich block', (): void => {
    const doc = createMismatchedDoc();
    const markdown = createMismatchedMarkdown();
    const mappedRange = mapSourceLineRangeToProseMirrorRange(doc, 3, 3, markdown);

    expect(mappedRange).toBeNull();
  });

  it('does not reverse-map through stale attrs when non-empty Markdown is available', (): void => {
    const mappedRange = mapSourceLineRangeToProseMirrorRange(createStaleLineDoc(), 3, 3, createMismatchedMarkdown());

    expect(mappedRange).toBeNull();
  });

  it('does not reverse-map a Markdown blank line onto a visible Rich block', async (): Promise<void> => {
    const markdown = 'FIRST\n\nTARGET';
    const editorInstanceId = 'source-line-blank-reverse-test';
    const { json } = await parseMarkdownForRichLoad(markdown, editorInstanceId, '1');
    const doc = createRichDoc(json, editorInstanceId);

    expect(mapSourceLineRangeToProseMirrorRange(doc, 2, 2, markdown)).toBeNull();
  });

  it('reverse-maps matched Markdown tokens after skipped list tokens', (): void => {
    const doc = createMismatchedDoc();
    const markdown = createMismatchedMarkdown();
    const selection = getWholeBlockSelection(findBlockPosition(doc, 'Code'));
    const mappedRange = mapSourceLineRangeToProseMirrorRange(doc, 8, 8, markdown);

    expect(mappedRange).toEqual({
      from: selection.from,
      to: selection.to,
      exact: true
    });
  });

  it('keeps rich parser selection references on the real source line after mixed list token splits', async (): Promise<void> => {
    const markdown = createParserMismatchedMarkdown();
    const editorInstanceId = 'source-line-rich-parser-test';
    const { json } = await parseMarkdownForRichLoad(markdown, editorInstanceId, '1');
    const doc = createRichDoc(json, editorInstanceId);
    const selection = getWholeBlockSelection(findBlockPosition(doc, 'Code'));
    const markdownRange = getSelectionSourceLineRangeFromMarkdown(doc, selection.from, selection.to, markdown);
    const fallbackRange = markdownRange || getSelectionSourceLineRange(doc, selection.from, selection.to);

    expect(fallbackRange).toEqual({ startLine: 15, endLine: 15 });
  });

  it('maps rendered inline Markdown text to its physical source line', async (): Promise<void> => {
    const markdown = createInlineSyntaxMarkdown();
    const editorInstanceId = 'source-line-inline-syntax-test';
    const { json } = await parseMarkdownForRichLoad(markdown, editorInstanceId, '1');
    const doc = createRichDoc(json, editorInstanceId);
    const selection = findTextSelection(doc, '已生成行程地图（高德）：');
    const markdownRange = getSelectionSourceLineRangeFromMarkdown(doc, selection.from, selection.to, markdown);

    expect(markdownRange).toEqual({ startLine: 99, endLine: 99 });
  });

  it('reverse-maps task list snippets before code blocks to the clicked source lines', async (): Promise<void> => {
    const markdown = createTaskListBeforeCodeMarkdown();
    const editorInstanceId = 'source-line-task-list-test';
    const { json } = await parseMarkdownForRichLoad(markdown, editorInstanceId, '1');
    const doc = createRichDoc(json, editorInstanceId);
    const mappedRange = mapSourceLineRangeToProseMirrorRange(doc, 18, 22, markdown);
    const mappedText = mappedRange ? doc.textBetween(mappedRange.from, mappedRange.to, '\n', '\n') : '';
    const reverseRange = mappedRange ? getSelectionSourceLineRangeFromMarkdown(doc, mappedRange.from, mappedRange.to, markdown) : null;

    expect(mappedRange?.exact).toBe(true);
    expect(mappedText).toBe('第二项已完成\n未完成任务\n另一项待办\n嵌套已完成\n嵌套未完成');
    expect(mappedText).not.toContain('active');
    expect(reverseRange).toEqual({ startLine: 18, endLine: 22 });
  });
});
