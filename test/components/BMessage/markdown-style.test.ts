/**
 * @file markdown-style.test.ts
 * @description BMessage Markdown 基础样式测试。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 读取 Markdown 基础样式源码。
 * @returns Markdown Less 样式源码
 */
function readMarkdownStyle(): string {
  return readFileSync(new URL('../../../src/assets/styles/markdown.less', import.meta.url), 'utf8');
}

/**
 * 读取 BMessage 代码块组件源码。
 * @returns CodeBlockNode Vue 源码
 */
function readCodeBlockNodeSource(): string {
  return readFileSync(new URL('../../../src/components/BMessage/components/CodeBlockNode.vue', import.meta.url), 'utf8');
}

/**
 * 读取 BMessage 组件源码。
 * @returns BMessage Vue 源码
 */
function readMessageSource(): string {
  return readFileSync(new URL('../../../src/components/BMessage/index.vue', import.meta.url), 'utf8');
}

/**
 * 提取指定选择器的首个样式块内容。
 * @param source - 样式源码
 * @param selector - CSS 选择器
 * @returns 样式块内容
 */
function extractRuleBlock(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);

  return match?.[1] ?? '';
}

describe('BMessage markdown style', () => {
  it('restores unordered and ordered list markers after global normalize reset', (): void => {
    const style = readMarkdownStyle();

    expect(style).toMatch(/ul\s*>\s*li\s*\{[\s\S]*list-style:\s*disc;/);
    expect(style).toMatch(/ol\s*>\s*li\s*\{[\s\S]*list-style:\s*decimal;/);
    expect(style).toMatch(/ul\s+ul\s*>\s*li\s*\{[\s\S]*list-style:\s*circle;/);
    expect(style).toMatch(/ol\s+ol\s*>\s*li\s*\{[\s\S]*list-style:\s*lower-alpha;/);
  });

  it('uses proportional numerals for generated list markers', (): void => {
    const style = readMarkdownStyle();

    expect(style).toMatch(/&::marker\s*\{[\s\S]*font-variant-numeric:\s*proportional-nums;/);
  });

  it('keeps task list checkboxes visible after global input reset', (): void => {
    const style = readMarkdownStyle();

    expect(style).toMatch(/li:has\(>\s*input\[type='checkbox'\]\)\s*\{[\s\S]*list-style:\s*none;/);
    expect(style).toMatch(/li:has\(>\s*input\[type='checkbox'\]\)\s*\{[\s\S]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\);/);
    expect(style).toMatch(/li\s*>\s*input\[type='checkbox'\]\s*\{[\s\S]*width:\s*1em;/);
    expect(style).toMatch(/li\s*>\s*input\[type='checkbox'\]\s*\{[\s\S]*accent-color:\s*var\(--color-primary\);/);
    expect(style).toMatch(/li:has\(>\s*input\[type='checkbox'\]\)\s*>\s*p\s*\{[\s\S]*grid-column:\s*2;/);
  });

  it('keeps task list block children in the content column', (): void => {
    const style = readMarkdownStyle();

    expect(style).toMatch(/li:has\(>\s*input\[type='checkbox'\]\)\s*>\s*\.b-message__code-block[\s\S]*\{[\s\S]*grid-column:\s*2;/);
    expect(style).toMatch(/li:has\(>\s*input\[type='checkbox'\]\)\s*>\s*blockquote[\s\S]*\{[\s\S]*grid-column:\s*2;/);
    expect(style).toMatch(/li:has\(>\s*input\[type='checkbox'\]\)\s*>\s*\.b-message__table-scroller[\s\S]*\{[\s\S]*grid-column:\s*2;/);
    expect(style).toMatch(/li:has\(>\s*input\[type='checkbox'\]\)\s*>\s*hr[\s\S]*\{[\s\S]*grid-column:\s*2;/);
  });

  it('bounds markdown table overflow inside the message width', (): void => {
    const source = readMessageSource();
    const scrollerRule = extractRuleBlock(source, '.b-message__table-scroller');
    const tableRule = extractRuleBlock(source, '.b-message__table-scroller > table');

    expect(scrollerRule).toMatch(/container-type:\s*inline-size;/);
    expect(scrollerRule).toMatch(/max-width:\s*100%;/);
    expect(scrollerRule).toMatch(/overflow-x:\s*auto;/);
    expect(tableRule).toMatch(/width:\s*max-content;/);
    expect(tableRule).toMatch(/min-width:\s*100%;/);
    expect(tableRule).toMatch(/margin:\s*0;/);
  });

  it('limits wide table cell content by the table container width', (): void => {
    const source = readMessageSource();
    const cellContentRule = extractRuleBlock(source, '.b-message__table-cell-content');

    expect(cellContentRule).toMatch(/max-width:\s*60cqw;/);
    expect(cellContentRule).toMatch(/overflow-wrap:\s*anywhere;/);
  });

  it('keeps the table copy button sticky and centered in the header row', (): void => {
    const source = readMessageSource();
    const toolbarRule = extractRuleBlock(source, '.b-message__table-toolbar');
    const copyRule = extractRuleBlock(source, '.b-message__table-copy');

    expect(toolbarRule).toMatch(/position:\s*sticky;/);
    expect(toolbarRule).toMatch(/left:\s*0;/);
    expect(toolbarRule).toMatch(/display:\s*flex;/);
    expect(toolbarRule).toMatch(/justify-content:\s*flex-end;/);
    expect(toolbarRule).toMatch(/width:\s*100%;/);
    expect(toolbarRule).toMatch(/height:\s*0;/);
    expect(copyRule).not.toMatch(/position:\s*absolute;/);
    expect(copyRule).toMatch(/margin:\s*4px\s+8px\s+0\s+0;/);
    expect(copyRule).toMatch(/pointer-events:\s*auto;/);
  });

  it('uses a single scroll container for BMessage code blocks', (): void => {
    const source = readCodeBlockNodeSource();
    const preRule = extractRuleBlock(source, '.b-message__code-pre');
    const codeRule = extractRuleBlock(source, '.b-message__code-content');

    expect(preRule).toMatch(/overflow:\s*auto;/);
    expect(codeRule).not.toMatch(/overflow-x:\s*auto;/);
  });

  it('covers common lowlight token scopes used by skill previews', (): void => {
    const style = readMarkdownStyle();
    const requiredScopes = [
      'hljs-addition',
      'hljs-attribute',
      'hljs-deletion',
      'hljs-literal',
      'hljs-meta',
      'hljs-punctuation',
      'hljs-selector-class',
      'hljs-symbol',
      'hljs-type'
    ];

    requiredScopes.forEach((scope: string): void => {
      expect(style).toContain(`.${scope}`);
    });
  });
});
