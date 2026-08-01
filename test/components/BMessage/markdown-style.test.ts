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
    expect(style).toMatch(/li:has\(>\s*input\[type='checkbox'\]\)\s*>\s*table[\s\S]*\{[\s\S]*grid-column:\s*2;/);
    expect(style).toMatch(/li:has\(>\s*input\[type='checkbox'\]\)\s*>\s*hr[\s\S]*\{[\s\S]*grid-column:\s*2;/);
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
