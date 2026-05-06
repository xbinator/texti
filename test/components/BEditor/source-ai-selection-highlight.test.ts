/**
 * @file source-ai-selection-highlight.test.ts
 * @description Source 编辑器 AI 选区高亮样式回归测试。
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

describe('PaneSourceEditor AI selection highlight regression', () => {
  test('forces markdown syntax tokens inside AI selection highlight to use selection foreground color', (): void => {
    const sourceEditorPaneSource = readSource('src/components/BEditor/components/PaneSourceEditor.vue');

    expect(sourceEditorPaneSource).toContain('.source-ai-selection-highlight');
    expect(sourceEditorPaneSource).toContain('color: var(--selection-color);');
    expect(sourceEditorPaneSource).toContain('& *');
    expect(sourceEditorPaneSource).toContain('color: var(--selection-color) !important;');
  });
});
