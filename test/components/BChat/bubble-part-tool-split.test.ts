/**
 * @file bubble-part-tool-split.test.ts
 * @description 验证 BubblePartTool 公共入口通过拆分后的模块承担工具展示编排。
 * @vitest-environment jsdom
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, it } from 'vitest';

const TOOL_DIR = 'src/components/BChat/components/MessageBubble/BubblePartTool';

/**
 * 读取工具气泡目录中的源码文件。
 * @param fileName - 目录内文件名
 * @returns 文件源码
 */
function readToolSource(fileName: string): string {
  return readFileSync(resolvePath(process.cwd(), TOOL_DIR, fileName), 'utf8');
}

/**
 * 判断工具气泡目录内的文件是否存在。
 * @param fileName - 目录内文件名
 * @returns 文件存在时返回 true
 */
function hasToolFile(fileName: string): boolean {
  return existsSync(resolvePath(process.cwd(), TOOL_DIR, fileName));
}

describe('BubblePartTool split structure', (): void => {
  it('keeps display views split while retaining derived state in index.vue', (): void => {
    const indexSource = readToolSource('index.vue');

    expect(hasToolFile('useToolPartDisplay.ts')).toBe(false);
    expect(hasToolFile('ToolActivity.vue')).toBe(true);
    expect(hasToolFile('ToolShellDisplay.vue')).toBe(true);
    expect(hasToolFile('ToolQuestionResult.vue')).toBe(true);
    expect(hasToolFile('ToolSummary.vue')).toBe(true);
    expect(indexSource).not.toContain("import { useToolPartDisplay } from './useToolPartDisplay';");
    expect(indexSource).toContain("import ToolActivity from './ToolActivity.vue';");
    expect(indexSource).toContain("import ToolShellDisplay from './ToolShellDisplay.vue';");
    expect(indexSource).toContain("import ToolQuestionResult from './ToolQuestionResult.vue';");
    expect(indexSource).toContain("import ToolSummary from './ToolSummary.vue';");
  });
});
