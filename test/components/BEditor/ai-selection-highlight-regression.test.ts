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
    const richEditorContentSource = readSource('src/components/BEditor/components/RichEditorContent.vue');

    expect(richEditorContentSource).toContain('.ai-selection-highlight');
    expect(richEditorContentSource).toContain('color: var(--selection-color);');
    expect(richEditorContentSource).toContain('background: var(--selection-bg);');
    expect(richEditorContentSource).toContain('&::selection {');
    expect(richEditorContentSource).toContain('*::selection {');
    expect(richEditorContentSource).toContain('background: transparent;');
    expect(richEditorContentSource).not.toMatch(/::selection\s*\{\s*color:\s*transparent;/);
    expect(richEditorContentSource).not.toContain('padding: 0.32em 0;');
    expect(richEditorContentSource).not.toContain('vertical-align: middle;');
  });

  test('binds editor selection lifecycle to custom highlight updates instead of relying on native selection paint', () => {
    const richEditorContentSource = readSource('src/components/BEditor/components/RichEditorContent.vue');
    const selectionHighlightSource = readSource('src/components/BEditor/extensions/AISelectionHighlight.ts');

    expect(richEditorContentSource).toContain("editor.on('selectionUpdate', syncSelectionHighlight);");
    expect(richEditorContentSource).toContain("editor.on('focus', syncSelectionHighlight);");
    expect(richEditorContentSource).toContain("editor.on('blur', syncSelectionHighlight);");
    expect(richEditorContentSource).toContain('function syncSelectionHighlight(): void {');
    expect(richEditorContentSource).toContain('function bindSelectionHighlight(editor: Editor | null | undefined): (() => void) | undefined {');
    expect(richEditorContentSource).not.toContain("editor.on('transaction', syncSelectionHighlight);");
    expect(richEditorContentSource).toContain('watch(aiInputVisible, (isVisible) => {');
    expect(richEditorContentSource).not.toContain('() => [aiInputVisible.value, selectionRange.value.from, selectionRange.value.to]');
    expect(selectionHighlightSource).toContain('function isSameRange(');
    expect(selectionHighlightSource).toContain('if (isSameRange(currentRange, range)) return;');
    expect(selectionHighlightSource).toContain('if (!currentRange) return;');
    expect(richEditorContentSource).not.toContain('requestAnimationFrame(() => {');
  });
});
