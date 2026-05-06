/* @vitest-environment jsdom */
/**
 * @file sourceEditorDrawSelection.test.ts
 * @description Source 编辑器自定义 selection 绘制回归测试。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, test } from 'vitest';
import {
  createSourceEditorDrawSelectionExtension,
  restoreSourceEditorSelectionDraw,
  suppressSourceEditorSelectionDraw
} from '@/components/BEditor/adapters/sourceEditorDrawSelection';

/**
 * 创建带自定义 selection 绘制扩展的编辑器实例。
 * @returns 测试用 EditorView
 */
function createTestEditorView(): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);

  return new EditorView({
    parent,
    state: EditorState.create({
      doc: 'hello world',
      extensions: [createSourceEditorDrawSelectionExtension()]
    })
  });
}

/**
 * 读取当前编辑器中的普通 selection 装饰节点数量。
 * @param view - 测试用 EditorView
 * @returns `.cm-custom-selection` 节点数量
 */
function getCustomSelectionCount(view: EditorView): number {
  return view.dom.querySelectorAll('.cm-custom-selection').length;
}

/**
 * 销毁测试编辑器并清理挂载节点。
 * @param view - 待销毁的 EditorView
 */
function destroyEditorView(view: EditorView | null): void {
  if (!view) {
    return;
  }

  const parent = view.dom.parentElement;
  view.destroy();
  parent?.remove();
}

describe('sourceEditorDrawSelection', () => {
  let view: EditorView | null = null;

  afterEach((): void => {
    destroyEditorView(view);
    view = null;
  });

  test('keeps normal selection drawing suppressed across later selection changes until explicitly restored', (): void => {
    view = createTestEditorView();

    // 1. 先建立一个普通选区，确认自定义 selection 装饰正常绘制。
    view.dispatch({
      selection: EditorSelection.range(0, 5)
    });
    expect(getCustomSelectionCount(view)).toBe(1);

    // 2. 打开 AI 面板时抑制普通 selection 绘制。
    suppressSourceEditorSelectionDraw(view);
    expect(getCustomSelectionCount(view)).toBe(0);

    // 3. AI 面板保持打开期间修改真实选区，普通 selection 不应重新出现。
    view.dispatch({
      selection: EditorSelection.range(6, 11)
    });
    expect(getCustomSelectionCount(view)).toBe(0);

    // 4. 只有显式恢复后，普通 selection 才重新可见。
    restoreSourceEditorSelectionDraw(view);
    expect(getCustomSelectionCount(view)).toBe(1);
  });

  test('forces normal selection text inside custom selection decoration to use selection foreground color', (): void => {
    const sourceEditorDrawSelectionSource = readFileSync(resolve(process.cwd(), 'src/components/BEditor/adapters/sourceEditorDrawSelection.ts'), 'utf-8');

    expect(sourceEditorDrawSelectionSource).toContain("'& .cm-custom-selection':");
    expect(sourceEditorDrawSelectionSource).toContain("color: 'var(--selection-color)'");
    expect(sourceEditorDrawSelectionSource).toContain("'& .cm-custom-selection, & .cm-custom-selection *':");
    expect(sourceEditorDrawSelectionSource).toContain("color: 'var(--selection-color) !important'");
  });
});
