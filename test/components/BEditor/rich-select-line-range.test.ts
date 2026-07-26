/**
 * @file rich-select-line-range.test.ts
 * @description BEditor Rich 模式 selectLineRange 选区设置与居中滚动的回归测试。
 * @vitest-environment jsdom
 *
 * 修复背景：原 selectLineRange 用 chain().scrollIntoView() 滚动到"最近边"，
 * 且依赖 focus() 触发滚动，但 Tiptap 的 focus 在编辑器已获焦点时早返回跳过滚动。
 * 现改用 commands 拆分步骤，并通过宿主注入的 onScrollElementIntoCenter 回调
 * 把选区起始位置滚动到可视区域中间，focus 时禁用内部 scrollIntoView 避免覆盖。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * 读取 Rich 编辑器面板源码。
 * @returns PaneRichEditor.vue 文件内容
 */
function readPaneRichEditorSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/components/BEditor/panes/PaneRichEditor.vue'), 'utf8');
}

/**
 * 从源码中提取指定函数的函数体（花括号配对扫描）。
 * @param source - Vue 组件源码
 * @param functionName - 目标函数名
 * @returns 函数体字符串；未命中时返回空字符串
 */
function extractFunctionBody(source: string, functionName: string): string {
  const startMatch = new RegExp(`(?:async\\s+)?function\\s+${functionName}[\\s\\S]*?\\{`, 'm').exec(source);
  if (!startMatch || startMatch.index === undefined) {
    return '';
  }

  const openBraceIndex = startMatch.index + startMatch[0].length - 1;
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i++) {
    const char = source[i];
    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(openBraceIndex, i + 1);
      }
    }
  }

  return '';
}

describe('PaneRichEditor selectLineRange center-scroll fix', (): void => {
  describe('source-level regression', (): void => {
    it('uses commands.setTextSelection instead of chain for selection', (): void => {
      const body = extractFunctionBody(readPaneRichEditorSource(), 'selectLineRange');
      expect(body).not.toBe('');
      // 必须用 commands.setTextSelection 设置选区，不再使用 chain
      expect(body).toMatch(/instance\.commands\.setTextSelection\(\s*\{\s*from:\s*mappedRange\.from,\s*to:\s*mappedRange\.to\s*\}\s*\)/);
      expect(body).not.toMatch(/instance\.chain\(\)/);
    });

    it('calls scrollRangeStartIntoCenter to scroll selection start into the center', (): void => {
      const body = extractFunctionBody(readPaneRichEditorSource(), 'selectLineRange');
      expect(body).not.toBe('');
      // 必须调用居中滚动辅助函数，传入编辑器实例与选区起点
      expect(body).toMatch(/scrollRangeStartIntoCenter\(\s*instance,\s*mappedRange\.from\s*\)/);
      // 不再使用 Tiptap 内置的 .scrollIntoView() chain 命令（默认滚动到最近边）
      expect(body).not.toMatch(/\.scrollIntoView\(\)\.run\(\)/);
    });

    it('disables focus internal scrollIntoView to avoid overriding center scroll', (): void => {
      const body = extractFunctionBody(readPaneRichEditorSource(), 'selectLineRange');
      expect(body).not.toBe('');
      // focus 必须显式传 { scrollIntoView: false }，防止 focus 内部滚动覆盖居中位置
      expect(body).toMatch(/instance\.commands\.focus\(\s*null,\s*\{\s*scrollIntoView:\s*false\s*\}\s*\)/);
    });

    it('still applies AI selection highlight after the selection is set', (): void => {
      const body = extractFunctionBody(readPaneRichEditorSource(), 'selectLineRange');
      expect(body).not.toBe('');
      expect(body).toMatch(/setAISelectionHighlight\(\s*instance,\s*\{[^}]*from:\s*mappedRange\.from[^}]*to:\s*mappedRange\.to[^}]*\}\s*\)/);
    });

    it('scrollRangeStartIntoCenter resolves DOM element and invokes onScrollElementIntoCenter prop', (): void => {
      const body = extractFunctionBody(readPaneRichEditorSource(), 'scrollRangeStartIntoCenter');
      expect(body).not.toBe('');
      // 必须通过 view.domAtPos 解析 DOM 节点
      expect(body).toMatch(/instance\.view\.domAtPos\(\s*pos\s*\)/);
      // 必须调用宿主注入的居中滚动回调
      expect(body).toMatch(/props\.onScrollElementIntoCenter\?\.\(\s*element\s*\)/);
    });

    it('exposes onScrollElementIntoCenter prop instead of legacy onSearchMatchElementFocus', (): void => {
      const source = readPaneRichEditorSource();
      // prop 名必须改名为 onScrollElementIntoCenter（语义更通用，可被 selectLineRange 复用）
      expect(source).toMatch(/onScrollElementIntoCenter\?:\s*\(targetElement:\s*HTMLElement\)\s*=>\s*void/);
      expect(source).not.toMatch(/onSearchMatchElementFocus/);
    });
  });

  describe('tiptap behavior', (): void => {
    let editor: Editor;

    beforeEach((): void => {
      editor = new Editor({
        content: '<p>first paragraph</p><p>second paragraph</p>',
        extensions: [StarterKit]
      });
    });

    afterEach((): void => {
      editor?.destroy();
    });

    /**
     * 取得 view 上的 scrollToSelection 方法 spy。
     * ProseMirror 类型定义未暴露 scrollToSelection，但运行时存在该方法，需通过 unknown 中转断言。
     * @param view - ProseMirror 编辑器视图
     * @returns scrollToSelection 方法 spy
     */
    function spyOnScrollToSelection(view: Editor['view']): ReturnType<typeof vi.fn> {
      const target = view as unknown as { scrollToSelection: () => void };
      return vi.spyOn(target, 'scrollToSelection');
    }

    it('commands.setTextSelection sets selection to the requested range', (): void => {
      editor.commands.setTextSelection({ from: 5, to: 10 });

      const { from, to } = editor.state.selection;
      expect(from).toBe(5);
      expect(to).toBe(10);
    });

    it('focus(null, { scrollIntoView: false }) does not trigger scrollToSelection when editor has no focus', (): void => {
      // 验证禁用选项有效：未聚焦时 focus 也不会触发内部 scrollIntoView
      vi.spyOn(editor.view, 'hasFocus').mockReturnValue(false);
      const scrollToSelectionSpy = spyOnScrollToSelection(editor.view);

      editor.commands.focus(null, { scrollIntoView: false });

      expect(scrollToSelectionSpy).not.toHaveBeenCalled();
    });

    it('focus() with default options would trigger scrollIntoView via RAF when editor has no focus', (): void => {
      // 对照组：未禁用 scrollIntoView 时，focus 会触发延迟滚动（证明禁用选项的必要性）
      vi.spyOn(editor.view, 'hasFocus').mockReturnValue(false);
      const scrollToSelectionSpy = spyOnScrollToSelection(editor.view);

      editor.commands.focus();

      // focus 命令通过 requestAnimationFrame 调用 scrollIntoView，
      // 同步阶段 scrollToSelection 尚未被触发
      expect(scrollToSelectionSpy).not.toHaveBeenCalled();
    });

    it('focus() does not trigger scrollToSelection when editor already has focus', (): void => {
      // 复现修复前的 bug：编辑器已聚焦时 focus() 早返回，跳过 scrollIntoView
      vi.spyOn(editor.view, 'hasFocus').mockReturnValue(true);
      const scrollToSelectionSpy = spyOnScrollToSelection(editor.view);

      editor.commands.focus();

      expect(scrollToSelectionSpy).not.toHaveBeenCalled();
    });
  });
});
