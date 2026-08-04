/**
 * @file component-file-names.test.ts
 * @description 验证 BWidget components 目录下的组件文件命名约束。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 读取 BWidget components 目录中的 Vue 组件文件名。
 * @returns Vue 组件文件名列表
 */
function readComponentFileNames(): string[] {
  return readdirSync(resolve(__dirname, '../../../src/components/BWidget/components')).filter((fileName: string): boolean => fileName.endsWith('.vue'));
}

/**
 * 读取 BWidget 元素目录中的指定文件名。
 * @param fileName - 需要匹配的文件名
 * @returns 匹配到的文件路径列表
 */
function readElementFilesByName(fileName: string): string[] {
  return readdirSync(resolve(__dirname, '../../../src/components/BWidget/elements'), { withFileTypes: true })
    .filter((entry): boolean => entry.isDirectory())
    .map((entry): string => resolve(__dirname, '../../../src/components/BWidget/elements', entry.name, fileName))
    .filter((filePath: string): boolean => existsSync(filePath));
}

describe('BWidget component file names', (): void => {
  it('does not use the Widget prefix for local component files', (): void => {
    const widgetPrefixedFiles = readComponentFileNames().filter((fileName: string): boolean => fileName.startsWith('Widget'));

    expect(widgetPrefixedFiles).toEqual([]);
  });

  it('does not keep the removed text editor overlay component', (): void => {
    const componentPath = resolve(__dirname, '../../../src/components/BWidget/components/TextEditorOverlay.vue');
    const indexContent = readFileSync(resolve(__dirname, '../../../src/components/BWidget/index.vue'), 'utf-8');

    expect(existsSync(componentPath)).toBe(false);
    expect(indexContent).not.toContain('TextEditorOverlay');
    expect(indexContent).not.toContain('<textarea');
  });

  it('uses index.vue as each registered element view entry', (): void => {
    const registryContent = readFileSync(resolve(__dirname, '../../../src/components/BWidget/elements/index.ts'), 'utf-8');

    expect(readElementFilesByName('View.vue')).toEqual([]);
    expect(readElementFilesByName('index.vue')).toHaveLength(5);
    expect(registryContent).not.toContain('/View.vue');
    expect(registryContent).toContain('/index.vue');
  });
});
