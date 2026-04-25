/**
 * @file ai-selection-highlight-regression.test.ts
 * @description 富文本编辑器 AI 选区高亮回归测试。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * 读取源码文件。
 * @param relativePath - 相对仓库根目录的源码路径
 * @returns 源码文本内容
 */
function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf-8');
}

describe('PaneRichEditor AI selection highlight regression', () => {
  test('renders custom selection highlight while hiding native browser selection painting', () => {
    const paneRichEditorSource = readSource('src/components/BEditor/components/PaneRichEditor.vue');

    expect(paneRichEditorSource).toContain('.ai-selection-highlight');
    expect(paneRichEditorSource).toContain('background: var(--selection-bg);');
    expect(paneRichEditorSource).not.toContain('.ai-selection-highlight {\n      color: var(--selection-color);');
    expect(paneRichEditorSource).toContain('&::selection {');
    expect(paneRichEditorSource).toContain('background: transparent;');
    expect(paneRichEditorSource).not.toContain('&::selection {\n      color: transparent;');
    expect(paneRichEditorSource).not.toContain('padding: 0.32em 0;');
    expect(paneRichEditorSource).not.toContain('vertical-align: middle;');
  });

  test('binds editor selection lifecycle to custom highlight updates instead of relying on native selection paint', () => {
    const paneRichEditorSource = readSource('src/components/BEditor/components/PaneRichEditor.vue');
    const selectionHighlightSource = readSource('src/components/BEditor/extensions/AISelectionHighlight.ts');

    expect(paneRichEditorSource).toContain("editor.on('selectionUpdate', syncSelectionHighlight);");
    expect(paneRichEditorSource).toContain("editor.on('focus', syncSelectionHighlight);");
    expect(paneRichEditorSource).toContain("editor.on('blur', syncSelectionHighlight);");
    expect(paneRichEditorSource).toContain('function syncSelectionHighlight(): void {');
    expect(paneRichEditorSource).not.toContain("editor.on('transaction', syncSelectionHighlight);");
    expect(paneRichEditorSource).toContain('watch(aiInputVisible, (isVisible) => {');
    expect(paneRichEditorSource).not.toContain('() => [aiInputVisible.value, selectionRange.value.from, selectionRange.value.to]');
    expect(selectionHighlightSource).toContain('function isSameRange(');
    expect(selectionHighlightSource).toContain('if (isSameRange(currentRange, range)) {');
    expect(selectionHighlightSource).toContain('if (!currentRange) {');
    expect(paneRichEditorSource).not.toContain('requestAnimationFrame(() => {');
  });
});
