/**
 * @file chipResolver.test.ts
 * @description chipResolver 单元测试，覆盖新格式解析和 DOM 渲染。
 * @vitest-environment jsdom
 */
import { describe, expect, test } from 'vitest';
import { chipResolver, parseFileRef } from '@/components/BChatSidebar/utils/chipResolver';
import type { ChipResult } from '@/components/BPromptEditor/extensions/variableChip';

/**
 * 窄化 ChipResult 并断言 Widget 构造参数。
 */
function expectFileRefWidget(
  result: ChipResult | null,
  expected: { fileName: string; startLine: number; endLine: number; renderStartLine?: number; renderEndLine?: number }
): void {
  expect(result).not.toBeNull();
  const chipResult = result as ChipResult;
  expect(chipResult).toHaveProperty('widget');
  if ('widget' in chipResult) {
    expect(chipResult.widget).toMatchObject({
      fileName: expected.fileName,
      startLine: expected.startLine,
      endLine: expected.endLine,
      renderStartLine: expected.renderStartLine ?? expected.startLine,
      renderEndLine: expected.renderEndLine ?? expected.endLine
    });
  }
}

describe('chipResolver', () => {
  describe('新格式（@fileName:行号）', () => {
    test('范围引用：@fileName:startLine-endLine', () => {
      expectFileRefWidget(chipResolver('@file.ts:5-15'), {
        fileName: 'file.ts',
        startLine: 5,
        endLine: 15
      });
    });

    test('单行引用：@fileName:startLine', () => {
      expectFileRefWidget(chipResolver('@file.ts:10'), {
        fileName: 'file.ts',
        startLine: 10,
        endLine: 10
      });
    });

    test('无行号：@fileName', () => {
      expectFileRefWidget(chipResolver('@file.ts'), {
        fileName: 'file.ts',
        startLine: 0,
        endLine: 0
      });
    });

    test('文件名含点号', () => {
      expectFileRefWidget(chipResolver('@helper.ts:3-8'), {
        fileName: 'helper.ts',
        startLine: 3,
        endLine: 8
      });
    });
  });

  describe('存储格式（#path 行号）', () => {
    test('范围引用优先显示 render 行号', () => {
      expectFileRefWidget(chipResolver('#src/demo.ts 12-14|20-24'), {
        fileName: 'demo.ts',
        startLine: 12,
        endLine: 14,
        renderStartLine: 20,
        renderEndLine: 24
      });
    });

    test('旧格式缺少 render 行号时回退到源码行号', () => {
      expectFileRefWidget(chipResolver('#src/demo.ts 12-14'), {
        fileName: 'demo.ts',
        startLine: 12,
        endLine: 14
      });
    });
  });

  describe('非 file-ref 类型', () => {
    test('其他类型 body → 返回 null', () => {
      expect(chipResolver('todo:something')).toBeNull();
    });

    test('空字符串 → 返回 null', () => {
      expect(chipResolver('')).toBeNull();
    });
  });

  describe('FileRefWidget DOM 渲染', () => {
    /**
     * 从 chipResolver 结果中提取 Widget 并返回其 toDOM 结果。
     */
    function resolveWidgetDom(body: string): HTMLElement | null {
      const result = chipResolver(body);
      if (result && 'widget' in result) {
        return (result.widget as { toDOM(view?: unknown): HTMLElement }).toDOM();
      }
      return null;
    }

    test('toDOM 单行渲染', () => {
      const dom = resolveWidgetDom('@file.ts:5');
      expect(dom?.textContent).toBe('file.ts:5');
    });

    test('toDOM 范围渲染', () => {
      const dom = resolveWidgetDom('@file.ts:5-15');
      expect(dom?.textContent).toBe('file.ts:5-15');
    });

    test('toDOM 无行号仅显示文件名', () => {
      const dom = resolveWidgetDom('@file.ts');
      expect(dom?.textContent).toBe('file.ts');
    });

    test('toDOM 存储格式优先显示 render 行号', () => {
      const dom = resolveWidgetDom('#src/demo.ts 12-14|20-24');
      expect(dom?.textContent).toBe('demo.ts:20-24');
    });
  });
});

describe('parseFileRef', () => {
  test('parses storage token with render line metadata', () => {
    expect(parseFileRef('#src/demo.ts 12-14|20-24')).toEqual({
      filePath: 'src/demo.ts',
      startLine: 12,
      endLine: 14,
      renderStartLine: 20,
      renderEndLine: 24
    });
  });

  test('falls back to source lines when render metadata is absent', () => {
    expect(parseFileRef('#src/demo.ts 12-14')).toEqual({
      filePath: 'src/demo.ts',
      startLine: 12,
      endLine: 14,
      renderStartLine: 12,
      renderEndLine: 14
    });
  });
});
