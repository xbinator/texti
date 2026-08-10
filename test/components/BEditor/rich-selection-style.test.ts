/**
 * @file rich-selection-style.test.ts
 * @description BEditor Rich 模式选区高亮样式回归测试。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 读取 Rich 编辑器面板源码。
 * @returns PaneRichEditor.vue 文件内容
 */
function readPaneRichEditorSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/components/BEditor/panes/PaneRichEditor.vue'), 'utf8');
}

/**
 * 从源码中提取指定 CSS 规则内容。
 * @param source - Vue 组件源码
 * @param selector - CSS 选择器
 * @returns 样式规则内容，未命中时为空字符串
 */
function extractStyleRuleBody(source: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`${escapedSelector}\\s*\\{(?<body>[\\s\\S]*?)\\n\\s*\\}`).exec(source);
  return rule?.groups?.body ?? '';
}

describe('BEditor rich selection styles', (): void => {
  it('keeps inline code base padding so AI selection highlight has visual breathing room', (): void => {
    const source = readPaneRichEditorSource();
    // 行内 code 的视觉边距由基础 `code { padding: 0.125em 0.25em; }` 兜底；
    // AI 选区高亮不再为 `--code-start` / `--code-end` 单独写 margin/padding 覆盖。
    const inlineCodeRuleBody = extractStyleRuleBody(source, ':not(pre) > code');

    // `:not(pre) > code` 块不应再追加任何 AI 选区高亮的 margin/padding 调整
    expect(inlineCodeRuleBody).not.toMatch(/margin-(?:left|right):\s*-0\.25em;/);
    expect(inlineCodeRuleBody).not.toMatch(/padding-(?:left|right):\s*0\.25em;/);
    // 但需要保留基础 `code` 规则的 padding，给 AI 选区高亮提供视觉呼吸
    expect(source).toContain('padding: 0.125em 0.25em;');
  });

  it('resets box-shadow on inline code selection highlight instead of painting zero-value double bands', (): void => {
    const source = readPaneRichEditorSource();
    // 行内 code 内的 AI 选区高亮需要重置 box-shadow，避免与父级规则的 0.2em 阴影条叠加
    // 源码用 Less 嵌套语法，`:not(pre) > code` 块内嵌 `.ai-selection-highlight` 子规则
    const inlineCodeRuleBody = extractStyleRuleBody(source, ':not(pre) > code');

    expect(inlineCodeRuleBody).toContain('vertical-align: baseline;');
    expect(inlineCodeRuleBody).toContain('box-shadow: none;');
    // 防止回归到冗余的 `0 0 0 0 X, 0 0 0 0 Y` 双阴影写法
    expect(inlineCodeRuleBody).not.toMatch(/box-shadow:\s*0\s+0\s+0\s+0[^,;]*,\s*0\s+0\s+0\s+0/);
  });

  it('renders table container selection as a filled table state instead of an outline ring', (): void => {
    const source = readPaneRichEditorSource();
    const tableRuleBody = extractStyleRuleBody(source, '.b-markdown-table.ai-selection-highlight');
    const tableHeaderRuleBody = extractStyleRuleBody(source, '.b-markdown-table.ai-selection-highlight th');
    const tableCellRuleBody = extractStyleRuleBody(source, '.b-markdown-table.ai-selection-highlight td');

    expect(tableRuleBody).toContain('box-shadow: none;');
    expect(tableRuleBody).toContain('background: transparent;');
    expect(tableRuleBody).not.toContain('outline:');
    expect(tableHeaderRuleBody).toContain('background: var(--editor-table-selection-header-bg);');
    expect(tableCellRuleBody).toContain('background: var(--editor-table-selection-cell-bg);');
  });

  it('uses the same table selection colors for drag cell selections and container selections', (): void => {
    const source = readPaneRichEditorSource();

    expect(source).toContain('--editor-table-selection-header-bg:');
    expect(source).toContain('--editor-table-selection-cell-bg:');
    expect(source).toContain('--editor-table-selection-header-bg: color-mix(in srgb, var(--color-primary-bg-hover) 88%, var(--editor-table-header-bg));');
    expect(source).toContain('--editor-table-selection-cell-bg: color-mix(in srgb, var(--color-primary-bg-hover) 74%, var(--bg-primary));');
    expect(source).toContain('background: var(--editor-table-selection-header-bg);');
    expect(source).toContain('background: var(--editor-table-selection-cell-bg);');
  });

  it('keeps table cell paragraphs wrappable', (): void => {
    const source = readPaneRichEditorSource();
    const tableParagraphRuleBody = extractStyleRuleBody(source, 'th p,\n  td p');

    expect(tableParagraphRuleBody).not.toContain('white-space: nowrap;');
  });

  it('keeps table inline custom highlight styles out of the compiled Less pipeline', (): void => {
    const source = readPaneRichEditorSource();

    expect(source).not.toContain('::highlight(b-markdown-ai-selection-highlight)');
  });

  it('positions table gap cursor as a vertical caret at the previous table end', (): void => {
    const source = readPaneRichEditorSource();
    const tableGapCursorRuleBody = extractStyleRuleBody(source, '.b-markdown-table + .ProseMirror-gapcursor');
    const tableGapCursorLineRuleBody = extractStyleRuleBody(source, '.b-markdown-table + .ProseMirror-gapcursor::after');

    expect(tableGapCursorRuleBody).toContain('position: relative;');
    expect(tableGapCursorRuleBody).toContain('height: 0;');
    expect(tableGapCursorLineRuleBody).toContain('top: -2em;');
    expect(tableGapCursorLineRuleBody).toContain('left: 100%;');
    expect(tableGapCursorLineRuleBody).not.toContain('left: 0;');
    expect(tableGapCursorLineRuleBody).toContain('width: 0;');
    expect(tableGapCursorLineRuleBody).toContain('height: 1.4em;');
    expect(tableGapCursorLineRuleBody).not.toContain('width: 100%;');
    expect(tableGapCursorLineRuleBody).toContain('border-left: 1px solid var(--editor-caret);');
    expect(tableGapCursorLineRuleBody).toContain('border-top: 0;');
  });
});
